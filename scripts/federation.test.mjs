// Offline tests for schema upgrades, visibility, backup/restore and the friends protocol (run: npm test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv } from './fake-cloudflare.mjs';
import { ensureSchema, getItem, listItems, SCHEMA_VERSION } from '../server/db.js';
import { saveItem } from '../server/save.js';
import { getItems, getEntry } from '../src/lib/items.js';
import { exportBackup, restoreBackup, restoreCovers } from '../server/backup.js';
import { saveSite } from '../server/site.js';
import { HttpError } from '../server/util.js';
import * as fed from '../server/federation/index.js';
import { getIdentity } from '../server/federation/crypto.js';
import { signedHeaders, INBOX_PATH } from '../server/federation/protocol.js';

test('a database from before migrations upgrades itself and keeps its items', async () => {
  const env = fakeEnv();
  const t = '2026-01-01T00:00:00Z';
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE items (slug TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    env.DB.prepare(`INSERT INTO items VALUES ('boardgame-wingspan-2019', 'boardgame', 'Wingspan', ?, 'Great.', ?, ?)`).bind(
      JSON.stringify({ title: 'Wingspan', type: 'boardgame', status: 'finished', source: { name: 'BoardGameGeek', id: '266192' } }), t, t),
    env.DB.prepare(`INSERT INTO items VALUES ('book-x', 'book', 'X', ?, '', ?, ?)`).bind(JSON.stringify({ title: 'X', type: 'book', status: 'want' }), t, t),
  ]);
  await ensureSchema(env);
  const v = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first();
  assert.equal(Number(v.value), SCHEMA_VERSION);
  const rows = (await env.DB.prepare('SELECT slug, uid, ext_key, visibility FROM items ORDER BY slug').all()).results;
  assert.equal(rows[0].ext_key, 'boardgame:bgg:266192');
  assert.equal(rows[1].ext_key, null);
  assert.ok(rows.every((r) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.uid)));
  assert.ok(rows.every((r) => r.visibility === 'public'));
  assert.equal((await getItem(env, 'boardgame-wingspan-2019')).body, 'Great.');
  // Running again changes nothing.
  await ensureSchema(fakeEnvWith(env));
});
const fakeEnvWith = (env) => ({ ...env });

test('uid survives edits; friends-only and private items stay off the public pages', async () => {
  const env = fakeEnv();
  const { slug } = await saveItem(env, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: '' });
  const uid = (await getItem(env, slug)).uid;
  await saveItem(env, { slug, item: { title: 'Dune', type: 'book', status: 'finished', visibility: 'friends', owned: true, lentTo: 'Sam' }, body: 'notes' });
  const row = await getItem(env, slug);
  assert.equal(row.uid, uid);
  assert.equal(row.item.visibility, 'friends');
  assert.equal(row.item.owned, true);
  assert.equal(row.item.lentTo, 'Sam');
  await saveItem(env, { item: { title: 'Diary', type: 'book', status: 'finished', visibility: 'private' }, body: '' });
  await saveItem(env, { item: { title: 'Public', type: 'book', status: 'finished', visibility: 'nonsense' }, body: '' });
  assert.deepEqual((await getItems(env)).map((e) => e.data.title), ['Public']);
  assert.equal((await getItems(env, { all: true })).length, 3);
  assert.equal(await getEntry(env, slug), null);
  assert.equal((await listItems(env, { visibility: ['public', 'friends'] })).length, 2);
});

test('backup → restore on a new site keeps uids and copies covers from the old address', async () => {
  const oldSite = fakeEnv();
  await saveSite(oldSite, { title: 'Lex’s Shelf', owner: 'Lex' });
  await oldSite.COVERS.put('book-dune-abc.jpg', new Uint8Array([1, 2, 3]), { metadata: { type: 'image/jpeg' } });
  await saveItem(oldSite, { item: { title: 'Dune', type: 'book', status: 'finished', cover: '/img/book-dune-abc.jpg' }, body: 'Spice.' });
  await saveItem(oldSite, { item: { title: 'Old', type: 'book', status: 'finished', cover: '/covers/old.png' }, body: '' });
  const backup = JSON.parse(JSON.stringify(await exportBackup(oldSite, 'https://old.example')));
  assert.equal(backup.origin, 'https://old.example');
  assert.equal(backup.site.owner, 'Lex');

  const fresh = fakeEnv();
  assert.deepEqual(await restoreBackup(fresh, backup), { items: 2 });
  const dune = (await listItems(fresh)).find((r) => r.item.title === 'Dune');
  assert.equal(dune.uid, backup.items.find((r) => r.item.title === 'Dune').uid);
  assert.equal(dune.body, 'Spice.');

  const fetched = [];
  const fetcher = async (url) => {
    fetched.push(url);
    return new Response(new Uint8Array([9, 9]), { headers: { 'content-type': url.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
  };
  let r = await restoreCovers(fresh, { origin: 'https://old.example', offset: 0, limit: 1 }, fetcher);
  assert.equal(r.total, 2);
  assert.equal(r.done, false);
  r = await restoreCovers(fresh, { origin: 'https://old.example', offset: r.next, limit: 1 }, fetcher);
  assert.equal(r.done, true);
  assert.deepEqual(fetched.sort(), ['https://old.example/covers/old.png', 'https://old.example/img/book-dune-abc.jpg']);
  const old = (await listItems(fresh)).find((x) => x.item.title === 'Old');
  assert.equal(old.item.cover, '/img/old.png'); // moved into KV
  assert.ok(fresh.COVERS._store.has('old.png'));
  await assert.rejects(restoreCovers(fresh, { origin: 'ftp://nope', offset: 0 }, fetcher), /https/);
});

// ───────── two sites talking to each other ─────────
function network(sites) {
  const asResponse = async (fn) => {
    try {
      return Response.json(await fn(), { status: 200 });
    } catch (err) {
      return Response.json({ error: err.message }, { status: err instanceof HttpError ? err.status : 500 });
    }
  };
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    const env = sites[u.origin];
    if (!env) throw new TypeError('fetch failed');
    const request = new Request(u, init);
    if (u.pathname === '/.well-known/myshelf') return asResponse(() => fed.wellKnown(env, u.href));
    if (u.pathname === INBOX_PATH) return asResponse(() => fed.receive(env, request, fetcher));
    if (u.pathname === '/federation/v1/shelf') return asResponse(() => fed.shelfFeed(env, request));
    return new Response('not found', { status: 404 });
  };
  return fetcher;
}

test('friends: request, accept, friends-only shelf, borrow, recommend', async () => {
  const A = 'https://alex.example', B = 'https://bea.example';
  const alex = fakeEnv(), bea = fakeEnv();
  await saveSite(alex, { title: 'Alex Shelf', owner: 'Alex' });
  await saveSite(bea, { title: 'Bea Shelf', owner: 'Bea' });
  const net = network({ [A]: alex, [B]: bea });
  const gw = { title: 'Wingspan', type: 'boardgame', status: 'finished', source: { name: 'BoardGameGeek', id: '266192' } };
  await saveItem(bea, { item: { ...gw, visibility: 'friends', owned: true }, body: '' });
  await saveItem(bea, { item: { title: 'Diary', type: 'book', status: 'finished', visibility: 'private' }, body: '' });
  await saveItem(bea, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: '' });
  await saveItem(alex, { item: gw, body: '' });

  // Strangers only see public items.
  const pub = await (await net(`${B}/federation/v1/shelf`)).json();
  assert.deepEqual(pub.items.map((i) => i.title), ['Dune']);
  assert.equal(pub.items[0].owned, undefined);

  // Alex asks; Bea sees a pending request and accepts.
  const added = await fed.addFriend(alex, `${A}/api/friends`, B, 'hi!', net);
  assert.equal(added.status, 'requested');
  assert.equal(added.friend.publicKey, undefined);
  let bv = await fed.overview(bea, `${B}/api/friends`);
  assert.equal(bv.friends[0].status, 'pending');
  assert.equal(bv.inbox[0].kind, 'friend-request');
  assert.equal(bv.inbox[0].payload.note, 'hi!');
  await fed.acceptFriend(bea, `${B}/api/friends`, bv.friends[0].id, net);
  const av = await fed.overview(alex, `${A}/api/friends`);
  assert.equal(av.friends[0].status, 'accepted');
  assert.equal(av.inbox[0].kind, 'friend-accept');

  // Alex sees Bea's friends-only game, notices he has it too, and asks to borrow it.
  const shelf = await fed.friendShelf(alex, `${A}/api/friends`, av.friends[0].id, net);
  const wing = shelf.items.find((i) => i.title === 'Wingspan');
  assert.ok(wing && wing.available && wing.youHave);
  assert.ok(!shelf.items.some((i) => i.title === 'Diary'));
  await fed.askToBorrow(alex, `${A}/api/friends`, { friendId: av.friends[0].id, uid: wing.uid, title: 'Wingspan', note: 'game night?' }, net);
  bv = await fed.overview(bea, `${B}/api/friends`);
  const ask = bv.inbox.find((m) => m.kind === 'borrow-request');
  assert.equal(ask.payload.item.title, 'Wingspan');
  await fed.replyToBorrow(bea, `${B}/api/friends`, { inboxId: ask.id, answer: 'yes', note: 'sure' }, net);
  assert.equal((await getItem(bea, 'boardgame-wingspan')).item.lentTo, 'Alex');
  const reply = (await fed.overview(alex, `${A}/api/friends`)).inbox.find((m) => m.kind === 'borrow-reply');
  assert.equal(reply.payload.answer, 'yes');
  const after = await fed.friendShelf(alex, `${A}/api/friends`, av.friends[0].id, net);
  assert.equal(after.items.find((i) => i.title === 'Wingspan').available, false);

  // Bea recommends Dune; Alex's inbox has it with the shared key.
  const { results } = await fed.recommend(bea, `${B}/api/friends`, { slug: 'book-dune', friendIds: [bv.friends[0].id], note: 'read it' }, net);
  assert.deepEqual(results.map((r) => r.ok), [true]);
  const rec = (await fed.overview(alex, `${A}/api/friends`)).inbox.find((m) => m.kind === 'recommend');
  assert.equal(rec.payload.item.title, 'Dune');
  assert.equal(rec.payload.item.url, `${B}/item/book-dune/`);

  // Recommending something Alex already has is flagged.
  await fed.recommend(bea, `${B}/api/friends`, { slug: 'boardgame-wingspan', friendIds: [bv.friends[0].id] }, net);
  const rec2 = (await fed.overview(alex, `${A}/api/friends`)).inbox.find((m) => m.kind === 'recommend' && m.payload.item.title === 'Wingspan');
  assert.equal(rec2.payload.alreadyHave, 'boardgame-wingspan');

  // Alex's private nickname for Bea: used in his inbox and nickname list, never on public pages or sent to Bea.
  await fed.setNickname(alex, av.friends[0].id, '  Bea from  book club ');
  const nv = await fed.overview(alex, `${A}/api/friends`);
  assert.equal(nv.friends[0].nickname, 'Bea from book club');
  assert.equal(nv.inbox.find((m) => m.kind === 'recommend').fromName, 'Bea from book club');
  assert.deepEqual(await fed.nicknames(alex), { [B]: 'Bea from book club' });
  assert.equal((await fed.publicFriends(alex))[0].nickname, undefined);
  assert.equal((await fed.overview(bea, `${B}/api/friends`)).friends[0].nickname, '');
  await fed.setNickname(alex, av.friends[0].id, '');
  assert.deepEqual(await fed.nicknames(alex), {});

  // Removing ends it on both sides.
  await fed.removeFriend(alex, `${A}/api/friends`, av.friends[0].id, net);
  assert.equal((await fed.overview(bea, `${B}/api/friends`)).friends.length, 0);
});

test('friends: hearts — enjoy a friend’s item, once per item, and take it back', async () => {
  const A = 'https://alex.example', B = 'https://bea.example';
  const alex = fakeEnv(), bea = fakeEnv();
  await saveSite(alex, { title: 'Alex Shelf', owner: 'Alex' });
  await saveSite(bea, { title: 'Bea Shelf', owner: 'Bea' });
  const net = network({ [A]: alex, [B]: bea });
  await saveItem(bea, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: '' });
  await saveItem(bea, { item: { title: 'Diary', type: 'book', status: 'finished', visibility: 'private' }, body: '' });
  const duneUid = (await getItem(bea, 'book-dune')).uid;
  const diaryUid = (await getItem(bea, 'book-diary')).uid;

  // Not friends yet: refused.
  await fed.addFriend(alex, `${A}/api/friends`, B, '', net);
  const bid = (await fed.overview(alex, `${A}/api/friends`)).friends[0].id;
  await assert.rejects(fed.heart(alex, `${A}/api/friends`, { friendId: bid, uid: duneUid }, net), /aren’t friends/);
  await fed.acceptFriend(bea, `${B}/api/friends`, (await fed.overview(bea, `${B}/api/friends`)).friends[0].id, net);

  // Alex hearts Dune (twice — Bea gets one note), by id and then by site address.
  await fed.heart(alex, `${A}/api/friends`, { friendId: bid, uid: duneUid, title: 'Dune' }, net);
  await fed.heart(alex, `${A}/api/friends`, { friendUrl: B, uid: duneUid, title: 'Dune' }, net);
  let hearts = (await fed.overview(bea, `${B}/api/friends`)).inbox.filter((m) => m.kind === 'heart');
  assert.equal(hearts.length, 1);
  assert.equal(hearts[0].fromName, 'Alex');
  assert.equal(hearts[0].payload.item.title, 'Dune');
  assert.equal(hearts[0].payload.item.slug, 'book-dune');
  assert.deepEqual(await fed.heartsSent(alex), [{ friendUrl: B, uid: duneUid }]);
  assert.equal((await fed.friendShelf(alex, `${A}/api/friends`, bid, net)).items.find((i) => i.title === 'Dune').hearted, true);

  // Private items and made-up uids can't be hearted, and nothing is recorded.
  await assert.rejects(fed.heart(alex, `${A}/api/friends`, { friendId: bid, uid: diaryUid }, net), /isn’t on this shelf/);
  await assert.rejects(fed.heart(alex, `${A}/api/friends`, { friendId: bid, uid: crypto.randomUUID() }, net), /isn’t on this shelf/);
  assert.equal((await fed.heartsSent(alex)).length, 1);

  // Taking it back removes the unread note and the filled heart.
  await fed.heart(alex, `${A}/api/friends`, { friendId: bid, uid: duneUid, on: false }, net);
  hearts = (await fed.overview(bea, `${B}/api/friends`)).inbox.filter((m) => m.kind === 'heart');
  assert.equal(hearts.length, 0);
  assert.deepEqual(await fed.heartsSent(alex), []);
  assert.equal((await fed.friendShelf(alex, `${A}/api/friends`, bid, net)).items.find((i) => i.title === 'Dune').hearted, false);

  // Hearting again after taking it back sends a fresh note.
  await fed.heart(alex, `${A}/api/friends`, { friendId: bid, uid: duneUid }, net);
  assert.equal((await fed.overview(bea, `${B}/api/friends`)).inbox.filter((m) => m.kind === 'heart').length, 1);

  // Unfriending clears hearts on both sides.
  await fed.removeFriend(alex, `${A}/api/friends`, bid, net);
  assert.deepEqual(await fed.heartsSent(alex), []);
  assert.equal((await bea.DB.prepare('SELECT COUNT(*) AS n FROM hearts_received').first()).n, 0);
});

test('friends: hearting a friend on an older MyShelf explains why it didn’t go through', async () => {
  const A = 'https://a.example', B = 'https://b.example';
  const a = fakeEnv(), b = fakeEnv();
  await saveSite(b, { title: 'B', owner: 'Bo' });
  const net = network({ [A]: a, [B]: b });
  await fed.addFriend(a, `${A}/api/friends`, B, '', net);
  await fed.acceptFriend(b, `${B}/api/friends`, (await fed.overview(b, `${B}/api/friends`)).friends[0].id, net);
  // Pretend B's site predates hearts.
  const old = async (url, init) => {
    if (new URL(url).pathname === INBOX_PATH && init?.body && JSON.parse(init.body).kind === 'heart') {
      return Response.json({ error: 'Unknown message' }, { status: 400 });
    }
    return net(url, init);
  };
  const id = (await fed.overview(a, `${A}/api/friends`)).friends[0].id;
  await assert.rejects(fed.heart(a, `${A}/api/friends`, { friendId: id, uid: crypto.randomUUID() }, old), /Bo’s MyShelf needs an update/);
  assert.deepEqual(await fed.heartsSent(a), []);
});

test('friends: adding each other at the same time connects right away', async () => {
  const A = 'https://a.example', B = 'https://b.example';
  const a = fakeEnv(), b = fakeEnv();
  const net = network({ [A]: a, [B]: b });
  await fed.addFriend(a, `${A}/api/friends`, B, '', net);
  const res = await fed.addFriend(b, `${B}/api/friends`, A, '', net); // B already has a pending request from A
  assert.equal(res.status, 'accepted');
  assert.equal((await fed.overview(a, `${A}/api/friends`)).friends[0].status, 'accepted');
});

test('friends: forged, replayed, stranger and self messages are refused', async () => {
  const A = 'https://a.example', B = 'https://b.example', M = 'https://mallory.example';
  const a = fakeEnv(), b = fakeEnv(), m = fakeEnv();
  const net = network({ [A]: a, [B]: b, [M]: m });
  await fed.addFriend(a, `${A}/api/friends`, B, '', net);
  await fed.acceptFriend(b, `${B}/api/friends`, (await fed.overview(b, `${B}/api/friends`)).friends[0].id, net);

  const post = async (env, from, to, msg, signer = env) => {
    const body = JSON.stringify(msg);
    const url = to + INBOX_PATH;
    const headers = await signedHeaders(await getIdentity(signer), { method: 'POST', url, from, body });
    return net(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  };
  const rec = (title) => ({ id: crypto.randomUUID(), kind: 'recommend', item: { title } });

  // Mallory isn't a friend of B.
  assert.equal((await post(m, M, B, rec('spam'))).status, 403);
  // Mallory pretends to be A, signing with her own key.
  assert.equal((await post(a, A, B, rec('forged'), m)).status, 401);
  // Unsigned.
  const raw = await net(B + INBOX_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec('x')) });
  assert.equal(raw.status, 401);
  // A genuine message delivered twice is stored once.
  const msg = rec('Dune');
  assert.equal((await post(a, A, B, msg)).status, 200);
  assert.equal((await post(a, A, B, msg)).status, 200);
  assert.equal((await fed.overview(b, `${B}/api/friends`)).inbox.filter((x) => x.kind === 'recommend').length, 1);
  // A message addressed to another site.
  const body = JSON.stringify(rec('wrong'));
  const headers = await signedHeaders(await getIdentity(a), { method: 'POST', url: M + INBOX_PATH, from: A, body });
  assert.equal((await net(B + INBOX_PATH, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })).status, 401);
  // Can't befriend yourself, and bad addresses are refused.
  await assert.rejects(fed.addFriend(a, `${A}/api/friends`, A, '', net), /own site/);
  await assert.rejects(fed.addFriend(a, `${A}/api/friends`, 'http://evil.example', '', net), /https/);
  await assert.rejects(fed.addFriend(a, `${A}/api/friends`, 'https://nobody.example', '', net), /Couldn’t reach/);
  // Borrowing something that isn't owned is refused.
  const notOwned = await post(a, A, B, { id: crypto.randomUUID(), kind: 'borrow-request', item: { uid: crypto.randomUUID() } });
  assert.equal(notOwned.status, 404);
});

test('turning off a media type hides it from public pages and the public feed, but keeps the entries', async () => {
  const env = fakeEnv();
  await saveItem(env, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: '' });
  await saveItem(env, { item: { title: 'Heat', type: 'movie', status: 'finished' }, body: '' });
  await saveSite(env, { title: 'S', types: ['movie'] });
  assert.deepEqual((await getItems(env)).map((e) => e.data.title), ['Heat']);
  assert.equal((await getItems(env, { all: true })).length, 2);
  assert.equal(await getEntry(env, 'book-dune'), null);
  const feed = await fed.shelfFeed(env, new Request('https://s.example/federation/v1/shelf'));
  assert.deepEqual(feed.items.map((i) => i.title), ['Heat']);
  // Saving other settings without a types list keeps the choice; at least one type must stay on.
  await saveSite(env, { title: 'S2' });
  assert.deepEqual((await getItems(env)).map((e) => e.data.title), ['Heat']);
  await assert.rejects(saveSite(env, { title: 'S', types: [] }), /at least one/);
});

test('friends: comments — a public thread on a friend’s item, with replies and moderation', async () => {
  const A = 'https://alex.example', B = 'https://bea.example', C = 'https://cy.example';
  const alex = fakeEnv(), bea = fakeEnv(), cy = fakeEnv();
  await saveSite(alex, { title: 'Alex Shelf', owner: 'Alex' });
  await saveSite(bea, { title: 'Bea Shelf', owner: 'Bea' });
  await saveSite(cy, { title: 'Cy Shelf', owner: 'Cy' });
  const net = network({ [A]: alex, [B]: bea, [C]: cy });
  await saveItem(bea, { item: { title: 'Dune', type: 'book', status: 'finished', rating: 5 }, body: '**Loved it.** The spice must flow.' });
  await saveItem(bea, { item: { title: 'Diary', type: 'book', status: 'finished', visibility: 'private' }, body: 'secret' });
  const duneUid = (await getItem(bea, 'book-dune')).uid;
  const diaryUid = (await getItem(bea, 'book-diary')).uid;

  // Strangers can't comment.
  await assert.rejects(fed.commentOnFriend(cy, `${C}/api/friends`, { friendUrl: B, uid: duneUid, text: 'hi' }, net), /Friend not found/);

  for (const [env, at] of [[alex, A], [cy, C]]) {
    await fed.addFriend(env, `${at}/api/friends`, B, '', net);
    const pending = (await fed.overview(bea, `${B}/api/friends`)).friends.find((f) => f.url === at);
    await fed.acceptFriend(bea, `${B}/api/friends`, pending.id, net);
  }

  // The public feed carries the review text and an (empty) comment list.
  let pub = await (await net(`${B}/federation/v1/shelf`)).json();
  assert.equal(pub.items[0].review, '**Loved it.** The spice must flow.');
  assert.deepEqual(pub.items[0].comments, []);

  // Alex comments; Bea gets an inbox note; everyone sees it in the feed.
  const { comment } = await fed.commentOnFriend(alex, `${A}/api/friends`, { friendUrl: B, uid: duneUid, text: '  Agreed!  ' }, net);
  assert.equal(comment.text, 'Agreed!');
  assert.equal(comment.authorUrl, A);
  const note = (await fed.overview(bea, `${B}/api/friends`)).inbox.find((m) => m.kind === 'comment');
  assert.equal(note.payload.text, 'Agreed!');
  assert.equal(note.payload.item.slug, 'book-dune');
  await fed.commentOnFriend(cy, `${C}/api/friends`, { friendUrl: B, uid: duneUid, text: 'Need to read this' }, net);
  await fed.commentOwn(bea, `${B}/api/friends`, { slug: 'book-dune', text: 'Do it, Cy' });
  pub = await (await net(`${B}/federation/v1/shelf`)).json();
  assert.deepEqual(pub.items[0].comments.map((c) => [c.author, c.text]), [['Alex', 'Agreed!'], ['Cy', 'Need to read this'], ['Bea', 'Do it, Cy']]);
  assert.equal(pub.items[0].comments[2].authorUrl, B);
  assert.equal((await fed.itemComments(bea, `${B}/item/book-dune/`, 'book-dune')).length, 3);

  // Private items, empty comments and made-up uids are refused.
  await assert.rejects(fed.commentOnFriend(alex, `${A}/api/friends`, { friendUrl: B, uid: diaryUid, text: 'x' }, net), /Write|isn’t on this shelf/);
  await assert.rejects(fed.commentOnFriend(alex, `${A}/api/friends`, { friendUrl: B, uid: duneUid, text: '   ' }, net), /Write something/);

  // Cy can't delete Alex's comment; Alex can delete his own (and its unread note goes too).
  await fed.deleteFriendComment(cy, `${C}/api/friends`, { friendUrl: B, commentId: comment.id }, net);
  assert.equal((await fed.itemComments(bea, B, 'book-dune')).length, 3);
  await fed.deleteFriendComment(alex, `${A}/api/friends`, { friendUrl: B, commentId: comment.id }, net);
  assert.deepEqual((await fed.itemComments(bea, B, 'book-dune')).map((c) => c.author), ['Cy', 'Bea']);
  assert.ok(!(await fed.overview(bea, `${B}/api/friends`)).inbox.some((m) => m.id === comment.id));

  // Bea can delete anything on her items.
  const cys = (await fed.itemComments(bea, B, 'book-dune'))[0];
  await fed.deleteComment(bea, cys.id);
  assert.deepEqual((await fed.itemComments(bea, B, 'book-dune')).map((c) => c.author), ['Bea']);
});

test('friends: a friend on an older MyShelf explains why a comment didn’t go through', async () => {
  const A = 'https://a.example', B = 'https://b.example';
  const a = fakeEnv(), b = fakeEnv();
  await saveSite(b, { title: 'B', owner: 'Bo' });
  const net = network({ [A]: a, [B]: b });
  await fed.addFriend(a, `${A}/api/friends`, B, '', net);
  await fed.acceptFriend(b, `${B}/api/friends`, (await fed.overview(b, `${B}/api/friends`)).friends[0].id, net);
  const old = async (url, init) => (new URL(url).pathname === INBOX_PATH && JSON.parse(init.body).kind === 'comment'
    ? Response.json({ error: 'Unknown message' }, { status: 400 }) : net(url, init));
  await assert.rejects(fed.commentOnFriend(a, `${A}/api/friends`, { friendUrl: B, uid: crypto.randomUUID(), text: 'hi' }, old), /Bo’s MyShelf needs an update before it can get comments/);
});

test('friends: groups are private labels limited to current friends', async () => {
  const A = 'https://a.example', B = 'https://b.example', C = 'https://c.example';
  const a = fakeEnv(), b = fakeEnv(), c = fakeEnv();
  const net = network({ [A]: a, [B]: b, [C]: c });
  for (const [env, at] of [[b, B], [c, C]]) {
    await fed.addFriend(a, `${A}/api/friends`, at, '', net);
    await fed.acceptFriend(env, `${at}/api/friends`, (await fed.overview(env, `${at}/api/friends`)).friends[0].id, net);
  }
  await assert.rejects(fed.saveGroups(a, [{ name: '  ', members: [] }]), /needs a name/);
  const { groups } = await fed.saveGroups(a, [{ name: 'Game night', members: [B, C, 'https://stranger.example', 'not a url'] }, { name: 'Book club', members: [C] }]);
  assert.deepEqual(groups.map((g) => [g.name, g.members]), [['Game night', [B, C]], ['Book club', [C]]]);
  assert.equal((await fed.overview(a, `${A}/api/friends`)).groups.length, 2);
  // Removing a friend drops them from groups.
  const cid = (await fed.overview(a, `${A}/api/friends`)).friends.find((f) => f.url === C).id;
  await fed.removeFriend(a, `${A}/api/friends`, cid, net);
  assert.deepEqual((await fed.getGroups(a)).map((g) => g.members), [[B], []]);
});

test('public friend shelf only answers for accepted friends', async () => {
  const A = 'https://a.example', B = 'https://b.example';
  const a = fakeEnv(), b = fakeEnv();
  const net = network({ [A]: a, [B]: b });
  await saveItem(b, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: '' });
  await saveItem(b, { item: { title: 'Secret', type: 'book', status: 'finished', visibility: 'friends' }, body: '' });
  await assert.rejects(fed.publicFriendShelf(a, B, net), /Friend not found/);
  await fed.addFriend(a, `${A}/api/friends`, B, '', net);
  await fed.acceptFriend(b, `${B}/api/friends`, (await fed.overview(b, `${B}/api/friends`)).friends[0].id, net);
  const { items } = await fed.publicFriendShelf(a, B, net);
  assert.deepEqual(items.map((i) => i.title), ['Dune']);
});

test('friends: everyone in a comment thread hears about new comments', async () => {
  const A = 'https://alex.example', B = 'https://bea.example', C = 'https://cy.example';
  const alex = fakeEnv(), bea = fakeEnv(), cy = fakeEnv();
  await saveSite(alex, { title: 'Alex Shelf', owner: 'Alex' });
  await saveSite(bea, { title: 'Bea Shelf', owner: 'Bea' });
  await saveSite(cy, { title: 'Cy Shelf', owner: 'Cy' });
  const net = network({ [A]: alex, [B]: bea, [C]: cy });
  await saveItem(bea, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: 'Great.' });
  const uid = (await getItem(bea, 'book-dune')).uid;
  for (const [env, at] of [[alex, A], [cy, C]]) {
    await fed.addFriend(env, `${at}/api/friends`, B, '', net);
    const pending = (await fed.overview(bea, `${B}/api/friends`)).friends.find((f) => f.url === at);
    await fed.acceptFriend(bea, `${B}/api/friends`, pending.id, net);
  }
  const replies = async (env, at) => (await fed.overview(env, `${at}/api/friends`)).inbox.filter((m) => m.kind === 'comment-reply');

  // First comment: nobody else in the thread yet.
  await fed.commentOnFriend(alex, `${A}/api/friends`, { friendUrl: B, uid, text: 'So good' }, net);
  assert.equal((await replies(alex, A)).length, 0);
  // Cy joins: Alex hears about it, Cy doesn't hear about himself.
  await fed.commentOnFriend(cy, `${C}/api/friends`, { friendUrl: B, uid, text: 'Agreed' }, net);
  let a = await replies(alex, A);
  assert.equal(a.length, 1);
  assert.equal(a[0].payload.author, 'Cy');
  assert.equal(a[0].payload.text, 'Agreed');
  assert.equal(a[0].payload.item.url, `${B}/item/book-dune/#comments`);
  assert.equal(a[0].fromName, 'Bea');
  assert.equal((await replies(cy, C)).length, 0);
  // Bea replies on her own item: both hear about it.
  await fed.commentOwn(bea, `${B}/api/friends`, { slug: 'book-dune', text: 'Thanks both' }, net);
  a = await replies(alex, A);
  assert.equal(a.length, 2);
  assert.ok(a.some((m) => m.payload.author === 'Bea' && m.payload.text === 'Thanks both'));
  assert.equal((await replies(cy, C)).length, 1);
});

test('inbox: delete one message, mark read and unread, mark all read', async () => {
  const A = 'https://a.example', B = 'https://b.example';
  const a = fakeEnv(), b = fakeEnv();
  const net = network({ [A]: a, [B]: b });
  await saveItem(b, { item: { title: 'Dune', type: 'book', status: 'finished' }, body: '' });
  await fed.addFriend(a, `${A}/api/friends`, B, '', net);
  const fid = (await fed.overview(b, `${B}/api/friends`)).friends[0].id;
  await fed.acceptFriend(b, `${B}/api/friends`, fid, net);
  await fed.recommend(b, `${B}/api/friends`, { slug: 'book-dune', friendIds: [fid] }, net);
  let inbox = (await fed.overview(a, `${A}/api/friends`)).inbox;
  assert.equal(inbox.length, 2);
  const rec = inbox.find((m) => m.kind === 'recommend');
  await fed.markMessage(a, rec.id, 'read');
  assert.equal((await fed.overview(a, `${A}/api/friends`)).unread, 1);
  await fed.markMessage(a, rec.id, 'unread');
  assert.equal((await fed.overview(a, `${A}/api/friends`)).unread, 2);
  await fed.markAllRead(a);
  assert.equal((await fed.overview(a, `${A}/api/friends`)).unread, 0);
  await fed.deleteMessage(a, rec.id);
  inbox = (await fed.overview(a, `${A}/api/friends`)).inbox;
  assert.deepEqual(inbox.map((m) => m.kind), ['friend-accept']);
  await assert.rejects(fed.deleteMessage(a, rec.id), /not found/);
});
