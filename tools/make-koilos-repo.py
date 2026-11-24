#!/usr/bin/env python3
"""Build the clean repo for Koilos from this repo's current files.

The owner (2026-11-24): give Koilos the code as their own, with nothing that
ties it to Oitzer HaNigunim — "יא, מאך א ריינעם רעפא". This makes a NEW git
repo with ONE commit (no history, so no committers' e-mails or old notes):

  * domains → theirs (site on koilos.org itself, API stream-api.koilos.org,
    files r2.koilos.org — change KOILOS_* below if that changes),
  * our GA4 property and our Cloudflare Web Analytics beacon removed (the
    page's Analytics wrapper is a no-op without gtag; a comment shows where to
    add their own),
  * the feedback mail sent from their domain,
  * our internal docs (CLAUDE.md, docs/, tools/) left out; a short README.md
    for them instead.

The footer credit "פראיעקט דורך אוצר הניגונים" stays unless --no-credit is
given. The owner wants nothing left of us (2026-11-24) — build with
--no-credit.

Every edit asserts that its anchor exists, and the result is scanned: any
"oitzer" / "yiddishenigunim" / our ids left (other than the credit) fails
the build. Run at switch time, then push the output to their GitHub repo:

    python3 tools/make-koilos-repo.py OUT_DIR [--no-credit]
"""
import os, re, shutil, subprocess, sys

KOILOS_SITE = 'koilos.org'  # owner 2026-11-24: koilos.org itself is the stream
KOILOS_API = 'stream-api.koilos.org'
KOILOS_R2 = 'r2.koilos.org'
AUTHOR = 'Koilos <music@koilos.org>'

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = ['index.html', 'manage/index.html', 'manage/worker.js', 'manage/README.md',
        'manage/STATIONS.md', 'wrangler.jsonc', '.gitignore']
FORBIDDEN = ['oitzer', 'yiddishenigunim', 'oytzer', 'G-MVW6S6P1XP', 'c549cb739190444da167bf2f643cb147']
CREDIT = '<p>פראיעקט דורך <a href="https://oitzerhanigunim.org/" target="_blank">אוצר הניגונים</a></p>'


def edit(text, old, new, count=1, path=''):
    n = text.count(old)
    if n < 1 or (count == 1 and n != 1):
        sys.exit(f'{path}: anchor found {n}x, expected {"1" if count == 1 else ">=1"}: {old[:70]!r}')
    return text.replace(old, new) if count != 1 else text.replace(old, new, 1)


def cut_between(text, start, end, repl, path):
    i = text.find(start)
    j = text.find(end, i)
    if i < 0 or j < 0:
        sys.exit(f'{path}: block not found: {start[:50]!r}')
    return text[:i] + repl + text[j + len(end):]


def build(out, no_credit):
    if os.path.exists(out):
        sys.exit(f'{out} exists — pick a new directory')
    os.makedirs(out)
    files = {p: open(os.path.join(SRC, p), encoding='utf-8').read() for p in KEEP}

    p = 'index.html'; t = files[p]
    t = cut_between(t, '    <!-- Google Analytics (gtag.js).', '    </script>\n',
                    '    <!-- Analytics: to use Google Analytics, add the GA4 gtag.js snippet\n'
                    '         here (your own G-… id). The page\'s Analytics.* calls send\n'
                    '         events once gtag exists and do nothing without it. -->\n', p)
    t = re.sub(r"\n?\s*<!-- Cloudflare Web Analytics -->.*?<!-- End Cloudflare Web Analytics -->", '', t, count=1, flags=re.S)
    t = edit(t, "const R2_BASE_URL = 'https://r2.oitzerhanigunim.org';", f"const R2_BASE_URL = 'https://{KOILOS_R2}';", path=p)
    t = edit(t, "const API_URL = 'https://stream-api.oitzerhanigunim.org';", f"const API_URL = 'https://{KOILOS_API}';", path=p)
    if no_credit:
        t = edit(t, '            ' + CREDIT + '\n', '', path=p)
    files[p] = t

    p = 'manage/index.html'
    files[p] = edit(files[p], "'https://stream-api.oitzerhanigunim.org'", f"'https://{KOILOS_API}'", path=p)

    p = 'manage/worker.js'; t = files[p]
    t = edit(t, "const FEEDBACK_FROM = 'קולות סטרים <noreply@oitzerhanigunim.org>';",
             "const FEEDBACK_FROM = 'קולות סטרים <noreply@koilos.org>';", path=p)
    t = edit(t, "const R2_PUBLIC_BASE = 'https://r2.oitzerhanigunim.org';", f"const R2_PUBLIC_BASE = 'https://{KOILOS_R2}';", path=p)
    t = edit(t, "headerSafe(folder.split('/').pop() || 'Oitzer HaNigunim')", "headerSafe(folder.split('/').pop() || 'Koilos')", path=p)
    t = edit(t, "'icy-description': 'Oitzer HaNigunim'", "'icy-description': 'Koilos'", path=p)
    files[p] = t

    p = 'wrangler.jsonc'; t = files[p]
    t = edit(t, '''    { "pattern": "stream-api.oitzerhanigunim.org", "custom_domain": true },
    { "pattern": "nigunim-api.oitzerhanigunim.org", "custom_domain": true }''',
             f'''    {{ "pattern": "{KOILOS_API}", "custom_domain": true }}''', path=p)
    t = edit(t, '''  // Both hostnames the Worker already answers on. stream-api is the one the
  // website and /manage call, so losing it takes the site down with it.''',
             '''  // The hostname the website and /manage call; losing it takes the site
  // down with it.''', path=p)
    files[p] = t

    p = 'manage/README.md'; t = files[p]
    t = edit(t, 'https://stream.oitzerhanigunim.org/manage', f'https://{KOILOS_SITE}/manage', path=p)
    t = edit(t, '''  domain verified in that Resend account (`noreply@oitzerhanigunim.org` is
  the one the main site already sends from).''', '''  domain verified in that Resend account (`koilos.org`).''', path=p)
    t = edit(t, 'stream-api.oitzerhanigunim.org', KOILOS_API, count=0, path=p)
    files[p] = t

    p = 'manage/STATIONS.md'
    files[p] = edit(files[p], 'stream-api.oitzerhanigunim.org', KOILOS_API, count=0, path=p)

    files['CNAME'] = KOILOS_SITE + '\n'
    files['README.md'] = README.format(site=KOILOS_SITE, api=KOILOS_API, r2=KOILOS_R2)

    bad = []
    for path, text in files.items():
        scan = text.replace(CREDIT, '') if path == 'index.html' else text
        for word in FORBIDDEN:
            for m in re.finditer(re.escape(word), scan, re.I):
                line = scan.count('\n', 0, m.start()) + 1
                bad.append(f'{path}:{line}: {word}')
    if bad:
        shutil.rmtree(out)
        sys.exit('left-over ties to us:\n' + '\n'.join(bad))

    for path, text in files.items():
        full = os.path.join(out, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8') as f:
            f.write(text)
    name, email = AUTHOR[:-1].split(' <')
    env = {**os.environ, 'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email,
           'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
    run = lambda *a: subprocess.run(['git', *a], cwd=out, env=env, check=True, capture_output=True)
    run('init', '-q', '-b', 'main')
    run('add', '-A')
    run('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'קולות סטרים — the stream site, /manage and the worker')
    print(f'built {out}: {len(files)} files, one commit by {AUTHOR}')


README = '''# קולות סטרים

The Koilos streaming site: **https://{site}** — a Yiddish web player that
plays nigunim from Cloudflare R2, plus `/manage` (upload and delete files) and
`/radio` station URLs for speakers and the phone line.

## What is where

| Path | What |
| --- | --- |
| `index.html` | The whole public player (one file, no build). |
| `manage/index.html` | `/manage` — the admin page for the files. |
| `manage/worker.js` | The Cloudflare Worker (`{api}`): the site's file list (`GET /?folder=`), the `/manage` routes, `/radio`, `/playlist.m3u`, `/stations`, `POST /feedback`. |
| `manage/README.md` | Technical details of `/manage`, the worker, `/radio`, even volume. |
| `manage/STATIONS.md` | Ready-to-paste station URLs. |
| `wrangler.jsonc` | The worker's config — read its comments before changing it. |

## How it runs

- **Site:** GitHub Pages from branch `main`, root; the domain is in `CNAME`.
  A push to `main` is live.
- **Worker:** Cloudflare Workers Builds (Workers & Pages → the worker →
  Settings → Build → connect this repo) deploys `manage/worker.js` on every
  push to `main`, with the R2 bucket `stream` bound as `env.BUCKET`.
- **Files:** R2 bucket `stream`, public at `https://{r2}`.
- **Feedback form:** needs the worker secret `RESEND_API_KEY` (a Resend
  account with `koilos.org` verified). Without it the form opens the
  visitor's mail app instead.
- **Analytics:** none yet — see the comment at the top of `index.html`.
'''

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    build(args[0], '--no-credit' in sys.argv)
