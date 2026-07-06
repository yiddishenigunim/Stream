# Management page (`/manage`)

A private admin page for adding and deleting files in **any** folder of the
Nigunim R2 bucket. Reachable at **`https://stream.oitzerhanigunim.org/manage`**
(GitHub Pages serves `manage/index.html` there).

## What it does

- **Browse** every folder in the bucket (breadcrumb + folder chips).
- **Upload** files — click *אַרויפלייגן* or **drag & drop** onto the list.
  Uploads stream from disk, run 3 at a time, and show per-file progress, so
  many/large files won't freeze the browser.
- **Delete** one file (row ✕), many files (select + *אויסמעקן*), or a whole
  folder (folder chip ✕, recursive).
- **Select all**, shift-click ranges, ctrl/⌘-click to toggle.
- **Copy / Cut / Paste** files between folders (in-app clipboard).
- **New folder**, **search/filter**, **double-click** a file to preview/download.
- The file list is **virtualized** — only visible rows render — so it stays
  smooth with thousands of files.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/⌘ + A` | Select all |
| `Ctrl/⌘ + C` | Copy |
| `Ctrl/⌘ + X` | Cut |
| `Ctrl/⌘ + V` | Paste into current folder |
| `Delete` / `Backspace` | Delete selected |
| `Esc` | Clear selection |
| `/` or `F2` | Focus search |

## Access / PIN

The page asks for a PIN on **every** visit (never stored). The PIN is set in
`manage/index.html`:

```js
const PIN = 'music@koiolos.org';
```

⚠️ **This is convenience, not security.** The PIN is visible to anyone who
views the page source, and the management API below is open to anyone who
finds its URL. Keep the API URL private. If you want real protection, enable
the `ADMIN_TOKEN` auth in the worker (see below) and send the token from the
page.

## Backend — deploy the worker (required)

The static page **cannot** modify R2 on its own. It talks to a small
Cloudflare Worker (`manage/worker.js`) that has the R2 bucket bound. This
worker is **separate** from the public `stream-api`, so deploying it cannot
break the main site's read-only listing.

1. Edit `manage/wrangler.toml` → set `bucket_name` to your real R2 bucket
   (the same bucket the stream reads from).
2. From the `manage/` folder:
   ```sh
   npx wrangler login      # once
   npx wrangler deploy
   ```
3. Point it at `manage-api.oitzerhanigunim.org` (uncomment the `routes` block
   in `wrangler.toml`) so the page finds it automatically. **Or** use the
   printed `*.workers.dev` URL and open the page once as
   `…/manage?api=https://manage-api.<you>.workers.dev` (it remembers the URL
   in `localStorage`).

That's it — reload `/manage`, enter the PIN, and you can manage files.

### Optional: real auth

```sh
npx wrangler secret put ADMIN_TOKEN
```

Then the worker requires `Authorization: Bearer <token>` on all writes. Add a
matching header in `manage/index.html`'s `api()`/upload calls if you enable it.

## API contract (for reference)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/list?prefix=<p>` | – | `{ folders:[..], files:[{key,name,size,uploaded}] }` |
| `GET` | `/object?key=<k>` | – | raw file bytes |
| `PUT` | `/object?key=<k>` | file bytes | `{ ok, key }` |
| `POST` | `/delete` | `{ keys:[..] }` | `{ ok, deleted }` |
| `POST` | `/copy` | `{ from:[..], toPrefix }` | `{ ok, results }` |
| `POST` | `/move` | `{ from:[..], toPrefix }` | `{ ok, results }` |
| `POST` | `/mkdir` | `{ prefix }` | `{ ok, key }` |
| `POST` | `/deletePrefix` | `{ prefix }` | `{ ok, deleted }` |
