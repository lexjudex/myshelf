import { json, route } from '../../../server/util.js';
import { saveCoverCopy } from '../../../server/cover-copies.js';

// POST /api/cover-copy?slug=…&kind=spine|shelf&cover=/img/…   body: the JPEG or WebP bytes
// A small copy of the item's cover for the shelves, made by the browser on the Manage page.
export const POST = route(async ({ request, env, url }) => {
  const q = url.searchParams;
  return json(await saveCoverCopy(env, {
    slug: q.get('slug'), kind: q.get('kind'), cover: q.get('cover'),
    type: request.headers.get('content-type'), buf: await request.arrayBuffer(),
  }));
});
