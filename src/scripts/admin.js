// Admin UI: search external databases, add/edit/delete items, manage collections.
import { marked } from 'marked';
import { SORTS, sortShelf, inShelf, AUTO_RULES, SHOW_OPTIONS, WITHIN_OPTIONS } from '../lib/sorting.js';
import { openArrange } from './arrange.js';
import Sortable from 'sortablejs';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = $('#admin');
const TYPES = JSON.parse(root.dataset.types);
const TOKEN_KEY = 'myshelf_token';

const state = {
  type: 'book',
  results: [],
  library: [],
  collections: [],
  editing: null, // { slug?, source? }
  saved: {},          // items saved in this session (for the preview dialog)
  previewSlug: null,
  addTo: null,        // collection slug picked via "＋ Add more": pre-checked on new entries
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
  return `<span class="thumb-wrap"><img class="thumb" src="${esc(item.cover)}" alt="" style="height:${size}px" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(this.nextElementSibling.content.cloneNode(true))"><template>${ph}</template></span>`;
}
const SOURCE_NAMES = { openlibrary: 'Open Library', googlebooks: 'Google Books', tmdb: 'TMDB', spotify: 'Spotify', musicbrainz: 'MusicBrainz', igdb: 'IGDB', bgg: 'BoardGameGeek', manual: 'Manual' };

// ───────── auth ─────────
function showLogin(error) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const err = $('#login-error');
  err.hidden = !error;
  err.textContent = error || '';
}
async function boot() {
  if (!getToken()) return showLogin();
  try {
    const ping = await api('ping');
    $('#login').hidden = true;
    $('#app').hidden = false;
    renderConfig(ping.configured);
    renderStorage(ping);
    await Promise.all([loadLibrary(), loadCollections()]);
    handleHash();
    document.dispatchEvent(new CustomEvent('myshelf:ready'));
  } catch (e) {
    if (e.message !== 'Unauthorized') showLogin(e.message.includes('Failed to fetch') ? 'Could not reach the API.' : e.message);
  }
}
function renderConfig(c) {
  const missing = [];
  if (!c.tmdb) missing.push('TMDB');
  if (!c.igdb) missing.push('IGDB');
  if (!c.bgg) missing.push('BGG');
  if (!c.spotify) missing.push('Spotify (using MusicBrainz)');
  $('#config-status').innerHTML = missing.length
    ? `<span class="warn" title="Add these as secrets: Worker → Settings → Variables and Secrets">Missing keys: ${esc(missing.join(', '))}</span>`
    : '<span class="okay">All sources connected</span>';
}
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

// ───────── search ─────────
$$('.type-btn').forEach((b) =>
  b.addEventListener('click', () => {
    state.type = b.dataset.type;
    $$('.type-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('#search-q').placeholder = `Search ${TYPES[state.type].plural.toLowerCase()}…`;
    $('#results').innerHTML = '';
    $('#search-msg').textContent = '';
    $('#search-q').focus();
  }),
);

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search-q').value.trim();
  if (q.length < 2) return;
  $('#search-msg').textContent = 'Searching…';
  $('#results').innerHTML = '';
  try {
    const { results } = await api(`search?type=${state.type}&q=${encodeURIComponent(q)}`);
    state.results = results;
    $('#search-msg').textContent = results.length ? `${results.length} results — pick one to add it.` : 'No matches. Try different words, or add it manually.';
    $('#results').innerHTML = results
      .map((r, i) => `
        <button type="button" class="result" data-i="${i}">
          ${coverThumb(r, 96)}
          <span class="result-text">
            <strong>${esc(r.title)}</strong>
            <span>${esc(r.creator)}${r.creator && r.year ? ' · ' : ''}${esc(r.year)}</span>
            ${r.details?.kind ? `<span class="muted small">${esc(r.details.kind)}</span>` : ''}
            <span class="src">${esc(SOURCE_NAMES[r.source] || r.source)}</span>
          </span>
        </button>`)
      .join('');
  } catch (err) {
    $('#search-msg').textContent = '';
    toast(err.message, 'error');
  }
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
function renderCollectionChecks(selected = []) {
  $('#editor-collections').innerHTML = state.collections.length
    ? state.collections
        .map((c) => c.auto
          ? `<label class="check muted" title="Fills automatically from status"><input type="checkbox" disabled ${form.status.value === c.auto ? 'checked' : ''} data-auto="${esc(c.auto)}"> ${esc(c.name)} <span class="small">(automatic)</span></label>`
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

// ───────── remember the last status, dates and collections used per type (new entries only) ─────────
const LAST_KEY = 'myshelf_last_settings';
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } };
function rememberSettings(item) {
  const all = readLast();
  all[item.type] = { status: item.status || '', dateStarted: item.dateStarted || '', dateFinished: item.dateFinished || '', collections: item.collections || [] };
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
    },
  };
}
$('#editor-forget').addEventListener('click', () => {
  forgetSettings(form.type.value);
  form.status.value = '';
  form.dateStarted.value = '';
  form.dateFinished.value = '';
  renderCollectionChecks([]);
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
  editor.showModal();
  form.title.focus();
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
form.type.addEventListener('change', () => { updateCreatorLabel(); renderCoverPreview(); renderExpansionsField(); });
form.status.addEventListener('change', () => {
  $$('#editor-collections input[data-auto]').forEach((cb) => (cb.checked = form.status.value === cb.dataset.auto));
  const today = new Date().toISOString().slice(0, 10);
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
    lentSince: form.lentTo.value.trim() ? form.lentSince.value || new Date().toISOString().slice(0, 10) : null,
  };
  delete item.body;
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
    state.saved[res.slug] = { slug: res.slug, ...res.item, body: form.body.value };
    editor.close();
    showPreview(res.slug);
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
}
function libraryItems() {
  return state.library;
}
function renderLibrary() {
  const q = $('#lib-filter').value.trim().toLowerCase();
  const type = $('#lib-type').value;
  // Newest additions first (when it was added to the database, falling back to the date added).
  const added = (i) => i.createdAt || i.dateAdded || '';
  const list = libraryItems().filter(
    (i) => (!type || i.type === type) && (!q || `${i.title} ${i.creator}`.toLowerCase().includes(q)),
  ).map((i, n) => [i, n]).sort(([a, x], [b, y]) => added(b).localeCompare(added(a)) || y - x).map(([i]) => i);
  $('#lib-list').innerHTML = list.length
    ? list
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
$('#lib-filter').addEventListener('input', renderLibrary);
$('#lib-type').addEventListener('change', renderLibrary);

async function editSlug(slug) {
  try {
    const { item, body } = await api(`item?slug=${encodeURIComponent(slug)}`);
    openEditor({ ...item, body }, slug);
  } catch (err) {
    toast(err.message, 'error');
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
  } catch (err) {
    toast(err.message, 'error');
  }
  renderCollections();
}
function renderCollections() {
  $('#col-list').innerHTML = state.collections
    .map((c, i) => `
    <li class="col-row" data-i="${i}">
      <span class="col-move">
        <span class="col-handle" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
        <button class="btn ghost small col-arrow" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="btn ghost small col-arrow" data-down ${i === state.collections.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      </span>
      <input class="col-name" value="${esc(c.name)}" placeholder="Collection name" />
      <input class="col-desc" value="${esc(c.description)}" placeholder="Description (optional)" />
      <label class="col-show" title="Where this collection appears">
        <span class="muted small">Show on</span>
        <select class="col-show-select" aria-label="Show on">
          ${Object.entries(SHOW_OPTIONS).map(([k, label]) => `<option value="${k}" ${(c.show || 'shelves') === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
      </label>
      <span class="col-sort">
        <span class="muted small">Sort</span>
        <select class="col-sort-select" aria-label="Sort order">
          ${Object.entries(SORTS).map(([k, label]) => `<option value="${k}" ${(c.sort || 'newest') === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
        ${(c.sort || 'newest') === 'custom' ? `<button class="btn ghost small" data-arrange ${c.slug ? '' : 'disabled title="Save the collection first"'}>Arrange</button>` : ''}
      </span>
      <label class="col-within" title="${c.auto === 'finished' ? 'Only keep items finished within this time' : c.auto === 'in-progress' ? 'Only keep items started within this time' : 'Only keep items from within this time'}">
        <span class="muted small">Keep</span>
        <select class="col-within-select" aria-label="Time window">
          ${Object.entries(WITHIN_OPTIONS).map(([k, label]) => `<option value="${k}" ${String(c.within || '') === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
      </label>
      <span class="muted small col-slug">${c.auto ? `auto: ${esc(AUTO_RULES[c.auto] || c.auto)}` : c.slug ? '/shelf/' + esc(c.slug) : 'new'}</span>
      <button class="btn ghost small danger" data-remove aria-label="Remove">✕</button>
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
    onAdd: c.slug && !c.auto ? () => {
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
          <div class="prose">${marked.parse(body)}</div>
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
    const a = Object.assign(document.createElement('a'), { href: url, download: `myshelf-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ───────── deep links: /admin/#edit=slug ─────────
// /admin/#add=collection-slug[&type=boardgame] — from "＋ Add more" in a collection's arrange dialog.
function handleHash() {
  const m = location.hash.match(/^#edit=([a-z0-9-]+)$/);
  if (m) return editSlug(m[1]);
  if (location.hash.startsWith('#add=')) {
    const q = new URLSearchParams(location.hash.slice(1));
    startAddingTo(q.get('add'), q.get('type'));
    history.replaceState(null, '', location.pathname);
  }
}

function startAddingTo(slug, type) {
  const c = state.collections.find((x) => x.slug === slug && !x.auto);
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
