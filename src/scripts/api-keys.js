// Manage → Settings → API keys: paste, replace, remove and test the keys for each database.
// The server never sends a key back, only whether it's set (here or as a Worker secret) and its last four characters.
import { esc, api } from './friends-ui.js';

const $ = (s, root = document) => root.querySelector(s);
const list = $('#keys-list');
const TYPES = JSON.parse($('#admin').dataset.types);
let groups = [];
let enabled = null; // media types this site shows
const replacing = new Set(); // key names whose "Replace" box is open
const notes = {}; // group id → { text, kind } shown under the group

function fieldRow(f) {
  const id = `key-${f.name}`;
  const name = `<code class="key-name">${esc(f.name)}</code>`;
  const label = `<label for="${id}">${esc(f.label)} ${name}</label>`;
  const has = f.saved || f.secret;
  if (has && !replacing.has(f.name)) {
    const where = f.saved ? 'Saved here' : 'Worker secret';
    const shown = f.plain ? ` · ${esc(f.hint)}` : f.hint ? ` · ends in <code>${esc(f.hint)}</code>` : '';
    return `<div class="key-row">${label}
      <div class="key-state"><span class="key-ok">✓ ${where}${shown}</span>
        <button type="button" class="btn ghost small" data-key-replace="${esc(f.name)}">${f.plain ? 'Change' : 'Replace'}</button>
        ${f.saved ? `<button type="button" class="btn ghost small" data-key-remove="${esc(f.name)}">Remove</button>` : ''}
      </div></div>`;
  }
  const placeholder = f.secret ? 'Paste a new one to use instead of the Worker secret' : f.plain ? 'you@example.com' : 'Paste it here';
  return `<div class="key-row">${label}
    <div class="key-state"><input id="${id}" name="${esc(f.name)}" type="${f.plain ? 'email' : 'password'}" autocomplete="off" spellcheck="false" placeholder="${placeholder}" />
    ${has ? `<button type="button" class="btn ghost small" data-key-cancel="${esc(f.name)}">Cancel</button>` : ''}</div></div>`;
}

function render() {
  list.innerHTML = groups.map((g) => {
    const off = g.types.length && enabled && !g.types.some((t) => enabled.includes(t));
    const offNote = off ? `<span class="muted small">Not needed: ${esc(g.types.map((t) => TYPES[t]?.plural || t).join(' and '))} ${g.types.length > 1 ? 'are' : 'is'} turned off</span>` : '';
    const anyInput = g.fields.some((f) => !(f.saved || f.secret) || replacing.has(f.name));
    const anySet = g.fields.some((f) => f.saved || f.secret) || g.id === 'youtube';
    const note = notes[g.id];
    return `<form class="key-group${off ? ' off' : ''}" data-key-group="${esc(g.id)}">
      <div class="key-head"><h3>${esc(g.label)}</h3>${offNote}</div>
      ${g.fields.map(fieldRow).join('')}
      <div class="row key-actions">
        ${anyInput ? '<button type="submit" class="btn primary small">Save</button>' : ''}
        ${g.testable && anySet ? '<button type="button" class="btn ghost small" data-key-test>Test</button>' : ''}
        ${note ? `<span class="small ${note.kind === 'error' ? 'error' : note.kind === 'ok' ? 'key-ok' : 'muted'}">${esc(note.text)}</span>` : ''}
      </div>
    </form>`;
  }).join('');
}

function show(data) {
  groups = data.groups || [];
  const err = $('#keys-error');
  err.hidden = !data.error;
  err.textContent = data.error || '';
  render();
}

async function load() {
  try {
    const [keys, site] = await Promise.all([api('keys'), api('site').catch(() => null)]);
    enabled = site?.site?.types || null;
    show(keys);
  } catch (err) {
    list.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function test(id) {
  notes[id] = { text: 'Testing…' };
  render();
  try {
    notes[id] = { text: (await api('keys', { method: 'POST', body: { test: id } })).message, kind: 'ok' };
  } catch (err) {
    notes[id] = { text: err.message, kind: 'error' };
  }
  render();
}

async function save(changes, groupId, { thenTest = true, done = 'Saved.' } = {}) {
  try {
    const data = await api('keys', { method: 'POST', body: { keys: changes } });
    Object.keys(changes).forEach((n) => replacing.delete(n));
    show(data);
    document.dispatchEvent(new CustomEvent('myshelf:keys-changed'));
    const g = groups.find((x) => x.id === groupId);
    const complete = g && g.fields.every((f) => f.saved || f.secret);
    if (thenTest && g?.testable && complete) await test(groupId);
    else { notes[groupId] = { text: done, kind: 'ok' }; render(); }
  } catch (err) {
    notes[groupId] = { text: err.message, kind: 'error' };
    render();
  }
}

list.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('[data-key-group]');
  const changes = {};
  form.querySelectorAll('input[name]').forEach((i) => { if (i.value.trim()) changes[i.name] = i.value.trim(); });
  if (!Object.keys(changes).length) { notes[form.dataset.keyGroup] = { text: 'Paste a key first.', kind: 'error' }; return render(); }
  save(changes, form.dataset.keyGroup);
});

list.addEventListener('click', (e) => {
  const group = e.target.closest('[data-key-group]')?.dataset.keyGroup;
  const t = e.target.closest('button');
  if (!t || !group) return;
  if (t.dataset.keyReplace) { replacing.add(t.dataset.keyReplace); delete notes[group]; render(); $(`#key-${t.dataset.keyReplace}`)?.focus(); }
  else if (t.dataset.keyCancel) { replacing.delete(t.dataset.keyCancel); render(); }
  else if (t.dataset.keyRemove) {
    const f = groups.find((g) => g.id === group)?.fields.find((x) => x.name === t.dataset.keyRemove);
    const msg = f?.secret ? `Remove ${f.name} from here? Your Worker secret with the same name will be used again.` : `Remove ${t.dataset.keyRemove}? Searches that need it stop working until you add it again.`;
    if (confirm(msg)) save({ [t.dataset.keyRemove]: null }, group, { thenTest: false, done: 'Removed.' });
  } else if ('keyTest' in t.dataset) test(group);
});

document.addEventListener('myshelf:ready', load);
document.addEventListener('myshelf:tab', (e) => { if (e.detail === 'settings') load(); });
