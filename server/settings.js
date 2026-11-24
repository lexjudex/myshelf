// Collections (shelves) and per-type shelf arrangements, stored as settings in D1.
import { HttpError, slugify } from './util.js';
import { getSetting, setSetting } from './db.js';

const SORTS = ['newest', 'oldest', 'title', 'creator', 'rating', 'year-new', 'year-old', 'custom'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;
const ARRANGE_KEY = /^(book|movie|tv|music|videogame|boardgame|video):(want|in-progress|finished|abandoned)$/;

export const getCollections = (env) => getSetting(env, 'collections', []);
export const getArrangements = (env) => getSetting(env, 'arrangements', {});

export function cleanCollections(collections) {
  if (!Array.isArray(collections)) throw new HttpError(400, 'collections must be an array');
  const seen = new Set();
  return collections.map((c) => {
    const name = String(c.name || '').trim();
    if (!name) throw new HttpError(400, 'Every collection needs a name');
    let slug = c.slug ? String(c.slug) : slugify(name);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) slug = slugify(slug);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    const out = { slug, name, description: String(c.description || '').trim() };
    if (['in-progress', 'finished', 'want'].includes(c.auto)) out.auto = c.auto;
    if ([3, 3.5, 4, 4.5, 5].includes(Number(c.minRating))) out.minRating = Number(c.minRating); // only items rated at least this
    if (['type', 'both'].includes(c.show)) out.show = c.show; // default (shelves) is left out
    if (SORTS.includes(c.sort) && c.sort !== 'newest') out.sort = c.sort;
    if ([30, 90, 182, 365, 730].includes(Number(c.within))) out.within = Number(c.within); // only items from the last N days
    if (Array.isArray(c.order)) {
      const order = [...new Set(c.order.map(String).filter((s) => SLUG.test(s)))].slice(0, 5000);
      if (order.length) out.order = order;
    }
    return out;
  });
}

export async function saveCollections(env, collections) {
  const clean = cleanCollections(collections);
  await setSetting(env, 'collections', clean);
  return clean;
}

/** key like "book:finished"; an empty order resets that shelf to newest first. */
export async function saveArrangement(env, key, order) {
  if (!ARRANGE_KEY.test(key || '')) throw new HttpError(400, 'Invalid shelf');
  if (!Array.isArray(order)) throw new HttpError(400, 'order must be an array');
  const clean = [...new Set(order.map(String).filter((s) => SLUG.test(s)))].slice(0, 5000);
  const all = await getArrangements(env);
  if (clean.length) all[key] = clean; else delete all[key];
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  await setSetting(env, 'arrangements', sorted);
  return sorted;
}
