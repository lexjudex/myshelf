// Lock down /api/* with the admin token. Public pages, /img/*, /federation/* and /.well-known/myshelf are open
// (federation messages carry their own signatures).
// After the token checks out, API keys saved in Manage → Settings are laid over the Worker secrets for that request.
import { defineMiddleware } from 'astro:middleware';
import { checkAuth } from '../server/auth.js';
import { envOf } from '../server/util.js';
import { withStoredKeys } from '../server/apikeys.js';

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (ctx.url.pathname.startsWith('/api/') && !ctx.isPrerendered) {
    const env = envOf(ctx.locals);
    const denied = await checkAuth(ctx.request, env);
    if (denied) return denied;
    try {
      ctx.locals.myshelfEnv = await withStoredKeys(env);
    } catch (err) {
      console.error('Could not load saved API keys:', err); // fall back to the Worker secrets
    }
  }
  return next();
});
