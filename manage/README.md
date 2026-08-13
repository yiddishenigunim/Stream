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

## Radio endpoints — playing on external speakers

The website plays audio by fetching a **JSON list** of files and shuffling them
in JavaScript, so there is no single URL a speaker system can be pointed at.
These two routes (same worker, same deploy) expose a folder as a normal station
URL for **Music Assistant, Sonos, VLC, Home Assistant** — anything that plays a
web stream.

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/radio?station=<s>` | endless `audio/mpeg`, tracks concatenated |
| `GET` | `/playlist.m3u?station=<s>` | M3U of direct public R2 URLs |
| `GET` | `/stations` | JSON: every station, its aliases and URLs |

Both accept `&shuffle=0` to play alphabetically instead of shuffled. `/radio`
also accepts `&gain=<dB>` — see [Loudness](#loudness) below.

### Station names

`<s>` can be a **friendly name** rather than the full Hebrew path, so URLs stay
readable — `?station=sfirah` instead of eighty characters of percent-encoding.
`?station=` and `?folder=` are interchangeable.

Matching is deliberately forgiving. Names are folded through `normalizeAlias()`,
which drops case, spaces, slashes, underscores, quotes, gershayim, niqqud and
Yiddish ligatures, and normalises Hebrew final-letter forms. Each station also
carries a long list of spellings, so `sfirah`, `sefira`, `sphirah`, `ספירה`,
`vocal`, `vokaln`, `וואקאלן`, `וואכן` and `vochn` all reach the same folder.
`ל״ג בעומר`, `lag bomer` and `lagbaomer` likewise agree.

**Anything unrecognised is used as a literal R2 path**, so pre-existing
`?folder=<full path>` URLs keep working. See `STATIONS.md` for the table, or
`GET /stations` for the complete alias list as JSON.

To add a spelling, put it in the relevant `names` array in `STATIONS` — no other
change is needed. Two stations must never share an alias; the test in the commit
message for this feature checks that, along with every folder still matching
`FOLDERS` in `index.html`.

### Loudness

`GET /radio?station=<s>&gain=<dB>` plays louder. The library averages about
-18 dBFS RMS — fine on speakers, quiet on a telephone hotline, which wants a
hotter feed and then attenuates and band-limits it.

**`&gain=4.5` is the recommended setting for hotline URLs.** Speakers and Music
Assistant generally don't need it. `STATIONS.md` has the measured table.

How it works: every MP3 frame carries a `global_gain` field per granule per
channel — an 8-bit exponent on the requantiser, worth 1.5 dB a step. The worker
rewrites those fields as the bytes go past. Nothing is decoded or re-encoded, so
there is **no quality cost**, and no byte moves: the field lives in the frame's
own side information, not in the bit reservoir that main data is spread across.
It is the same edit `mp3gain` makes to files on disk. Frames carrying a CRC get
it recomputed; the Xing/Info header frame is left alone so its LAME checksum —
and with it gapless trimming — survives.

Two limits:

- Requested dB is rounded to whole 1.5 dB steps and capped at ±12. The response
  header `x-gain-db` reports what was actually applied.
- Loud tracks clip. Peaks across the library run -0.6 to -7.8 dBFS, so a big
  boost flat-tops the hottest ones. At 4.5 dB the worst case measured was 0.03%
  of samples; by 9 dB it is over 1%. This is why gain is per-URL and capped
  rather than applied to every listener.

`/playlist.m3u` ignores `gain` — it points at direct R2 URLs the worker never
sees.

### Adding a station in Music Assistant

Radio → ⋮ menu (top right) → **ADD ITEM FROM URL** → paste e.g.
`https://stream-api.oitzerhanigunim.org/radio?station=lebedik`, give it a name →
refresh the Radio list from the same menu. It then plays to any speaker Music
Assistant controls.

Use `/playlist.m3u` instead if you'd rather have the tracks show up as a
playlist you can skip through; `/radio` is the one that behaves like a station.

### Notes

- **These routes bypass the bot blocker on purpose.** Music Assistant is
  Python/aiohttp based, so its User-Agent matches the `python` entry in
  `blockedBots` — routed normally it would get a 403. They're handled up front
  with `/list`, `/object`, … for the same reason bulk uploads are.
- **Reconnects are normal.** Cloudflare caps subrequests per invocation (50
  free / 1000 paid) and each track spends one, so `/radio` ends the response
  after `RADIO_MAX_TRACKS` (45 ≈ 3 hours). Players reconnect automatically. On
  a paid Workers plan you can raise that constant.
- **Shabbos switching is not applied.** The site swaps folders by day/time in
  the browser (`TIME_BASED_FOLDERS`); a radio URL is a fixed folder. Add the
  weekday and שבת folders as two stations if that matters.
- `/playlist.m3u` costs no worker bandwidth — it points at the public R2
  hostname the site already streams from.
