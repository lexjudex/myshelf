// Display switches: Shelf effects (footer, and the Sort bar on shelf pages) and Light mode (footer, and Manage → Settings).
// Both are saved in this browser only (localStorage). The <head> script in Base.astro applies them before
// the page draws; this file keeps every switch on the page in step and flips things live.
const html = document.documentElement;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const PREFS = {
  effects: {
    on: () => store.get('myshelf_motion') !== 'off',
    set: (on) => {
      store.set('myshelf_motion', on ? null : 'off');
      html.classList.toggle('flat-shelves', !on);
      // Shelves set themselves up for one mode or the other when the page loads, so redraw a page that has them.
      if (document.querySelector('.shelf-3d')) setTimeout(() => location.reload(), 150);
    },
  },
  // "on" = light mode. Matching the site's own look clears the visitor's choice, so a later change by the owner shows.
  mode: {
    on: () => html.dataset.theme === 'light',
    set: (on) => {
      const mode = on ? 'light' : 'dark';
      store.set('myshelf_mode', mode === html.dataset.siteTheme ? null : mode);
      html.dataset.theme = mode;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#ece7de' : '#1e1f22');
      document.dispatchEvent(new CustomEvent('myshelf:theme', { detail: mode }));
    },
  },
};

function sync() {
  for (const [key, p] of Object.entries(PREFS)) {
    const on = p.on();
    document.querySelectorAll(`input[data-pref="${key}"]`).forEach((box) => (box.checked = on));
    document.querySelectorAll(`button[data-pref="${key}"]`).forEach((btn) => btn.setAttribute('aria-pressed', String(on)));
  }
  document.querySelectorAll('[data-pref-state="effects"]').forEach((el) => (el.textContent = PREFS.effects.on() ? 'on' : 'off'));
  // The menu button says what it switches to.
  document.querySelectorAll('[data-pref-label="mode"]').forEach((el) => (el.textContent = PREFS.mode.on() ? 'Dark mode' : 'Light mode'));
}

document.addEventListener('change', (e) => {
  const box = e.target.closest('input[data-pref]');
  if (!box || !PREFS[box.dataset.pref]) return;
  PREFS[box.dataset.pref].set(box.checked);
  sync();
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-pref]');
  if (!btn || !PREFS[btn.dataset.pref]) return;
  const p = PREFS[btn.dataset.pref];
  p.set(!p.on());
  sync();
});
sync();
