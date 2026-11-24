// Backups: download everything as one JSON file, and restore it into any MyShelf site.
// Restoring is also how you move to a new site (for example from the old Pages version to a Worker):
// restore the backup on the new site while the old one is still up, and the covers are copied across
// from the old site's address, a few at a time.
import { HttpError } from './util.js';
import { listItems, putItems, setSetting, getItemByUid } from './db.js';
import { getCollections, getArrangements, cleanCollections, getLayouts, cleanLayout } from './settings.js';
import { getSite, saveSite } from './site.js';
import { getDecor, cleanDecor } from './decor.js';
import { normalizeItem } from './markdown.js';
import { assertSlug } from './paths.js';
import { storedCoverName, IMG_PREFIX, EXT, MIME, aspectOf } from './covers.js';

export async function exportBackup(env, origin) {
  const [items, collections, arrangements, site, decor, layouts] = await Promise.all([
    listItems(env), getCollections(env), getArrangements(env), getSite(env), getDecor(env), getLayouts(env),
  ]);
  return {
    format: 'myshelf-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    origin, // where the covers can be downloaded from while this site is still up
    site,
    items: items.sort((a, b) => a.slug.localeCompare(b.slug)),
    collections,
    arrangements,
    layouts,
    decor,
  };
}

/** Copy items, collections, shelf orders and site settings from a backup. Existing items with the same slug are replaced. */
export async function restoreBackup(env, data) {
  if (!data || !Array.isArray(data.items)) throw new HttpError(400, 'That doesn’t look like a MyShelf backup file.');
  const rows = [];
  for (const r of data.items) {
    if (!r?.slug || !r.item?.title || !r.item?.type) continue;
    const slug = assertSlug(String(r.slug));
    let uid = typeof r.uid === 'string' && /^[0-9a-f-]{36}$/i.test(r.uid) ? r.uid.toLowerCase() : null;
    if (uid) {
      const other = await getItemByUid(env, uid);
      if (other && other.slug !== slug) uid = null; // already used by a different item here: give it a new one
    }
    rows.push({ slug, uid, item: normalizeItem(r.item), body: String(r.body || '') });
  }
  for (let i = 0; i < rows.length; i += 50) await putItems(env, rows.slice(i, i + 50));
  if (Array.isArray(data.collections)) await setSetting(env, 'collections', cleanCollections(data.collections));
  if (data.arrangements && typeof data.arrangements === 'object') await setSetting(env, 'arrangements', data.arrangements);
  if (data.layouts && typeof data.layouts === 'object') {
    await setSetting(env, 'layouts', Object.fromEntries(Object.entries(data.layouts).filter(([k]) => /^[a-z]+$/.test(k)).map(([k, v]) => [k, cleanLayout(v)])));
  }
  if (data.site && typeof data.site === 'object') await saveSite(env, data.site);
  // Decorations: the list now, the images with the covers (restoreCovers).
  if (Array.isArray(data.decor)) await setSetting(env, 'decor', cleanDecor(data.decor));
  return { items: rows.length };
}

function localCoverPaths(item) {
  return [item.cover, ...(item.expansions || []).map((x) => x.cover)]
    .filter((c) => storedCoverName(c) || /^\/covers\/[a-z0-9][a-z0-9.-]*$/i.test(c || ''));
}

export function cleanOrigin(value) {
  let u;
  try { u = new URL(String(value || '')); } catch { throw new HttpError(400, 'The old site address isn’t a valid URL.'); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new HttpError(400, 'The old site address must start with https://');
  return u.origin;
}

/**
 * Copy the next few covers that this site doesn't have from the old site.
 * Call with offset 0, then the returned `next`, until `done`.
 */
export async function restoreCovers(env, { origin, offset = 0, limit = 8 }, fetcher = fetch) {
  origin = cleanOrigin(origin);
  const items = (await listItems(env)).sort((a, b) => a.slug.localeCompare(b.slug));
  const todo = [
    ...items.flatMap((r) => localCoverPaths(r.item).map((path) => ({ row: r, path }))),
    ...(await getDecor(env)).map((d) => ({ row: null, path: d.image })), // shelf decorations (always /img/ paths)
  ];
  const slice = todo.slice(offset, offset + limit);
  let copied = 0, failed = 0;
  const changed = new Map();
  for (const { row, path } of slice) {
    const stored = storedCoverName(path);
    const name = stored || path.split('/').pop().toLowerCase();
    const have = await env.COVERS.getWithMetadata(name, { type: 'arrayBuffer' });
    if (have?.value) {
      if (!stored) changed.set(row.slug, rewrite(changed.get(row.slug) || row, path, IMG_PREFIX + name, null));
      continue;
    }
    try {
      const res = await fetcher(origin + path);
      const ext = name.split('.').pop();
      const type = (res.headers.get('content-type') || '').split(';')[0].trim() || MIME[ext];
      const buf = res.ok ? await res.arrayBuffer() : null;
      if (!buf?.byteLength || !EXT[type]) throw new Error('not an image');
      await env.COVERS.put(name, buf, { metadata: { type } });
      copied++;
      if (!stored) changed.set(row.slug, rewrite(changed.get(row.slug) || row, path, IMG_PREFIX + name, aspectOf(buf)));
    } catch {
      failed++;
    }
  }
  if (changed.size) await putItems(env, [...changed.values()]);
  const next = offset + slice.length;
  return { total: todo.length, next, done: next >= todo.length, copied, failed };
}

// Old "/covers/x.jpg" paths become "/img/x.jpg" once the image is in KV.
function rewrite(row, from, to, aspect) {
  const item = { ...row.item };
  if (item.cover === from) { item.cover = to; if (aspect) item.coverAspect = aspect; }
  if (item.expansions) item.expansions = item.expansions.map((x) => (x.cover === from ? { ...x, cover: to } : x));
  return { slug: row.slug, uid: row.uid, item, body: row.body };
}
