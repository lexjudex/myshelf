import { json, route } from '../../../server/util.js';
import { publicFriendShelf } from '../../../server/federation/index.js';

// GET /friends/shelf.json?friend=<their site address> → that friend's PUBLIC shelf, for the shelf viewer on the
// public Friends page. Only answers for your accepted friends (so it can't be used to fetch other sites).
// Signed in? The page asks /api/friends?shelf=<id> instead, which includes their friends-only items.
export const GET = route(async ({ env, url }) => json(await publicFriendShelf(env, url.searchParams.get('friend') || '')));
