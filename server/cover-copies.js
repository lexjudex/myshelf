// Small copies of the covers, for the shelves.
//
// Covers are stored at their original size (often 2,000–4,000 px from BoardGameGeek and Google Books). Drawing a
// shelf full of those meant phones decoding dozens of multi-megapixel images at once, which is more than iPhones
// allow a tab, so Safari kept crashing the page. The shelves only need a few hundred pixels, so the browser on the
// Manage page makes small copies of each stored cover (Workers can't resize images on the free plan) and sends
// them here. Two kinds:
//   spine — painted (mostly blurred) on the spine/edge of the shelf item → item.spine
//   shelf — the front of the item on the shelves and the Journal → item.shelfCover
// Item pages keep showing the full-size cover. Until a copy exists, the shelf falls back: spines are drawn in
// the type's colour, fronts use the full-size cover.
import { HttpError } from './util.js';
import { getItem, putItem } from './db.js';
import { storeCover, deleteCover, storedCoverName } from './covers.js';
import { assertSlug } from './paths.js';

export const COPY_FIELDS = { spine: 'spine', shelf: 'shelfCover' };
const MAX_COPY_BYTES = 512 * 1024; // copies are usually 5–150 KB
const TYPES = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Store a small copy of an item's cover.
 * { slug, cover, kind: 'spine' | 'shelf', type: 'image/jpeg' | 'image/webp', buf: ArrayBuffer }
 * The image arrives as raw bytes (not base64 text): decoding base64 costs more CPU than the free plan allows.
 */
export async function saveCoverCopy(env, { slug, cover, kind, type, buf } = {}) {
  const field = COPY_FIELDS[kind];
  if (!field) throw new HttpError(400, 'kind must be "spine" or "shelf".');
  slug = assertSlug(String(slug || ''));
  type = String(type || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) throw new HttpError(400, 'The image must be a JPEG or WebP.');
  if (!buf?.byteLength || buf.byteLength > MAX_COPY_BYTES) throw new HttpError(400, 'The image is empty or too big.');
  const row = await getItem(env, slug);
  if (!row) throw new HttpError(404, 'Item not found');
  // The cover changed while the copy was being made: don't pin an old cover's copy on the new one.
  if (!storedCoverName(row.item.cover) || row.item.cover !== cover) throw new HttpError(409, 'The cover changed; make the copy again.');

  const url = await storeCover(env, `${slug}-${kind}`, { buf, ext: TYPES[type], type });
  const old = row.item[field];
  await putItem(env, slug, { ...row.item, [field]: url }, row.body);
  if (old && old !== url) await deleteCover(env, old).catch(() => {});
  return { slug, kind, [field]: url };
}
