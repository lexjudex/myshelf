// How a shelf decoration is drawn: shared by the Shelves page and the preview in Manage → Settings.
// Markup: <span class="decor" style="…"><span class="decor-face"><img></span></span>
//   .decor       sits on the shelf at x and leans flat by `tilt` (pivoting on the bottom corner it leans towards)
//   .decor-face  is angled on the shelf in 3D by `turn`, and carries the frame if there is one
// Desktop and phone each get their own CSS variables (--x / --xm …); decor.css picks one set by screen width.

const PERSPECTIVE = 700; // px; matches decor.css
export const PHONE_SCALE = 0.68; // matches server/decor.js: phones follow desktop at this size until set on their own

/** The phone placement: its own if set, otherwise desktop's, smaller. */
export function phoneOf(d) {
  if (d.phone) return d.phone;
  return { x: Number(d.x ?? 50), y: Math.round((Number(d.y) || 0) * PHONE_SCALE), height: Math.round((Number(d.height) || 110) * PHONE_SCALE), tilt: Number(d.tilt) || 0, turn: Number(d.turn) || 0, hidden: false };
}

function vars(p, suffix) {
  const tilt = Number(p.tilt) || 0;
  const turn = Number(p.turn) || 0;
  return [
    [`--x${suffix}`, `${Number(p.x ?? 50)}%`],
    [`--y${suffix}`, `${Number(p.y) || 0}px`],
    [`--h${suffix}`, `${Number(p.height) || 110}px`],
    [`--tilt${suffix}`, `${tilt}deg`],
    [`--origin${suffix}`, tilt > 0 ? '100%' : tilt < 0 ? '0%' : '50%'], // a tilt pivots on the corner it leans towards
    [`--turn${suffix}`, `${turn}deg`],
    [`--shade${suffix}`, (Math.abs(turn) / 50 * 0.45).toFixed(3)], // the side turning away is darker…
    [`--shade-dir${suffix}`, turn < 0 ? 'to right' : 'to left'],  // …on whichever side that is
    [`--show${suffix}`, p.hidden ? 'none' : 'block'],
  ].map(([k, v]) => `${k}:${v}`).join(';');
}

/** CSS variables for one decoration, for desktop and for phones. */
export function decorStyle(d) {
  // --a (width ÷ height of the image) lets decor.css give it an exact width instead of leaving browsers to work it
  // out (Safari, which every iPhone browser uses, gets that wrong for images sized by height).
  const a = Number(d.aspect) > 0 ? `;--a:${Number(d.aspect)}` : '';
  return `${vars(d, '')};${vars(phoneOf(d), 'm')}${a}`;
}

export function decorClasses(d) {
  const framed = d.frame && d.frame !== 'none';
  return ['decor', Number(d.aspect) > 0 && 'sized', d.flip && 'flip', framed && 'framed', framed && `frame-${d.frame}`].filter(Boolean).join(' ');
}

/** The inside of one decoration (the face and its image). */
export function decorInner(d, esc = (s) => s) {
  return `<span class="decor-face"><img src="${esc(d.image)}" alt="" decoding="async"${Number(d.aspect) > 0 ? ` style="aspect-ratio:${Number(d.aspect)}"` : ''}></span>`;
}

function tallest(list) {
  return Math.ceil(Math.max(0, ...list.filter((p) => !p.hidden).map((p) => {
    const h0 = Number(p.height) || 110;
    const w = h0 * (Number(p.aspect) || 1);
    const z = (w / 2) * Math.sin((Math.abs(Number(p.turn) || 0) * Math.PI) / 180); // how far a turned one's near edge comes forward
    const h = h0 * (PERSPECTIVE / (PERSPECTIVE - z));
    const a = (Math.abs(Number(p.tilt) || 0) * Math.PI) / 180; // a tilt lifts a corner
    return h * Math.cos(a) + w * Math.sin(a) + Math.max(0, Number(p.y) || 0); // raised ones need the room too
  })));
}

/** The space to leave above the bookcase, for desktop and for phones (px). */
export function decorMax(list) {
  return { desktop: tallest(list), phone: tallest(list.map((d) => ({ ...phoneOf(d), aspect: d.aspect }))) };
}
export const decorMaxStyle = (list) => { const m = decorMax(list); return `--decor-max:${m.desktop}px;--decor-max-m:${m.phone}px`; };

/**
 * In the browser: slide any decoration that would hang past the bookcase's edges back inside. Position 0 or 100
 * then means "flush with that edge". Works inside a scaled-down preview too.
 */
export function keepInside(container) {
  if (!container) return;
  const box = container.getBoundingClientRect();
  const scale = container.offsetWidth ? box.width / container.offsetWidth : 1;
  container.querySelectorAll('.decor').forEach((el) => {
    el.style.setProperty('--nudge', '0px');
    const r = el.getBoundingClientRect();
    if (!r.width) return; // hidden on this screen size
    let nudge = 0;
    if (r.width >= box.width) nudge = box.left + box.width / 2 - (r.left + r.width / 2);
    else if (r.left < box.left) nudge = box.left - r.left;
    else if (r.right > box.right) nudge = box.right - r.right;
    if (nudge) el.style.setProperty('--nudge', `${Math.round(nudge / scale)}px`);
  });
}
