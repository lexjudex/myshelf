// "Edit shelves" on the Shelves page and the media pages (signed in only): drag whole shelves into a new order,
// take shelves off the page, and add shelves (a collection that's shown elsewhere, a hidden status shelf, a starter
// shelf, or a brand-new empty one). Nothing changes until you press Save; then the page reloads to show it.
//
// Where it's stored:
//   Shelves page: the collections' own order and their "show on" setting (the same as Manage → Collections).
//   Media pages:  a per-type layout (order + hidden shelves). Taking a collection off a media page hides it on that
//                 page only. One that wasn't on any media page (or a new one) is turned on for media pages and
//                 starts out on this page only (hidden on the others, where it can be put back).
import Sortable from 'sortablejs';
import { STARTER_SHELVES, hiddenAfterEdit, showsOnType } from '../lib/sorting.js';
import { TYPE_KEYS } from '../lib/types.js';

const tools = document.querySelector('[data-shelves-page]');
const bookcase = document.querySelector('.bookcase');
const token = (() => { try { return localStorage.getItem('myshelf_token') || ''; } catch { return ''; } })();
if (tools && bookcase && token) init();
// Pages with just the ＋ (the Journal): show it once the sign-in checks out.
else if (token && document.querySelector('.pshelf-reveal')) {
  api('ping').then(() => document.querySelectorAll('.pshelf-reveal').forEach((el) => (el.hidden = false))).catch(() => {});
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) throw new Error('Your sign-in has expired. Sign in again on the Manage page.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HANDLE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

function init() {
  const page = tools.dataset.shelvesPage;
  const home = page === 'home';
  let addable = [];
  try { addable = JSON.parse(tools.dataset.addable || '[]'); } catch {}
  // Ping first: an old or wrong token shouldn't show the button.
  api('ping').then(() => {
    tools.hidden = false;
    document.querySelectorAll('.pshelf-reveal').forEach((el) => (el.hidden = false)); // the ＋ by a media page's title
  }).catch(() => {});

  let sortable = null;
  let bar = null;
  let newCount = 0;
  const sections = () => [...bookcase.querySelectorAll(':scope > .shelf-section[data-shelf-id]')];

  function kindNote(sec) {
    const id = sec.dataset.shelfId;
    if (id.startsWith('new:')) return 'New shelf · starts empty';
    if (id.startsWith('starter:')) return 'Starter shelf · fills itself';
    if (id.startsWith('s:')) return 'Fills itself by status';
    return sec.dataset.shelfKind === 'auto' ? 'Fills itself' : 'Your collection';
  }

  function decorate(sec) {
    if (sec.querySelector(':scope > .pshelf-bar')) return;
    const title = sec.dataset.shelfTitle || 'Shelf';
    sec.insertAdjacentHTML('afterbegin', `
      <div class="pshelf-bar">
        <span class="pshelf-handle" title="Drag to move" aria-hidden="true">${HANDLE}</span>
        <span class="pshelf-name"><strong>${esc(title)}</strong><span>${esc(kindNote(sec))}</span></span>
        <span class="pshelf-btns">
          <button type="button" class="pshelf-btn" data-move="-1" aria-label="Move ${esc(title)} up" title="Move up">↑</button>
          <button type="button" class="pshelf-btn" data-move="1" aria-label="Move ${esc(title)} down" title="Move down">↓</button>
          <button type="button" class="pshelf-btn pshelf-remove" data-remove aria-label="Hide ${esc(title)} on this page" title="Hide it on this page">Hide</button>
        </span>
      </div>`);
  }

  function start() {
    bookcase.classList.add('pshelf-editing');
    document.body.classList.add('pshelf-on');
    tools.querySelector('.pshelf-start').hidden = true;
    sections().forEach((sec) => {
      if (sec.classList.contains('shelf-edit-only')) sec.hidden = false;
      decorate(sec);
      if (sec.hasAttribute('data-off-page')) setOff(sec, true); // hidden on this page: listed, dimmed, with Show
    });
    bookcase.querySelectorAll(':scope > .shelf-section:not([data-shelf-id])').forEach((s) => s.classList.add('pshelf-ignore'));
    bar = document.createElement('div');
    bar.className = 'pshelf-actions';
    bar.innerHTML = `
      <p class="pshelf-hint">Drag shelves by the <span aria-hidden="true">⠿</span> handle (or use ↑ ↓). <strong>Hide</strong> takes a shelf off this page without deleting it${home ? '' : ' (other media pages keep it)'}. Hidden shelves stay in this list, dimmed: press <strong>Show</strong> to bring one back.</p>
      <div class="pshelf-add-wrap">
        <button type="button" class="pshelf-cta ghost" data-add-open aria-expanded="false">＋ Add a shelf</button>
        <div class="pshelf-add" hidden>
          ${addable.length ? `<p class="pshelf-add-label">Put back or add</p><ul>${addable.map((a) => `
            <li><button type="button" data-add-id="${esc(a.id)}" data-add-name="${esc(a.name)}"><strong>${esc(a.name)}</strong><span>${esc(a.note || '')}</span></button></li>`).join('')}</ul>` : ''}
          <form class="pshelf-new">
            <label>New shelf <input name="name" maxlength="80" placeholder="e.g. Comfort reads" required /></label>
            <button type="submit" class="pshelf-cta">Add</button>
          </form>
          <p class="pshelf-add-note">A new shelf starts empty. Add things with the shelf’s pencil (＋ Add more), or tick it under Collections when you edit an item.</p>
        </div>
      </div>
      <span class="pshelf-spacer"></span>
      <button type="button" class="pshelf-cta ghost" data-cancel>Cancel</button>
      <button type="button" class="pshelf-cta" data-save>Save shelves</button>`;
    bookcase.after(bar);
    sortable = Sortable.create(bookcase, {
      handle: '.pshelf-handle', draggable: '.shelf-section[data-shelf-id]', animation: 160,
      ghostClass: 'pshelf-ghost', chosenClass: 'pshelf-chosen',
    });
    bar.addEventListener('click', onBarClick);
    bar.querySelector('.pshelf-new').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      addShelf(`new:${++newCount}`, name);
      e.target.reset();
    });
    bookcase.querySelector('.pshelf-bar')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // A shelf added while editing: a bar at the bottom of the bookcase, draggable like the rest.
  function addShelf(id, name) {
    const sec = document.createElement('section');
    sec.className = 'shelf-section pshelf-added';
    sec.dataset.shelfId = id;
    sec.dataset.shelfTitle = name;
    bookcase.appendChild(sec);
    decorate(sec);
    sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
    bar.querySelector(`[data-add-id="${CSS.escape(id)}"]`)?.closest('li')?.setAttribute('hidden', '');
    closeAdd();
  }
  const closeAdd = () => {
    bar.querySelector('.pshelf-add').hidden = true;
    bar.querySelector('[data-add-open]').setAttribute('aria-expanded', 'false');
  };

  function onBarClick(e) {
    if (e.target.closest('[data-add-open]')) {
      const box = bar.querySelector('.pshelf-add');
      box.hidden = !box.hidden;
      e.target.closest('[data-add-open]').setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) box.querySelector('input')?.focus();
      return;
    }
    const pick = e.target.closest('[data-add-id]');
    if (pick) return addShelf(pick.dataset.addId, pick.dataset.addName);
    if (e.target.closest('[data-cancel]')) return location.reload();
    if (e.target.closest('[data-save]')) return save(e.target.closest('[data-save]'));
  }

  bookcase.addEventListener('click', (e) => {
    if (!bookcase.classList.contains('pshelf-editing')) return;
    const sec = e.target.closest('.shelf-section[data-shelf-id]');
    if (!sec) return;
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const list = sections();
      const i = list.indexOf(sec);
      const j = i + Number(mv.dataset.move);
      if (j < 0 || j >= list.length) return;
      if (j < i) list[j].before(sec); else list[j].after(sec);
      mv.focus();
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      // Shelves added in this session just go away; real ones are marked, and can be kept again.
      if (sec.classList.contains('pshelf-added')) {
        bar.querySelector(`[data-add-id="${CSS.escape(sec.dataset.shelfId)}"]`)?.closest('li')?.removeAttribute('hidden');
        sec.remove();
        return;
      }
      setOff(sec, !sec.classList.contains('pshelf-removed'));
    }
  });

  // Hidden (dimmed, "Show" brings it back) or shown ("Hide").
  function setOff(sec, off) {
    sec.classList.toggle('pshelf-removed', off);
    const rm = sec.querySelector(':scope > .pshelf-bar [data-remove]');
    if (!rm) return;
    rm.textContent = off ? 'Show' : 'Hide';
    rm.title = off ? 'Show it on this page' : 'Hide it on this page';
    rm.setAttribute('aria-label', `${off ? 'Show' : 'Hide'} ${sec.dataset.shelfTitle} on this page`);
  }

  tools.querySelector('.pshelf-start').addEventListener('click', start);

  // ───────── saving ─────────
  // "Show on" for a collection when it's put on (true) or taken off (false) this page. No value means Shelves page.
  const homeShow = (show, on) => (on
    ? ({ none: 'shelves', type: 'both' }[show] || show)
    : ({ both: 'type', type: 'type', none: 'none' }[show] || 'none'));
  const typeShow = (show, on) => (on
    ? ({ type: 'type', both: 'both', none: 'type' }[show] || 'both')
    : ({ both: 'shelves', type: 'none' }[show] || show));
  const showFor = home ? homeShow : typeShow;
  const blank = (name) => ({ name, description: '' });
  const starterOf = (id) => STARTER_SHELVES.find((s) => `starter:${s.key}` === id)?.collection;

  async function save(btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const all = sections();
      const kept = all.filter((s) => !s.classList.contains('pshelf-removed')).map((s) => s.dataset.shelfId);
      const removed = all.filter((s) => s.classList.contains('pshelf-removed')).map((s) => s.dataset.shelfId);
      const titles = Object.fromEntries(all.map((s) => [s.dataset.shelfId, s.dataset.shelfTitle]));
      const { collections } = await api('collections');
      const bySlug = new Map(collections.map((c) => [c.slug, c]));
      const isNew = (id) => id.startsWith('new:') || id.startsWith('starter:');
      const freshOf = (id) => ({ ...(starterOf(id) || blank(titles[id])), show: home ? 'shelves' : 'type' });
      let next;
      const turnedOn = [];
      if (home) {
        // The Shelves page shows collections in the collections' own order: kept shelves first, in the new order,
        // then everything else as it was.
        const placed = new Set();
        next = kept.map((id) => {
          if (isNew(id)) return freshOf(id);
          const c = bySlug.get(id.slice(2));
          if (!c) return null;
          placed.add(c.slug);
          return { ...c, show: showFor(c.show, true) };
        }).filter(Boolean);
        for (const c of collections) {
          if (placed.has(c.slug)) continue;
          next.push(removed.includes(`c:${c.slug}`) ? { ...c, show: showFor(c.show, false) } : c);
        }
      } else {
        // Removing a collection here only hides it on this page (below). Putting one here that wasn't on any
        // media page turns it on for media pages.
        next = collections.map((c) => {
          if (kept.includes(`c:${c.slug}`) && !showsOnType(c)) { turnedOn.push(c.slug); return { ...c, show: showFor(c.show, true) }; }
          return c;
        });
        for (const id of kept.filter(isNew)) next.push(freshOf(id));
      }
      const before = new Set(collections.map((c) => c.slug));
      const saved = (await api('collections', { method: 'POST', body: { collections: next } })).collections;
      if (!home) {
        // New collections got their slugs from the server: put them where they were dropped.
        const created = saved.filter((c) => !before.has(c.slug));
        let k = 0;
        const order = kept.map((id) => (isNew(id) ? `c:${created[k++]?.slug || ''}` : id)).filter((id) => id !== 'c:');
        const { layouts } = await api('layouts');
        const hidden = hiddenAfterEdit({ page, pages: TYPE_KEYS, kept, removed, layouts, turnedOn: [...turnedOn, ...created.map((c) => c.slug)] });
        await api('layouts', { method: 'POST', body: { page, order, hidden: hidden[page] } });
        for (const p of Object.keys(hidden)) {
          if (p !== page) await api('layouts', { method: 'POST', body: { page: p, order: layouts[p]?.order || [], hidden: hidden[p] } });
        }
      }
      btn.textContent = 'Saved';
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save shelves';
      showError(err.message);
    }
  }

  function showError(msg) {
    let p = bar.querySelector('.pshelf-error');
    if (!p) {
      p = document.createElement('p');
      p.className = 'pshelf-error';
      p.setAttribute('role', 'alert');
      bar.prepend(p);
    }
    p.textContent = msg;
  }
}
