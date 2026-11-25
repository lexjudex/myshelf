# MyShelf

Your own media journal and virtual bookshelf for books, movies, TV, music, video games, board games and YouTube. Search for something, pick it, and the cover and details fill in for you. Write what you thought, sort things into shelves, and connect with friends who run their own MyShelf.

**It's free.** MyShelf runs on Cloudflare's free plan (no credit card), and your copy of the code lives in a free GitHub account. Everyone runs their own copy, so your shelf and your data stay yours.

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/K0A32B3009)

**Contents:** [Set up](#set-up-about-30-minutes) · [API keys](#step-6-add-api-keys-for-the-media-you-track) · [Updates](#keeping-up-to-date) · [Using it](#using-myshelf) · [Friends](#friends) · [What's new](CHANGELOG.md) · [For developers](#for-developers)

---

## Set up (about 30 minutes)

You'll need two free accounts. Make them first if you don't have them:

- **GitHub** (holds your copy of the code): [github.com/signup](https://github.com/signup)
- **Cloudflare** (runs your site): [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)

Wherever you see `YOUR-USERNAME` below, use your GitHub username.

### Step 1: Copy MyShelf to your GitHub

1. Open [github.com/lexjudex/myshelf/fork](https://github.com/lexjudex/myshelf/fork).
2. Leave everything as it is and click **Create fork**.

You now have your own copy at `github.com/YOUR-USERNAME/myshelf`.

### Step 2: Put it on Cloudflare

1. Open [Cloudflare → Workers & Pages → Create](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create).
2. Choose **Import a repository**. Connect your GitHub account when asked, and pick **myshelf**.
3. Leave the settings as they are (build command `npm run build`, deploy command `npx wrangler deploy`) and click **Deploy**.
4. Wait a minute or two. When it's done, Cloudflare shows your site's address, something like `https://myshelf.your-name.workers.dev`. Write it down.

The first deploy also creates your database and image storage. There's nothing to set up there.

### Step 3: Set your admin password (`ADMIN_TOKEN`)

This is the password you'll use to add and edit things on your site. **Your site won't let you in without it.**

1. Make up a long password (your password manager can make one) and save it somewhere safe.
2. Open [your Worker's settings in Cloudflare](https://dash.cloudflare.com/?to=/:account/workers/services/view/myshelf/production/settings). (If that link doesn't open it: **Workers & Pages → myshelf → Settings**.)
3. Under **Variables and Secrets**, click **Add**.
4. Set **Type** to **Secret**, **Variable name** to `ADMIN_TOKEN`, and **Value** to your password.
5. Click **Deploy**.

### Step 4: Make a GitHub token (`GITHUB_TOKEN`)

This lets your site update itself when new versions of MyShelf come out, with one click. Without it, you'd have to update by hand on GitHub.

1. Open [GitHub → New fine-grained token](https://github.com/settings/personal-access-tokens/new).
2. **Token name:** `MyShelf updates`. **Expiration:** choose **No expiration**, so you never have to make a new one.
3. **Repository access:** choose **Only select repositories**, then pick **YOUR-USERNAME/myshelf**.
4. **Permissions:** open **Repository permissions**, find **Contents**, and set it to **Read and write**.
5. Click **Generate token** and copy it. GitHub only shows it once, so keep this tab open for Step 5.

### Step 5: Sign in to your site

1. Go to your site's address with `/admin/` on the end, for example `https://myshelf.your-name.workers.dev/admin/`.
2. Enter your admin password from Step 3.
3. Open **Settings** and fill in:
   - **Site name** and **Your name**.
   - **Source code link** is filled in for you with your own copy on GitHub (`https://github.com/YOUR-USERNAME/myshelf`). Check it's yours: Updates use it to find your copy.
   - Click **Save**.
4. Scroll down to **API keys** → **Updates from GitHub** (the first one), paste your token from Step 4, and click **Save**. It should say *GitHub accepted your token*.

Your site is live. 🎉 Add API keys next so searching can find your movies, games and more.

### Step 6: Add API keys for the media you track

API keys are free passes that let MyShelf look things up in other sites' databases. **You only need keys for the kinds of media you track.** Books work without any key. To hide a kind of media you don't use, untick it in **Settings → Media on your site**.

Paste each key into **Manage → Settings → API keys** on your site and click **Save**. MyShelf tests it right away. Keys are stored encrypted, and nobody (including your friends) can see them.

#### Movies & TV: TMDB

1. Make a free account at [themoviedb.org/signup](https://www.themoviedb.org/signup).
2. Open [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and request a **Developer** key. Fill in the short form (personal use is fine).
3. Copy the **API Read Access Token** (the *long* one) into **Movies & TV (TMDB)**.

#### Video games: IGDB (through Twitch)

1. Turn on two-factor authentication in your [Twitch security settings](https://www.twitch.tv/settings/security). Twitch requires it.
2. Open [dev.twitch.tv/console/apps/create](https://dev.twitch.tv/console/apps/create). Give it any name, set **OAuth Redirect URL** to `http://localhost`, **Category** to *Application Integration*, and **Client Type** to *Confidential*. Click **Create**.
3. Click **Manage** on your new app. Copy the **Client ID**, then click **New Secret** and copy the **Client Secret**. Paste both into **Video games (IGDB)**.

#### Board games: BoardGameGeek

1. Open [boardgamegeek.com/applications](https://boardgamegeek.com/applications) (sign in to BGG first) and register a **non-commercial** application.
2. Approval can take a few days. Once it's approved, open the app there, create a **token**, and paste it into **Board games (BoardGameGeek)**.

#### Music: Spotify (optional)

Music search works without this (it uses MusicBrainz). Spotify adds better covers, public playlists, and pasting Spotify links. **It needs Spotify Premium.**

1. Open [developer.spotify.com/dashboard/create](https://developer.spotify.com/dashboard/create).
2. Give it any name and description. Set **Redirect URI** to `http://127.0.0.1:8788/callback` (required, but not used). Tick **Web API**, agree to the terms, and click **Save**.
3. Open **Settings** on your app. Copy the **Client ID**, then click **View client secret** and copy that too. Paste both into **Music (Spotify)**.

#### Books and YouTube: Google (optional)

Books work without a key, and pasting YouTube links works without one. A Google key gives books more results and lets you **search** YouTube by name. One key does both.

1. Open [console.cloud.google.com](https://console.cloud.google.com/) and accept the terms. If it asks, create a project (any name).
2. Switch on the [Books API](https://console.cloud.google.com/apis/library/books.googleapis.com) and the [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) (click **Enable** on each).
3. Open [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials** → **API key**, and copy it into **Books (Google Books)**.

#### Contact email (optional)

Open Library and MusicBrainz ask apps to include an email so they can reach you if something goes wrong. Put yours in **Contact email**.

---

## Keeping up to date

When a new version is out, a small **Update available** pill appears next to your name at the top of your site, and a banner at the top of Manage shows **What's new** (only you see either). Click **Update**, or open **Manage → Settings → Updates**, and click **Update now**. Cloudflare redeploys your site in a minute or two, and any database changes apply themselves. This needs your GitHub token (Step 4) and Source code link (Step 5, filled in for you).

You can also update on GitHub: open `github.com/YOUR-USERNAME/myshelf` and click **Sync fork → Update branch**.

See what changed in each version in the [changelog](CHANGELOG.md).

<details>
<summary>Set up with the <b>Deploy to Cloudflare</b> button instead of a fork?</summary>

That copy isn't linked to this project on GitHub, so **Update now** and **Sync fork** won't work for it. Run this once on your computer:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git && cd YOUR-REPO
git remote add upstream https://github.com/lexjudex/myshelf.git
```

Then, to update: `git pull upstream main && git push`. If you'd rather avoid this, setting up again as a fork (Step 1) and restoring a backup moves everything over.
</details>

## Using MyShelf

Sign in at `/admin/` (the **Manage** link in your site's footer).

- **＋ Add:** pick a kind of media, search, click the match, add your status, rating and notes, and save. Can't find it? Paste a BoardGameGeek, Spotify or YouTube link under the search, or **Add manually**.
- **Library:** everything you've added. Edit, delete, or recommend to a friend.
- **Collections:** your shelves. Some fill themselves (like *Currently* or *Recently Finished*), and others you fill by hand. Drag them into order.
- **Friends:** your address to share, friend requests, and your inbox.
- **Settings:** your site's name, the Shelves page heading, which media it shows, light or dark look and accent colour, shelf decorations (up to three images on top of the bookcase), API keys, updates, and backups.

On your site itself, when you're signed in:

- **✎ next to a shelf** opens its arrange screen: drag things into order, edit or recommend items, or take items off with the red ✕.
- **Edit shelves** on the Shelves page and each media page lets you reorder whole shelves or hide them.
- Every item page has an **Edit** link.

**Who can see it:** each item can be *Everyone*, *Friends only*, or *Only me*. Only *Everyone* items show on your public pages.

**Back up now and then:** **Settings → Download backup** saves everything as one file. **Restore from backup** brings it back, on this site or a new one.

## Friends

Friends are other people running their own MyShelf. Your sites talk to each other directly, with no company in the middle.

1. Copy your address from **Manage → Friends** and send it to a friend.
2. They paste it into **Add friend**. You get a request in your inbox and click **Accept**.

Then you can:

- see each other's *Friends only* items, with "You have this" on things you both have,
- **recommend** things to each other (they land in the inbox with an **Add it** button),
- **comment** on each other's entries, **@mention** each other in notes, and tap the **heart** on things you enjoyed too,
- see **what friends thought** of something before you add it,
- **ask to borrow** anything a friend marked *I own a copy*.

The **Friends** page on your site shows what your friends are up to. When you're signed in, it also shows your inbox and comment boxes, and lets you filter by **groups** (set them up in **Manage → Friends → Groups**).

Friends never see your *Only me* items, your API keys, or who you've lent things to. If you use your own domain, set **Settings → Public address** so friends always reach you at the same place.

## Good to know

- **Free-plan limits:** Cloudflare allows 100,000 requests (page loads and searches) a day, 5 GB of entries and 1 GB of images on the free plan. A personal shelf won't come close.
- **Making the site private:** by default anyone with your address can see your *Everyone* items (only you can edit). To lock it, use [Cloudflare Zero Trust → Access → Applications](https://one.dash.cloudflare.com/) → **Add an application → Self-hosted**, enter your site's address, and allow only your email (free for up to 50 people). If you lock the whole site, add **Bypass** rules for `/.well-known/myshelf` and `/federation/*` so friends' sites can still reach yours.
- **Spotify** apps in development mode need Premium and show up to 10 results per type.
- **Credits:** the site footer credits TMDB and BoardGameGeek, as their terms require. Please leave it in.

---

## For developers

<details>
<summary>How it works, local development, data format and project map</summary>

### How it works

```
You (admin page) ──► /api/* on your Worker (API keys from Worker secrets, or saved encrypted in D1 + KV)
                        ├─► searches Open Library / Google Books / TMDB / Spotify / IGDB / BGG / YouTube
                        └─► saves the entry to D1 and the cover image to KV
Visitors ──► pages render straight from D1, so every change is live immediately
Friends' MyShelf sites ◄──► /federation/v1/* (signed messages)
```

- Entries, collections, shelf orders, friends and inbox live in **Cloudflare D1**. Tables create and upgrade themselves (`server/db.js`).
- Cover images live in **Cloudflare KV** and are served from `/img/…`.
- API keys can also be Worker secrets with the names in `.dev.vars.example`. A key saved in Settings wins over a secret with the same name.
- **Friends protocol:** each site has its own Ed25519 key, stored in D1. Sites describe themselves at `/.well-known/myshelf`, accept signed messages at `/federation/v1/inbox`, and serve a shelf feed at `/federation/v1/shelf`. Friends-only items are included only for requests signed by a friend. Items have a permanent `uid` and a shared `ext_key` (like `boardgame:bgg:266192`), so two shelves can tell when they hold the same thing. Details: `server/federation/protocol.js`.

### Local development

```bash
npm install
npm test                          # offline tests for the API layer and the friends protocol
cp .dev.vars.example .dev.vars    # then fill in ADMIN_TOKEN (and any keys)
npm run preview                   # builds, then serves with wrangler dev at http://localhost:8787
```

Local data lives in `.wrangler/` and never touches your live site. To try friends features, run two copies with separate data, for example `npx wrangler dev --port 8801 --persist-to .wrangler/a` and `npx wrangler dev --port 8802 --persist-to .wrangler/b`, then add `http://localhost:8802` as a friend from the first.

### Announcements (for the MyShelf project)

`announcements.json` in this repository is shown to every MyShelf site, in the banner at the top of Manage (sites check every few hours):

```json
{ "announcements": [
  { "id": "2026-12-fix", "message": "An important fix is out. Please update.", "link": "https://github.com/lexjudex/myshelf/blob/main/CHANGELOG.md", "linkText": "What changed", "until": "2026-12-31", "below": "0.9.1" }
] }
```

`id` and `message` are required. Messages are plain text. `link` must be https. `until` stops showing it after that date. `below` shows it only to sites older than that version. Give each new announcement a new `id`: dismissals are remembered per id. Update checks and **What's new** read `package.json` and `CHANGELOG.md` from here too, so keep a `## x.y.z` section in the changelog for each release.

### Item format

Each item is JSON in D1 (and in **Download backup**):

```json
{
  "slug": "book-dune-1965",
  "uid": "6f1c2d1e-8a3b-4c5d-9e7f-0a1b2c3d4e5f",
  "item": {
    "title": "Dune", "type": "book", "creator": "Frank Herbert", "year": "1965",
    "cover": "/img/book-dune-1965-m1a2b3.jpg", "coverAspect": 0.6667,
    "status": "in-progress", "rating": 4.5,
    "dateStarted": "2026-10-01",
    "progress": { "at": 212, "of": 612 },
    "collections": ["favorites"], "tags": ["sci-fi"], "genres": ["Science fiction"],
    "details": { "pages": 612 },
    "visibility": "friends", "owned": true, "lentTo": "Sam", "lentSince": "2026-11-01",
    "source": { "name": "Open Library", "id": "OL893415W", "url": "https://openlibrary.org/works/OL893415W" }
  },
  "body": "Your notes in Markdown."
}
```

`type`: book, movie, tv, music, videogame, boardgame or video (YouTube). `status`: want, in-progress, finished or abandoned. `rating`: 0–5 in halves. `visibility`: public (the default, left out), friends or private. `progress` is for books, TV and legacy board games (`legacy: true`, with an optional `unit`).

### Project map

```
wrangler.jsonc          Worker config: D1 + KV bindings (created on first deploy)
src/pages/              home, /shelf/[slug], /type/[type], /item/[slug], /journal, /friends, /admin, /img/[name]
src/pages/api/          admin API (search, save, delete, collections, friends, keys, site, export, restore, …)
src/pages/federation/   friends protocol endpoints; /.well-known/myshelf is in src/pages/[wellknown]/
src/middleware.js       locks /api/* behind ADMIN_TOKEN and loads saved API keys
server/                 D1 storage, KV covers, API keys, providers, backups, updates, site settings
server/federation/      keys, signatures, friends, inbox, recommendations, borrowing
src/data/site.json      default site name and tagline for new sites
src/styles/global.css   colours and shelf look (CSS variables at the top)
```

</details>

## License

MyShelf is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). You can use, change and share it. If you run a **changed** copy that other people can visit, you have to share your changed code with them too. The easiest way: keep your fork public and set **Settings → Source code link** to it, which updates the **Source** link in your site's footer.
