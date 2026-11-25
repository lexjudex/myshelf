// Live index used by the admin page and the shelf pencil buttons.
// Anyone gets the public items; with your admin token you also get friends-only and private ones.
import { getItems, getShelves } from '../lib/items.js';
import { checkAuth } from '../../server/auth.js';

export async function GET({ locals, request }) {
  const env = locals.runtime.env;
  const all = request.headers.has('authorization') && !(await checkAuth(request, env));
  const [entries, collections] = await Promise.all([getItems(env, { all }), getShelves(env)]);
  const items = entries.map((e) => ({
    slug: e.id,
    title: e.data.title,
    type: e.data.type,
    creator: e.data.creator,
    year: e.data.year,
    cover: e.data.cover,
    spine: e.data.spine || '',
    shelfCover: e.data.shelfCover || '',
    status: e.data.status,
    rating: e.data.rating ?? null,
    collections: e.data.collections,
    source: e.data.source || {},
    dateAdded: e.data.dateAdded || null,
    dateStarted: e.data.dateStarted || null,
    dateFinished: e.data.dateFinished || null,
    featured: e.data.featured === true,
    createdAt: e.createdAt,
    ...(all ? { visibility: e.data.visibility || 'public', owned: e.data.owned === true, lentTo: e.data.lentTo || '' } : {}),
  }));
  return new Response(JSON.stringify({ items, collections }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
