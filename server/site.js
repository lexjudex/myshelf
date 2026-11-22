// Site title, tagline and owner name: edited in Manage → Settings, stored in D1.
// src/data/site.json holds the defaults a brand-new site starts with.
import defaults from '../src/data/site.json' with { type: 'json' };
import { getSetting, setSetting, hasDb } from './db.js';
import { HttpError, TYPE_KEYS } from './util.js';

const clean = (v, n) => String(v ?? '').trim().slice(0, n);

const withTypes = (site) => ({ ...site, types: cleanTypes(site.types) });

export async function getSite(env) {
  if (!hasDb(env)) return withTypes({ ...defaults });
  try {
    return withTypes({ ...defaults, ...(await getSetting(env, 'site', {})) });
  } catch {
    return withTypes({ ...defaults });
  }
}

/** Media types this site shows (all of them unless some were turned off in Settings). */
export async function enabledTypes(env) {
  return (await getSite(env)).types;
}

function cleanTypes(value) {
  if (!Array.isArray(value)) return [...TYPE_KEYS];
  const types = TYPE_KEYS.filter((t) => value.includes(t)); // keep the standard order
  return types.length ? types : [...TYPE_KEYS];
}

export async function saveSite(env, input = {}) {
  if (Array.isArray(input.types) && !TYPE_KEYS.some((t) => input.types.includes(t))) {
    throw new HttpError(400, 'Keep at least one kind of media turned on.');
  }
  const site = {
    title: clean(input.title, 80) || defaults.title,
    tagline: clean(input.tagline, 200),
    owner: clean(input.owner, 80),
    // The address friends use to reach you. Leave blank to use whatever address you open the site on.
    url: cleanUrl(input.url),
    // Where visitors can get this site's source code (the footer's "Source" link). MyShelf is AGPL-licensed:
    // if you run a modified copy, point this at your own repository.
    source: cleanLink(input.source) || defaults.source,
    // Which kinds of media this site shows. Turning one off hides it everywhere public; entries are kept.
    types: input.types === undefined ? (await getSite(env)).types : cleanTypes(input.types),
  };
  await setSetting(env, 'site', site);
  return site;
}

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname)) return u.origin;
  } catch {}
  throw new HttpError(400, 'Your site address should look like https://myshelf.example.workers.dev');
}

function cleanLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return u.href.slice(0, 300);
  } catch {}
  throw new HttpError(400, 'The source code link should start with https://');
}
