// "Recommend to a friend": one dialog for Manage, item pages, shelves and friends' shelves.
//   openRecommend({ slug, title })                         one of your items
//   openRecommend({ fromFriendUrl | fromFriendId, uid, title })  pass along something from a friend's shelf
// Needs you signed in on this browser. Friends and groups come from /api/friends.

const token = () => { try { return localStorage.getItem('myshelf_token') || ''; } catch { return ''; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) throw new Error('Sign in on the Manage page first.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let dlg, current, people = null;

function say(msg, kind = 'ok') {
  let el = document.querySelector('.rec-toast');
  if (!el) {
    el = document.createElement('p');
    el.className = 'rec-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', kind === 'error');
  el.hidden = false;
  clearTimeout(say.t);
  say.t = setTimeout(() => (el.hidden = true), kind === 'error' ? 7000 : 4500);
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'rec-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="rec-form">
      <header class="rec-head"><h2 class="rec-title">Recommend</h2><button type="button" class="rec-x" data-rec-close aria-label="Close">✕</button></header>
      <p class="rec-via" hidden></p>
      <fieldset><legend>Send to</legend><div class="rec-groups" hidden></div><div class="rec-friends"></div></fieldset>
      <label class="rec-note">Note <span>(optional)</span><textarea name="note" rows="3" maxlength="1000" placeholder="Why they’ll love it"></textarea></label>
      <footer class="rec-foot"><button type="button" class="rec-btn ghost" data-rec-close>Cancel</button><button type="submit" class="rec-btn primary">Send</button></footer>
    </form>`;
  // Inside an open dialog (Manage's editor or the arrange dialog) it must sit in the top layer too: showModal() does that.
  document.body.appendChild(dlg);
  dlg.querySelectorAll('[data-rec-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.querySelector('.rec-groups').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rec-group]');
    if (!b) return;
    const g = people.groups.find((x) => x.id === b.dataset.recGroup);
    const boxes = [...dlg.querySelectorAll('.rec-friends input')].filter((cb) => g?.members.includes(cb.dataset.url));
    const allOn = boxes.length && boxes.every((cb) => cb.checked);
    boxes.forEach((cb) => (cb.checked = !allOn));
  });
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const friendIds = [...dlg.querySelectorAll('.rec-friends input:checked')].map((i) => i.value);
    if (!friendIds.length) return say('Pick at least one friend.', 'error');
    const btn = dlg.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const target = current.slug ? { slug: current.slug } : { fromFriendUrl: current.fromFriendUrl, fromFriendId: current.fromFriendId, uid: current.uid };
      const { results } = await api('friends', { method: 'POST', body: { action: 'recommend', ...target, friendIds, note: e.target.note.value } });
      const failed = results.filter((r) => !r.ok);
      dlg.close();
      say(failed.length ? `Sent, but ${failed.length} couldn’t be reached: ${failed[0].error}` : 'Recommendation sent.', failed.length ? 'error' : 'ok');
    } catch (err) {
      say(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/** Forget the cached friends list (after adding a friend, for instance). */
export function refreshRecommendFriends() { people = null; }

export async function openRecommend(target) {
  if (!token()) return say('Sign in on the Manage page to recommend things.', 'error');
  try {
    if (!people) {
      const data = await api('friends');
      people = { friends: (data.friends || []).filter((f) => f.status === 'accepted'), groups: data.groups || [] };
    }
  } catch (err) {
    return say(err.message, 'error');
  }
  const fromUrl = target.fromFriendUrl || people.friends.find((f) => f.id === target.fromFriendId)?.url || '';
  const friends = people.friends.filter((f) => f.url !== fromUrl); // not back to whoever it came from
  if (!friends.length) return say(fromUrl ? 'You have no other friends to pass this on to yet.' : 'Add a friend first (Manage → Friends).', 'error');
  if (!dlg) build();
  current = target;
  const name = (f) => f.nickname || f.owner || f.name || f.url.replace(/^https?:\/\//, '');
  dlg.querySelector('.rec-title').textContent = `Recommend “${target.title || 'this'}”`;
  const from = people.friends.find((f) => f.url === fromUrl);
  const via = dlg.querySelector('.rec-via');
  via.hidden = !from;
  via.textContent = from ? `From ${name(from)}’s shelf. They’ll be credited.` : '';
  dlg.querySelector('.rec-friends').innerHTML = friends.map((f) => `<label class="rec-check"><input type="checkbox" value="${esc(f.id)}" data-url="${esc(f.url)}" ${friends.length === 1 ? 'checked' : ''}/> ${esc(name(f))}</label>`).join('');
  const groups = people.groups.filter((g) => g.members.some((u) => friends.some((f) => f.url === u)));
  const gbox = dlg.querySelector('.rec-groups');
  gbox.hidden = !groups.length;
  gbox.innerHTML = groups.length ? `<span>Groups:</span> ${groups.map((g) => `<button type="button" class="rec-btn ghost small" data-rec-group="${esc(g.id)}">${esc(g.name)}</button>`).join(' ')}` : '';
  dlg.querySelector('textarea').value = '';
  dlg.showModal();
}

/** Buttons anywhere with data-rec-slug, or data-rec-uid + data-rec-friend(-id), open the dialog. */
export function bindRecommendButtons(root = document) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rec-slug], [data-rec-uid]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    openRecommend(b.dataset.recSlug
      ? { slug: b.dataset.recSlug, title: b.dataset.recTitle }
      : { uid: b.dataset.recUid, fromFriendUrl: b.dataset.recFriend, fromFriendId: b.dataset.recFriendId, title: b.dataset.recTitle });
  });
}
