// @mentions: tag a friend in your notes or in a comment. The text keeps a link-shaped token,
//   @[Name](https://their-site)
// which pages draw as a link to their MyShelf. Typing a plain @name works too: on save it's matched against
// your friends (nickname, name, or first name) and turned into the token. Each newly mentioned friend gets a
// 'mention' note in their inbox (their site has to be new enough to know mentions; older ones are skipped).

export const TOKEN = /@\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]{1,300})\)/g;
const PLAIN = /(^|[^\w@[\]/])@([A-Za-z0-9][\w.'-]{0,39})/g;

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };

/** Every site address mentioned with a token in text. */
export function mentionedUrls(text) {
  return [...new Set([...String(text || '').matchAll(TOKEN)].map((m) => origin(m[2])).filter(Boolean))];
}

/**
 * Turn plain @handles that match a friend into tokens. friends: [{ url, name, owner, nickname }] (accepted only).
 * A handle matches a friend's nickname, owner or site name with the spaces taken out ("@lexjudge"), or a
 * first name that only one friend has ("@lex"). Anything else is left as typed.
 */
export function resolveMentions(text, friends) {
  const handles = new Map();
  const firsts = new Map();
  for (const f of friends) {
    const label = f.nickname || f.owner || f.name || f.url.replace(/^https?:\/\//, '');
    for (const n of [f.nickname, f.owner, f.name]) if (n && norm(n)) handles.set(norm(n), { url: f.url, label });
    for (const n of [f.nickname, f.owner]) {
      const first = norm(String(n || '').split(/\s+/)[0]);
      if (!first) continue;
      firsts.set(first, firsts.has(first) && firsts.get(first).url !== f.url ? null : { url: f.url, label });
    }
  }
  return String(text || '').replace(PLAIN, (all, pre, handle) => {
    const h = norm(handle);
    const f = handles.get(h) || firsts.get(h);
    // Keep any trailing punctuation the handle grabbed ("@lex." at the end of a sentence).
    const tail = handle.match(/[.'-]+$/)?.[0] || '';
    return f ? `${pre}@[${f.label.replace(/[[\]]/g, '')}](${f.url})${tail}` : all;
  });
}

/** Text for an inbox preview: tokens become plain @Name. */
export function plainMentions(text) {
  return String(text || '').replace(TOKEN, (m, name) => `@${name}`);
}
