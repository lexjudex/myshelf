// Shelf decorations: up to three images (a framed photo, a teddy bear, a mini figure…) that stand on
// top of the bookcase on the main Shelves page. Set in Manage → Settings. The images live in KV next to the covers
// (as decor-*.png / .webp / .jpg) and the list lives in D1 settings.
import { HttpError } from './util.js';
import { getSetting, setSetting } from './db.js';
import { IMG_PREFIX, storedCoverName, aspectOf } from './covers.js';

export const MAX_DECOR = 3;
const MAX_BYTES = 2 * 1024 * 1024;
export const FRAMES = ['none', 'wood', 'black', 'gold', 'white'];

const isDecorImage = (path) => {
  const name = storedCoverName(path);
  return Boolean(name && /^decor-[a-z0-9-]+\.(png|webp|jpg)$/.test(name));
};

export async function getDecor(env) {
  const list = await getSetting(env, 'decor', []).catch(() => []);
  return Array.isArray(list) ? cleanDecor(list) : []; // cleaned on the way out too, so older entries get defaults
}

// Placement: x = where the middle of the image sits, in % of the bookcase's width (0 = left edge, 100 = right);
// height in px on a desktop screen (phones scale it down); tilt in degrees: leaning flat, like a picture hung
// crooked (negative leans left, positive right); turn in degrees: angled on the shelf in 3D, like a frame set at
// an angle instead of head-on (negative faces left, positive faces right).
export const LIMITS = { x: [0, 100], height: [20, 240], tilt: [-20, 20], turn: [-50, 50] };
// Earlier versions had five spots and three sizes; they turn into the same numbers.
const OLD_X = { left: 10, 'left-center': 30, center: 50, 'right-center': 70, right: 90 };
const OLD_H = { small: 70, medium: 110, large: 150 };

const num = (v, [lo, hi], fallback, step = 1) => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Number((Math.round(n / step) * step).toFixed(2))));
};

// Phones: `phone` is null (follow desktop, drawn at PHONE_SCALE) or its own { x, height, tilt, turn, hidden }.
export const PHONE_SCALE = 0.68;
function cleanPhone(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    x: num(p.x, LIMITS.x, 50, 0.1),
    height: num(p.height, LIMITS.height, 75),
    tilt: num(p.tilt, LIMITS.tilt, 0, 0.5),
    turn: num(p.turn, LIMITS.turn, 0),
    hidden: p.hidden === true,
  };
}

export function cleanDecor(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'decorations must be a list');
  return list.filter((d) => isDecorImage(d?.image)).slice(0, MAX_DECOR).map((d) => ({
    image: d.image,
    x: num(d.x, LIMITS.x, OLD_X[d.position] ?? 50, 0.1),
    height: num(d.height, LIMITS.height, OLD_H[d.size] ?? 110),
    tilt: num(d.tilt, LIMITS.tilt, 0, 0.5),
    turn: num(d.turn, LIMITS.turn, 0),
    phone: cleanPhone(d.phone),
    flip: d.flip === true,
    frame: FRAMES.includes(d.frame) ? d.frame : 'none', // a picture frame around the image (for photos)
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

/** What kind of image the bytes are: PNG, WebP or JPEG. */
function sniff(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', type: 'image/png' };
  const ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  return null;
}

/** Store an uploaded image and add it to the list (at the first free spot). Returns the new list. */
export async function addDecor(env, buf) {
  const bytes = new Uint8Array(buf);
  if (!bytes.length) throw new HttpError(400, 'That file is empty.');
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'That image is over 2 MB. Try a smaller one.');
  const kind = sniff(bytes);
  if (!kind) throw new HttpError(400, 'Use a PNG, WebP or JPG image.');
  const list = await getDecor(env);
  if (list.length >= MAX_DECOR) throw new HttpError(400, `You can have up to ${MAX_DECOR} decorations. Remove one first.`);
  if (!env?.COVERS) throw new HttpError(500, 'Cover storage (the COVERS KV binding) isn’t connected.');
  const name = `decor-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.${kind.ext}`;
  await env.COVERS.put(name, buf, { metadata: { type: kind.type } });
  // New ones start at the first free spot: left, right, then the middle.
  const x = [10, 90, 50, 30, 70].find((p) => !list.some((d) => Math.abs(d.x - p) < 8)) ?? 50;
  // A JPG can't be see-through, so it starts out in a wood frame, angled a little (change both in Settings).
  const jpg = kind.ext === 'jpg';
  return saveDecor(env, [...list, { image: IMG_PREFIX + name, x, height: 110, turn: jpg ? 20 : 0, frame: jpg ? 'wood' : 'none', aspect: aspectOf(buf) }]);
}
