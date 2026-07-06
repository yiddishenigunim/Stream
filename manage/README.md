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
