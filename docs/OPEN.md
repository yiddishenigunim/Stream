# Open work

Last checked 2026-11-19. Remove an item when it is done.

- **Hotline URLs with `&gain=4.5`?** (since 2026-08-19) Claude asked whether to
  append `&gain=4.5` to the station URLs in the Tel Tech portal; no answer in
  the chat. Ask the owner whether it was done, and whether the hotline still
  sounds quiet now that even volume is live.
- **Bot Fight Mode** (since 2026-07-06) — unknown whether it was turned off /
  a WAF Skip rule added for `stream-api.oitzerhanigunim.org`. Only matters if
  big uploads in `/manage` fail again.
- **`/manage` is not really protected.** The PIN is in the page source and the
  write API is open. Optional `ADMIN_TOKEN` (worker secret, name only) exists in
  the code but is not wired into the page. Not requested by the owner.
- **Live broadcast for the hotline** — only if the partner wants every caller
  to hear the same track (Icecast/AzuraCast). Not requested.
- **`RESEND_API_KEY` on `nigunim-api`** (since 2026-11-19) — the feedback
  form mails only after this secret is added in the Cloudflare dashboard;
  until then it opens the visitor's mail app. Ask the owner whether it was
  added (the main site's Resend key works; name only, never the value).
- **The partner's original logo file** (since 2026-11-19) — for a big, sharp
  logo background we need an SVG or a large PNG from Koilos.
- **Move to the partner's own domain / R2?** (since 2026-11-19) — the owner is
  considering it; `docs/MOVE.md` lists what is needed. Domain is at
  Squarespace (2026-11-20); since 2026-11-23 Yoel (their office) opens his own
  Cloudflare account and switches the nameservers himself (steps sent by the
  owner). 2026-11-23: the owner has access to their Cloudflare account;
  public RDAP shows DNSSEC already off at the registry, nameservers still
  Squarespace (`ns-cloud-a*.googledomains.com`) — step 7 (switch to the
  Cloudflare nameservers) not done yet. The session env has `OITZER_CF_API_TOKEN`
  (a user token of the owner's login, a member of "Info@koilos.org's
  Account"). After the owner widened it (2026-11-23) it reads and edits DNS
  on `koilos.org` (and our zones); R2 and the workers subdomain in the Koilos
  account still answer "Authentication error". Cause found 2026-11-23: the
  owner's membership there is scoped to the domain `koilos.org` only, role
  Domain Administrator (+ Domain DNS) — no account-wide R2/Workers, and a
  token can never exceed the member's role. Yoel changed it (2026-11-24) — now
  R2 works there (no buckets yet), members/workers readable; no workers.dev
  subdomain yet (opening Workers & Pages once creates it). **koilos.org
  active on Cloudflare 2026-11-24 03:37 UTC** (step 7 done; registry NS =
  eleanor/ken, DNSSEC off). Checked from Google and Cloudflare public DNS:
  MX, SPF, DKIM, apex A and `www` all resolve as before; koilos.org and www
  answer 200. 2026-11-24 set up in their account: `r2.koilos.org`
  on their bucket (like ours: minTLS 1.0, no CORS) and the worker
  `nigunim-api` (clean code from `make-koilos-repo.py`, R2 binding `stream`,
  observability) on `stream-api.koilos.org`, uploaded by API (Workers Builds
  not connected yet — no repo of theirs yet). Tested: same 775 files for
  שיינע מארשן as the old API, `/stations`, `/feedback`, `/radio` streams, and
  the clean site (local copy) plays from `r2.koilos.org` with requests only to
  koilos hosts. Free Workers plan for now.
  **koilos.org itself is the stream since 2026-11-24** (owner: "מאך אז דאס
  זאל זיין די סטרים"): its Squarespace "Coming Soon" A records and the `www`
  CNAME were removed (values listed under "koilos.org today" in MOVE.md; mail
  records untouched) and koilos.org + www.koilos.org are custom domains of a
  static-assets Worker `koilos-site` in their account, uploaded by
  `tools/deploy-koilos-site.py` (only index.html and manage/index.html are
  public). Live-tested on desktop and phone: plays from `r2.koilos.org`, no
  "אוצר הניגונים", `/manage/` shows the PIN gate. The clean repo now has
  CNAME `koilos.org`. When their GitHub repo exists, either connect Workers
  Builds to it for `koilos-site` too, or move the site to GitHub Pages. Still to do, in order: (1) their repo is
  **`Koilos-org/koilos-stream`** (private, in their GitHub organization
  `Koilos-org`, 2026-11-25). The owner installed the Claude GitHub App on
  `Koilos-org`; **the clean commit is pushed** to its `main` (2026-11-25,
  one commit `3db5f93` by "Koilos", built with `--no-credit`, 10 files,
  no oitzer/yiddishenigunim/committer e-mails); Claude pushes the clean commit (`--no-credit`, layout
  `api/` + `site/`); (2) Yoel opens a free GitHub account and a free
  organization, invites the owner as Owner; (3) owner moves the repo into
  that organization; (4) **Workers Builds connected 2026-11-25**: the owner
  installed "Cloudflare Workers and Pages" on Koilos-org and connected
  `koilos-site` in the dashboard (the account↔GitHub link can only be made
  there); Claude fixed its root to `/site` and added the `nigunim-api`
  trigger (root `/api`) by API, and made the workers.dev subdomain `koilos`.
  Test push (README) → both builds succeeded, site/API/manage/radio checked
  live. Their repo is now the source: a push to its `main` deploys both; (5) final
  `tools/r2copy.py copy`; (6) redirects on our zone: `stream.` → `https://koilos.org`,
  `stream-api.` (path+query kept, 308 for POST) and `r2.oitzerhanigunim.org`
  → the koilos names; Yoel updates Tel Tech 2‑5‑6 and the speakers anyway;
  (7) weeks later, with the owner's OK: delete our worker routes/bucket,
  archive this repo. **R2 copied
  2026-11-24** (owner: "יא, קאפיר"): bucket `stream` (ENAM) in the Koilos
  account now holds all 3142 files / 21.32 GB with Content-Type and
  `lufs`/`peak` metadata (`tools/r2copy.py verify`: 0 missing, 0 extra).
  Our bucket untouched. Re-run `tools/r2copy.py copy` right before the switch
  to pick up later uploads. Workers plan for their account still open:
  free may be too tight for `/radio` (CPU); Workers Paid is $5/month — owner
  to check which plan our account has. Zone `koilos.org` is
  **pending**, Cloudflare nameservers `eleanor.ns.cloudflare.com` /
  `ken.ns.cloudflare.com`. DNS check 2026-11-23: all 5 Google MX, SPF and
  DKIM (matches the public one) are there, DNS only. The 4 apex A records,
  `www` and `_domainconnect` (Squarespace) were Proxied; switched to DNS
  only by Claude on the owner's "יא, טויש" (2026-11-23). All 13 records are
  now DNS only — the zone is ready for step 7.- **Hand the code to Koilos** (owner, 2026-11-24: "איך וויל זיי געבן די
  גאנצע גיט האב רעפא … זיכער מאכן אז עס האט נישט קיין שום קיס און קיין שום
  סיקרעטס וואס פארבינדט זיי צום עכטן אוצר הניגונים ריפאו"). Audit of all 104
  commits (all branches), 2026-11-24: **no secrets** — no API tokens, keys,
  passwords, account ids or token ids; worker secrets live only in Cloudflare.
  Not secret but tied to us: our domains (`CNAME`, `wrangler.jsonc` routes,
  `stream-api.`/`r2.oitzerhanigunim.org` in `index.html`, `manage/index.html`,
  `worker.js`, `STATIONS.md`), our GA4 id and Cloudflare Web Analytics beacon
  token in `index.html`, `FEEDBACK_FROM` on our domain, the footer credit,
  `tools/r2copy.py` (OITZER_* env names), and the docs (our other workers,
  the sister repo, billing remarks, owner's notes). The history also carries
  the committers' personal e-mails and old notes (e.g. a third party's
  address). Suggested: give them a **fresh repo with one commit** (no
  history), made at switch time with their domains and their analytics, docs
  trimmed to what they need — not a transfer of this repo. Owner chose it
  ("יא, מאך א ריינעם רעפא", 2026-11-24): `tools/make-koilos-repo.py OUT`
  builds it (one commit by "Koilos <music@koilos.org>", 9 files: site,
  /manage, worker, its README/STATIONS, wrangler.jsonc with only
  `stream-api.koilos.org`, CNAME `stream.koilos.org`, a short README; no GA4,
  no CF beacon; feedback from `noreply@koilos.org`; fails if any tie to us is
  left). The footer credit "פראיעקט דורך אוצר הניגונים" is kept on purpose
  (`--no-credit` drops it). Run it at switch time, then push to their repo.
  Waiting on their GitHub account.
- **The switch (2026-11-25, owner: "יא, טויש די לינקס").** Done: final
  `tools/r2copy.py copy` (15 new files; their bucket also keeps one Chanukah
  file, "ויהיו זרעי - וויזניץ", that was deleted from ours after the first
  copy); old site → redirect pages on GitHub Pages (`index.html`,
  `404.html`, `manage/index.html` → same path on koilos.org). A Cloudflare
  Redirect Rule would be a true 301 but the token has no Rulesets permission
  on oitzerhanigunim.org. **Not redirected on purpose:**
  `stream-api.oitzerhanigunim.org` keeps serving (from our bucket, same files
  as theirs) until Yoel moves Tel Tech 2‑5‑6 and the office speakers to
  `stream-api.koilos.org` — a redirect could silence the hotline if Tel
  Tech doesn't follow redirects. **`r2.oitzerhanigunim.org` and our `stream`
  bucket must stay:** the main site uses them — `worker.js` "R2 bucket folder
  (r2:prefix)" import (editors, `env.stream`, links stored as
  `r2.oitzerhanigunim.org/...`) and the maintenance-mode speaker
  (`js/page-home-info.js` `MAINTENANCE_STREAM_API`/`_R2`). Check whether
  recordings in the main DB point at `r2.oitzerhanigunim.org` before ever
  deleting the bucket.
