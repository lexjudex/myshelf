// Draws the 1200×630 link-preview card on a canvas (in the browser: Manage draws your site's card with it, and the
// generic public/og-default.png was made with it too). The look follows the site: the bookcase's dark (or light)
// background, your accent colour, your site name and name, and your latest covers standing on a glossy shelf.
export const CARD_W = 1200;
export const CARD_H = 630;

const FONT = '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
// Spines for the generic card (and to fill out a shelf with few covers).
const SPINES = ['#8a3b2e', '#2e4a6b', '#4b3b6b', '#3d6b4f', '#7a5a2e', '#5e2f45', '#2f5e5a', '#6b4b2e'];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shrink text until it fits maxW (down to min px). Returns the size used. */
function fitText(ctx, text, weight, size, min, maxW) {
  for (let s = size; s >= min; s -= 2) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  ctx.font = `${weight} ${min}px ${FONT}`;
  return min;
}

/** One line, cut with "…" if it's still too wide. */
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * opts: { title, owner, tagline, accent, mode: 'dark' | 'light', covers: [HTMLImageElement], host }
 * Covers are drawn as loaded images (same-origin, so the canvas can still be exported).
 */
export function drawShareCard(ctx, opts = {}) {
  const W = CARD_W, H = CARD_H;
  const dark = opts.mode !== 'light';
  const accent = /^#[0-9a-f]{6}$/i.test(opts.accent || '') ? opts.accent : '#d99a4e';
  const ink = dark ? '#f4ede1' : '#2a2219';
  const soft = dark ? 'rgba(244,237,225,0.72)' : 'rgba(42,34,25,0.72)';

  // Background: the page colour with a soft glow of the accent in the corner.
  ctx.fillStyle = dark ? '#1e1f22' : '#ece7de';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.92, H * 0.05, 10, W * 0.92, H * 0.05, W * 0.75);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Text block (top left).
  const left = 72, maxW = W - left * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  const headline = opts.owner ? `${opts.owner}'s shelf` : (opts.title || 'MyShelf');
  // Small line above: the site's name, unless that's already the headline.
  const eyebrow = headline === (opts.title || 'MyShelf') ? 'A virtual bookshelf' : (opts.title || 'MyShelf');
  ctx.font = `800 24px ${FONT}`;
  try { ctx.letterSpacing = '3px'; } catch {}
  ctx.fillText(eyebrow.toUpperCase(), left, 104);
  try { ctx.letterSpacing = '0px'; } catch {}
  ctx.fillStyle = ink;
  const hs = fitText(ctx, headline, 800, 76, 44, maxW);
  ctx.fillText(clip(ctx, headline, maxW), left, 104 + hs + 14);

  const tagline = opts.tagline || 'Books, movies, shows, music and games.';
  ctx.fillStyle = soft;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(clip(ctx, tagline, maxW), left, 104 + hs + 14 + 52);

  // The shelf: a glossy black-wood plank across the bottom with covers standing on it.
  const plankY = H - 70, plankH = 26;
  const bookH = 230, gap = 14;
  let x = left;
  const covers = (opts.covers || []).filter((im) => im && im.naturalWidth > 0);
  // Covers first, then plain spines to fill out the rest of the shelf.
  const items = [
    ...covers.map((im) => ({ im, w: Math.round(bookH * Math.min(1.25, Math.max(0.6, im.naturalWidth / im.naturalHeight))) })),
    ...Array.from({ length: 30 }, (_, i) => ({ color: SPINES[i % SPINES.length], w: [46, 58, 40, 64, 50, 44, 60, 52, 38][i % 9] })),
  ];
  ctx.save();
  for (const it of items) {
    if (x + it.w > W - left) break;
    const h = it.im ? bookH : bookH - (it.w % 3) * 14;
    const y = plankY - h;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, x, y, it.w, h, 4);
    ctx.fillStyle = it.color || '#333';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (it.im) {
      ctx.save();
      roundRect(ctx, x, y, it.w, h, 4);
      ctx.clip();
      ctx.drawImage(it.im, x, y, it.w, h);
      ctx.restore();
    } else {
      // a couple of bands on the generic spines
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y + 24, it.w, 6);
      ctx.fillRect(x, y + h - 38, it.w, 6);
    }
    // a soft highlight down the left edge, like the shelf's gloss
    const hl = ctx.createLinearGradient(x, 0, x + it.w, 0);
    hl.addColorStop(0, 'rgba(255,255,255,0.16)');
    hl.addColorStop(0.25, 'rgba(255,255,255,0)');
    hl.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = hl;
    roundRect(ctx, x, y, it.w, h, 4);
    ctx.fill();
    x += it.w + gap;
  }
  ctx.restore();

  const plank = ctx.createLinearGradient(0, plankY, 0, plankY + plankH);
  plank.addColorStop(0, '#3a3530');
  plank.addColorStop(0.15, '#24211e');
  plank.addColorStop(1, '#0d0c0b');
  ctx.fillStyle = plank;
  ctx.fillRect(0, plankY, W, plankH);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, plankY, W, 2);
  ctx.fillStyle = dark ? '#141517' : '#d8d0c3';
  ctx.fillRect(0, plankY + plankH, W, H - plankY - plankH);

  // The site's address, bottom right, small.
  if (opts.host) {
    ctx.fillStyle = dark ? 'rgba(244,237,225,0.55)' : 'rgba(42,34,25,0.55)';
    ctx.font = `600 20px ${FONT}`;
    const t = clip(ctx, opts.host, W / 2);
    ctx.fillText(t, W - left - ctx.measureText(t).width, H - 16);
  }
  // Accent bar along the very top.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 8);
}
