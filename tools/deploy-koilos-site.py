#!/usr/bin/env python3
"""Upload the site's static pages to Koilos's Cloudflare account as the Worker
`koilos-site` (Workers static assets, no script), served on koilos.org.

Owner 2026-11-24: "https://koilos.org/ — מאך אז דאס זאל זיין די סטרים".
Their own GitHub repo does not exist yet, so the pages go up by API: only
index.html and manage/index.html (no README, no wrangler.jsonc — nothing else
is public). Their API worker `nigunim-api` stays separate on
stream-api.koilos.org.

    python3 tools/deploy-koilos-site.py SITE_DIR   # the make-koilos-repo.py output

Env: OITZER_CF_API_TOKEN (a user token with Workers Scripts Edit on their
account); the account is the one named "koilos" (or KOILOS_CF_ACCOUNT_ID).
Hooking up koilos.org / www as custom domains is a separate step.
"""
import base64, hashlib, json, mimetypes, os, sys, urllib.request, uuid

TOKEN = os.environ['OITZER_CF_API_TOKEN']
API = 'https://api.cloudflare.com/client/v4'
SCRIPT = 'koilos-site'
FILES = ['index.html', 'manage/index.html']  # under SITE_DIR/site/


def call(method, path, body=None, headers=None, token=TOKEN, raw=False):
    h = {'Authorization': 'Bearer ' + token, **(headers or {})}
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(API + path, data=body, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {path}: HTTP {e.code} {e.read()[:400]!r}')
    d = json.load(r)
    if not d.get('success', True):
        sys.exit(f'{method} {path}: {d.get("errors")}')
    return d


def multipart(fields):
    """fields: list of (name, filename|None, content_type, bytes)."""
    b = uuid.uuid4().hex
    out = b''
    for name, fname, ctype, data in fields:
        disp = f'form-data; name="{name}"' + (f'; filename="{fname}"' if fname else '')
        out += f'--{b}\r\nContent-Disposition: {disp}\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b'\r\n'
    return out + f'--{b}--\r\n'.encode(), f'multipart/form-data; boundary={b}'


def main(site):
    acct = os.environ.get('KOILOS_CF_ACCOUNT_ID') or [
        a['id'] for a in call('GET', '/accounts')['result'] if 'koilos' in a['name'].lower()][0]

    blobs, manifest = {}, {}
    for rel in FILES:
        data = open(os.path.join(site, 'site', rel), 'rb').read()
        ext = os.path.splitext(rel)[1]
        h = hashlib.sha256(base64.b64encode(data) + ext.lstrip('.').encode()).hexdigest()[:32]
        blobs[h] = (rel, data)
        manifest['/' + rel] = {'hash': h, 'size': len(data)}

    sess = call('POST', f'/accounts/{acct}/workers/scripts/{SCRIPT}/assets-upload-session',
                {'manifest': manifest})['result']
    jwt = sess['jwt']
    for bucket in sess.get('buckets') or []:
        fields = []
        for h in bucket:
            rel, data = blobs[h]
            ctype = mimetypes.guess_type(rel)[0] or 'application/octet-stream'
            fields.append((h, h, ctype, base64.b64encode(data)))
        body, ctype = multipart(fields)
        res = call('POST', f'/accounts/{acct}/workers/assets/upload?base64=true', body,
                   {'Content-Type': ctype}, token=jwt)
        jwt = (res.get('result') or {}).get('jwt') or jwt

    meta = {'compatibility_date': '2025-01-01',
            'assets': {'jwt': jwt, 'config': {'html_handling': 'auto-trailing-slash',
                                               'not_found_handling': 'none'}}}
    body, ctype = multipart([('metadata', None, 'application/json', json.dumps(meta).encode())])
    call('PUT', f'/accounts/{acct}/workers/scripts/{SCRIPT}', body, {'Content-Type': ctype})
    print(f'deployed {SCRIPT}: {", ".join(FILES)}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
