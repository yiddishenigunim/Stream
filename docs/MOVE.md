# Moving the stream site to the partner's own domain and R2

Written 2026-11-19, when the owner (after a long talk with Koilos) asked what
it would take to move the whole stream site off `oitzerhanigunim.org` to the
partner's own domain, and to move the R2 files to the partner's own account.
**Not decided yet** — see `docs/OPEN.md`. Example names below use
`stream.koilos.org`; replace with whatever they pick.

## koilos.org today (public DNS, checked 2026-11-20)

- Registered at **Squarespace** (ex-Google Domains; nameservers
  `ns-cloud-a1…a4.googledomains.com`).
- **DNSSEC is on** (a DS record exists). Turn DNSSEC **off** at Squarespace
  and wait for the DS to disappear *before* switching nameservers to
  Cloudflare, or the whole domain — mail included — stops resolving.
- **Mail = Google Workspace**: MX `aspmx.l.google.com` (1), `alt1/alt2` (5),
  `alt3/alt4` (10); SPF TXT `v=spf1 include:_spf.google.com ~all`; DKIM TXT at
  `google._domainkey`. Cloudflare's import usually misses the DKIM name —
  check it is there, all MX/TXT set to *DNS only*.
- **Website = Squarespace**: apex A `198.49.23.144/145`,
  `198.185.159.144/145`; `www` CNAME `ext-sq.squarespace.com`. Keep them
  *DNS only* (grey cloud) so Squarespace keeps serving its site and cert.
- No `stream.` record yet.

**Plan changed 2026-11-23:** Yoel (Office | Koilos) opens the Cloudflare
account himself with their card, adds `koilos.org` (free plan, quick scan),
checks the records above (DKIM added by hand if missing, Squarespace A/`www`
set to DNS only), turns DNSSEC off in Squarespace, waits a day, switches the
nameservers, and invites the owner as Super Administrator. Then the owner
does the rest of this file. Earlier plan (2026-11-19): the owner sets up a
Cloudflare account for them, adds `koilos.org` (free plan), checks the imported records against the
list above, and on a call the partner's office changes the nameservers in
Squarespace (Domains → koilos.org → DNS → Nameservers → custom) to the two
Cloudflare gives. The registration can stay at Squarespace.

## What the partner has to bring

1. **The hostname** — e.g. `stream.koilos.org` for the site, plus two helper
   names on the same domain: `stream-api.koilos.org` (the worker) and
   `r2.koilos.org` (public files). Any names work; they only need to be on a
   domain they control.
2. **The domain on Cloudflare.** A Worker custom domain and an R2 custom domain
   both need the zone (`koilos.org`) to be active in a Cloudflare account, i.e.
   the domain's nameservers point to Cloudflare (free plan is enough). That
   means a login at their registrar. **Copy every existing DNS record first —
   above all the MX/TXT records, or `music@koilos.org` stops receiving mail.**
   (koilos.org showed a Squarespace placeholder on 2026-11-19.)
3. **Their own Cloudflare account** with a payment card (R2 storage and, if
   `/radio` grows, Workers Paid $5/month). They invite the owner as a member
   (Administrator) — no shared password.
4. **R2 API tokens** for the copy (see below): one in their account,
   *Object Read & Write* on the new bucket. Shared privately, never in the repo.
5. **GitHub** — either a GitHub account to transfer this repo to, or agree that
   the code stays in `yiddishenigunim/stream` and only the deploy targets move.
6. **Mail for the feedback form** — a Resend account with `koilos.org`
   verified (or keep sending through ours from `noreply@oitzerhanigunim.org`).
7. **Google account** for analytics, if they want the GA4 property
   (`G-MVW6S6P1XP`) transferred to them or a new one.
8. **Tel Tech portal access** (`ivr.teltech.info`, menu 2‑5‑6) and the office
   speakers' IT person (Music Assistant), to swap the station URLs on the day.
9. **Their original logo file** (SVG / large PNG) — not for the move itself,
   but for a sharp logo background.

## Every place in the code tied to the domain/account

| File | What to change |
| --- | --- |
| `CNAME` | the new site hostname |
| `index.html` | `R2_BASE_URL`, `API_URL`; GA4 id (3 places, `G-MVW6S6P1XP`); Cloudflare Web Analytics token (`data-cf-beacon`, it belongs to our account); footer "פראיעקט דורך אוצר הניגונים" link if wanted |
| `manage/index.html` | `MANAGE_API` default (`https://stream-api.oitzerhanigunim.org`) |
| `manage/worker.js` | `R2_PUBLIC_BASE` (used by `/playlist.m3u`); `FEEDBACK_FROM` (must be on a domain verified in the Resend account the key belongs to) |
| `wrangler.jsonc` | `routes` (new hostnames), `bucket_name` if renamed; the account is whichever Cloudflare account Workers Builds runs in |
| `manage/STATIONS.md`, `manage/README.md` | the 17 station URLs |
| Worker secrets | `RESEND_API_KEY` (and `ADMIN_TOKEN` if ever set) — secrets don't move with the code; set them again in the new account |

## Copying R2 (account → account)

R2 has no "move bucket to another account". Copy it:

1. In their account create the bucket (e.g. `stream`) and connect its public
   custom domain (`r2.koilos.org`). Don't use the `r2.dev` URL for production
   — it is rate-limited.
2. Make an R2 API token on each side (ours: read-only on `stream`; theirs:
   read & write on the new bucket). Each gives an Access Key ID, a Secret, and
   the endpoint `https://<account-id>.r2.cloudflarestorage.com`.
3. Copy with **rclone** (two S3 remotes, `provider = Cloudflare`):
   `rclone sync old:stream new:stream -M --progress --transfers 16 --checksum`
   - **`-M` is required**: the loudness values (`lufs`, `peak`) live in each
     object's custom metadata; without it *Even volume* is lost and would have
     to be re-run from `/manage`.
   - R2 egress is free; the copy just streams through the machine running it.
   - Run it again right before the switch to pick up late uploads, and check
     counts/sizes match (`rclone size` on both).
   - Alternative: Cloudflare's *Super Slurper* (R2 → Data Migration) in their
     account, pointed at our bucket as an S3-compatible source — verify that it
     keeps custom metadata before relying on it.
4. Keys stay the same (folder/file names), so nothing in the code changes for
   the files except the public hostname.

### How it was actually done (2026-11-24)

No rclone in the container (downloading a binary was blocked), so
`tools/r2copy.py` does it with the standard library over R2's S3 API. It uses
one **user** API token that has R2 on both accounts; S3 credentials are
derived from it (Access Key ID = the token's id, Secret = SHA-256 of the
token value). It copies Content-Type and every `x-amz-meta-*` (= the worker's
`customMetadata`: `lufs`, `peak`), skips files already there with the same
size, and `verify` compares the lists and spot-checks metadata. 12 parallel
transfers moved 21 GB in about an hour.

## The switch, in order (no downtime)

1. Their zone active on Cloudflare; bucket copied; worker deployed in their
   account on the new hostnames (Workers Builds connected to the repo) with the
   R2 binding and secrets; verify `GET https://stream-api.koilos.org/?folder=…`
   and `/stations`.
2. Change the code constants above on a branch; point GitHub Pages at the new
   `CNAME`; add the DNS record `stream` → `<github-user>.github.io` in their
   zone; wait for the Pages certificate.
3. Merge. Then update the Tel Tech portal and the office speakers to the new
   station URLs.
4. On **our** zone add a Redirect Rule `stream.oitzerhanigunim.org/*` →
   `https://stream.koilos.org/$1` (301), and keep the old worker and bucket
   running a few weeks for anything still pointing at
   `stream-api.oitzerhanigunim.org` / `r2.oitzerhanigunim.org`. Only after the
   hotline and speakers are confirmed on the new URLs: remove the old routes,
   then (with the owner's OK) empty and delete the old bucket.
