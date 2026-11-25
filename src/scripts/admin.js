// Admin UI: search external databases, add/edit/delete items, manage collections.
import { marked } from 'marked';
import { mentionsHtml, mentionsPlain } from '../lib/mentions.js';
import { SORTS, sortShelf, inShelf, AUTO_RULES, SHOW_OPTIONS, WITHIN_OPTIONS, RATING_RULES, isAutoShelf, autoMatch, STARTER_SHELVES, findStarter } from '../lib/sorting.js';
import { openArrange, updateItem as updateArrangeItem } from './arrange.js';
import Sortable from 'sortablejs';
import { isLegacy, progressTotal, progressOf } from '../lib/types.js';
import { localDate } from '../lib/dates.js';
import { drawShareCard, CARD_W, CARD_H } from '../lib/share-card.js';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = $('#admin');
const TYPES = JSON.parse(root.dataset.types);
const TOKEN_KEY = 'myshelf_token';
// /admin/?embed=1#edit=<slug>: just the item editor, in a frame over a public shelf (see edit-shelves.js).
const EMBED = new URLSearchParams(location.search).has('embed');
const tellParent = (msg) => { if (EMBED && window.parent !== window) window.parent.postMessage(msg, location.origin); };

const state = {
  type: 'book',
  results: [],
  library: [],
  collections: [],
  editing: null, // { slug?, source? }
  saved: {},          // items saved in this session (for the preview dialog)
  previewSlug: null,
  addTo: null,        // collection slug picked via "＋ Add more": pre-checked on new entries
  afterSave: null,    // (slug, item) => …: run instead of the preview after saving (editing from a shelf's pencil)
};

// ───────── helpers ─────────
function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${getToken()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { showLogin('Your token was rejected.'); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const libraryHeaders = () => ({ authorization: `Bearer ${getToken()}` });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 7000 : 4500);
}
function coverThumb(item, size = 64) {
  const t = TYPES[item.type] || TYPES.book;
  const w = Math.round(size * t.aspect);
  const ph = `<span class="thumb-ph" style="width:${w}px;height:${size}px;background:${t.color}">${esc((item.title || '?').slice(0, 1))}</span>`;
  if (!item.cover) return ph;
  return `<span class="thumb-wrap"><img class="thumb" src="${esc(item.shelfCover || item.cover)}" alt="" style="height:${size}px" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(this.nextElementSibling.content.cloneNode(true))"><template>${ph}</template></span>`;
}
const SOURCE_NAMES = { openlibrary: 'Open Library', googlebooks: 'Google Books', tmdb: 'TMDB', spotify: 'Spotify', musicbrainz: 'MusicBrainz', igdb: 'IGDB', bgg: 'BoardGameGeek', youtube: 'YouTube', manual: 'Manual' };

// ───────── auth ─────────
function showLogin(error) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const err = $('#login-error');
  err.hidden = !error;
  err.textContent = error || '';
}
async function boot() {
  if (!getToken()) { tellParent({ type: 'myshelf:edit-closed', error: 'Sign in on the Manage page first.' }); return showLogin(); }
  try {
    const ping = await api('ping');
    $('#login').hidden = true;
    $('#app').hidden = false;
    renderConfig(ping.configured, ping.types);
    renderStorage(ping);
    await Promise.all([loadLibrary(), loadCollections()]);
    handleHash();
    document.dispatchEvent(new CustomEvent('myshelf:ready'));
  } catch (e) {
    if (e.message !== 'Unauthorized') showLogin(e.message.includes('Failed to fetch') ? 'Could not reach the API.' : e.message);
  }
}
// Only keys for media types this site shows: turn off Board Games and nobody asks you for a BGG key.
let lastConfig = null;
function renderConfig(c, types) {
  lastConfig = { c, types: types || lastConfig?.types || null };
  const on = (...ts) => !lastConfig.types || ts.some((t) => lastConfig.types.includes(t));
  const missing = [];
  if (!c.tmdb && on('movie', 'tv')) missing.push('TMDB');
  if (!c.igdb && on('videogame')) missing.push('IGDB');
  if (!c.bgg && on('boardgame')) missing.push('BGG');
  if (!c.spotify && on('music')) missing.push('Spotify (using MusicBrainz)');
  // Optional, but it keeps book search working when Open Library is down.
  if (c.googleBooks === false && on('book')) missing.push('Google Books (optional)');
  $('#config-status').innerHTML = missing.length
    ? `<a class="warn" href="#api-keys" data-goto-keys title="Add them in Settings → API keys">Missing keys: ${esc(missing.join(', '))}</a>`
    : '<span class="okay">All sources connected</span>';
}
// Settings → API keys tells us when keys change, so the header stays right without signing in again.
document.addEventListener('myshelf:keys-changed', async () => {
  try { const ping = await api('ping'); renderConfig(ping.configured, ping.types); } catch {}
});
// "Missing keys" in the header (and the Updates hints) jump to Settings → API keys.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto-keys]');
  if (!a) return;
  e.preventDefault();
  showTab('settings');
  requestAnimationFrame(() => $('#api-keys')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
});
// Storage status + one-time import of the old Git-based entries.
function renderStorage(ping) {
  const el = $('#storage-banner');
  const s = ping.storage || {};
  const missing = [!s.db && 'a D1 database binding named <code>DB</code>', !s.covers && 'a KV namespace binding named <code>COVERS</code>'].filter(Boolean);
  if (missing.length) {
    el.innerHTML = `<strong>Storage isn’t connected yet.</strong> Your Worker is missing ${missing.join(' and ')}. Check wrangler.jsonc (or Worker → Settings → Bindings), then redeploy.`;
    el.className = 'storage-banner warn';
    el.hidden = false;
    return;
  }
  if (ping.toImport > 0) {
    el.innerHTML = `<span><strong>${ping.toImport} entr${ping.toImport === 1 ? 'y' : 'ies'}</strong> from your old Git-based shelf ${ping.toImport === 1 ? 'isn’t' : 'aren’t'} in the database yet.</span>
      <button type="button" class="btn primary small" id="import-btn">Import now</button> <span id="import-msg" class="muted small"></span>`;
    el.className = 'storage-banner';
    el.hidden = false;
    return;
  }
  el.hidden = true;
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#import-btn');
  if (!btn) return;
  btn.disabled = true;
  let total = 0;
  try {
    for (let i = 0; i < 100; i++) {
      const res = await api('import', { method: 'POST', body: {} });
      total += res.imported.length;
      $('#import-msg').textContent = `Imported ${total}… ${res.remaining ? `${res.remaining} to go` : ''}`;
      if (!res.remaining || !res.imported.length) break;
    }
    await Promise.all([loadLibrary(), loadCollections()]);
    renderStorage(await api('ping'));
    toast(`Imported ${total} entr${total === 1 ? 'y' : 'ies'}. Your shelves are live.`);
  } catch (err) {
    btn.disabled = false;
    toast(err.message, 'error');
  }
});

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  setToken($('#login-token').value.trim());
  boot();
});
$('#logout').addEventListener('click', () => { setToken(''); showLogin(); });

// ───────── tabs ─────────
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tabpanel').forEach((p) => (p.hidden = p.dataset.panel !== name));
  document.dispatchEvent(new CustomEvent('myshelf:tab', { detail: name }));
}
// From the Friends tab: "Add it" on a recommendation searches for it here.
document.addEventListener('myshelf:search', (e) => {
  const { type, title } = e.detail || {};
  showTab('add');
  if (type && TYPES[type]) $(`.type-btn[data-type="${type}"]`)?.click();
  $('#search-q').value = title || '';
  $('#search-form').requestSubmit();
});
document.addEventListener('myshelf:library-changed', () => Promise.all([loadLibrary(), loadCollections()]));
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// Settings saved with different media turned on/off: redo the missing-keys note.
document.addEventListener('myshelf:types', (e) => { if (lastConfig) renderConfig(lastConfig.c, e.detail); });

// ───────── search ─────────
$$('.type-btn').forEach((b) =>
  b.addEventListener('click', () => {
    state.type = b.dataset.type;
    $$('.type-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('#search-q').placeholder = `Search ${state.type === 'video' ? 'YouTube' : TYPES[state.type].plural.toLowerCase()}…`;
    syncLinkForm();
    $('#results').innerHTML = '';
    $('#search-msg').textContent = '';
    $('#search-q').focus();
  }),
);

// "Paste a link" — Open Library for books, BoardGameGeek for board games, Spotify for music, YouTube for videos and channels.
const LINK_FORMS = {
  book: {
    placeholder: 'Can\'t find it? Paste an Open Library link…',
    ok: (url) => /openlibrary\.org\/(works\/OL\d+W|books\/OL\d+M|isbn\/[\dXx-]{10,17})/i.test(url),
    error: 'That doesn\'t look like an Open Library book link (openlibrary.org/works/… or openlibrary.org/books/…).',
  },
  boardgame: {
    placeholder: 'Can\'t find it? Paste a BoardGameGeek link…',
    ok: (url) => /boardgamegeek\.com\/(boardgame|boardgameexpansion|thing)\/\d+/i.test(url),
    error: 'That doesn\'t look like a BoardGameGeek game link (boardgamegeek.com/boardgame/…).',
  },
  music: {
    placeholder: 'Paste a Spotify album, song or playlist link…',
    ok: (url) => /open\.spotify\.com\/(intl-[a-z-]+\/)?(album|track|playlist)\/\w+|^spotify:(album|track|playlist):\w+|^https?:\/\/(spotify\.link|spoti\.fi)\//i.test(url),
    error: 'That doesn\'t look like a Spotify link. In Spotify, use Share → Copy link on an album, song or playlist.',
  },
  video: {
    placeholder: 'Paste a YouTube video or channel link…',
    ok: (url) => /(youtube\.com\/(watch\?|shorts\/|live\/|embed\/|@|channel\/|c\/|user\/)|youtu\.be\/)/i.test(url) || /^@[\w.-]{2,}$/.test(url),
    error: 'That doesn\'t look like a YouTube link. Use Share → Copy link on a video, or copy a channel\'s address.',
  },
};
function syncLinkForm() {
  const f = LINK_FORMS[state.type];
  $('#link-form').hidden = !f;
  if (f) $('#link-url').placeholder = f.placeholder;
}
syncLinkForm();

// ───────── friends' takes: has a friend rated or written about this? ─────────
// Loaded once (in the background) the first time you search; matched by the shared database key, or else by title.
let takesPromise = null;
const loadTakes = () => (takesPromise ||= api('friends?takes=1').then((d) => d.takes || []).catch(() => []));
const normTitle = (t) => String(t || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '');
function takesFor(takes, { type, source, sourceId, title, year }) {
  const key = source && sourceId ? `${type}:${source}:${sourceId}` : '';
  const t = normTitle(title);
  const seen = new Set();
  return takes.filter((k) => {
    if (k.type !== type) return false;
    const same = (key && k.extKey === key) || (t && normTitle(k.title) === t && (!year || !k.year || String(k.year) === String(year)));
    if (!same || seen.has(k.friend.url)) return false;
    seen.add(k.friend.url);
    return true;
  });
}
const takeStars = (r) => (r == null ? '' : '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : ''));
function takesHtml(list, { open = false } = {}) {
  if (!list.length) return '';
  const names = list.map((k) => k.friend.name);
  const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return `<details class="takes"${open ? ' open' : ''}>
    <summary><span class="takes-dot" aria-hidden="true"></span>${esc(who)} ${list.length === 1 ? 'has' : 'have'} this on their shelf</summary>
    <ul>${list.map((k) => `<li>
      <p class="take-who"><strong>${esc(k.friend.name)}</strong> ${k.rating != null ? `<span class="take-stars">${takeStars(k.rating)}</span>` : ''}
        <span class="muted small">${esc(TYPES[k.type] ? { finished: TYPES[k.type].verb, 'in-progress': TYPES[k.type].doing, want: TYPES[k.type].want, abandoned: TYPES[k.type].dropped }[k.status] || '' : '')}</span>
        ${k.url ? `<a class="small" href="${esc(k.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</p>
      ${k.review ? `<p class="take-text">${esc(mentionsPlain(k.review).length > 320 ? `${mentionsPlain(k.review).slice(0, 320).replace(/\s+\S*$/, '')}…` : mentionsPlain(k.review))}</p>` : ''}
    </li>`).join('')}</ul>
  </details>`;
}

async function runSearch(q) {
  $('#search-msg').textContent = 'Searching…';
  $('#results').innerHTML = '';
  const takesLoading = loadTakes();
  try {
    const { results } = await api(`search?type=${state.type}&q=${encodeURIComponent(q)}`);
    state.results = results;
    $('#search-msg').textContent = results.length ? `${results.length} result${results.length === 1 ? '' : 's'} — pick one to add it.` : 'No matches. Try different words, or add it manually.';
    $('#results').innerHTML = results
      .map((r, i) => `
        <div class="result-wrap" data-i="${i}">
          <button type="button" class="result" data-i="${i}">
            ${coverThumb(r, 96)}
            <span class="result-text">
              <strong>${esc(r.title)}</strong>
              <span>${esc(r.creator)}${r.creator && r.year ? ' · ' : ''}${esc(r.year)}</span>
              ${r.details?.kind ? `<span class="muted small">${esc(r.details.kind)}</span>` : ''}
              <span class="src">${esc(SOURCE_NAMES[r.source] || r.source)}</span>
            </span>
          </button>
          <div class="result-takes"></div>
        </div>`)
      .join('');
    // Friends' takes fill in when they arrive (friends' sites can be slow).
    const takes = await takesLoading;
    if (takes.length && state.results === results) {
      $$('#results .result-wrap').forEach((w) => { w.querySelector('.result-takes').innerHTML = takesHtml(takesFor(takes, results[Number(w.dataset.i)])); });
    }
  } catch (err) {
    $('#search-msg').textContent = '';
    toast(err.message, 'error');
  }
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-q').value.trim();
  if (q.length >= 2) runSearch(q);
});

$('#link-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#link-url').value.trim();
  const f = LINK_FORMS[state.type];
  if (!f) return;
  if (!f.ok(url)) {
    toast(f.error, 'error');
    return;
  }
  runSearch(url);
});

$('#results').addEventListener('click', async (e) => {
  const btn = e.target.closest('.result');
  if (!btn) return;
  const r = { ...state.results[Number(btn.dataset.i)] };
  btn.classList.add('loading');
  try {
    if (r.source === 'tmdb' || r.source === 'openlibrary') {
      const { details } = await api(`details?type=${r.type}&source=${r.source}&id=${encodeURIComponent(r.sourceId)}`);
      Object.assign(r, {
        ...details,
        creator: details.creator || r.creator,
        description: details.description || r.description,
        genres: details.genres?.length ? details.genres : r.genres,
        details: { ...r.details, ...(details.details || {}) },
      });
    }
  } catch (err) {
    console.warn(err);
  } finally {
    btn.classList.remove('loading');
  }
  openEditor({
    title: r.title, type: r.type, creator: r.creator, year: r.year, cover: r.cover,
    status: '', description: r.description, genres: r.genres, details: r.details,
    source: { name: SOURCE_NAMES[r.source] || r.source, id: r.sourceId, url: r.url },
  });
});

// ───────── add something a friend has (or recommended) straight into the editor ─────────
// ref: { title, type, creator, year, cover, source: { name, id, url } } from a friend's shelf or a recommendation.
// Same database id as theirs, so your shelves match up ("You have this"); fuller details are fetched where we can.
async function addFromRef(ref = {}) {
  if (!ref.title || !TYPES[ref.type]) return toast('That item is missing its title or type.', 'error');
  const src = ref.source && typeof ref.source === 'object' ? ref.source : {};
  const key = Object.keys(SOURCE_NAMES).find((k) => SOURCE_NAMES[k] === src.name || k === src.name) || '';
  const item = {
    title: String(ref.title).slice(0, 200), type: ref.type, creator: ref.creator || '', year: ref.year ? String(ref.year) : '',
    cover: /^https?:\/\//.test(ref.cover || '') ? ref.cover : '', status: '',
    source: key && key !== 'manual' && src.id ? { name: SOURCE_NAMES[key], id: String(src.id), url: src.url || '' } : { name: 'Manual' },
  };
  showTab('add');
  if (key && src.id && ['tmdb', 'openlibrary', 'bgg'].includes(key)) {
    try {
      const { details } = await api(`details?type=${item.type}&source=${key}&id=${encodeURIComponent(src.id)}`);
      Object.assign(item, {
        creator: details.creator || item.creator,
        description: details.description || '',
        genres: details.genres || [],
        details: details.details || {},
      });
    } catch (err) { console.warn(err); }
  }
  openEditor(item);
}
document.addEventListener('myshelf:add-item', (e) => addFromRef(e.detail || {}));

$('#manual-add').addEventListener('click', () =>
  openEditor({ type: state.type, status: '', title: $('#search-q').value.trim(), source: { name: 'Manual' } }),
);

// ───────── editor ─────────
const editor = $('#editor');
const form = $('#editor-form');

function detailsToText(details = {}) {
  return Object.entries(details)
    .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}
function textToDetails(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([\w-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, k, v] = m;
    const listy = ['platforms', 'cast', 'developers', 'publishers', 'designers', 'mechanics', 'bestPlayers', 'recPlayers'].includes(k);
    const numList = ['bestPlayers', 'recPlayers'].includes(k);
    out[k] = listy
      ? v.split(',').map((s) => s.trim()).filter(Boolean).map((x) => (numList ? Number(x) : x)).filter((x) => !numList || Number.isFinite(x))
      : /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v.trim();
  }
  return out;
}
function renderCoverPreview() {
  const item = { type: form.type.value, title: form.title.value, cover: form.cover.value.trim() };
  $('#cover-preview').innerHTML = coverThumb(item, 240);
}
const editorAutoItem = () => ({ status: form.status.value, rating: form.rating.value === '' ? null : Number(form.rating.value) });
function syncAutoChecks() {
  $$('#editor-collections input[data-auto-i]').forEach((cb) => (cb.checked = autoMatch(editorAutoItem(), state.collections[Number(cb.dataset.autoI)] || {})));
}
form.rating.addEventListener('change', syncAutoChecks);
function renderCollectionChecks(selected = []) {
  $('#editor-collections').innerHTML = state.collections.length
    ? state.collections
        .map((c, i) => isAutoShelf(c)
          ? `<label class="check muted" title="Fills automatically from ${c.minRating ? (c.auto ? 'status and rating' : 'rating') : 'status'}"><input type="checkbox" disabled ${autoMatch(editorAutoItem(), c) ? 'checked' : ''} data-auto-i="${i}"> ${esc(c.name)} <span class="small">(automatic)</span></label>`
          : `<label class="check"><input type="checkbox" value="${esc(c.slug)}" ${selected.includes(c.slug) ? 'checked' : ''}> ${esc(c.name)}</label>`)
        .join('')
    : '<span class="muted small">No collections yet — create some in the Collections tab.</span>';
}
function updateCreatorLabel() {
  const t = TYPES[form.type.value] || TYPES.book;
  $('#creator-label').textContent = t.creator;
  // Status wording matches the media type (e.g. music: Listened / On repeat / Want to listen / Not for me).
  const words = { finished: t.verb, 'in-progress': t.doing, want: t.want, abandoned: t.dropped || 'Abandoned' };
  for (const opt of form.status.options) opt.textContent = words[opt.value] || opt.textContent;
}

// ───────── remember the last status, dates, collections and "I own a copy" used per type (new entries only) ─────────
const LAST_KEY = 'myshelf_last_settings';
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } };
function rememberSettings(item) {
  const all = readLast();
  all[item.type] = { status: item.status || '', dateStarted: item.dateStarted || '', dateFinished: item.dateFinished || '', collections: item.collections || [], owned: item.owned === true };
  try { localStorage.setItem(LAST_KEY, JSON.stringify(all)); } catch {}
}
function forgetSettings(type) {
  const all = readLast();
  delete all[type];
  try { localStorage.setItem(LAST_KEY, JSON.stringify(all)); } catch {}
}
function withLastSettings(item) {
  const last = readLast()[item.type || 'book'];
  if (!last) return { item, used: false };
  return {
    used: true,
    item: {
      ...item,
      status: item.status || last.status,
      dateStarted: item.dateStarted || last.dateStarted,
      dateFinished: item.dateFinished || last.dateFinished,
      collections: item.collections?.length ? item.collections : last.collections,
      owned: item.owned === true || last.owned === true,
    },
  };
}
$('#editor-forget').addEventListener('click', () => {
  forgetSettings(form.type.value);
  form.status.value = '';
  form.dateStarted.value = '';
  form.dateFinished.value = '';
  renderCollectionChecks([]);
  form.owned.checked = false;
  $('#editor-remembered').hidden = true;
});

function openEditor(item, slug = null) {
  let remembered = false;
  if (!slug) ({ item, used: remembered } = withLastSettings(item));
  if (!slug && state.addTo && !(item.collections || []).includes(state.addTo)) item = { ...item, collections: [...(item.collections || []), state.addTo] };
  $('#editor-remembered').hidden = !remembered;
  state.editing = { slug, source: item.source || {}, extra: item };
  const sb = $('#editor-save');
  delete sb.dataset.confirmDup;
  sb.classList.remove('warn-btn');
  sb.textContent = 'Save to shelf';
  $('#editor-title').textContent = slug ? `Edit: ${item.title}` : `Add ${TYPES[item.type]?.label || 'item'}`;
  form.title.value = item.title || '';
  form.creator.value = item.creator || '';
  form.year.value = item.year || '';
  form.type.value = item.type || 'book';
  form.status.value = item.status || '';
  form.rating.value = item.rating == null ? '' : String(item.rating);
  form.dateStarted.value = item.dateStarted || '';
  // A finished date only belongs to Finished entries; older entries that changed status lose a stale one here.
  form.dateFinished.value = item.status === 'finished' ? item.dateFinished || '' : '';
  delete form.dataset.stashedFinished;
  form.cover.value = item.cover || '';
  form.tags.value = (item.tags || []).join(', ');
  form.genres.value = (item.genres || []).join(', ');
  form.description.value = item.description || '';
  form.details.value = detailsToText(item.details);
  form.body.value = item.body || '';
  form.featured.checked = item.featured === true;
  form.visibility.value = ['friends', 'private'].includes(item.visibility) ? item.visibility : 'public';
  form.owned.checked = item.owned === true;
  form.lentTo.value = item.lentTo || '';
  form.lentSince.value = item.lentSince || '';
  form.legacy.checked = item.legacy === true || isLegacy(item);
  const prog = item.progress || {};
  form.progressAt.value = prog.at ?? '';
  form.progressOf.value = prog.of ?? '';
  form.progressUnit.value = prog.unit || 'games';
  syncFields();
  updateFeaturedHint();
  const src = item.source || {};
  $('#editor-source').innerHTML = src.url ? `From <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>` : esc(src.name || '');
  renderCollectionChecks(item.collections || []);
  state.editing.expansions = (item.expansions || []).map((x) => ({ ...x }));
  resetExpansionSearch();
  renderExpansionsField();
  $('#editor-refresh-bgg').hidden = !(slug && (item.type || 'book') === 'boardgame');
  updateCreatorLabel();
  renderCoverPreview();
  showEditorTakes(item, slug);
  editor.showModal();
  form.title.focus();
}

// In the editor: what friends thought of this, while you write your own (new entries and edits alike).
async function showEditorTakes(item, slug) {
  const box = $('#editor-takes');
  box.hidden = true;
  box.innerHTML = '';
  const src = item.source || {};
  const source = Object.keys(SOURCE_NAMES).find((k) => SOURCE_NAMES[k] === src.name) || '';
  const list = takesFor(await loadTakes(), { type: item.type, source, sourceId: src.id, title: item.title, year: item.year });
  if (state.editing?.slug !== slug || !editor.open) return;
  box.innerHTML = takesHtml(list, { open: !slug });
  box.hidden = !list.length;
}

// Only one entry is featured at a time; say which one this would replace.
function updateFeaturedHint() {
  const slug = state.editing?.slug;
  const current = libraryItems().find((i) => i.featured && i.slug !== slug);
  const hint = $('#featured-hint');
  const parts = [];
  if (form.featured.checked && current) parts.push(`Replaces “${esc(current.title)}” as the featured entry.`);
  else if (!form.featured.checked && current) parts.push(`Currently featured: “${esc(current.title)}”.`);
  else if (!form.featured.checked && !current) parts.push('Nothing featured — the home page shows your most recent journal entry.');
  if (form.featured.checked && !form.body.value.trim()) parts.push('Add some notes above, or the home page will fall back to your most recent entry.');
  hint.innerHTML = parts.join(' ');
}
form.featured.addEventListener('change', updateFeaturedHint);
form.body.addEventListener('input', () => { if (form.featured.checked) updateFeaturedHint(); });

form.cover.addEventListener('input', renderCoverPreview);
form.type.addEventListener('change', () => { updateCreatorLabel(); renderCoverPreview(); renderExpansionsField(); syncFields(); });
['owned', 'legacy'].forEach((n) => form[n].addEventListener('change', syncFields));
['progressAt', 'progressOf', 'progressUnit'].forEach((n) => form[n].addEventListener('input', syncProgressText));

// ───────── only the fields that fit this kind of media and status ─────────
// Hidden fields aren't saved (see the submit handler), so nothing stale lingers: no "lent to" without a copy,
// no rating on something you haven't tried yet, no finished date on something you're still reading.
const PHYSICAL = new Set(['book', 'movie', 'tv', 'music', 'videogame', 'boardgame']); // things you can own and lend
function fieldsShown() {
  const type = form.type.value;
  const status = form.status.value;
  const owned = PHYSICAL.has(type) && form.owned.checked;
  return {
    rating: status !== 'want',
    dateStarted: status !== 'want',
    dateFinished: status === 'finished',
    legacy: type === 'boardgame',
    progress: ['in-progress', 'abandoned'].includes(status) && (type === 'book' || type === 'tv' || (type === 'boardgame' && form.legacy.checked)),
    owned: PHYSICAL.has(type),
    lent: owned,
  };
}
// The item as the editor has it now (enough for the progress rules).
const editorDraft = () => ({
  type: form.type.value,
  status: form.status.value,
  legacy: form.legacy.checked,
  details: { ...(state.editing?.extra?.details || {}), ...textToDetails(form.details.value) },
  progress: { at: form.progressAt.value, of: form.progressOf.value, unit: form.progressUnit.value },
});
function syncFields() {
  const shown = fieldsShown();
  $$('[data-field]', form).forEach((el) => { el.hidden = !shown[el.dataset.field]; });
  const type = form.type.value;
  $('#progress-legend').textContent = type === 'boardgame' ? 'Campaign progress' : 'Progress';
  $('#progress-at-label').textContent = type === 'book' ? 'Page' : type === 'tv' ? 'Episode' : 'Played';
  form.progressUnit.hidden = type !== 'boardgame';
  form.progressOf.placeholder = String(progressTotal(editorDraft()) || (type === 'boardgame' ? 'total' : '?'));
  syncProgressText();
}
function syncProgressText() {
  const p = progressOf({ ...editorDraft(), status: 'in-progress' });
  $('#progress-pct').textContent = p?.pct != null ? `${p.pct}%` : '';
}
form.status.addEventListener('change', () => {
  syncAutoChecks();
  syncFields();
  const today = localDate();
  // Moving off Finished clears the finished date; switching back brings it back (or today's date).
  if (form.status.value !== 'finished' && form.dateFinished.value) {
    form.dataset.stashedFinished = form.dateFinished.value;
    form.dateFinished.value = '';
  }
  if (form.status.value === 'finished' && !form.dateFinished.value) form.dateFinished.value = form.dataset.stashedFinished || today;
  if (form.status.value === 'in-progress' && !form.dateStarted.value) form.dateStarted.value = today;
});
// × buttons next to the date fields (phone date pickers often have no way to empty them).
$$('[data-clear-date]', editor).forEach((b) => b.addEventListener('click', () => {
  form[b.dataset.clearDate].value = '';
  if (b.dataset.clearDate === 'dateFinished') delete form.dataset.stashedFinished;
}));
$$('[data-close]', editor).forEach((b) => b.addEventListener('click', () => editor.close()));
editor.addEventListener('close', () => {
  state.afterSave = null;
  tellParent({ type: 'myshelf:edit-closed' });
});
$('#add-entry').addEventListener('click', () => {
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const ta = form.body;
  ta.value = `${ta.value.trimEnd()}${ta.value.trim() ? '\n\n' : ''}**${date}** — `;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = $('#editor-save');
  const { slug, source, extra } = state.editing;
  const item = {
    ...(slug ? extra : {}), // keep any extra frontmatter fields you added by hand
    title: form.title.value.trim(),
    type: form.type.value,
    creator: form.creator.value.trim(),
    year: form.year.value.trim(),
    cover: form.cover.value.trim(),
    status: form.status.value,
    rating: form.rating.value === '' ? null : Number(form.rating.value),
    dateStarted: form.dateStarted.value || null,
    dateFinished: form.dateFinished.value || null,
    collections: $$('#editor-collections input:checked:not([disabled])').map((i) => i.value),
    tags: form.tags.value,
    genres: form.genres.value,
    description: form.description.value.trim(),
    details: textToDetails(form.details.value),
    source,
    expansions: form.type.value === 'boardgame' ? state.editing.expansions || [] : [],
    featured: form.featured.checked,
    visibility: form.visibility.value,
    owned: form.owned.checked,
    lentTo: form.lentTo.value.trim(),
    lentSince: form.lentTo.value.trim() ? form.lentSince.value || localDate() : null,
    ...(slug ? {} : { dateAdded: localDate() }), // your date, not the server's (UTC)
    legacy: form.type.value === 'boardgame' && form.legacy.checked,
    progress: { at: form.progressAt.value, of: form.progressOf.value, unit: form.progressUnit.value },
  };
  delete item.body;
  // Fields hidden for this media and status are left out, so nothing stale is saved.
  const shown = fieldsShown();
  if (!shown.rating) item.rating = null;
  if (!shown.dateStarted) item.dateStarted = null;
  if (!shown.owned) item.owned = false;
  if (!shown.lent) { item.lentTo = ''; item.lentSince = null; }
  if (!shown.progress) delete item.progress;
  if (!shown.legacy) delete item.legacy;
  if (!slug && !saveBtn.dataset.confirmDup) {
    const norm = (x) => String(x || '').trim().toLowerCase();
    const dup = libraryItems().find((i) =>
      i.type === item.type && (
        (source?.id && i.source?.id && String(i.source.id) === String(source.id) && i.source?.name === source.name) ||
        (norm(i.title) === norm(item.title) && norm(i.year) === norm(item.year))
      ));
    if (dup) {
      saveBtn.dataset.confirmDup = '1';
      saveBtn.textContent = 'Already on your shelf — save anyway?';
      saveBtn.classList.add('warn-btn');
      return;
    }
  }
  delete saveBtn.dataset.confirmDup;
  saveBtn.classList.remove('warn-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    const res = await api('save', { method: 'POST', body: { slug, item, body: form.body.value } });
    if (!slug) rememberSettings(item);
    state.saved[res.slug] = { slug: res.slug, ...res.item, body: res.body ?? form.body.value };
    const after = state.afterSave;
    editor.close();
    if (res.mentioned?.length) toast(`Saved. Let ${res.mentioned.length === 1 ? 'your friend' : `${res.mentioned.length} friends`} know you mentioned them.`);
    if (after) after(res.slug, { slug: res.slug, ...res.item });
    else showPreview(res.slug);
    loadLibrary();
    if (location.hash) history.replaceState(null, '', location.pathname);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to shelf';
  }
});

// ───────── expansions (board games): attached to the base game, not their own entries ─────────
const expKey = (x) => (x.id ? `id:${x.id}` : `t:${String(x.title).toLowerCase()}`);
const bggIdOfSource = (src = {}) => (/boardgamegeek|bgg/i.test(`${src.name} ${src.url}`) && src.id ? String(src.id) : '');
let expResults = [];

function expThumb(x, size = 44) {
  const ph = `<span class="exp-ph" style="width:${size}px;height:${size}px">${esc((x.title || '?').slice(0, 1))}</span>`;
  return x.cover
    ? `<span class="exp-thumb" style="width:${size}px;height:${size}px"><img src="${esc(x.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(this.nextElementSibling.content.cloneNode(true))"><template>${ph}</template></span>`
    : ph;
}
function renderExpansionsField() {
  const field = $('#editor-expansions');
  const isGame = form.type.value === 'boardgame';
  field.hidden = !isGame;
  if (!isGame || !state.editing) return;
  const list = state.editing.expansions || [];
  $('#exp-count').textContent = list.length ? `(${list.length})` : '';
  $('#exp-list').innerHTML = list.length
    ? list.map((x, i) => `
      <li class="exp-row">${expThumb(x)}
        <span class="exp-name">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}${x.year ? ` <span class="muted small">${esc(x.year)}</span>` : ''}</span>
        <button type="button" class="btn ghost small danger" data-exp-remove="${i}" aria-label="Detach ${esc(x.title)}">✕</button>
      </li>`).join('')
    : '<li class="muted small">None attached yet. Search below to attach expansions you own.</li>';
  $('#exp-known-btn').hidden = !bggIdOfSource(state.editing.source);
  renderExpansionResults();
}
function renderExpansionResults() {
  const attached = new Set((state.editing?.expansions || []).map(expKey));
  $('#exp-results').innerHTML = expResults.map((x, i) => {
    const on = attached.has(expKey(x));
    return `<li class="exp-row">${expThumb(x, 40)}
      <span class="exp-name">${esc(x.title)}${x.year ? ` <span class="muted small">${esc(x.year)}</span>` : ''}</span>
      <button type="button" class="btn ${on ? 'ghost' : 'primary'} small" data-exp-add="${i}" ${on ? 'disabled' : ''}>${on ? 'Attached' : 'Attach'}</button>
    </li>`;
  }).join('');
}
function resetExpansionSearch() {
  expResults = [];
  $('#exp-q').value = '';
  $('#exp-msg').textContent = '';
  $('#exp-results').innerHTML = '';
}
async function loadExpansions(query, label) {
  $('#exp-msg').textContent = 'Searching BoardGameGeek…';
  $('#exp-results').innerHTML = '';
  try {
    const { expansions } = await api(`expansions?${query}`);
    expResults = expansions;
    $('#exp-msg').textContent = expansions.length ? label(expansions.length) : 'No expansions found.';
    renderExpansionResults();
  } catch (err) {
    $('#exp-msg').textContent = '';
    toast(err.message, 'error');
  }
}
$('#exp-search-btn').addEventListener('click', () => {
  const q = $('#exp-q').value.trim();
  if (q.length < 2) return $('#exp-q').focus();
  loadExpansions(`q=${encodeURIComponent(q)}`, (n) => `${n} result${n === 1 ? '' : 's'} — attach the ones you have.`);
});
$('#exp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#exp-search-btn').click(); } });
$('#exp-known-btn').addEventListener('click', () => {
  const id = bggIdOfSource(state.editing?.source);
  if (id) loadExpansions(`base=${id}`, (n) => `BGG lists ${n} expansion${n === 1 ? '' : 's'} for this game.`);
});
$('#exp-manual-btn').addEventListener('click', () => {
  const title = $('#exp-q').value.trim();
  if (!title) return $('#exp-q').focus();
  const list = state.editing.expansions;
  if (!list.some((x) => expKey(x) === expKey({ title }))) list.push({ title });
  $('#exp-q').value = '';
  renderExpansionsField();
});
$('#editor-expansions').addEventListener('click', (e) => {
  const add = e.target.closest('[data-exp-add]');
  if (add) {
    const x = expResults[Number(add.dataset.expAdd)];
    if (x && !state.editing.expansions.some((y) => expKey(y) === expKey(x))) state.editing.expansions.push({ ...x });
    return renderExpansionsField();
  }
  const rm = e.target.closest('[data-exp-remove]');
  if (rm) {
    state.editing.expansions.splice(Number(rm.dataset.expRemove), 1);
    renderExpansionsField();
  }
});

// ───────── refresh board games from BGG ─────────
function refreshSummary(report) {
  return report.map((r) => `${r.title}: ${r.status}`).join(' · ');
}
$('#refresh-bgg').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  $('#refresh-bgg-msg').textContent = 'Fetching the latest from BoardGameGeek…';
  try {
    const { updated, report } = await api('refresh-boardgames', { method: 'POST', body: {} });
    $('#refresh-bgg-msg').textContent = report.length ? refreshSummary(report) : 'No board games to refresh.';
    if (updated) { loadLibrary(); toast(`Refreshed ${updated} board game${updated === 1 ? '' : 's'}.`); }
  } catch (err) {
    $('#refresh-bgg-msg').textContent = '';
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});
$('#editor-refresh-bgg').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const slug = state.editing?.slug;
  if (!slug) return;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const { report } = await api('refresh-boardgames', { method: 'POST', body: { slugs: [slug] } });
    const { item, body } = await api(`item?slug=${encodeURIComponent(slug)}`);
    openEditor({ ...item, body }, slug);
    toast(report[0] ? `${report[0].title}: ${report[0].status}` : 'Nothing to refresh.');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh from BGG';
  }
});

// ───────── library ─────────
async function loadLibrary() {
  try {
    const res = await fetch('/library.json', { cache: 'no-store', headers: libraryHeaders() });
    const data = await res.json();
    state.library = data.items || [];
  } catch {
    state.library = [];
  }
  renderLibrary();
  makeCoverCopies();
}

// ───────── shelf copies of the covers ─────────
// The shelves draw small copies of each cover (full-size covers made iPhones crash the page): one for the front
// (item.shelfCover) and one for the spine (item.spine). Workers can't resize images on the free plan, so this page
// does it: any stored cover missing a copy gets them, one item at a time in the background.
// Sizes are the longest side in px: enough for sharp covers on phone screens, a fraction of the originals.
const COPY_SIZES = {
  shelf: { boardgame: 900, music: 640, default: 600 },
  spine: { boardgame: 480, videogame: 360, default: 160 }, // more detail where little blur is applied
};
const COPY_FIELDS = { shelf: 'shelfCover', spine: 'spine' };
let copiesRunning = false;
async function makeCoverCopies() {
  if (copiesRunning || !getToken()) return;
  copiesRunning = true;
  let made = 0;
  const failed = new Set();
  const missing = (i) => Object.entries(COPY_FIELDS).filter(([, f]) => !i[f]).map(([kind]) => kind);
  try {
    for (;;) {
      const item = state.library.find((i) => /^\/img\//.test(i.cover || '') && missing(i).length && !failed.has(i.slug));
      if (!item) break;
      try {
        const img = await loadImage(item.cover);
        for (const kind of missing(item)) {
          const image = await shrink(img, item, COPY_SIZES[kind][item.type] || COPY_SIZES[kind].default);
          const res = await uploadCopy(item, kind, image);
          item[COPY_FIELDS[kind]] = res[COPY_FIELDS[kind]];
          made++;
        }
        img.src = '';
      } catch (err) {
        if (err.message === 'Unauthorized') break;
        failed.add(item.slug); // a broken image: skip it this time, try again next visit
        console.warn(`Couldn't make shelf copies of the cover for ${item.title}:`, err);
      }
    }
  } finally {
    copiesRunning = false;
  }
  if (made) console.info(`Made ${made} shelf cop${made === 1 ? 'y' : 'ies'} of covers.`);
  makeShareCard().catch((err) => console.warn('Could not update the share card:', err));
}

// ───────── share card: the picture shown when someone shares a link to your site ─────────
// Drawn here (the Worker can't afford to draw pictures) from your site name, your name, tagline, colours and your
// latest public covers, then stored on the site. Redrawn only when one of those changes.
let shareCardRunning = false;
async function makeShareCard() {
  if (shareCardRunning || !getToken() || EMBED) return;
  shareCardRunning = true;
  try {
    const [{ site }, { card }] = await Promise.all([api('site'), api('share-card')]);
    const when = (i) => i.dateFinished || i.dateStarted || i.dateAdded || '';
    const picks = state.library
      .filter((i) => i.shelfCover && (i.visibility || 'public') === 'public' && (site.types || []).includes(i.type))
      .sort((a, b) => when(b).localeCompare(when(a)))
      .slice(0, 12)
      .map((i) => i.shelfCover);
    let host = location.host;
    try { if (site.url) host = new URL(site.url).host; } catch {}
    const opts = { title: site.title, owner: site.owner, tagline: site.tagline, accent: site.theme?.accent, mode: site.theme?.mode, host };
    const sig = await sha256(JSON.stringify({ v: 1, ...opts, picks }));
    if (card?.sig === sig) return;
    await document.fonts.load(`800 76px "Plus Jakarta Sans Variable"`).catch(() => {});
    const covers = (await Promise.all(picks.map((src) => loadImage(src).catch(() => null)))).filter(Boolean);
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    drawShareCard(canvas.getContext('2d'), { ...opts, covers });
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the card'))), 'image/jpeg', 0.9));
    const res = await fetch(`/api/share-card?${new URLSearchParams({ sig })}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) throw new Error(`Saving the share card failed (${res.status})`);
  } finally {
    shareCardRunning = false;
  }
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadImage(src) {
  const img = new Image();
  img.src = src; // same site, so the canvas stays readable
  await img.decode();
  return img;
}
function shrink(img, item, long) {
  const scale = Math.min(1, long / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = (TYPES[item.type] || TYPES.book).color || '#333'; // behind transparent PNGs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/jpeg', 0.85));
}
// Sent as raw bytes: decoding base64 on the Worker costs more CPU than the free plan allows a request.
async function uploadCopy(item, kind, blob) {
  const q = new URLSearchParams({ slug: item.slug, kind, cover: item.cover });
  const res = await fetch(`/api/cover-copy?${q}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'image/jpeg' },
    body: blob,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { showLogin('Your token was rejected.'); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function libraryItems() {
  return state.library;
}
const LIB_PAGE = 25;
let libPage = 1;
// Page buttons: ‹ Prev, 1 … 4 5 6 … 12, Next ›, and "26–50 of 280".
function renderPager(pages, total) {
  const nav = $('#lib-pager');
  nav.hidden = pages <= 1;
  if (pages <= 1) { nav.innerHTML = ''; return; }
  const nums = [...new Set([1, libPage - 1, libPage, libPage + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const parts = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) parts.push('<span class="pager-gap" aria-hidden="true">…</span>');
    parts.push(`<button type="button" class="btn ghost small${n === libPage ? ' on' : ''}" data-page="${n}" ${n === libPage ? 'aria-current="page"' : ''}>${n}</button>`);
  });
  const from = (libPage - 1) * LIB_PAGE + 1, to = Math.min(total, libPage * LIB_PAGE);
  nav.innerHTML = `
    <button type="button" class="btn ghost small" data-page="${libPage - 1}" ${libPage === 1 ? 'disabled' : ''} aria-label="Previous page">‹ Prev</button>
    <span class="pager-nums">${parts.join('')}</span>
    <button type="button" class="btn ghost small" data-page="${libPage + 1}" ${libPage === pages ? 'disabled' : ''} aria-label="Next page">Next ›</button>
    <span class="pager-count muted small">${from}–${to} of ${total}</span>`;
}
function renderLibrary() {
  const q = $('#lib-filter').value.trim().toLowerCase();
  const type = $('#lib-type').value;
  // Newest additions first (when it was added to the database, falling back to the date added).
  const added = (i) => i.createdAt || i.dateAdded || '';
  const list = libraryItems().filter(
    (i) => (!type || i.type === type) && (!q || `${i.title} ${i.creator}`.toLowerCase().includes(q)),
  ).map((i, n) => [i, n]).sort(([a, x], [b, y]) => added(b).localeCompare(added(a)) || y - x).map(([i]) => i);
  // A page at a time: 25 items, newest first, with page buttons underneath.
  const pages = Math.max(1, Math.ceil(list.length / LIB_PAGE));
  libPage = Math.min(Math.max(1, libPage), pages);
  const shown = list.slice((libPage - 1) * LIB_PAGE, libPage * LIB_PAGE);
  renderPager(pages, list.length);
  $('#lib-list').innerHTML = shown.length
    ? shown
        .map((i) => `
      <li class="lib-row">
        ${coverThumb(i, 56)}
        <span class="lib-text">
          <strong>${esc(i.title)}${i.featured ? ' <span class="featured-badge">★ Featured</span>' : ''}${i.visibility === 'friends' ? ' <span class="vis-badge">Friends only</span>' : ''}${i.visibility === 'private' ? ' <span class="vis-badge">Only me</span>' : ''}${i.lentTo ? ` <span class="vis-badge">Lent to ${esc(i.lentTo)}</span>` : ''}</strong>
          <span class="muted small">${esc(TYPES[i.type]?.label)} · ${esc(i.creator || '')}</span>
        </span>
        <span class="lib-actions">
          <a class="btn ghost small" href="/item/${esc(i.slug)}/" target="_blank">View</a>
          <button class="btn ghost small" data-edit="${esc(i.slug)}">Edit</button>
          <button class="btn ghost small" data-recommend="${esc(i.slug)}" data-title="${esc(i.title)}" title="Recommend to friends">Recommend</button>
          <button class="btn ghost small danger" data-del="${esc(i.slug)}">Delete</button>
        </span>
      </li>`)
        .join('')
    : '<li class="muted">Nothing matches.</li>';
}
$('#lib-filter').addEventListener('input', () => { libPage = 1; renderLibrary(); });
$('#lib-type').addEventListener('change', () => { libPage = 1; renderLibrary(); });
$('#lib-pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (!b || b.disabled) return;
  libPage = Number(b.dataset.page);
  renderLibrary();
  $('#lib-filter').closest('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

async function editSlug(slug, afterSave = null) {
  try {
    const { item, body } = await api(`item?slug=${encodeURIComponent(slug)}`);
    openEditor({ ...item, body }, slug);
    state.afterSave = afterSave;
    tellParent({ type: 'myshelf:edit-ready' });
  } catch (err) {
    toast(err.message, 'error');
    tellParent({ type: 'myshelf:edit-closed', error: err.message });
  }
}
$('#lib-list').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return editSlug(edit.dataset.edit);
  const del = e.target.closest('[data-del]');
  if (!del) return;
  if (!del.classList.contains('confirm')) {
    del.classList.add('confirm');
    del.textContent = 'Really delete?';
    setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Delete'; }, 4000);
    return;
  }
  del.disabled = true;
  try {
    await api('delete', { method: 'POST', body: { slug: del.dataset.del } });
    state.library = state.library.filter((i) => i.slug !== del.dataset.del);
    delete state.saved[del.dataset.del];
    renderLibrary();
    toast('Deleted.');
  } catch (err) {
    del.disabled = false;
    toast(err.message, 'error');
  }
});

// ───────── collections ─────────
async function loadCollections() {
  try {
    const { collections } = await api('collections');
    state.collections = collections;
    state.collectionsLoaded = true;
  } catch (err) {
    toast(err.message, 'error');
  }
  renderCollections();
}
function renderCollections() {
  renderStarterPicks();
  $('#col-list').innerHTML = state.collections
    .map((c, i) => `
    <li class="col-row" data-i="${i}">
      <div class="col-top">
        <span class="col-move">
          <span class="col-handle" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
          <button class="btn ghost small col-arrow" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="btn ghost small col-arrow" data-down ${i === state.collections.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        </span>
        <input class="col-name" value="${esc(c.name)}" placeholder="Collection name" aria-label="Collection name" />
        <span class="col-kind col-slug" title="${isAutoShelf(c) ? 'Fills itself' : 'Your own picks'}">${isAutoShelf(c) ? `Auto · ${[c.auto && esc(AUTO_RULES[c.auto] || c.auto), c.minRating && `${c.minRating}★+`].filter(Boolean).join(', ')}` : c.slug ? '/shelf/' + esc(c.slug) : 'New'}</span>
        <button class="btn ghost small danger" data-remove aria-label="Remove ${esc(c.name || 'collection')}" title="Remove">✕</button>
      </div>
      <input class="col-desc" value="${esc(c.description)}" placeholder="Description (optional)" aria-label="Description" />
      <div class="col-settings">
        <label class="col-field col-show" title="Where this collection appears">
          <span>Show on</span>
          <select class="col-show-select">
            ${Object.entries(SHOW_OPTIONS).map(([k, label]) => `<option value="${k}" ${(c.show || 'shelves') === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </label>
        <div class="col-field col-sort">
          <span id="col-sort-${i}">Sort</span>
          <div class="col-sort-line">
            <select class="col-sort-select" aria-labelledby="col-sort-${i}">
              ${Object.entries(SORTS).map(([k, label]) => `<option value="${k}" ${(c.sort || 'newest') === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
            ${(c.sort || 'newest') === 'custom' ? `<button class="btn ghost small" data-arrange ${c.slug ? '' : 'disabled title="Save the collection first"'}>Arrange</button>` : ''}
          </div>
        </div>
        <label class="col-field col-within" title="${c.auto === 'finished' ? 'Only keep items finished within this time' : c.auto === 'in-progress' ? 'Only keep items started within this time' : 'Only keep items from within this time'}">
          <span>Keep</span>
          <select class="col-within-select">
            ${Object.entries(WITHIN_OPTIONS).map(([k, label]) => `<option value="${k}" ${String(c.within || '') === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </label>
      </div>
    </li>`)
    .join('') || '<li class="muted">No collections yet.</li>';
}
function syncCollectionsFromInputs() {
  $$('.col-row').forEach((row) => {
    const c = state.collections[Number(row.dataset.i)];
    c.name = $('.col-name', row).value;
    c.description = $('.col-desc', row).value;
    c.sort = $('.col-sort-select', row).value;
    c.show = $('.col-show-select', row).value;
    c.within = Number($('.col-within-select', row).value) || undefined;
  });
}
$('#col-list').addEventListener('change', (e) => {
  if (!e.target.matches('.col-sort-select')) return;
  syncCollectionsFromInputs();
  renderCollections(); // show/hide the Arrange button
});
$('#col-list').addEventListener('click', (e) => {
  const row = e.target.closest('.col-row');
  if (!row) return;
  syncCollectionsFromInputs();
  if (e.target.closest('[data-arrange]')) return openArrangeFor(Number(row.dataset.i));
  const i = Number(row.dataset.i);
  const list = state.collections;
  if (e.target.closest('[data-up]') && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  else if (e.target.closest('[data-down]') && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  else if (e.target.closest('[data-remove]')) list.splice(i, 1);
  else return;
  renderCollections();
  if (!e.target.closest('[data-remove]')) markOrderChanged();
});

// Drag the handle to reorder collections (the order they appear on the Shelves and media pages).
Sortable.create($('#col-list'), {
  handle: '.col-handle',
  draggable: '.col-row',
  animation: 160,
  ghostClass: 'col-ghost',
  onStart: () => syncCollectionsFromInputs(),
  onEnd: (e) => {
    if (e.oldIndex === e.newIndex) return;
    const order = $$('.col-row').map((row) => state.collections[Number(row.dataset.i)]);
    state.collections = order;
    renderCollections();
    markOrderChanged();
  },
});
function markOrderChanged() {
  const btn = $('#col-save');
  btn.classList.add('needs-save');
  btn.textContent = 'Save new order';
}
$('#col-add').addEventListener('click', () => {
  syncCollectionsFromInputs();
  state.collections.push({ slug: '', name: '', description: '' });
  renderCollections();
  $$('.col-name').at(-1)?.focus();
});
$('#col-save').addEventListener('click', async () => {
  syncCollectionsFromInputs();
  const btn = $('#col-save');
  btn.disabled = true;
  try {
    const { collections } = await api('collections', {
      method: 'POST',
      body: { collections: state.collections.filter((c) => c.name.trim()) },
    });
    state.collections = collections;
    renderCollections();
    btn.classList.remove('needs-save');
    btn.textContent = 'Save collections';
    toast('Collections saved.');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ───────── starter shelves ─────────
// Ready-made automatic collections (Currently, Recently Finished, Favorites). Ticked = you have it. In the
// Collections tab, ticking adds it to the front of the Shelves page and saves; unticking removes it.
// A brand-new site (no collections) gets a welcome box offering all of them on first sign-in.
const STARTER_SKIP_KEY = 'myshelf_starter_skipped';
function renderStarterPicks() {
  const settings = $('[data-starter-picks="settings"]');
  if (settings) settings.innerHTML = STARTER_SHELVES.map((st) => `
    <label class="check starter-pick"><input type="checkbox" data-starter="${st.key}" ${findStarter(state.collections, st) ? 'checked' : ''}>
      <span><strong>${esc(st.label)}</strong> <span class="muted small">${esc(st.hint)}</span></span></label>`).join('');
  const welcome = $('#starter-welcome');
  let skipped = false;
  try { skipped = localStorage.getItem(STARTER_SKIP_KEY) === '1'; } catch {}
  if (welcome) {
    welcome.hidden = state.collections.length > 0 || skipped || !state.collectionsLoaded;
    $('[data-starter-picks="welcome"]').innerHTML = STARTER_SHELVES.map((st) => `
      <label class="check starter-pick"><input type="checkbox" data-starter-welcome="${st.key}" checked>
        <span><strong>${esc(st.label)}</strong> <span class="muted small">${esc(st.hint)}</span></span></label>`).join('');
  }
}
async function saveCollectionList(list, msg) {
  const { collections } = await api('collections', { method: 'POST', body: { collections: list.filter((c) => c.name.trim()) } });
  state.collections = collections;
  renderCollections();
  toast(msg);
}
const starterCopies = (keys) => STARTER_SHELVES.filter((st) => keys.includes(st.key) && !findStarter(state.collections, st)).map((st) => structuredClone(st.collection));
$('[data-starter-picks="settings"]').addEventListener('change', async (e) => {
  const cb = e.target.closest('[data-starter]');
  if (!cb) return;
  syncCollectionsFromInputs();
  const st = STARTER_SHELVES.find((x) => x.key === cb.dataset.starter);
  const have = findStarter(state.collections, st);
  const list = cb.checked
    ? [...starterCopies([st.key]), ...state.collections]
    : state.collections.filter((c) => c !== have);
  cb.disabled = true;
  try {
    await saveCollectionList(list, cb.checked ? `Added “${st.label}” to your Shelves page.` : `Removed “${have?.name || st.label}”.`);
  } catch (err) {
    cb.checked = !cb.checked;
    toast(err.message, 'error');
  } finally {
    cb.disabled = false;
  }
});
$('#starter-add').addEventListener('click', async () => {
  const keys = $$('[data-starter-welcome]').filter((cb) => cb.checked).map((cb) => cb.dataset.starterWelcome);
  if (!keys.length) return $('#starter-skip').click();
  const btn = $('#starter-add');
  btn.disabled = true;
  try {
    await saveCollectionList([...starterCopies(keys), ...state.collections], `Added ${keys.length === 1 ? 'a shelf' : `${keys.length} shelves`} to your Shelves page.`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});
$('#starter-skip').addEventListener('click', () => {
  try { localStorage.setItem(STARTER_SKIP_KEY, '1'); } catch {}
  $('#starter-welcome').hidden = true;
  toast('No problem. Starter shelves are in Collections whenever you want them.');
});

// ───────── arrange a collection (shared drag & drop dialog) ─────────
function openArrangeFor(index) {
  const c = state.collections[index];
  // Start from what the shelf shows now; new items (not yet arranged) come first.
  const entries = libraryItems().filter((i) => inShelf(i, c)).map((i) => ({ id: i.slug, data: i }));
  const items = sortShelf(entries, c).map((e) => e.data);
  const types = new Set(items.map((i) => i.type));
  openArrange({
    title: c.name,
    items,
    canRemove: c.slug ? (i) => (i.collections || []).includes(c.slug) : null,
    onEdit: (i) => editSlug(i.slug, (slug, saved) => {
      updateArrangeItem(i.slug, saved);
      toast(`Saved “${saved.title}”.`);
      loadLibrary();
    }),
    onRecommend: (i) => import('./recommend-dialog.js').then((m) => m.openRecommend({ slug: i.slug, title: i.title })),
    onAdd: c.slug && !isAutoShelf(c) ? () => {
      document.querySelector('.ar-dialog')?.close();
      startAddingTo(c.slug, types.size === 1 ? [...types][0] : null);
    } : null,
    onSave: async (order, removed = []) => {
      if (removed.length) await api('collection-items', { method: 'POST', body: { collection: c.slug, remove: removed } });
      const before = items.map((i) => i.slug).filter((s) => !removed.includes(s));
      if (order.join() !== before.join()) {
        c.sort = 'custom';
        c.order = order;
        const { collections } = await api('collections', { method: 'POST', body: { collections: state.collections.filter((x) => x.name.trim()) } });
        state.collections = collections;
        renderCollections();
      }
      if (removed.length) await loadLibrary();
      toast(removed.length ? `Saved “${c.name}” — removed ${removed.length} ${removed.length === 1 ? 'item' : 'items'}.` : `Saved the order for “${c.name}”.`);
    },
  });
}

// ───────── live preview ─────────
const STATUS_WORDS = (type, status) => {
  const t = TYPES[type] || TYPES.book;
  return { want: t.want, 'in-progress': t.doing, finished: t.verb, abandoned: t.dropped || 'Abandoned' }[status] || status;
};
const DETAIL_NAMES = {
  pages: 'Pages', isbn: 'ISBN', publisher: 'Publisher', runtime: 'Runtime', seasons: 'Seasons', episodes: 'Episodes',
  network: 'Network', tracks: 'Tracks', kind: 'Format', platforms: 'Platforms', developers: 'Developers',
  publishers: 'Publishers', players: 'Players', playtime: 'Play time', weight: 'Complexity', bggRank: 'BGG rank', cast: 'Cast',
};
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const starText = (r) => (r == null ? '' : '★'.repeat(Math.floor(r)) + (r % 1 >= 0.5 ? '½' : ''));

function coverMarkup(item, height) {
  const t = TYPES[item.type] || TYPES.book;
  const ph = `<span class="placeholder"><span class="ph-title">${esc(item.title)}</span>${item.creator ? `<span class="ph-creator">${esc(item.creator)}</span>` : ''}</span>`;
  const img = item.cover ? `<img src="${esc(item.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<div class="cover" data-type="${esc(item.type)}" style="--h:${height}px;--pw:${Math.round(height * t.aspect)}px;--tc:${t.color}">${img}${ph}</div>`;
}

function showPreview(slug) {
  const it = state.saved[slug];
  if (!it) return;
  state.previewSlug = slug;
  const t = TYPES[it.type] || TYPES.book;
  const shelves = state.collections.filter((c) => (it.collections || []).includes(c.slug));
  const details = Object.entries(it.details || {})
    .map(([k, v]) => [DETAIL_NAMES[k] || k, Array.isArray(v) ? v.join(', ') : k === 'runtime' || k === 'playtime' ? `${v} min` : v])
    .filter(([, v]) => v !== '' && v != null);
  const body = (it.body || '').trim();
  const finished = it.status === 'finished' ? it.dateFinished : null;
  const thoughtsDate = finished || it.dateStarted || it.dateAdded;
  $('#preview-body').innerHTML = `
    <article class="item-page preview-page">
      <div class="item-cover">${coverMarkup(it, it.type === 'music' || it.type === 'boardgame' ? 280 : 340)}</div>
      <div class="item-info">
        <p class="eyebrow">${esc(t.label)}${it.year ? ' · ' + esc(it.year) : ''}</p>
        <h1>${esc(it.title)}</h1>
        ${body ? `<section class="my-thoughts-card">
          <p class="eyebrow">${esc(t.label)} · ${esc(STATUS_WORDS(it.type, it.status))}${thoughtsDate ? ' · ' + fmtDate(thoughtsDate) : ''}</p>
          <h2>My thoughts ${it.rating != null ? `<span class="rating">${starText(it.rating)}</span>` : ''}</h2>
          <div class="prose">${mentionsHtml(marked.parse(body))}</div>
        </section>` : ''}
        ${it.creator ? `<p class="creator">${esc(t.creator)}: ${esc(it.creator)}</p>` : ''}
        <div class="item-meta">
          <span class="status status-${esc(it.status)}">${esc(STATUS_WORDS(it.type, it.status))}</span>
          ${it.rating != null && !body ? `<span class="rating">${starText(it.rating)}</span>` : ''}
        </div>
        <dl class="facts">
          ${it.dateStarted ? `<dt>Started</dt><dd>${fmtDate(it.dateStarted)}</dd>` : ''}
          ${finished ? `<dt>Finished</dt><dd>${fmtDate(finished)}</dd>` : ''}
          ${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
          ${(it.genres || []).length ? `<dt>Genres</dt><dd>${esc(it.genres.join(', '))}</dd>` : ''}
        </dl>
        ${shelves.length || (it.tags || []).length ? `<div class="chips">
          ${shelves.map((s) => `<span class="chip">${esc(s.name)}</span>`).join('')}
          ${(it.tags || []).map((g) => `<span class="chip chip-tag">#${esc(g)}</span>`).join('')}
        </div>` : ''}
        ${it.description ? `<section class="synopsis"><h2>About</h2><p>${esc(it.description)}</p></section>` : ''}
      </div>
    </article>`;
  $('#publish-status').innerHTML = `✓ Live on your site — <a href="/item/${esc(slug)}/" target="_blank">view page</a>`;
  $('#publish-status').className = 'publish-status live';
  const dlg = $('#preview');
  if (!dlg.open) dlg.showModal();
}

$('[data-close-preview]').addEventListener('click', () => $('#preview').close());
$('#preview-edit').addEventListener('click', () => {
  $('#preview').close();
  if (state.previewSlug) editSlug(state.previewSlug);
});
$('#preview-another').addEventListener('click', () => {
  $('#preview').close();
  showTab('add');
  $('#search-q').value = '';
  $('#results').innerHTML = '';
  $('#search-msg').textContent = '';
  $('#search-q').focus();
});

// ───────── backup ─────────
$('#export-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export', { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`Backup failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `myshelf-backup-${localDate()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ───────── deep links: /admin/#edit=slug ─────────
// /admin/#add=collection-slug[&type=boardgame] — from "＋ Add more" in a collection's arrange dialog.
// /admin/#search=<type>&q=<title> — "Add it" on a recommendation in the inbox on the public Friends page.
function handleHash() {
  if (location.hash === '#updates') { // the "Update available" pill in the top bar
    showTab('settings');
    return requestAnimationFrame(() => $('#updates-heading')?.scrollIntoView({ block: 'start' }));
  }
  if (location.hash === '#api-keys') {
    showTab('settings');
    return requestAnimationFrame(() => $('#api-keys')?.scrollIntoView({ block: 'start' }));
  }
  const m = location.hash.match(/^#edit=([a-z0-9-]+)$/);
  if (m) {
    if (EMBED) return editSlug(m[1], (slug, item) => tellParent({ type: 'myshelf:edited', slug: m[1], item }));
    return editSlug(m[1]);
  }
  if (location.hash.startsWith('#search=')) {
    const q = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname);
    document.dispatchEvent(new CustomEvent('myshelf:search', { detail: { type: q.get('search'), title: q.get('q') || '' } }));
    return;
  }
  // /admin/#add-item=<json>: "Add to my shelf" on a friend's item or a recommendation.
  if (location.hash.startsWith('#add-item=')) {
    let ref = null;
    try { ref = JSON.parse(decodeURIComponent(location.hash.slice('#add-item='.length))); } catch {}
    history.replaceState(null, '', location.pathname);
    if (ref) addFromRef(ref);
    return;
  }
  // /admin/#new: the ＋ by the Journal's title. Opens Add (with whatever kind of media was picked last).
  if (location.hash === '#new') {
    history.replaceState(null, '', location.pathname);
    showTab('add');
    $('#search-q').focus();
    return;
  }
  // /admin/#type=book: the ＋ next to a media page's title. Opens Add with that kind of media picked.
  if (location.hash.startsWith('#type=')) {
    const type = location.hash.slice('#type='.length);
    history.replaceState(null, '', location.pathname);
    showTab('add');
    if (TYPES[type]) $(`.type-btn[data-type="${type}"]`)?.click();
    $('#search-q').focus();
    return;
  }
  if (location.hash.startsWith('#add=')) {
    const q = new URLSearchParams(location.hash.slice(1));
    startAddingTo(q.get('add'), q.get('type'));
    history.replaceState(null, '', location.pathname);
  }
}

function startAddingTo(slug, type) {
  const c = state.collections.find((x) => x.slug === slug && !isAutoShelf(x));
  if (!c) return toast('That collection was not found.', 'error');
  state.addTo = c.slug;
  showTab('add');
  if (type && TYPES[type]) $(`.type-btn[data-type="${type}"]`)?.click();
  renderAddingTo();
  $('#search-q').focus();
}
function renderAddingTo() {
  const el = $('#adding-to');
  const c = state.collections.find((x) => x.slug === state.addTo);
  if (!c) { el.hidden = true; state.addTo = null; return; }
  el.hidden = false;
  el.innerHTML = `<span>Adding to <strong>${esc(c.name)}</strong> — it’s checked automatically on anything you pick.</span>
    <a class="btn ghost small" href="/shelf/${esc(c.slug)}/">Back to shelf</a>
    <button type="button" class="btn ghost small" data-stop-adding aria-label="Stop adding to ${esc(c.name)}">✕</button>`;
}
$('#adding-to').addEventListener('click', (e) => {
  if (e.target.closest('[data-stop-adding]')) { state.addTo = null; renderAddingTo(); }
});
window.addEventListener('hashchange', handleHash);

boot();
