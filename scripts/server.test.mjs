// Offline tests for the API layer (run: npm test). External services are mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown, parseMarkdown, normalizeItem } from '../server/markdown.js';
import { parseBggSearch, parseBggThings, search, details, igdbScore, rankBggHits, bggIdFromUrl } from '../server/providers.js';
import { saveItem, deleteItem } from '../server/save.js';
import { checkAuth } from '../server/auth.js';
import { GET as searchHandler } from '../src/pages/api/search.js';
import { fakeEnv } from './fake-cloudflare.mjs';

// ── tiny fetch mock ──
function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    for (const [match, fn] of routes) {
      if (typeof match === 'string' ? url.includes(match) : match.test(url)) {
        const r = await fn(url, init);
        if (r instanceof Response) return r;
        return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200, headers: { 'content-type': typeof r === 'string' ? 'text/xml' : 'application/json' } });
      }
    }
    return new Response('not mocked: ' + url, { status: 599 });
  };
  return calls;
}

test('markdown round-trip keeps fields and quotes numeric strings', () => {
  const item = normalizeItem({
    title: 'Dune: Part Two', type: 'movie', creator: 'Denis Villeneuve', year: 2024, rating: '4.5',
    status: 'finished', dateFinished: '2026-11-19T10:00:00Z', collections: ['2026', 'favorites'],
    tags: 'sci-fi, epic', genres: [], details: { runtime: 166, cast: ['Timothée Chalamet'], empty: '' },
    source: { name: 'TMDB', id: '693134', url: 'https://www.themoviedb.org/movie/693134' },
  });
  const md = buildMarkdown(item, 'Loved it.\n\nSecond paragraph.');
  assert.match(md, /^---\ntitle: "Dune: Part Two"|^---\ntitle: 'Dune: Part Two'/);
  assert.match(md, /year: "2024"/);
  assert.match(md, /- "2026"/);
  assert.match(md, /dateFinished: 2026-11-19/);
  assert.doesNotMatch(md, /genres/);
  assert.doesNotMatch(md, /empty/);
  const { data, body } = parseMarkdown(md);
  assert.equal(data.title, 'Dune: Part Two');
  assert.equal(data.rating, 4.5);
  assert.deepEqual(data.tags, ['sci-fi', 'epic']);
  assert.equal(body, 'Loved it.\n\nSecond paragraph.');
});

const BGG_SEARCH = `<?xml version="1.0" encoding="utf-8"?><items total="3" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
<item type="boardgame" id="266192"><name type="primary" value="Wingspan"/><yearpublished value="2019" /></item>
<item type="boardgame" id="999"><name type="primary" value="Wingspan Asia"/><yearpublished value="2022" /></item>
<item type="boardgame" id="266192"><name type="alternate" value="Flügelschlag"/><yearpublished value="2019" /></item>
</items>`;
const BGG_THING = `<?xml version="1.0" encoding="utf-8"?><items termsofuse="x">
<item type="boardgame" id="266192">
  <thumbnail>https://cf.geekdo-images.com/t.jpg</thumbnail>
  <image>https://cf.geekdo-images.com/big.jpg</image>
  <name type="primary" sortindex="1" value="Wingspan" />
  <name type="alternate" sortindex="1" value="Flügelschlag" />
  <description>Attract birds &amp;amp; build engines.&amp;#10;&amp;#10;Second line &amp;mdash; ok.</description>
  <yearpublished value="2019" /><minplayers value="1" /><maxplayers value="5" /><playingtime value="70" /><minplaytime value="40" /><maxplaytime value="70" /><minage value="10" />
  <poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="100">
    <results numplayers="1"><result value="Best" numvotes="5"/><result value="Recommended" numvotes="30"/><result value="Not Recommended" numvotes="20"/></results>
    <results numplayers="2"><result value="Best" numvotes="40"/><result value="Recommended" numvotes="30"/><result value="Not Recommended" numvotes="5"/></results>
    <results numplayers="3"><result value="Best" numvotes="60"/><result value="Recommended" numvotes="20"/><result value="Not Recommended" numvotes="2"/></results>
    <results numplayers="5"><result value="Best" numvotes="2"/><result value="Recommended" numvotes="10"/><result value="Not Recommended" numvotes="40"/></results>
    <results numplayers="5+"><result value="Best" numvotes="0"/><result value="Recommended" numvotes="0"/><result value="Not Recommended" numvotes="30"/></results>
  </poll>
  <link type="boardgamemechanic" id="9" value="Engine Building" />
  <link type="boardgamemechanic" id="10" value="Hand Management" />
  <link type="boardgamecategory" id="1089" value="Animals" />
  <link type="boardgamedesigner" id="1" value="Elizabeth Hargrave" />
  <link type="boardgamepublisher" id="2" value="Stonemaier Games" />
  <statistics page="1"><ratings><ranks><rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="31" bayesaverage="7.9" /></ranks><averageweight value="2.4431" /></ratings></statistics>
</item></items>`;

test('BGG XML parsing', () => {
  const hits = parseBggSearch(BGG_SEARCH);
  assert.equal(hits.length, 3);
  assert.deepEqual(hits[0], { id: '266192', kind: 'boardgame', name: 'Wingspan', year: '2019' });
  const [t] = parseBggThings(BGG_THING);
  assert.equal(t.title, 'Wingspan');
  assert.equal(t.image, 'https://cf.geekdo-images.com/big.jpg');
  assert.equal(t.players, '1–5');
  assert.equal(t.rank, '31');
  assert.equal(t.weight, 2.44);
  assert.deepEqual(t.bestPlayers, [2, 3]);
  assert.deepEqual(t.recPlayers, [1, 2, 3]);
  assert.equal(t.minPlaytime, 40); assert.equal(t.maxPlaytime, 70); assert.equal(t.minAge, 10);
  assert.deepEqual(t.mechanics, ['Engine Building', 'Hand Management']);
  assert.deepEqual(t.designers, ['Elizabeth Hargrave']);
  assert.equal(t.description, 'Attract birds & build engines.\n\nSecond line — ok.');
});

test('BGG search: sends token, dedupes, enriches', async () => {
  const calls = mockFetch([['xmlapi2/search', () => BGG_SEARCH], ['xmlapi2/thing', () => BGG_THING]]);
  const res = await search('boardgame', 'wingspan', { BGG_TOKEN: 'tok' });
  assert.equal(res.length, 2);
  assert.equal(res[0].title, 'Wingspan');
  assert.equal(res[0].creator, 'Elizabeth Hargrave');
  assert.equal(res[0].cover, 'https://cf.geekdo-images.com/big.jpg');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.match(calls[1].url, /id=266192,999/);
});

test('BGG ranking: base game beats a pile of same-named expansions', () => {
  const exp = (id, name) => [
    `<item type="boardgame" id="${id}"><name type="primary" value="${name}"/></item>`,
    `<item type="boardgameexpansion" id="${id}"><name type="primary" value="${name}"/></item>`,
  ].join('');
  const names = ['Adventurer Expansion', 'Dirty Thirteen', 'Freaks & Psychos', 'Malingerers', 'Missions I', 'Missions II',
    'Missions III and Fleshy Mess', 'Promo Cards', 'Bad Luck Deck', 'Curse Deck', 'Extra Dice', 'Gonzo Pack', 'Mega Pack', 'Misc'];
  const xml = `<items>${names.map((n, i) => exp(1000 + i, `Dungeon Degenerates: ${n}`)).join('')}
    <item type="boardgame" id="210232"><name type="primary" value="Dungeon Degenerates: Hand of Doom"/><yearpublished value="2017"/></item></items>`;
  const ranked = rankBggHits(parseBggSearch(xml), 'dungeon degenerates');
  assert.equal(ranked[0].id, '210232');
  assert.equal(new Set(ranked.map((h) => h.id)).size, ranked.length);
  // Matching the part after the colon counts as an exact title match.
  assert.equal(rankBggHits(parseBggSearch(xml), 'hand of doom')[0].id, '210232');
});

test('BGG link lookup', async () => {
  assert.equal(bggIdFromUrl('https://boardgamegeek.com/boardgame/210232/dungeon-degenerates-hand-doom'), '210232');
  assert.equal(bggIdFromUrl('boardgamegeek.com/boardgameexpansion/12345'), '12345');
  assert.equal(bggIdFromUrl('https://example.com/'), null);
  const calls = mockFetch([['xmlapi2/thing', () => BGG_THING]]);
  const res = await search('boardgame', 'https://boardgamegeek.com/boardgame/266192/wingspan', { BGG_TOKEN: 'tok' });
  assert.equal(res.length, 1);
  assert.equal(res[0].title, 'Wingspan');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /thing\?id=266192/);
  mockFetch([['xmlapi2/thing', () => '<items></items>']]);
  await assert.rejects(search('boardgame', 'https://boardgamegeek.com/boardgame/1/x', { BGG_TOKEN: 'tok' }), /No game found/);
});

test('TMDB search + details (bearer token)', async () => {
  const calls = mockFetch([
    ['/search/movie', () => ({ results: [{ id: 1, title: 'The Princess Bride', release_date: '1987-09-25', poster_path: '/p.jpg', overview: 'Fairy tale.' }] })],
    ['/movie/1', () => ({ runtime: 98, overview: 'Fairy tale.', genres: [{ name: 'Adventure' }], credits: { cast: [{ name: 'Cary Elwes' }], crew: [{ job: 'Director', name: 'Rob Reiner' }] } })],
  ]);
  const env = { TMDB_TOKEN: 'eyJ' + 'x'.repeat(60) };
  const [r] = await search('movie', 'princess bride', env);
  assert.equal(r.year, '1987');
  assert.equal(r.cover, 'https://image.tmdb.org/t/p/w780/p.jpg');
  assert.match(calls[0].init.headers.authorization, /^Bearer /);
  const d = await details('movie', 'tmdb', '1', env);
  assert.equal(d.creator, 'Rob Reiner');
  assert.equal(d.details.runtime, 98);
});

test('Spotify search uses client credentials and limit=10; falls back to MusicBrainz on failure', async () => {
  let calls = mockFetch([
    ['accounts.spotify.com', () => ({ access_token: 'abc', expires_in: 3600 })],
    ['api.spotify.com/v1/search', () => ({
      albums: { items: [{ id: 'a1', name: 'Abbey Road', album_type: 'album', total_tracks: 17, release_date: '1969-09-26', artists: [{ name: 'The Beatles' }], images: [{ url: 'https://i.scdn.co/a.jpg' }], external_urls: { spotify: 'https://open.spotify.com/album/a1' } }] },
      tracks: { items: [{ id: 't1', name: 'Something', artists: [{ name: 'The Beatles' }], album: { name: 'Abbey Road', release_date: '1969', images: [{ url: 'https://i.scdn.co/a.jpg' }] }, external_urls: {} }] },
    })],
  ]);
  const env = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' };
  const res = await search('music', 'abbey road', env);
  assert.equal(res.length, 2);
  assert.equal(res[0].details.kind, 'Album');
  assert.equal(res[1].details.kind, 'Song');
  assert.match(calls.find((c) => c.url.includes('/v1/search')).url, /limit=10/);

  calls = mockFetch([
    ['api.spotify.com', () => new Response('nope', { status: 403 })],
    ['musicbrainz.org', () => ({ 'release-groups': [{ id: 'rg1', title: 'Abbey Road', 'first-release-date': '1969-09-26', 'primary-type': 'Album', 'artist-credit': [{ name: 'The Beatles' }] }] })],
  ]);
  const fb = await search('music', 'abbey road', env);
  assert.equal(fb[0].source, 'musicbrainz');
  assert.equal(fb[0].cover, 'https://coverartarchive.org/release-group/rg1/front-500');
});

test('IGDB search via Twitch token', async () => {
  const calls = mockFetch([
    ['id.twitch.tv', () => ({ access_token: 'tw', expires_in: 5000000 })],
    ['api.igdb.com', () => [{ id: 1026, name: 'The Legend of Zelda: A Link to the Past', first_release_date: 690681600, cover: { image_id: 'co3vzn' }, summary: 'Hero.', genres: [{ name: 'Adventure' }], platforms: [{ abbreviation: 'SNES' }], involved_companies: [{ developer: true, company: { name: 'Nintendo EAD' } }, { publisher: true, company: { name: 'Nintendo' } }], url: 'https://www.igdb.com/games/x' }]],
  ]);
  const [g] = await search('videogame', 'link to the past', { TWITCH_CLIENT_ID: 'c', TWITCH_CLIENT_SECRET: 's' });
  assert.equal(g.year, '1991');
  assert.equal(g.creator, 'Nintendo EAD');
  assert.equal(g.cover, 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co3vzn.jpg');
  const igdbCall = calls.find((c) => c.url.includes('api.igdb.com'));
  assert.equal(igdbCall.init.headers['client-id'], 'c');
  assert.match(igdbCall.init.body, /search "link to the past"/);
});

test('Books merge Open Library + Google Books even if one fails', async () => {
  mockFetch([
    ['openlibrary.org/search.json', () => ({ docs: [{ key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, cover_i: 123, isbn: ['0441013597', '9780441013593'] }] })],
    ['googleapis.com/books', () => new Response('quota', { status: 429 })],
  ]);
  const res = await search('book', 'dune', {});
  assert.equal(res.length, 1);
  assert.equal(res[0].sourceId, 'OL893415W');
  assert.equal(res[0].details.isbn, '9780441013593');
  assert.equal(res[0].cover, 'https://covers.openlibrary.org/b/id/123-L.jpg');
});

// ── GitHub commit flow ──

const astro = (url, env, init) => ({ request: new Request(url, init), url: new URL(url), locals: { runtime: { env } }, params: {} });
const PNG_1x2 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEUlEQVR4nGP4z8DAwMDAAAAMBgEAqqqdNwAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

test('saveItem: new item goes to D1, cover is copied into KV with its proportions', async () => {
  const env = fakeEnv();
  await saveItem(env, { item: { title: 'Dune', type: 'book', year: 1965, status: 'finished' }, body: '' }); // takes the slug
  mockFetch([['covers.openlibrary.org', () => new Response(PNG_1x2, { headers: { 'content-type': 'image/png' } })]]);
  const res = await saveItem(env, {
    item: { title: 'Dune', type: 'book', year: 1965, status: 'finished', cover: 'https://covers.openlibrary.org/b/id/1-L.jpg', collections: 'favorites, 2026' },
    body: 'Spice.',
  });
  assert.equal(res.slug, 'book-dune-1965-2');
  assert.match(res.item.cover, /^\/img\/book-dune-1965-2-[a-z0-9]+\.png$/);
  assert.equal(res.item.coverAspect, 0.5);
  assert.deepEqual(res.item.collections, ['favorites', '2026']);
  assert.ok(res.item.dateAdded);
  const name = res.item.cover.slice(5);
  assert.ok(env.COVERS._store.has(name));
  const img = await (await import('../server/covers.js')).serveCover(env, name);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const { getItem } = await import('../server/db.js');
  assert.equal((await getItem(env, 'book-dune-1965-2')).body, 'Spice.');
});

test('saveItem: editing keeps slug, date added and cover; replacing/deleting cleans up KV', async () => {
  const env = fakeEnv();
  mockFetch([['example.com', () => new Response(PNG_1x2, { headers: { 'content-type': 'image/png' } })]]);
  const first = await saveItem(env, { item: { title: 'Dune', type: 'book', year: 1965, status: 'finished', cover: 'https://example.com/a.png' }, body: 'Old.' });
  const edit = await saveItem(env, { slug: first.slug, item: { ...first.item, rating: 5 }, body: 'New.' });
  assert.equal(edit.slug, first.slug);
  assert.equal(edit.item.cover, first.item.cover);
  assert.equal(edit.item.coverAspect, 0.5);
  assert.equal(edit.item.dateAdded, first.item.dateAdded);
  await new Promise((r) => setTimeout(r, 2));
  const swapped = await saveItem(env, { slug: first.slug, item: { ...edit.item, cover: 'https://example.com/b.png' }, body: 'New.' });
  assert.notEqual(swapped.item.cover, first.item.cover);
  assert.equal(env.COVERS._store.size, 1, 'old cover removed');
  await deleteItem(env, first.slug);
  assert.equal(env.COVERS._store.size, 0);
  await assert.rejects(() => deleteItem(env, first.slug), /not found/);
  await assert.rejects(() => deleteItem(env, '../etc/passwd'), /Invalid slug/);
  await assert.rejects(() => saveItem(env, { slug: 'nope', item: { title: 'X', type: 'book', status: 'want' } }), /not found/);
});

test('missing bindings give a clear error', async () => {
  await assert.rejects(() => saveItem({}, { item: { title: 'X', type: 'book', status: 'want' } }), /binding named DB/);
});

test('auth check + search handler', async () => {
  const env = { ADMIN_TOKEN: 's3cret' };
  const req = (headers) => new Request('https://x/api/ping', { headers });
  assert.equal((await checkAuth(req({}), env)).status, 401);
  assert.equal((await checkAuth(req({ authorization: 'Bearer nope' }), env)).status, 401);
  assert.equal(await checkAuth(req({ authorization: 'Bearer s3cret' }), env), null);
  assert.equal((await checkAuth(req({ authorization: 'Bearer s3cret' }), {})).status, 500);
  const bad = await searchHandler(astro('https://x/api/search?type=nope&q=hi', env));
  assert.equal(bad.status, 400);
  const noKey = await searchHandler(astro('https://x/api/search?type=movie&q=hello', {}));
  assert.equal(noKey.status, 400);
  assert.match((await noKey.json()).error, /TMDB_TOKEN/);
});

test('IGDB re-ranking puts real releases above mods and caps at 26', async () => {
  const cover = { image_id: 'x' };
  const pool = [
    { id: 1, name: "Ocarina of Time: Spaceworld '97 Experience", game_type: 5, cover },
    { id: 2, name: 'Ocarina of Time: Chaos Edition', game_type: 5, cover },
    { id: 3, name: 'Unreal Engine The Legend of Zelda: Ocarina of Time' },
    { id: 4, name: 'Ocarina of Time Redux', cover },
    { id: 5, name: 'The Legend of Zelda: Ocarina of Time 3D', game_type: 8, cover, total_rating_count: 400 },
    { id: 6, name: 'The Legend of Zelda: Ocarina of Time', game_type: 0, cover, total_rating_count: 900 },
    { id: 7, name: 'The Legend of Zelda: Ocarina of Time', game_type: 8, cover, hypes: 120 },
    { id: 8, name: 'Ocarina of Time + Majora\'s Mask Crossover Randomizer', cover },
    ...Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, name: `Filler ${i}` })),
  ];
  const calls = mockFetch([
    ['id.twitch.tv', () => ({ access_token: 'tw2', expires_in: 5000000 })],
    ['api.igdb.com', () => pool],
  ]);
  const res = await search('videogame', 'ocarina of time', { TWITCH_CLIENT_ID: 'c', TWITCH_CLIENT_SECRET: 's' });
  assert.equal(res.length, 26);
  assert.deepEqual(res.slice(0, 3).map((r) => r.sourceId).sort(), ['5', '6', '7']);
  const top3 = res.slice(0, 3).map((r) => r.sourceId);
  assert.ok(top3.indexOf('6') < top3.indexOf('5'), 'exact title beats "3D"');
  const pos = (id) => res.findIndex((r) => r.sourceId === id);
  assert.ok(pos('1') > pos('5') && pos('3') > pos('5') && pos('4') > pos('5'));
  assert.match(calls.find((c) => c.url.includes('api.igdb.com')).init.body, /limit 50;/);
  assert.ok(igdbScore({ name: 'Wingspan Redux', cover }, 'wingspan redux') > igdbScore({ name: 'Wingspan Redux', cover }, 'wingspan') );
});

test('shelf sort orders', async () => {
  const { sortShelf } = await import('../src/lib/sorting.js');
  const e = (id, data) => ({ id, data });
  const items = [
    e('a', { title: 'The Zebra', creator: 'Bo', year: '1999', rating: 3, dateAdded: '2026-01-01', dateFinished: '2026-03-01' }),
    e('b', { title: 'Apple', creator: 'Al', year: '2020', rating: null, dateAdded: '2026-02-01', dateFinished: '2026-01-15' }),
    e('c', { title: 'Mango', creator: '', year: '', rating: 5, dateAdded: '2026-03-05' }),
  ];
  const ids = (sort, extra = {}) => sortShelf(items, { sort, ...extra }).map((x) => x.id).join('');
  assert.equal(ids('newest'), 'cab');
  assert.equal(ids('oldest'), 'bac');
  assert.equal(ids('title'), 'bca');      // "The Zebra" sorts as "Zebra"
  assert.equal(ids('creator'), 'bac');    // missing creator last
  assert.equal(ids('rating'), 'cab');     // unrated last
  assert.equal(ids('year-new'), 'bac');
  assert.equal(ids('year-old'), 'abc');
  assert.equal(ids('custom', { order: ['c', 'a'] }), 'bca'); // unarranged (new) 'b' goes first
  assert.equal(ids(undefined), 'cab');
});

test('automatic collections include items by status', async () => {
  const { inShelf } = await import('../src/lib/sorting.js');
  const cur = { slug: 'currently', auto: 'in-progress' };
  assert.ok(inShelf({ status: 'in-progress', collections: [] }, cur));
  assert.ok(!inShelf({ status: 'finished', collections: [] }, cur));
  assert.ok(inShelf({ status: 'finished', collections: ['currently'] }, cur)); // manual add still works
  assert.ok(inShelf({ status: 'want', collections: ['favorites'] }, { slug: 'favorites' }));
});


test('arrangements are stored per type shelf', async () => {
  const { saveArrangement, getArrangements } = await import('../server/settings.js');
  const env = fakeEnv();
  await saveArrangement(env, 'music:finished', ['x']);
  const saved = await saveArrangement(env, 'book:finished', ['b', 'a', 'b', '../bad']);
  assert.deepEqual(saved, { 'book:finished': ['b', 'a'], 'music:finished': ['x'] });
  assert.deepEqual(await getArrangements(env), saved);
  await saveArrangement(env, 'music:finished', []);
  assert.deepEqual(Object.keys(await getArrangements(env)), ['book:finished']);
  await assert.rejects(() => saveArrangement(env, 'book:nope', []), /Invalid shelf/);
});

test('collections keep the "show on" setting', async () => {
  const { POST, GET } = await import('../src/pages/api/collections.js');
  const env = fakeEnv();
  const body = JSON.stringify({ collections: [
    { slug: 'a', name: 'A', show: 'type' }, { slug: 'b', name: 'B', show: 'both' }, { slug: 'c', name: 'C', show: 'shelves' }, { slug: 'd', name: 'D', show: 'bogus' },
  ] });
  const res = await POST(astro('https://x/api/collections', env, { method: 'POST', body }));
  assert.equal(res.status, 200);
  const { collections } = await (await GET(astro('https://x/api/collections', env))).json();
  assert.deepEqual(collections.map((c) => c.show), ['type', 'both', undefined, undefined]);
});

test('refresh board games: links manual entries, keeps notes and rating', async () => {
  const { refreshBoardgames } = await import('../server/refresh.js');
  const { putItem, getItem } = await import('../server/db.js');
  const env = { ...fakeEnv(), BGG_TOKEN: 'tok' };
  await putItem(env, 'boardgame-wingspan-2019', { title: 'Wingspan', type: 'boardgame', year: '2019', status: 'finished', rating: 4.5, cover: '/img/w.jpg', coverAspect: 1.2, details: { players: '1–5' }, source: { name: 'Manual' } }, 'My notes stay.');
  await putItem(env, 'book-x', { title: 'X', type: 'book' }, '');
  mockFetch([['xmlapi2/search', () => BGG_SEARCH], ['xmlapi2/thing', () => BGG_THING]]);
  const { updated, report } = await refreshBoardgames(env);
  assert.equal(updated, 1);
  assert.match(report[0].status, /linked to “Wingspan \(2019\)”/);
  const { item, body } = await getItem(env, 'boardgame-wingspan-2019');
  assert.equal(body, 'My notes stay.');
  assert.equal(item.rating, 4.5);
  assert.equal(item.cover, '/img/w.jpg');
  assert.equal(item.coverAspect, 1.2);
  assert.equal(item.details.minPlayers, 1);
  assert.deepEqual(item.details.bestPlayers, [2, 3]);
  assert.equal(item.details.weight, 2.44);
  assert.equal(item.source.id, '266192');
  assert.ok(item.details.mechanics.includes('Engine Building'));
});

test('import copies old Markdown entries + covers once, in batches', async () => {
  const { importBatch, pendingImports } = await import('../server/import.js');
  const { getItem, countItems } = await import('../server/db.js');
  const { getCollections } = await import('../server/settings.js');
  const env = fakeEnv();
  const files = {};
  for (let i = 0; i < 20; i++) files[`../content/items/book-n${i}.md`] = `---\ntitle: Book ${i}\ntype: book\nyear: "2020"\nstatus: finished\nrating: 4\ndateFinished: 2026-01-0${(i % 9) + 1}\ncover: /covers/book-n${i}.png\ncollections: [favorites]\n---\n\nNotes ${i}.`;
  const seed = { files, collections: [{ slug: 'favorites', name: 'Favorites', description: '' }], arrangements: {} };
  const fetched = [];
  const fetchAsset = async (path) => { fetched.push(path); return new Response(PNG_1x2, { headers: { 'content-type': 'image/png' } }); };
  const a = await importBatch(env, seed, fetchAsset);
  assert.equal(a.imported.length, 15);
  assert.equal(a.remaining, 5);
  assert.deepEqual(a.settings, ['collections', 'arrangements']);
  const b = await importBatch(env, seed, fetchAsset);
  assert.equal(b.remaining, 0);
  assert.deepEqual(b.settings, []);
  assert.equal(await countItems(env), 20);
  assert.equal((await pendingImports(env, seed)).length, 0);
  const { item, body } = await getItem(env, 'book-n3');
  assert.equal(body, 'Notes 3.');
  assert.match(item.cover, /^\/img\/book-n3-/);
  assert.equal(item.coverAspect, 0.5);
  assert.equal(item.dateFinished, '2026-01-04');
  assert.equal(env.COVERS._store.size, 20);
  assert.equal((await getCollections(env))[0].name, 'Favorites');
  const c = await importBatch(env, seed, fetchAsset); // nothing left: no-op
  assert.equal(c.imported.length, 0);
});

test('pages get entries in the old content-collection shape', async () => {
  const { toEntry } = await import('../src/lib/items.js').catch(() => ({}));
  if (!toEntry) return; // items.js imports `marked`; skip if unavailable
  const e = toEntry({ slug: 's', item: { title: 'T', type: 'movie', year: 2024, rating: null, dateStarted: null }, body: 'b' });
  assert.equal(e.id, 's');
  assert.equal(e.data.year, '2024');
  assert.equal(e.data.status, 'finished');
  assert.deepEqual(e.data.collections, []);
  assert.equal(e.data.rating, null);
});

test('expansions are cleaned, stored with the base game, images copied and cleaned up', async () => {
  const env = fakeEnv();
  mockFetch([['geekdo', () => new Response(PNG_1x2, { headers: { 'content-type': 'image/png' } })]]);
  const base = { title: 'Wingspan', type: 'boardgame', status: 'finished' };
  const res = await saveItem(env, { item: { ...base, expansions: [
    { id: '290837', title: 'Wingspan: European Expansion', year: 2019, cover: 'https://cf.geekdo-images.com/a.png' },
    { id: '290837', title: 'dup' },
    { title: 'Homemade promo cards' },
    { title: '   ' },
  ] }, body: '' });
  const ex = res.item.expansions;
  assert.equal(ex.length, 2);
  assert.match(ex[0].cover, /^\/img\/boardgame-wingspan-x290837-/);
  assert.equal(ex[0].url, 'https://boardgamegeek.com/boardgameexpansion/290837');
  assert.equal(ex[0].year, '2019');
  assert.deepEqual(ex[1], { title: 'Homemade promo cards' });
  assert.equal(env.COVERS._store.size, 1);
  const again = await saveItem(env, { slug: res.slug, item: { ...res.item, expansions: [ex[1]] }, body: '' });
  assert.equal(again.item.expansions.length, 1);
  assert.equal(env.COVERS._store.size, 0, 'detached expansion image removed');
  const none = await saveItem(env, { slug: res.slug, item: { ...again.item, expansions: [] }, body: '' });
  assert.equal(none.item.expansions, undefined);
  const book = await saveItem(env, { item: { title: 'B', type: 'book', status: 'want', expansions: [{ title: 'x' }] }, body: '' });
  assert.equal(book.item.expansions, undefined, 'only board games keep expansions');
  await assert.rejects(() => saveItem(env, { item: { title: 'C', type: 'book' } }), /Choose a status/);
});

test('BGG base game lists its expansions', async () => {
  const { parseBggThings } = await import('../server/providers.js');
  const [t] = parseBggThings(`<items><item type="boardgame" id="1"><name type="primary" value="Base"/>
    <link type="boardgameexpansion" id="10" value="Exp A"/><link type="boardgameexpansion" id="11" value="Exp B"/></item>
    <item type="boardgameexpansion" id="10"><name type="primary" value="Exp A"/><link type="boardgameexpansion" id="1" value="Base" inbound="true"/></item></items>`);
  assert.equal(t.kind, 'boardgame');
  assert.deepEqual(t.expansionLinks.map((l) => l.id), ['10', '11']);
  const [, e] = parseBggThings(`<items><item type="boardgame" id="1"></item><item type="boardgameexpansion" id="10"><link type="boardgameexpansion" id="1" value="Base" inbound="true"/></item></items>`);
  assert.equal(e.kind, 'boardgameexpansion');
  assert.deepEqual(e.expansionLinks, []);
});

test('collections can be limited to a recent time window', async () => {
  const { inShelf } = await import('../src/lib/sorting.js');
  const { cleanCollections } = await import('../server/settings.js');
  const now = Date.parse('2026-11-20T12:00:00Z');
  const shelf = { slug: 'recently-finished', auto: 'finished', within: 365 };
  assert.equal(inShelf({ status: 'finished', dateFinished: '2026-03-01' }, shelf, now), true);
  assert.equal(inShelf({ status: 'finished', dateFinished: '2025-06-01' }, shelf, now), false);
  assert.equal(inShelf({ status: 'finished', dateAdded: '2024-01-01' }, shelf, now), false, 'falls back to date added');
  assert.equal(inShelf({ status: 'finished' }, shelf, now), true, 'no date at all: kept');
  assert.equal(inShelf({ status: 'want', dateFinished: '2026-03-01' }, shelf, now), false);
  assert.equal(inShelf({ status: 'finished', dateFinished: '2020-01-01' }, { ...shelf, within: undefined }, now), true);
  const [a, b] = cleanCollections([{ name: 'A', within: '365' }, { name: 'B', within: 12 }]);
  assert.equal(a.within, 365);
  assert.equal(b.within, undefined);
});

test('saveItem: only one entry is featured at a time', async () => {
  const { getItem } = await import('../server/db.js');
  const env = fakeEnv();
  const a = await saveItem(env, { item: { title: 'Dune', type: 'book', status: 'finished', featured: true }, body: 'Loved it.' });
  const b = await saveItem(env, { item: { title: 'Alien', type: 'movie', status: 'finished' }, body: 'Scary.' });
  assert.equal((await getItem(env, a.slug)).item.featured, true);
  assert.equal((await getItem(env, b.slug)).item.featured, undefined);

  await saveItem(env, { slug: b.slug, item: { title: 'Alien', type: 'movie', status: 'finished', featured: true }, body: 'Scary.' });
  const rowA = await getItem(env, a.slug);
  assert.equal(rowA.item.featured, undefined);
  assert.equal(rowA.body, 'Loved it.'); // un-featuring keeps the other entry's notes
  assert.equal((await getItem(env, b.slug)).item.featured, true);

  await saveItem(env, { slug: b.slug, item: { title: 'Alien', type: 'movie', status: 'finished', featured: false }, body: 'Scary.' });
  assert.equal((await getItem(env, b.slug)).item.featured, undefined);
});

test('removeFromCollection: drops only that collection and keeps notes', async () => {
  const { removeFromCollection } = await import('../server/save.js');
  const { getItem } = await import('../server/db.js');
  const env = fakeEnv();
  const a = await saveItem(env, { item: { title: 'Dune', type: 'book', status: 'finished', collections: ['faves', 'scifi'] }, body: 'Spice.' });
  const b = await saveItem(env, { item: { title: 'Emma', type: 'book', status: 'finished', collections: ['classics'] }, body: '' });
  const res = await removeFromCollection(env, 'faves', [a.slug, b.slug]);
  assert.deepEqual(res.removed, [a.slug]);
  const row = await getItem(env, a.slug);
  assert.deepEqual(row.item.collections, ['scifi']);
  assert.equal(row.body, 'Spice.');
  assert.deepEqual((await getItem(env, b.slug)).item.collections, ['classics']);
});

test('shelf decorations: PNG/WebP only, up to three, removed images are deleted, kept in backups', async () => {
  const { addDecor, saveDecor, getDecor } = await import('../server/decor.js');
  const { exportBackup, restoreBackup } = await import('../server/backup.js');
  const { fakeEnv } = await import('./fake-cloudflare.mjs');
  const env = fakeEnv();
  // 1×1 transparent PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0)).buffer;
  await assert.rejects(addDecor(env, new TextEncoder().encode('GIF89a nope').buffer), /PNG, WebP or JPG/);
  await addDecor(env, png);
  await addDecor(env, png);
  const list = await addDecor(env, png);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((d) => d.x), [10, 90, 50]);
  assert.ok(list.every((d) => /^\/img\/decor-[a-z0-9-]+\.png$/.test(d.image) && d.height === 110 && d.tilt === 0 && d.turn === 0 && d.frame === 'none' && d.aspect === 1));
  await assert.rejects(addDecor(env, png), /up to 3/);
  // Bad values are cleaned; outside images aren't accepted.
  const saved = await saveDecor(env, [{ ...list[0], x: 37.26, height: 999, tilt: -45, turn: -80, flip: true, frame: 'neon' }, { ...list[1], x: 'abc', frame: 'gold', tilt: 3.3, turn: 22.4 }, { image: 'https://evil.example/x.png' }]);
  assert.deepEqual(saved.map((d) => [d.x, d.height, d.tilt, d.turn, d.flip, d.frame]), [[37.3, 240, -20, -50, true, 'none'], [50, 110, 3.5, 22, false, 'gold']]);
  // Phone settings: null follows desktop; a set of its own is cleaned the same way.
  assert.equal(saved[0].phone, null);
  const withPhone = await saveDecor(env, [{ ...saved[0], y: 500, phone: { x: 120, y: 12.4, height: 64, tilt: 2, turn: -10, hidden: true } }, saved[1]]);
  assert.equal(withPhone[0].y, 160);
  assert.equal(withPhone[1].y, 0);
  assert.deepEqual(withPhone[0].phone, { x: 100, y: 12, height: 64, tilt: 2, turn: -10, hidden: true });
  // Older entries (five spots, three sizes) become numbers.
  const { cleanDecor } = await import('../server/decor.js');
  assert.deepEqual(cleanDecor([{ image: list[0].image, position: 'right-center', size: 'large' }]).map((d) => [d.x, d.height, d.turn]), [[70, 150, 0]]);
  assert.equal(env.COVERS._store.has(list[2].image.slice(5)), false); // the removed one is gone from storage
  assert.equal(env.COVERS._store.has(list[0].image.slice(5)), true);
  // A JPG goes straight into a wood frame.
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).buffer;
  const withJpg = await addDecor(env, jpg);
  assert.equal(withJpg.at(-1).frame, 'wood');
  assert.equal(withJpg.at(-1).turn, 20);
  assert.match(withJpg.at(-1).image, /\.jpg$/);
  await saveDecor(env, withJpg.slice(0, 2));
  const backup = await exportBackup(env, 'https://old.example');
  assert.equal(backup.decor.length, 2);
  const fresh = fakeEnv();
  await restoreBackup(fresh, backup);
  assert.equal((await getDecor(fresh)).length, 2);
});
