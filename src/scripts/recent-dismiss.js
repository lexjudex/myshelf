// ✕ on "Recently Finished" shelves (any automatic Finished collection with a time window), signed in only.
// It sits on the cover that's facing out. Pressing it moves the item's finished date to just past the shelf's
// window (a year and a day ago on the starter shelf), so it drops off. Undo puts the old date back.
const token = (() => { try { return localStorage.getItem('myshelf_token') || ''; } catch { return ''; } })();

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 ? 'Your sign-in has expired. Sign in again on the Manage page.' : data.error || `Request failed (${res.status})`);
  return data;
}

const slugOf = (slot) => (slot.querySelector('.book3d')?.getAttribute('href') || '').replace(/^\/item\//, '').replace(/\/$/, '');
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// ───────── a toast with an Undo button ─────────
let toastEl, toastTimer;
function toast(msg, { undo, kind = 'ok' } = {}) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'ar-toast rf-toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.dataset.kind = kind;
  toastEl.innerHTML = '';
  toastEl.append(document.createTextNode(msg));
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rf-undo';
    b.textContent = 'Undo';
    b.addEventListener('click', () => { toastEl.hidden = true; undo(); }, { once: true });
    toastEl.append(b);
  }
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), undo ? 8000 : 4500);
}

function setCount(shelf, delta) {
  const n = shelf.closest('.shelf-section')?.querySelector('.count-n');
  if (n) n.textContent = String(Math.max(0, Number(n.textContent) + delta));
}

// Put the ✕ in the top-right corner of the cover, wherever the box sits in its slot.
function place(slot) {
  const book = slot?.querySelector('.book3d');
  const box = book?.querySelector('.b3-box');
  const btn = slot?.querySelector('.rf-x');
  if (!box || !btn) return;
  // offsetTop/offsetWidth ignore the 3D turn, so this is where the cover ends up once it faces out.
  btn.style.top = `${book.offsetTop + box.offsetTop + 6}px`;
  btn.style.left = `${book.offsetLeft + Math.max(0, box.offsetWidth - 30)}px`;
}

function decorate(shelf, within) {
  shelf.querySelectorAll('.shelf-slot').forEach((slot) => {
    if (slot.querySelector('.rf-x')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rf-x';
    btn.title = 'Take off Recently Finished';
    btn.setAttribute('aria-label', `Take ${slot.querySelector('.book3d')?.getAttribute('title') || 'this'} off this shelf`);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(shelf, slot, within, btn); });
    slot.appendChild(btn);
    place(slot);
  });
  // Re-place when a different cover turns to face out, or the page is resized.
  new MutationObserver((muts) => muts.forEach((m) => {
    if (m.target.classList?.contains('is-front')) place(m.target.closest('.shelf-slot'));
  })).observe(shelf, { subtree: true, attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => shelf.querySelectorAll('.shelf-slot').forEach(place));
}

async function dismiss(shelf, slot, within, btn) {
  const slug = slugOf(slot);
  if (!slug) return;
  btn.disabled = true;
  try {
    const { item } = await api(`item?slug=${encodeURIComponent(slug)}`);
    const before = item.dateFinished || '';
    await api('item', { method: 'POST', body: { slug, dateFinished: daysAgo(within + 1) } });
    const next = slot.nextElementSibling;
    slot.remove();
    setCount(shelf, -1);
    shelf.dispatchEvent(new CustomEvent('shelf:reorder'));
    toast(`“${item.title}” is off ${shelf.dataset.rfName || 'Recently Finished'}.`, {
      undo: async () => {
        try {
          await api('item', { method: 'POST', body: { slug, dateFinished: before } });
          shelf.insertBefore(slot, next && next.parentNode === shelf ? next : shelf.querySelector(':scope > .shelf-more'));
          btn.disabled = false;
          setCount(shelf, 1);
          shelf.dispatchEvent(new CustomEvent('shelf:reorder'));
          place(slot);
        } catch (err) { toast(err.message, { kind: 'error' }); }
      },
    });
  } catch (err) {
    btn.disabled = false;
    toast(err.message, { kind: 'error' });
  }
}

if (token && document.querySelector('.shelf[data-collection]')) {
  api('collections').then(({ collections }) => {
    for (const c of collections || []) {
      if (c.auto !== 'finished' || !c.within) continue;
      document.querySelectorAll(`.shelf[data-collection="${CSS.escape(c.slug)}"]`).forEach((shelf) => {
        shelf.dataset.rfName = c.name;
        decorate(shelf, Number(c.within));
      });
    }
  }).catch(() => {}); // not signed in any more: no ✕
}
