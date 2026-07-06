# Management page (`/manage`)

A private admin page for adding and deleting files in **any** folder of the
Nigunim R2 bucket. Reachable at **`https://stream.oitzerhanigunim.org/manage`**
(GitHub Pages serves `manage/index.html` there).

## What it does

The landing looks exactly like the main streaming site — same header, category
cards, and מועדים וזמנים buttons, in Yiddish. Clicking a category — instead of
playing — opens that folder's **files** to manage. The file-management chrome
(toolbar, columns, buttons) is in English.

- **Pick a category** (any genre card or Occasion, incl. בין המצרים) to open its
  folder.
- **Upload** files — click *Upload* or **drag & drop** onto the list. Uploads
  stream from disk, run 3 at a time, show per-file progress, and **auto-retry
  with backoff** so a large batch survives transient throttling.
- **Click a file to play it** (inline preview); click again to pause.
- **Select** with the checkbox on the left of each row (shift-click for a
  range); **Select all** button; **Delete** one (row ✕) or many.
- **Search/filter** the list.
- Categories with subfolders (e.g. Vocal → וואכן / שבת) are navigable via
  folder chips + breadcrumb.
- The file list is **virtualized** — only visible rows render — so it stays
  smooth with thousands of files.

**Files only:** creating/deleting *folders* and copy/cut/paste are intentionally
not exposed — you can only add, play, and remove files. (The worker still ships
`mkdir`/`copy`/`move`/`deletePrefix` endpoints, but nothing in the UI calls them.)

### If uploads fail after many files

Cloudflare **Bot Fight Mode** (Security → Bots) treats a burst of browser
uploads as automated traffic and blocks them *before* they reach the worker —
the symptom is CORS errors ("No 'Access-Control-Allow-Origin' header") after the
first several files upload fine. The client now retries automatically, but the
real fix is to stop Cloudflare from challenging your own admin traffic: turn off
Bot Fight Mode for the zone, or add a WAF **Skip** rule for
`stream-api.oitzerhanigunim.org` (or your admin IP).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/⌘ + A` | Select all |
| `Delete` / `Backspace` | Delete selected |
| `Esc` | Clear selection, or go back to categories |
| `/` or `F2` | Focus search |

## Access / PIN

The page asks for a PIN on **every** visit (never stored). The PIN is set in
`manage/index.html`:

```js
const PIN = 'music@koilos.org';
```

⚠️ **This is convenience, not security.** The PIN is visible to anyone who
views the page source, and the management API below is open to anyone who
finds its URL. Keep the API URL private. If you want real protection, enable
the `ADMIN_TOKEN` auth in the worker (see below) and send the token from the
page.

## Backend — update the existing worker (required)

The static page **cannot** modify R2 on its own. The management endpoints live
in the **existing `nigunim-api` worker** (the same one that serves
`stream-api.oitzerhanigunim.org`). `manage/worker.js` is that worker with the
management routes added — the original streaming logic is unchanged.

1. Cloudflare → **Workers & Pages** → **`nigunim-api`** → **Edit code**.
2. Select all, delete, and **paste the full contents of `manage/worker.js`**.
3. **Deploy**.

That's it. The R2 bucket is already bound as `env.BUCKET`, so there's nothing
else to configure — no new worker, no new domain, no binding changes. The page
already points at `https://stream-api.oitzerhanigunim.org`.

Reload `/manage`, enter the PIN, and you can manage files.

**Why it's safe:** the management routes (`/list`, `/object`, …) are handled at
the top of the worker as distinct paths and never touch the existing
`GET /?folder=` streaming call. They're also handled *before* the 60/min rate
limiter, so bulk uploads of many files aren't throttled.

### Optional: real auth

Set a secret token and the worker will require `Authorization: Bearer <token>`
on all writes:

```sh
npx wrangler secret put ADMIN_TOKEN     # or add it in the dashboard → Settings → Variables
```

Then add a matching header in `manage/index.html`'s `api()`/upload calls.

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
