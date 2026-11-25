import { json, route, HttpError } from '../../../server/util.js';
import { searchBggExpansions, bggExpansionsFor } from '../../../server/providers.js';

// GET /api/expansions?q=wingspan     → search BGG expansions
// GET /api/expansions?base=266192    → every expansion BGG lists for that base game
export const GET = route(async ({ url, env }) => {
  if (!env.BGG_TOKEN) throw new HttpError(400, 'No BGG token yet. Add it in Manage → Settings → API keys.');
  const base = url.searchParams.get('base');
  if (base) {
    if (!/^\d{1,9}$/.test(base)) throw new HttpError(400, 'Invalid BGG id');
    return json({ expansions: await bggExpansionsFor(env, base) });
  }
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) throw new HttpError(400, 'Search query too short');
  return json({ expansions: await searchBggExpansions(q, env) });
});
