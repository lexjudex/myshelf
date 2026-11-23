// Shared media-type config. Keep keys in sync with functions/api/_lib/types.js.
export const TYPES = {
  book:      { label: 'Book',       plural: 'Books',       creator: 'Author',    verb: 'Read',    doing: 'Reading',   want: 'Want to read',   dropped: "Didn't finish",  aspect: 2 / 3, color: '#8a3b2e' },
  movie:     { label: 'Movie',      plural: 'Movies',      creator: 'Director',  verb: 'Watched', doing: 'Watching',  want: 'Want to watch',  dropped: 'Stopped watching', aspect: 2 / 3, color: '#2e4a6b' },
  tv:        { label: 'TV Show',    plural: 'TV Shows',    creator: 'Creator',   verb: 'Watched', doing: 'Watching',  want: 'Want to watch',  dropped: 'Stopped watching', aspect: 2 / 3, color: '#4b3b6b' },
  music:     { label: 'Music',      plural: 'Music',       creator: 'Artist',    verb: 'Listened',doing: 'On repeat', want: 'Want to listen', dropped: 'Not for me',  aspect: 1,     color: '#2f5e4e' },
  videogame: { label: 'Video Game', plural: 'Video Games', creator: 'Developer', verb: 'Played',  doing: 'Playing',   want: 'Want to play',   dropped: 'Gave up',  aspect: 3 / 4, color: '#6b4b1f' },
  boardgame: { label: 'Board Game', plural: 'Board Games', creator: 'Designer',  verb: 'Played',  doing: 'Playing',   want: 'Want to play',   dropped: 'Not for me',  aspect: 1,     color: '#5e2f45' },
};

export const TYPE_KEYS = Object.keys(TYPES);

export const STATUS_LABEL = (type, status) => {
  const t = TYPES[type] || TYPES.book;
  return { want: t.want, 'in-progress': t.doing, finished: t.verb, abandoned: t.dropped || 'Abandoned' }[status] || status;
};

// Readable labels for the `details` object.
export const DETAIL_LABELS = {
  pages: 'Pages', isbn: 'ISBN', publisher: 'Publisher',
  runtime: 'Runtime', seasons: 'Seasons', episodes: 'Episodes', network: 'Network',
  tracks: 'Tracks', kind: 'Format', label: 'Label',
  platforms: 'Platforms', developers: 'Developers', publishers: 'Publishers',
  players: 'Players', bestPlayers: 'Best with', playtime: 'Play time', minAge: 'Age', weight: 'Complexity', bggRank: 'BGG rank',
  mechanics: 'Mechanics', designers: 'Designers',
  cast: 'Cast',
};

// Internal values used for filtering; not shown as their own rows on item pages.
export const HIDDEN_DETAILS = new Set(['minPlayers', 'maxPlayers', 'recPlayers', 'minPlaytime', 'maxPlaytime']);

export function complexityLabel(w) {
  const n = parseFloat(w);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n < 2 ? 'Light' : n <= 3 ? 'Medium' : 'Heavy';
}

export function formatDetail(key, value, details = {}) {
  if (value == null || value === '') return '';
  if (key === 'weight') { const n = parseFloat(value); return Number.isFinite(n) ? `${complexityLabel(n)} (${n.toFixed(2)} / 5)` : String(value); }
  if (key === 'bestPlayers') return (Array.isArray(value) ? value : [value]).join(', ') + ' players';
  if (key === 'minAge') return `${value}+`;
  if (key === 'playtime' && details.minPlaytime && details.maxPlaytime && details.minPlaytime !== details.maxPlaytime) return `${details.minPlaytime}–${details.maxPlaytime} min`;
  if (Array.isArray(value)) return value.join(', ');
  if (key === 'runtime') return `${value} min`;
  if (key === 'playtime') return `${value} min`;
  return String(value);
}

export function stars(rating) {
  if (rating == null) return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '');
}

// Music drawn as a vinyl record sleeve instead of a CD case: albums, compilations and playlists
// (from Spotify or MusicBrainz). Singles, songs, EPs and anything without a kind stay CDs.
export const VINYL_KINDS = new Set(['album', 'compilation', 'playlist']);
export const isVinyl = (item) => item?.type === 'music' && VINYL_KINDS.has(String(item.details?.kind || '').trim().toLowerCase());
