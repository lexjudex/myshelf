# Changelog

The version number lives in `package.json` and shows in **Manage → Settings → Updates**. Bump it with each release.

## 0.3.0 (Nov 2026)

- **Comments on friends' entries.** A public thread under each entry on the Friends page and on the item's own page. You can reply on your own items and delete any comment there; friends can delete their own comments. New comments show up in your inbox.
- **Thread notifications.** When someone adds to a thread, everyone who commented there before gets an inbox note ("Dillon also commented on their Dune") with a link back to the thread.
- **Inbox controls.** Each notification has a dot to mark it read or unread and a ✕ to delete just that one. There's also **Mark all read**. Notifications now stay unread until you mark them; they're no longer marked read just by opening the inbox.
- **Friends' notes on the Friends page.** Entries now show what your friend wrote (long notes fold up; click to read the rest).
- **Inbox on the Friends page.** Signed in, your inbox sits at the top with all its buttons. You can hide it.
- **Friend groups.** Private groups in Manage → Friends. They filter the Friends page and fill in the Recommend dialog.
- **Browse a friend's shelf on the Friends page.** Click a friend under *Their shelves*. Signed in, you see their friends-only items, hearts and *Ask to borrow*. In Manage, *View shelf* now opens their site.
- **Edit from the arrange dialog.** A pencil on each item opens the editor without leaving the page.
- "Lately" on the Friends page is now **What Your Friends Are Up To**.
- **Version numbers.** Settings shows the version you're running and the version available. `/.well-known/myshelf` includes it too.

Friends on older copies can still be friends with you. They need to update before they can get comments or thread notifications (MyShelf tells you when that's the reason).

## 0.2.0

Hearts, updates from Settings, friends and federation, D1 storage.
