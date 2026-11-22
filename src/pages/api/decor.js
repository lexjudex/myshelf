import { json, route } from '../../../server/util.js';
import { getDecor, saveDecor, addDecor } from '../../../server/decor.js';

// GET  /api/decor                → { decor: [{ image, position, size, flip, aspect }] }
// POST /api/decor  (image bytes) → add a PNG/WebP decoration → { decor }
// PUT  /api/decor { decor }      → save positions/sizes, or remove some → { decor }
export const GET = route(async ({ env }) => json({ decor: await getDecor(env) }));
export const POST = route(async ({ request, env }) => json({ decor: await addDecor(env, await request.arrayBuffer()) }));
export const PUT = route(async ({ request, env }) => json({ decor: await saveDecor(env, (await request.json()).decor) }));
