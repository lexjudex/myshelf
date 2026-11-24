// Shelf sort orders. Used by the public pages and (labels) by the admin.
export const SORTS = {
  newest:   'Newest first',
  oldest:   'Oldest first',
  title:    'Title A–Z',
  creator:  'Creator A–Z',
  rating:   'Rating (highest first)',
  'year-new': 'Release year (newest)',
  'year-old': 'Release year (oldest)',
  custom:   'Custom (drag to arrange)',
};

const when = (d) => {
  const v = d.dateFinished || d.dateStarted || d.dateAdded;
  return v ? new Date(v).getTime() : 0;
};
const added = (d) => (d.dateAdded ? new Date(d.dateAdded).getTime() : 0);
const titleKey = (t) => String(t || '').toLowerCase().replace(/^(the|a|an)\s+/, '');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const year = (d) => parseInt(d.year, 10) || null;

/** Sort entries ({ id, data }) for a shelf with { sort, order }. Returns a new array. */
export function sortShelf(entries, shelf = {}) {
  const list = [...entries];
  const by = shelf.sort || 'newest';
  const recent = (a, b) => when(b.data) - when(a.data);
  switch (by) {
    case 'oldest': return list.sort((a, b) => when(a.data) - when(b.data));
    case 'title': return list.sort((a, b) => cmp(titleKey(a.data.title), titleKey(b.data.title)));
    case 'creator': return list.sort((a, b) => cmp(String(a.data.creator || '~').toLowerCase(), String(b.data.creator || '~').toLowerCase()) || cmp(titleKey(a.data.title), titleKey(b.data.title)));
    case 'rating': return list.sort((a, b) => (b.data.rating ?? -1) - (a.data.rating ?? -1) || recent(a, b));
    case 'year-new': return list.sort((a, b) => (year(b.data) ?? -Infinity) - (year(a.data) ?? -Infinity) || recent(a, b));
    case 'year-old': return list.sort((a, b) => (year(a.data) ?? Infinity) - (year(b.data) ?? Infinity) || recent(a, b));
    case 'custom': {
      const ordered = arrangeOrder(list.map((e) => ({ slug: e.id, dateAdded: e.data.dateAdded, e })), shelf.order);
      return ordered.map((x) => x.e);
    }
    default: return list.sort(recent);
  }
}

/**
 * Custom order: items you haven't arranged yet (i.e. newly added) come FIRST, newest added first;
 * then everything you arranged, in your order. Works on plain objects with { slug, dateAdded }.
 */
export function arrangeOrder(items, order = []) {
  const pos = new Map((order || []).map((slug, i) => [slug, i]));
  const t = (i) => (i.dateAdded ? new Date(i.dateAdded).getTime() : 0);
  return [...items].sort((a, b) => {
    const ia = pos.has(a.slug), ib = pos.has(b.slug);
    if (ia && ib) return pos.get(a.slug) - pos.get(b.slug);
    if (!ia && !ib) return t(b) - t(a);
    return ia ? 1 : -1;
  });
}

/** Automatic collections: items with this status are included without being added by hand. */
export const AUTO_RULES = { 'in-progress': 'In progress', finished: 'Finished', want: 'Want to' };

/** Is a plain item ({ collections, status }) on this shelf? Works for manual and automatic collections. */
/** Time windows a collection can be limited to (days). */
export const WITHIN_OPTIONS = { '': 'All time', 30: 'Last 30 days', 90: 'Last 3 months', 182: 'Last 6 months', 365: 'Last year', 730: 'Last 2 years' };

/** The date that decides whether an item is "recent" for a collection. */
function windowDate(item, shelf) {
  const by = { finished: item.dateFinished, 'in-progress': item.dateStarted, want: item.dateAdded }[shelf.auto];
  return by || item.dateFinished || item.dateStarted || item.dateAdded || null;
}

/** Does a collection fill itself (by status and/or rating) instead of you adding items by hand? */
export const isAutoShelf = (shelf) => Boolean(shelf?.auto || shelf?.minRating);

/** For automatic collections: does this item meet the rules (status, minimum rating)? */
export function autoMatch(item, shelf) {
  if (!isAutoShelf(shelf)) return false;
  if (shelf.auto && item.status !== shelf.auto) return false;
  if (shelf.minRating && !(Number(item.rating) >= Number(shelf.minRating))) return false;
  return true;
}

/** Ratings a collection can require (Favorites = 5 stars). */
export const RATING_RULES = [3, 3.5, 4, 4.5, 5];

/**
 * Starter shelves: ready-made automatic collections a new site can add to its Shelves page in one click
 * (Manage → Collections, or the welcome box on first sign-in). Recognized by their rules, not their names,
 * so renaming one keeps it ticked.
 */
export const STARTER_SHELVES = [
  { key: 'currently', label: 'Currently', hint: 'Everything you’re reading, watching, listening to or playing now',
    collection: { slug: 'currently', name: 'Currently', description: '', auto: 'in-progress' } },
  { key: 'recently-finished', label: 'Recently Finished', hint: 'Things you finished in the last year, newest first',
    collection: { slug: 'recently-finished', name: 'Recently Finished', description: '', auto: 'finished', within: 365 } },
  { key: 'favorites', label: 'Favorites', hint: 'Everything you’ve rated 5 stars',
    collection: { slug: 'favorites', name: 'Favorites', description: '', minRating: 5 } },
];
// Same rules = same status and rating rule; a time window counts only as "has one or not" (a Recently Finished
// kept for 6 months is still Recently Finished).
const sameRules = (c, s) => (c.auto || '') === (s.auto || '') && Number(c.minRating || 0) === Number(s.minRating || 0) && !c.within === !s.within;
/** The collection in this list that is the given starter shelf, if you have it. */
export const findStarter = (collections, starter) => (collections || []).find((c) => sameRules(c, starter.collection))
  || (collections || []).find((c) => c.slug === starter.collection.slug && isAutoShelf(c));

export function inShelf(item, shelf, now = Date.now()) {
  const member = (item.collections || []).includes(shelf.slug) || autoMatch(item, shelf);
  if (!member || !shelf.within) return member;
  const d = windowDate(item, shelf);
  if (!d) return true; // no date to judge by: keep it
  return now - new Date(d).getTime() <= Number(shelf.within) * 86400000;
}

/** Where a collection appears: 'shelves' (home page, default), 'type' (media pages), 'both', or 'none' (kept, not shown). */
export const SHOW_OPTIONS = { shelves: 'Shelves page', type: 'Media pages', both: 'Both', none: 'Nowhere (hidden)' };
export const showsOnHome = (c) => !c.show || c.show === 'shelves' || c.show === 'both';
export const showsOnType = (c) => c.show === 'type' || c.show === 'both';

// After "Edit shelves" on a media page: what each media page hides. hidden lists status shelves by status and
// collections as 'c:<slug>'. On this page, kept shelves come back and removed ones are hidden (only here).
// turnedOn: collections that weren't on any media page before (or are brand new); they start out on this page only.
export function hiddenAfterEdit({ page, pages, kept = [], removed = [], layouts = {}, turnedOn = [] }) {
  const key = (id) => (id.startsWith('s:') ? id.slice(2) : id);
  const keptKeys = new Set(kept.map(key));
  const out = {};
  out[page] = [...new Set([...(layouts[page]?.hidden || []).filter((h) => !keptKeys.has(h)), ...removed.map(key)])];
  for (const p of pages) {
    if (p === page || !turnedOn.length) continue;
    out[p] = [...new Set([...(layouts[p]?.hidden || []), ...turnedOn.map((s) => `c:${s}`)])];
  }
  return out;
}
