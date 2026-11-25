// Manage → Settings → Updates. A MyShelf copy made by forking on GitHub can pull in new versions from the
// repository it was forked from without visiting GitHub: this does what GitHub's "Sync fork" button does,
// through GitHub's API, and Cloudflare redeploys the site from the updated fork as usual.
//
// Which repository: the GITHUB_REPO variable ("you/myshelf") if set, otherwise the Source code link in
// Settings. Both checking and syncing use a GITHUB_TOKEN secret: a fine-grained token for just that
// repository with "Contents: Read and write". (Without one, GitHub's shared rate limit for Cloudflare's
// addresses runs out quickly, so we don't try.)
import { getSite } from './site.js';
import { HttpError } from './util.js';
import { versionInfo } from './version.js';

const API = 'https://api.github.com';

function repoOf(env, site) {
  const raw = String(env.GITHUB_REPO || site.source || '').trim();
  const m = raw.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function gh(env, path, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'MyShelf', 'x-github-api-version': '2022-11-28' };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch((env.GITHUB_API || API) + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const firstLine = (s) => String(s || '').split('\n')[0];

/** Where this site's repository stands against the one it was forked from. */
export async function checkUpdates(env) {
  return { ...(await check(env)), current: versionInfo() };
}

/** The version number in the original's package.json (blank if it can't be read). */
async function upstreamVersion(env, upstream, branch) {
  const res = await gh(env, `/repos/${upstream}/contents/package.json?ref=${encodeURIComponent(branch)}`).catch(() => null);
  if (res?.status !== 200 || !res.data.content) return '';
  try { return String(JSON.parse(atob(res.data.content.replace(/\s/g, ''))).version || ''); } catch { return ''; }
}

async function check(env) {
  const site = await getSite(env);
  const repo = repoOf(env, site);
  const canSync = Boolean(env.GITHUB_TOKEN);
  if (!repo) return { status: 'no-repo', canSync };
  if (!canSync) return { status: 'no-token', repo, canSync };

  const info = await gh(env, `/repos/${repo}`);
  if (info.status === 401 || info.status === 403) return { status: 'bad-token', repo, canSync };
  if (info.status === 404) return { status: 'not-found', repo, canSync };
  if (info.status !== 200) return { status: 'error', repo, canSync, message: info.data.message || `GitHub answered ${info.status}` };
  if (!info.data.fork || !info.data.parent) return { status: 'not-fork', repo, canSync };

  const upstream = info.data.parent.full_name;
  const branch = info.data.default_branch;
  const upBranch = info.data.parent.default_branch;
  const [upOwner] = upstream.split('/');
  // base = your fork, head = the original: "ahead_by" is how many new commits the original has.
  const cmp = await gh(env, `/repos/${repo}/compare/${encodeURIComponent(branch)}...${encodeURIComponent(`${upOwner}:${upBranch}`)}`);
  if (cmp.status !== 200) return { status: 'error', repo, upstream, canSync, message: cmp.data.message || `GitHub answered ${cmp.status}` };

  const all = (cmp.data.commits || [])
    .filter((c) => (c.parents || []).length < 2) // skip merge commits; their branches' commits are listed
    .map((c) => ({ message: firstLine(c.commit?.message), date: c.commit?.committer?.date || c.commit?.author?.date || '' }))
    .reverse();
  const behind = cmp.data.ahead_by > 0;
  return {
    status: behind ? 'behind' : 'up-to-date',
    latest: behind ? await upstreamVersion(env, upstream, upBranch) : '',
    repo, upstream, branch, canSync,
    behind: all.length || cmp.data.ahead_by || 0,
    changes: all.slice(0, 8),
    yours: cmp.data.behind_by || 0, // commits only in your fork (edits you made)
  };
}

/** Pull in the original's new commits, like GitHub's "Sync fork → Update branch". */
export async function syncUpdates(env) {
  if (!env.GITHUB_TOKEN) throw new HttpError(400, 'Add a GitHub token in Manage → Settings → API keys to update from here.');
  const now = await check(env);
  if (now.status === 'up-to-date') return { ok: true, message: 'Already up to date.' };
  if (now.status !== 'behind') throw new HttpError(400, `Can’t update right now (${now.status}).`);

  const res = await gh(env, `/repos/${now.repo}/merge-upstream`, { method: 'POST', body: { branch: now.branch } });
  if (res.status === 200) return { ok: true, updated: true, message: res.data.message || 'Updated.' };
  if (res.status === 409) throw new HttpError(409, 'Your copy has its own changes that clash with the new version. Open your repository on GitHub and use Sync fork there to sort it out.');
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new HttpError(403, 'GitHub turned the token down. It needs “Contents: Read and write” on your MyShelf repository and must not be expired.');
  }
  throw new HttpError(502, res.data.message || `GitHub answered ${res.status}`);
}
