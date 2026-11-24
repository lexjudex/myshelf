// Small helpers shared by the API routes.

export const TYPE_KEYS = ['book', 'movie', 'tv', 'music', 'videogame', 'boardgame', 'video'];

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap a handler so thrown errors become JSON responses.
export function handler(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      console.error(err);
      return json({ error: err.message || 'Unexpected error' }, status);
    }
  };
}

export function userAgent(env) {
  return `MyShelf/0.1 ( ${env.CONTACT_EMAIL || 'personal media journal'} )`;
}

export async function fetchJson(url, init = {}, label = 'Request') {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(502, `${label} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function slugify(str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

export function yearOf(value) {
  if (value == null || value === '') return '';
  const m = String(value).match(/\d{4}/);
  return m ? m[0] : '';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(str) {
  if (!str) return '';
  let out = String(str);
  // BGG double-encodes (e.g. &amp;#10;), so decode twice.
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
  }
  return out;
}

export function stripHtml(str) {
  return decodeEntities(String(str || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(str, n = 1200) {
  const s = String(str || '').trim();
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
}


/** Cloudflare bindings + secrets for an Astro request (D1, KV, API keys). */
export function envOf(locals) {
  return locals?.runtime?.env || {};
}

/** Astro endpoint wrapper: fn({ request, env, url }) with thrown errors turned into JSON. */
export function route(fn) {
  const h = handler(fn);
  return (ctx) => h({ request: ctx.request, env: envOf(ctx.locals), url: ctx.url, params: ctx.params });
}
