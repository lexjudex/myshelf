// Pieces shared by Manage → Friends, the public Friends page and item pages: inbox rows, a friend's shelf,
// review text and comment threads. The markup functions are plain string builders with no DOM access, so
// Astro pages can also call them while rendering on the server.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const token = () => { try { return localStorage.getItem('myshelf_token') || ''; } catch { return ''; } };

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const host = (u) => String(u || '').replace(/^https?:\/\//, '');
const stars = (r) => (r == null || r === '' ? '' : '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : ''));

export const HEART = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';
export const heartBtn = (on, attrs) => `<button type="button" class="heart-btn${on ? ' on' : ''}" aria-pressed="${on}" title="${on ? 'You enjoyed this too (click to undo)' : 'I enjoyed this too'}" ${attrs}>${HEART}</button>`;
const BUBBLE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>';

export function thumb(TYPES, cover, title, type, h = 52) {
  const t = TYPES[type] || TYPES.book;
  const ph = `<span class="thumb-ph" style="width:${Math.round(h * t.aspect)}px;height:${h}px;background:${t.color}">${esc((title || '?').slice(0, 1))}</span>`;
  return cover ? `<img class="thumb" src="${esc(cover)}" alt="" style="height:${h}px" loading="lazy" referrerpolicy="no-referrer">` : ph;
}

/**
 * A friend's notes, written in Markdown on their site. Shown as text: everything is escaped first, then
 * only **bold**, *italics* and paragraphs are turned back on, so nothing from another site runs as HTML.
 */
export function reviewHtml(md) {
  const text = esc(String(md || '').trim());
  if (!text) return '';
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n/g, '<br>');
  return text.split(/\n{2,}/).map((p) => `<p>${inline(p)}</p>`).join('');
}

// ───────── comment threads ─────────
// A thread is either on a friend's item (data-friend + data-uid: comments go to their site) or on one of your
// own items (data-own-slug: comments are stored here). bindThreads() wires up both kinds.

export function commentHtml(c) {
  return `<li class="comment" data-id="${esc(c.id)}" data-author-url="${esc(c.authorUrl)}">
    <p class="c-meta"><a class="c-author" href="${esc(c.authorUrl)}" target="_blank" rel="noopener">${esc(c.author || host(c.authorUrl))}</a>
      <span class="c-when">${esc(fmt(c.createdAt))}</span>
      <button type="button" class="c-del" data-del-comment hidden>Delete</button></p>
    <p class="c-text">${esc(c.text)}</p>
  </li>`;
}

const countLabel = (n) => (n ? `${n} ${n === 1 ? 'comment' : 'comments'}` : 'Comment');

/** comments: [] or the list from a friend's feed. Pass null (an older site) to show no thread at all. */
export function threadHtml(comments, { friendUrl = '', uid = '', ownSlug = '', open = false } = {}) {
  if (!Array.isArray(comments)) return '';
  const n = comments.length;
  const where = ownSlug ? `data-own-slug="${esc(ownSlug)}"` : `data-friend="${esc(friendUrl)}" data-uid="${esc(uid)}"`;
  return `<div class="thread${n ? '' : ' empty'}" ${where}>
    <button type="button" class="thread-toggle" aria-expanded="${open}">${BUBBLE}<span class="thread-count">${countLabel(n)}</span></button>
    <div class="thread-body"${open ? '' : ' hidden'}>
      <ul class="comments">${comments.map(commentHtml).join('')}</ul>
      <form class="comment-form" hidden>
        <textarea name="text" rows="2" maxlength="1000" placeholder="Add a comment…" required></textarea>
        <button type="submit" class="btn primary small">Post</button>
      </form>
    </div>
  </div>`;
}

/**
 * Make threads under root work. Visitors can read; when signed in (me = your site address), the comment
 * boxes appear and you can delete your own comments (or, on your own items, anyone's).
 */
export function bindThreads(root, { me = '', toast = () => {} } = {}) {
  const signedIn = Boolean(me);
  const refresh = (thread) => {
    const n = thread.querySelectorAll('.comment').length;
    thread.querySelector('.thread-count').textContent = countLabel(n);
    thread.classList.toggle('empty', !n);
  };
  const decorate = (thread) => {
    thread.classList.toggle('can-comment', signedIn);
    thread.querySelector('.comment-form').hidden = !signedIn;
    const own = Boolean(thread.dataset.ownSlug);
    thread.querySelectorAll('.comment').forEach((c) => {
      c.querySelector('.c-del').hidden = !signedIn || !(own || c.dataset.authorUrl === me);
    });
  };
  root.querySelectorAll('.thread').forEach(decorate);
  if (root.dataset.threadsBound) return { decorate };
  root.dataset.threadsBound = '1';

  root.addEventListener('click', async (e) => {
    const toggle = e.target.closest('.thread-toggle');
    if (toggle) {
      const body = toggle.nextElementSibling;
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
      if (!body.hidden) body.querySelector('textarea:not([hidden])')?.focus({ preventScroll: true });
      return;
    }
    const del = e.target.closest('[data-del-comment]');
    if (!del || !del.closest('.thread')) return;
    const li = del.closest('.comment');
    const thread = del.closest('.thread');
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm');
      del.textContent = 'Sure?';
      setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Delete'; }, 4000);
      return;
    }
    del.disabled = true;
    try {
      const body = thread.dataset.ownSlug
        ? { action: 'delete-comment', id: li.dataset.id }
        : { action: 'uncomment', friendUrl: thread.dataset.friend, commentId: li.dataset.id };
      await api('friends', { method: 'POST', body });
      li.remove();
      refresh(thread);
    } catch (err) {
      del.disabled = false;
      toast(err.message, 'error');
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.comment-form');
    if (!form) return;
    e.preventDefault();
    const thread = form.closest('.thread');
    const btn = form.querySelector('button');
    const text = form.text.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const body = thread.dataset.ownSlug
        ? { action: 'comment-own', slug: thread.dataset.ownSlug, text }
        : { action: 'comment', friendUrl: thread.dataset.friend, uid: thread.dataset.uid, text };
      const { comment } = await api('friends', { method: 'POST', body });
      thread.querySelector('.comments').insertAdjacentHTML('beforeend', commentHtml(comment || { id: '', author: 'You', authorUrl: me, text, createdAt: new Date().toISOString() }));
      form.reset();
      decorate(thread);
      refresh(thread);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  return { decorate };
}

// ───────── inbox ─────────

/** Messages "Clear inbox" keeps: requests still waiting on your answer (mirrors clearInbox on the server). */
export const waiting = (m, friends) => ['unread', 'read'].includes(m.status) && (m.kind === 'borrow-request'
  || (m.kind === 'friend-request' && friends.find((f) => f.id === m.friendId)?.status === 'pending'));

export function inboxHtml(inbox, friends, TYPES) {
  if (!inbox.length) return '<li class="muted">Nothing yet. Friend requests, recommendations, borrow requests, hearts and comments show up here.</li>';
  const typeLabel = (t) => TYPES[t]?.label || t || '';
  return inbox.map((m) => {
    const who = `<strong>${esc(m.fromName)}</strong>`;
    const when = `<span class="muted small">${fmt(m.createdAt)}</span>`;
    const p = m.payload || {};
    const note = p.note ? `<p class="inbox-note">“${esc(p.note)}”</p>` : '';
    const open = ['unread', 'read'].includes(m.status);
    const done = { accepted: 'Accepted', declined: 'Declined' }[m.status];
    const yourItem = (it) => (it.visibility === 'public' && it.slug ? `<a href="/item/${esc(it.slug)}/" target="_blank">${esc(it.title)}</a>` : esc(it.title));
    let body = '', actions = '';
    if (m.kind === 'friend-request') {
      body = `${who} <span class="muted small">(${esc(m.from)})</span> wants to be friends.`;
      const f = friends.find((x) => x.id === m.friendId);
      if (open && f?.status === 'pending') actions = `
        <button class="btn primary small" data-friend-act="accept" data-id="${esc(f.id)}">Accept</button>
        <button class="btn ghost small" data-friend-act="decline" data-id="${esc(f.id)}">Decline</button>
        <button class="btn ghost small danger" data-friend-act="block" data-id="${esc(f.id)}" title="Ignore future requests from this site">Block</button>`;
    } else if (m.kind === 'friend-accept') {
      body = `${who} accepted your friend request.`;
    } else if (m.kind === 'recommend') {
      const it = p.item || {};
      const link = it.url || it.source?.url;
      body = `<span class="inbox-item">${thumb(TYPES, it.cover, it.title, it.type)}<span>${who} recommends
        <strong>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</strong>
        <span class="muted small">${esc(typeLabel(it.type))}${it.creator ? ` · ${esc(it.creator)}` : ''}${it.year ? ` · ${esc(it.year)}` : ''}</span></span></span>`;
      actions = p.alreadyHave
        ? `<a class="btn ghost small" href="/item/${esc(p.alreadyHave)}/" target="_blank">You have this</a>`
        : `<button class="btn ghost small" data-add-rec="${esc(m.id)}">Add it</button>`;
    } else if (m.kind === 'borrow-request') {
      body = `${who} asks to borrow <strong>${esc(p.item?.title)}</strong>.${p.lentTo ? ` <span class="muted small">(It’s marked as lent to ${esc(p.lentTo)}.)</span>` : ''}`;
      if (open) actions = `
        <button class="btn primary small" data-borrow="yes" data-id="${esc(m.id)}">Yes, lend it</button>
        <button class="btn ghost small" data-borrow="no" data-id="${esc(m.id)}">Not now</button>`;
    } else if (m.kind === 'heart') {
      const it = p.item || {};
      body = `<span class="inbox-item">${thumb(TYPES, it.cover, it.title, it.type)}<span><span class="heart-mark" aria-hidden="true">${HEART}</span> ${who} enjoyed
        <strong>${yourItem(it)}</strong> too.</span></span>`;
    } else if (m.kind === 'comment') {
      const it = p.item || {};
      body = `<span class="inbox-item">${thumb(TYPES, it.cover, it.title, it.type)}<span>${who} commented on <strong>${yourItem(it)}</strong></span></span>`;
      if (p.text) body += `<p class="inbox-note">“${esc(p.text)}”</p>`;
      actions = `${it.visibility === 'public' && it.slug ? `<a class="btn ghost small" href="/item/${esc(it.slug)}/#comments" target="_blank">Reply</a>` : ''}
        <button class="btn ghost small danger" data-inbox-del-comment="${esc(p.commentId || m.id)}" title="Remove this comment from your item">Delete comment</button>`;
    } else if (m.kind === 'borrow-reply') {
      body = `${who} ${p.answer === 'yes' ? 'said <strong>yes</strong> to' : 'can’t lend you'} <strong>${esc(p.title)}</strong>${p.answer === 'yes' ? '.' : ' right now.'}`;
    }
    return `<li class="inbox-row${m.status === 'unread' ? ' unread' : ''}">
      <div class="inbox-text">${body} ${when}${m.kind === 'comment' ? '' : note}</div>
      <div class="inbox-actions">${actions}${done ? `<span class="muted small">${done}</span>` : ''}</div>
    </li>`;
  }).join('');
}

/** Mark messages that need no answer as read once they've been seen. Returns how many are still unread. */
export function markSeen(inbox) {
  const seen = inbox.filter((m) => m.status === 'unread' && !['friend-request', 'borrow-request'].includes(m.kind));
  for (const m of seen) {
    api('friends', { method: 'POST', body: { action: 'mark', id: m.id, status: 'read' } }).catch(() => {});
    m.status = 'read';
  }
  return inbox.filter((m) => m.status === 'unread').length;
}

// ───────── a friend's shelf ─────────

/**
 * data: { friend, items } from /api/friends?shelf=<id> (signed in: includes friends-only items, hearts and
 * borrowing) or from /friends/shelf.json (visitors: public items only).
 */
export function shelfHtml({ friend, items }, TYPES, { me = '', filter = '' } = {}) {
  const signedIn = Boolean(me && friend.id);
  const q = filter.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.title} ${i.creator || ''}`.toLowerCase().includes(q)) : items;
  const byType = Object.keys(TYPES).map((t) => [t, shown.filter((i) => i.type === t)]).filter(([, l]) => l.length);
  if (!items.length) return '<p class="muted">Nothing to see yet.</p>';
  if (!shown.length) return '<p class="muted">Nothing matches.</p>';
  return byType.map(([t, list]) => `
    <h4>${esc(TYPES[t].plural)} <span class="muted small">${list.length}</span></h4>
    <ul class="lib-list">${list.map((i) => `
      <li class="lib-row" data-uid="${esc(i.uid)}">
        ${thumb(TYPES, i.cover, i.title, i.type)}
        <span class="lib-text">
          <strong>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}${i.youHave ? ' <span class="vis-badge">You have this</span>' : ''}${i.visibility === 'friends' ? ' <span class="vis-badge">Friends only</span>' : ''}</strong>
          <span class="muted small">${[esc(i.creator || ''), stars(i.rating)].filter(Boolean).join(' · ')}</span>
          ${i.review ? `<div class="review clamp">${reviewHtml(i.review)}</div>` : ''}
          ${threadHtml(i.comments, { friendUrl: friend.url, uid: i.uid })}
        </span>
        ${signedIn ? `<span class="lib-actions">
          ${heartBtn(i.hearted, `data-heart="${esc(i.uid)}" data-friend="${esc(friend.id)}" data-title="${esc(i.title)}"`)}
          ${i.available ? `<button class="btn ghost small" data-ask="${esc(i.uid)}" data-friend="${esc(friend.id)}" data-title="${esc(i.title)}">Ask to borrow</button>` : i.owned ? '<span class="muted small">Lent out</span>' : ''}
        </span>` : ''}
      </li>`).join('')}</ul>`).join('');
}

// ───────── buttons in the inbox and on a friend's shelf ─────────

/**
 * One click handler for inbox and shelf buttons under root.
 * reload(): refetch after something changed. onAddRec(item): "Add it" on a recommendation.
 */
export function bindFriendActions(root, { toast, reload, onAddRec, inbox = () => [] }) {
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-friend-act]');
    if (act) {
      const action = act.dataset.friendAct;
      if (action === 'remove' && !act.classList.contains('confirm')) {
        act.classList.add('confirm');
        const prev = act.textContent;
        act.textContent = 'Sure?';
        setTimeout(() => { act.classList.remove('confirm'); act.textContent = prev; }, 4000);
        return;
      }
      act.disabled = true;
      try {
        await api('friends', { method: 'POST', body: { action, id: act.dataset.id } });
        toast({ accept: 'You’re now friends.', decline: 'Request declined.', block: 'Blocked.', remove: 'Removed.' }[action]);
        await reload();
      } catch (err) {
        act.disabled = false;
        toast(err.message, 'error');
      }
      return;
    }

    const borrow = e.target.closest('[data-borrow]');
    if (borrow) {
      const yes = borrow.dataset.borrow === 'yes';
      const note = window.prompt(yes ? 'Add a note? (optional — e.g. when to pick it up)' : 'Add a note? (optional)', '');
      if (note === null) return;
      borrow.disabled = true;
      try {
        await api('friends', { method: 'POST', body: { action: 'reply', inboxId: borrow.dataset.id, answer: yes ? 'yes' : 'no', note } });
        toast(yes ? 'Sent. It’s marked as lent on your shelf.' : 'Sent.');
        if (yes) document.dispatchEvent(new CustomEvent('myshelf:library-changed'));
        await reload();
      } catch (err) {
        borrow.disabled = false;
        toast(err.message, 'error');
      }
      return;
    }

    const addRec = e.target.closest('[data-add-rec]');
    if (addRec) {
      const m = inbox().find((x) => x.id === addRec.dataset.addRec);
      return onAddRec(m?.payload?.item || {});
    }

    const delComment = e.target.closest('[data-inbox-del-comment]');
    if (delComment) {
      if (!delComment.classList.contains('confirm')) {
        delComment.classList.add('confirm');
        delComment.textContent = 'Delete it?';
        setTimeout(() => { delComment.classList.remove('confirm'); delComment.textContent = 'Delete comment'; }, 4000);
        return;
      }
      delComment.disabled = true;
      try {
        await api('friends', { method: 'POST', body: { action: 'delete-comment', id: delComment.dataset.inboxDelComment } });
        toast('Comment deleted.');
        await reload();
      } catch (err) {
        delComment.disabled = false;
        toast(err.message, 'error');
      }
      return;
    }

    const ask = e.target.closest('[data-ask]');
    if (ask) {
      const note = window.prompt(`Ask to borrow “${ask.dataset.title}”. Add a note? (optional)`, '');
      if (note === null) return;
      ask.disabled = true;
      try {
        await api('friends', { method: 'POST', body: { action: 'borrow', friendId: ask.dataset.friend, uid: ask.dataset.ask, title: ask.dataset.title, note } });
        ask.textContent = 'Asked';
        toast('Request sent.');
      } catch (err) {
        ask.disabled = false;
        toast(err.message, 'error');
      }
      return;
    }

    const h = e.target.closest('[data-heart]');
    if (h) {
      const on = !h.classList.contains('on');
      h.disabled = true;
      try {
        const fields = h.dataset.friend ? { friendId: h.dataset.friend } : { friendUrl: h.dataset.friendUrl };
        await api('friends', { method: 'POST', body: { action: 'heart', ...fields, uid: h.dataset.heart, title: h.dataset.title, on } });
        h.classList.toggle('on', on);
        h.classList.toggle('pop', on);
        h.setAttribute('aria-pressed', String(on));
        h.title = on ? 'You enjoyed this too (click to undo)' : 'I enjoyed this too';
        if (on) toast('Sent. They’ll see you enjoyed it too.');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        h.disabled = false;
      }
    }
  });
}
