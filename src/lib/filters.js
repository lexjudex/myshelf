// Shared by the filter bar (server) and filters.js (browser): what each item exposes for filtering,
// and the ranges ("bands") used by length/runtime/seasons/play-time style filters.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((x) => String(x).trim()).filter(Boolean);

/** Compact per-item data stored on each shelf slot (data-f). */
export function filterData(d) {
  const det = d.details || {};
  let min = num(det.minPlayers), max = num(det.maxPlayers);
  if (min == null && det.players != null) { const m = String(det.players).match(/(\d+)\D*(\d+)?/); if (m) { min = Number(m[1]); max = Number(m[2] || m[1]); } }
  const pt = num(det.playtime);
  const year = num(String(d.year || '').match(/\d{4}/)?.[0]);
  return {
    ty: d.type,
    r: d.rating ?? null,
    s: d.status,
    c: list(d.genres),
    y: year,
    // board games
    p: [min, max], best: det.bestPlayers || [], t: [num(det.minPlaytime) ?? pt, num(det.maxPlaytime) ?? pt], w: num(det.weight), m: list(det.mechanics),
    // books, movies, TV, music, video games
    pg: num(det.pages), rt: num(det.runtime), se: num(det.seasons), k: det.kind ? String(det.kind) : null,
    pl: list(det.platforms), nw: det.network ? String(det.network) : null,
    // sorting (the Sort menu): title without "The/A/An", creator, finished/started/added date, date added
    st: String(d.title || '').toLowerCase().replace(/^(the|a|an)\s+/, ''),
    sc: String(d.creator || '').toLowerCase(),
    sd: d.dateFinished || d.dateStarted || d.dateAdded || '',
    sa: d.dateAdded || '',
  };
}

// [value, label, low, high] — an item matches when its number is within low..high.
export const BANDS = {
  len: [['short', 'Under 200 pages', 0, 199], ['mid', '200–400 pages', 200, 400], ['long', '400+ pages', 401, Infinity]],
  run: [['short', 'Under 90 min', 0, 89], ['mid', '90 min–2 hrs', 90, 120], ['long', '2+ hrs', 121, Infinity]],
  se: [['1', '1 season', 1, 1], ['2', '2–3 seasons', 2, 3], ['4', '4+ seasons', 4, Infinity]],
};

export const decadeOf = (y) => (y ? `${Math.floor(y / 10) * 10}s` : null);
