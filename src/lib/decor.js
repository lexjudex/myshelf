// How a shelf decoration is drawn: shared by the Shelves page and the preview in Manage → Settings.
// Markup: <span class="decor …" style="…"><span class="decor-face"><img></span></span>
//   .decor       sits on the shelf at x and leans flat by `tilt` (pivoting on the bottom corner it leans towards)
//   .decor-face  is angled on the shelf in 3D by `turn`, and carries the frame if there is one

const PERSPECTIVE = 700; // px; matches decor.css

/** CSS variables for one decoration. --shade darkens the side that turns away, more the further it turns. */
export function decorStyle(d) {
  const tilt = Number(d.tilt) || 0;
  const turn = Number(d.turn) || 0;
  const origin = tilt > 0 ? '100%' : tilt < 0 ? '0%' : '50%';
  return `--x:${Number(d.x ?? 50)}%;--h:${Number(d.height) || 110}px;--tilt:${tilt}deg;--origin:${origin};--turn:${turn}deg;--shade:${(Math.abs(turn) / 50 * 0.45).toFixed(3)}`;
}

export function decorClasses(d) {
  const framed = d.frame && d.frame !== 'none';
  const turn = Number(d.turn) || 0;
  return ['decor', d.flip && 'flip', framed && 'framed', framed && `frame-${d.frame}`, turn > 0 && 'turn-right', turn < 0 && 'turn-left'].filter(Boolean).join(' ');
}

/** The inside of one decoration (the face and its image). */
export function decorInner(d, esc = (s) => s) {
  return `<span class="decor-face"><img src="${esc(d.image)}" alt="" decoding="async"${Number(d.aspect) > 0 ? ` style="aspect-ratio:${Number(d.aspect)}"` : ''}></span>`;
}

/** The tallest decoration (px, before phone scaling): a turn makes the near edge look taller, a tilt lifts a corner. */
export function decorMax(list) {
  return Math.ceil(Math.max(0, ...list.map((d) => {
    const h0 = Number(d.height) || 110;
    const w = h0 * (Number(d.aspect) || 1);
    const z = (w / 2) * Math.sin((Math.abs(Number(d.turn) || 0) * Math.PI) / 180); // how far the near edge comes forward
    const h = h0 * (PERSPECTIVE / (PERSPECTIVE - z));
    const a = (Math.abs(Number(d.tilt) || 0) * Math.PI) / 180;
    return h * Math.cos(a) + w * Math.sin(a);
  })));
}

/**
 * In the browser: slide any decoration that would hang past the bookcase's edges back inside (on narrow screens a
 * big one near an edge can). Position 0 or 100 then means "flush with that edge".
 */
export function keepInside(container) {
  if (!container) return;
  const box = container.getBoundingClientRect();
  // Inside a scaled-down preview, screen pixels aren't layout pixels.
  const scale = container.offsetWidth ? box.width / container.offsetWidth : 1;
  container.querySelectorAll('.decor').forEach((el) => {
    el.style.setProperty('--nudge', '0px');
    const r = el.getBoundingClientRect();
    let nudge = 0;
    if (r.width >= box.width) nudge = box.left + box.width / 2 - (r.left + r.width / 2);
    else if (r.left < box.left) nudge = box.left - r.left;
    else if (r.right > box.right) nudge = box.right - r.right;
    if (nudge) el.style.setProperty('--nudge', `${Math.round(nudge / scale)}px`);
  });
}
