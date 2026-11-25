// Small copies of the covers for the shelf spines.
//
// Every spine on the shelf is painted with its cover (blurred for most kinds, a slice of the box art for board
// games). Painting it with the full-size cover meant phones decoding dozens of multi-megapixel images at once,
// which is more than iPhones allow a tab, so Safari kept crashing the page. The spine only needs a few hundred
// pixels, so the browser on the Manage page makes a small copy of each stored cover (Workers can't resize
// images on the free plan) and sends it here. Until an item has one, its spine is drawn in its type's colour.
import { HttpError } from './util.js';
import { getItem, putItem } from './db.js';
import { storeCover, deleteCover, storedCoverName } from './covers.js';
import { assertSlug } from './paths.js';

const MAX_SPINE_BYTES = 256 * 1024; // a spine copy is usually 5–60 KB
const TYPES = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Store a spine copy for an item. body: { slug, cover, image: "data:image/jpeg;base64,…" } */
export async function saveSpine(env, body = {}) {
  const slug = assertSlug(String(body.slug || ''));
  const row = await getItem(env, slug);
  if (!row) throw new HttpError(404, 'Item not found');
  // The cover changed while the copy was being made: don't pin an old cover's spine on the new one.
  if (!storedCoverName(row.item.cover) || row.item.cover !== body.cover) throw new HttpError(409, 'The cover changed; make the spine again.');

  const m = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) throw new HttpError(400, 'The spine image must be a JPEG or WebP data URL.');
  const bin = atob(m[2]);
  if (!bin.length || bin.length > MAX_SPINE_BYTES) throw new HttpError(400, 'The spine image is empty or too big.');
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;

  const spine = await storeCover(env, `${slug}-spine`, { buf, ext: TYPES[m[1]], type: m[1] });
  const old = row.item.spine;
  await putItem(env, slug, { ...row.item, spine }, row.body);
  if (old && old !== spine) await deleteCover(env, old).catch(() => {});
  return { slug, spine };
}
