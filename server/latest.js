// Is a newer MyShelf out? Compares this site's version (package.json) with the one in the original project's
// package.json, read from GitHub's file CDN (raw.githubusercontent.com). That needs no token and doesn't count
// against GitHub's API rate limit, so it works for every copy: forks and Deploy-button copies alike.
// The answer is kept for 6 hours (in memory and in D1), so this costs about four small requests a day.
import { VERSION } from './version.js';
import { getSetting, setSetting, hasDb } from './db.js';

export const UPSTREAM = 'lexjudex/myshelf';
const TTL = 6 * 3600_000;
let mem = null; // { version, at }

/** "0.7.10" vs "0.7.9" → 1; equal → 0. Missing parts count as 0. */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatest(env, fetcher) {
  const repo = String(env.MYSHELF_UPSTREAM || UPSTREAM).trim();
  const res = await fetcher(`https://raw.githubusercontent.com/${repo}/main/package.json`, {
    headers: { 'user-agent': 'MyShelf' }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const v = String((await res.json().catch(() => ({}))).version || '');
  return /^\d+(\.\d+)*$/.test(v) ? v : null;
}

/** { current, latest, behind } — latest is '' when it couldn't be checked. */
export async function latestVersion(env, { fetcher = fetch, now = Date.now() } = {}) {
  let known = mem;
  if (!known && hasDb(env)) known = await getSetting(env, 'latest_version', null).catch(() => null);
  if (!known || now - known.at > TTL) {
    const v = await fetchLatest(env, fetcher).catch(() => null);
    if (v) {
      known = { version: v, at: now };
      if (hasDb(env)) await setSetting(env, 'latest_version', known).catch(() => {});
    } else if (known) {
      known = { ...known, at: now - TTL + 3600_000 }; // GitHub didn't answer: try again in an hour
    }
  }
  mem = known;
  const latest = known?.version || '';
  return { current: VERSION, latest, behind: Boolean(latest) && compareVersions(latest, VERSION) > 0 };
}

export const _resetLatest = () => { mem = null; };
