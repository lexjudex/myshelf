import { json, route } from '../../../server/util.js';
import { saveCoverCopy } from '../../../server/cover-copies.js';

// POST /api/cover-copy { slug, cover, kind: 'spine' | 'shelf', image: "data:image/jpeg;base64,…" }
// A small copy of the item's cover for the shelves, made by the browser on the Manage page.
export const POST = route(async ({ request, env }) => json(await saveCoverCopy(env, await request.json().catch(() => ({})))));
