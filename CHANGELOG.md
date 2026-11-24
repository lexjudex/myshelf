# Changelog

The version number lives in `package.json` and shows in **Manage → Settings → Updates**. Bump it with each release.

## 0.5.1 (Nov 2026)

- **YouTube without a new key.** Pasting a channel link now works with no key at all (video links already did). Searching YouTube by name uses your existing Google Books key once **YouTube Data API v3** is switched on in that Google Cloud project (one click); `YOUTUBE_API_KEY` is only needed to use a separate key. The "Missing keys" note no longer mentions YouTube.
- **Edit shelves right on the page.** Signed in, the Shelves page and every media page have an **Edit shelves** button. Drag whole shelves into a new order (or use ↑ ↓), take a shelf off the page (✕; nothing is deleted), and **＋ Add a shelf**: put back one you took off, add a starter shelf, or make a new empty one. Press **Save shelves** and the page shows it. Media pages keep their own order (Books can differ from Movies); collections still appear on every media page, so adding or removing one there changes them all. Collections can now also be shown **Nowhere**, kept but hidden (Manage → Collections → Show on).
- Fixed: the "paste a link" box (YouTube, Spotify, BoardGameGeek) was too narrow to see the link. The YouTube search box now says "Search YouTube…".

## 0.5.0 (Nov 2026)

- **YouTube.** A new media type for videos and channels. Search needs a free YouTube key (`YOUTUBE_API_KEY`); without one, paste a video link under the search. Videos stand on the shelf as cute little grey computers (rounded case, chunky stand, a tiny light in your accent colour) and play right on their item page; channels get a square one with their avatar. Existing sites get YouTube turned on; switch it off in Settings if you don't want it.
- **Journal search, sort and filters.** Search titles, creators and notes, filter by type and status, and sort by **Last edited** (the default), date, rating or title. Notes now remember when they were last changed.
- **@mention friends.** Type `@` in your notes or in a comment and pick a friend (typing `@name` by hand works too). It becomes a link to their MyShelf, and they get a note in their inbox. Friends need this version to receive mention notes.
- **Recommend from anywhere.** A **Recommend to a friend** button on your item pages (when you're signed in), a paper plane on each item in a shelf's arrange dialog, and **Recommend** on friends' shelves and the Friends feed to pass something along to another friend (they're credited: "from Dillon's shelf").
- **Friends' takes before you add.** Search results and the editor show which friends already have something, with their rating and notes.
- **Light mode and accent colours.** Manage → Settings → **Look** sets your site to light or dark and picks the accent colour (eight presets or any colour). Visitors can still flip light/dark for themselves.
- **Display switches moved.** **Shelf effects** and **Light mode** switches are now at the bottom of every page and at the bottom of the phone bubble menu (no longer in Settings).
- Fixed: the phone bubble menu button was hard to see on light pages (item pages, journal cards). It's now solid enough to read anywhere.
- Fixed: the "Missing keys" note in Manage no longer lists keys for media types you've turned off (no BGG nag without board games).

## 0.4.1 (Nov 2026)

- **Bigger home page shelves.** Each collection on the home page now shows up to 24 items (was 12). A collection with more than that ends with a **+N more** card that opens the full collection, so nothing goes missing without a sign.

## 0.4.0 (Nov 2026)

- **Spotify playlists.** Music search now finds public playlists too, alongside albums and songs. A playlist is saved with its cover, description, owner and a **View on Spotify** link (Spotify only shares a playlist's track list with its owner).
- **Paste a Spotify link.** Under the Music search, paste an album, song or playlist link (Share → Copy link in Spotify) to add exactly that one. Pasting it into the search box works too.
- **Vinyl on the shelf.** Albums, compilations and playlists now stand as record sleeves, taller than a CD. Singles and songs stay CDs. Albums already on your shelf switch over automatically.
- **Nicknames for friends.** In Manage → Friends, give any friend a nickname. Only you see it, when you're signed in: it replaces their name in your inbox, friends list, groups, comments and the Friends page. Visitors still see their own name.
- **Starter shelves.** Manage → Collections has ready-made shelves to tick: **Currently** (in progress), **Recently Finished** (finished in the last year) and **Favorites** (rated 5 stars). A brand-new site offers them the first time you sign in. Collections can now also fill themselves by rating.

## 0.3.7 (Nov 2026)

- Fixed: in the decorations preview, the shelf's edge drew on top of decorations that overlap it. They now always draw in front of the bookcase, as on the live page.

## 0.3.6 (Nov 2026)

- **Up / down for shelf decorations.** A new slider raises a decoration above the shelf (0 = standing on it), next to **Left / right**. Dragging in the preview moves it both ways (a sideways drag stays level), and the up/down arrow keys nudge it 1px at a time, or 10px with Shift. Phones get their own up/down too.

## 0.3.5 (Nov 2026)

- **The decorations preview is your real Shelves page.** Settings shows your actual home page in a small window, at desktop width or at your phone's width, with your changes drawn live. It can't differ from what visitors see, on any phone or browser. Drag and arrow-key nudges work right in it.

## 0.3.4 (Nov 2026)

- **Manage in the phone menu.** The bubble menu now has Manage under Journal, so you don't have to scroll to the footer.
- Fixed: shelf decorations could sit off-center or get extra space inside their frame on iPhones (Safari, which every iPhone browser uses, sized them differently from the Settings preview). Each decoration now gets an exact width from its image's proportions, so every browser draws it the same. The decoration area also can't make a phone page wider than the screen.

## 0.3.3 (Nov 2026)

- **Separate phone layout for shelf decorations.** Switch the Settings preview to **Phone**, and the sliders edit phones only: position, size, tilt, turn, and **Show on phones**. Until you change something there, phones follow desktop at about two-thirds size. **Match desktop again** undoes it. Frame and Mirror are shared.
- Fixed: decorations no longer shrink as they get close to the right edge.

## 0.3.2 (Nov 2026)

- **Turn** for shelf decorations: angle one on the shelf in 3D, the way you'd set a frame at an angle instead of head-on. Framed pictures shade the side turning away. **Tilt** (leaning flat) is still there, and the two can be combined. New JPGs start framed and turned slightly.
- **Accurate preview.** The Settings preview is now a real-size copy of the top of your bookcase, using the Shelves page's own styles, shrunk to fit. A **Desktop / Phone** switch shows both layouts.

## 0.3.1 (Nov 2026)

- **Exact placement for shelf decorations.** Drag each decoration along the shelf in the Settings preview, or nudge it with the arrow keys (hold Shift for bigger steps). Position, size and tilt are now sliders with exact number fields, so things line up precisely. There's also a **Center it** button. Older decorations keep where they were.
- **Tilt.** Lean any decoration left or right, up to 20°. It pivots on its bottom corner, so it still rests on the shelf. JPGs start in a frame leaning slightly.
- Decorations near an edge no longer hang off the screen on phones.

## 0.3.0 (Nov 2026)

- **Comments on friends' entries.** A public thread under each entry on the Friends page and on the item's own page. You can reply on your own items and delete any comment there; friends can delete their own comments. New comments show up in your inbox.
- **Thread notifications.** When someone adds to a thread, everyone who commented there before gets an inbox note ("Dillon also commented on their Dune") with a link back to the thread.
- **Inbox controls.** Each notification has a ✕ to delete just that one. There's also **Mark all read**, which also clears requests you haven't answered yet. Other notifications are marked read when you see them, as before.
- **Friends' notes on the Friends page.** Entries now show what your friend wrote (long notes fold up; click to read the rest).
- **Inbox on the Friends page.** Signed in, your inbox sits at the top with all its buttons. You can hide it.
- **Friend groups.** Private groups in Manage → Friends. They filter the Friends page and fill in the Recommend dialog.
- **Browse a friend's shelf on the Friends page.** Click a friend under *Their shelves*. Signed in, you see their friends-only items, hearts and *Ask to borrow*. In Manage, *View shelf* now opens their site.
- **Shelf decorations.** In Settings, add up to three images (a teddy bear, a mini figure, a photo…) that stand on top of the bookcase on the main Shelves page. Use transparent PNGs, or put any image in a picture frame (wood, black, gold or white); JPGs start out framed. Pick a spot, a size, and whether to mirror each one. Decorations are included in backups.
- **Edit from the arrange dialog.** A pencil on each item opens the editor without leaving the page.
- "Lately" on the Friends page is now **What Your Friends Are Up To**.
- **Version numbers.** Settings shows the version you're running and the version available. `/.well-known/myshelf` includes it too.

Friends on older copies can still be friends with you. They need to update before they can get comments or thread notifications (MyShelf tells you when that's the reason).

## 0.2.0

Hearts, updates from Settings, friends and federation, D1 storage.
