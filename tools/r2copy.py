#!/usr/bin/env python3
"""Copy every object of R2 bucket SRC (oitzer account) to bucket DST (koilos
account) through the S3 API, keeping Content-Type and custom metadata
(x-amz-meta-*: lufs, peak). Standard library only; SigV4 by hand.
Credentials: one user API token that has R2 on both accounts —
Access Key ID = token id, Secret = sha256(token value).
Usage: python3 tools/r2copy.py check | copy [workers] | verify
Skips keys already in DST with the same size (so it can be re-run).
Env: OITZER_CF_API_TOKEN, OITZER_CF_ACCOUNT_ID (source), optional
KOILOS_CF_ACCOUNT_ID (dest). First full run 2026-11-24: 3142 files,
21.32 GB, 0 failures, metadata spot-checked. See docs/MOVE.md."""
import datetime, hashlib, hmac, json, os, sys, threading, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN = os.environ['OITZER_CF_API_TOKEN']
SRC_ACCT = os.environ['OITZER_CF_ACCOUNT_ID']


def _koilos_account():
    # KOILOS_CF_ACCOUNT_ID if set, else the account whose name has "koilos".
    if os.environ.get('KOILOS_CF_ACCOUNT_ID'):
        return os.environ['KOILOS_CF_ACCOUNT_ID']
    req = urllib.request.Request('https://api.cloudflare.com/client/v4/accounts',
                                 headers={'Authorization': 'Bearer ' + TOKEN})
    accts = json.load(urllib.request.urlopen(req, timeout=30))['result']
    return [a['id'] for a in accts if 'koilos' in a['name'].lower()][0]


DST_ACCT = _koilos_account()
BUCKET = 'stream'
NS = '{http://s3.amazonaws.com/doc/2006-03-01/}'


def token_id():
    req = urllib.request.Request('https://api.cloudflare.com/client/v4/user/tokens/verify',
                                 headers={'Authorization': 'Bearer ' + TOKEN})
    return json.load(urllib.request.urlopen(req, timeout=30))['result']['id']


AK = token_id()
SK = hashlib.sha256(TOKEN.encode()).hexdigest()


def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def s3(acct, method, key='', query=None, body=b'', headers=None):
    host = f'{acct}.r2.cloudflarestorage.com'
    path = '/' + BUCKET + ('/' + urllib.parse.quote(key, safe='/~') if key else '')
    q = sorted((query or {}).items())
    qs = '&'.join(f"{urllib.parse.quote(k, safe='~')}={urllib.parse.quote(str(v), safe='~')}" for k, v in q)
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate, date = now.strftime('%Y%m%dT%H%M%SZ'), now.strftime('%Y%m%d')
    payload = hashlib.sha256(body).hexdigest()
    h = {'host': host, 'x-amz-date': amzdate, 'x-amz-content-sha256': payload}
    for k, v in (headers or {}).items():
        h[k.lower()] = v.strip()
    signed = ';'.join(sorted(h))
    canon = '\n'.join([method, path, qs, ''.join(f'{k}:{h[k]}\n' for k in sorted(h)), signed, payload])
    scope = f'{date}/auto/s3/aws4_request'
    sts = '\n'.join(['AWS4-HMAC-SHA256', amzdate, scope, hashlib.sha256(canon.encode()).hexdigest()])
    k = _sign(_sign(_sign(_sign(('AWS4' + SK).encode(), date), 'auto'), 's3'), 'aws4_request')
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    h['authorization'] = f'AWS4-HMAC-SHA256 Credential={AK}/{scope}, SignedHeaders={signed}, Signature={sig}'
    del h['host']
    url = f'https://{host}{path}' + ('?' + qs if qs else '')
    req = urllib.request.Request(url, data=body if method == 'PUT' else None, method=method, headers=h)
    return urllib.request.urlopen(req, timeout=300)


def list_all(acct):
    out, token = {}, None
    while True:
        q = {'list-type': '2', 'max-keys': '1000'}
        if token:
            q['continuation-token'] = token
        root = ET.fromstring(s3(acct, 'GET', query=q).read())
        for c in root.findall(NS + 'Contents'):
            out[c.find(NS + 'Key').text] = int(c.find(NS + 'Size').text)
        if root.findtext(NS + 'IsTruncated') == 'true':
            token = root.findtext(NS + 'NextContinuationToken')
        else:
            return out


def copy_one(key):
    for attempt in range(4):
        try:
            r = s3(SRC_ACCT, 'GET', key)
            body = r.read()
            hdr = {k: v for k, v in r.headers.items() if k.lower().startswith('x-amz-meta-')}
            for k in ('Content-Type', 'Cache-Control', 'Content-Disposition', 'Content-Encoding', 'Content-Language'):
                if r.headers.get(k):
                    hdr[k] = r.headers[k]
            s3(DST_ACCT, 'PUT', key, body=body, headers=hdr).read()
            return len(body)
        except Exception as e:  # retry network hiccups
            err = e
    raise err


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    src = list_all(SRC_ACCT)
    dst = list_all(DST_ACCT)
    print(f'source: {len(src)} files, {sum(src.values())/1e9:.2f} GB | dest: {len(dst)} files, {sum(dst.values())/1e9:.2f} GB', flush=True)
    todo = [k for k in sorted(src) if dst.get(k) != src[k]]
    if cmd == 'check':
        print('to copy:', len(todo))
        return
    if cmd == 'verify':
        extra = [k for k in dst if k not in src]
        print('missing/different in dest:', len(todo), '| extra in dest:', len(extra))
        # spot-check metadata on a few files
        import random
        for k in random.sample(sorted(src), min(5, len(src))):
            a = {h: v for h, v in s3(SRC_ACCT, 'HEAD', k).headers.items() if h.lower().startswith(('x-amz-meta-', 'content-type'))}
            b = {h: v for h, v in s3(DST_ACCT, 'HEAD', k).headers.items() if h.lower().startswith(('x-amz-meta-', 'content-type'))}
            print('meta same' if {x.lower(): y for x, y in a.items()} == {x.lower(): y for x, y in b.items()} else 'META DIFF', a, b)
        return
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    done = done_bytes = 0
    lock = threading.Lock()
    fails = []
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(copy_one, k): k for k in todo}
        for f in as_completed(futs):
            try:
                n = f.result()
                with lock:
                    done += 1
                    done_bytes += n
            except Exception as e:
                fails.append((futs[f], repr(e)[:150]))
            if done % 50 == 0 or done == len(todo):
                print(f'{done}/{len(todo)} files, {done_bytes/1e9:.2f} GB, fails {len(fails)}', flush=True)
    print('DONE', done, 'copied,', len(fails), 'failed')
    for k, e in fails[:20]:
        print('FAIL', k, e)


if __name__ == '__main__':
    main()
