import { json, route } from '../../../server/util.js';
import { getShareCard, saveShareCard } from '../../../server/share-card.js';

// GET  /api/share-card → { card: { url, sig, at } | null }
// POST /api/share-card?sig=…   body: the image bytes (drawn by the Manage page) → { card }
export const GET = route(async ({ env }) => json({ card: await getShareCard(env) }));
export const POST = route(async ({ request, env, url }) => json({
  card: await saveShareCard(env, { buf: await request.arrayBuffer(), type: request.headers.get('content-type'), sig: url.searchParams.get('sig') }),
}));
