// Cloudflare D1 storage for items and settings (collections, shelf arrangements).
// Tables are created and upgraded automatically (see MIGRATIONS), so there's no SQL to run by hand.
import { HttpError } from './util.js';
import { extKeyOf, visibilityOf, VISIBILITY } from './extkey.js';

// Each migration runs once, in order, and the database remembers which ones it has had (meta.schema_version).
// Add new ones to the END of this list; never edit one that has shipped. Sites that update their copy of the
// code pick up new migrations automatically on the next request, so nobody has to run SQL by hand.
const MIGRATIONS = [
  {
    version: 1, // the original tables
    sql: [
      `CREATE TABLE IF NOT EXISTS items (
        slug TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        data TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS items_type ON items (type)`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2, // shared IDs + who can see each item
    sql: [
      // uid: a permanent ID that never changes, even if the slug does. Friends' sites refer to items by it.
      `ALTER TABLE items ADD COLUMN uid TEXT`,
      // ext_key: "<type>:<source>:<id>", the same for everyone who added the same thing (see extkey.js).
      `ALTER TABLE items ADD COLUMN ext_key TEXT`,
      // visibility: public (anyone), friends (your MyShelf friends only), private (only you).
      `ALTER TABLE items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`,
      `UPDATE items SET uid = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
         substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) WHERE uid IS NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS items_uid ON items (uid)`,
      `CREATE INDEX IF NOT EXISTS items_ext_key ON items (ext_key)`,
      `CREATE INDEX IF NOT EXISTS items_visibility ON items (visibility)`,
    ],
    after: backfillItemKeys,
  },
  {
    version: 3, // friends between MyShelf sites (see server/federation/)
    sql: [
      `CREATE TABLE IF NOT EXISTS friends (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,          -- their site's origin, e.g. https://myshelf.alex.workers.dev
        name TEXT NOT NULL DEFAULT '',
        owner TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL,          -- their Ed25519 public key (JWK x value)
        status TEXT NOT NULL,              -- requested (we asked) | pending (they asked) | accepted | blocked
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS friends_status ON friends (status)`,
      `CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,               -- the sender's message id (stops replays and duplicates)
        from_url TEXT NOT NULL,
        kind TEXT NOT NULL,                -- friend-request | recommend | borrow-request | borrow-reply | ...
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unread', -- unread | read | accepted | declined | done
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS inbox_created ON inbox (created_at)`,
      `CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        to_url TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,              -- sent | failed
        error TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS outbox_created ON outbox (created_at)`,
    ],
  },
  {
    version: 4, // hearts: "I enjoyed this too" on a friend's item
    sql: [
      // Hearts you've given to friends' items (so the heart stays filled in when you look again).
      `CREATE TABLE IF NOT EXISTS hearts_sent (
        friend_url TEXT NOT NULL,
        uid TEXT NOT NULL,                 -- the item's uid on their site
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (friend_url, uid)
      )`,
      // Hearts friends have given to your items.
      `CREATE TABLE IF NOT EXISTS hearts_received (
        from_url TEXT NOT NULL,
        uid TEXT NOT NULL,                 -- your item's uid
        inbox_id TEXT,                     -- the inbox message it made, removed again if they take the heart back
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_url, uid)
      )`,
    ],
  },
  {
    version: 5, // comments on your items, from friends (and your own replies)
    sql: [
      `CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,               -- a friend's message id, or a random id for your own replies
        uid TEXT NOT NULL,                 -- your item's uid
        from_url TEXT NOT NULL DEFAULT '', -- the friend's site; '' means you wrote it
        author TEXT NOT NULL DEFAULT '',   -- their name when they wrote it (the friends list has the current one)
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS comments_uid ON comments (uid, created_at)`,
    ],
  },
  {
    version: 6, // your own private nicknames for friends (shown only to you, when signed in)
    sql: [
      `ALTER TABLE friends ADD COLUMN nickname TEXT NOT NULL DEFAULT ''`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

const ready = new WeakMap();

export function hasDb(env) {
  return Boolean(env?.DB);
}

function db(env) {
  if (!env?.DB) {
    throw new HttpError(500, 'Your Worker has no D1 database binding named DB. Check the d1_databases entry in wrangler.jsonc (or Worker → Settings → Bindings), then redeploy.');
  }
  return env.DB;
}

async function schemaVersion(DB) {
  const r = await DB.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first();
  return Number(r?.value || 0);
}

async function migrate(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
  for (const m of MIGRATIONS) {
    if ((await schemaVersion(DB)) >= m.version) continue;
    const setVersion = DB.prepare(
      `INSERT INTO meta (key, value) VALUES ('schema_version', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1`,
    ).bind(String(m.version));
    try {
      // One transaction per migration: it either fully applies (and records its version) or not at all.
      await DB.batch([...m.sql.map((sql) => DB.prepare(sql)), setVersion]);
    } catch (err) {
      // Another request may have run the same migration a moment ago; that's fine.
      if ((await schemaVersion(DB)) >= m.version) continue;
      throw err;
    }
    if (m.after) await m.after(DB);
  }
}

/** Run any pending migrations once per worker instance. */
export async function ensureSchema(env) {
  const DB = db(env);
  if (!ready.has(DB)) {
    const p = migrate(DB).catch((err) => {
      ready.delete(DB);
      throw err;
    });
    ready.set(DB, p);
  }
  await ready.get(DB);
  return DB;
}

/** Fill in ext_key and visibility for items saved before migration 2. Safe to run again. */
async function backfillItemKeys(DB) {
  const { results } = await DB.prepare('SELECT slug, data FROM items WHERE ext_key IS NULL').all();
  const stmts = [];
  for (const r of results || []) {
    let item;
    try { item = JSON.parse(r.data); } catch { continue; }
    const key = extKeyOf(item);
    if (key) stmts.push(DB.prepare('UPDATE items SET ext_key = ?1, visibility = ?2 WHERE slug = ?3').bind(key, visibilityOf(item), r.slug));
  }
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
}

const now = () => new Date().toISOString();
const rowToItem = (r) => ({ slug: r.slug, uid: r.uid || null, item: JSON.parse(r.data), body: r.body || '', createdAt: r.created_at || null, updatedAt: r.updated_at || null });
const COLS = 'slug, uid, data, body, created_at, updated_at';

/**
 * Every item: [{ slug, uid, item, body }].
 * visibility: optional list, e.g. ['public'] for the public pages or ['public', 'friends'] for friends.
 */
export async function listItems(env, { type, visibility } = {}) {
  const DB = await ensureSchema(env);
  const where = [];
  const args = [];
  if (type) { where.push(`type = ?${args.length + 1}`); args.push(type); }
  if (visibility) {
    const vis = visibility.filter((v) => VISIBILITY.includes(v));
    if (!vis.length) return [];
    where.push(`visibility IN (${vis.map((_, i) => `?${args.length + i + 1}`).join(', ')})`);
    args.push(...vis);
  }
  const sql = `SELECT ${COLS} FROM items${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const { results } = await DB.prepare(sql).bind(...args).all();
  return (results || []).map(rowToItem);
}

export async function getItem(env, slug) {
  const DB = await ensureSchema(env);
  const r = await DB.prepare(`SELECT ${COLS} FROM items WHERE slug = ?`).bind(slug).first();
  return r ? rowToItem(r) : null;
}

export async function getItemByUid(env, uid) {
  const DB = await ensureSchema(env);
  const r = await DB.prepare(`SELECT ${COLS} FROM items WHERE uid = ?`).bind(String(uid || '')).first();
  return r ? rowToItem(r) : null;
}

export async function itemExists(env, slug) {
  const DB = await ensureSchema(env);
  return Boolean(await DB.prepare('SELECT 1 AS x FROM items WHERE slug = ?').bind(slug).first());
}

export async function countItems(env) {
  const DB = await ensureSchema(env);
  const r = await DB.prepare('SELECT COUNT(*) AS n FROM items').first();
  return Number(r?.n || 0);
}

// uid is kept once set (a restore can pass the original one along); ext_key and visibility follow the item.
function upsertStmt(DB, slug, item, body, uid) {
  const t = now();
  return DB.prepare(
    `INSERT INTO items (slug, type, title, data, body, created_at, updated_at, uid, ext_key, visibility)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9)
     ON CONFLICT (slug) DO UPDATE SET type = ?2, title = ?3, data = ?4, body = ?5, updated_at = ?6,
       uid = COALESCE(items.uid, ?7), ext_key = ?8, visibility = ?9`,
  ).bind(slug, item.type, item.title, JSON.stringify(item), String(body || '').trim(), t,
    uid || crypto.randomUUID(), extKeyOf(item), visibilityOf(item));
}

/** Insert or update one item. */
export async function putItem(env, slug, item, body = '') {
  const DB = await ensureSchema(env);
  await upsertStmt(DB, slug, item, body).run();
}

/** Insert or update several items in one transaction: [{ slug, item, body, uid? }]. */
export async function putItems(env, rows) {
  if (!rows.length) return;
  const DB = await ensureSchema(env);
  await DB.batch(rows.map((r) => upsertStmt(DB, r.slug, r.item, r.body, r.uid)));
}

export async function removeItem(env, slug) {
  const DB = await ensureSchema(env);
  await DB.prepare('DELETE FROM items WHERE slug = ?').bind(slug).run();
}

export async function getSetting(env, key, fallback = null) {
  const DB = await ensureSchema(env);
  const r = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}

export async function hasSetting(env, key) {
  const DB = await ensureSchema(env);
  return Boolean(await DB.prepare('SELECT 1 AS x FROM settings WHERE key = ?').bind(key).first());
}

export async function setSetting(env, key, value) {
  const DB = await ensureSchema(env);
  await DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3`,
  ).bind(key, JSON.stringify(value), now()).run();
}
