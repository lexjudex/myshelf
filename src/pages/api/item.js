import { json, route, HttpError } from '../../../server/util.js';
import { assertSlug } from '../../../server/paths.js';
import { getItem, putItem } from '../../../server/db.js';

// GET /api/item?slug=book-dune-1965
export const GET = route(async ({ url, env }) => {
  const slug = assertSlug(url.searchParams.get('slug'));
  const row = await getItem(env, slug);
  if (!row) throw new HttpError(404, 'Item not found');
  return json({ slug, item: row.item, body: row.body });
});

// POST /api/item { slug, dateFinished: "YYYY-MM-DD" } → change just the finished date of a Finished item
// (the ✕ on Recently Finished moves it back past the shelf's time window; Undo puts the old date back).
export const POST = route(async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  const slug = assertSlug(String(body.slug || ''));
  const row = await getItem(env, slug);
  if (!row) throw new HttpError(404, 'Item not found');
  if (row.item.status !== 'finished') throw new HttpError(400, 'Only finished items have a finished date.');
  const date = body.dateFinished == null || body.dateFinished === '' ? null : String(body.dateFinished);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'dateFinished must look like 2025-01-31');
  const item = { ...row.item };
  if (date) item.dateFinished = date; else delete item.dateFinished;
  await putItem(env, slug, item, row.body);
  return json({ slug, item });
});
