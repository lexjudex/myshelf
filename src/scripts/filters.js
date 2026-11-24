// Filters for media pages, status pages and collections. Which groups exist is decided by the
// server (MediaFilters.astro); this file reads them from the page, filters the shelf slots in place,
// and keeps the choices in the URL so a filtered view can be bookmarked or shared.
import { BANDS, decadeOf } from '../lib/filters.js';

const root = document.getElementById('media-filters');
if (root) init();

function init() {
  // An item can sit on several shelves (a collection + its status shelf), so count unique items by their link.
  const slugOf = (el) => el.querySelector('.book3d')?.getAttribute('href') || el.dataset.f;
  const slots = [...document.querySelectorAll('.shelf-slot[data-f]')].map((el) => ({ el, slug: slugOf(el), f: JSON.parse(el.dataset.f) }));
  const total = new Set(slots.map((s) => s.slug)).size;
  const groups = [...root.querySelectorAll('.bgf-chips')].map((el) => ({ el, key: el.dataset.filter, multi: el.dataset.multi || '' }));
  const best = root.querySelector('#bgf-best');
  const noun = [root.dataset.noun || 'item', root.dataset.nouns || 'items'];

  // ── Sort: reorder the items on every shelf. '' = the shelf's own order (as the page drew it).
  slots.forEach((s, i) => (s.i = i));
  const sortSel = root.querySelector('#bgf-sort');
  const time = (v) => (v ? new Date(v).getTime() || 0 : 0);
  const by = (f) => (a, b) => f(a, b) || a.i - b.i;
  const SORTS = {
    newest: by((a, b) => time(b.f.sd) - time(a.f.sd)),
    oldest: by((a, b) => time(a.f.sd) - time(b.f.sd)),
    title: by((a, b) => (a.f.st || '').localeCompare(b.f.st || '', undefined, { numeric: true })),
    creator: by((a, b) => (a.f.sc || '~').localeCompare(b.f.sc || '~') || (a.f.st || '').localeCompare(b.f.st || '')),
    rating: by((a, b) => (b.f.r ?? -1) - (a.f.r ?? -1)),
    'year-new': by((a, b) => (b.f.y || 0) - (a.f.y || 0)),
    'year-old': by((a, b) => (a.f.y || 9999) - (b.f.y || 9999)),
  };
  const applySort = () => {
    const cmp = SORTS[sortSel?.value] || ((a, b) => a.i - b.i);
    for (const shelf of document.querySelectorAll('.bookcase .shelf')) {
      const mine = slots.filter((s) => shelf.contains(s.el)).sort(cmp);
      if (!mine.length) continue;
      const more = shelf.querySelector(':scope > .shelf-more');
      mine.forEach((s) => shelf.appendChild(s.el)); // out of any row strips; the shelf re-packs its rows
      if (more) shelf.appendChild(more);
      shelf.scrollLeft = 0;
      shelf.dispatchEvent(new CustomEvent('shelf:reorder'));
    }
  };
  if (sortSel) {
    const q0 = new URLSearchParams(location.search).get('sort');
    if (q0 && SORTS[q0]) { sortSel.value = q0; applySort(); }
    sortSel.addEventListener('change', () => { applySort(); writeUrl(); });
  }

  const state = {};
  const reset = () => {
    for (const g of groups) state[g.key] = g.multi ? [] : '';
    state.best = false;
  };
  reset();
  const q = new URLSearchParams(location.search);
  for (const g of groups) state[g.key] = g.multi ? q.getAll(g.key) : q.get(g.key) || '';
  state.best = q.get('best') === '1';

  function writeUrl() {
    const out = new URLSearchParams();
    for (const g of groups) {
      if (g.multi) state[g.key].forEach((v) => out.append(g.key, v));
      else if (state[g.key]) out.set(g.key, state[g.key]);
    }
    if (state.best && state.players) out.set('best', '1');
    if (sortSel?.value) out.set('sort', sortSel.value);
    const qs = out.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  const overlaps = (lo, hi, a, b) => hi >= a && lo <= b;
  const inBand = (key, value, n) => {
    const band = BANDS[key].find(([v]) => v === value);
    return band && n != null && n >= band[2] && n <= band[3];
  };

  // One test per filter key. Each gets the chosen value(s) and the item's data.
  const TESTS = {
    ty: (v, f) => f.ty === v,
    players: (v, f) => {
      const n = Number(v);
      const [min, max] = f.p || [];
      if (min == null || max == null) return false;
      if (n >= 6 ? max < 6 : n < min || n > max) return false;
      return !state.best || (f.best || []).some((b) => (n >= 6 ? b >= 6 : b === n));
    },
    time: (v, f) => {
      const [lo, hi] = f.t || [];
      if (lo == null) return false;
      return { 30: overlaps(lo, hi, 0, 30), 60: overlaps(lo, hi, 31, 60), 120: overlaps(lo, hi, 61, 120), long: hi > 120 }[v];
    },
    weight: (v, f) => f.w != null && (f.w < 2 ? 'light' : f.w <= 3 ? 'medium' : 'heavy') === v,
    len: (v, f) => inBand('len', v, f.pg),
    run: (v, f) => inBand('run', v, f.rt),
    se: (v, f) => inBand('se', v, f.se),
    nw: (v, f) => f.nw === v,
    k: (v, f) => f.k === v,
    rating: (v, f) => (v === 'none' ? f.r == null : f.r != null && f.r >= Number(v)),
    status: (v, f) => f.s === v,
    dec: (v, f) => decadeOf(f.y) === v,
    pl: (vs, f) => vs.some((v) => (f.pl || []).includes(v)),     // any of the chosen platforms
    mech: (vs, f) => vs.every((v) => (f.m || []).includes(v)),   // all of the chosen mechanics
    cat: (vs, f) => vs.every((v) => (f.c || []).includes(v)),    // all of the chosen genres/categories
  };

  const active = (g) => (g.multi ? state[g.key].length > 0 : Boolean(state[g.key]));
  const matches = (f) => groups.every((g) => !active(g) || !TESTS[g.key] || TESTS[g.key](state[g.key], f));
  const isFiltering = () => groups.some(active);

  function render() {
    for (const g of groups) {
      for (const chip of g.el.querySelectorAll('.bgf-chip')) {
        const v = chip.dataset.value;
        const on = g.multi ? state[g.key].includes(v) : state[g.key] === v;
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', String(on));
      }
    }
    if (best) {
      best.checked = state.best;
      best.disabled = !state.players;
      best.parentElement.classList.toggle('disabled', !state.players);
    }

    const shownItems = new Set();
    for (const s of slots) {
      const ok = matches(s.f);
      s.el.hidden = !ok;
      if (ok) shownItems.add(s.slug);
    }
    const shown = shownItems.size;
    // Shelves: update counts, hide empty ones, and tell the 3D shelf which items are visible.
    for (const section of document.querySelectorAll('.bookcase .shelf-section')) {
      const shelf = section.querySelector('.shelf');
      // Shelves with nothing on them to begin with (a "No shelves" note, an empty one shown only while editing) are left alone.
      if (!shelf || !shelf.querySelector('.shelf-slot')) continue;
      const visible = shelf.querySelectorAll('.shelf-slot:not([hidden])').length;
      const count = section.querySelector('.count-n') || section.querySelector('.count');
      if (count) count.textContent = visible;
      section.hidden = visible === 0;
      shelf.dispatchEvent(new CustomEvent('shelf:reorder'));
    }
    const filtering = isFiltering();
    root.querySelector('#bgf-summary').textContent = filtering ? `Showing ${shown} of ${total}` : `${total} ${total === 1 ? noun[0] : noun[1]}`;
    root.querySelector('#bgf-clear').hidden = !filtering;
    root.querySelector('#bgf-empty').hidden = !(filtering && shown === 0);
    writeUrl();
  }

  for (const g of groups) {
    g.el.addEventListener('click', (e) => {
      const chip = e.target.closest('.bgf-chip');
      if (!chip) return;
      const v = chip.dataset.value;
      if (g.multi) {
        state[g.key] = state[g.key].includes(v) ? state[g.key].filter((x) => x !== v) : [...state[g.key], v];
      } else {
        state[g.key] = state[g.key] === v ? '' : v; // tap again to turn off
        if (g.key === 'players' && !state.players) state.best = false;
      }
      render();
    });
  }
  best?.addEventListener('change', () => { state.best = best.checked; render(); });
  const clear = () => { reset(); render(); };
  root.querySelector('#bgf-clear').addEventListener('click', clear);
  root.querySelector('[data-clear]').addEventListener('click', clear);
  const toggle = root.querySelector('.bgf-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    root.classList.toggle('collapsed', !open);
  });
  // Start closed on every device, unless the page was opened with filters already set (bookmark).
  if (!isFiltering()) { toggle.setAttribute('aria-expanded', 'false'); root.classList.add('collapsed'); }
  render();
}
