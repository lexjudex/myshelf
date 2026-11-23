// Manage → Settings → Shelf decorations: up to three images on top of the bookcase (main Shelves page).
// The Desktop / Phone switch picks which layout you see AND edit: phones follow desktop (smaller) until you change
// something in Phone view, then they keep their own placement. Every change saves by itself.
import { esc, token } from './friends-ui.js';
import { decorStyle, decorClasses, decorInner, decorMaxStyle, keepInside, phoneOf } from '../lib/decor.js';

const $ = (s, root = document) => root.querySelector(s);
const FRAMES = [['none', 'None'], ['wood', 'Wood'], ['black', 'Black'], ['gold', 'Gold'], ['white', 'White']];
const MAX = 3;
const FIELDS = {
  x: { min: 0, max: 100, step: 0.5, unit: '%', label: 'Position', hint: 'from the left edge' },
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
// The canvas is laid out at the bookcase's real width (desktop: the widest the page gets; phone: a typical phone),
// using the Shelves page's own styles, then shrunk to fit this panel.
const MODES = { desktop: { width: 1240 }, phone: { width: 366 } };
let mode = 'desktop';
const placement = (d) => (mode === 'phone' ? phoneOf(d) : d);
// Editing in Phone view gives that decoration its own phone placement (starting from what it showed).
function setPlacement(i, patch) {
  const d = decor[i];
  decor[i] = mode === 'phone' ? { ...d, phone: { ...phoneOf(d), ...patch } } : { ...d, ...patch };
}

const preview = $('#decor-preview');
const canvas = $('#decor-canvas');
const stage = $('#decor-stage');
function scalePreview() {
  const m = MODES[mode];
  canvas.style.width = `${m.width}px`;
  canvas.classList.toggle('phone', mode === 'phone');
  stage.classList.toggle('as-phone', mode === 'phone');
  stage.classList.toggle('as-desktop', mode === 'desktop');
  const fit = Math.min(1, preview.clientWidth / m.width);
  canvas.style.transform = `scale(${fit})`;
  canvas.style.left = `${Math.max(0, (preview.clientWidth - m.width * fit) / 2)}px`;
  preview.style.height = `${Math.ceil(canvas.offsetHeight * fit)}px`;
}
document.querySelectorAll('[data-decor-mode]').forEach((b) => b.addEventListener('click', () => {
  mode = b.dataset.decorMode;
  document.querySelectorAll('[data-decor-mode]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  render();
}));

// ───────── preview ─────────
function renderStage() {
  stage.setAttribute('style', decorMaxStyle(decor));
  stage.innerHTML = decor.length
    ? decor.map((d, i) => `<span class="${decorClasses(d)}" style="${decorStyle(d)}" data-i="${i}" tabindex="0" role="slider"
        aria-label="Decoration ${i + 1} position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${placement(d).x}"
        title="Drag to move · arrow keys nudge (Shift for bigger steps)">${decorInner(d, esc)}</span>`).join('')
    : '<p class="decor-empty">Your decorations will stand here, on top of the bookcase.</p>';
  scalePreview();
  stage.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', () => { scalePreview(); keepInside(stage); }, { once: true }); });
  keepInside(stage);
}
// Update one decoration in place (keeps focus and drag state).
function refreshOne(i) {
  const el = stage.querySelector(`.decor[data-i="${i}"]`);
  if (el) {
    el.className = decorClasses(decor[i]);
    el.setAttribute('style', decorStyle(decor[i]));
    el.setAttribute('aria-valuenow', placement(decor[i]).x);
  }
  stage.setAttribute('style', decorMaxStyle(decor));
  scalePreview();
  keepInside(stage);
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
  renderStage();
  const phone = mode === 'phone';
  $('#decor-editing').innerHTML = phone
    ? 'Editing the <strong>phone</strong> layout. Frame and Mirror are shared with desktop.'
    : 'Editing the <strong>desktop</strong> layout.';
  $('#decor-list').innerHTML = decor.map((d, i) => {
    const p = placement(d);
    return `
    <li class="decor-row${phone && p.hidden ? ' is-hidden' : ''}" data-i="${i}">
      <img class="decor-thumb" src="${esc(d.image)}" alt="Decoration ${i + 1}">
      <div class="decor-controls">
        ${phone ? `<p class="decor-phone-note muted small">${phoneNote(d, i)}</p>` : ''}
        ${fieldHtml('x', p)}${fieldHtml('height', p)}${fieldHtml('tilt', p)}${fieldHtml('turn', p)}
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
const sameNumbers = (a, b) => Object.keys(FIELDS).every((k) => Number(a?.[k]) === Number(b?.[k]));
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

function setField(i, k, v) {
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
  refreshOne(i);
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
$('#decor-list').addEventListener('click', (e) => {
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

// ───────── drag in the preview ─────────
let drag = null;
stage.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.decor[data-i]');
  if (!el) return;
  e.preventDefault();
  el.focus({ preventScroll: true });
  const i = Number(el.dataset.i);
  const box = stage.getBoundingClientRect();
  // Keep the grab point under the pointer instead of jumping the middle to it.
  drag = { i, el, offset: e.clientX - (box.left + (placement(decor[i]).x / 100) * box.width) };
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const box = stage.getBoundingClientRect();
  const x = Math.round(((e.clientX - drag.offset - box.left) / box.width) * 1000) / 10;
  setField(drag.i, 'x', Math.min(100, Math.max(0, x)));
});
const endDrag = () => {
  if (!drag) return;
  drag.el.classList.remove('dragging');
  drag = null;
  save();
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('keydown', (e) => {
  const el = e.target.closest('.decor[data-i]');
  if (!el || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const i = Number(el.dataset.i);
  const step = (e.shiftKey ? 5 : 0.5) * (e.key === 'ArrowLeft' ? -1 : 1);
  setField(i, 'x', Math.round((placement(decor[i]).x + step) * 10) / 10);
  saveSoon();
});
new ResizeObserver(() => { scalePreview(); keepInside(stage); }).observe(preview);

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
