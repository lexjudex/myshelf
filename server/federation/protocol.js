// The MyShelf friends protocol, version 1. Kept deliberately small so other apps could speak it too.
//
// Discovery:  GET <site>/.well-known/myshelf  →  { software, protocol, url, name, owner, publicKey, inbox, shelf }
// Messages:   POST <site>/federation/v1/inbox  with a JSON body { id, kind, ...fields }
// Shelf:      GET  <site>/federation/v1/shelf  → public items, plus friends-only ones if the request is signed by a friend
//
// Signed requests carry four headers:
//   MyShelf-From       the sender's origin (https://…)
//   MyShelf-To         the receiver's origin
//   MyShelf-Date       ISO time; must be within 5 minutes
//   MyShelf-Signature  base64url Ed25519 signature of signingString() below
import { HttpError } from '../util.js';
import { sha256hex, signText, verifyText } from './crypto.js';

export const PROTOCOL = 1;
export const SOFTWARE = 'myshelf';
export const WELL_KNOWN = '/.well-known/myshelf';
export const INBOX_PATH = '/federation/v1/inbox';
export const SHELF_PATH = '/federation/v1/shelf';
export const MAX_BODY = 32 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;

// recommend: { item: { title, type, creator, year, cover, url, extKey, source }, note, via?: { name, url } } — via: passed
//   along from that friend's shelf.
// heart: { item: { uid }, on: true|false } — "I enjoyed this too" on one of the receiver's items (on: false takes it back).
// comment: { item: { uid }, text } — a comment on one of the receiver's items; the message id becomes the comment's id.
// comment-delete: { commentId } — take back a comment you wrote.
// comment-reply: { item: { uid, title, type, cover, url }, commentId, author, authorUrl, text } — sent by the item's
//   owner to everyone else who has commented on it, when someone adds to the thread.
// mention: { where: 'notes' | 'comment', text, item: { uid, title, type, cover, url }, owner?: { name, url } } — the
//   sender tagged you (@[Name](your site)) in their notes on an item, or in a comment; owner is whose item the comment is on.
export const KINDS = ['friend-request', 'friend-accept', 'friend-remove', 'recommend', 'borrow-request', 'borrow-reply', 'heart', 'comment', 'comment-delete', 'comment-reply', 'mention'];

export async function signingString({ method, path, to, from, date, body }) {
  return ['myshelf-1', method.toUpperCase(), path, to, from, date, await sha256hex(body || '')].join('\n');
}

/** A site address must be a bare https origin (http is allowed for localhost while developing). */
export function cleanSiteUrl(value) {
  let u;
  try {
    const raw = String(value || '').trim();
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new HttpError(400, 'That isn’t a valid site address.');
  }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new HttpError(400, 'Site addresses must start with https://');
  if (u.username || u.password) throw new HttpError(400, 'That isn’t a valid site address.');
  return u.origin;
}

export async function signedHeaders(identity, { method, url, from, body = '' }) {
  const u = new URL(url);
  const date = new Date().toISOString();
  const to = u.origin;
  const signature = await signText(identity, await signingString({ method, path: u.pathname + u.search, to, from, date, body }));
  return { 'myshelf-from': from, 'myshelf-to': to, 'myshelf-date': date, 'myshelf-signature': signature };
}

/**
 * Check a signed request. selfOrigins: the addresses this site answers to.
 * getKey(from) → the sender's public key, or null. Returns { from } or throws HttpError.
 */
export async function verifyRequest(request, body, selfOrigins, getKey) {
  const h = (n) => request.headers.get(n) || '';
  const from = h('myshelf-from');
  const to = h('myshelf-to');
  const date = h('myshelf-date');
  const signature = h('myshelf-signature');
  if (!from || !to || !date || !signature) throw new HttpError(401, 'Missing signature');
  if (cleanSiteUrl(from) !== from) throw new HttpError(401, 'Bad sender');
  if (!selfOrigins.includes(to)) throw new HttpError(401, 'This message is for another site');
  const when = Date.parse(date);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > MAX_SKEW_MS) throw new HttpError(401, 'Message is too old or from the future');
  const key = await getKey(from);
  if (!key) throw new HttpError(403, 'Unknown sender');
  const url = new URL(request.url);
  const text = await signingString({ method: request.method, path: url.pathname + url.search, to, from, date, body });
  if (!(await verifyText(key, text, signature))) throw new HttpError(401, 'Bad signature');
  return { from };
}
