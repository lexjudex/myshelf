import { json, route, HttpError } from '../../../server/util.js';
import * as fed from '../../../server/federation/index.js';

// GET  /api/friends            → { me, friends, inbox, unread }
// GET  /api/friends?shelf=<id> → that friend's shelf (including their friends-only items)
// GET  /api/friends?hearts=1   → { hearts: [{ friendUrl, uid }] } (friends' items you've hearted)
// POST /api/friends { action, ... } → add | accept | decline | block | remove | recommend | borrow | reply | heart | mark | mark-all-read | delete-message | clear-inbox
//   | comment (on a friend's item) | uncomment (take yours back) | comment-own (reply on your item) | delete-comment (on your item)
//   | groups ({ groups: [{ id, name, members: [friendUrl] }] })
export const GET = route(async ({ env, url }) => {
  const shelf = url.searchParams.get('shelf');
  if (url.searchParams.has('hearts')) return json({ hearts: await fed.heartsSent(env) });
  return json(shelf ? await fed.friendShelf(env, url.href, shelf) : await fed.overview(env, url.href));
});

export const POST = route(async ({ request, env, url }) => {
  const b = await request.json();
  const at = url.href;
  switch (b.action) {
    case 'add': return json(await fed.addFriend(env, at, b.url, b.note));
    case 'accept': return json(await fed.acceptFriend(env, at, b.id));
    case 'decline': return json(await fed.declineFriend(env, b.id));
    case 'block': return json(await fed.blockFriend(env, b.id));
    case 'remove': return json(await fed.removeFriend(env, at, b.id));
    case 'recommend': return json(await fed.recommend(env, at, b));
    case 'borrow': return json(await fed.askToBorrow(env, at, b));
    case 'reply': return json(await fed.replyToBorrow(env, at, b));
    case 'heart': return json(await fed.heart(env, at, b));
    case 'mark': return json(await fed.markMessage(env, b.id, b.status));
    case 'mark-all-read': return json(await fed.markAllRead(env));
    case 'delete-message': return json(await fed.deleteMessage(env, b.id));
    case 'clear-inbox': return json(await fed.clearInbox(env));
    case 'comment': return json(await fed.commentOnFriend(env, at, b));
    case 'uncomment': return json(await fed.deleteFriendComment(env, at, b));
    case 'comment-own': return json(await fed.commentOwn(env, at, b));
    case 'delete-comment': return json(await fed.deleteComment(env, b.id));
    case 'groups': return json(await fed.saveGroups(env, b.groups));
    default: throw new HttpError(400, 'Unknown action');
  }
});
