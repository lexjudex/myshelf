# MyShelf

A self-hosted media journal and virtual bookshelf for books, movies, TV, music, video games and board games. Search a database, pick the match, and the cover and details import automatically. Write your thoughts, sort things into collections, and they appear on your shelves. Connect with friends who run their own MyShelf to share recommendations and lend each other things.

**Cost: $0.** Everything runs on Cloudflare's free plan (one Worker, a D1 database and KV storage, no credit card needed). Your copy of the code lives in a free GitHub account. Everyone runs their own copy, so your shelf and your data stay in your own accounts.

If MyShelf is useful to you, you can support its development on Ko-fi:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/K0A32B3009)

## How it works

```
You (admin page) ──► /api/* on your Worker (holds your API keys)
                        ├─► searches Open Library / Google Books / TMDB / Spotify / IGDB / BGG
                        └─► saves the entry to D1 and the cover image to KV
Visitors ──► pages render straight from D1, so every change is live immediately
Friends' MyShelf sites ◄──► /federation/v1/* (signed messages; see "Friends" below)
```

- **Your entries** (details, notes, collections, shelf orders, friends, inbox) live in your **Cloudflare D1** database. The tables create and upgrade themselves.
- **Cover images** live in **Cloudflare KV** and are served from `/img/…`.
- **Site name, tagline and your name** are set in **Manage → Settings**, along with **shelf decorations**: up to three transparent PNGs (a framed photo, a teddy bear, a mini figure) that stand on top of the bookcase on your main Shelves page.
- **Backups:** Manage → Settings → **Download backup** saves everything as one JSON file. Do this now and then.

## Set up your own MyShelf (about 20–40 minutes, mostly collecting free API keys)

You need a free [GitHub](https://github.com/signup) account and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. There are two ways to set up. Both end in the same place.

### Option A: fork (recommended, easiest to keep up to date)

1. On GitHub, click **Fork** on this repository.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, then pick your fork. Leave the build command as `npm run build` and the deploy command as `npx wrangler deploy`.
3. Deploy. The first deploy creates the D1 database and KV namespace listed in `wrangler.jsonc` on your account.
4. Open your Worker → **Settings → Variables and Secrets** → add `ADMIN_TOKEN` as a **Secret**.

With a fork, GitHub's **Sync fork** button pulls in new versions, and Cloudflare redeploys automatically.

### Option B: one-click (quickest)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lexjudex/myshelf)
1. Click **Deploy to Cloudflare** above and sign in to Cloudflare and GitHub when asked.
2. Cloudflare copies MyShelf into a new repository on your GitHub account and creates your database and cover storage.
3. It asks for your secrets. Only **`ADMIN_TOKEN`** is required: make up a long random password and keep it somewhere safe. Leave the API keys blank for now if you don't have them yet.
4. Click **Deploy**. In a minute or two your site is live at `https://myshelf.<your-subdomain>.workers.dev`.

Option B's copy isn't linked to this repository, so getting updates later takes a couple of git commands (see [Getting updates](#getting-updates)).


### Then, for both options

1. Go to `https://<your-site>/admin/` and enter your `ADMIN_TOKEN`.
2. Open **Settings** and set your site name and your name.
3. Add API keys as you get them (next section). The admin header lists any that are still missing.

### Free API keys

Add each one in your Worker → **Settings → Variables and Secrets** → **Add** → type **Secret**, then save and deploy. No rebuild is needed.

| Source | Where | Secret name(s) |
|---|---|---|
| **TMDB** (movies, TV) | themoviedb.org → Settings → API → request a personal key. Copy the **API Read Access Token** (the long one). | `TMDB_TOKEN` |
| **IGDB** (video games) | dev.twitch.tv/console → Register Your Application (redirect URL `http://localhost`, client type Confidential). Your Twitch account needs 2FA turned on. | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| **BoardGameGeek** | boardgamegeek.com/applications → register a non-commercial app → create a token. Approval can take a while. | `BGG_TOKEN` |
| **Spotify** (music, optional) | developer.spotify.com/dashboard → Create app → check **Web API** → redirect URI `http://127.0.0.1:8788/callback` (required, but unused). | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |
| Open Library | No key needed. | |
| Google Books | Optional. Works without a key at low volume. | `GOOGLE_BOOKS_KEY` |
| Contact email | Optional. Sent to Open Library and MusicBrainz, as they request. | `CONTACT_EMAIL` |
| GitHub (updates, optional) | Forks only. github.com/settings/personal-access-tokens → **Generate new token** → *Only select repositories*: your fork → **Repository permissions → Contents: Read and write**. Lets **Manage → Settings → Updates** pull in new versions for you. | `GITHUB_TOKEN` |

Without Spotify, or if it ever fails, music search uses **MusicBrainz + Cover Art Archive** automatically.

## Using it

- **＋ Add:** pick a type, search, click a result, adjust the details, write your notes, and save.
- **Library:** edit, delete, or **Recommend** anything to friends.
- **Collections:** create, rename, reorder and remove shelves.
- **Friends:** your address to share, friend requests, your inbox, and your friends' shelves.
- **Settings:** site name, your name, public address, which kinds of media your site shows, backup and restore. (The shelf effects switch is under the Manage card, for anyone.)
- Every item page has a small **Edit** link that goes straight to the editor.

In the editor, **Who can see it** sets each item to *Everyone*, *Friends only*, or *Only me*. Only *Everyone* items appear on your public pages. **I own a copy** lets friends ask to borrow it, and **Lent to** tracks who has it.

## Friends

Friends are other people running their own MyShelf. There's no central server: your site and theirs talk to each other directly.

1. Send a friend your address (shown in **Manage → Friends**).
2. They paste it into **Add friend**. You get a request in your inbox and click **Accept**.
3. Now you can:
   - see each other's *Friends only* items (**View shelf**), with "You have this" next to anything you both own,
   - **Recommend** something from your Library; it lands in their inbox with an **Add it** button,
   - **Ask to borrow** anything they've marked *I own a copy*. Saying yes marks it as lent on their shelf.
   - tap the **heart** on any of their items to say you enjoyed it too. They get a note in their inbox; tap again to take it back. (Your friend needs a copy of MyShelf with hearts, so ask them to update if it says otherwise.)

**Friends page:** `/friends/` on your site (in the menu) shows *What Your Friends Are Up To*: your friends' latest public entries with their notes, plus their shelves. Click a friend to browse their shelf right there (**Visit their site** opens it). Visitors only see public items. When you're signed in to Manage on that browser, the page also shows you (and only you):
- your **Inbox** at the top, with the same Accept / Lend / Add it buttons as Manage,
- a heart button on each entry ("I enjoyed this too"),
- comment boxes,
- your **groups** as a filter,
- friends' *Friends only* items when you open their shelf.

**Comments:** friends can comment on each other's entries. A comment is stored on the site of the person whose entry it is. Anyone who can see the entry can read it, on the Friends page and on the item's own page. You can reply on your item's page and delete any comment on your items. Friends can delete their own comments. When someone adds to a thread, everyone who commented there before gets an inbox note.

**Inbox:** notifications are marked read when you see them (requests stay unread until you answer). Each one has a ✕ to delete it, and **Mark all read** and **Clear inbox** handle everything at once.

**Groups:** in **Manage → Friends → Groups**, sort friends into groups (like "Board game night"). Groups are private. They filter your Friends page, and in the Recommend dialog one click picks everyone in a group.

**What friends can see:** your public items, your *Friends only* items, whether you own them, and whether they're available to borrow. They never see *Only me* items or who you've lent things to. Removing a friend tells their site to remove you too.

**Custom domain?** Set **Settings → Public address** so friends always reach you at the same address.

**How it works under the hood:** each site has its own Ed25519 key, made automatically and stored in your database. Sites describe themselves at `/.well-known/myshelf`, accept signed messages at `/federation/v1/inbox`, and serve a shelf feed at `/federation/v1/shelf`. Friends-only items are included only when the request is signed by a friend. Every item has a permanent `uid` and a shared `ext_key` (like `boardgame:bgg:266192`), so two shelves can tell when they hold the same thing. The protocol is described in `server/federation/protocol.js`.

## Getting updates

- **Forked (Option A):** in **Manage → Settings → Updates**, click **Update now** (needs the optional `GITHUB_TOKEN` secret, and **Source code link** set to your fork). Or on GitHub, open your fork and click **Sync fork → Update branch**. Either way, Cloudflare redeploys automatically.
- **One-click (Option B):** run this once on your computer:
  ```bash
  git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git && cd YOUR-REPO
  git remote add upstream https://github.com/lexjudex/myshelf.git
  ```
  Then whenever you want the latest version: `git pull upstream main && git push`.

Database changes in new versions apply themselves on the next page load. **Manage → Settings → Updates** shows which version you're running (the number from `package.json`, plus the commit it was built from) and which version is available. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## Optional: make the site private

By default your public items are visible to anyone with the URL, but only you can add or edit. To hide everything, use **Cloudflare Zero Trust → Access → Applications → Add → Self-hosted**: enter your site's domain and add a policy that allows only your email. It's free for up to 50 users. To protect only the admin page, use the path `admin*` (the `/api` is already locked by your token).

If you lock the whole site, add **Bypass** policies for `/.well-known/myshelf` and `/federation/*` so friends' sites can still reach yours.

## Free-tier limits worth knowing

- Workers free: 100,000 requests a day. D1 free: 5 GB storage, 5 million rows read a day. KV free: 1 GB, 100,000 reads and 1,000 writes a day. A personal shelf won't come close.
- Spotify Development Mode requires Premium and caps search at 10 results per type.
- Attribution for TMDB and BGG is in the site footer, as their terms require. Leave it in.

## Local development

```bash
npm install
npm test             # offline tests for the API layer and the friends protocol
cp .dev.vars.example .dev.vars   # then fill in ADMIN_TOKEN (and any keys)
npm run preview      # builds, then serves with wrangler dev at http://localhost:8787
```

Local data lives in `.wrangler/` and never touches your live database. To try friends features locally, run two copies on different ports with separate data folders, for example `npx wrangler dev --port 8801 --persist-to .wrangler/a` and `npx wrangler dev --port 8802 --persist-to .wrangler/b`, and add `http://localhost:8802` as a friend from the first.

## Item format

Each item is stored as JSON in D1 (and that's what **Download backup** gives you):
```json
{
  "slug": "book-dune-1965",
  "uid": "6f1c2d1e-8a3b-4c5d-9e7f-0a1b2c3d4e5f",
  "item": {
    "title": "Dune", "type": "book", "creator": "Frank Herbert", "year": "1965",
    "cover": "/img/book-dune-1965-m1a2b3.jpg", "coverAspect": 0.6667,
    "status": "finished", "rating": 4.5,
    "dateStarted": "2026-10-01", "dateFinished": "2026-10-28",
    "collections": ["favorites", "2026"], "tags": ["sci-fi"], "genres": ["Science fiction"],
    "details": { "pages": 612 },
    "visibility": "friends", "owned": true, "lentTo": "Sam", "lentSince": "2026-11-01",
    "source": { "name": "Open Library", "id": "OL893415W", "url": "https://openlibrary.org/works/OL893415W" }
  },
  "body": "Your journal / review in Markdown."
}
```
`type` is book | movie | tv | music | videogame | boardgame; `status` is want | in-progress | finished | abandoned; `rating` is 0–5 in halves; `visibility` is public (the default, left out) | friends | private.

## Project map
```
wrangler.jsonc          Worker config: D1 + KV bindings (created for you on first deploy)
src/pages/              home, /shelf/[slug], /type/[type], /item/[slug], /journal, /admin, /img/[name]
src/pages/api/          admin API (search, save, delete, collections, friends, site, export, restore, …)
src/pages/federation/   friends protocol endpoints; /.well-known/myshelf is in src/pages/[wellknown]/
src/middleware.js       locks /api/* behind your ADMIN_TOKEN
server/db.js            D1 storage and the list of schema migrations
server/federation/      keys, signatures, friends, inbox, recommendations, borrowing
server/                 KV covers, provider integrations, backups, site settings
src/data/site.json      default site name and tagline for new sites
src/styles/global.css   colors and shelf look (CSS variables at the top)
```

## License

MyShelf is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). You can use, change and share it. If you run a **modified** copy where other people can reach it, you have to offer them your modified source code too. The simplest way is to keep your fork public and set **Settings → Source code link** to it, which updates the "Source" link in your site's footer.
