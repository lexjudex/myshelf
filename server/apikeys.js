// API keys you paste in Manage → Settings → API keys, so nobody has to open the Cloudflare dashboard for them.
//
// Where they live: one row in the D1 settings table ('api_keys'), encrypted with AES-GCM. The encryption key is
// made automatically the first time you save and is kept in the KV namespace (COVERS) under a name /img/ can never
// serve. So a copy of the database on its own (a D1 export, say) doesn't give your keys away. Backups don't include
// them either: a backup is for your shelf, not your passwords.
//
// Which one wins: a key saved here is used first; if there isn't one, the Worker secret with the same name is used.
// So sites set up with Worker secrets keep working as they are. The admin page never gets a saved key back, only
// whether one is set and its last four characters.
import { HttpError, userAgent } from './util.js';
import { getSetting, setSetting, hasDb } from './db.js';

// One group per service; `types` are the media it serves (so turned-off media can say so).
export const KEY_GROUPS = [
  // First: lets Settings → Updates install new versions with one click (setup step 4 in the README).
  { id: 'github', label: 'Updates from GitHub (recommended)', types: [], fields: [
    { name: 'GITHUB_TOKEN', label: 'GitHub token' },
  ] },
  { id: 'tmdb', label: 'Movies & TV (TMDB)', types: ['movie', 'tv'], fields: [
    { name: 'TMDB_TOKEN', label: 'API Read Access Token' },
  ] },
  { id: 'igdb', label: 'Video games (IGDB, through Twitch)', types: ['videogame'], fields: [
    { name: 'TWITCH_CLIENT_ID', label: 'Client ID' },
    { name: 'TWITCH_CLIENT_SECRET', label: 'Client Secret' },
  ] },
  { id: 'bgg', label: 'Board games (BoardGameGeek)', types: ['boardgame'], fields: [
    { name: 'BGG_TOKEN', label: 'Application token' },
  ] },
  { id: 'spotify', label: 'Music (Spotify, optional)', types: ['music'], fields: [
    { name: 'SPOTIFY_CLIENT_ID', label: 'Client ID' },
    { name: 'SPOTIFY_CLIENT_SECRET', label: 'Client Secret' },
  ] },
  { id: 'googlebooks', label: 'Books (Google Books, optional)', types: ['book'], fields: [
    { name: 'GOOGLE_BOOKS_KEY', label: 'API key' },
  ] },
  { id: 'youtube', label: 'YouTube search (optional)', types: ['video'], fields: [
    { name: 'YOUTUBE_API_KEY', label: 'API key (only if it’s not your Google Books key)' },
  ] },
  { id: 'contact', label: 'Contact email (optional)', types: [], fields: [
    { name: 'CONTACT_EMAIL', label: 'Email', plain: true },
  ] },
];

const FIELDS = KEY_GROUPS.flatMap((g) => g.fields);
export const KEY_NAMES = FIELDS.map((f) => f.name);
const isPlain = (name) => Boolean(FIELDS.find((f) => f.name === name)?.plain);

const SETTING = 'api_keys';
const KV_NAME = '_myshelf/api-keys-cipher'; // starts with "_" and has a "/", so serveCover's name check rejects it
const MAX_LEN = 600;

// ───────── encryption ─────────
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function cipherKey(env, { create = false } = {}) {
  if (!env?.COVERS) throw new HttpError(500, 'Saving keys here needs the KV namespace binding named COVERS. Check wrangler.jsonc, then redeploy.');
  const { value } = await env.COVERS.getWithMetadata(KV_NAME, { type: 'arrayBuffer' });
  let raw = value ? new Uint8Array(value) : null;
  if (!raw || raw.byteLength !== 32) {
    if (!create) return null;
    raw = crypto.getRandomValues(new Uint8Array(32));
    await env.COVERS.put(KV_NAME, raw.buffer, { metadata: { type: 'application/octet-stream' } });
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env, obj) {
  const key = await cipherKey(env, { create: true });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, iv: b64(iv), data: b64(data) };
}

async function decrypt(env, box) {
  if (!box?.data) return {};
  const key = await cipherKey(env);
  if (!key) throw new Error('The encryption key for saved API keys is missing from KV.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
  const obj = JSON.parse(new TextDecoder().decode(plain));
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => KEY_NAMES.includes(k) && typeof v === 'string' && v));
}

// ───────── reading (cached per isolate for a short while, so /api/* doesn't hit D1 + KV every time) ─────────
const TTL = 30_000;
let cache = null; // { db, at, keys, error }

async function readStored(env) {
  if (!hasDb(env)) return { keys: {}, error: null };
  if (cache && cache.db === env.DB && Date.now() - cache.at < TTL) return cache;
  let keys = {}, error = null;
  try {
    keys = await decrypt(env, await getSetting(env, SETTING, null));
  } catch (err) {
    console.error('Saved API keys could not be read:', err);
    error = 'Your saved API keys couldn’t be read (the encryption key in KV may have been deleted). Paste them again.';
  }
  cache = { db: env.DB, at: Date.now(), keys, error };
  return cache;
}

const RAW = Symbol('worker env'); // the env before saved keys were laid over it
const rawEnv = (env) => env?.[RAW] || env;

/** The Worker's env with keys saved here laid over the Worker secrets. Bindings (DB, COVERS, …) are untouched. */
export async function withStoredKeys(env) {
  env = rawEnv(env);
  const { keys } = await readStored(env);
  if (!Object.keys(keys).length) return env;
  return { ...env, ...keys, [RAW]: env };
}

const tail = (v) => (v.length >= 12 ? v.slice(-4) : '');

/** What the admin page shows: for each key, whether it's saved here or a Worker secret, and never the key itself. */
export async function keyStatus(env) {
  env = rawEnv(env);
  const { keys, error } = await readStored(env);
  return {
    error,
    groups: KEY_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      types: g.types,
      testable: Boolean(TESTS[g.id]),
      fields: g.fields.map((f) => {
        const saved = keys[f.name] || '';
        const secret = typeof env[f.name] === 'string' ? env[f.name] : '';
        const out = { name: f.name, label: f.label, plain: Boolean(f.plain), saved: Boolean(saved), secret: Boolean(secret) };
        const active = saved || secret;
        if (active) out.hint = f.plain ? active : tail(active);
        return out;
      }),
    })),
  };
}

/** changes: { NAME: "new value" } to set, { NAME: null } (or "") to remove. Names not listed are kept. */
export async function saveKeys(env, changes) {
  env = rawEnv(env);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new HttpError(400, 'Send { keys: { NAME: value } }');
  const { keys: current, error } = await readStored(env);
  const next = error ? {} : { ...current };
  for (const [name, raw] of Object.entries(changes)) {
    if (!KEY_NAMES.includes(name)) throw new HttpError(400, `Unknown key: ${name}`);
    const value = raw == null ? '' : String(raw).trim();
    if (value.length > MAX_LEN) throw new HttpError(400, `${name} is too long.`);
    if (/\s/.test(value) && !isPlain(name)) throw new HttpError(400, `${name} has spaces in it. Copy just the key.`);
    if (value) next[name] = value; else delete next[name];
  }
  await setSetting(env, SETTING, Object.keys(next).length ? await encrypt(env, next) : {});
  cache = null;
  return keyStatus(env);
}

// ───────── "Test" buttons: one cheap, read-only call per service ─────────
async function check(res, what) {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  const hint = res.status === 401 || res.status === 403 ? ' The key was rejected: check you copied all of it.' : '';
  throw new HttpError(502, `${what} said ${res.status}.${hint}${hint ? '' : ` ${body.slice(0, 160)}`}`);
}

const need = (env, ...names) => {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new HttpError(400, `Add ${missing.join(' and ')} first.`);
};

const TESTS = {
  async tmdb(env, f) {
    need(env, 'TMDB_TOKEN');
    const t = env.TMDB_TOKEN;
    const long = t.length > 40;
    const res = await f(`https://api.themoviedb.org/3/configuration${long ? '' : `?api_key=${encodeURIComponent(t)}`}`, {
      headers: { accept: 'application/json', ...(long ? { authorization: `Bearer ${t}` } : {}) },
    });
    await check(res, 'TMDB');
    return 'TMDB accepted your token.';
  },
  async igdb(env, f) {
    need(env, 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET');
    const res = await f(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(env.TWITCH_CLIENT_ID)}&client_secret=${encodeURIComponent(env.TWITCH_CLIENT_SECRET)}&grant_type=client_credentials`, { method: 'POST' });
    await check(res, 'Twitch');
    return 'Twitch accepted your Client ID and Secret.';
  },
  async bgg(env, f) {
    need(env, 'BGG_TOKEN');
    const res = await f('https://boardgamegeek.com/xmlapi2/thing?id=13', { headers: { 'user-agent': userAgent(env), authorization: `Bearer ${env.BGG_TOKEN}` } });
    if (res.status !== 202) await check(res, 'BoardGameGeek');
    return 'BoardGameGeek accepted your token.';
  },
  async spotify(env, f) {
    need(env, 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET');
    const res = await f('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    await check(res, 'Spotify');
    return 'Spotify accepted your Client ID and Secret.';
  },
  async googlebooks(env, f) {
    need(env, 'GOOGLE_BOOKS_KEY');
    const res = await f(`https://www.googleapis.com/books/v1/volumes?q=dune&maxResults=1&key=${encodeURIComponent(env.GOOGLE_BOOKS_KEY)}`);
    await check(res, 'Google Books');
    return 'Google Books accepted your key.';
  },
  async youtube(env, f) {
    const key = env.YOUTUBE_API_KEY || env.GOOGLE_BOOKS_KEY;
    if (!key) throw new HttpError(400, 'Add YOUTUBE_API_KEY (or a Google Books key with YouTube Data API v3 switched on) first.');
    const res = await f(`https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw&key=${encodeURIComponent(key)}`);
    if (res.status === 403) throw new HttpError(502, `YouTube refused the ${env.YOUTUBE_API_KEY ? 'YouTube' : 'Google Books'} key. Switch on YouTube Data API v3 for it in Google Cloud.`);
    await check(res, 'YouTube');
    return `YouTube search works (using your ${env.YOUTUBE_API_KEY ? 'YouTube' : 'Google Books'} key).`;
  },
  async github(env, f) {
    need(env, 'GITHUB_TOKEN');
    const res = await f('https://api.github.com/user', { headers: { accept: 'application/vnd.github+json', 'user-agent': 'MyShelf', authorization: `Bearer ${env.GITHUB_TOKEN}` } });
    await check(res, 'GitHub');
    const who = (await res.json().catch(() => ({}))).login;
    return `GitHub accepted your token${who ? ` (signed in as ${who})` : ''}.`;
  },
};

/** Try the keys for one service, using whatever is in effect (saved here or the Worker secret). */
export async function testKeys(env, id, fetcher = fetch) {
  const run = TESTS[id];
  if (!run) throw new HttpError(400, 'Nothing to test for that.');
  const merged = await withStoredKeys(env);
  return { ok: true, message: await run(merged, fetcher) };
}

/** For tests. */
export const _resetKeyCache = () => { cache = null; };
