// Shelf decorations: up to three transparent images (a framed photo, a teddy bear, a mini figure…) that stand on
// top of the bookcase on the main Shelves page. Set in Manage → Settings. The images live in KV next to the covers
// (as decor-*.png / .webp) and the list lives in D1 settings.
import { HttpError } from './util.js';
import { getSetting, setSetting } from './db.js';
import { IMG_PREFIX, storedCoverName, aspectOf } from './covers.js';

export const MAX_DECOR = 3;
const MAX_BYTES = 2 * 1024 * 1024;
export const POSITIONS = ['left', 'left-center', 'center', 'right-center', 'right'];
export const SIZES = ['small', 'medium', 'large'];

const isDecorImage = (path) => {
  const name = storedCoverName(path);
  return Boolean(name && /^decor-[a-z0-9-]+\.(png|webp)$/.test(name));
};

export async function getDecor(env) {
  const list = await getSetting(env, 'decor', []).catch(() => []);
  return Array.isArray(list) ? list.filter((d) => isDecorImage(d?.image)) : [];
}

export function cleanDecor(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'decorations must be a list');
  return list.filter((d) => isDecorImage(d?.image)).slice(0, MAX_DECOR).map((d) => ({
    image: d.image,
    position: POSITIONS.includes(d.position) ? d.position : 'center',
    size: SIZES.includes(d.size) ? d.size : 'medium',
    flip: d.flip === true,
    ...(Number(d.aspect) > 0 ? { aspect: Math.round(Number(d.aspect) * 10000) / 10000 } : {}),
  }));
}

/** Save the list; images that were taken off it are deleted from storage. */
export async function saveDecor(env, list) {
  const clean = cleanDecor(list);
  const before = await getDecor(env);
  const keep = new Set(clean.map((d) => d.image));
  for (const d of before) {
    if (!keep.has(d.image) && env?.COVERS) await env.COVERS.delete(storedCoverName(d.image)).catch(() => {});
  }
  await setSetting(env, 'decor', clean);
  return clean;
}

/** What kind of image the bytes are: PNG and WebP only (both can be transparent). */
function sniff(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', type: 'image/png' };
  const ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

/** Store an uploaded image and add it to the list (at the first free spot). Returns the new list. */
export async function addDecor(env, buf) {
  const bytes = new Uint8Array(buf);
  if (!bytes.length) throw new HttpError(400, 'That file is empty.');
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'That image is over 2 MB. Try a smaller one.');
  const kind = sniff(bytes);
  if (!kind) throw new HttpError(400, 'Use a PNG (or WebP) image, ideally with a transparent background.');
  const list = await getDecor(env);
  if (list.length >= MAX_DECOR) throw new HttpError(400, `You can have up to ${MAX_DECOR} decorations. Remove one first.`);
  if (!env?.COVERS) throw new HttpError(500, 'Cover storage (the COVERS KV binding) isn’t connected.');
  const name = `decor-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.${kind.ext}`;
  await env.COVERS.put(name, buf, { metadata: { type: kind.type } });
  const used = new Set(list.map((d) => d.position));
  const position = ['left', 'right', 'center', 'left-center', 'right-center'].find((p) => !used.has(p)) || 'center';
  return saveDecor(env, [...list, { image: IMG_PREFIX + name, position, size: 'medium', aspect: aspectOf(buf) }]);
}
