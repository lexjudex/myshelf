// Finished public pages, kept in D1 so they aren't built again on every visit.
//
// Building a page (reading every item, sorting the shelves, drawing a few hundred shelf items) takes more CPU than
// the free Workers plan allows a request (10 ms), so busy moments ended in "Error 1102: Worker exceeded resource
// limits". Public pages look the same for every visitor (anything only you see is added by the browser after you
// sign in), so the finished HTML is kept and served as is. Any change to the site (every POST, PUT or DELETE,
// including friends' messages arriving) clears it, a new deploy starts fresh, and kept pages are rebuilt after a
// few hours anyway, so
// shelves like "Recently Finished" that depend on today's date stay right.
import { ensureSchema, hasDb } from './db.js';
import { VERSION, COMMIT, BUILT } from './version.js';

// Kept pages name this build's script and style files (/_astro/…, which change with every deploy), so a page is
// only reused by the build that made it. Pages kept by an older build are skipped and cleared out.
const BUILD = [VERSION, COMMIT, BUILT].filter(Boolean).join(':') || 'dev';

const MAX_AGE = 6 * 3600_000;
const MAX_HTML = 1_500_000; // D1 rows top out at 2 MB
// Public pages only. Not Manage, the API, covers, federation or the Friends page (friends' shelves change on their sites).
const CACHEABLE = /^\/(?:$|journal\/?$|shelf\/[^/]+\/?$|type\/[^/]+(?:\/[^/]+)?\/?$|item\/[^/]+\/?$)/;

export function isCacheable(request, url) {
  return request.method === 'GET' && !url.search && !request.headers.has('authorization') && CACHEABLE.test(url.pathname);
}

const key = (url) => `${BUILD}|${url.pathname.replace(/\/?$/, '/')}`;
let swept = false;

/** The kept page for this URL, or null. */
export async function cachedPage(env, url) {
  if (!hasDb(env)) return null;
  try {
    const DB = await ensureSchema(env);
    const row = await DB.prepare('SELECT html, created_at FROM page_cache WHERE path = ?').bind(key(url)).first();
    if (!row || Date.now() - Date.parse(row.created_at) > MAX_AGE) return null;
    return new Response(row.html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-myshelf-cache': 'hit' },
    });
  } catch {
    return null; // never let the cache break a page
  }
}

/** Keep a freshly built page (only complete 200 HTML responses). */
export async function keepPage(env, url, response) {
  if (!hasDb(env) || response.status !== 200 || !/text\/html/.test(response.headers.get('content-type') || '')) return;
  try {
    const html = await response.text();
    if (html.length > MAX_HTML) return;
    const DB = await ensureSchema(env);
    if (!swept) {
      swept = true;
      await DB.prepare('DELETE FROM page_cache WHERE substr(path, 1, ?1) <> ?2').bind(BUILD.length + 1, `${BUILD}|`).run();
    }
    await DB.prepare(
      'INSERT INTO page_cache (path, html, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (path) DO UPDATE SET html = ?2, created_at = ?3',
    ).bind(key(url), html, new Date().toISOString()).run();
  } catch { /* ignore */ }
}

/** Something changed: every kept page is out of date. */
export async function clearPages(env) {
  if (!hasDb(env)) return;
  try {
    const DB = await ensureSchema(env);
    await DB.prepare('DELETE FROM page_cache').run();
  } catch { /* ignore */ }
}
