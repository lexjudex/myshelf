// A shared, database-independent key for "the same thing" across MyShelf sites:
//   "<type>:<source>:<id>", e.g. "boardgame:bgg:266192" or "movie:tmdb:693134".
// Two friends who both added Wingspan from BoardGameGeek get the same key, so their shelves can be compared,
// and a recommendation can say "you already have this".

const SOURCE_KEYS = {
  'open library': 'openlibrary', openlibrary: 'openlibrary',
  'google books': 'googlebooks', googlebooks: 'googlebooks',
  tmdb: 'tmdb',
  spotify: 'spotify',
  musicbrainz: 'musicbrainz',
  igdb: 'igdb',
  boardgamegeek: 'bgg', bgg: 'bgg',
  youtube: 'youtube',
};

export function extKeyOf(item) {
  const src = item?.source || {};
  const key = SOURCE_KEYS[String(src.name || '').trim().toLowerCase()];
  const id = src.id == null ? '' : String(src.id).trim();
  if (!key || !id || !item?.type) return null;
  return `${item.type}:${key}:${id}`.slice(0, 200);
}

export const VISIBILITY = ['public', 'friends', 'private'];
export const visibilityOf = (item) => (VISIBILITY.includes(item?.visibility) ? item.visibility : 'public');
