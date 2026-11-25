# Stream — CLAUDE.md

**Moved (2026-11-25).** The stream is now Koilos's own: **https://koilos.org**,
code in their private repo `Koilos-org/koilos-stream` (Workers Builds deploys
it to their Cloudflare). This repo's `index.html`, `404.html` and
`manage/index.html` only redirect old `stream.oitzerhanigunim.org` links to the
same path on koilos.org; the player's source lives in their repo now. Our
`nigunim-api` worker still answers on `stream-api.` (hotline/speakers until
they switch) and our `stream` bucket / `r2.oitzerhanigunim.org` are also used
by the main site — see `docs/OPEN.md` before removing anything.

Before the move: the stream partner's site was **https://stream.oitzerhanigunim.org**
— a Yiddish (RTL) web player that streams nigunim from Cloudflare R2, plus
`/manage` (an admin page for the files) and `/radio` station URLs for speakers
and the partner's phone hotline. Sister repo of `yiddishenigunim/site` (the main
oitzerhanigunim.org site); some features (e.g. even loudness) were copied from
there — check its history before reinventing.

## Map

| Path | What |
| --- | --- |
| `index.html` · `404.html` | Since 2026-11-25: redirect to the same path on https://koilos.org (the player itself is in `Koilos-org/koilos-stream`; the last version here is in git history). |
| `manage/index.html` | Since 2026-11-25: redirect to koilos.org/manage (was the `/manage` admin page). |
| `manage/worker.js` | The **`nigunim-api`** Cloudflare Worker: `GET /?folder=` (the site's list call), management routes, `/radio`, `/playlist.m3u`, `/stations`, `POST /feedback`. |
| `manage/README.md` | Full technical docs of `/manage`, the worker API, `/radio`, loudness. |
| `manage/STATIONS.md` | Ready-to-paste station URLs. |
| `wrangler.jsonc` | The ONLY worker config — read its comments before touching it. |
| `docs/NOTES.md` | People, services, decisions, lessons, history from past chats. |
| `docs/OPEN.md` | Open work and unanswered questions. |
| `docs/MOVE.md` | Checklist for moving the site + R2 to the partner's own domain/account. |
| `tools/make-koilos-repo.py` · `tools/deploy-koilos-site.py` | Retired 2026-11-25 (built/uploaded the clean Koilos repo from the old player, which is no longer in this tree). |
| `tools/r2copy.py` | Copies/re-syncs the R2 bucket `stream` from our account to Koilos's (S3 API, keeps metadata). |

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
- Work on a `claude/...` branch, open a PR, and **merge it right away** —
  owner (2026-11-20): "מערדזש אלעמאל גלייך". Test before pushing (see
  above), since a merge to `main` is live at once.
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
