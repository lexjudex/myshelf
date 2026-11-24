// Type @ in a comment box or in your notes (any textarea with data-mentions) and pick a friend:
// it inserts @[Name](their site), which shows as a link and tells them they were mentioned.
// Only works when signed in on this browser (it needs your friends list). Typing @name by hand still works:
// the server matches it to a friend when you save.

const token = () => { try { return localStorage.getItem('myshelf_token') || ''; } catch { return ''; } };
let friends = null; // [{ url, label, sub }]
let loading = null;

function loadFriends() {
  if (friends) return Promise.resolve(friends);
  if (!loading) {
    loading = fetch('/api/friends', { headers: { authorization: `Bearer ${token()}` } })
      .then((r) => (r.ok ? r.json() : { friends: [] }))
      .then((d) => (friends = (d.friends || []).filter((f) => f.status === 'accepted').map((f) => ({
        url: f.url,
        label: (f.nickname || f.owner || f.name || f.url.replace(/^https?:\/\//, '')).replace(/[[\]]/g, ''),
        sub: [f.nickname ? f.owner || f.name : f.owner && f.name ? f.name : '', f.url.replace(/^https?:\/\//, '')].filter(Boolean).join(' · '),
      }))))
      .catch(() => (friends = []));
  }
  return loading;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let menu, field, start, matches = [], active = 0;

function close() {
  menu?.remove();
  menu = null;
  field = null;
}

/** The "@partial" being typed just before the caret, or null. */
function partialAt(ta) {
  const upto = ta.value.slice(0, ta.selectionStart);
  const m = upto.match(/(^|[\s(])@([\w.'-]{0,30})$/);
  return m ? { at: upto.length - m[2].length - 1, q: m[2] } : null;
}

function draw() {
  if (!matches.length) return close();
  if (!menu) {
    menu = document.createElement('ul');
    menu.className = 'mention-menu';
    menu.setAttribute('role', 'listbox');
    // Inside an open <dialog> (the item editor), the menu has to live in the dialog to show above it.
    (field.closest('dialog[open]') || document.body).appendChild(menu);
    menu.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]');
      if (!li) return;
      e.preventDefault();
      choose(Number(li.dataset.i));
    });
  }
  menu.innerHTML = matches.map((f, i) => `<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}" aria-selected="${i === active}"><strong>@${esc(f.label)}</strong><span>${esc(f.sub)}</span></li>`).join('');
  const r = field.getBoundingClientRect();
  const host = menu.parentElement === document.body ? null : menu.parentElement.getBoundingClientRect();
  menu.style.left = `${r.left - (host?.left || 0) + (host ? 0 : window.scrollX)}px`;
  menu.style.top = `${r.bottom - (host?.top || 0) + (host ? menu.parentElement.scrollTop : window.scrollY) + 4}px`;
  menu.style.minWidth = `${Math.min(r.width, 320)}px`;
}

function choose(i) {
  const f = matches[i];
  if (!f || !field) return;
  const ta = field;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(ta.selectionStart);
  const insert = `@[${f.label}](${f.url}) `;
  ta.value = before + insert + after;
  const pos = before.length + insert.length;
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  close();
  ta.focus();
}

async function onInput(e) {
  const ta = e.target.closest?.('textarea[data-mentions]');
  if (!ta || !token()) return;
  const p = partialAt(ta);
  if (!p) return close();
  const list = await loadFriends();
  if (!list.length) return close();
  const q = norm(p.q);
  matches = list.filter((f) => !q || norm(f.label).includes(q) || norm(f.sub).includes(q)).slice(0, 6);
  field = ta;
  start = p.at;
  active = 0;
  draw();
}

export function enableMentionPicker() {
  if (document.documentElement.dataset.mentionPicker) return;
  document.documentElement.dataset.mentionPicker = '1';
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', (e) => {
    if (!menu || e.target !== field) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }, true);
  document.addEventListener('focusout', (e) => { if (e.target === field) setTimeout(close, 120); });
  window.addEventListener('resize', close);
}
