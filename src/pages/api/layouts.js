import { json, route } from '../../../server/util.js';
import { getLayouts, saveLayout } from '../../../server/settings.js';

// The order of shelves on each media page (edited right on the page with "Edit shelves").
// GET  /api/layouts → { layouts }
// POST /api/layouts { page: 'book', order: ['c:slug' | 's:status', …], hidden: ['abandoned', 'c:slug', …] }
export const GET = route(async ({ env }) => json({ layouts: await getLayouts(env) }));
export const POST = route(async ({ request, env }) => {
  const { page, order, hidden } = await request.json();
  return json({ layout: await saveLayout(env, page, { order, hidden }) });
});
