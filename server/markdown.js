import YAML from 'yaml';

const FIELD_ORDER = [
  'title', 'type', 'creator', 'year', 'cover', 'status', 'rating',
  'dateAdded', 'dateStarted', 'dateFinished', 'collections', 'tags',
  'description', 'genres', 'details', 'source',
];

const DATE_FIELDS = ['dateAdded', 'dateStarted', 'dateFinished'];

function cleanDate(v) {
  if (!v) return null;
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

// Normalize an item object coming from the admin UI into tidy frontmatter.
export function normalizeItem(input) {
  const item = { ...input };
  for (const f of DATE_FIELDS) item[f] = cleanDate(item[f]);
  if (item.year != null) item.year = String(item.year);
  if (item.rating === '' || item.rating == null) item.rating = null;
  else item.rating = Math.max(0, Math.min(5, Number(item.rating)));
  for (const f of ['collections', 'tags', 'genres']) {
    if (typeof item[f] === 'string') item[f] = item[f].split(',');
    item[f] = (item[f] || []).map((s) => String(s).trim()).filter(Boolean);
  }
  // Who can see it: public (default, left out), friends, or private.
  if (['friends', 'private'].includes(item.visibility)) item.visibility = String(item.visibility);
  else delete item.visibility;
  // Borrowing: do you own a copy, and is it lent out right now?
  if (item.owned === true || item.owned === 'true' || item.owned === 'on') item.owned = true;
  else delete item.owned;
  item.lentTo = String(item.lentTo || '').trim().slice(0, 120);
  item.lentSince = cleanDate(item.lentSince);
  if (!item.lentTo) { delete item.lentTo; delete item.lentSince; }
  else if (!item.lentSince) delete item.lentSince;
  // Progress (books, TV, legacy board games): { at, of?, unit? } with whole numbers; dropped when empty.
  if (item.legacy === true || item.legacy === 'true' || item.legacy === 'on') item.legacy = true;
  else delete item.legacy;
  const p = item.progress && typeof item.progress === 'object' ? item.progress : null;
  const at = p && p.at !== '' && p.at != null ? Math.floor(Number(p.at)) : NaN;
  if (Number.isFinite(at) && at >= 0) {
    const of = Math.floor(Number(p.of));
    item.progress = { at: Math.min(at, 1e6) };
    if (Number.isFinite(of) && of > 0) item.progress.of = Math.min(of, 1e6);
    if (['games', 'chapters', 'months', 'scenarios', 'missions'].includes(p.unit) && p.unit !== 'games') item.progress.unit = p.unit;
  } else delete item.progress;
  if (item.details && typeof item.details === 'object') {
    for (const [k, v] of Object.entries(item.details)) if (isEmpty(v)) delete item.details[k];
  }
  return item;
}

export function buildMarkdown(item, body = '') {
  const ordered = {};
  const keys = [...FIELD_ORDER, ...Object.keys(item).filter((k) => !FIELD_ORDER.includes(k))];
  for (const k of keys) {
    const v = item[k];
    if (k === 'title' || k === 'type' || k === 'status') { ordered[k] = v ?? ''; continue; }
    if (isEmpty(v)) continue;
    ordered[k] = v;
  }
  const fm = YAML.stringify(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n\n${String(body || '').trim()}\n`;
}

export function parseMarkdown(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: String(text) };
  return { data: YAML.parse(m[1]) || {}, body: m[2].trim() };
}
