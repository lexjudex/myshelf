import { json, route } from '../../../server/util.js';
import { saveSpine } from '../../../server/spines.js';

// POST /api/spine { slug, cover, image: "data:image/jpeg;base64,…" } → { slug, spine }
// A small copy of the item's cover for its shelf spine, made by the browser on the Manage page.
export const POST = route(async ({ request, env }) => json(await saveSpine(env, await request.json().catch(() => ({})))));
