import { HttpError, slugify, TYPE_KEYS } from './util.js';
import { normalizeItem } from './markdown.js';
import { assertSlug } from './paths.js';
import { getItem, itemExists, listItems, putItem, putItems, removeItem } from './db.js';
import { downloadImage, storeCover, deleteCover, storedCoverName, aspectOf } from './covers.js';
import { cleanExpansions, storeExpansionCovers, deleteExpansionCovers } from './expansions.js';

async function uniqueSlug(env, base) {
  let slug = base;
  for (let n = 2; n < 50; n++) {
    if (!(await itemExists(env, slug))) return slug;
    slug = `${base}-${n}`;
  }
  throw new HttpError(409, 'Could not find a free slug');
}

/**
 * Create or update an item.
 * payload: { slug?: string (existing item), item: {...fields}, body: string }
 * If item.cover is a remote URL, the image is downloaded into cover storage.
 * Saves go live immediately.
 */
export async function saveItem(env, payload) {
  const raw = payload?.item;
  if (!raw || !raw.title || !TYPE_KEYS.includes(raw.type)) throw new HttpError(400, 'Item needs a title and a valid type');
  if (!['want', 'in-progress', 'finished', 'abandoned'].includes(raw.status)) throw new HttpError(400, 'Choose a status before saving');
  const item = normalizeItem(raw);
  delete item.body;
  const isEdit = Boolean(payload.slug);

  let previous = null;
  let prevBody = '';
  let slug;
  if (isEdit) {
    slug = assertSlug(payload.slug);
    const row = await getItem(env, slug);
    if (!row) throw new HttpError(404, 'Item to update was not found');
    previous = row.item;
    prevBody = String(row.body || '').trim();
    item.dateAdded = item.dateAdded || previous.dateAdded || null;
  } else {
    slug = await uniqueSlug(env, slugify(`${item.type} ${item.title} ${item.year || ''}`));
    item.dateAdded = item.dateAdded || new Date().toISOString().slice(0, 10);
  }
  for (const [k, v] of Object.entries(item)) if (v == null) delete item[k];

  // Remember when the notes themselves last changed (the Journal can sort by it). Other edits don't count.
  const body = String(payload.body || '').trim();
  if (body && body !== prevBody) item.notesEditedAt = new Date().toISOString();
  else if (!body) delete item.notesEditedAt;
  else if (previous?.notesEditedAt) item.notesEditedAt = previous.notesEditedAt;

  const oldStored = storedCoverName(previous?.cover) ? previous.cover : null;
  let removeOld = false;
  // item.spine: a small copy of the cover for the shelf spines (see server/spines.js). The server manages it:
  // it stays while the cover stays, and goes (to be made again) when the cover changes.
  const oldSpine = storedCoverName(previous?.spine) ? previous.spine : null;
  delete item.spine;

  if (/^https?:\/\//i.test(item.cover || '')) {
    const img = await downloadImage(item.cover);
    if (img) {
      item.cover = await storeCover(env, slug, img);
      item.coverAspect = aspectOf(img.buf);
      removeOld = Boolean(oldStored);
    } else {
      // Download failed: keep the remote URL (hotlinked) rather than losing the cover.
      delete item.coverAspect;
    }
  } else if (!item.cover) {
    delete item.coverAspect;
    removeOld = Boolean(oldStored);
  } else if (previous && item.cover === previous.cover) {
    if (previous.coverAspect) item.coverAspect = previous.coverAspect;
    if (oldSpine) item.spine = oldSpine;
  } else {
    delete item.coverAspect;
  }
  if (item.coverAspect == null) delete item.coverAspect;

  // Expansions live inside the base game's entry (board games only).
  item.expansions = item.type === 'boardgame' ? cleanExpansions(raw.expansions) : [];
  const unusedExpansionCovers = await storeExpansionCovers(env, slug, item.expansions, previous?.expansions);
  if (!item.expansions.length) delete item.expansions;

  // Only one entry can be featured ("My Thoughts" on the home page): featuring this one un-features the rest.
  if (raw.featured === true || raw.featured === 'true') {
    item.featured = true;
    const others = (await listItems(env))
      .filter((r) => r.slug !== slug && r.item.featured)
      .map((r) => { const { featured, ...rest } = r.item; return { slug: r.slug, item: rest, body: r.body }; });
    await putItems(env, [{ slug, item, body: payload.body }, ...others]);
  } else {
    delete item.featured;
    await putItem(env, slug, item, payload.body);
  }
  if (removeOld) await deleteCover(env, oldStored).catch(() => {});
  if (oldSpine && item.spine !== oldSpine) await deleteCover(env, oldSpine).catch(() => {});
  await deleteExpansionCovers(env, unusedExpansionCovers);
  return { slug, item };
}

/** Take items out of a hand-picked collection (the red ✕ in the arrange dialog). Other fields are untouched. */
export async function removeFromCollection(env, collection, slugs) {
  if (!collection || typeof collection !== 'string') throw new HttpError(400, 'Which collection?');
  const wanted = new Set((Array.isArray(slugs) ? slugs : []).map(String));
  if (!wanted.size) return { removed: [] };
  const rows = (await listItems(env))
    .filter((r) => wanted.has(r.slug) && (r.item.collections || []).includes(collection))
    .map((r) => ({ slug: r.slug, item: { ...r.item, collections: r.item.collections.filter((c) => c !== collection) }, body: r.body }));
  await putItems(env, rows);
  return { removed: rows.map((r) => r.slug) };
}

export async function deleteItem(env, slug) {
  assertSlug(slug);
  const row = await getItem(env, slug);
  if (!row) throw new HttpError(404, 'Item not found');
  await removeItem(env, slug);
  await deleteCover(env, row.item.cover).catch(() => {});
  await deleteCover(env, row.item.spine).catch(() => {});
  await deleteExpansionCovers(env, (row.item.expansions || []).map((x) => x.cover));
  return { slug };
}
