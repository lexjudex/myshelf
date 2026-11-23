// How a shelf decoration is drawn: shared by the Shelves page and the preview in Manage → Settings.

/** CSS variables for one decoration: where its middle sits (x, % of the bookcase width), height, tilt. */
export function decorStyle(d) {
  const tilt = Number(d.tilt) || 0;
  // Tilted things pivot on the bottom corner they lean towards, so that corner stays on the shelf.
  const origin = tilt > 0 ? '100%' : tilt < 0 ? '0%' : '50%';
  return `--x:${Number(d.x ?? 50)}%;--h:${Number(d.height) || 110}px;--tilt:${tilt}deg;--origin:${origin}`;
}

export function decorClasses(d) {
  const framed = d.frame && d.frame !== 'none';
  return ['decor', d.flip && 'flip', framed && 'framed', framed && `frame-${d.frame}`].filter(Boolean).join(' ');
}

/** The tallest decoration, counting how much a tilt lifts its top corner (px, before phone scaling). */
export function decorMax(list) {
  return Math.ceil(Math.max(0, ...list.map((d) => {
    const h = Number(d.height) || 110;
    const w = h * (Number(d.aspect) || 1);
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
  container.querySelectorAll('.decor').forEach((el) => {
    el.style.setProperty('--nudge', '0px');
    const r = el.getBoundingClientRect();
    let nudge = 0;
    if (r.width >= box.width) nudge = box.left + box.width / 2 - (r.left + r.width / 2);
    else if (r.left < box.left) nudge = box.left - r.left;
    else if (r.right > box.right) nudge = box.right - r.right;
    if (nudge) el.style.setProperty('--nudge', `${Math.round(nudge)}px`);
  });
}
