# Changelog

The version number lives in `package.json` and shows in **Manage → Settings → Updates**. Bump it with each release.

## 0.9.2 (Nov 2026)

- **Fixed: "Error 1102: Worker exceeded resource limits."** Building a page with a big library takes more computing time than Cloudflare's free plan allows each visit, so busy moments failed with Error 1102. Finished pages are now kept and reused, so most visits don't build anything. Every change you make clears them, so pages are never out of date, and they're rebuilt every few hours anyway.
- **Making the shelf copies of covers is much lighter.** In 0.9.1 the Manage page sent each copy in a form that took too long for the Worker to unpack, which could trip the same error. Copies that failed get made the next time Manage is open.
- **Friendlier book search error.** When book search can't get an answer, it now says *"Open Library is busy, try again in a few moments"* instead of a bare error code (Open Library's search fails now and then even while its website works). Without a Google Books key it also suggests adding one, as a backup.
- **"Missing keys" mentions Google Books (optional).** It's free, and it keeps book search working when Open Library is down.

## 0.9.1 (Nov 2026)

- **Fixed: iPhones crashing on the shelves.** On iPhone (Safari, DuckDuckGo and every other iPhone browser) the Shelves page could crash with *"A problem repeatedly occurred"*. The shelves were loading every cover at full size, which is more memory than iPhones allow a page. They now use small copies of the covers, and look the same. Item pages still show the full-size cover.
- **After updating, open Manage once on a computer** and leave it open for a minute or two. It makes the small copies for the covers you already have, in the background. Until an item has its copies, its spine shows a plain colour. New covers get their copies the next time Manage is open.
- Shelves far down the page are now drawn when you scroll near them, so long pages load faster.

## 0.9.0 (Nov 2026)

- **Choose which decoration is in front.** In **Settings → Shelf decorations**, drag the ⠿ handle (or use ↑ ↓) to reorder them. Where they overlap, the top of the list stands in front, and each one is labelled *In front*, *Middle* or *At the back*. Heads-up: until now the *last* one stood in front, so if yours overlap, check the order once.
- **Update banner in Manage.** When a newer MyShelf is out, a banner at the top of Manage says so. **What's new** shows the changelog for everything since your version, and **Update** jumps to Settings → Updates. Hide it with ✕ and it comes back for the next version.
- **Announcements.** The MyShelf project can post short notes to everyone running MyShelf, shown in the same place (for example, "an important fix is out, please update"). Each can be dismissed.
- **Changelog links.** **Settings → Updates** shows what's in the version you're on, with a link to the full changelog.

## 0.8.0 (Nov 2026)

- **Your name in the top bar.** The home link at the top now reads *MyShelf | Your name*. The big heading on the Shelves page says **Featured Shelves** instead of repeating it. Change the heading in **Manage → Settings → Shelves page heading**.
- **"Update available."** When a newer MyShelf is out, a small pill appears next to your name in the top bar. Only you see it, in a browser where you're signed in to Manage. It opens **Settings → Updates**. The check needs no GitHub token: it reads the version number from the original project on GitHub every few hours, so it works for every copy.
- Manage now shows your site's name in the top bar too (it used to say MyShelf there).

## 0.7.2 (Nov 2026)

- **Simpler setup guide.** The README is now a numbered walkthrough with direct links to every page you need: forking, Cloudflare's import and Worker settings, GitHub's token page, and each API key's sign-up page (TMDB, Twitch, BoardGameGeek, Spotify, Google). Setting your admin password and making a GitHub token are now main steps instead of extras. The developer details are tucked away at the bottom.
- **GitHub token first in Settings → API keys**, marked *recommended*, since it's what lets **Update now** work.

## 0.7.1 (Nov 2026)

- **The Recently Finished ✕ moved into the shelf's edit screen.** It's no longer on the covers. Open the shelf's ✎ (Arrange), press the red ✕ on anything you want off it (↺ keeps it), then **Save changes**. Its finished date moves back past the shelf's time window, as before.

## 0.7.0 (Nov 2026)

- **Tidier editor.** The add/edit form only shows fields that fit the media and status: no rating or start date on *Want to*, a finished date only on *Finished*, **Lent to** and **Lent since** only once you tick **I own a copy**, and no "own a copy" for YouTube. Hidden fields aren't saved, so nothing stale is left behind.
- **Progress bars.** Books (page X of Y), TV shows (episode X of Y) and legacy or campaign board games (X of Y games, chapters, months, scenarios or missions) show a **Progress** box while you're in the middle of them. The total fills in from the page or episode count. Board games ticked **Legacy or campaign game** (BGG's *Legacy Game* mechanic ticks it for you) get campaign progress. The progress shows as a thin bar along the bottom of the cover on your shelves, and as a bar with "Page 212 of 412 · 51%" on the item page.
- **✕ on Recently Finished.** Signed in, the cover facing out on a Recently Finished shelf (any automatic *Finished* collection with a time window) has a ✕. It moves the finished date to just past the shelf's window (a year and a day ago on the starter shelf), so the item drops off. **Undo** puts the old date back.
- Fixed: **Refresh from BGG** showed in the editor for things that aren't board games.
- Fixed: dates filled in for you (Started, Finished, Lent since, Date added, the ✕ above, backup file names) used UTC, so in the evening across the Americas they came out a day late. They now use your own time zone.

## 0.6.0 (Nov 2026)

- **API keys in Settings.** Paste your TMDB, Twitch (IGDB), BoardGameGeek, Spotify, Google Books, YouTube and GitHub keys (and contact email) in **Manage → Settings → API keys**. No more Cloudflare dashboard. Each service has a **Test** button, and saving runs the test for you. Keys are stored encrypted (the encryption key is made automatically and kept in your KV storage, so a database copy alone doesn't give them away). The page only ever shows their last four characters. They're never shared with friends or put in backups.
- **Worker secrets still work.** If a key is saved in Settings it's used first; otherwise the Worker secret with the same name is. **Remove** goes back to the secret. Existing sites don't need to change anything.
- The **Missing keys** note in the Manage header is now a link to Settings → API keys, and error messages about missing keys point there too.

## 0.5.9 (Nov 2026)

- **＋ on the Journal.** Signed in, a ＋ sits next to the Journal's title. It opens **Manage → Add**.

## 0.5.8 (Nov 2026)

- **Hidden shelves stay in Edit shelves.** On a media page, a shelf you hide (a status shelf like *Reading* or *Read*, or a collection) stays in the editor's list, dimmed and marked "Hidden on this page", with a **Show** button to bring it back. The ✕ is now a **Hide** button. All four status shelves are always listed, even empty ones, so you can arrange or hide them before anything's on them.

## 0.5.7 (Nov 2026)

- **YouTube plaques get a nameplate.** Under the picture, a small engraved platinum plate shows the video's or channel's title (up to two lines).

## 0.5.6 (Nov 2026)

- **Each media page has its own shelves.** In **Edit shelves** (the ✎ by a media page's title), ✕ on a collection now hides it on that page only; the other media pages keep it. Hidden collections are listed under **＋ Add a shelf → Put back or add** ("Hidden on this page"). A collection that wasn't on any media page, or a new shelf you make there, shows up on that page only, and you can put it on others the same way.

## 0.5.5 (Nov 2026)

- **Fix: the ＋ by a media page's title** said "That collection was not found" instead of opening Manage → Add. The pencil next to it (Edit shelves) was caught by the same mix-up and works again too.
- **Media page titles** now go Title → ✎ Edit shelves → ＋ Add → copy link.
- **Bubble menu** ends Journal → Friends → Manage.
- **YouTube items are award plaques** instead of little monitors: a black framed board with a platinum play emblem on top and the video's picture (or the channel's, square) below it.

## 0.5.4 (Nov 2026)

- **Size slider.** Collection pages, media pages and "see all" pages have a **Size** slider between Sort and Filters. Slide it to make the items smaller (more per row) or bigger. Rows re-pack to fit. It's remembered in your browser; **Reset** puts it back.

## 0.5.3 (Nov 2026)

- **Add a friend's item to your shelf.** On the Friends page, signed in, each entry in *What Your Friends Are Up To* has a **＋** button, and items on a friend's shelf have **Add to my shelf**. It opens your editor already filled in (title, creator, year, cover, and the same database link they used, so it shows as "You have this" for both of you). Pick a status, write your notes, save. Things you already have don't show the button.
- A recommendation's **Add it** now opens the editor filled in too, instead of a search.
- The phone bubble menu has a thin divider between the media pages and Friends / Journal / Manage.
- **＋ next to each media page's title.** Signed in, a ＋ sits between the title and the copy-link icon on Books, Movies, Board Games and the rest. It opens Manage → Add with that kind of media already picked. On media pages, **Edit shelves** is now a small pencil after the copy-link icon.

## 0.5.2 (Nov 2026)

- **One open item per row.** On pages where a shelf wraps onto several rows (every collection page and every "see all" page, for all media), each row now has its own front-facing item, and each row slides on its own. Turning something on one row no longer flips back the item on the row above. Rows also leave room for their open item, so they slide less.
- **Sort on every shelf page.** Collection pages, media pages and "see all" pages have a **Sort** menu at the top of the filter bar: Shelf order, Newest, Oldest, Title, Creator, Highest rated, or Release year. It's in the address bar too, so a sorted view can be shared. The **Shelf effects** switch lives next to it (and still in the footer).
- **Bubble menu is just the menu again.** The Shelf effects and Light mode switches are gone from it. Light mode is in the footer and in **Manage → Settings → Look** ("Light mode on this browser").
- Turning Shelf effects on or off now redraws the page, so it takes effect right away.

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
