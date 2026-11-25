// Lock down /api/* with the admin token. Public pages, /img/*, /federation/* and /.well-known/myshelf are open
// (federation messages carry their own signatures).
// After the token checks out, API keys saved in Manage → Settings are laid over the Worker secrets for that request.
// Public pages are served from the page cache when they can be (see server/page-cache.js), and any change clears it.
import { defineMiddleware } from 'astro:middleware';
import { checkAuth } from '../server/auth.js';
import { envOf } from '../server/util.js';
import { withStoredKeys } from '../server/apikeys.js';
import { isCacheable, cachedPage, keepPage, clearPages } from '../server/page-cache.js';

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (ctx.isPrerendered) return next();
  const env = envOf(ctx.locals);
  const waitUntil = (p) => { try { ctx.locals.runtime.ctx.waitUntil(p); } catch { return p; } };

  if (isCacheable(ctx.request, ctx.url)) {
    const hit = await cachedPage(env, ctx.url);
    if (hit) return hit;
    const res = await next();
    if (res.status === 200) await waitUntil(keepPage(env, ctx.url, res.clone()));
    return res;
  }

  if (ctx.url.pathname.startsWith('/api/')) {
    const denied = await checkAuth(ctx.request, env);
    if (denied) return denied;
    try {
      ctx.locals.myshelfEnv = await withStoredKeys(env);
    } catch (err) {
      console.error('Could not load saved API keys:', err); // fall back to the Worker secrets
    }
  }
  const res = await next();
  // Saves, deletes, settings, friends' messages…: kept pages may be out of date now.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(ctx.request.method) && res.status < 400) await clearPages(env);
  return res;
});
