import { json, route } from '../../../../server/util.js';
import { receive } from '../../../../server/federation/index.js';

// POST /federation/v1/inbox → signed messages from other MyShelf sites (friend requests, recommendations, …).
// Follow-up work (like telling a thread about a new comment) runs after the reply via waitUntil.
export const POST = (ctx) => {
  const rt = ctx.locals.runtime?.ctx;
  const waitUntil = rt?.waitUntil ? (p) => rt.waitUntil(p.catch(() => {})) : null;
  return route(async ({ request, env }) => json(await receive(env, request, fetch, { waitUntil }), 202))(ctx);
};
