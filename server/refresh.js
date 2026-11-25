// Refresh board games with the latest BGG data (player counts, play time, complexity, mechanics...).
// Games added by hand get linked to BGG by title + year.
import { HttpError } from './util.js';
import { normalizeItem } from './markdown.js';
import { listItems, putItems } from './db.js';
import { bggThings, bggFind, bggDetails } from './providers.js';

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const bggIdOf = (src = {}) => (/boardgamegeek|bgg/i.test(`${src.name} ${src.url}`) && src.id ? String(src.id) : null);

export async function refreshBoardgames(env, onlySlugs) {
  if (!env.BGG_TOKEN) throw new HttpError(400, 'No BGG token yet. Add it in Manage → Settings → API keys.');
  const games = (await listItems(env, { type: 'boardgame' }))
    .filter((r) => !onlySlugs || onlySlugs.includes(r.slug))
    .map((r) => ({ slug: r.slug, data: r.item, body: r.body }));

  const report = [];
  for (const g of games) {
    g.id = bggIdOf(g.data.source);
    if (!g.id) {
      const hit = await bggFind(env, g.data.title, g.data.year);
      if (hit) { g.id = hit.id; g.linkedNow = `${hit.name}${hit.year ? ` (${hit.year})` : ''}`; }
    }
  }
  const ids = [...new Set(games.map((g) => g.id).filter(Boolean))];
  const things = Object.fromEntries((await bggThings(env, ids)).map((t) => [t.id, t]));

  const updates = [];
  for (const g of games) {
    const t = g.id && things[g.id];
    if (!t) { report.push({ slug: g.slug, title: g.data.title, status: 'not found on BGG' }); continue; }
    const item = { ...g.data };
    item.details = clean({ ...(item.details || {}), ...clean(bggDetails(t)) });
    if (t.categories?.length) item.genres = t.categories;
    if (!item.creator) item.creator = (t.designers || []).filter((d) => d !== '(Uncredited)').slice(0, 3).join(', ');
    if (!item.year && t.year) item.year = t.year;
    item.source = { name: 'BoardGameGeek', id: String(g.id), url: `https://boardgamegeek.com/boardgame/${g.id}` };
    const norm = normalizeItem(item);
    for (const k of ['dateAdded', 'dateStarted', 'dateFinished', 'rating']) if (norm[k] == null) delete norm[k];
    updates.push({ slug: g.slug, item: norm, body: g.body });
    report.push({ slug: g.slug, title: g.data.title, status: g.linkedNow ? `linked to “${g.linkedNow}” and updated` : 'updated', bggUrl: item.source.url });
  }
  await putItems(env, updates);
  return { updated: updates.length, report };
}
