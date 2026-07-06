/**
 * nigunim-api worker  —  streaming API + management API (for /manage)
 *
 * This is your EXISTING nigunim-api worker with the management endpoints
 * added. Paste it over the current worker code (Cloudflare → Workers & Pages
 * → nigunim-api → Edit code → select all → paste → Deploy).
 *
 * Nothing about the existing streaming behavior changes:
 *   - GET /?folder=<f>  still lists audio files exactly as before.
 *   - The rate-limit, bot-block, and old-API logic are untouched.
 *
 * The management routes are handled UP FRONT, before the rate-limit/bot/folder
 * logic, so that:
 *   - bulk uploads (many PUTs) are NOT throttled by the 60/min limiter, and
 *   - write methods (PUT/POST) get proper CORS (preflight) responses.
 * They use distinct paths (/list, /object, /delete, /copy, /move, /mkdir,
 * /deletePrefix) so they can never collide with the streaming `/?folder=` call.
 *
 * R2 binding used: env.BUCKET (same as the streaming code).
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'none';
    const requestId = crypto.randomUUID().slice(0, 8); // Short ID for tracking

    // Log every request
    console.log(`[${requestId}] === New Request ===`);
    console.log(`[${requestId}] IP: ${clientIP}`);
    console.log(`[${requestId}] URL: ${url.pathname}${url.search}`);
    console.log(`[${requestId}] User-Agent: ${userAgent.slice(0, 100)}`);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // ───────────────────────────────────────────────────────────────
    //  Management API (used by the /manage page). Handled here, BEFORE
    //  the rate-limit / bot / folder logic below, so bulk uploads aren't
    //  throttled and write routes get proper CORS. Distinct paths — the
    //  streaming `/?folder=` request never enters here.
    // ───────────────────────────────────────────────────────────────
    const managePath = url.pathname.replace(/\/+$/, '') || '/';
    if (MANAGE_PATHS.includes(managePath)) {
      return handleManage(managePath, request, env);
    }

    if (request.method === 'OPTIONS') {
      console.log(`[${requestId}] CORS preflight - OK`);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Very strict rate limit for old Google Drive API calls - 5 per hour per IP
    const action = url.searchParams.get('action');
    const isOldApi = action === 'stream' || action === 'list' || url.searchParams.get('fileId') || url.searchParams.get('folderId');

    if (isOldApi) {
      console.log(`[${requestId}] OLD API CALL BLOCKED - action: ${action}`);
      const oldApiKey = `oldapi:${clientIP}`;

      const cache = caches.default;
      const oldApiResponse = await cache.match(new Request(`https://ratelimit.local/${oldApiKey}`));

      let oldApiCount = 0;
      if (oldApiResponse) {
        oldApiCount = parseInt(await oldApiResponse.text()) || 0;
      }

      // Only allow 5 requests per hour for old API
      if (oldApiCount >= 5) {
        console.log(`[${requestId}] Old API rate limited - count: ${oldApiCount}`);
        return new Response('', {
          status: 429,
          headers: corsHeaders
        });
      }

      // Increment counter - cache for 1 hour
      const newOldApiCount = oldApiCount + 1;
      const oldApiCacheResponse = new Response(newOldApiCount.toString(), {
        headers: { 'Cache-Control': 'max-age=3600' }
      });
      await cache.put(new Request(`https://ratelimit.local/${oldApiKey}`), oldApiCacheResponse);

      return new Response(JSON.stringify({ error: 'API deprecated. Please refresh page.' }), {
        status: 410,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Rate limiting - 60 requests per minute per IP
    const rateLimitKey = `ratelimit:${clientIP}`;

    // Check rate limit using cache
    const cache = caches.default;
    const rateLimitResponse = await cache.match(new Request(`https://ratelimit.local/${rateLimitKey}`));

    let requestCount = 0;
    if (rateLimitResponse) {
      requestCount = parseInt(await rateLimitResponse.text()) || 0;
    }

    console.log(`[${requestId}] Rate limit count: ${requestCount}/60`);

    if (requestCount > 60) {
      console.log(`[${requestId}] RATE LIMITED - count: ${requestCount}`);
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Increment counter
    const newCount = requestCount + 1;
    const cacheResponse = new Response(newCount.toString(), {
      headers: { 'Cache-Control': 'max-age=60' }
    });
    await cache.put(new Request(`https://ratelimit.local/${rateLimitKey}`), cacheResponse);

    // Block common bots
    const userAgentLower = userAgent.toLowerCase();
    const blockedBots = ['bot', 'crawler', 'spider', 'scrapy', 'curl', 'wget', 'python', 'httrack'];
    const matchedBot = blockedBots.find(bot => userAgentLower.includes(bot));
    if (matchedBot) {
      console.log(`[${requestId}] BOT BLOCKED - matched: ${matchedBot}`);
      return new Response(JSON.stringify({ error: 'Blocked' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const folder = url.searchParams.get('folder');

    if (!folder) {
      console.log(`[${requestId}] ERROR - Missing folder parameter`);
      return new Response(JSON.stringify({ error: 'Missing folder parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[${requestId}] Requesting folder: "${folder}"`);

    try {
      const startTime = Date.now();
      const list = await env.BUCKET.list({ prefix: folder + '/' });
      const listTime = Date.now() - startTime;

      console.log(`[${requestId}] R2 list took ${listTime}ms - found ${list.objects.length} objects`);

      const files = list.objects
        .filter(obj => obj.key.match(/\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i))
        .map(obj => ({
          name: obj.key.split('/').pop(),
          key: obj.key,
          size: obj.size
        }));

      console.log(`[${requestId}] SUCCESS - returning ${files.length} audio files`);

      // Log if folder seems empty (potential issue)
      if (files.length === 0) {
        console.log(`[${requestId}] WARNING - No audio files found in folder: "${folder}"`);
        console.log(`[${requestId}] Raw objects found: ${list.objects.map(o => o.key).join(', ').slice(0, 500)}`);
      }

      return new Response(JSON.stringify({ files }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.log(`[${requestId}] ERROR - R2 failed: ${error.message}`);
      console.log(`[${requestId}] Error stack: ${error.stack}`);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Management API — powers the /manage admin page.
   ═══════════════════════════════════════════════════════════════════ */

const MANAGE_PATHS = ['/list', '/object', '/delete', '/copy', '/move', '/mkdir', '/deletePrefix'];

const MANAGE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function mjson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...MANAGE_CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Optional server-side auth. The /manage page uses a client-side PIN only, so
// this is a no-op unless you set a wrangler secret ADMIN_TOKEN and send it from
// the page as `Authorization: Bearer <token>`.
function mAuth(request, env) {
  if (!env.ADMIN_TOKEN) return null;
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return got === env.ADMIN_TOKEN ? null : mjson({ error: 'unauthorized' }, 401);
}

async function handleManage(path, request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: MANAGE_CORS });

  const bucket = env.BUCKET;
  if (!bucket) return mjson({ error: 'R2 bucket not bound (env.BUCKET)' }, 500);

  const url = new URL(request.url);
  const method = request.method;

  // Writes require auth only if ADMIN_TOKEN is configured.
  if (method !== 'GET') {
    const denied = mAuth(request, env);
    if (denied) return denied;
  }

  try {
    // ── Browse one folder level (folders + all files) ──
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
      return mjson({ prefix, folders: [...folders], files });
    }

    // ── Download / preview a file ──
    if (path === '/object' && method === 'GET') {
      const key = url.searchParams.get('key');
      if (!key) return mjson({ error: 'missing key' }, 400);
      const obj = await bucket.get(key);
      if (!obj) return mjson({ error: 'not found' }, 404);
      const headers = new Headers(MANAGE_CORS);
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Cache-Control', 'no-store');
      return new Response(obj.body, { headers });
    }

    // ── Upload / overwrite ──
    if (path === '/object' && method === 'PUT') {
      const key = url.searchParams.get('key');
      if (!key) return mjson({ error: 'missing key' }, 400);
      await bucket.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
      });
      return mjson({ ok: true, key });
    }

    // ── Delete a list of keys ──
    if (path === '/delete' && method === 'POST') {
      const { keys } = await request.json();
      if (!Array.isArray(keys) || !keys.length) return mjson({ error: 'no keys' }, 400);
      for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
      return mjson({ ok: true, deleted: keys.length });
    }

    // ── Copy / move a list of keys into a target folder ──
    if ((path === '/copy' || path === '/move') && method === 'POST') {
      const { from, toPrefix } = await request.json();
      if (!Array.isArray(from) || !from.length || typeof toPrefix !== 'string')
        return mjson({ error: 'bad args' }, 400);
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
      return mjson({ ok: true, results });
    }

    // ── Make an (empty) folder via a placeholder object ──
    if (path === '/mkdir' && method === 'POST') {
      const { prefix } = await request.json();
      if (!prefix) return mjson({ error: 'no prefix' }, 400);
      const key = prefix.replace(/\/?$/, '/') + '.keep';
      await bucket.put(key, new Uint8Array(0));
      return mjson({ ok: true, key });
    }

    // ── Recursively delete everything under a prefix ──
    if (path === '/deletePrefix' && method === 'POST') {
      const { prefix } = await request.json();
      if (!prefix) return mjson({ error: 'no prefix' }, 400);
      let cursor, deleted = 0;
      do {
        const res = await bucket.list({ prefix, cursor, limit: 1000 });
        const keys = res.objects.map((o) => o.key);
        if (keys.length) await bucket.delete(keys);
        deleted += keys.length;
        cursor = res.truncated ? res.cursor : undefined;
      } while (cursor);
      return mjson({ ok: true, deleted });
    }

    return mjson({ error: 'not found', path }, 404);
  } catch (err) {
    return mjson({ error: (err && err.message) || String(err) }, 500);
  }
}
