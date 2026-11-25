// Shared drag-to-arrange dialog, used on the admin page and on public shelves (pencil button).
import Sortable from 'sortablejs';
import '../styles/arrange.css';

const COLORS = { book: '#8a3b2e', movie: '#2e4a6b', tv: '#4b3b6b', music: '#2f5e4e', videogame: '#6b4b1f', boardgame: '#5e2f45', video: '#7a2424' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function thumb(i) {
  const ph = `<span class="ar-ph" style="background:${COLORS[i.type] || '#555'}">${esc((i.title || '?').slice(0, 1))}</span>`;
  return i.cover
    ? `<span class="ar-thumb"><img src="${esc(i.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(this.nextElementSibling.content.cloneNode(true))"><template>${ph}</template></span>`
    : `<span class="ar-thumb">${ph}</span>`;
}

let dialog, list, sortable, current;

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'ar-dialog';
  dialog.innerHTML = `
    <header class="ar-head">
      <div>
        <h2 class="ar-title"></h2>
        <p class="ar-hint">Drag covers into the order you want. Items you add later appear at the front.</p>
      </div>
      <button type="button" class="ar-btn ar-ghost ar-small" data-ar-close aria-label="Close">✕</button>
    </header>
    <ol class="ar-list"></ol>
    <footer class="ar-foot">
      <button type="button" class="ar-btn ar-ghost ar-small ar-add" data-ar-add hidden>＋ Add more</button>
      <button type="button" class="ar-btn ar-ghost ar-small" data-ar-reset>Reset to newest first</button>
      <span class="ar-removed-note" aria-live="polite"></span>
      <span class="ar-spacer"></span>
      <button type="button" class="ar-btn ar-ghost" data-ar-close>Cancel</button>
      <button type="button" class="ar-btn ar-primary" data-ar-save>Save order</button>
    </footer>`;
  document.body.appendChild(dialog);
  list = dialog.querySelector('.ar-list');
  dialog.querySelectorAll('[data-ar-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  dialog.querySelector('[data-ar-add]').addEventListener('click', () => current.onAdd?.());
  dialog.addEventListener('close', () => current?.onClose?.());
  // Pencil: edit that item (the dialog stays open underneath).
  list.addEventListener('click', (e) => {
    const edit = e.target.closest('.ar-edit');
    if (!edit) return;
    e.preventDefault();
    const slug = edit.closest('.ar-item').dataset.slug;
    const item = current.items.find((i) => i.slug === slug);
    if (item) current.onEdit(item);
  });
  // Paper plane: recommend that item to friends.
  list.addEventListener('click', (e) => {
    const rec = e.target.closest('.ar-rec');
    if (!rec) return;
    e.preventDefault();
    const item = current.items.find((i) => i.slug === rec.closest('.ar-item').dataset.slug);
    if (item) current.onRecommend(item);
  });
  // Red ✕ marks an item to come off this collection; click again (↺) to keep it. Nothing changes until you save.
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.ar-remove');
    if (!btn) return;
    e.preventDefault();
    const li = btn.closest('.ar-item');
    const removed = li.classList.toggle('is-removed');
    btn.textContent = removed ? '↺' : '✕';
    btn.setAttribute('aria-label', removed ? `Keep ${li.dataset.title}` : `Remove ${li.dataset.title} from this collection`);
    btn.title = removed ? 'Keep it on this shelf' : 'Remove from this collection';
    updateRemoved();
  });
  dialog.querySelector('[data-ar-reset]').addEventListener('click', () => {
    const when = (i) => new Date(i.dateFinished || i.dateStarted || i.dateAdded || 0).getTime();
    render([...current.items].sort((a, b) => when(b) - when(a)));
    updateRemoved();
  });
  dialog.querySelector('[data-ar-save]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const order = [...list.querySelectorAll('.ar-item:not(.is-removed)')].map((li) => li.dataset.slug);
    const removed = [...list.querySelectorAll('.ar-item.is-removed')].map((li) => li.dataset.slug);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await current.onSave(order, removed);
      dialog.close();
    } catch (err) {
      toast(err.message || 'Could not save', 'error');
    } finally {
      btn.disabled = false;
      updateRemoved();
    }
  });
}

function updateRemoved() {
  const n = list.querySelectorAll('.ar-item.is-removed').length;
  dialog.querySelector('.ar-removed-note').textContent = n ? `${n} to remove` : '';
  dialog.querySelector('[data-ar-save]').textContent = n ? 'Save changes' : 'Save order';
  list.querySelectorAll('.ar-item:not(.is-removed) .ar-num').forEach((el, i) => (el.textContent = i + 1));
}

const SEND = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function itemHtml(i, n, removed = false) {
  return `<li class="ar-item${removed ? ' is-removed' : ''}" data-slug="${esc(i.slug)}" data-title="${esc(i.title)}"><span class="ar-num">${n + 1}</span>${
    current.onEdit ? `<button type="button" class="ar-edit" aria-label="Edit ${esc(i.title)}" title="Edit this item">${PENCIL}</button>` : ''
  }${
    current.canRemove?.(i) ? `<button type="button" class="ar-remove" aria-label="${removed ? `Keep ${esc(i.title)}` : `Remove ${esc(i.title)} from this collection`}" title="${removed ? 'Keep it on this shelf' : 'Remove from this collection'}">${removed ? '↺' : '✕'}</button>` : ''
  }${
    current.onRecommend ? `<button type="button" class="ar-rec" aria-label="Recommend ${esc(i.title)} to a friend" title="Recommend to a friend">${SEND}</button>` : ''
  }${thumb(i)}<span class="ar-name">${esc(i.title)}</span></li>`;
}

function render(items) {
  list.innerHTML = items.length ? items.map((i, n) => itemHtml(i, n)).join('') : '<li class="ar-empty">This collection is empty.</li>';
}

/** After an item was edited from the pencil: show its new title and cover in the dialog. */
export function updateItem(slug, item) {
  if (!current || !item) return;
  const idx = current.items.findIndex((i) => i.slug === slug);
  if (idx < 0) return;
  const next = { ...current.items[idx], ...item, slug: item.slug || slug };
  current.items[idx] = next;
  const li = list.querySelector(`.ar-item[data-slug="${CSS.escape(slug)}"]`);
  if (!li) return;
  const n = Number(li.querySelector('.ar-num')?.textContent) || 1;
  li.outerHTML = itemHtml(next, n - 1, li.classList.contains('is-removed'));
  updateRemoved();
}

/**
 * items: already in current shelf order. onSave(orderSlugs, removedSlugs) should persist (throw on failure).
 * canRemove(item): show the red ✕ on that item (hand-picked collection members only).
 * onAdd(): shows an "＋ Add more" button that runs it (e.g. go to search with the collection pre-checked).
 * onEdit(item): shows a pencil on each item that runs it (open the item editor).
 * onRecommend(item): shows a paper plane on each item that runs it (recommend it to friends).
 * onClose(): runs whenever the dialog closes (saved or not).
 * removeHint: what the red ✕ does, when it isn't simply "take it off this shelf".
 */
export function openArrange({ title, items, onSave, canRemove = null, onAdd = null, onEdit = null, onRecommend = null, onClose = null, removeHint = '' }) {
  if (!dialog) build();
  current = { items, onSave, canRemove, onAdd, onEdit, onRecommend, onClose };
  dialog.querySelector('.ar-title').textContent = `Arrange “${title}”`;
  dialog.querySelector('.ar-hint').textContent = (canRemove
    ? `Drag covers into the order you want. ${removeHint || 'Use the red ✕ to take something off this shelf.'}`
    : 'Drag covers into the order you want. Items you add later appear at the front.') + (onEdit ? ' The pencil edits an item.' : '') + (onRecommend ? ' The paper plane recommends it to friends.' : '');
  dialog.querySelector('[data-ar-add]').hidden = !onAdd;
  render(items);
  updateRemoved();
  sortable?.destroy();
  sortable = Sortable.create(list, {
    animation: 180,
    ghostClass: 'ar-ghost-item',
    chosenClass: 'ar-chosen',
    delay: 120, delayOnTouchOnly: true, // on phones: press & hold briefly to pick up, so scrolling still works
    filter: '.ar-remove, .ar-edit, .ar-rec', preventOnFilter: false, // the ✕ and pencil are buttons, not drag handles
    onSort: updateRemoved,
  });
  dialog.showModal();
}

let toastEl, toastTimer;
export function toast(msg, kind = 'ok') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'ar-toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  // Inside the open dialog it has to live in the dialog, or the backdrop dims it.
  const host = dialog?.open ? dialog : document.body;
  if (toastEl.parentNode !== host) host.appendChild(toastEl);
  toastEl.textContent = msg;
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 7000 : 4500);
}
