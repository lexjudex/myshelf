// Is a newer MyShelf out, and what's in it? Reads three files from the original project on GitHub's file CDN
// (raw.githubusercontent.com): package.json (the version), CHANGELOG.md (what changed) and announcements.json
// (messages for everyone running MyShelf). That needs no token and doesn't count against GitHub's API rate limit,
// so it works for every copy: forks and Deploy-button copies alike. The answer is kept for 6 hours (in memory and
// in D1), so this costs about a dozen small requests a day.
//
// announcements.json (in the original project's root):
//   { "announcements": [ { "id": "2026-11-fix", "message": "Plain text…", "link": "https://…", "linkText": "Read more",
//                          "until": "2026-12-31", "below": "0.9.0" } ] }
//   id and message are required. until: stop showing after that date. below: only show to sites older than that
//   version (handy for "please update" notes). Messages are plain text: no HTML or Markdown.
import { VERSION } from './version.js';
import { getSetting, setSetting, hasDb } from './db.js';

export const UPSTREAM = 'lexjudex/myshelf';
export const CHANGELOG_URL = `https://github.com/${UPSTREAM}/blob/main/CHANGELOG.md`;
const TTL = 6 * 3600_000;
let mem = null; // { version, changelog, announcements, at }

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

/** CHANGELOG.md → [{ version, title, body }], newest first (as written). Sections start with "## 0.8.0 (Nov 2026)". */
export function parseChangelog(md) {
  const out = [];
  let cur = null;
  for (const line of String(md || '').split('\n')) {
    const m = line.match(/^##\s+(\d+(?:\.\d+)*)\s*(.*)$/);
    if (m) {
      cur = { version: m[1], title: `${m[1]} ${m[2]}`.trim(), body: '' };
      out.push(cur);
    } else if (cur) {
      cur.body += `${line}\n`;
    }
  }
  return out.map((e) => ({ ...e, body: e.body.trim().slice(0, 6000) })).slice(0, 40);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const httpsOnly = (u) => { try { return new URL(String(u)).protocol === 'https:' ? String(u).slice(0, 500) : ''; } catch { return ''; } };

/** Tidy announcements.json into plain, safe values. */
export function cleanAnnouncements(data) {
  const list = Array.isArray(data?.announcements) ? data.announcements : Array.isArray(data) ? data : [];
  return list.slice(0, 10).map((a) => ({
    id: String(a?.id || '').trim().slice(0, 80),
    message: String(a?.message || '').trim().slice(0, 600),
    link: httpsOnly(a?.link || ''),
    linkText: String(a?.linkText || '').trim().slice(0, 40),
    until: DATE.test(String(a?.until || '')) ? String(a.until) : '',
    below: /^\d+(\.\d+)*$/.test(String(a?.below || '')) ? String(a.below) : '',
  })).filter((a) => a.id && a.message);
}

/** The announcements this site should see today. */
export function activeAnnouncements(list, current = VERSION, today = new Date().toISOString().slice(0, 10)) {
  return (list || []).filter((a) => (!a.until || a.until >= today) && (!a.below || compareVersions(current, a.below) < 0));
}

/** The changelog entries between this version (not included) and the latest (included). */
export function changesBetween(entries, current, latest) {
  return (entries || []).filter((e) => compareVersions(e.version, current) > 0 && (!latest || compareVersions(e.version, latest) <= 0));
}

async function fetchUpstream(env, fetcher) {
  const repo = String(env.MYSHELF_UPSTREAM || UPSTREAM).trim();
  const get = (file) => fetcher(`https://raw.githubusercontent.com/${repo}/main/${file}`, {
    headers: { 'user-agent': 'MyShelf' }, signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const [pkg, log, ann] = await Promise.all([get('package.json'), get('CHANGELOG.md'), get('announcements.json')]);
  if (!pkg?.ok) return null;
  const v = String((await pkg.json().catch(() => ({}))).version || '');
  if (!/^\d+(\.\d+)*$/.test(v)) return null;
  return {
    version: v,
    changelog: log?.ok ? parseChangelog(await log.text()) : [],
    announcements: ann?.ok ? cleanAnnouncements(await ann.json().catch(() => null)) : [],
  };
}

/**
 * { current, latest, behind, changes, announcements, changelogUrl }. latest is '' when it couldn't be checked.
 * changes: what the update brings (changelog entries newer than this version).
 */
export async function latestVersion(env, { fetcher = fetch, now = Date.now() } = {}) {
  let known = mem;
  if (!known && hasDb(env)) known = await getSetting(env, 'latest_version', null).catch(() => null);
  if (!known || now - known.at > TTL) {
    const fresh = await fetchUpstream(env, fetcher).catch(() => null);
    if (fresh) {
      known = { ...fresh, at: now };
      if (hasDb(env)) await setSetting(env, 'latest_version', known).catch(() => {});
    } else if (known) {
      known = { ...known, at: now - TTL + 3600_000 }; // GitHub didn't answer: try again in an hour
    }
  }
  mem = known;
  const latest = known?.version || '';
  const behind = Boolean(latest) && compareVersions(latest, VERSION) > 0;
  return {
    current: VERSION,
    latest,
    behind,
    changes: behind ? changesBetween(known?.changelog, VERSION, latest) : [],
    announcements: activeAnnouncements(known?.announcements || [], VERSION, new Date(now).toISOString().slice(0, 10)),
    changelogUrl: CHANGELOG_URL,
  };
}

export const _resetLatest = () => { mem = null; };
