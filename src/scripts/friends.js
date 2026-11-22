// Admin UI: Friends tab (other MyShelf sites, inbox, groups, recommendations) and Settings tab.
import { esc, api, fmt, inboxHtml, waiting, markSeen as markInboxSeen, bindFriendActions } from './friends-ui.js';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const TYPES = JSON.parse($('#admin').dataset.types);

let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 7000 : 4500);
}

// ───────── friends tab ─────────
const state = { me: null, friends: [], inbox: [], groups: [], loaded: false };
const friendName = (f) => f.owner || f.name || f.url;

async function loadFriends() {
  try {
    const data = await api('friends');
    Object.assign(state, data, { loaded: true });
    render();
  } catch (err) {
    $('#friend-msg').textContent = err.message;
  }
}

function setUnread(n) {
  const el = $('#friends-unread');
  el.hidden = !n;
  el.textContent = n;
}

function render() {
  $('#my-address').textContent = state.me?.url || '';
  setUnread(state.unread);
  renderInbox();
  renderFriends();
  renderGroups();
}

function renderInbox() {
  $('#inbox-clear').hidden = !state.inbox.some((m) => !waiting(m, state.friends));
  $('#inbox-all-read').hidden = !state.inbox.some((m) => m.status === 'unread');
  $('#inbox-list').innerHTML = inboxHtml(state.inbox, state.friends, TYPES);
}

function renderFriends() {
  const label = { accepted: '', requested: 'Waiting for them to accept', pending: 'Wants to be friends', blocked: 'Blocked' };
  const list = $('#friend-list');
  if (!state.friends.length) {
    list.innerHTML = '<li class="muted">No friends yet. Add one with a friend’s MyShelf address below.</li>';
    return;
  }
  list.innerHTML = state.friends.map((f) => `
    <li class="friend-row">
      <span class="friend-text">
        <strong>${esc(friendName(f))}</strong>${f.owner && f.name ? ` <span class="muted">· ${esc(f.name)}</span>` : ''}
        <span class="muted small">${esc(f.url.replace(/^https?:\/\//, ''))}</span>
        ${label[f.status] ? `<span class="vis-badge">${label[f.status]}</span>` : ''}
      </span>
      <span class="friend-actions">
        ${f.status === 'accepted' ? `<a class="btn ghost small" href="${esc(f.url)}" target="_blank" rel="noopener">View shelf ↗</a>` : ''}
        ${f.status === 'pending' ? `<button class="btn primary small" data-friend-act="accept" data-id="${esc(f.id)}">Accept</button>` : ''}
        <button class="btn ghost small danger" data-friend-act="remove" data-id="${esc(f.id)}">${f.status === 'requested' ? 'Cancel' : f.status === 'blocked' ? 'Unblock' : 'Remove'}</button>
      </span>
    </li>`).join('');
}

// ───────── groups ─────────
// Edited here, saved all at once. Only you see them: they filter your Friends page and fill in the Recommend dialog.
let groupsDirty = false;
function renderGroups() {
  const accepted = state.friends.filter((f) => f.status === 'accepted');
  const box = $('#group-list');
  $('#groups-section').hidden = !accepted.length;
  if (!state.groups.length) {
    box.innerHTML = '<li class="muted">No groups yet.</li>';
  } else {
    box.innerHTML = state.groups.map((g, i) => `
      <li class="group-row" data-i="${i}">
        <div class="group-head">
          <input class="group-name" value="${esc(g.name)}" maxlength="60" placeholder="Group name, e.g. Board game night" aria-label="Group name" />
          <button type="button" class="btn ghost small danger" data-group-del="${i}">Delete</button>
        </div>
        <div class="checks">${accepted.map((f) => `<label class="check"><input type="checkbox" value="${esc(f.url)}" ${g.members.includes(f.url) ? 'checked' : ''}/> ${esc(friendName(f))}</label>`).join('')}</div>
      </li>`).join('');
  }
  $('#groups-save').classList.toggle('needs-save', groupsDirty);
}
function readGroups() {
  return $$('#group-list .group-row').map((row) => ({
    ...state.groups[Number(row.dataset.i)],
    name: $('.group-name', row).value,
    members: $$('input[type="checkbox"]:checked', row).map((cb) => cb.value),
  }));
}
$('#group-list').addEventListener('input', () => { groupsDirty = true; $('#groups-save').classList.add('needs-save'); });
$('#group-list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-group-del]');
  if (!del) return;
  state.groups = readGroups().filter((_, i) => i !== Number(del.dataset.groupDel));
  groupsDirty = true;
  renderGroups();
});
$('#group-add').addEventListener('click', () => {
  state.groups = [...readGroups(), { id: '', name: '', members: [] }];
  groupsDirty = true;
  renderGroups();
  $$('#group-list .group-name').at(-1)?.focus();
});
$('#groups-save').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const groups = readGroups().filter((g) => g.name.trim() || g.members.length);
  btn.disabled = true;
  try {
    ({ groups: state.groups } = await api('friends', { method: 'POST', body: { action: 'groups', groups } }));
    groupsDirty = false;
    renderGroups();
    toast('Groups saved.');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('myshelf:ready', loadFriends);
// Messages that need no answer count as read a moment after you open the Friends tab.
function markSeen() {
  setUnread(markInboxSeen(state.inbox));
  $('#inbox-all-read').hidden = !state.inbox.some((m) => m.status === 'unread');
}
document.addEventListener('myshelf:tab', async (e) => {
  if (e.detail !== 'friends') return;
  await loadFriends();
  setTimeout(markSeen, 1500);
});

$('#copy-address').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.me?.url || ''); toast('Address copied.'); } catch { toast('Couldn’t copy. Select the address and copy it instead.', 'error'); }
});

$('#inbox-clear').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm', 'danger');
    btn.textContent = 'Clear everything?';
    setTimeout(() => { btn.classList.remove('confirm', 'danger'); btn.textContent = 'Clear inbox'; }, 4000);
    return;
  }
  btn.disabled = true;
  try {
    await api('friends', { method: 'POST', body: { action: 'clear-inbox' } });
    const left = state.inbox.filter((m) => waiting(m, state.friends)).length;
    toast(left ? `Inbox cleared. ${left === 1 ? 'One request is' : `${left} requests are`} still waiting on your answer.` : 'Inbox cleared.');
    await loadFriends();
    setUnread(state.inbox.filter((m) => m.status === 'unread').length);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('confirm', 'danger');
    btn.textContent = 'Clear inbox';
  }
});

$('#friend-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#friend-add button');
  btn.disabled = true;
  $('#friend-msg').textContent = 'Contacting their site…';
  try {
    const { friend, status } = await api('friends', { method: 'POST', body: { action: 'add', url: $('#friend-url').value } });
    const name = friendName(friend);
    $('#friend-msg').textContent = status === 'accepted' ? `You and ${name} are now friends.` : `Friend request sent to ${name}. You’ll be connected when they accept.`;
    $('#friend-url').value = '';
    await loadFriends();
  } catch (err) {
    $('#friend-msg').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// Inbox buttons (accept, lend, add a recommendation, delete a comment) and friend list buttons.
bindFriendActions($('[data-panel="friends"]'), {
  toast,
  reload: loadFriends,
  inbox: () => state.inbox,
  onAddRec: (it) => document.dispatchEvent(new CustomEvent('myshelf:search', { detail: { type: it.type, title: it.title } })),
});

document.addEventListener('click', (e) => {
  const rec = e.target.closest('[data-recommend]');
  if (rec) openRecommend(rec.dataset.recommend, rec.dataset.title);
});

// ───────── recommend dialog ─────────
const recDialog = $('#recommend');
let recSlug = null;
async function openRecommend(slug, title) {
  if (!state.loaded) await loadFriends();
  const friends = state.friends.filter((f) => f.status === 'accepted');
  if (!friends.length) return toast('Add a friend first (Friends tab).', 'error');
  recSlug = slug;
  $('#recommend-title').textContent = `Recommend “${title}”`;
  $('#rec-friends').innerHTML = friends.map((f) => `<label class="check"><input type="checkbox" value="${esc(f.id)}" data-url="${esc(f.url)}" ${friends.length === 1 ? 'checked' : ''}/> ${esc(friendName(f))}</label>`).join('');
  // Groups: one click ticks everyone in it (click again to untick them).
  const groups = state.groups.filter((g) => g.members.length);
  $('#rec-groups').hidden = !groups.length;
  $('#rec-groups').innerHTML = groups.length ? `<span class="muted small">Groups:</span> ${groups.map((g) => `<button type="button" class="btn ghost small" data-rec-group="${esc(g.id)}">${esc(g.name)} <span class="muted">${g.members.length}</span></button>`).join(' ')}` : '';
  $('#recommend-form').note.value = '';
  recDialog.showModal();
}
$$('[data-close-rec]', recDialog).forEach((b) => b.addEventListener('click', () => recDialog.close()));
$('#rec-groups').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rec-group]');
  if (!b) return;
  const g = state.groups.find((x) => x.id === b.dataset.recGroup);
  const boxes = $$('#rec-friends input').filter((cb) => g?.members.includes(cb.dataset.url));
  const allOn = boxes.length && boxes.every((cb) => cb.checked);
  boxes.forEach((cb) => (cb.checked = !allOn));
});
$('#recommend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const friendIds = $$('#rec-friends input:checked').map((i) => i.value);
  if (!friendIds.length) return toast('Pick at least one friend.', 'error');
  const btn = $('#rec-send');
  btn.disabled = true;
  try {
    const { results } = await api('friends', { method: 'POST', body: { action: 'recommend', slug: recSlug, friendIds, note: e.target.note.value } });
    const failed = results.filter((r) => !r.ok);
    recDialog.close();
    toast(failed.length ? `Sent, but ${failed.length} couldn’t be reached: ${failed[0].error}` : 'Recommendation sent.', failed.length ? 'error' : 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ───────── settings tab ─────────
const siteForm = $('#site-form');
async function loadSite() {
  try {
    const { site } = await api('site');
    for (const k of ['title', 'tagline', 'owner', 'url', 'source']) siteForm[k].value = site[k] || '';
    $$('input[name="types"]', siteForm).forEach((cb) => (cb.checked = site.types.includes(cb.value)));
    applyTypes(site.types);
  } catch (err) {
    $('#site-msg').textContent = err.message;
  }
}

// Hide turned-off media types around the admin page (this page is built ahead of time, so it starts with all of them).
let enabled = null;
const isOn = (t) => !enabled || enabled.includes(t);
const typeSelect = $('#editor-form select[name="type"]');
// The editor keeps an item's own type available even if that type is turned off.
const refreshEditorTypes = () => $$('option', typeSelect).forEach((o) => (o.hidden = !isOn(o.value) && o.value !== typeSelect.value));
new MutationObserver(refreshEditorTypes).observe($('#editor'), { attributes: true, attributeFilter: ['open'] });
function applyTypes(types) {
  enabled = types;
  $$('.type-btn').forEach((b) => (b.hidden = !isOn(b.dataset.type)));
  if ($('.type-btn.active')?.hidden) $$('.type-btn').find((b) => !b.hidden)?.click();
  $$('#lib-type option').forEach((o) => (o.hidden = Boolean(o.value) && !isOn(o.value)));
  refreshEditorTypes();
  $$('.site-nav a, .fab-menu a').forEach((a) => {
    const m = a.getAttribute('href').match(/^\/type\/([a-z]+)\//);
    if (m) (a.closest('li') || a).hidden = !isOn(m[1]);
  });
}
// ───────── updates (Settings) ─────────
const ghLink = (repo) => `<a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener">${esc(repo)}</a>`;
const SOURCE_HINT = 'If you set up MyShelf by forking it, put your fork’s address (like <code>https://github.com/you/myshelf</code>) in <strong>Source code link</strong> above and save.';
const TOKEN_HINT = (repo) => `To check for and install updates from here, add a <strong>GITHUB_TOKEN</strong> secret to your Worker: a GitHub fine-grained token for just ${ghLink(repo)} with <em>Contents: Read and write</em>. Until then, use <strong>Sync fork</strong> on your repository’s GitHub page.`;
function renderVersion(v) {
  if (!v?.version) return;
  const bits = [v.commit && `<code>${esc(v.commit)}</code>`, v.built && `built ${fmt(v.built)}`].filter(Boolean);
  $('#version').innerHTML = `You’re running <strong>MyShelf ${esc(v.version)}</strong>${bits.length ? ` <span class="muted small">(${bits.join(', ')})</span>` : ''}.`;
}
async function loadUpdates() {
  const box = $('#updates');
  box.innerHTML = '<p class="muted">Checking for a new version…</p>';
  let u;
  try { u = await api('updates'); } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  renderVersion(u.current);
  const again = '<button type="button" class="btn ghost small" data-updates="check">Check again</button>';
  if (u.status === 'behind') {
    const list = u.changes.length ? `<ul class="updates-list">${u.changes.map((c) => `<li>${esc(c.message)}${c.date ? ` <span class="muted small">${fmt(c.date)}</span>` : ''}</li>`).join('')}</ul>` : '';
    box.innerHTML = `<p><strong>${u.latest && u.latest !== u.current?.version ? `Version ${esc(u.latest)} is available` : 'A new version is available'}</strong> from ${ghLink(u.upstream)} (${u.behind} ${u.behind === 1 ? 'change' : 'changes'}).</p>${list}
      ${u.canSync ? `<div class="row"><button type="button" class="btn primary" data-updates="sync">Update now</button>${again}</div>` : `<p class="muted small">${TOKEN_HINT(u.repo)}</p>${again}`}`;
  } else if (u.status === 'up-to-date') {
    box.innerHTML = `<p>✓ Up to date with ${ghLink(u.upstream)}.${u.yours ? ` <span class="muted small">Your copy also has ${u.yours} change${u.yours === 1 ? '' : 's'} of its own.</span>` : ''}</p>
      ${u.canSync ? '' : `<p class="muted small">${TOKEN_HINT(u.repo)}</p>`}${again}`;
  } else if (u.status === 'no-token') {
    box.innerHTML = `<p class="muted">${TOKEN_HINT(u.repo)}</p>`;
  } else if (u.status === 'not-fork') {
    box.innerHTML = `<p class="muted">${ghLink(u.repo)} isn’t a fork of another MyShelf, so there’s nothing to update it from. ${SOURCE_HINT}</p>`;
  } else if (u.status === 'no-repo' || u.status === 'not-found') {
    box.innerHTML = `<p class="muted">${u.repo ? `Couldn’t find ${esc(u.repo)} on GitHub.` : 'This site doesn’t know which GitHub repository it runs from.'} ${SOURCE_HINT}</p>`;
  } else if (u.status === 'bad-token') {
    box.innerHTML = `<p class="error">GitHub didn’t accept your GITHUB_TOKEN. It may have expired: make a new one and replace the secret.</p>${again}`;
  } else {
    box.innerHTML = `<p class="error">Couldn’t check for updates: ${esc(u.message || 'unknown error')}</p>${again}`;
  }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-updates]');
  if (!b) return;
  if (b.dataset.updates === 'check') return loadUpdates();
  b.disabled = true;
  b.textContent = 'Updating…';
  try {
    const r = await api('updates', { method: 'POST', body: {} });
    $('#updates').innerHTML = r.updated
      ? '<p><strong>Updated.</strong> Cloudflare is rebuilding your site now, and the new version goes live in a couple of minutes. Reload the page after that.</p>'
      : `<p>${esc(r.message)}</p>`;
  } catch (err) {
    b.disabled = false;
    b.textContent = 'Update now';
    toast(err.message, 'error');
  }
});
document.addEventListener('myshelf:tab', (e) => { if (e.detail === 'settings') loadUpdates(); });

document.addEventListener('myshelf:ready', loadSite);
document.addEventListener('myshelf:tab', (e) => { if (e.detail === 'settings') loadSite(); });
siteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(['title', 'tagline', 'owner', 'url', 'source'].map((k) => [k, siteForm[k].value]));
  body.types = $$('input[name="types"]:checked', siteForm).map((cb) => cb.value);
  if (!body.types.length) { $('#site-msg').textContent = 'Keep at least one kind of media turned on.'; return; }
  try {
    const { site } = await api('site', { method: 'POST', body });
    siteForm.url.value = site.url || '';
    siteForm.source.value = site.source || '';
    applyTypes(site.types);
    $('#site-msg').textContent = 'Saved. Your public pages show it right away.';
  } catch (err) {
    $('#site-msg').textContent = err.message;
  }
});

$('#settings-export').addEventListener('click', () => $('#export-btn').click());

$('#restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const msg = $('#restore-msg');
  let data;
  try { data = JSON.parse(await file.text()); } catch { msg.textContent = 'That file isn’t valid JSON.'; return; }
  const n = Array.isArray(data.items) ? data.items.length : 0;
  if (!n) { msg.textContent = 'That doesn’t look like a MyShelf backup.'; return; }
  if (!window.confirm(`Restore ${n} entries from this backup? Entries with the same name here will be replaced.`)) return;
  try {
    msg.textContent = 'Restoring entries…';
    const { items } = await api('restore', { method: 'POST', body: data });
    let origin = data.origin && data.origin !== location.origin ? data.origin : '';
    if (!data.origin) origin = window.prompt('Where was this backup made? Enter the old site’s address to copy its covers (leave blank to skip).', '') || '';
    let copied = 0, failed = 0;
    if (origin) {
      let offset = 0;
      for (let i = 0; i < 1000; i++) {
        const r = await api('restore?covers=1', { method: 'POST', body: { origin, offset } });
        copied += r.copied; failed += r.failed; offset = r.next;
        msg.textContent = `Restored ${items} entries. Copying covers… ${Math.min(offset, r.total)} / ${r.total}`;
        if (r.done) break;
      }
    }
    msg.textContent = `Restored ${items} entries${origin ? `, copied ${copied} cover${copied === 1 ? '' : 's'}${failed ? ` (${failed} couldn’t be copied)` : ''}` : ''}.`;
    document.dispatchEvent(new CustomEvent('myshelf:library-changed'));
    loadSite();
    toast('Restore finished.');
  } catch (err) {
    msg.textContent = err.message;
  }
});

// ───────── shelf effects (per device; on the login screen and in Settings) ─────────
const effectToggles = $$('.shelf-effects');
const effectsOn = () => { try { return localStorage.getItem('myshelf_motion') !== 'off'; } catch { return true; } };
effectToggles.forEach((box) => {
  box.checked = effectsOn();
  box.addEventListener('change', () => {
    try { box.checked ? localStorage.removeItem('myshelf_motion') : localStorage.setItem('myshelf_motion', 'off'); } catch {}
    document.documentElement.classList.toggle('flat-shelves', !box.checked);
    effectToggles.forEach((other) => (other.checked = box.checked));
    toast(box.checked ? 'Shelf effects are on.' : 'Shelf effects are off on this device.');
  });
});
