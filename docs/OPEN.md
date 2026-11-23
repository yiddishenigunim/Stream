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
  (a user token of the owner's login, which is now a member of
  "Info@koilos.org's Account"). Checked 2026-11-23: zone `koilos.org` exists
  there, status **pending**, Cloudflare nameservers `eleanor.ns.cloudflare.com`
  / `ken.ns.cloudflare.com`. In the Koilos account the token can only read
  the account and list Workers scripts — **no** DNS (it has no DNS on our own
  zones either), **no** R2, no members/billing/Pages. To work there the owner
  edits that token: add the Koilos account and the `koilos.org` zone as
  resources, with Workers R2 Storage Edit, Workers Scripts Edit, Zone DNS
  Edit, Zone Workers Routes Edit, Zone Read. Still open:
  the exact hostname (e.g. `stream.koilos.org`), GitHub repo ownership, and
  who keeps maintaining it.
