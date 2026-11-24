// Drawing @mentions (see server/federation/mentions.js for how they're stored: @[Name](https://their-site)).
// No dependencies, so pages, browser scripts and the server can all use it.

/** Notes rendered by Markdown: "@<a href=…>Name</a>" → one link that reads "@Name". */
export function mentionsHtml(html) {
  return String(html || '').replace(/@<a href="(https?:\/\/[^"]+)">([^<]{1,80})<\/a>/g,
    (m, href, name) => `<a class="mention" href="${href}" target="_blank" rel="noopener">@${name}</a>`);
}

/** Plain text that's already HTML-escaped (comments, friends' notes): tokens → "@Name" links. */
export function mentionsText(escaped) {
  return String(escaped || '').replace(/@\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]{1,300})\)/g,
    (m, name, href) => `<a class="mention" href="${href}" target="_blank" rel="noopener">@${name}</a>`);
}

/** Tokens → "@Name", for previews that are plain text. */
export function mentionsPlain(text) {
  return String(text || '').replace(/@\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]{1,300})\)/g, (m, name) => `@${name}`);
}
