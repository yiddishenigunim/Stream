# Notes from past chats

Collected 2026-10-27 from the three Claude Code sessions that worked on this
repo (July–October 2026). Technical details of the worker live in
`manage/README.md`; this file holds what is not in the code.

## People and services

- **Owner** — runs אוצר הניגונים (oitzerhanigunim.org) and talks to Claude in
  Yiddish. He also forwards e-mail threads with the partner into the chat and
  asks for a reply he can send back.
- **The stream partner** — "Music | Koilos" (koilos.org). This site is theirs;
  the `/manage` PIN is their address. They run a **phone hotline** with the
  IVR company **Tel Tech** (web portal at `ivr.teltech.info`); the stream sits
  at menu **2‑5‑6**. The partner pays for work (monthly card charge, arranged
  by the owner — billing is outside this repo). The partner calls the hotline
  stream "שיר המעלות".
- An **office speaker system** (a company's IT person, via the partner) plays
  the stations through **Music Assistant** — the reason `/radio` exists
  (2026-07-26).
- **Cloudflare account** (Workers & Pages) holds, among others:
  `nigunim-api` (this repo's worker), `oitzer-api` (donations — not this),
  `hotline` (repo `yiddishenigunim/hotline`), `site` / `coda-proxy` (main site),
  `oitzer` (sitemap). R2 bucket `stream` holds the nigunim; public files are
  served from `r2.oitzerhanigunim.org`.
- **GitHub Pages** serves the site from `main`.
- **Analytics** — its own GA4 property, separate from the main site (2026-06-28).

## Decisions (and what was rejected)

- **2026-07-06 בין המצרים stream** — owner: "עס זאל נעמען א גאנצע וואך פון דעם
  פאלדער, און פון דאנערשטאג ביז שבת פון דעם שבתדיגע וואקאלן פאלדער". Built
  as `TIME_BASED_FOLDERS` shared with וואקאלן. First it had a "נײַ" badge and
  a big animation; owner then: take off the word, "מאך עס די זעלבע סייז ווי די
  אנדערע, נאר מער מערקבאר", put it after שבועות on a new row. Later
  (2026-07-22) the special colouring was removed to match the other stations.
- **2026-07-06 `/manage`** — owner: "מאך עס זייער קאנוויניענט מיט יעדע מעגליכע
  אפציע … מאך זיכער אז עס וועט ארבעטן מיט אסאך פיילס און נישט קראכן". Then
  narrowed: looks like the main page, a click on a category shows its files;
  "מזאל נישט קענען אויסמעקן און צולייגן פאלדערס. נאר פיילס"; "נעם אראפ קאפי
  קאט און פעיסט"; click on a file plays it, only the checkbox selects. A
  separate `manage-api` worker was proposed and **rejected** — same worker.
- **2026-07-26 `/radio` for Music Assistant** — endless MP3 over plain HTTP
  (Icecast-style, not Shoutcast `ICY`), each listener gets an own shuffle, not
  one synchronised broadcast. If the hotline ever needs a true live broadcast
  (like "אידיש 24"), the suggested route is a real Icecast server (e.g.
  AzuraCast on a small VPS reading from R2) — not built.
- **2026-08-12 `&gain=`** — hotline was "אביסל שטיל". Lossless global_gain
  rewrite, opt-in per URL; **4.5 dB** recommended for the hotline only, not
  for speakers. Re-encoding the files was rejected.
- **2026-08-19 stutter fix** — partner: "האקט זיך עס אפ פאר א סקונדע יעדע
  האלבע מינוט". Cause was our pacing (VBR files under-fed up to 19%); fixed,
  no charge ("ס'איז געװען אונזער באג").
- **2026-10-11 even volume** — owner: "די גאנצע סיסטעם זאל ארבעטן אלץ אויפן
  זעלבן וואליאם … צו ארבעטן אויף יעדע טרעק באזונדער נעמט זייער לאנג". Copied
  from the main site's loudness work; target −16 LUFS. Lifting quiet tracks on
  the website was rejected (needs CORS on R2 + Web Audio, fails with a locked
  iPhone) — the site only turns loud tracks down. The one-time *Even volume*
  run was done: `/list` shows `lufs` on files (checked 2026-10-27).
- **2026-11-09 repeat button** — a listener (via the owner): "אן אפציע צו
  איבערהערן די זעלבע ניגון נאכאמאל און נאכאמאל, דורך א ריפיעט קנעפל". Built
  as a repeat-one toggle (key `R`), off on every page load; ⏭/⏮ still move
  on. First placed next to ⏭; owner: "מאך עס אונטן רעכטס, און קלענער. עס זאל
  נישט שטיין אין וועג און שטערן פאר די וואס נוצן עס נישט" — now a small faint
  icon in the player's bottom-right corner; keep it out of the main controls.
  GA4 event `repeat_toggled`. Website player only, not `/radio`.
- **2026-11-19 three small things from the partner** (their e-mail "אפדעיטן
  סטרימינג וועבסייד, אויב שייך 3 קליינעקייטן", forwarded by the owner):
  (1) the line "די סייט ווערט כסדר געאפדעיט מיט פרישע סחורה" — a small pill
  with a green pulse; first under the subtitle, then the owner: "לייג מער
  אונטן, העכער פראדזשעקט דורך" — now in the footer above "פראיעקט דורך"; (2) "א אפשן אז מ'זאל קענען
  שרייבן הגהות והערות צו די רעדאקציע … music@koilos.org (נאר אויב ס'איז נישט
  קיין שווערע זאך)" — footer button → form → worker `POST /feedback` → Resend;
  falls back to a `mailto:` until the `RESEND_API_KEY` secret is set; (3) "א
  שיינע בעגראנט פון די 'קולות לאגא' (יעצט איז אונזער לאגא אביסל באזייטיגט)"
  — a faint gold tiled pattern of their logo (`.koilos-bg`) and a larger footer
  logo. The only logo we have is the 100×74 webp in the footer; a big sharp
  watermark needs their original file (asked, see OPEN).
- **2026-11-19 moving to the partner's own domain / R2 account** — after a
  long talk with Koilos the owner is thinking of moving the whole stream site
  to their own domain and their own R2 (and Cloudflare/GitHub). Not decided.
  The checklist of what is needed is `docs/MOVE.md`.
  2026-11-18/19 e-mail thread: the owner wrote them "איך דארף נאר אז די
  דאמעין זאל מען אריבעררוקן צו א קלאודפלער אקאונט וואס איך גיי אייך
  אויפסעטן" — i.e. the owner sets up the Cloudflare account for them.
  **Office | Koilos** (`info@koilos.org`, Yoel Moskowitz) answered that the
  domain is at **Squarespace** and asked the owner to call him (number in the
  owner's mail, not here). The partner thanked for the three changes
  ("א גרויסן יישר כח פארן אזוי שיין מסדר זיין … מיט אלעס וואס מיר האבן
  געבעטן").
  2026-11-23 the owner changed the plan: "איך וויל יואל זאל עפענען אן
  אייגענע אקאונט ביי קלאוד פלעיר, און אלעס וואס ער קען זאל ער טון, און נאר
  וואס ער קען נישט, ווען ער איז פינישט זאל איך אלעס טון" — Yoel opens the
  Cloudflare account himself (their card), adds koilos.org, turns DNSSEC off
  and switches the nameservers at Squarespace, and invites the owner as
  Super Administrator; the owner does everything technical after that.

- **2026-11-24 the final goal of the move** — owner: "איך וויל אלעס
  אריבערלייגן צו זיי … די גיט האב, אלע, די סייט, און די אינפארמאציע, אלעס
  זאל ליגן ביי זיי … איך זאל שוין נישט דארפן זיך פארלענען מיט דעם, עס זאל
  גארנישט האבן מער מיט אוצר הניגונים. נאר די איין זאך, אז די אלטע לינק זאל
  רידוירעקטן צו זיי". So: their Cloudflare, their R2, their GitHub repo
  (clean, built with `--no-credit` — no "אוצר הניגונים" credit), their
  domain; on our side only redirects from the old hostnames; afterwards our
  worker, bucket and this repo are retired.

- **2026-11-24 their repo stays private** — owner: "איך וויל עס האלטן
  פרייוועט, אפילו ס'גייט זיי קאסטן געלט … ס'איז אריין צופיל ארבעט דא". It
  costs nothing: private repos are free on GitHub, and the site is served by
  Cloudflare (Worker `koilos-site`), not GitHub Pages. The clean repo holds
  two Workers for Workers Builds: `api/` (nigunim-api) and `site/`
  (koilos-site). Plan: Yoel opens a free GitHub account + a free organization
  and makes the owner an Owner of it, so the owner (and Claude) can do the
  rest without him.

## Lessons (cost time before)

- **Two wrangler configs = outage (2026-07-27).** Cloudflare autoconfig added
  a `wrangler.jsonc` with `assets` and no `main`; it won over `wrangler.toml`
  and the worker served the repo as static files. Keep one config, no
  `assets`. See the comments in `wrangler.jsonc`.
- **Uploads fail after several files** with CORS errors → Cloudflare **Bot
  Fight Mode** blocks the burst before the worker. Fix in the Cloudflare
  dashboard (turn it off or a WAF Skip rule for `stream-api.`); the page retries.
- **Music Assistant is Python**, so its User-Agent hits the `python` bot block —
  `/radio` routes are handled before the blocker on purpose.
- **VBR pacing:** the first frame of a VBR MP3 is the Xing tag and always says
  128 kbps. Pace by each frame's real duration.
- **GitHub Pages run stuck in "Queued"** (2026-07-06, run #42): API cancel and
  re-run both fail. What helps: cancel in the browser, or Settings → Pages →
  Source to None, save, back to `main`, save.
- The worker the site uses is **`nigunim-api`**, answering on
  `stream-api.oitzerhanigunim.org` — the owner did not remember which worker
  it was; the dashboard name is the clue.
