// Metadata providers. Every search returns normalized results:
// { type, source, sourceId, title, creator, year, cover, description, genres, details, url }
import { HttpError, fetchJson, userAgent, yearOf, decodeEntities, stripHtml, truncate } from './util.js';

const result = (r) => ({
  creator: '', year: '', cover: '', description: '', genres: [], details: {}, url: '',
  ...r,
  sourceId: String(r.sourceId),
});

// ───────────────────────── Books: Open Library + Google Books ─────────────────────────

async function searchOpenLibrary(q, env) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median,isbn,subject,publisher`;
  const data = await fetchJson(url, { headers: { 'user-agent': userAgent(env) } }, 'Open Library');
  return (data.docs || []).map((d) => result({
    type: 'book',
    source: 'openlibrary',
    sourceId: String(d.key || '').replace('/works/', ''),
    title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
    creator: (d.author_name || []).slice(0, 3).join(', '),
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
    genres: (d.subject || []).slice(0, 4),
    details: {
      pages: d.number_of_pages_median || undefined,
      isbn: (d.isbn || []).find((i) => i.length === 13) || (d.isbn || [])[0],
      publisher: (d.publisher || [])[0],
    },
    url: d.key ? `https://openlibrary.org${d.key}` : '',
  }));
}

async function openLibraryDetails(id, env) {
  const data = await fetchJson(`https://openlibrary.org/works/${encodeURIComponent(id)}.json`, { headers: { 'user-agent': userAgent(env) } }, 'Open Library');
  const desc = typeof data.description === 'string' ? data.description : data.description?.value || '';
  return { description: truncate(desc.replace(/\r/g, '').replace(/\(\[source\][^)]*\)/g, '')) };
}

async function searchGoogleBooks(q, env) {
  const key = env.GOOGLE_BOOKS_KEY ? `&key=${env.GOOGLE_BOOKS_KEY}` : '';
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books${key}`, {}, 'Google Books');
  return (data.items || []).map((it) => {
    const v = it.volumeInfo || {};
    const img = v.imageLinks?.extraLarge || v.imageLinks?.large || v.imageLinks?.medium || v.imageLinks?.thumbnail || '';
    const isbn = (v.industryIdentifiers || []).find((i) => i.type === 'ISBN_13')?.identifier;
    return result({
      type: 'book',
      source: 'googlebooks',
      sourceId: it.id,
      title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
      creator: (v.authors || []).join(', '),
      year: yearOf(v.publishedDate),
      cover: img.replace('http://', 'https://').replace('&edge=curl', ''),
      description: truncate(stripHtml(v.description)),
      genres: v.categories || [],
      details: { pages: v.pageCount || undefined, isbn, publisher: v.publisher },
      url: v.infoLink || '',
    });
  });
}

/** An Open Library link (a work, an edition or an ISBN page) → { kind, id }, else null. */
export function openLibraryRefFromUrl(input) {
  const s = String(input || '').trim();
  let m = s.match(/openlibrary\.org\/works\/(OL\d+W)/i);
  if (m) {
    // A work page with an edition picked (…?edition=key:/books/OL…M) shows that edition's cover.
    const ed = decodeURIComponent(s).match(/[?&]edition=(?:key:)?\/?books\/(OL\d+M)/i);
    return ed ? { kind: 'work', id: m[1].toUpperCase(), edition: ed[1].toUpperCase() } : { kind: 'work', id: m[1].toUpperCase() };
  }
  m = s.match(/openlibrary\.org\/books\/(OL\d+M)/i);
  if (m) return { kind: 'edition', id: m[1].toUpperCase() };
  m = s.match(/openlibrary\.org\/isbn\/([\dXx-]{10,17})/i);
  if (m) return { kind: 'isbn', id: m[1].replace(/-/g, '').toUpperCase() };
  return null;
}

/**
 * A pasted Open Library link → that book, as one search result. Reads the work (and the edition, for an edition
 * or ISBN link, which gives the page count, ISBN, publisher and that edition's cover) straight from Open Library,
 * without going through its search, which is the part that fails now and then.
 */
async function openLibraryFromUrl(ref, env) {
  const get = (path) => fetchJson(`https://openlibrary.org${path}.json`, { headers: { 'user-agent': userAgent(env) }, redirect: 'follow' }, 'Open Library');
  let edition = null, workId = ref.kind === 'work' ? ref.id : '';
  if (ref.kind !== 'work') {
    edition = await get(ref.kind === 'isbn' ? `/isbn/${ref.id}` : `/books/${ref.id}`);
    workId = String(edition?.works?.[0]?.key || '').replace('/works/', '');
  } else if (ref.edition) {
    edition = await get(`/books/${ref.edition}`).catch(() => null);
  }
  const work = workId ? await get(`/works/${workId}`) : {};
  const authorKeys = (work.authors || []).map((a) => a?.author?.key || a?.key).filter(Boolean).slice(0, 3);
  if (!authorKeys.length) authorKeys.push(...(edition?.authors || []).map((a) => a?.key).filter(Boolean).slice(0, 3));
  const authors = (await Promise.allSettled(authorKeys.map((k) => get(k)))).map((r) => (r.status === 'fulfilled' ? r.value?.name : '')).filter(Boolean);
  let coverId = [...(edition?.covers || []), ...(work.covers || [])].find((c) => Number(c) > 0);
  // Many works have no cover of their own; their editions do. Use the first edition that has one.
  if (!coverId && workId) {
    const eds = await get(`/works/${workId}/editions`).catch(() => null);
    coverId = (eds?.entries || []).flatMap((e) => e.covers || []).find((c) => Number(c) > 0);
  }
  const title = edition?.title || work.title || '';
  const subtitle = edition?.subtitle || work.subtitle || '';
  const desc = [work.description, edition?.description].map((d) => (typeof d === 'string' ? d : d?.value || '')).find(Boolean) || '';
  if (!title) throw new HttpError(404, 'No book found at that Open Library link.');
  const isbn = edition?.isbn_13?.[0] || edition?.isbn_10?.[0] || undefined;
  // No cover anywhere on Open Library (its page shows a placeholder): borrow Google Books' cover of the same book.
  let cover = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '';
  if (!cover) {
    const q = isbn ? `isbn:${isbn}` : `intitle:${title}${authors[0] ? ` inauthor:${authors[0]}` : ''}`;
    cover = (await searchGoogleBooks(q, env).catch(() => [])).find((r) => r.cover)?.cover || '';
  }
  return result({
    type: 'book',
    source: 'openlibrary',
    sourceId: workId || ref.id,
    title: subtitle ? `${title}: ${subtitle}` : title,
    creator: authors.join(', '),
    year: yearOf(work.first_publish_date || edition?.publish_date),
    cover,
    description: truncate(desc.replace(/\r/g, '').replace(/\(\[source\][^)]*\)/g, '')),
    genres: (work.subjects || []).slice(0, 4),
    details: {
      pages: edition?.number_of_pages || undefined,
      isbn,
      publisher: edition?.publishers?.[0] || undefined,
    },
    url: workId ? `https://openlibrary.org/works/${workId}` : `https://openlibrary.org/books/${ref.id}`,
  });
}

async function searchBooks(q, env) {
  // A pasted Open Library link goes straight to that book.
  const ref = openLibraryRefFromUrl(q);
  if (ref) {
    try {
      return [await openLibraryFromUrl(ref, env)];
    } catch (err) {
      if (/\(404\)/.test(err?.message || '') || err?.status === 404) throw new HttpError(404, 'No book found at that Open Library link.');
      throw new HttpError(502, 'Open Library is busy, try again in a few moments.');
    }
  }
  const [ol, gb] = await Promise.allSettled([searchOpenLibrary(q, env), searchGoogleBooks(q, env)]);
  const out = [...(ol.status === 'fulfilled' ? ol.value : []), ...(gb.status === 'fulfilled' ? gb.value : [])];
  if (!out.length && ol.status === 'rejected' && gb.status === 'rejected') {
    // Open Library's API fails now and then even while its website works; a retry a moment later usually does it.
    // No Google Books key: Google turns away most keyless requests, and a key gives book search a backup.
    const gbStatus = Number(String(gb.reason?.message || '').match(/\((\d{3})\)/)?.[1]) || 0;
    const hint = !env.GOOGLE_BOOKS_KEY && (gbStatus === 429 || gbStatus === 403)
      ? ' A free Google Books key (Manage → Settings → API keys) gives book search a backup.'
      : '';
    throw new HttpError(502, `Open Library is busy, try again in a few moments.${hint}`);
  }
  return out;
}

// ───────────────────────── Movies & TV: TMDB ─────────────────────────

function tmdb(env, path, params = {}) {
  if (!env.TMDB_TOKEN) throw new HttpError(400, 'No TMDB token yet. Add it in Manage → Settings → API keys.');
  const usp = new URLSearchParams(params);
  const headers = { accept: 'application/json' };
  // Accept either the long "API Read Access Token" (Bearer) or the short v3 API key.
  if (env.TMDB_TOKEN.length > 40) headers.authorization = `Bearer ${env.TMDB_TOKEN}`;
  else usp.set('api_key', env.TMDB_TOKEN);
  return fetchJson(`https://api.themoviedb.org/3${path}?${usp}`, { headers }, 'TMDB');
}

const tmdbImg = (p) => (p ? `https://image.tmdb.org/t/p/w780${p}` : '');

async function searchTmdb(type, q, env) {
  const kind = type === 'tv' ? 'tv' : 'movie';
  const data = await tmdb(env, `/search/${kind}`, { query: q, include_adult: 'false' });
  return (data.results || []).slice(0, 12).map((r) => result({
    type,
    source: 'tmdb',
    sourceId: r.id,
    title: kind === 'tv' ? r.name : r.title,
    year: yearOf(kind === 'tv' ? r.first_air_date : r.release_date),
    cover: tmdbImg(r.poster_path),
    description: truncate(r.overview),
    url: `https://www.themoviedb.org/${kind}/${r.id}`,
  }));
}

async function tmdbDetails(type, id, env) {
  const kind = type === 'tv' ? 'tv' : 'movie';
  const d = await tmdb(env, `/${kind}/${encodeURIComponent(id)}`, { append_to_response: 'credits' });
  const cast = (d.credits?.cast || []).slice(0, 5).map((c) => c.name);
  if (kind === 'movie') {
    const directors = (d.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
    return {
      creator: directors.join(', '),
      genres: (d.genres || []).map((g) => g.name),
      description: truncate(d.overview),
      details: { runtime: d.runtime || undefined, cast },
    };
  }
  return {
    creator: (d.created_by || []).map((c) => c.name).join(', '),
    genres: (d.genres || []).map((g) => g.name),
    description: truncate(d.overview),
    details: {
      seasons: d.number_of_seasons || undefined,
      episodes: d.number_of_episodes || undefined,
      network: d.networks?.[0]?.name,
      cast,
    },
  };
}

// ───────────────────────── Music: Spotify (fallback: MusicBrainz) ─────────────────────────

let spotifyToken = null; // { token, exp, who } — cached per isolate, for the keys it was made with

async function getSpotifyToken(env) {
  const who = `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`;
  if (spotifyToken && spotifyToken.who === who && spotifyToken.exp > Date.now() + 30_000) return spotifyToken.token;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new HttpError(502, `Spotify auth failed (${res.status})`);
  const data = await res.json();
  spotifyToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000, who };
  return spotifyToken.token;
}

const spotifyArtists = (list) => (list || []).map((x) => x.name).join(', ');
const spotifyKind = (albumType) => (albumType === 'single' ? 'Single' : albumType === 'compilation' ? 'Compilation' : 'Album');

const spotifyAlbum = (a) => result({
  type: 'music',
  source: 'spotify',
  sourceId: `album:${a.id}`,
  title: a.name,
  creator: spotifyArtists(a.artists),
  year: yearOf(a.release_date),
  cover: a.images?.[0]?.url || '',
  genres: a.genres || [],
  details: { kind: spotifyKind(a.album_type), tracks: a.total_tracks },
  url: a.external_urls?.spotify || `https://open.spotify.com/album/${a.id}`,
});

const spotifyTrack = (t) => result({
  type: 'music',
  source: 'spotify',
  sourceId: `track:${t.id}`,
  title: t.name,
  creator: spotifyArtists(t.artists),
  year: yearOf(t.album?.release_date),
  cover: t.album?.images?.[0]?.url || '',
  description: t.album?.name ? `From ${t.album.name}` : '',
  details: { kind: 'Song' },
  url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
});

// Playlists: Spotify only sends a playlist's tracks to its owner, so we keep its details, cover and link.
// (Feb 2026 renamed `tracks` to `items`; read either.)
const spotifyPlaylist = (p) => {
  const total = p.items?.total ?? p.tracks?.total;
  return result({
    type: 'music',
    source: 'spotify',
    sourceId: `playlist:${p.id}`,
    title: p.name,
    creator: p.owner?.display_name || p.owner?.id || '',
    cover: p.images?.[0]?.url || '',
    description: truncate(stripHtml(decodeEntities(p.description || ''))),
    details: { kind: 'Playlist', ...(total ? { tracks: total } : {}) },
    url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`,
  });
};

/**
 * A Spotify link or URI → { kind, id }, else null. Handles open.spotify.com/album/…, /intl-xx/track/…,
 * /playlist/… (with or without ?si=…) and spotify:album:… URIs.
 */
export function spotifyRefFromUrl(input) {
  const s = String(input || '').trim();
  const m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(album|track|playlist)\/([A-Za-z0-9]{10,})/i)
    || s.match(/^spotify:(album|track|playlist):([A-Za-z0-9]{10,})$/i);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}

const SPOTIFY_SHORT = /^https?:\/\/(spotify\.link|spoti\.fi)\//i;

/** Look up one album, song or playlist from a pasted Spotify link. */
async function spotifyFromUrl(input, env) {
  let ref = spotifyRefFromUrl(input);
  if (!ref && SPOTIFY_SHORT.test(input.trim())) {
    // Share-sheet short links redirect to the open.spotify.com address.
    try {
      const res = await fetch(input.trim(), { redirect: 'follow', headers: { 'user-agent': userAgent(env) } });
      ref = spotifyRefFromUrl(res.url) || spotifyRefFromUrl(await res.text());
    } catch { /* fall through */ }
  }
  if (!ref) throw new HttpError(400, 'That doesn’t look like a Spotify album, song or playlist link.');
  if (!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET)) throw new HttpError(400, 'Spotify links need your Spotify Client ID and Secret (Manage → Settings → API keys). Search by name instead.');
  const token = await getSpotifyToken(env);
  const path = { album: 'albums', track: 'tracks', playlist: 'playlists' }[ref.kind];
  const res = await fetch(`https://api.spotify.com/v1/${path}/${ref.id}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 400) throw new HttpError(404, `No ${ref.kind === 'track' ? 'song' : ref.kind} found at that Spotify link${ref.kind === 'playlist' ? ' (is the playlist public?)' : ''}.`);
  if (!res.ok) throw new HttpError(502, `Spotify lookup failed (${res.status})`);
  const data = await res.json();
  return [ref.kind === 'album' ? spotifyAlbum(data) : ref.kind === 'track' ? spotifyTrack(data) : spotifyPlaylist(data)];
}

async function searchSpotify(q, env) {
  const token = await getSpotifyToken(env);
  // Development Mode caps `limit` at 10 (Feb 2026 change). The limit is per type.
  const data = await fetchJson(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=album,track,playlist&limit=10`,
    { headers: { authorization: `Bearer ${token}` } },
    'Spotify',
  );
  const albums = (data.albums?.items || []).filter(Boolean).map(spotifyAlbum);
  const tracks = (data.tracks?.items || []).filter(Boolean).map(spotifyTrack);
  // Spotify's search sometimes returns null entries for playlists; skip them. Playlists go last.
  const playlists = (data.playlists?.items || []).filter((p) => p && p.id).slice(0, 5).map(spotifyPlaylist);
  return [...albums, ...tracks, ...playlists];
}

async function searchMusicBrainz(q, env) {
  const data = await fetchJson(
    `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=12`,
    { headers: { 'user-agent': userAgent(env), accept: 'application/json' } },
    'MusicBrainz',
  );
  return (data['release-groups'] || []).map((rg) => result({
    type: 'music',
    source: 'musicbrainz',
    sourceId: rg.id,
    title: rg.title,
    creator: (rg['artist-credit'] || []).map((a) => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('').trim(),
    year: yearOf(rg['first-release-date']),
    cover: `https://coverartarchive.org/release-group/${rg.id}/front-500`,
    details: { kind: (rg['secondary-types'] || []).includes('Compilation') && (rg['primary-type'] || 'Album') === 'Album' ? 'Compilation' : (rg['primary-type'] || 'Album') },
    url: `https://musicbrainz.org/release-group/${rg.id}`,
  }));
}

async function searchMusic(q, env) {
  // A pasted Spotify link goes straight to that album, song or playlist.
  if (spotifyRefFromUrl(q) || SPOTIFY_SHORT.test(String(q).trim())) return spotifyFromUrl(String(q), env);
  if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) {
    try {
      return await searchSpotify(q, env);
    } catch (err) {
      console.warn('Spotify failed, falling back to MusicBrainz:', err.message);
    }
  }
  return searchMusicBrainz(q, env);
}

// ───────────────────────── Video games: IGDB (via Twitch) ─────────────────────────

let twitchToken = null;

async function getTwitchToken(env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new HttpError(400, 'Video game search needs your Twitch Client ID and Secret. Add them in Manage → Settings → API keys.');
  }
  const who = `${env.TWITCH_CLIENT_ID}:${env.TWITCH_CLIENT_SECRET}`; // new keys saved in Settings → new token
  if (twitchToken && twitchToken.who === who && twitchToken.exp > Date.now() + 60_000) return twitchToken.token;
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(env.TWITCH_CLIENT_ID)}&client_secret=${encodeURIComponent(env.TWITCH_CLIENT_SECRET)}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  if (!res.ok) throw new HttpError(502, `Twitch auth failed (${res.status})`);
  const data = await res.json();
  twitchToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000, who };
  return twitchToken.token;
}

const IGDB_POOL = 50;   // candidates fetched from IGDB
const IGDB_RESULTS = 26; // results shown after re-ranking

// IGDB game_type ids → how much we trust it as "the real game".
const IGDB_TYPE_WEIGHT = {
  0: 2,    // main game
  8: 2,    // remake
  9: 1.5,  // remaster
  10: 1.5, // expanded game
  4: 1.5,  // standalone expansion
  2: 1,    // expansion
  11: 1,   // port
  3: 0.5,  // bundle
  1: 0,    // DLC
  6: 0, 7: 0, 13: 0, 14: -0.5, // episode, season, pack, update
  5: -3,   // mod
  12: -2,  // fork
};
const FAN_WORDS = /\b(randomi[sz]er|rom ?hack|hack|redux|mod|fan ?game|demake|unreal engine|crossover|online|2d)\b/i;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Higher = better. Exported for tests. */
export function igdbScore(game, q) {
  const name = norm(game.name);
  const query = norm(q);
  // Compare against the full name and against the part after a series prefix ("The Legend of Zelda: Ocarina of Time").
  const parts = [name, ...String(game.name || '').split(/[:\-–—]/).slice(1).map(norm)].filter(Boolean);
  let title = 0;
  if (parts.some((p) => p === query)) title = 3;
  else if (name.startsWith(query) || parts.some((p) => p.startsWith(query))) title = 2;
  else if (name.includes(query)) title = 1;

  const typeId = game.game_type ?? game.category;
  let type = typeId in IGDB_TYPE_WEIGHT ? IGDB_TYPE_WEIGHT[typeId] : 0;
  // Unofficial stuff that isn't tagged as a mod still tends to say so in its name.
  if (type >= 0 && FAN_WORDS.test(game.name) && !FAN_WORDS.test(q)) type -= 2;

  const popularity = Math.log10(1 + (game.total_rating_count || 0) + (game.hypes || 0) + (game.follows || 0));
  const cover = game.cover?.image_id ? 0 : -2;
  return title * 2 + type * 1.5 + popularity + cover;
}

async function igdbQuery(env, token, body) {
  return fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'client-id': env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'text/plain' },
    body,
  });
}

async function searchIgdb(q, env) {
  const token = await getTwitchToken(env);
  const safe = q.replace(/["\\]/g, ' ');
  const base = 'name,first_release_date,cover.image_id,summary,genres.name,platforms.abbreviation,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,url,total_rating_count,hypes';
  let res = await igdbQuery(env, token, `search "${safe}"; fields ${base},game_type; limit ${IGDB_POOL};`);
  // If IGDB ever rejects the game_type field, retry without it rather than failing the search.
  if (res.status === 400) res = await igdbQuery(env, token, `search "${safe}"; fields ${base}; limit ${IGDB_POOL};`);
  if (!res.ok) throw new HttpError(502, `IGDB failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const games = (await res.json())
    .map((g, i) => ({ g, i, s: igdbScore(g, q) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, IGDB_RESULTS)
    .map(({ g }) => g);
  return games.map((g) => {
    const companies = g.involved_companies || [];
    const developers = companies.filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean);
    const publishers = companies.filter((c) => c.publisher).map((c) => c.company?.name).filter(Boolean);
    return result({
      type: 'videogame',
      source: 'igdb',
      sourceId: g.id,
      title: g.name,
      creator: developers.slice(0, 2).join(', '),
      year: g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : '',
      cover: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : '',
      description: truncate(g.summary),
      genres: (g.genres || []).map((x) => x.name),
      details: {
        platforms: (g.platforms || []).map((p) => p.abbreviation || p.name).filter(Boolean),
        publishers: publishers.slice(0, 3),
      },
      url: g.url || '',
    });
  });
}

// ───────────────────────── Board games: BoardGameGeek XML API2 ─────────────────────────

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decodeEntities(m[2])]));

export function parseBggSearch(xml) {
  return [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)].map(([, a, inner]) => {
    const name = inner.match(/<name\b[^>]*\/?>/);
    const year = inner.match(/<yearpublished\b[^>]*\/?>/);
    return {
      id: attrs(a).id,
      kind: attrs(a).type || 'boardgame',
      name: name ? attrs(name[0]).value : '',
      year: year ? attrs(year[0]).value : '',
    };
  });
}

/** A BoardGameGeek link (or "bgg:123" / bare id) → the game's id, else null. */
export function bggIdFromUrl(input) {
  const s = String(input || '').trim();
  const m = s.match(/boardgamegeek\.com\/(?:boardgame|boardgameexpansion|boardgameaccessory|thing)\/(\d+)/i)
    || s.match(/^(?:bgg:)?(\d{1,7})$/i);
  return m ? m[1] : null;
}

/**
 * Rank BGG search hits. BGG lists expansions under type=boardgame too (often twice, once
 * tagged boardgameexpansion), and returns them in its own order, so a popular base game with
 * lots of add-ons ("Dungeon Degenerates: Hand of Doom") could fall past the cut. Base games first,
 * then how well the name matches. Exported for tests.
 */
export function rankBggHits(hits, q) {
  const query = norm(q);
  const expansions = new Set(hits.filter((h) => h.kind === 'boardgameexpansion').map((h) => h.id));
  const titleScore = (name) => {
    const n = norm(name);
    const parts = [n, ...String(name || '').split(/[:\-–—]/).slice(1).map(norm)].filter(Boolean);
    if (parts.some((p) => p === query)) return 0;
    if (parts.some((p) => p.startsWith(query))) return 1;
    if (n.includes(query)) return 2;
    return 3;
  };
  const best = new Map(); // id → best-scoring hit (primary or alternate name)
  hits.forEach((h, i) => {
    const s = { ...h, i, exp: expansions.has(h.id) ? 1 : 0, t: titleScore(h.name) };
    const prev = best.get(h.id);
    if (!prev || s.t < prev.t) best.set(h.id, prev ? { ...s, i: prev.i } : s);
  });
  return [...best.values()].sort((a, b) => a.exp - b.exp || a.t - b.t || a.i - b.i);
}

export function parseBggThings(xml) {
  return [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)].map(([, a, inner]) => {
    const tags = (name) => [...inner.matchAll(new RegExp(`<${name}\\b[^>]*\\/?>`, 'g'))].map((m) => attrs(m[0]));
    const val = (name) => tags(name)[0]?.value || '';
    const text = (name) => decodeEntities((inner.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`)) || [])[1] || '').trim();
    const names = tags('name');
    const links = tags('link');
    const linkVals = (t) => links.filter((l) => l.type === t).map((l) => l.value);
    const rank = tags('rank').find((r) => r.name === 'boardgame')?.value;
    const minP = val('minplayers'), maxP = val('maxplayers');
    const weight = parseFloat(val('averageweight'));
    const poll = parseBggPlayerPoll(inner);
    const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : undefined; };
    return {
      id: attrs(a).id,
      kind: attrs(a).type || 'boardgame',
      // On a base game, these links are its expansions (on an expansion, inbound="true" links point to the base game).
      expansionLinks: links.filter((l) => l.type === 'boardgameexpansion' && l.inbound !== 'true').map((l) => ({ id: l.id, title: l.value })),
      title: (names.find((n) => n.type === 'primary') || names[0] || {}).value || '',
      year: val('yearpublished'),
      image: text('image'),
      thumbnail: text('thumbnail'),
      description: text('description'),
      players: minP && maxP ? (minP === maxP ? minP : `${minP}–${maxP}`) : '',
      playtime: val('playingtime'),
      designers: linkVals('boardgamedesigner'),
      publishers: linkVals('boardgamepublisher'),
      categories: linkVals('boardgamecategory'),
      mechanics: linkVals('boardgamemechanic'),
      weight: Number.isFinite(weight) && weight > 0 ? Math.round(weight * 100) / 100 : undefined,
      rank: rank && rank !== 'Not Ranked' ? rank : '',
      minPlayers: num(minP),
      maxPlayers: num(maxP),
      minPlaytime: num(val('minplaytime')),
      maxPlaytime: num(val('maxplaytime')),
      minAge: num(val('minage')),
      bestPlayers: poll.best,
      recPlayers: poll.recommended,
    };
  });
}

/**
 * Community "suggested number of players" poll → which counts are Best / Recommended.
 * Best: "Best" got the most votes. Recommended: Best + Recommended outvote Not Recommended.
 */
export function parseBggPlayerPoll(inner) {
  const pollXml = (inner.match(/<poll\b[^>]*name="suggested_numplayers"[^>]*>([\s\S]*?)<\/poll>/) || [])[1];
  const best = [], recommended = [];
  if (!pollXml) return { best, recommended };
  for (const [, n, body] of pollXml.matchAll(/<results\b[^>]*numplayers="(\d+)"[^>]*>([\s\S]*?)<\/results>/g)) {
    const votes = (v) => parseInt((body.match(new RegExp(`value="${v}"[^>]*numvotes="(\\d+)"`)) || [])[1] || '0', 10);
    const b = votes('Best'), r = votes('Recommended'), no = votes('Not Recommended');
    if (b + r + no === 0) continue;
    if (b > 0 && b >= r && b >= no) best.push(Number(n));
    if (b + r > no) recommended.push(Number(n));
  }
  return { best, recommended };
}

/** Everything we save about a board game, from a parsed BGG "thing". */
export function bggDetails(t) {
  return {
    players: t.players || undefined,
    minPlayers: t.minPlayers,
    maxPlayers: t.maxPlayers,
    bestPlayers: t.bestPlayers?.length ? t.bestPlayers : undefined,
    recPlayers: t.recPlayers?.length ? t.recPlayers : undefined,
    playtime: t.playtime && t.playtime !== '0' ? Number(t.playtime) : undefined,
    minPlaytime: t.minPlaytime,
    maxPlaytime: t.maxPlaytime,
    minAge: t.minAge,
    weight: t.weight,
    bggRank: t.rank || undefined,
    mechanics: t.mechanics?.length ? t.mechanics : undefined,
    designers: (t.designers || []).filter((d) => d !== '(Uncredited)'),
    publishers: (t.publishers || []).slice(0, 2),
  };
}

async function bgg(env, path) {
  const headers = { 'user-agent': userAgent(env) };
  if (env.BGG_TOKEN) headers.authorization = `Bearer ${env.BGG_TOKEN}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://boardgamegeek.com/xmlapi2/${path}`, { headers });
    if (res.status === 202) { await new Promise((r) => setTimeout(r, 1200)); continue; } // queued
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, 'BoardGameGeek refused the request. Add your BGG token in Manage → Settings → API keys (register an app at boardgamegeek.com/applications).');
    }
    if (!res.ok) throw new HttpError(502, `BoardGameGeek failed (${res.status})`);
    return res.text();
  }
  throw new HttpError(504, 'BoardGameGeek is busy — try again in a moment.');
}

/** BGG things → search results, in the order given. */
async function bggResults(env, hits) {
  if (!hits.length) return [];
  const byId = Object.fromEntries((await bggThings(env, hits.map((h) => h.id))).map((t) => [t.id, t]));
  return hits.filter((h) => byId[h.id] || h.name).map((h) => {
    const t = byId[h.id] || {};
    const isExp = t.kind === 'boardgameexpansion';
    return result({
      type: 'boardgame',
      source: 'bgg',
      sourceId: h.id,
      title: t.title || h.name,
      creator: (t.designers || []).filter((d) => d !== '(Uncredited)').slice(0, 3).join(', '),
      year: t.year || h.year,
      cover: t.image || t.thumbnail || '',
      description: truncate(t.description),
      genres: t.categories || [],
      details: { ...bggDetails(t), ...(isExp ? { kind: 'Expansion' } : {}) },
      url: `https://boardgamegeek.com/${isExp ? 'boardgameexpansion' : 'boardgame'}/${h.id}`,
    });
  });
}

async function searchBgg(q, env) {
  // A pasted BGG link goes straight to that game.
  const id = bggIdFromUrl(q);
  if (id && /boardgamegeek|^bgg:/i.test(q)) {
    const res = await bggResults(env, [{ id }]);
    if (!res.length) throw new HttpError(404, 'No game found at that BoardGameGeek link.');
    return res;
  }
  const hits = parseBggSearch(await bgg(env, `search?query=${encodeURIComponent(q)}&type=boardgame`));
  return bggResults(env, rankBggHits(hits, q).slice(0, 15));
}

// ───────────────────────── YouTube: videos and channels ─────────────────────────
// No key needed to paste links: videos come from YouTube's public oEmbed, channels from the public info on the
// channel's own page. Search by name (and video lengths, subscriber counts) needs the YouTube Data API v3, which
// uses YOUTUBE_API_KEY, or else your GOOGLE_BOOKS_KEY if YouTube is switched on in that Google Cloud project.

/** A YouTube link → { kind: 'video', id } | { kind: 'channel', id? , handle?, user? }, else null. */
export function youtubeRefFromUrl(input) {
  const s = String(input || '').trim();
  let m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/i);
  if (m) return { kind: 'video', id: m[1] };
  m = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/i);
  if (m) return { kind: 'channel', id: m[1] };
  m = s.match(/youtube\.com\/@([A-Za-z0-9._-]{2,100})/i) || s.match(/^@([A-Za-z0-9._-]{2,100})$/);
  if (m) return { kind: 'channel', handle: m[1] };
  m = s.match(/youtube\.com\/(?:c|user)\/([A-Za-z0-9._-]{2,100})/i);
  if (m) return { kind: 'channel', user: m[1] };
  return null;
}

/** "PT1H2M10S" → minutes (rounded, at least 1). */
export function isoMinutes(d) {
  const m = String(d || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  const mins = (Number(m[1] || 0) * 1440) + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return mins > 0 ? Math.max(1, Math.round(mins)) : undefined;
}

const ytKey = (env) => env.YOUTUBE_API_KEY || env.GOOGLE_BOOKS_KEY || '';

/** YouTube Data API call. Throws NO_YT_API when there's no key, or the key isn't allowed to use YouTube. */
const NO_YT_API = 'no-youtube-api';
async function youtube(env, path, params) {
  const key = ytKey(env);
  if (!key) throw Object.assign(new HttpError(400, 'No YouTube key'), { code: NO_YT_API });
  const usp = new URLSearchParams({ ...params, key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${usp}`);
  // 403: the Google Cloud project behind the key doesn't have YouTube Data API v3 switched on (common when it's
  // the Books key). 400 with a bad key looks the same to us. Either way, behave as if there's no key.
  if (res.status === 403 || res.status === 400) throw Object.assign(new HttpError(400, 'YouTube API not enabled for this key'), { code: NO_YT_API });
  if (!res.ok) throw new HttpError(502, `YouTube failed (${res.status})`);
  return res.json();
}
const noApi = (err) => err?.code === NO_YT_API;

const metaTag = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i'));
  return m ? decodeEntities(m[1]) : '';
};

/** A channel without a key: the name, picture and description its own page shares (for link previews). */
async function youtubeChannelPage(ref, env) {
  const path = ref.id ? `channel/${ref.id}` : ref.handle ? `@${ref.handle}` : `user/${ref.user}`;
  let html = '';
  try {
    const res = await fetch(`https://www.youtube.com/${path}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; MyShelf)', 'accept-language': 'en-US,en;q=0.8', cookie: 'CONSENT=YES+1' },
    });
    if (res.status === 404) throw new HttpError(404, 'No channel found at that YouTube link.');
    if (!res.ok) throw new HttpError(502, `YouTube answered ${res.status}`);
    html = await res.text();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'Couldn’t reach YouTube. Try again in a moment.');
  }
  const title = metaTag(html, 'og:title');
  if (!title) throw new HttpError(502, 'YouTube didn’t share that channel’s details. Try again, or add it manually.');
  const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/) || html.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/) || [])[1] || ref.id || '';
  const handle = (html.match(/"canonicalBaseUrl":"\/(@[\w.-]+)"/) || [])[1] || (ref.handle ? `@${ref.handle}` : '');
  return result({
    type: 'video', source: 'youtube', sourceId: `channel:${id || handle || path}`,
    title, creator: handle,
    cover: metaTag(html, 'og:image'),
    description: truncate(metaTag(html, 'og:description')),
    details: { kind: 'Channel', handle: handle || undefined },
    url: handle ? `https://www.youtube.com/${handle}` : id ? `https://www.youtube.com/channel/${id}` : `https://www.youtube.com/${path}`,
  });
}

// The biggest picture YouTube has without black bars: maxres, else the 320×180 "mq" one (hq/sd are letterboxed 4:3).
const ytThumbs = (t = {}) => (t.maxres || t.standard?.width / t.standard?.height > 1.5 && t.standard || t.medium || t.high || t.default || {}).url || '';

const ytVideo = (v) => result({
  type: 'video',
  source: 'youtube',
  sourceId: `video:${v.id}`,
  title: decodeEntities(v.snippet?.title || ''),
  creator: decodeEntities(v.snippet?.channelTitle || ''),
  year: yearOf(v.snippet?.publishedAt),
  cover: ytThumbs(v.snippet?.thumbnails),
  description: truncate(v.snippet?.description || ''),
  details: { kind: 'Video', runtime: isoMinutes(v.contentDetails?.duration), channel: decodeEntities(v.snippet?.channelTitle || '') || undefined },
  url: `https://www.youtube.com/watch?v=${v.id}`,
});

const ytChannel = (c) => result({
  type: 'video',
  source: 'youtube',
  sourceId: `channel:${c.id}`,
  title: decodeEntities(c.snippet?.title || ''),
  creator: c.snippet?.customUrl || '',
  year: yearOf(c.snippet?.publishedAt),
  cover: (c.snippet?.thumbnails?.high || c.snippet?.thumbnails?.medium || c.snippet?.thumbnails?.default || {}).url || '',
  description: truncate(c.snippet?.description || ''),
  details: {
    kind: 'Channel',
    handle: c.snippet?.customUrl || undefined,
    subscribers: c.statistics?.hiddenSubscriberCount ? undefined : Number(c.statistics?.subscriberCount) || undefined,
    videos: Number(c.statistics?.videoCount) || undefined,
  },
  url: c.snippet?.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${c.id}`,
});

async function youtubeVideos(env, ids) {
  if (!ids.length) return [];
  const data = await youtube(env, 'videos', { part: 'snippet,contentDetails', id: ids.join(','), maxResults: '50' });
  const byId = new Map((data.items || []).map((v) => [v.id, v]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map(ytVideo);
}

async function youtubeChannels(env, params) {
  const data = await youtube(env, 'channels', { part: 'snippet,statistics', ...params });
  return (data.items || []).map(ytChannel);
}

/** A video without an API key: YouTube's public oEmbed (title, channel and thumbnail). */
async function youtubeOembed(id, env) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: { 'user-agent': userAgent(env) } });
  if (res.status === 404 || res.status === 400 || res.status === 401) throw new HttpError(404, 'No public video found at that YouTube link.');
  if (!res.ok) throw new HttpError(502, `YouTube lookup failed (${res.status})`);
  const o = await res.json();
  // maxresdefault exists for most HD videos; otherwise the 16:9 "mq" thumbnail.
  let cover = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  try { if (!(await fetch(cover, { method: 'HEAD' })).ok) cover = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; } catch { cover = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; }
  return result({
    type: 'video', source: 'youtube', sourceId: `video:${id}`,
    title: o.title || '', creator: o.author_name || '', cover,
    details: { kind: 'Video', channel: o.author_name || undefined },
    url,
  });
}

async function youtubeFromUrl(input, env) {
  const ref = youtubeRefFromUrl(input);
  if (!ref) throw new HttpError(400, 'That doesn’t look like a YouTube video or channel link.');
  // With the API: fuller details. Without it (or if the key can't use YouTube): the public info, no key needed.
  if (ref.kind === 'video') {
    try {
      const res = await youtubeVideos(env, [ref.id]);
      if (res.length) return res;
      throw new HttpError(404, 'No public video found at that YouTube link.');
    } catch (err) {
      if (!noApi(err)) throw err;
      return [await youtubeOembed(ref.id, env)];
    }
  }
  try {
    const params = ref.id ? { id: ref.id } : ref.handle ? { forHandle: `@${ref.handle}` } : { forUsername: ref.user };
    const res = await youtubeChannels(env, params);
    if (res.length) return res;
  } catch (err) {
    if (!noApi(err)) throw err;
  }
  return [await youtubeChannelPage(ref, env)];
}

async function searchYoutube(q, env) {
  if (youtubeRefFromUrl(q)) return youtubeFromUrl(q, env);
  let data;
  try {
    data = await youtube(env, 'search', { part: 'snippet', q, type: 'video,channel', maxResults: '15', safeSearch: 'none' });
  } catch (err) {
    if (!noApi(err)) throw err;
    throw new HttpError(400, 'To search YouTube by name, switch on “YouTube Data API v3” in the Google Cloud project for your Google Books key (or add a YOUTUBE_API_KEY). Pasting a video or channel link below works without it.');
  }
  const items = data.items || [];
  const videoIds = items.filter((i) => i.id?.kind === 'youtube#video').map((i) => i.id.videoId);
  const channelIds = items.filter((i) => i.id?.kind === 'youtube#channel').map((i) => i.id.channelId);
  // Search results are thin (no length, no subscriber count): fetch the full records, then keep YouTube's order.
  const [videos, channels] = await Promise.all([
    youtubeVideos(env, videoIds),
    channelIds.length ? youtubeChannels(env, { id: channelIds.join(',') }) : [],
  ]);
  const byKey = new Map([...videos, ...channels].map((r) => [r.sourceId, r]));
  return items.map((i) => byKey.get(i.id?.kind === 'youtube#video' ? `video:${i.id.videoId}` : `channel:${i.id?.channelId}`)).filter(Boolean);
}

// ───────────────────────── Public API ─────────────────────────

export async function search(type, q, env) {
  switch (type) {
    case 'book': return searchBooks(q, env);
    case 'movie':
    case 'tv': return searchTmdb(type, q, env);
    case 'music': return searchMusic(q, env);
    case 'videogame': return searchIgdb(q, env);
    case 'boardgame': return searchBgg(q, env);
    case 'video': return searchYoutube(q, env);
    default: throw new HttpError(400, `Unknown type: ${type}`);
  }
}

/** Extra info fetched only when you pick a result (keeps search fast). */
export async function details(type, source, id, env) {
  if (source === 'tmdb') return tmdbDetails(type, id, env);
  if (source === 'openlibrary') return openLibraryDetails(id, env);
  if (source === 'bgg') {
    const [t] = await bggThings(env, [id]);
    if (!t) throw new HttpError(404, 'Game not found on BoardGameGeek');
    return { genres: t.categories, details: bggDetails(t), creator: (t.designers || []).filter((d) => d !== '(Uncredited)').slice(0, 3).join(', ') };
  }
  return {};
}

/** A BGG thing → what we keep for an attached expansion. */
function expansionOf(t, fallback = {}) {
  const id = String(t?.id || fallback.id || '');
  return {
    id,
    title: t?.title || fallback.title || '',
    year: t?.year || '',
    cover: t?.thumbnail || t?.image || '',
    url: id ? `https://boardgamegeek.com/boardgameexpansion/${id}` : '',
  };
}

/** Search BGG for expansions only. */
export async function searchBggExpansions(q, env) {
  const hits = parseBggSearch(await bgg(env, `search?query=${encodeURIComponent(q)}&type=boardgameexpansion`));
  const ql = q.trim().toLowerCase();
  const score = (h) => (h.name.toLowerCase() === ql ? 0 : h.name.toLowerCase().includes(ql) ? 1 : 2);
  const seen = new Set();
  const top = hits
    .map((h, i) => ({ ...h, i }))
    .sort((a, b) => score(a) - score(b) || a.i - b.i)
    .filter((h) => !seen.has(h.id) && seen.add(h.id))
    .slice(0, 15);
  if (!top.length) return [];
  const byId = Object.fromEntries((await bggThings(env, top.map((h) => h.id))).map((t) => [t.id, t]));
  return top.map((h) => ({ ...expansionOf(byId[h.id], { id: h.id, title: h.name }), year: byId[h.id]?.year || h.year || '' }));
}

/** Every expansion BGG lists for a base game (newest first, up to 60). */
export async function bggExpansionsFor(env, baseId) {
  const [base] = await bggThings(env, [baseId]);
  if (!base) throw new HttpError(404, 'Game not found on BoardGameGeek');
  const links = base.expansionLinks.slice(0, 60);
  const byId = links.length ? Object.fromEntries((await bggThings(env, links.map((l) => l.id))).map((t) => [t.id, t])) : {};
  return links
    .map((l) => expansionOf(byId[l.id], l))
    .sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0) || a.title.localeCompare(b.title));
}

/** Fetch up to 20 games per request from BGG (with stats). */
export async function bggThings(env, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    out.push(...parseBggThings(await bgg(env, `thing?id=${ids.slice(i, i + 20).join(',')}&stats=1`)));
  }
  return out;
}

/** Find the most likely BGG id for a title (+ optional year). */
export async function bggFind(env, title, year) {
  const hits = parseBggSearch(await bgg(env, `search?query=${encodeURIComponent(title)}&type=boardgame`));
  if (!hits.length) return null;
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = norm(title);
  const score = (h) => (norm(h.name) === t ? 4 : norm(h.name).startsWith(t) ? 2 : 0) + (year && String(h.year) === String(year) ? 3 : 0);
  return hits.map((h, i) => ({ ...h, s: score(h) - i * 0.01 })).sort((a, b) => b.s - a.s)[0];
}

export function configured(env) {
  return {
    books: true,
    googleBooks: Boolean(env.GOOGLE_BOOKS_KEY),
    tmdb: Boolean(env.TMDB_TOKEN),
    spotify: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
    igdb: Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET),
    bgg: Boolean(env.BGG_TOKEN),
    youtube: Boolean(ytKey(env)),
  };
}
