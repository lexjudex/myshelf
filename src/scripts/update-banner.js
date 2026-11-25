// The banner at the top of Manage: a newer MyShelf is out (with what's new in it), and any announcements from the
// MyShelf project (announcements.json in the original repository). Plus "your version" notes in Settings → Updates.
// Everything shown here comes from GitHub, so it's escaped; changelog entries are rendered as simple Markdown.
import { marked } from 'marked';
import { api, esc } from './friends-ui.js';

const $ = (s, root = document) => root.querySelector(s);
const box = $('#update-banner');
const DISMISSED = 'myshelf_dismissed';
const dismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISSED) || '[]'); } catch { return []; } };
const dismiss = (key) => { try { localStorage.setItem(DISMISSED, JSON.stringify([...new Set([...dismissed(), key])].slice(-50))); } catch {} };
// No HTML from the changelog: escape it, then let marked do headings, lists, bold and links.
const md = (text) => marked.parse(esc(text).replace(/&gt;/g, '>'), { async: false });

const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function render(r) {
  const off = dismissed();
  const rows = [];
  if (r.behind && !off.includes(`v:${r.latest}`)) {
    const changes = (r.changes || []).slice(0, 10).map((e) => `<section class="ub-entry"><h4>${esc(e.title)}</h4>${md(e.body)}</section>`).join('');
    rows.push(`<div class="ub-row ub-update" data-key="v:${esc(r.latest)}">
      <p class="ub-text"><strong>MyShelf ${esc(r.latest)} is out.</strong> You have ${esc(r.current)}.</p>
      <span class="ub-actions">
        ${changes ? '<button type="button" class="btn ghost small" data-ub-news aria-expanded="false">What’s new</button>' : `<a class="btn ghost small" href="${esc(r.changelogUrl)}" target="_blank" rel="noopener">What’s new</a>`}
        <a class="btn primary small" href="#updates" data-ub-update>Update</a>
        <button type="button" class="ub-x" data-ub-dismiss aria-label="Hide until the next version" title="Hide until the next version">${X}</button>
      </span>
      ${changes ? `<div class="ub-news" hidden>${changes}<p class="muted small"><a href="${esc(r.changelogUrl)}" target="_blank" rel="noopener">Full changelog</a></p></div>` : ''}
    </div>`);
  }
  for (const a of r.announcements || []) {
    if (off.includes(`a:${a.id}`)) continue;
    rows.push(`<div class="ub-row ub-note" data-key="a:${esc(a.id)}">
      <p class="ub-text"><span class="ub-tag">From MyShelf</span> ${esc(a.message)}${a.link ? ` <a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.linkText || 'Read more')}</a>` : ''}</p>
      <span class="ub-actions"><button type="button" class="ub-x" data-ub-dismiss aria-label="Dismiss" title="Dismiss">${X}</button></span>
    </div>`);
  }
  box.innerHTML = rows.join('');
  box.hidden = !rows.length;
}

// Settings → Updates: what's in the version you're on, and a link to the whole changelog.
function renderYours(r) {
  const el = $('#your-version-notes');
  if (!el) return;
  el.innerHTML = `${r.yours ? `<details class="ub-yours"><summary>What’s in your version (${esc(r.yours.title)})</summary>${md(r.yours.body)}</details>` : ''}
    <p class="muted small"><a href="${esc(r.changelogUrl)}" target="_blank" rel="noopener">Full changelog</a> — every version and what changed.</p>`;
}

let last = null;
async function load() {
  try {
    last = await api('latest');
    render(last);
    renderYours(last);
  } catch {} // can't check right now: no banner
}

box?.addEventListener('click', (e) => {
  const row = e.target.closest('.ub-row');
  if (!row) return;
  if (e.target.closest('[data-ub-dismiss]')) {
    dismiss(row.dataset.key);
    row.remove();
    box.hidden = !box.querySelector('.ub-row');
  } else if (e.target.closest('[data-ub-update]')) {
    e.preventDefault(); // open Settings → Updates even if the address already ends in #updates
    history.replaceState(null, '', '#updates');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (e.target.closest('[data-ub-news]')) {
    const btn = e.target.closest('[data-ub-news]');
    const news = row.querySelector('.ub-news');
    news.hidden = !news.hidden;
    btn.setAttribute('aria-expanded', String(!news.hidden));
  }
});

document.addEventListener('myshelf:ready', load);
