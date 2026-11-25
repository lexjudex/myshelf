import { json, route } from '../../../server/util.js';
import { keyStatus, saveKeys, testKeys } from '../../../server/apikeys.js';

// GET  /api/keys                     → which API keys are set (saved here or as Worker secrets), never the keys
// POST /api/keys { keys: { NAME } }  → save (a value) or remove (null) keys here
// POST /api/keys { test: "tmdb" }    → try that service's keys with one small request
export const GET = route(async ({ env }) => json(await keyStatus(env)));
export const POST = route(async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  if (body.test) return json(await testKeys(env, String(body.test)));
  return json(await saveKeys(env, body.keys));
});
