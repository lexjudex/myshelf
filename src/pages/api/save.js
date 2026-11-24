import { json, route } from '../../../server/util.js';
import { saveItem } from '../../../server/save.js';
import { getItem, hasDb } from '../../../server/db.js';
import { linkMentions, notesMentions } from '../../../server/federation/index.js';

// POST /api/save  { slug?, item, body }  → live immediately
// Plain @names of friends in the notes become links, and newly tagged friends get a note in their inbox.
export const POST = route(async ({ request, env, url }) => {
  const payload = await request.json();
  let before = '';
  if (hasDb(env) && payload?.slug) before = (await getItem(env, String(payload.slug)).catch(() => null))?.body || '';
  if (payload && typeof payload.body === 'string') payload.body = await linkMentions(env, payload.body).catch(() => payload.body);
  const saved = await saveItem(env, payload);
  let mentioned = [];
  try { mentioned = await notesMentions(env, url.href, { slug: saved.slug, body: payload.body || '', before }); } catch {}
  return json({ ...saved, body: payload.body || '', mentioned });
});
