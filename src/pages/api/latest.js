import { json, route } from '../../../server/util.js';
import { latestVersion, parseChangelog } from '../../../server/latest.js';
import { VERSION } from '../../../server/version.js';
import changelog from '../../../CHANGELOG.md?raw';

// What's in the version this site runs, from the changelog built into it.
const yours = parseChangelog(changelog).find((e) => e.version === VERSION) || null;

// GET /api/latest          → { current, latest, behind, changes, announcements, changelogUrl, yours }
// GET /api/latest?brief=1  → { current, latest, behind } (the top bar's "Update available" pill)
export const GET = route(async ({ env, url }) => {
  const r = await latestVersion(env);
  if (url.searchParams.has('brief')) return json({ current: r.current, latest: r.latest, behind: r.behind });
  return json({ ...r, yours });
});
