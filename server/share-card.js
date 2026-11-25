// The picture shown when someone shares a link to your site (iMessage, Slack, Discord, Facebook, X/Twitter…).
//
// Drawing a picture on the Worker takes far more CPU than the free plan allows, so the Manage page draws it in the
// browser (your site's name, your name and a shelf of your latest covers, in your colours) and sends it here,
// the same way it makes the shelf copies of covers. It's redrawn whenever what's on it changes (sig). Until the
// first one exists, pages use the generic card in public/og-default.png.
import { HttpError } from './util.js';
import { getSetting, setSetting, hasDb } from './db.js';
import { storeCover, deleteCover } from './covers.js';

export const DEFAULT_CARD = '/og-default.png';
const MAX_BYTES = 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** { url, sig, at } for the current card, or null. */
export async function getShareCard(env) {
  if (!hasDb(env)) return null;
  try {
    const c = await getSetting(env, 'shareCard', null);
    return c && typeof c.url === 'string' && c.url.startsWith('/img/') ? c : null;
  } catch {
    return null;
  }
}

/** Store a new card drawn by the Manage page. { buf, type, sig } */
export async function saveShareCard(env, { buf, type, sig } = {}) {
  type = String(type || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) throw new HttpError(400, 'The share card must be a JPEG, PNG or WebP.');
  if (!buf?.byteLength || buf.byteLength > MAX_BYTES) throw new HttpError(400, 'The share card is empty or too big.');
  const old = await getShareCard(env);
  const url = await storeCover(env, 'share-card', { buf, ext: TYPES[type], type });
  const card = { url, sig: String(sig || '').slice(0, 2000), at: new Date().toISOString() };
  await setSetting(env, 'shareCard', card);
  if (old?.url && old.url !== url) await deleteCover(env, old.url).catch(() => {});
  return card;
}
