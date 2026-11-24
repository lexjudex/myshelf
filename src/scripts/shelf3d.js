// One front-facing item per shelf.
// Mouse: hover turns an item. Keyboard: Tab turns it. Touch: tap a spine to turn it
// (tap again to open), or swipe sideways to flip through the shelf (up/down swipes just scroll the page).
const SWIPE_STEP = 26;      // px of finger travel per item while swiping
const SWIPE_LOCK = 6;       // px of finger travel before we decide which way the gesture goes
const SWIPE_RATIO = 0.85;   // sideways wins unless the finger is moving mostly up/down (up to ~50° off horizontal still counts)
const SCROLL_SETTLE = 80;   // ms: a touch this soon after the page scrolled is catching the scroll, not swiping

// Remember when the page last scrolled vertically, so a finger landing on a shelf mid-scroll
// (e.g. to stop the page's momentum on iPhone) is treated as part of that vertical scroll.
let lastPageScroll = 0;
window.addEventListener('scroll', () => (lastPageScroll = performance.now()), { passive: true });

// Slide a shelf sideways so this item is in view — horizontally only. (scrollIntoView could also
// nudge the page up or down, which felt like the page "fighting" a sideways swipe on phones.)
function revealX(b) {
  const box = b.closest('.shelf-track') || b.closest('.shelf-scroll');
  if (!box) return;
  const r = box.getBoundingClientRect();
  const a = b.getBoundingClientRect();
  const left = box.scrollLeft + (a.left + a.width / 2) - (r.left + r.width / 2);
  box.scrollTo({ left: Math.max(0, Math.min(box.scrollWidth - box.clientWidth, left)), behavior: 'smooth' });
}

// Shelf effects turned off (Manage → Settings): covers all face front and links just open, so none of
// the turning, swiping or row-locking below is needed. Shelves scroll and wrap like normal.
const FLAT = document.documentElement.classList.contains('flat-shelves');

// One front-facing item per ROW. A scrolling shelf is one row; a wrapping shelf (collection pages, "see all"
// pages) is split into row strips by lockRows() below, and each strip keeps its own front item, so moving down
// the page never flips back the item you turned on the row above.
function initShelf(shelf) {
  if (FLAT) return;
  if (!shelf.querySelector('.book3d')) return;
  const groupOf = (b) => b.closest('.shelf-track') || shelf;
  const visible = (b) => !b.closest('.shelf-slot')?.hidden;
  const groupBooks = (g) => [...g.querySelectorAll('.book3d')].filter(visible);
  const allBooks = () => [...shelf.querySelectorAll('.book3d')];

  // Every row has exactly one front item: keep the one it has (if it's still in that row), else its first item.
  const settle = () => {
    const groups = new Set(allBooks().filter(visible).map(groupOf));
    allBooks().forEach((b) => { if (!visible(b)) b.classList.remove('is-front'); });
    for (const g of groups) {
      const list = groupBooks(g);
      const fronts = list.filter((b) => b.classList.contains('is-front'));
      const keep = fronts[0] || list[0];
      list.forEach((b) => b.classList.toggle('is-front', b === keep));
    }
  };
  settle();
  shelf.addEventListener('shelf:rows', settle); // lockRows re-packed the rows

  const setActive = (b, { reveal = false } = {}) => {
    if (!b || b.classList.contains('is-front')) return;
    groupBooks(groupOf(b)).forEach((x) => x.classList.toggle('is-front', x === b));
    if (reveal) requestAnimationFrame(() => revealX(b)); // keep it in view once it has started widening
  };

  // Shelf was rearranged, sorted or filtered on the page: each row's first item faces front again.
  shelf.addEventListener('shelf:reorder', () => {
    allBooks().forEach((b) => b.classList.remove('is-front'));
    settle();
  });

  // ── Mouse: real movement only (layout shifts under a still cursor shouldn't turn things).
  let mouse = null;
  shelf.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || shelf.classList.contains('is-dragging')) return;
    mouse = { x: e.clientX, y: e.clientY };
    const b = e.target.closest?.('.book3d');
    if (b && shelf.contains(b)) setActive(b);
  }, { passive: true });
  shelf.addEventListener('pointerleave', () => (mouse = null));

  // Trackpad scrolling with the cursor over the shelf: the item under the cursor faces front.
  let raf = 0;
  shelf.addEventListener('scroll', () => {
    if (!mouse || shelf.classList.contains('is-dragging')) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const el = document.elementFromPoint(mouse.x, mouse.y)?.closest('.book3d');
      if (el && shelf.contains(el)) setActive(el);
    });
  }, { passive: true });

  // ── Keyboard: only keyboard focus turns an item. (A tap also focuses the link; reacting
  // to that turned the item before the tap was handled, so a single tap opened it.)
  shelf.addEventListener('focusin', (e) => {
    const b = e.target.closest?.('.book3d');
    if (b && b.matches(':focus-visible')) setActive(b, { reveal: true });
  });

  // ── Touch: swipe sideways to flip through the row you're touching.
  // Each touch is locked to ONE direction as soon as it has moved a little: up/down belongs to the
  // page (we stay out of it for the rest of that touch), sideways belongs to the shelf (and the page
  // is held still so it doesn't drift vertically). Touch events, not pointer events, because iPhone
  // Safari cancels pointer events as soon as it starts scrolling the page, which killed swipes.
  let start = null;        // { x, y, list, idx, dir: null | 'x' | 'y' }
  let suppressClick = false;

  shelf.addEventListener('touchstart', (e) => {
    suppressClick = false; // a new touch starts fresh
    if (e.touches.length !== 1) { start = null; return; } // pinch etc.: not ours
    const t = e.touches[0];
    const catchingScroll = performance.now() - lastPageScroll < SCROLL_SETTLE;
    const row = e.target.closest?.('.shelf-track') || shelf;
    const list = groupBooks(row);
    start = { x: t.clientX, y: t.clientY, list, idx: list.findIndex((b) => b.classList.contains('is-front')), dir: catchingScroll ? 'y' : null };
  }, { passive: true });
  shelf.addEventListener('touchmove', (e) => {
    if (!start || start.dir === 'y') return;
    if (e.touches.length !== 1) { start = null; return; }
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!start.dir) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_LOCK) return;
      start.dir = Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO ? 'x' : 'y';
      if (start.dir === 'y') return; // vertical: the page scrolls, the shelf ignores this touch
    }
    if (e.cancelable) e.preventDefault(); // sideways: keep the page from scrolling up/down underneath
    // Finger moving left = forward through the row, like flicking through records.
    const steps = Math.trunc(-dx / SWIPE_STEP);
    const idx = Math.max(0, Math.min(start.list.length - 1, Math.max(0, start.idx) + steps));
    setActive(start.list[idx], { reveal: true });
  }, { passive: false });
  const end = () => {
    if (start?.dir === 'x') {
      // Swallow the click some browsers fire at the end of a swipe — but only that one.
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 350);
    }
    start = null;
  };
  shelf.addEventListener('touchend', end);
  shelf.addEventListener('touchcancel', end);

  // ── Taps/clicks: a spine turns to face you first; the front-facing item opens.
  shelf.addEventListener('click', (e) => {
    const b = e.target.closest?.('.book3d');
    if (!b) return;
    if (suppressClick) { e.preventDefault(); suppressClick = false; return; }
    if (!b.classList.contains('is-front')) { e.preventDefault(); setActive(b, { reveal: true }); }
  });
}

document.querySelectorAll('.shelf-3d').forEach(initShelf);

// ── Mouse: click and drag a long shelf sideways to move through it (with effects on or off).
// A drag never opens or turns the item it started on; a plain click still does.
function dragToScroll(shelf) {
  let drag = null;
  let suppress = false;
  shelf.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, left: shelf.scrollLeft, moved: false };
    suppress = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 5) return; // tiny wobble during a click isn't a drag
      drag.moved = true;
      shelf.classList.add('is-dragging');
    }
    shelf.scrollLeft = drag.left - dx;
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved) {
      shelf.classList.remove('is-dragging');
      suppress = true; // swallow the click that follows the drag
    }
    drag = null;
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  shelf.addEventListener('click', (e) => {
    if (!suppress) return;
    suppress = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  // Stop the browser's own "drag this link/image" from hijacking the gesture.
  shelf.addEventListener('dragstart', (e) => e.preventDefault());
}
document.querySelectorAll('.shelf-scroll').forEach(dragToScroll);

// ── Fade covers out at the right edge while there's more shelf to scroll to.
function watchEdge(shelf) {
  const update = () => {
    const more = shelf.scrollWidth - shelf.clientWidth - shelf.scrollLeft > 4;
    shelf.classList.toggle('fade-right', more);
  };
  shelf.addEventListener('scroll', update, { passive: true });
  shelf.addEventListener('shelf:reorder', () => requestAnimationFrame(update));
  new ResizeObserver(update).observe(shelf);
  update();
}
document.querySelectorAll('.shelf-scroll').forEach(watchEdge);

// ── Wrapping shelves (collection pages, "see all" pages): fixed rows, each with its own front item.
// Turning an item to face front makes it wider, which used to re-wrap the shelf. Instead, rows are
// packed into fixed row strips, leaving room in each for one front-facing item. Each row slides on
// its own to keep its front item in view; the overflow fades out at the edges. Rows are only re-packed
// when the shelf's width changes or its items are filtered, sorted or reordered.
function lockRows(shelf) {
  let lastWidth = 0;
  const px = (el, v) => parseFloat(getComputedStyle(el).getPropertyValue(v)) || 0;

  const edges = (row) => {
    const max = row.scrollWidth - row.clientWidth;
    row.classList.toggle('fade-right', max - row.scrollLeft > 4);
    row.classList.toggle('fade-left', row.scrollLeft > 4);
  };
  // Keep the front-facing item fully visible; other rows go back to the start.
  const reveal = () => {
    for (const track of shelf.querySelectorAll(':scope > .shelf-row > .shelf-track')) {
      const front = track.querySelector('.book3d.is-front');
      let left = 0;
      if (front) {
        const slot = front.closest('.shelf-slot').getBoundingClientRect();
        const end = slot.right - track.getBoundingClientRect().left + track.scrollLeft + 8;
        left = Math.max(0, end - track.clientWidth);
      }
      if (Math.abs(track.scrollLeft - left) > 1) track.scrollTo({ left, behavior: 'smooth' });
      else edges(track);
    }
  };

  const layout = () => {
    const slots = [...shelf.querySelectorAll('.shelf-slot')];
    if (!slots.length) return;
    slots.forEach((sl) => shelf.appendChild(sl));
    shelf.querySelectorAll(':scope > .shelf-row, :scope > .shelf-break').forEach((r) => r.remove());
    const cs = getComputedStyle(shelf);
    const avail = shelf.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 0;
    // Each row = its own plank (.shelf-row, which also carries the scroll motion) holding a track of
    // items (.shelf-track, which clips, fades at the edges and slides sideways).
    let track = null, used = 0, widest = 0;
    for (const slot of slots) {
      const b = slot.querySelector('.book3d');
      const spine = slot.hidden ? 0 : px(b, '--d');
      const front = slot.hidden ? 0 : px(b, '--w');
      // Room for this row's one front item: the widest front face in the row, minus its own spine.
      const room = Math.max(widest, front) - Math.min(spine, front);
      const add = (used ? gap : 0) + spine;
      if (!track || (spine && used && used + add + room > avail)) {
        widest = 0;
        const row = document.createElement('div');
        row.className = 'shelf-row';
        const t = document.createElement('div');
        t.className = 'shelf-track';
        t.addEventListener('scroll', () => edges(t), { passive: true });
        row.appendChild(t);
        shelf.appendChild(row);
        track = t;
        used = 0;
      }
      track.appendChild(slot);
      if (spine) { used += (used ? gap : 0) + spine; widest = Math.max(widest, front); }
    }
    shelf.dispatchEvent(new CustomEvent('shelf:rows'));
    reveal();
  };

  lastWidth = shelf.clientWidth;
  layout(); // right away, so rows are set before the first paint
  new ResizeObserver(() => {
    if (shelf.clientWidth === lastWidth) return;
    lastWidth = shelf.clientWidth;
    layout();
  }).observe(shelf);
  shelf.addEventListener('shelf:reorder', () => requestAnimationFrame(layout));
  // When an item finishes turning front (its width transition), make sure it's in view.
  shelf.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width' && e.target.classList?.contains('book3d')) reveal();
  });
}
if (!FLAT) document.querySelectorAll('.shelf-3d:not(.shelf-scroll)').forEach(lockRows);
