# Stream — CLAUDE.md

The stream partner's site: **https://stream.oitzerhanigunim.org** — a Yiddish
(RTL) web player that streams nigunim from Cloudflare R2, plus `/manage` (an
admin page for the files) and `/radio` station URLs for speakers and the
partner's phone hotline. Sister repo of `yiddishenigunim/site` (the main
oitzerhanigunim.org site); some features (e.g. even loudness) were copied from
there — check its history before reinventing.

## Map

| Path | What |
| --- | --- |
| `index.html` | The whole public player (one file, no build). Folders: `FOLDERS`, Shabbos switching: `TIME_BASED_FOLDERS`. GA4 property of its own. |
| `manage/index.html` | `/manage` admin page (PIN gate, upload/delete/play, *Even volume*). |
| `manage/worker.js` | The **`nigunim-api`** Cloudflare Worker: `GET /?folder=` (the site's list call), management routes, `/radio`, `/playlist.m3u`, `/stations`. |
| `manage/README.md` | Full technical docs of `/manage`, the worker API, `/radio`, loudness. |
| `manage/STATIONS.md` | Ready-to-paste station URLs. |
| `wrangler.jsonc` | The ONLY worker config — read its comments before touching it. |
| `docs/NOTES.md` | People, services, decisions, lessons, history from past chats. |
| `docs/OPEN.md` | Open work and unanswered questions. |

## Build / deploy

- No build step, no package.json, no test suite in the repo. Past sessions
  tested with throwaway scripts (mock R2, headless Chromium, ffmpeg) — run
  something like that before pushing worker changes.
- **Site:** GitHub Pages, deploy from branch `main` / root, custom domain via
  `CNAME`. Merge to `main` = live.
- **Worker:** Cloudflare Workers Builds deploys `manage/worker.js` as
  `nigunim-api` on every push to `main` (routes `stream-api.` and
  `nigunim-api.oitzerhanigunim.org`, R2 bucket `stream` bound as `env.BUCKET`).
  No more pasting into the dashboard. A broken worker takes the site down.

## Rules for working here

- The owner writes in Yiddish; answer in Yiddish, in Hebrew letters, short and
  plain.
- Work on a `claude/...` branch and open a PR. Past practice: Claude merges
  only when the owner says so ("מערדזש", "פולל און מערדזש").
- `/manage`: no hint for the PIN on the page — owner: "לייג נישט קיין הינט!".
  Files only — no creating/deleting folders, no copy/cut/paste in the UI.
  The part copied from the main page stays Yiddish; the file tools are English.
- Never break `GET /?folder=` — the public site depends on it. New routes go
  at the top of the worker as separate paths.
- One worker, not a new one — owner: "ניין, איך וויל נישט א נייע ווארקער, נאר
  די זעלבע".
- Secrets (portal logins, card data, tokens) shared in chat never go into the
  repo or a PR. Name the account, not the value.
- **What the owner says in a chat that the next agent needs (a rule for how to
  work, a decision, a fact about an account/person/service, an open question)
  goes into the repo in the same push — not only into the chat.** Rules here,
  facts/decisions in `docs/NOTES.md`, open items in `docs/OPEN.md`.
