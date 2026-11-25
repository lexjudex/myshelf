// Manage → Settings → Shelf decorations: up to three images on top of the bookcase (main Shelves page).
// The Desktop / Phone switch picks which layout you see AND edit: phones follow desktop (smaller) until you change
// something in Phone view, then they keep their own placement. Every change saves by itself.
import { esc, token } from './friends-ui.js';
import { phoneOf } from '../lib/decor.js';
import Sortable from 'sortablejs';

const $ = (s, root = document) => root.querySelector(s);
const FRAMES = [['none', 'None'], ['wood', 'Wood'], ['black', 'Black'], ['gold', 'Gold'], ['white', 'White']];
const MAX = 3;
const FIELDS = {
  x: { min: 0, max: 100, step: 0.5, unit: '%', label: 'Left / right', hint: 'from the left edge of the bookcase' },
  y: { min: -20, max: 160, step: 1, unit: 'px', label: 'Up / down', hint: 'raised above the shelf (0 = standing on it)' },
  height: { min: 20, max: 240, step: 1, unit: 'px', label: 'Size', hint: 'tall' },
  tilt: { min: -20, max: 20, step: 0.5, unit: '°', label: 'Tilt', hint: 'lean it flat: minus leans left, plus leans right' },
  turn: { min: -50, max: 50, step: 1, unit: '°', label: 'Turn', hint: 'angle it on the shelf: minus faces left, plus faces right' },
};
let decor = [];

async function call(method, body, raw = false) {
  const res = await fetch('/api/decor', {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': raw ? body.type || 'application/octet-stream' : 'application/json' } : {}) },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.decor || [];
}

const msg = (text, error = false) => {
  const el = $('#decor-msg');
  el.textContent = text;
  el.classList.toggle('error', error);
};

// ───────── which layout we're looking at and editing ─────────
// The preview is your real Shelves page (/?decor-preview) in a frame: 1280px wide for desktop, or a phone's width
// (this phone's, if you're on one), shrunk to fit here. The page draws the decorations itself, so what you see is
// exactly what visitors get, in this browser.
const PHONE_MAX = 760; // matches the page's phone layout breakpoint
let mode = 'desktop';
const frameWidth = () => (mode === 'phone' ? (window.innerWidth <= PHONE_MAX ? window.innerWidth : 390) : 1280);
const placement = (d) => (mode === 'phone' ? phoneOf(d) : d);
// Editing in Phone view gives that decoration its own phone placement (starting from what it showed).
function setPlacement(i, patch) {
  const d = decor[i];
  decor[i] = mode === 'phone' ? { ...d, phone: { ...phoneOf(d), ...patch } } : { ...d, ...patch };
}

const preview = $('#decor-preview');
const frame = $('#decor-frame');
let frameReady = false;
let frameHeight = 160;
frame.src = '/?decor-preview';
function scalePreview() {
  const w = frameWidth();
  const fit = Math.min(1, preview.clientWidth / w) || 1;
  frame.style.width = `${w}px`;
  frame.style.height = `${frameHeight}px`;
  frame.style.transform = `scale(${fit})`;
  // A phone is shown at its own size, centered, rather than stretched across the panel.
  frame.style.left = `${Math.max(0, (preview.clientWidth - w * fit) / 2)}px`;
  preview.style.height = `${Math.ceil(frameHeight * fit)}px`;
}
// Send the current decorations to the page in the frame (at most once per animation frame).
let pending = false;
let focusAfter = null;
function renderStage(focus = null) {
  if (focus != null) focusAfter = focus;
  if (pending || !frameReady) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    frame.contentWindow?.postMessage({ type: 'myshelf:decor', decor, focus: focusAfter }, location.origin);
    focusAfter = null;
  });
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.type === 'myshelf:decor-ready') {
    frameReady = true;
    $('#decor-loading').hidden = true;
    renderStage();
  } else if (m.type === 'myshelf:decor-size') {
    frameHeight = Math.max(80, m.height || 0);
    scalePreview();
  } else if (m.type === 'myshelf:decor-move' && decor[m.i]) {
    if (m.done) return save();
    setField(m.i, 'x', m.x);
    if (m.y != null) setField(m.i, 'y', m.y);
  } else if (m.type === 'myshelf:decor-nudge' && decor[m.i]) {
    const k = m.field === 'y' ? 'y' : 'x';
    setField(m.i, k, Math.round(((Number(placement(decor[m.i])[k]) || 0) + m.step) * 10) / 10, m.i);
    saveSoon();
  }
});
document.querySelectorAll('[data-decor-mode]').forEach((b) => b.addEventListener('click', () => {
  mode = b.dataset.decorMode;
  document.querySelectorAll('[data-decor-mode]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  scalePreview(); // the page in the frame switches between its desktop and phone layouts by itself
  render();
}));
new ResizeObserver(scalePreview).observe(preview);
window.addEventListener('resize', scalePreview);

// Update one decoration (keeps focus in the rows; the preview redraws).
function refreshOne(i, focus = null) {
  renderStage(focus);
  const row = $(`#decor-list .decor-row[data-i="${i}"]`);
  if (!row) return;
  const p = placement(decor[i]);
  for (const k of Object.keys(FIELDS)) {
    row.querySelectorAll(`[data-field="${k}"]`).forEach((inp) => { if (document.activeElement !== inp) inp.value = p[k]; });
  }
  const note = row.querySelector('.decor-phone-note');
  if (note) note.innerHTML = phoneNote(decor[i], i);
}

// ───────── rows ─────────
const options = (list, value) => list.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('');
const fieldHtml = (k, p) => {
  const f = FIELDS[k];
  return `<label class="decor-field" title="${f.hint}">${f.label}
    <input type="range" data-field="${k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${p[k]}">
    <span class="decor-num"><input type="number" data-field="${k}" min="${f.min}" max="${f.max}" step="${k === 'x' ? 0.1 : f.step}" value="${p[k]}">${f.unit}</span>
  </label>`;
};
const phoneNote = (d, i) => (d.phone
  ? `Phone has its own placement. <button type="button" class="linkish" data-decor-follow="${i}">Match desktop again</button>`
  : 'Following desktop (smaller). Change anything here to give phones their own placement.');
function render() {
  scalePreview();
  renderStage();
  const phone = mode === 'phone';
  $('#decor-editing').innerHTML = phone
    ? 'Editing the <strong>phone</strong> layout. Frame and Mirror are shared with desktop.'
    : 'Editing the <strong>desktop</strong> layout.';
  $('#decor-list').innerHTML = decor.map((d, i) => {
    const p = placement(d);
    return `
    <li class="decor-row${phone && p.hidden ? ' is-hidden' : ''}" data-i="${i}">
      <div class="decor-side">
        <span class="decor-handle" title="Drag to change which one is in front" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
        <img class="decor-thumb" src="${esc(d.image)}" alt="Decoration ${i + 1}">
        ${decor.length > 1 ? `<span class="decor-layer muted small">${i === 0 ? 'In front' : i === decor.length - 1 ? 'At the back' : 'Middle'}</span>` : ''}
        ${decor.length > 1 ? `<span class="decor-move"><button type="button" class="btn ghost small" data-decor-up="${i}" aria-label="Move forward"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="btn ghost small" data-decor-down="${i}" aria-label="Move back"${i === decor.length - 1 ? ' disabled' : ''}>↓</button></span>` : ''}
      </div>
      <div class="decor-controls">
        ${phone ? `<p class="decor-phone-note muted small">${phoneNote(d, i)}</p>` : ''}
        ${fieldHtml('x', p)}${fieldHtml('y', p)}${fieldHtml('height', p)}${fieldHtml('tilt', p)}${fieldHtml('turn', p)}
        <div class="decor-options">
          ${phone ? `<label class="check"><input type="checkbox" data-field="showOnPhone"${p.hidden ? '' : ' checked'}> Show on phones</label>` : ''}
          <label>Frame <select data-field="frame">${options(FRAMES, d.frame || 'none')}</select></label>
          <label class="check"><input type="checkbox" data-field="flip"${d.flip ? ' checked' : ''}> Mirror</label>
          <button type="button" class="btn ghost small" data-decor-center="${i}" title="Put it in the exact middle">Center it</button>
          <span class="spacer"></span>
          <button type="button" class="btn ghost small danger" data-decor-del="${i}">Remove</button>
        </div>
      </div>
    </li>`;
  }).join('');
  $('#decor-add').hidden = decor.length >= MAX;
}

// ───────── saving (debounced, so dragging a slider doesn't send dozens of saves) ─────────
let saveTimer;
function saveSoon(delay = 450) {
  clearTimeout(saveTimer);
  msg('Saving…');
  saveTimer = setTimeout(save, delay);
}
const sameNumbers = (a, b) => Object.keys(FIELDS).every((k) => Number(a?.[k] ?? 0) === Number(b?.[k] ?? 0));
async function save(okText = 'Saved. Your Shelves page shows it right away.') {
  clearTimeout(saveTimer);
  try {
    const saved = await call('PUT', { decor });
    // Keep what's on screen unless the server changed a value (out of range, rounding).
    const same = saved.length === decor.length && saved.every((d, i) => sameNumbers(d, decor[i]) && Boolean(d.phone) === Boolean(decor[i].phone)
      && (!d.phone || (sameNumbers(d.phone, decor[i].phone) && d.phone.hidden === decor[i].phone.hidden)));
    decor = saved;
    if (!same) render();
    msg(okText);
  } catch (err) {
    msg(err.message, true);
  }
}

async function load() {
  try { decor = await call('GET'); render(); } catch (err) { msg(err.message, true); }
}

function setField(i, k, v, focus = null) {
  if (k in FIELDS) {
    const f = FIELDS[k];
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    setPlacement(i, { [k]: Math.min(f.max, Math.max(f.min, n)) });
  } else if (k === 'showOnPhone') {
    setPlacement(i, { hidden: !v });
  } else {
    decor[i] = { ...decor[i], [k]: v }; // frame, flip: shared by both layouts
  }
  refreshOne(i, focus);
}

$('#decor-list').addEventListener('input', (e) => {
  const k = e.target.dataset.field;
  if (!(k in FIELDS)) return;
  setField(Number(e.target.closest('.decor-row').dataset.i), k, e.target.value);
  saveSoon();
});
$('#decor-list').addEventListener('change', (e) => {
  const k = e.target.dataset.field;
  if (!k || k in FIELDS) return;
  const i = Number(e.target.closest('.decor-row').dataset.i);
  setField(i, k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  if (k === 'showOnPhone') e.target.closest('.decor-row').classList.toggle('is-hidden', !e.target.checked);
  save();
});
// ───────── layering: the top of the list stands in front ─────────
function moveDecor(from, to) {
  if (to < 0 || to >= decor.length || from === to) return;
  const [d] = decor.splice(from, 1);
  decor.splice(to, 0, d);
  render();
  save(to === 0 ? 'Moved to the front.' : to === decor.length - 1 ? 'Moved to the back.' : 'Moved.');
}
Sortable.create($('#decor-list'), {
  handle: '.decor-handle',
  animation: 160,
  onEnd: (e) => { if (e.oldIndex !== e.newIndex) { const { oldIndex, newIndex } = e; render(); moveDecor(oldIndex, newIndex); } },
});

$('#decor-list').addEventListener('click', (e) => {
  const up = e.target.closest('[data-decor-up]');
  if (up) return moveDecor(Number(up.dataset.decorUp), Number(up.dataset.decorUp) - 1);
  const down = e.target.closest('[data-decor-down]');
  if (down) return moveDecor(Number(down.dataset.decorDown), Number(down.dataset.decorDown) + 1);
  const follow = e.target.closest('[data-decor-follow]');
  if (follow) {
    const i = Number(follow.dataset.decorFollow);
    decor[i] = { ...decor[i], phone: null };
    render();
    save('Phones follow desktop again.');
    return;
  }
  const center = e.target.closest('[data-decor-center]');
  if (center) { setField(Number(center.dataset.decorCenter), 'x', 50); save(); return; }
  const del = e.target.closest('[data-decor-del]');
  if (!del) return;
  if (!del.classList.contains('confirm')) {
    del.classList.add('confirm');
    del.textContent = 'Remove it?';
    setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Remove'; }, 4000);
    return;
  }
  decor = decor.filter((_, i) => i !== Number(del.dataset.decorDel));
  render();
  save('Removed.');
});

// Dragging and arrow-key nudges happen in the preview page itself, which reports them back (see the messages above).

// ───────── adding ─────────
$('#decor-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) return msg('Use a PNG, WebP or JPG image.', true);
  if (file.size > 2 * 1024 * 1024) return msg('That image is over 2 MB. Try a smaller one.', true);
  msg('Uploading…');
  try {
    decor = await call('POST', file, true);
    msg(file.type === 'image/jpeg'
      ? 'Added in a wood frame, angled a little (a JPG can’t be see-through). Drag it into place, and change the frame and turn below.'
      : 'Added. Drag it into place in the preview, or set exact numbers below.');
  } catch (err) {
    msg(err.message, true);
  }
  render();
});

document.addEventListener('myshelf:ready', load);
document.addEventListener('myshelf:tab', (e) => { if (e.detail === 'settings') load(); });
