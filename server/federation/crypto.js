// Every MyShelf site has its own Ed25519 key pair, made the first time it's needed and kept in D1.
// Messages between sites are signed with it, so a friend's site can tell a message really came from you.
import { getSetting, setSetting } from '../db.js';

const ALG = { name: 'Ed25519' };
const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** { publicKey: "<base64url>", privateJwk } — created once and stored in the settings table. */
export async function getIdentity(env) {
  const have = await getSetting(env, 'identity');
  if (have?.publicKey && have?.privateJwk) return have;
  // Made in this request (never a promise shared with other requests, which Cloudflare drops when the request
  // that started it ends). If two first requests race, check again just before saving so one identity wins.
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const again = await getSetting(env, 'identity');
  if (again?.publicKey && again?.privateJwk) return again;
  await setSetting(env, 'identity', { publicKey: privateJwk.x, privateJwk, createdAt: new Date().toISOString() });
  return getSetting(env, 'identity');
}

export async function signText(identity, text) {
  const key = await crypto.subtle.importKey('jwk', identity.privateJwk, ALG, false, ['sign']);
  return b64url(await crypto.subtle.sign(ALG, key, enc.encode(text)));
}

export async function verifyText(publicKey, text, signature) {
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: publicKey }, ALG, false, ['verify']);
    return await crypto.subtle.verify(ALG, key, fromB64url(signature), enc.encode(text));
  } catch {
    return false;
  }
}
