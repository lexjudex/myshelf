// Friends between MyShelf sites: adding friends, recommendations, borrow requests, and friends-only shelves.
// Each site keeps its own list of friends and its own inbox in D1; sites talk over HTTPS with signed messages
// (see protocol.js). Nothing goes through a central server.
import { HttpError } from '../util.js';
import { ensureSchema, getItem, getItemByUid, putItem, getSetting, setSetting } from '../db.js';
import { getSite } from '../site.js';
import { getIdentity } from './crypto.js';
import { VERSION } from '../version.js';
import { resolveMentions, mentionedUrls, plainMentions } from './mentions.js';
import {
  PROTOCOL, SOFTWARE, WELL_KNOWN, INBOX_PATH, SHELF_PATH, MAX_BODY, KINDS,
  cleanSiteUrl, signedHeaders, verifyRequest,
} from './protocol.js';

const MAX_PENDING = 100; // friend requests waiting for an answer
const MAX_INBOX = 2000;  // oldest read messages are trimmed past this
const TIMEOUT_MS = 8000;
const MAX_COMMENT = 1000;            // characters in one comment
const MAX_COMMENTS_PER_ITEM = 500;
const now = () => new Date().toISOString();
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// ───────── who am I ─────────

/** The address friends should use: the one set in Settings, or else the address this request came in on. */
export async function selfOrigin(env, requestUrl) {
  const site = await getSite(env);
  return site.url || new URL(requestUrl).origin;
}

async function selfOrigins(env, requestUrl) {
  const site = await getSite(env);
  return [...new Set([new URL(requestUrl).origin, site.url].filter(Boolean))];
}

/** GET /.well-known/myshelf */
export async function wellKnown(env, requestUrl) {
  const [site, identity, url] = await Promise.all([getSite(env), getIdentity(env), selfOrigin(env, requestUrl)]);
  return {
    software: SOFTWARE,
    protocol: PROTOCOL,
    version: VERSION,
    url,
    name: site.title,
    owner: site.owner,
    publicKey: identity.publicKey,
    inbox: url + INBOX_PATH,
    shelf: url + SHELF_PATH,
  };
}

// ───────── storage ─────────

const rowToFriend = (r) => r && ({ id: r.id, url: r.url, name: r.name, owner: r.owner, nickname: r.nickname || '', status: r.status, publicKey: r.public_key, createdAt: r.created_at, updatedAt: r.updated_at });
// What the admin page gets: no keys.
const publicFriend = (f) => { if (!f) return f; const { publicKey, ...rest } = f; return rest; };

async function friendByUrl(env, url) {
  const DB = await ensureSchema(env);
  return rowToFriend(await DB.prepare('SELECT * FROM friends WHERE url = ?').bind(url).first());
}

async function friendById(env, id) {
  const DB = await ensureSchema(env);
  const f = rowToFriend(await DB.prepare('SELECT * FROM friends WHERE id = ?').bind(String(id || '')).first());
  if (!f) throw new HttpError(404, 'Friend not found');
  return f;
}

async function saveFriend(env, f) {
  const DB = await ensureSchema(env);
  const t = now();
  await DB.prepare(
    `INSERT INTO friends (id, url, name, owner, public_key, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT (url) DO UPDATE SET name = ?3, owner = ?4, public_key = ?5, status = ?6, updated_at = ?7`,
  ).bind(f.id || crypto.randomUUID(), f.url, str(f.name, 80), str(f.owner, 80), f.publicKey, f.status, t).run();
  return friendByUrl(env, f.url);
}

async function deleteFriend(env, id) {
  const DB = await ensureSchema(env);
  const f = await DB.prepare('SELECT url FROM friends WHERE id = ?').bind(id).first();
  await DB.prepare('DELETE FROM friends WHERE id = ?').bind(id).run();
  // Hearts only mean something between friends.
  if (f) {
    await DB.batch([
      DB.prepare('DELETE FROM hearts_sent WHERE friend_url = ?').bind(f.url),
      DB.prepare('DELETE FROM hearts_received WHERE from_url = ?').bind(f.url),
    ]);
  }
}

async function addInbox(env, { id, from, kind, payload, status = 'unread' }) {
  const DB = await ensureSchema(env);
  // INSERT OR IGNORE: the same message id arriving twice (a retry or a replay) is stored once.
  const res = await DB.prepare(
    `INSERT OR IGNORE INTO inbox (id, from_url, kind, payload, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(id, from, kind, JSON.stringify(payload), status, now()).run();
  await DB.prepare(
    `DELETE FROM inbox WHERE id IN (SELECT id FROM inbox WHERE status != 'unread' ORDER BY created_at DESC LIMIT -1 OFFSET ?)`,
  ).bind(MAX_INBOX).run();
  return res;
}

async function inboxById(env, id) {
  const DB = await ensureSchema(env);
  const r = await DB.prepare('SELECT * FROM inbox WHERE id = ?').bind(String(id || '')).first();
  if (!r) throw new HttpError(404, 'Message not found');
  return { id: r.id, from: r.from_url, kind: r.kind, payload: JSON.parse(r.payload), status: r.status, createdAt: r.created_at };
}

async function setInboxStatus(env, id, status) {
  const DB = await ensureSchema(env);
  await DB.prepare('UPDATE inbox SET status = ? WHERE id = ?').bind(status, id).run();
}

async function logOutbox(env, { id, to, kind, payload, status, error = null }) {
  const DB = await ensureSchema(env);
  await DB.prepare(
    `INSERT OR REPLACE INTO outbox (id, to_url, kind, payload, status, error, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(id, to, kind, JSON.stringify(payload), status, error, now()).run();
  await DB.prepare(`DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY created_at DESC LIMIT -1 OFFSET ?)`).bind(MAX_INBOX).run();
}

// ───────── talking to other sites ─────────

/** Look up another site's name and key. */
export async function discover(url, fetcher = fetch) {
  const origin = cleanSiteUrl(url);
  let info;
  try {
    const res = await fetcher(origin + WELL_KNOWN, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    info = await res.json();
  } catch {
    throw new HttpError(502, `Couldn’t reach a MyShelf site at ${origin}. Check the address and that the site is up.`);
  }
  if (info?.software !== SOFTWARE || typeof info.publicKey !== 'string' || !info.publicKey) {
    throw new HttpError(502, `${origin} doesn’t look like a MyShelf site.`);
  }
  if (Number(info.protocol) > PROTOCOL) {
    throw new HttpError(502, `${origin} runs a newer version of MyShelf. Update your copy to connect with it.`);
  }
  // A site can only speak for its own address.
  const claimed = cleanSiteUrl(info.url || origin);
  if (claimed !== origin) throw new HttpError(502, `${origin} says its address is ${claimed}. Add that address instead.`);
  return { url: origin, name: str(info.name, 80), owner: str(info.owner, 80), publicKey: info.publicKey };
}

async function send(env, requestUrl, toUrl, kind, fields, fetcher = fetch) {
  const [identity, from] = await Promise.all([getIdentity(env), selfOrigin(env, requestUrl)]);
  const message = { id: crypto.randomUUID(), kind, ...fields };
  const body = JSON.stringify(message);
  const url = toUrl + INBOX_PATH;
  let error = null;
  let reply = {};
  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await signedHeaders(identity, { method: 'POST', url, from, body })) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    reply = await res.json().catch(() => ({}));
    if (!res.ok) error = reply.error || `Their site answered ${res.status}`;
  } catch (err) {
    error = `Couldn’t reach ${toUrl}`;
  }
  await logOutbox(env, { id: message.id, to: toUrl, kind, payload: message, status: error ? 'failed' : 'sent', error });
  if (error) throw new HttpError(502, error);
  return { message, reply };
}

// ───────── inbound ─────────

/** POST /federation/v1/inbox */
export async function receive(env, request, fetcher = fetch, { waitUntil = null } = {}) {
  const body = await request.text();
  if (body.length > MAX_BODY) throw new HttpError(413, 'Message too large');
  let msg;
  try { msg = JSON.parse(body); } catch { throw new HttpError(400, 'Message must be JSON'); }
  if (!msg || typeof msg.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(msg.id) || !KINDS.includes(msg.kind)) {
    throw new HttpError(400, 'Unknown message');
  }
  const origins = await selfOrigins(env, request.url);
  const claimedFrom = request.headers.get('myshelf-from') || '';
  if (origins.includes(claimedFrom)) throw new HttpError(400, 'A site can’t message itself');
  const known = claimedFrom ? await friendByUrl(env, claimedFrom).catch(() => null) : null;

  // A friend request may come from a site we've never heard of: fetch its key from its own address.
  let discovered = null;
  const getKey = async (from) => {
    if (known && known.status !== 'blocked') return known.publicKey;
    if (msg.kind !== 'friend-request' || known?.status === 'blocked') return null;
    discovered = await discover(from, fetcher).catch(() => null);
    return discovered?.publicKey || null;
  };
  const { from } = await verifyRequest(request, body, origins, getKey);

  switch (msg.kind) {
    case 'friend-request': {
      const info = discovered || { url: from, name: known?.name, owner: known?.owner, publicKey: known.publicKey };
      if (known?.status === 'accepted') return { ok: true, status: 'accepted' };
      if (known?.status === 'requested') {
        // We'd already asked them: that's a yes from both sides.
        await saveFriend(env, { ...known, ...info, status: 'accepted' });
        await addInbox(env, { id: msg.id, from, kind: 'friend-accept', payload: { name: info.name, owner: info.owner }, status: 'unread' });
        return { ok: true, status: 'accepted' };
      }
      const DB = await ensureSchema(env);
      const pending = await DB.prepare(`SELECT COUNT(*) AS n FROM friends WHERE status = 'pending'`).first();
      if (!known && Number(pending?.n || 0) >= MAX_PENDING) throw new HttpError(429, 'Too many friend requests waiting');
      await saveFriend(env, { ...info, id: known?.id, status: 'pending' });
      await addInbox(env, { id: msg.id, from, kind: msg.kind, payload: { name: info.name, owner: info.owner, note: str(msg.note, 500) } });
      return { ok: true, status: 'pending' };
    }
    case 'friend-accept': {
      if (known?.status !== 'requested' && known?.status !== 'accepted') throw new HttpError(403, 'No friend request to accept');
      await saveFriend(env, { ...known, name: msg.name ?? known.name, owner: msg.owner ?? known.owner, status: 'accepted' });
      await addInbox(env, { id: msg.id, from, kind: msg.kind, payload: { name: str(msg.name, 80) || known.name, owner: str(msg.owner, 80) || known.owner } });
      return { ok: true };
    }
    case 'friend-remove': {
      if (known) await deleteFriend(env, known.id);
      return { ok: true };
    }
  }

  // Everything else is only accepted from friends.
  if (known?.status !== 'accepted') throw new HttpError(403, 'You aren’t friends with this site');

  if (msg.kind === 'recommend') {
    const it = msg.item || {};
    const via = msg.via && typeof msg.via === 'object' && safeOrigin(msg.via.url) ? { name: str(msg.via.name, 80), url: safeOrigin(msg.via.url) } : null;
    const payload = {
      note: str(msg.note, 1000),
      ...(via ? { via } : {}),
      item: {
        title: str(it.title, 200), type: str(it.type, 20), creator: str(it.creator, 200), year: str(it.year, 10),
        cover: safeUrl(it.cover), url: safeUrl(it.url), sourceUrl: safeUrl(it.sourceUrl), extKey: str(it.extKey, 200),
        source: it.source && typeof it.source === 'object' ? { name: str(it.source.name, 40), id: str(it.source.id, 80), url: safeUrl(it.source.url) } : undefined,
      },
    };
    if (!payload.item.title) throw new HttpError(400, 'A recommendation needs a title');
    if (payload.item.extKey) {
      const DB = await ensureSchema(env);
      const mine = await DB.prepare('SELECT slug FROM items WHERE ext_key = ?').bind(payload.item.extKey).first();
      if (mine) payload.alreadyHave = mine.slug;
    }
    await addInbox(env, { id: msg.id, from, kind: msg.kind, payload });
    return { ok: true };
  }

  if (msg.kind === 'borrow-request') {
    const row = await getItemByUid(env, str(msg.item?.uid, 40));
    if (!row || row.item.visibility === 'private' || !row.item.owned) throw new HttpError(404, 'That item isn’t available to borrow');
    await addInbox(env, {
      id: msg.id, from, kind: msg.kind,
      payload: { note: str(msg.note, 1000), item: { uid: row.uid, slug: row.slug, title: row.item.title, type: row.item.type }, lentTo: row.item.lentTo || '' },
    });
    return { ok: true };
  }

  if (msg.kind === 'heart') {
    const row = await getItemByUid(env, str(msg.item?.uid, 40));
    // Friends can see public and friends-only items, so those are the ones they can heart.
    if (!row || row.item.visibility === 'private') throw new HttpError(404, 'That item isn’t on this shelf');
    const DB = await ensureSchema(env);
    const had = await DB.prepare('SELECT inbox_id FROM hearts_received WHERE from_url = ? AND uid = ?').bind(from, row.uid).first();
    if (msg.on === false) {
      if (had) {
        await DB.batch([
          DB.prepare('DELETE FROM hearts_received WHERE from_url = ? AND uid = ?').bind(from, row.uid),
          // Take the inbox note away too, unless it's already been read.
          DB.prepare(`DELETE FROM inbox WHERE id = ? AND status = 'unread'`).bind(had.inbox_id || ''),
        ]);
      }
      return { ok: true, on: false };
    }
    if (had) return { ok: true, on: true }; // already hearted: no second inbox note
    const it = row.item;
    await addInbox(env, {
      id: msg.id, from, kind: 'heart',
      payload: { item: { uid: row.uid, slug: row.slug, title: it.title, type: it.type, creator: it.creator || '', cover: it.cover || '', visibility: it.visibility || 'public' } },
    });
    await DB.prepare('INSERT OR IGNORE INTO hearts_received (from_url, uid, inbox_id, created_at) VALUES (?, ?, ?, ?)').bind(from, row.uid, msg.id, now()).run();
    return { ok: true, on: true };
  }

  if (msg.kind === 'comment') {
    const row = await getItemByUid(env, str(msg.item?.uid, 40));
    // Friends can see public and friends-only items, so those are the ones they can comment on.
    if (!row || row.item.visibility === 'private') throw new HttpError(404, 'That item isn’t on this shelf');
    const text = str(msg.text, MAX_COMMENT);
    if (!text) throw new HttpError(400, 'A comment needs some text');
    const DB = await ensureSchema(env);
    const n = await DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE uid = ?').bind(row.uid).first();
    if (Number(n?.n || 0) >= MAX_COMMENTS_PER_ITEM) throw new HttpError(429, 'That item has too many comments');
    const author = known.owner || known.name || '';
    const t = now();
    const res = await DB.prepare('INSERT OR IGNORE INTO comments (id, uid, from_url, author, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(msg.id, row.uid, from, author, text, t).run();
    if (res.meta?.changes !== 0) {
      const it = row.item;
      await addInbox(env, {
        id: msg.id, from, kind: 'comment',
        payload: { text, commentId: msg.id, item: { uid: row.uid, slug: row.slug, title: it.title, type: it.type, creator: it.creator || '', cover: it.cover || '', visibility: it.visibility || 'public' } },
      });
      // Let everyone else in the thread know (in the background when the platform allows it).
      const work = notifyThread(env, request.url, row, { id: msg.id, author, authorUrl: from, text }, fetcher);
      if (waitUntil) waitUntil(work); else await work;
    }
    return { ok: true, comment: { id: msg.id, author, authorUrl: from, text, createdAt: t } };
  }

  if (msg.kind === 'comment-delete') {
    const id = str(msg.commentId, 40);
    const DB = await ensureSchema(env);
    // Only the friend who wrote a comment can take it back; its unread inbox note goes with it.
    const res = await DB.prepare('DELETE FROM comments WHERE id = ? AND from_url = ?').bind(id, from).run();
    if (res.meta?.changes) await DB.prepare(`DELETE FROM inbox WHERE id = ? AND kind = 'comment' AND status = 'unread'`).bind(id).run();
    return { ok: true };
  }

  if (msg.kind === 'comment-reply') {
    // From a friend: someone added to a thread on one of their items that you'd commented in.
    const it = msg.item || {};
    const text = str(msg.text, MAX_COMMENT);
    if (!text || !str(it.title, 200)) throw new HttpError(400, 'Incomplete reply notice');
    await addInbox(env, {
      id: msg.id, from, kind: 'comment-reply',
      payload: {
        text, commentId: str(msg.commentId, 40), author: str(msg.author, 80), authorUrl: safeUrl(msg.authorUrl),
        item: { uid: str(it.uid, 40), title: str(it.title, 200), type: str(it.type, 20), cover: safeUrl(it.cover), url: safeUrl(it.url) },
      },
    });
    return { ok: true };
  }

  if (msg.kind === 'mention') {
    const it = msg.item || {};
    const text = str(plainMentions(msg.text), 400);
    if (!str(it.title, 200)) throw new HttpError(400, 'Incomplete mention');
    const owner = msg.owner && typeof msg.owner === 'object' ? { name: str(msg.owner.name, 80), url: safeOrigin(msg.owner.url) } : null;
    await addInbox(env, {
      id: msg.id, from, kind: 'mention',
      payload: {
        where: msg.where === 'comment' ? 'comment' : 'notes', text,
        item: { uid: str(it.uid, 40), title: str(it.title, 200), type: str(it.type, 20), cover: safeUrl(it.cover), url: safeUrl(it.url) },
        ...(owner?.url ? { owner } : {}),
      },
    });
    return { ok: true };
  }

  if (msg.kind === 'borrow-reply') {
    await addInbox(env, {
      id: msg.id, from, kind: msg.kind,
      payload: { answer: msg.answer === 'yes' ? 'yes' : 'no', note: str(msg.note, 1000), requestId: str(msg.requestId, 40), title: str(msg.title, 200) },
    });
    return { ok: true };
  }

  throw new HttpError(400, 'Unknown message');
}

/** A site address from another site's message: just its origin (https://…, no trailing slash), or ''. */
function safeOrigin(v) {
  const u = safeUrl(v);
  try { return u ? new URL(u).origin : ''; } catch { return ''; }
}

function safeUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.href.slice(0, 500) : '';
  } catch {
    return '';
  }
}

// ───────── shelf feed ─────────

const MAX_REVIEW = 5000; // characters of your notes sent with each item

/** What a friend (or anyone) sees: items as plain JSON with absolute cover links. */
function feedItem(row, origin, forFriend, comments = []) {
  const it = row.item;
  const abs = (u) => (u && u.startsWith('/') ? origin + u : u || '');
  const out = {
    uid: row.uid,
    title: it.title, type: it.type, creator: it.creator || '', year: it.year || '',
    cover: abs(it.cover), status: it.status, rating: it.rating ?? null,
    dateFinished: it.dateFinished || null,
    dateStarted: it.dateStarted || null,
    dateAdded: it.dateAdded || null,
    extKey: row.extKey || null,
    source: it.source?.url ? { name: it.source.name, id: it.source.id, url: it.source.url } : null,
    url: (it.visibility || 'public') === 'public' ? `${origin}/item/${row.slug}/` : null,
    visibility: it.visibility || 'public',
    // Your notes as written (Markdown). Friends' sites show them as plain text, never as HTML.
    review: String(row.body || '').trim().slice(0, MAX_REVIEW),
    // Always an array, so a friend's site can tell this one takes comments.
    comments,
  };
  if (forFriend) {
    out.owned = it.owned === true;
    out.available = it.owned === true && !it.lentTo;
  }
  return out;
}

/** GET /federation/v1/shelf — public items for anyone, friends-only items too when signed by a friend. */
export async function shelfFeed(env, request) {
  let friend = null;
  if (request.headers.get('myshelf-signature')) {
    const origins = await selfOrigins(env, request.url);
    const { from } = await verifyRequest(request, '', origins, async (from) => {
      const f = await friendByUrl(env, from);
      return f?.status === 'accepted' ? f.publicKey : null;
    });
    friend = from;
  }
  const origin = await selfOrigin(env, request.url);
  const site = await getSite(env);
  const rows = (await listItemsWithKeys(env, friend ? ['public', 'friends'] : ['public'])).filter((r) => site.types.includes(r.item.type));
  const comments = await commentsByUid(env, origin);
  return {
    software: SOFTWARE, protocol: PROTOCOL, url: origin, name: site.title, owner: site.owner,
    friend: Boolean(friend),
    items: rows.map((r) => feedItem(r, origin, Boolean(friend), comments.get(r.uid) || [])),
  };
}

async function listItemsWithKeys(env, visibility) {
  const DB = await ensureSchema(env);
  const where = visibility ? `WHERE visibility IN (${visibility.map(() => '?').join(', ')})` : '';
  const { results } = await DB.prepare(`SELECT slug, uid, ext_key, data, body FROM items ${where}`).bind(...(visibility || [])).all();
  return (results || []).map((r) => ({ slug: r.slug, uid: r.uid, extKey: r.ext_key, item: JSON.parse(r.data), body: r.body || '' }));
}

// ───────── keeping friends' names current ─────────

const NAME_REFRESH_MS = 15 * 60 * 1000; // re-check each friend's name and owner at most every 15 minutes
const NAME_WAIT_MS = 3000;              // never hold a page up longer than this for it

/**
 * A friend's name and owner are first saved when you connect. If they change them later in their
 * Settings (or set them for the first time), re-read their /.well-known/myshelf and update ours.
 * Only a site still holding the key we know can change its name. Failures are ignored.
 */
export async function refreshFriendNames(env, { force = false, fetcher = fetch } = {}) {
  const DB = await ensureSchema(env);
  const cutoff = force ? '9999' : new Date(Date.now() - NAME_REFRESH_MS).toISOString();
  const { results } = await DB.prepare(`SELECT * FROM friends WHERE status IN ('accepted', 'requested', 'pending') AND updated_at < ?`).bind(cutoff).all();
  const work = Promise.all((results || []).map(async (r) => {
    let name = r.name, owner = r.owner;
    try {
      const info = await discover(r.url, fetcher);
      if (info.publicKey === r.public_key) ({ name, owner } = info);
    } catch {}
    // Stamp the check even when it failed, so a site that's down isn't retried on every page load.
    await DB.prepare('UPDATE friends SET name = ?, owner = ?, updated_at = ? WHERE id = ?').bind(str(name, 80), str(owner, 80), now(), r.id).run();
  }));
  await Promise.race([work, new Promise((r) => setTimeout(r, NAME_WAIT_MS))]).catch(() => {});
}

// ───────── admin actions (behind your token) ─────────

export async function overview(env, requestUrl) {
  await refreshFriendNames(env);
  const DB = await ensureSchema(env);
  const [me, friends, inbox] = await Promise.all([
    wellKnown(env, requestUrl),
    DB.prepare('SELECT * FROM friends ORDER BY status, name').all(),
    DB.prepare('SELECT * FROM inbox ORDER BY created_at DESC LIMIT 200').all(),
  ]);
  const byUrl = new Map((friends.results || []).map((r) => [r.url, rowToFriend(r)]));
  return {
    me: { url: me.url, name: me.name, owner: me.owner },
    friends: [...byUrl.values()].map(publicFriend),
    inbox: (inbox.results || []).map((r) => {
      const f = byUrl.get(r.from_url);
      return { id: r.id, from: r.from_url, fromName: f?.nickname || f?.owner || f?.name || r.from_url, friendId: f?.id || null, kind: r.kind, payload: JSON.parse(r.payload), status: r.status, createdAt: r.created_at };
    }),
    unread: (inbox.results || []).filter((r) => r.status === 'unread').length,
    groups: await getGroups(env),
  };
}

/** Your private nickname for a friend ('' clears it). Never sent to them or shown to visitors. */
export async function setNickname(env, id, nickname) {
  const f = await friendById(env, id);
  const nick = String(nickname ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const DB = await ensureSchema(env);
  await DB.prepare('UPDATE friends SET nickname = ? WHERE id = ?').bind(nick, f.id).run();
  return { ok: true, id: f.id, nickname: nick };
}

/** { friendUrl: nickname } for friends you've given one (for pages that swap names in when you're signed in). */
export async function nicknames(env) {
  const DB = await ensureSchema(env);
  const { results } = await DB.prepare(`SELECT url, nickname FROM friends WHERE nickname != ''`).all();
  return Object.fromEntries((results || []).map((r) => [r.url, r.nickname]));
}

export async function addFriend(env, requestUrl, url, note = '', fetcher = fetch) {
  const target = cleanSiteUrl(url);
  if ((await selfOrigins(env, requestUrl)).includes(target)) throw new HttpError(400, 'That’s your own site.');
  const existing = await friendByUrl(env, target);
  if (existing?.status === 'accepted') return { friend: publicFriend(existing), status: 'accepted' };
  if (existing?.status === 'pending') return acceptFriend(env, requestUrl, existing.id, fetcher);
  const info = await discover(target, fetcher);
  // Save first, so their automatic reply (if they'd already asked us) finds the request.
  const friend = await saveFriend(env, { ...info, id: existing?.id, status: 'requested' });
  const site = await getSite(env);
  let reply;
  try {
    ({ reply } = await send(env, requestUrl, target, 'friend-request', { name: site.title, owner: site.owner, note: str(note, 500) }, fetcher));
  } catch (err) {
    if (!existing) await deleteFriend(env, friend.id);
    throw err;
  }
  // They'd already asked us, so their site accepted on the spot.
  if (reply?.status === 'accepted') await saveFriend(env, { ...friend, status: 'accepted' });
  const current = await friendByUrl(env, target);
  return { friend: publicFriend(current), status: current.status };
}

export async function acceptFriend(env, requestUrl, id, fetcher = fetch) {
  const f = await friendById(env, id);
  if (f.status !== 'pending') throw new HttpError(400, 'There’s no request from this site to accept.');
  const site = await getSite(env);
  await send(env, requestUrl, f.url, 'friend-accept', { name: site.title, owner: site.owner }, fetcher);
  await saveFriend(env, { ...f, status: 'accepted' });
  await markRequestsDone(env, f.url, 'accepted');
  return { friend: publicFriend(await friendById(env, id)), status: 'accepted' };
}

export async function declineFriend(env, id) {
  const f = await friendById(env, id);
  await deleteFriend(env, f.id);
  await markRequestsDone(env, f.url, 'declined');
  return { ok: true };
}

export async function blockFriend(env, id) {
  const f = await friendById(env, id);
  await saveFriend(env, { ...f, status: 'blocked' });
  await markRequestsDone(env, f.url, 'declined');
  return { ok: true };
}

export async function removeFriend(env, requestUrl, id, fetcher = fetch) {
  const f = await friendById(env, id);
  await deleteFriend(env, f.id);
  // Let them know, but don't fail if their site is down.
  if (f.status === 'accepted' || f.status === 'requested') await send(env, requestUrl, f.url, 'friend-remove', {}, fetcher).catch(() => {});
  return { ok: true };
}

async function markRequestsDone(env, url, status) {
  const DB = await ensureSchema(env);
  await DB.prepare(`UPDATE inbox SET status = ? WHERE from_url = ? AND kind = 'friend-request' AND status IN ('unread', 'read')`).bind(status, url).run();
}

async function acceptedFriend(env, id) {
  const f = await friendById(env, id);
  if (f.status !== 'accepted') throw new HttpError(400, `You aren’t friends with ${f.owner || f.name || f.url} yet.`);
  return f;
}

/**
 * Recommend something to one or more friends: one of your items ({ slug }), or something you saw on a friend's
 * shelf ({ fromFriendId | fromFriendUrl, uid }) passed along to other friends, credited to them ("via").
 */
export async function recommend(env, requestUrl, { slug, fromFriendId, fromFriendUrl, uid, friendIds, note }, fetcher = fetch) {
  const ids = [...new Set(Array.isArray(friendIds) ? friendIds : [friendIds])].filter(Boolean).slice(0, 50);
  if (!ids.length) throw new HttpError(400, 'Pick at least one friend');
  let item, via;
  if (slug) {
    const row = await getItem(env, String(slug || ''));
    if (!row) throw new HttpError(404, 'Item not found');
    const origin = await selfOrigin(env, requestUrl);
    const full = (await listItemsWithKeys(env, null)).find((r) => r.slug === row.slug);
    const it = row.item;
    item = {
      title: it.title, type: it.type, creator: it.creator || '', year: it.year || '',
      cover: it.cover?.startsWith('/') ? origin + it.cover : it.cover || '',
      url: (it.visibility || 'public') === 'public' ? `${origin}/item/${row.slug}/` : '',
      extKey: full?.extKey || '',
      source: it.source?.name ? { name: it.source.name, id: it.source.id ?? '', url: it.source.url || '' } : undefined,
    };
  } else {
    // Read it from their shelf (signed, so friends-only items count), rather than trusting what the page sent.
    const src = await friendFromFields(env, { friendId: fromFriendId, friendUrl: fromFriendUrl });
    const shelf = await friendShelf(env, requestUrl, src.id, fetcher);
    const it = shelf.items.find((i) => i.uid === str(uid, 40));
    if (!it) throw new HttpError(404, 'That item isn’t on their shelf any more');
    item = {
      title: str(it.title, 200), type: str(it.type, 20), creator: str(it.creator, 200), year: str(it.year, 10),
      cover: safeUrl(it.cover), url: safeUrl(it.url), extKey: str(it.extKey, 200),
      source: it.source?.name ? { name: str(it.source.name, 40), id: str(it.source.id, 80), url: safeUrl(it.source.url) } : undefined,
    };
    via = { name: src.owner || src.name || '', url: src.url };
  }
  const results = [];
  for (const id of ids) {
    const f = await acceptedFriend(env, id);
    if (via && f.url === via.url) { results.push({ id, ok: false, error: 'That’s their own item' }); continue; }
    try {
      await send(env, requestUrl, f.url, 'recommend', { item, note: str(note, 1000), ...(via ? { via } : {}) }, fetcher);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return { results };
}

/** Ask a friend to borrow something from their shelf (uid from their shelf feed). */
export async function askToBorrow(env, requestUrl, { friendId, uid, title, note }, fetcher = fetch) {
  const f = await acceptedFriend(env, friendId);
  await send(env, requestUrl, f.url, 'borrow-request', { item: { uid: str(uid, 40), title: str(title, 200) }, note: str(note, 1000) }, fetcher);
  return { ok: true };
}

/** Answer a borrow request. Saying yes marks your item as lent to them. */
export async function replyToBorrow(env, requestUrl, { inboxId, answer, note }, fetcher = fetch) {
  const msg = await inboxById(env, inboxId);
  if (msg.kind !== 'borrow-request') throw new HttpError(400, 'That message isn’t a borrow request');
  const f = await acceptedFriend(env, (await friendByUrl(env, msg.from))?.id);
  const yes = answer === 'yes';
  await send(env, requestUrl, f.url, 'borrow-reply', { requestId: msg.id, answer: yes ? 'yes' : 'no', title: msg.payload.item?.title, note: str(note, 1000) }, fetcher);
  if (yes) {
    const row = await getItemByUid(env, msg.payload.item?.uid);
    if (row) await putItem(env, row.slug, { ...row.item, lentTo: f.owner || f.name || f.url, lentSince: new Date().toISOString().slice(0, 10) }, row.body);
  }
  await setInboxStatus(env, msg.id, yes ? 'accepted' : 'declined');
  return { ok: true };
}

/**
 * Empty the inbox, except messages still waiting on an answer: friend requests you haven't
 * accepted or declined, and borrow requests you haven't replied to.
 */
export async function clearInbox(env) {
  const DB = await ensureSchema(env);
  const res = await DB.prepare(
    `DELETE FROM inbox WHERE NOT (status IN ('unread', 'read') AND (
       kind = 'borrow-request' OR
       (kind = 'friend-request' AND from_url IN (SELECT url FROM friends WHERE status = 'pending'))))`,
  ).run();
  return { ok: true, cleared: res.meta?.changes ?? 0 };
}

/** Delete one inbox message. */
export async function deleteMessage(env, id) {
  await inboxById(env, id);
  const DB = await ensureSchema(env);
  await DB.prepare('DELETE FROM inbox WHERE id = ?').bind(String(id)).run();
  return { ok: true };
}

/** Mark every unread message as read. */
export async function markAllRead(env) {
  const DB = await ensureSchema(env);
  await DB.prepare(`UPDATE inbox SET status = 'read' WHERE status = 'unread'`).run();
  return { ok: true };
}

export async function markMessage(env, id, status) {
  if (!['read', 'unread', 'done'].includes(status)) throw new HttpError(400, 'Unknown status');
  const msg = await inboxById(env, id);
  // An answered request (accepted / declined) keeps its answer.
  if (!['read', 'unread'].includes(msg.status)) return { ok: true, status: msg.status };
  await setInboxStatus(env, id, status);
  return { ok: true };
}

/** A friend's shelf, fetched with a signed request so their friends-only items are included. */
export async function friendShelf(env, requestUrl, id, fetcher = fetch) {
  const f = await acceptedFriend(env, id);
  const [identity, from] = await Promise.all([getIdentity(env), selfOrigin(env, requestUrl)]);
  const url = f.url + SHELF_PATH;
  let res;
  try {
    res = await fetcher(url, { headers: { accept: 'application/json', ...(await signedHeaders(identity, { method: 'GET', url, from })) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, `Couldn’t reach ${f.url}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, data.error || `Their site answered ${res.status}`);
  const mine = new Set((await listItemsWithKeys(env, null)).map((r) => r.extKey).filter(Boolean));
  const hearted = new Set((await heartsSent(env, f.url)).map((h) => h.uid));
  return {
    friend: { id: f.id, url: f.url, name: f.name, owner: f.owner },
    items: (Array.isArray(data.items) ? data.items : []).slice(0, 5000).map((i) => ({
      ...i, youHave: Boolean(i.extKey && mine.has(i.extKey)), hearted: hearted.has(i.uid),
    })),
  };
}

// ───────── friends' takes (when you're about to add something) ─────────

const TAKES_TTL_MS = 5 * 60 * 1000;
let takesCache = null; // { at, key, takes } — per worker instance, so searching again is instant

/**
 * What your friends thought of things on their shelves: every item of theirs (public or friends-only) with
 * notes or a rating, as [{ friend: { url, name }, extKey, type, title, year, status, rating, review, url }].
 * Manage matches these against search results, so you see a friend's take before you add something.
 */
export async function friendTakes(env, requestUrl, { fresh = false } = {}, fetcher = fetch) {
  const DB = await ensureSchema(env);
  const { results } = await DB.prepare(`SELECT id, url, name, owner, nickname FROM friends WHERE status = 'accepted'`).all();
  const friends = results || [];
  const key = friends.map((f) => f.id).sort().join(',');
  if (!fresh && takesCache && takesCache.key === key && Date.now() - takesCache.at < TAKES_TTL_MS) return takesCache.takes;
  const shelves = await Promise.allSettled(friends.map((f) => friendShelf(env, requestUrl, f.id, fetcher)));
  const takes = [];
  shelves.forEach((r, i) => {
    if (r.status !== 'fulfilled') return; // a friend's site being down just means no takes from them
    const f = friends[i];
    for (const it of r.value.items) {
      const review = String(it.review || '').trim();
      if (!review && it.rating == null) continue;
      takes.push({
        friend: { url: f.url, name: f.nickname || f.owner || f.name || f.url.replace(/^https?:\/\//, '') },
        extKey: it.extKey || '', type: it.type, title: it.title, year: it.year || '',
        status: it.status, rating: it.rating ?? null, review: review.slice(0, 600), url: it.url || '',
      });
    }
  });
  takesCache = { at: Date.now(), key, takes };
  return takes;
}

// ───────── hearts ─────────

/** Hearts you've given: all of them, or just those on one friend's items. → [{ friendUrl, uid }] */
export async function heartsSent(env, friendUrl = null) {
  const DB = await ensureSchema(env);
  const q = friendUrl
    ? DB.prepare('SELECT friend_url, uid FROM hearts_sent WHERE friend_url = ?').bind(friendUrl)
    : DB.prepare('SELECT friend_url, uid FROM hearts_sent');
  const { results } = await q.all();
  return (results || []).map((r) => ({ friendUrl: r.friend_url, uid: r.uid }));
}

/**
 * Heart a friend's item ("I enjoyed this too"), or take the heart back with on: false.
 * The friend is picked by id (Manage → Friends) or by site address (the public Friends page).
 */
export async function heart(env, requestUrl, { friendId, friendUrl, uid, title, on = true }, fetcher = fetch) {
  let f;
  if (friendId) f = await acceptedFriend(env, friendId);
  else {
    const byUrl = await friendByUrl(env, cleanSiteUrl(friendUrl));
    if (!byUrl) throw new HttpError(404, 'Friend not found');
    f = await acceptedFriend(env, byUrl.id);
  }
  const id = str(uid, 40);
  if (!id) throw new HttpError(400, 'Which item?');
  const yes = on !== false;
  try {
    await send(env, requestUrl, f.url, 'heart', { item: { uid: id }, on: yes }, fetcher);
  } catch (err) {
    // A friend on an older copy of MyShelf doesn't know about hearts yet.
    if (/Unknown message/.test(err.message)) throw needsUpdate(f, 'hearts');
    throw err;
  }
  const DB = await ensureSchema(env);
  if (yes) {
    await DB.prepare(
      `INSERT INTO hearts_sent (friend_url, uid, title, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (friend_url, uid) DO UPDATE SET title = ?3`,
    ).bind(f.url, id, str(title, 200), now()).run();
  } else {
    await DB.prepare('DELETE FROM hearts_sent WHERE friend_url = ? AND uid = ?').bind(f.url, id).run();
  }
  return { ok: true, on: yes };
}

// ───────── public friends page ─────────

/** Accepted friends, safe to show anyone: name, owner and address. */
export async function publicFriends(env) {
  await refreshFriendNames(env);
  const DB = await ensureSchema(env);
  const { results } = await DB.prepare(`SELECT url, name, owner FROM friends WHERE status = 'accepted' ORDER BY owner, name`).all();
  return (results || []).map((r) => ({ url: r.url, name: r.name, owner: r.owner }));
}

const FEED_TTL = 600; // seconds a friend's public shelf is cached for the friends page

/** A friend's PUBLIC shelf (unsigned, so friends-only items never show), cached for a few minutes. */
async function loadPublicShelf(f, fetcher = fetch) {
  const url = f.url + SHELF_PATH;
  const cache = globalThis.caches?.default;
  try {
    let res = cache ? await cache.match(url) : null;
    if (!res) {
      res = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) return [];
      if (cache) {
        const copy = new Response(res.clone().body, res);
        copy.headers.set('cache-control', `public, max-age=${FEED_TTL}`);
        await cache.put(url, copy).catch(() => {});
      }
    }
    const data = await res.json();
    return (Array.isArray(data.items) ? data.items : []).map((i) => ({ ...i, friend: { name: f.name, owner: f.owner, url: f.url } }));
  } catch {
    return []; // a friend's site being down shouldn't break the page
  }
}

/** Forget the cached copy of a friend's public shelf (after you comment, so the page shows it). */
async function dropCachedShelf(friendUrl) {
  await globalThis.caches?.default?.delete(friendUrl + SHELF_PATH).catch(() => {});
}

/**
 * Friends' most recent PUBLIC entries, newest first. Each friend's public shelf feed is fetched
 * (unsigned, so their friends-only items never appear on this public page) and cached for a few minutes.
 */
export async function friendsFeed(env, { limit = 30, fetcher = fetch } = {}) {
  const friends = await publicFriends(env);
  const all = (await Promise.all(friends.map((f) => loadPublicShelf(f, fetcher)))).flat();
  const when = (i) => (i.status === 'finished' && i.dateFinished) || i.dateStarted || i.dateAdded || '';
  return {
    friends,
    items: all.filter((i) => when(i) && i.title).sort((a, b) => when(b).localeCompare(when(a))).slice(0, limit).map((i) => ({ ...i, date: when(i) })),
  };
}

/** One friend's public shelf, for the shelf viewer on the public Friends page. Only accepted friends. */
export async function publicFriendShelf(env, friendUrl, fetcher = fetch) {
  const url = cleanSiteUrl(friendUrl);
  const f = (await publicFriends(env)).find((x) => x.url === url);
  if (!f) throw new HttpError(404, 'Friend not found');
  return { friend: f, items: (await loadPublicShelf(f, fetcher)).slice(0, 5000).map(({ friend, ...i }) => i) };
}

// ───────── comments ─────────
// Comments live on the site of the person whose item it is. Friends send theirs as signed 'comment'
// messages; your own replies are stored directly. Everyone who can see the item sees its comments.

/** All comments on your items: Map uid → [{ id, author, authorUrl, text, createdAt }], oldest first. */
async function commentsByUid(env, origin, uid = null) {
  const DB = await ensureSchema(env);
  const site = await getSite(env);
  const q = uid
    ? DB.prepare('SELECT * FROM comments WHERE uid = ? ORDER BY created_at').bind(uid)
    : DB.prepare('SELECT * FROM comments ORDER BY created_at');
  const [{ results }, { results: fr }] = await Promise.all([q.all(), DB.prepare('SELECT url, name, owner FROM friends').all()]);
  const names = new Map((fr || []).map((f) => [f.url, f.owner || f.name]));
  const out = new Map();
  for (const r of results || []) {
    const mine = !r.from_url;
    const c = {
      id: r.id,
      author: mine ? site.owner || site.title : names.get(r.from_url) || r.author || r.from_url.replace(/^https?:\/\//, ''),
      authorUrl: mine ? origin : r.from_url,
      text: r.text,
      createdAt: r.created_at,
    };
    if (!out.has(r.uid)) out.set(r.uid, []);
    out.get(r.uid).push(c);
  }
  return out;
}

/** Comments on one of your items (for its page), by slug. */
export async function itemComments(env, requestUrl, slug) {
  const row = await getItem(env, String(slug || ''));
  if (!row) return [];
  const origin = await selfOrigin(env, requestUrl);
  return (await commentsByUid(env, origin, row.uid)).get(row.uid) || [];
}

// ───────── @mentions ─────────

async function mentionableFriends(env) {
  const DB = await ensureSchema(env);
  const { results } = await DB.prepare(`SELECT url, name, owner, nickname FROM friends WHERE status = 'accepted'`).all();
  return results || [];
}

/** Plain @names in text that match a friend become @[Name](their site). */
export async function linkMentions(env, text) {
  if (!String(text || '').includes('@')) return String(text || '');
  return resolveMentions(text, await mentionableFriends(env));
}

/** What a mention note says about one of your items. */
function itemRef(row, origin, anchor = '') {
  const it = row.item;
  const pub = (it.visibility || 'public') === 'public';
  return {
    uid: row.uid, title: it.title, type: it.type,
    cover: it.cover?.startsWith('/') ? origin + it.cover : it.cover || '',
    url: pub ? `${origin}/item/${row.slug}/${anchor}` : origin,
  };
}

/**
 * Tell friends tagged in text (only those not tagged in `before`, so editing notes doesn't notify twice).
 * skip: site addresses that already hear about this another way. Unreachable or older sites are skipped quietly.
 */
async function sendMentions(env, requestUrl, { text, before = '', where, item, owner = null, skip = [] }, fetcher = fetch) {
  const had = new Set(mentionedUrls(before));
  const friends = new Set((await mentionableFriends(env)).map((f) => f.url));
  const self = await selfOrigins(env, requestUrl);
  const targets = mentionedUrls(text).filter((u) => !had.has(u) && friends.has(u) && !self.includes(u) && !skip.includes(u));
  const excerpt = str(text, 400);
  const results = await Promise.allSettled(targets.map((url) =>
    send(env, requestUrl, url, 'mention', { where, text: excerpt, item, ...(owner ? { owner } : {}) }, fetcher)));
  return targets.filter((_, i) => results[i].status === 'fulfilled');
}

/** After saving notes: notify newly tagged friends (not for "Only me" items, which they couldn't open). */
export async function notesMentions(env, requestUrl, { slug, body, before }, fetcher = fetch) {
  const row = await getItem(env, String(slug || ''));
  if (!row || row.item.visibility === 'private' || !mentionedUrls(body).length) return [];
  const origin = await selfOrigin(env, requestUrl);
  return sendMentions(env, requestUrl, { text: body, before, where: 'notes', item: itemRef(row, origin) }, fetcher);
}

/** Reply on one of your own items. */
export async function commentOwn(env, requestUrl, { slug, text }, fetcher = fetch) {
  const row = await getItem(env, String(slug || ''));
  if (!row) throw new HttpError(404, 'Item not found');
  const t = str(await linkMentions(env, text), MAX_COMMENT);
  if (!t) throw new HttpError(400, 'Write something first.');
  const DB = await ensureSchema(env);
  const id = crypto.randomUUID();
  await DB.prepare(`INSERT INTO comments (id, uid, from_url, author, text, created_at) VALUES (?, ?, '', '', ?, ?)`).bind(id, row.uid, t, now()).run();
  const comment = (await itemComments(env, requestUrl, row.slug)).find((c) => c.id === id);
  await notifyThread(env, requestUrl, row, comment, fetcher);
  if (row.item.visibility !== 'private') {
    const origin = await selfOrigin(env, requestUrl);
    await sendMentions(env, requestUrl, { text: t, where: 'comment', item: itemRef(row, origin, '#comments') }, fetcher).catch(() => {});
  }
  return { comment };
}

/**
 * Someone added a comment on one of your items: tell every friend who has commented there before (except
 * whoever just wrote). You (the owner) get the regular inbox note instead. Unreachable sites are skipped.
 */
async function notifyThread(env, requestUrl, row, comment, fetcher = fetch) {
  const DB = await ensureSchema(env);
  const { results } = await DB.prepare(`SELECT DISTINCT from_url FROM comments WHERE uid = ? AND from_url != ''`).bind(row.uid).all();
  const targets = (results || []).map((r) => r.from_url).filter((u) => u !== comment.authorUrl);
  if (!targets.length) return;
  const origin = await selfOrigin(env, requestUrl);
  const it = row.item;
  const pub = (it.visibility || 'public') === 'public';
  const item = {
    uid: row.uid, title: it.title, type: it.type,
    cover: it.cover?.startsWith('/') ? origin + it.cover : it.cover || '',
    url: pub ? `${origin}/item/${row.slug}/#comments` : origin,
  };
  await Promise.allSettled(targets.map(async (url) => {
    const f = await friendByUrl(env, url);
    if (f?.status !== 'accepted') return; // only friends get notices
    await send(env, requestUrl, url, 'comment-reply', { item, commentId: comment.id, author: comment.author, authorUrl: comment.authorUrl, text: comment.text }, fetcher);
  }));
}

/** Delete any comment on your items (yours or a friend's). */
export async function deleteComment(env, id) {
  const DB = await ensureSchema(env);
  const cid = str(id, 40);
  await DB.batch([
    DB.prepare('DELETE FROM comments WHERE id = ?').bind(cid),
    DB.prepare(`DELETE FROM inbox WHERE id = ? AND kind = 'comment'`).bind(cid),
  ]);
  return { ok: true };
}

async function friendFromFields(env, { friendId, friendUrl }) {
  if (friendId) return acceptedFriend(env, friendId);
  const byUrl = await friendByUrl(env, cleanSiteUrl(friendUrl));
  if (!byUrl) throw new HttpError(404, 'Friend not found');
  return acceptedFriend(env, byUrl.id);
}

const needsUpdate = (f, what) => {
  const who = f.owner || f.name;
  return new HttpError(502, `${who ? `${who}’s` : 'Their'} MyShelf needs an update before it can get ${what}.`);
};

/**
 * Comment on a friend's item (uid from their shelf feed). item: optional { title, type, cover, url } from the
 * page, used only to tell anyone you @mention what you commented on.
 */
export async function commentOnFriend(env, requestUrl, { friendId, friendUrl, uid, text, item = null }, fetcher = fetch) {
  const f = await friendFromFields(env, { friendId, friendUrl });
  const t = str(await linkMentions(env, text), MAX_COMMENT);
  if (!t) throw new HttpError(400, 'Write something first.');
  let reply;
  try {
    ({ reply } = await send(env, requestUrl, f.url, 'comment', { item: { uid: str(uid, 40) }, text: t }, fetcher));
  } catch (err) {
    if (/Unknown message/.test(err.message)) throw needsUpdate(f, 'comments');
    throw err;
  }
  await dropCachedShelf(f.url);
  // Tagged friends hear about it (the item's owner already gets the comment itself).
  if (item && typeof item === 'object' && str(item.title, 200)) {
    const ref = { uid: str(uid, 40), title: str(item.title, 200), type: str(item.type, 20), cover: safeUrl(item.cover), url: safeUrl(item.url) || f.url };
    await sendMentions(env, requestUrl, { text: t, where: 'comment', item: ref, owner: { name: f.owner || f.name || '', url: f.url }, skip: [f.url] }, fetcher).catch(() => {});
  }
  return { comment: reply.comment };
}

/** Take back a comment you left on a friend's item. */
export async function deleteFriendComment(env, requestUrl, { friendId, friendUrl, commentId }, fetcher = fetch) {
  const f = await friendFromFields(env, { friendId, friendUrl });
  await send(env, requestUrl, f.url, 'comment-delete', { commentId: str(commentId, 40) }, fetcher);
  await dropCachedShelf(f.url);
  return { ok: true };
}

// ───────── friend groups ─────────
// Your own labels for sets of friends (e.g. "Board game night"), to filter the Friends page and to pick
// everyone in a group when recommending. Private: stored only on your site, never sent to anyone.

const MAX_GROUPS = 50;

/** [{ id, name, members: [friendUrl] }], members limited to current friends. */
export async function getGroups(env) {
  const DB = await ensureSchema(env);
  const { results } = await DB.prepare(`SELECT url FROM friends WHERE status = 'accepted'`).all();
  const ok = new Set((results || []).map((r) => r.url));
  const groups = await getSetting(env, 'friendGroups', []);
  return (Array.isArray(groups) ? groups : []).map((g) => ({ ...g, members: (g.members || []).filter((u) => ok.has(u)) }));
}

export async function saveGroups(env, groups) {
  if (!Array.isArray(groups)) throw new HttpError(400, 'groups must be a list');
  const seen = new Set();
  const clean = groups.slice(0, MAX_GROUPS).map((g) => {
    const name = str(g?.name, 60);
    if (!name) throw new HttpError(400, 'Every group needs a name');
    let id = /^[a-z0-9-]{1,40}$/.test(g.id || '') ? g.id : crypto.randomUUID().slice(0, 8);
    while (seen.has(id)) id = crypto.randomUUID().slice(0, 8);
    seen.add(id);
    const members = [...new Set((Array.isArray(g.members) ? g.members : []).map((u) => { try { return cleanSiteUrl(u); } catch { return null; } }).filter(Boolean))];
    return { id, name, members };
  });
  await setSetting(env, 'friendGroups', clean);
  return { groups: await getGroups(env) };
}
