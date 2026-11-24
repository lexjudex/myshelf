// Site title, tagline and owner name: edited in Manage → Settings, stored in D1.
// src/data/site.json holds the defaults a brand-new site starts with.
import defaults from '../src/data/site.json' with { type: 'json' };
import { getSetting, setSetting, hasDb } from './db.js';
import { HttpError, TYPE_KEYS } from './util.js';

const clean = (v, n) => String(v ?? '').trim().slice(0, n);

// Media types added in a later version of MyShelf start out turned ON, even for sites that saved their media
// choices before those types existed: typesSeen remembers which types were on offer when you last saved.
const ORIGINAL_TYPES = ['book', 'movie', 'tv', 'music', 'videogame', 'boardgame'];
function withNewTypes(site) {
  if (!Array.isArray(site.types)) return site.types;
  const seen = Array.isArray(site.typesSeen) ? site.typesSeen : ORIGINAL_TYPES;
  return [...site.types, ...TYPE_KEYS.filter((t) => !seen.includes(t))];
}
const withTypes = (site) => ({ ...site, types: cleanTypes(withNewTypes(site)), theme: cleanTheme(site.theme) });

// ───────── look: light or dark, and the accent colour ─────────
export const DEFAULT_ACCENT = '#d99a4e';
// Presets offered in Settings (any colour can be typed in too).
export const ACCENTS = [
  ['#d99a4e', 'Amber'], ['#e07a5f', 'Terracotta'], ['#e0718f', 'Rose'], ['#a98be0', 'Lavender'],
  ['#6a9fe0', 'Blue'], ['#4fb3a9', 'Teal'], ['#7fb069', 'Sage'], ['#c9a227', 'Mustard'],
];

/** { mode: 'dark' | 'light', accent: '#rrggbb' }, with anything unexpected replaced by the defaults. */
export function cleanTheme(value) {
  const t = value && typeof value === 'object' ? value : {};
  const accent = /^#[0-9a-f]{6}$/i.test(String(t.accent || '').trim()) ? String(t.accent).trim().toLowerCase() : DEFAULT_ACCENT;
  return { mode: t.mode === 'light' ? 'light' : 'dark', accent };
}

/** Black or near-black text on light accents, white on dark ones (so buttons stay readable). */
export function onAccent(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.22 ? '#1a1408' : '#ffffff';
}

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
    typesSeen: [...TYPE_KEYS],
    // Light or dark, and the accent colour. Visitors can still flip light/dark for themselves.
    theme: input.theme === undefined ? (await getSite(env)).theme : cleanTheme(input.theme),
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
