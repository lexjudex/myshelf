// Manage → Settings → Shelf decorations: up to three images on top of the bookcase (main Shelves page).
// Every change saves right away.
import { esc, token } from './friends-ui.js';

const $ = (s) => document.querySelector(s);
const POSITIONS = [['left', 'Left'], ['left-center', 'Left of center'], ['center', 'Center'], ['right-center', 'Right of center'], ['right', 'Right']];
const SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const FRAMES = [['none', 'None'], ['wood', 'Wood'], ['black', 'Black'], ['gold', 'Gold'], ['white', 'White']];
const MAX = 3;
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

const imgTag = (d) => {
  const frame = d.frame && d.frame !== 'none' ? ` framed frame-${esc(d.frame)}` : '';
  return `<span class="decor decor-${esc(d.size)} decor-${esc(d.position)}${d.flip ? ' flip' : ''}${frame}"><img src="${esc(d.image)}" alt=""${d.aspect ? ` style="aspect-ratio:${Number(d.aspect)}"` : ''}></span>`;
};
const options = (list, value) => list.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('');

function render() {
  $('#decor-stage').innerHTML = decor.length ? decor.map(imgTag).join('') : '<p class="decor-empty">Your decorations will stand here, on top of the bookcase.</p>';
  $('#decor-list').innerHTML = decor.map((d, i) => `
    <li class="decor-row" data-i="${i}">
      <img class="decor-thumb" src="${esc(d.image)}" alt="Decoration ${i + 1}">
      <label>Position <select data-field="position">${options(POSITIONS, d.position)}</select></label>
      <label>Size <select data-field="size">${options(SIZES, d.size)}</select></label>
      <label>Frame <select data-field="frame">${options(FRAMES, d.frame || 'none')}</select></label>
      <label class="check"><input type="checkbox" data-field="flip"${d.flip ? ' checked' : ''}> Mirror</label>
      <span class="spacer"></span>
      <button type="button" class="btn ghost small danger" data-decor-del="${i}">Remove</button>
    </li>`).join('');
  $('#decor-add').hidden = decor.length >= MAX;
}

async function save(next, okText = 'Saved. Your Shelves page shows it right away.') {
  try {
    decor = await call('PUT', { decor: next });
    msg(okText);
  } catch (err) {
    msg(err.message, true);
  }
  render();
}

async function load() {
  try { decor = await call('GET'); render(); } catch (err) { msg(err.message, true); }
}

$('#decor-list').addEventListener('change', (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const i = Number(e.target.closest('.decor-row').dataset.i);
  const next = decor.map((d) => ({ ...d }));
  next[i][field] = field === 'flip' ? e.target.checked : e.target.value;
  decor = next;
  render(); // preview right away
  save(next);
});

$('#decor-list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-decor-del]');
  if (!del) return;
  if (!del.classList.contains('confirm')) {
    del.classList.add('confirm');
    del.textContent = 'Remove it?';
    setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Remove'; }, 4000);
    return;
  }
  save(decor.filter((_, i) => i !== Number(del.dataset.decorDel)), 'Removed.');
});

$('#decor-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) return msg('Use a PNG, WebP or JPG image.', true);
  if (file.size > 2 * 1024 * 1024) return msg('That image is over 2 MB. Try a smaller one.', true);
  msg('Uploading…');
  try {
    decor = await call('POST', file, true);
    msg(file.type === 'image/jpeg' ? 'Added in a wood frame (a JPG can’t be see-through). Change the frame, spot and size below.' : 'Added. Pick where it stands, how big it is, and whether it gets a frame below.');
  } catch (err) {
    msg(err.message, true);
  }
  render();
});

document.addEventListener('myshelf:ready', load);
document.addEventListener('myshelf:tab', (e) => { if (e.detail === 'settings') load(); });
