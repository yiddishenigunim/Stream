/**
 * Management API Worker for the Nigunim stream.
 *
 * Standalone worker that gives the /manage page read + write access to the
 * R2 bucket: browse folders, upload, delete, copy, move, and make folders.
 * It is intentionally SEPARATE from the public streaming API (stream-api),
 * so deploying it can never break the read-only endpoint the main site uses.
 *
 * Bind your R2 bucket as `BUCKET` (see manage/README.md and wrangler.toml).
 *
 * Endpoints (all JSON unless noted):
 *   GET  /list?prefix=<p>          -> { prefix, folders:[..], files:[{key,name,size,uploaded}] }
 *   GET  /object?key=<k>           -> raw file bytes (preview / download)
 *   PUT  /object?key=<k>  (body)   -> { ok, key }               upload/overwrite
 *   POST /delete   {keys:[..]}     -> { ok, deleted }
 *   POST /copy     {from:[..], toPrefix} -> { ok, results }
 *   POST /move     {from:[..], toPrefix} -> { ok, results }
 *   POST /mkdir    {prefix}        -> { ok, key }               empty folder placeholder
 *   POST /deletePrefix {prefix}    -> { ok, deleted }           recursive folder delete
 *
 * NOTE on auth: per the current design the /manage page guards access with a
 * client-side PIN only. That PIN is visible to anyone who views the page, so
 * this worker is effectively open to anyone who finds its URL. If you later
 * want real protection, set a secret and uncomment the requireAuth() check
 * below (and send the same token from the page as an `Authorization` header).
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Optional server-side auth. To enable: set env.ADMIN_TOKEN (a wrangler secret)
// and have the page send `Authorization: Bearer <token>`.
function requireAuth(request, env) {
  if (!env.ADMIN_TOKEN) return null; // auth disabled
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (got !== env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const bucket = env.BUCKET;
    if (!bucket) return json({ error: 'R2 bucket not bound (set BUCKET binding)' }, 500);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    // Enforce auth on write routes (no-op unless ADMIN_TOKEN is set).
    if (method !== 'GET') {
      const denied = requireAuth(request, env);
      if (denied) return denied;
    }

    try {
      // ── Browse one folder level ──
      if (path === '/list' && method === 'GET') {
        const prefix = url.searchParams.get('prefix') || '';
        const folders = new Set();
        const files = [];
        let cursor;
        do {
          const res = await bucket.list({ prefix, delimiter: '/', cursor, limit: 1000 });
          for (const p of res.delimitedPrefixes) folders.add(p);
          for (const o of res.objects) {
            const name = o.key.slice(prefix.length);
            if (name === '' || name === '.keep') continue; // folder placeholder
            files.push({ key: o.key, name, size: o.size, uploaded: o.uploaded });
          }
          cursor = res.truncated ? res.cursor : undefined;
        } while (cursor);
        return json({ prefix, folders: [...folders], files });
      }

      // ── Download / preview ──
      if (path === '/object' && method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key) return json({ error: 'missing key' }, 400);
        const obj = await bucket.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        const headers = new Headers(CORS);
        obj.writeHttpMetadata(headers);
        headers.set('etag', obj.httpEtag);
        headers.set('Cache-Control', 'no-store');
        return new Response(obj.body, { headers });
      }

      // ── Upload / overwrite ──
      if (path === '/object' && method === 'PUT') {
        const key = url.searchParams.get('key');
        if (!key) return json({ error: 'missing key' }, 400);
        await bucket.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
        });
        return json({ ok: true, key });
      }

      // ── Delete a list of keys ──
      if (path === '/delete' && method === 'POST') {
        const { keys } = await request.json();
        if (!Array.isArray(keys) || !keys.length) return json({ error: 'no keys' }, 400);
        for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
        return json({ ok: true, deleted: keys.length });
      }

      // ── Copy / move a list of keys into a target folder ──
      if ((path === '/copy' || path === '/move') && method === 'POST') {
        const { from, toPrefix } = await request.json();
        if (!Array.isArray(from) || !from.length || typeof toPrefix !== 'string')
          return json({ error: 'bad args' }, 400);
        const dstFolder = toPrefix ? toPrefix.replace(/\/?$/, '/') : '';
        const results = [];
        const movedOk = [];
        for (const srcKey of from) {
          const dstKey = dstFolder + srcKey.slice(srcKey.lastIndexOf('/') + 1);
          if (dstKey === srcKey) { results.push({ srcKey, skipped: true }); continue; }
          const obj = await bucket.get(srcKey);
          if (!obj) { results.push({ srcKey, error: 'not found' }); continue; }
          await bucket.put(dstKey, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
          results.push({ srcKey, dstKey });
          movedOk.push(srcKey);
        }
        if (path === '/move' && movedOk.length) {
          for (let i = 0; i < movedOk.length; i += 1000) await bucket.delete(movedOk.slice(i, i + 1000));
        }
        return json({ ok: true, results });
      }

      // ── Make an (empty) folder via a placeholder object ──
      if (path === '/mkdir' && method === 'POST') {
        const { prefix } = await request.json();
        if (!prefix) return json({ error: 'no prefix' }, 400);
        const key = prefix.replace(/\/?$/, '/') + '.keep';
        await bucket.put(key, new Uint8Array(0));
        return json({ ok: true, key });
      }

      // ── Recursively delete everything under a prefix ──
      if (path === '/deletePrefix' && method === 'POST') {
        const { prefix } = await request.json();
        if (!prefix) return json({ error: 'no prefix' }, 400);
        let cursor, deleted = 0;
        do {
          const res = await bucket.list({ prefix, cursor, limit: 1000 });
          const keys = res.objects.map((o) => o.key);
          if (keys.length) await bucket.delete(keys);
          deleted += keys.length;
          cursor = res.truncated ? res.cursor : undefined;
        } while (cursor);
        return json({ ok: true, deleted });
      }

      return json({ error: 'not found', path }, 404);
    } catch (err) {
      return json({ error: (err && err.message) || String(err) }, 500);
    }
  },
};
