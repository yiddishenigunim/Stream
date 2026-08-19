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
  async fetch(request, env, ctx) {
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

    // ───────────────────────────────────────────────────────────────
    //  Radio API (Music Assistant, Sonos, VLC, …). Also handled here,
    //  BEFORE the rate limiter and the bot blocker below — this is not
    //  optional: Music Assistant is Python/aiohttp based, so its
    //  User-Agent matches the 'python' entry in `blockedBots` and the
    //  stream would be rejected with a 403 if it fell through.
    // ───────────────────────────────────────────────────────────────
    if (STREAM_PATHS.includes(managePath)) {
      return handleStream(managePath, request, env, ctx);
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

/* ═══════════════════════════════════════════════════════════════════
   Radio API — makes each folder playable as a normal station URL by
   any external player (Music Assistant, Sonos, VLC, …), which the
   browser player can't offer because it shuffles files client-side.

     GET /radio?folder=<f>         continuous audio/mpeg stream
     GET /playlist.m3u?folder=<f>  M3U pointing at the public R2 URLs

   Both are read-only and take the same params:
     folder=<f>   required, same folder string the web player uses
     shuffle=0    play alphabetically instead of shuffled
     gain=<dB>    /radio only — play louder (see "Loudness" below)
   ═══════════════════════════════════════════════════════════════════ */

const STREAM_PATHS = ['/radio', '/playlist.m3u', '/stations'];

/* Friendly station names, so a URL can read ?folder=sfirah instead of eighty
   characters of percent-encoded Hebrew. Names are matched through
   normalizeAlias(), which folds case, spaces, quotes, gershayim and Hebrew
   final-letter forms — so 'ל״ג בעומר', 'lag bomer' and 'lagbaomer' all land
   on the same folder. Anything not listed here is used as a literal path,
   so existing folder=<full path> URLs keep working. */
const STATIONS = [
  { folder: 'שיינע מארשן', names: [
    'marshn', 'marshen', 'marshin', 'marshim', 'marsh', 'march', 'marches', 'marchen', 'marschn',
    'sheinemarshn', 'shainemarshn', 'shaynemarshn', 'sheynemarshn', 'sheynemarshen',
    'sheinemarches', 'sheine', 'shaine', 'shayne', 'sheyne', 'nice', 'beautiful', 'מארשן', 'מארש',
    'מארשען', 'מארשין', 'שיינע', 'שיינע מארשן', 'שייני מארשן'] },

  { folder: 'לעבעדיג', names: [
    'lebedik', 'lebedig', 'lebedick', 'lebbedik', 'lebbedig', 'levedik', 'levedig', 'libedik',
    'libedig', 'leibedik', 'leybedik', 'laybedik', 'lebidig', 'lebidik', 'lively', 'fast', 'upbeat',
    'happy', 'dance', 'dancing', 'simcha', 'simche', 'freilich', 'freilech', 'freilach', 'frailich',
    'freylach', 'freylech', 'fraylich', 'לעבעדיג', 'לעבעדיק', 'לעבידיג', 'לעבידיק', 'פריילעך',
    'פריילאך', 'פריילעכע', 'שמחה', 'lebedigenigunim', 'lebedikenigunim', 'lebedigeniggunim',
    'lebedignigunim', 'lebedige', 'לעבעדיגע ניגונים', 'לעבעדיגע', 'לעבעדיגע נגונים'] },

  { folder: 'שטייטע', names: [
    'shteyt', 'shteyte', 'shteyteh', 'shteyta', 'shteytig', 'shteytige', 'shteit', 'shteite',
    'shteiteh', 'shteitig', 'shtayte', 'shtaite', 'shtaiteh', 'shtey', 'shtei', 'shtaytig', 'slow',
    'slowsongs', 'calm', 'quiet', 'gentle', 'soft', 'ruhig', 'שטייטע', 'שטייט', 'שטייטי', 'שטיטע',
    'שטייטיגע', 'שטייטעדיג', 'לאנגזאם', 'shteytenigunim', 'shteitenigunim', 'shteytnigunim',
    'shtaytenigunim', 'שטייטע ניגונים', 'שטייטע נגונים'] },

  { folder: 'בלויז מוזיק', names: [
    'music', 'muzik', 'musik', 'muzic', 'miuzik', 'musics', 'onlymusic', 'musiconly', 'justmusic',
    'bloyzmuzik', 'bloizmuzik', 'blouzmuzik', 'bloyzmusic', 'bloyz', 'bloiz', 'blouz',
    'instrumental', 'instrumentals', 'instruments', 'novocal', 'novocals', 'novoice', 'nosinging',
    'background', 'backgroundmusic', 'בלויז מוזיק', 'מוזיק', 'בלויז', 'מיוזיק', 'מוזיקא',
    'אינסטרומענטאל'] },

  { folder: 'מועדים וזמנים/ספירה/וואכן', names: [
    'sfirah', 'sfira', 'sfirat', 'sfiras', 'sefirah', 'sefira', 'sefiras', 'sefirat', 'sphira',
    'sphirah', 'sfiro', 'sefiro', 'sfeirah', 'omer', 'haomer', 'sefirasomer', 'sefiratomer',
    'sfirasomer', 'counting', 'countingomer', 'vocal', 'vocals', 'vocali', 'vocaly', 'vocaln',
    'vokal', 'vokals', 'vokali', 'vokaln', 'vokalen', 'vocalen', 'vocalonly', 'acapella',
    'acappella', 'akapela', 'akapella', 'vochn', 'vokhn', 'vochen', 'vokhen', 'wochn', 'wochen',
    'voch', 'woch', 'weekday', 'weekdays', 'weekdaysongs', 'ספירה', 'ספירת העומר', 'העומר',
    'וואקאלן', 'וואקאל', 'וואקאלע', 'וואכן', 'וואך', 'וואכען', 'vokalish', 'vocalish', 'vokalisch',
    'vocalisch', 'vokolish', 'vokalis', 'vocalis', 'וואקאליש', 'וואקאליסט', 'א קאפעלא'] },

  { folder: 'מועדים וזמנים/בין המצרים', names: [
    'beinhametzarim', 'beinhametzorim', 'beinhametzurim', 'beinhamitzarim', 'beinhamitzorim',
    'benhametzarim', 'benhamitzarim', 'bainhametzarim', 'baynhametzarim', 'beynhametzarim',
    'beinhametzarem', 'bienhametzarim', 'binhametzarim', 'bhm', 'bein', 'beyn', 'threeweeks',
    'threeweek', '3weeks', '3week', 'thethreeweeks', 'drayvochn', 'dreivochn', 'draivochn',
    'dreiwochen', 'drayvokhn', 'ninedays', '9days', 'tishabav', 'tishabov', 'tishaboov', 'tishaav',
    'tishabeav', 'בין המצרים', 'המצרים', 'בין', 'דריי וואכן', 'תשעה באב', 'ט באב', 'תשעת הימים'] },

  { folder: 'מועדים וזמנים/ניגוני שבק', names: [
    'shabbos', 'shabos', 'shabbas', 'shabas', 'shabbes', 'shabbess', 'shabes', 'shabbat', 'shabat',
    'shabbath', 'shabath', 'sabbath', 'shobbos', 'shobos', 'shabosdike', 'shabbosdik',
    'niguneishabbos', 'nigunishabbos', 'nigneishabbos', 'shabbosnigunim', 'shabbosniggunim',
    'shabbossongs', 'shabbostable', 'shabbostish', 'tish', 'שבת', 'שבק', 'ניגוני שבק', 'ניגוני שבת',
    'שבתדיגע', 'שבתדיג', 'טיש'] },

  { folder: 'מועדים וזמנים/מוצאי שב_ק', names: [
    'motzeishabbos', 'motzeishabos', 'motzeishabbes', 'motzeishabbat', 'motzeishabat',
    'motzaishabbos', 'motzaishabos', 'motzoeishabbos', 'motzoishabbos', 'motzeshabbos',
    'motzashabbos', 'motzash', 'motzei', 'motzai', 'motzoei', 'motzoi', 'moitzei', 'melavemalka',
    'melavamalka', 'melaveimalka', 'melavehmalka', 'malavemalka', 'havdalah', 'havdala', 'havdole',
    'saturdaynight', 'מוצאי שבק', 'מוצאי', 'מוצאי שבת', 'מלוה מלכה', 'הבדלה'] },

  { folder: 'מועדים וזמנים/ראש חודש', names: [
    'roshchodesh', 'roshchoidesh', 'roshchoydesh', 'roshchodsh', 'roschodesch', 'roshchodash',
    'rausch chodesh', 'rc', 'newmoon', 'newmonth', 'ראש חודש', 'ר״ח', 'ראש חדש'] },

  { folder: 'מועדים וזמנים/ימים נוראים', names: [
    'yomimnoroim', 'yomimnoraim', 'yomimnorayim', 'yomimnoroyim', 'yomimnaroim', 'yomimnoraiim',
    'yamimnoraim', 'yamimnoroim', 'yomimnoiroim', 'yomenoraim', 'highholidays', 'highholydays',
    'highholiday', 'hhd', 'elul', 'ellul', 'elal', 'roshhashana', 'roshhashanah', 'rosheshono',
    'rosheshone', 'roshashana', 'yomkippur', 'yomkipur', 'yomkipper', 'yomkippurim', 'yonkipper',
    'selichos', 'slichos', 'selichot', 'slichot', 'teshuva', 'teshuvah', 'tshuva',
    'aseresyemeiteshuva', 'tishrei', 'tishri', 'ימים נוראים', 'אלול', 'ראש השנה', 'יום כיפור',
    'יום הכיפורים', 'סליחות', 'תשובה', 'תשרי'] },

  { folder: 'מועדים וזמנים/סוכות', names: [
    'sukkos', 'sukkot', 'sukos', 'sukot', 'succos', 'succot', 'succoth', 'sukkoth', 'sukkous',
    'sukas', 'sukkas', 'tabernacles', 'simchastorah', 'simchastoirah', 'simchastora',
    'simchastoira', 'simchastoyre', 'simchastoyra', 'hoshanarabba', 'hoshanarabbah', 'hoshanarabo',
    'hoshaanarabba', 'shminiatzeres', 'shminiatzeret', 'shminatzeres', 'ushpizin', 'lulav', 'esrog',
    'sukkah', 'סוכות', 'סוכה', 'שמחת תורה', 'הושענא רבה', 'שמיני עצרת', 'אושפיזין', 'לולב'] },

  { folder: 'מועדים וזמנים/חנוכה', names: [
    'chanukah', 'chanuka', 'chanukka', 'chanukkah', 'chanike', 'chanuke', 'chanukeh', 'hanukkah',
    'hanuka', 'hanukah', 'hanukka', 'hannukah', 'hannuka', 'xanuka', 'chanukas', 'menorah',
    'menoirah', 'dreidel', 'latkes', 'neiros', 'neros', 'חנוכה', 'חנוכת', 'מנורה', 'נרות', 'סביבון'] },

  { folder: 'מועדים וזמנים/פורים', names: [
    'purim', 'purem', 'purym', 'poorim', 'pourim', 'purin', 'peurim', 'purimshpiel', 'purimshpil',
    'shushanpurim', 'megillah', 'megilla', 'megile', 'adar', 'mishloachmanos', 'mishloachmanot',
    'פורים', 'פורים שפיל', 'שושן פורים', 'מגילה', 'אדר', 'משלוח מנות'] },

  { folder: 'מועדים וזמנים/פסח', names: [
    'pesach', 'pesah', 'pesakh', 'peysach', 'peisach', 'paysach', 'peysakh', 'pesch', 'peysech',
    'passover', 'pessach', 'pesachdik', 'seder', 'sedher', 'haggadah', 'hagada', 'hagadah',
    'matzah', 'matzos', 'matzoh', 'nissan', 'nisan', 'chagamatzos', 'פסח', 'סדר', 'הגדה', 'מצה',
    'מצות', 'ניסן', 'חג המצות'] },

  { folder: 'מועדים וזמנים/ל_ג בעומר', names: [
    'lagbomer', 'lagbaomer', 'lagbeomer', 'lagbomeer', 'lagboymer', 'lagboimer', 'lagbaoimer',
    'lagbaomeer', 'lagbomor', 'lagboomer', 'lagbeoimer', 'lbomer', 'lag', 'rashbi', 'rashby',
    'reb shimon', 'meron', 'meiron', 'bonfire', 'medura', 'ל״ג בעומר', 'רשב״י', 'מירון', 'מדורה'] },

  { folder: 'מועדים וזמנים/שבועות', names: [
    'shavuos', 'shavuot', 'shavuoth', 'shavous', 'shavuois', 'shvuos', 'shvuot', 'shvues',
    'shevuos', 'shevuot', 'shovuos', 'shovuot', 'shvuess', 'shovuous', 'matantorah', 'matantoirah',
    'matantoyre', 'zmanmatantoraseinu', 'kabbalastorah', 'sivan', 'siven', 'bikkurim', 'akdamus',
    'shtiferet', 'שבועות', 'מתן תורה', 'סיון', 'ביכורים', 'אקדמות'] },
];

// Hebrew final letters fold to their base form so a missing/extra final form
// (וואכן vs וואכנ) still matches.
const FINAL_FORMS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
// Yiddish ligatures fold to the letter pairs people actually type.
const LIGATURES = { 'װ': 'וו', 'ױ': 'וי', 'ײ': 'יי' };

function normalizeAlias(s) {
  return String(s)
    .toLowerCase()
    .replace(/[װ-ײ]/g, (c) => LIGATURES[c] || c)
    .replace(/[֑-ׇ]/g, '')              // niqqud / cantillation
    .replace(/[ךםןףץ]/g, (c) => FINAL_FORMS[c] || c)
    .replace(/[^a-z0-9א-ת]/g, '');      // drop spaces, quotes, slashes, _
}

const ALIAS_MAP = (() => {
  const m = new Map();
  for (const s of STATIONS) {
    m.set(normalizeAlias(s.folder), s.folder);                 // the full path
    m.set(normalizeAlias(s.folder.split('/').pop()), s.folder); // just the leaf
    for (const n of s.names) m.set(normalizeAlias(n), s.folder);
  }
  return m;
})();

// A friendly name if we know it, otherwise the value as given — so both
// ?folder=sfirah and ?folder=<full R2 path> resolve.
function resolveFolder(raw) {
  return ALIAS_MAP.get(normalizeAlias(raw)) || raw;
}

// Public R2 hostname the web player already streams from (index.html).
// Used for the M3U so playlist traffic never passes through the worker.
const R2_PUBLIC_BASE = 'https://r2.oitzerhanigunim.org';

// Cloudflare caps subrequests per invocation (50 free / 1000 paid) and each
// track we fetch from R2 spends one. When the budget runs out we simply end
// the response; players treat that as a dropped station and reconnect, which
// starts a fresh invocation with a fresh budget. ~45 tracks is roughly three
// hours of audio, so a reconnect is rare and inaudible between tracks.
const RADIO_MAX_TRACKS = 45;

const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i;

/* Pace the stream to roughly real time.

   Without this the worker writes each track as fast as the socket accepts it.
   Measured against the deployed endpoint that was ~945x real time: the entire
   45-track budget left in 12 seconds, so a client that buffers rather than
   applying backpressure got 12 seconds of connection and then EOF, and one
   listener cost a whole playlist of R2 egress.

   We keep LEAD_SECONDS of audio queued ahead of the play position so players
   start instantly and never starve, then sleep to hold that lead. */
const LEAD_SECONDS = 15;

/* Write granularity once paced.

   R2 hands back large chunks. Writing a whole one and then sleeping for its
   full duration means a 64 KB chunk — four seconds of audio at 128 kbps —
   leaves as an instant burst followed by four seconds of silence on the wire.
   A player with a large buffer rides that out; a telephony decoder with a
   small jitter buffer underruns between bursts and clicks once per burst.
   Slicing to a quarter second makes delivery smooth instead of bursty. */
const CHUNK_SECONDS = 0.25;

/* Fallback pacing, for bytes we can't read frame headers out of.

   Frames carry their own duration — 1152 samples over the header's sample
   rate (576 for MPEG2/2.5) — so paced audio is timed exactly, per frame, and
   needs no margin at all. Only leftovers that aren't frames (a stray tag, a
   non-MP3 file someone dropped in a folder) fall back to guessing from a byte
   rate, and those get a margin so the guess errs toward sending early.

   Guessing used to be the *only* path, and it was the cause of a reported
   half-second dropout every 20-30 seconds on the telephone hotline. The rate
   came from the first frame header in the file, which on a VBR file is the
   Xing tag frame — it says 128 kbps no matter what follows. Measured across
   the library the real averages are 161-197 kbps, so 128 x 1.25 = 160 kbps
   went out against up to 197 kbps of demand: every file under-fed, the worst
   by 19%. A listener's buffer drained at that rate, underran, refilled, and
   drained again, which is exactly the periodic gap that was reported. */
const PACE_MARGIN = 1.25;
// Used until a frame header is read. 320 kbps is the MP3 ceiling, so assuming
// it can only ever make us send early (more buffer), never late (a stall).
const DEFAULT_BYTES_PER_SEC = 320000 / 8;

const BITRATES_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

// Total size of a leading ID3v2 tag, or 0. Worth skipping rather than sending:
// the tag carries embedded album art, which can run to hundreds of KB per file
// and is pure waste in a stream nothing will read it from.
function id3TagSize(b) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  // Size is 4 syncsafe bytes (7 significant bits each), excluding the header.
  const size = (b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f);
  const hasFooter = (b[5] & 0x10) !== 0;
  return 10 + size + (hasFooter ? 10 : 0);
}

// Bytes/sec from the first MP3 frame header found, or 0 if none is recognised.
function sniffBytesPerSec(b) {
  const limit = Math.min(b.length - 4, 4096);
  for (let i = 0; i < limit; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[i + 1] >> 3) & 0x03;   // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layer = (b[i + 1] >> 1) & 0x03;     // 1=Layer III
    if (version === 1 || layer !== 1) continue;
    const kbps = (version === 3 ? BITRATES_V1L3 : BITRATES_V2L3)[(b[i + 2] >> 4) & 0x0f];
    if (kbps) return (kbps * 1000) / 8;
  }
  return 0;
}

/* ── Loudness (`?gain=<dB>`) ───────────────────────────────────────────

   The library sits around -18 dBFS RMS. That is fine on speakers and too
   quiet on a telephone hotline, which expects a hotter signal and then
   band-limits and attenuates it further.

   We can't re-encode — there is no decoder in a Worker, and re-encoding
   would cost a generation of quality anyway. We don't have to. Every MP3
   frame carries a `global_gain` field per granule per channel in its side
   information: an 8-bit exponent on the requantiser, 1.5 dB per step.
   Raising it makes the decoder reconstruct the same coefficients louder.
   That is a byte-for-byte edit of the side info, nothing is re-coded, and
   it is exactly what mp3gain does to files on disk.

   Why the edit is safe mid-stream: MP3's bit reservoir means a frame's
   *main data* may live in earlier frames, so you cannot move bytes around.
   The side info is different — it is always in its own frame, immediately
   after the header, at a fixed bit offset. Rewriting it in place changes
   no length and shifts nothing.

   Two limits worth knowing:
     - `global_gain` saturates at 255. Measured across the library it sits
       near 180 (p99 186), so there are ~45 steps of headroom and clamping
       effectively never fires; we count it anyway.
     - Loud tracks can clip. Peaks in the library run from -0.6 to -7.8
       dBFS, so a boost past the quietest headroom will flat-top peaks on
       the hottest tracks. That is why this is opt-in per URL rather than
       applied to every listener, and why it is capped.  */

const GAIN_DB_PER_STEP = 1.5;   // one global_gain step, per the MP3 spec
const GAIN_MAX_DB = 12;

const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// Requested dB → whole global_gain steps. Anything unparseable means 0,
// i.e. pass the bytes through untouched.
function gainSteps(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const db = Number(raw);
  if (!Number.isFinite(db)) return 0;
  return Math.round(Math.max(-GAIN_MAX_DB, Math.min(GAIN_MAX_DB, db)) / GAIN_DB_PER_STEP);
}

/* Decode a frame header at `i`, or null if it isn't one. Rejects the
   reserved encodings as well as free-format and out-of-range indexes, so a
   0xFF byte inside audio data is very unlikely to be taken for a header —
   and once we're aligned we step frame to frame and never re-scan. */
function parseFrameHeader(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 0x03;   // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
  const layer = (b[i + 1] >> 1) & 0x03;     // 1 = Layer III
  const bitrateIdx = (b[i + 2] >> 4) & 0x0f;
  const rateIdx = (b[i + 2] >> 2) & 0x03;
  if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null;
  const lsf = version !== 3;               // MPEG2/2.5 = "lower sampling frequency"
  const kbps = (lsf ? BITRATES_V2L3 : BITRATES_V1L3)[bitrateIdx];
  const sampleRate = SAMPLE_RATES[version][rateIdx];
  const length = Math.floor((lsf ? 72000 : 144000) * kbps / sampleRate)
    + ((b[i + 2] >> 1) & 0x01);            // padding byte
  return {
    length,
    lsf,
    // Every Layer III frame is a fixed number of samples, so its playing time
    // follows from the header alone — no assumption about the file's bitrate,
    // which is the whole point on VBR material.
    seconds: (lsf ? 576 : 1152) / sampleRate,
    hasCrc: (b[i + 1] & 0x01) === 0,       // the bit is set when there is NO CRC
    channels: ((b[i + 3] >> 6) & 0x03) === 3 ? 1 : 2,
  };
}

// An 8-bit field at an arbitrary bit offset spans two bytes.
function readByteAtBit(b, base, bit) {
  const at = base + (bit >> 3), shift = bit & 7;
  return (((b[at] << 8) | b[at + 1]) >> (8 - shift)) & 0xff;
}

function writeByteAtBit(b, base, bit, value) {
  const at = base + (bit >> 3), shift = bit & 7;
  const word = ((b[at] << 8) | b[at + 1]) & 0xffff;
  const mask = (0xff << (8 - shift)) & 0xffff;
  const out = (word & ~mask) | ((value << (8 - shift)) & mask);
  b[at] = (out >> 8) & 0xff;
  b[at + 1] = out & 0xff;
}

// MPEG audio CRC-16: poly 0x8005, init 0xFFFF, over header bytes 2-3 plus
// the side info. Only frames that carry a CRC need it, but those frames are
// dropped by strict decoders if we edit the side info and leave it stale.
function sideInfoCrc(b, off, sideStart, sideLen) {
  let crc = 0xffff;
  const feed = (byte) => {
    crc ^= byte << 8;
    for (let n = 0; n < 8; n++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  };
  feed(b[off + 2]);
  feed(b[off + 3]);
  for (let n = 0; n < sideLen; n++) feed(b[sideStart + n]);
  return crc;
}

// Side info is fixed-size per version and channel count.
function sideInfoLen(hdr) {
  return hdr.lsf ? (hdr.channels === 1 ? 9 : 17) : (hdr.channels === 1 ? 17 : 32);
}

/* True for the silent Xing/Info/VBRI frame most VBR files open with.

   It carries the stream length and, from LAME, a checksum over the frame's
   own first 190 bytes — which covers the side info. Shifting a gain there
   invalidates that checksum, decoders then discard the whole tag, and with
   it the gapless-playback trim: mpg123 decoded 3311 extra samples of
   encoder padding per track before this was skipped. The frame holds no
   audio, so skipping it costs nothing. */
function isTagFrame(b, off, hdr) {
  const at = (p, s) => {
    if (p + 4 > b.length) return false;
    for (let n = 0; n < 4; n++) if (b[p + n] !== s.charCodeAt(n)) return false;
    return true;
  };
  const afterSide = off + 4 + (hdr.hasCrc ? 2 : 0) + sideInfoLen(hdr);
  return at(afterSide, 'Xing') || at(afterSide, 'Info') || at(off + 36, 'VBRI');
}

/* Shift every global_gain in one frame, in place.

   Side info layout, from its first byte:
     MPEG1   main_data_begin 9 + private (5 mono / 3 else) + scfsi 4·channels,
             then 2 granules × channels blocks of 59 bits
     MPEG2/5 main_data_begin 8 + private (1 mono / 2 else),
             then 1 granule × channels blocks of 63 bits
   global_gain sits 21 bits into each block, after part2_3_length (12) and
   big_values (9). Those add up to the spec's side info sizes (17/32 and
   9/17 bytes), which is the arithmetic check that the offsets are right. */
function shiftFrameGain(b, off, hdr, steps, stats) {
  const sideStart = off + 4 + (hdr.hasCrc ? 2 : 0);
  const sideLen = sideInfoLen(hdr);
  if (sideStart + sideLen > b.length) return;   // truncated frame: leave it alone
  if (isTagFrame(b, off, hdr)) { stats.skipped++; return; }

  const base = hdr.lsf
    ? 8 + (hdr.channels === 1 ? 1 : 2)
    : 9 + (hdr.channels === 1 ? 5 : 3) + 4 * hdr.channels;
  const blockBits = hdr.lsf ? 63 : 59;
  const blocks = (hdr.lsf ? 1 : 2) * hdr.channels;

  for (let n = 0; n < blocks; n++) {
    const bit = base + n * blockBits + 21;
    const was = readByteAtBit(b, sideStart, bit);
    const now = Math.max(0, Math.min(255, was + steps));
    if (now !== was + steps) stats.clamped++;
    if (now !== was) writeByteAtBit(b, sideStart, bit, now);
  }
  stats.frames++;

  if (hdr.hasCrc) {
    const crc = sideInfoCrc(b, off, sideStart, sideLen);
    b[off + 4] = (crc >> 8) & 0xff;
    b[off + 5] = crc & 0xff;
  }
}

/* Longest possible Layer III frame (MPEG1, 320 kbps, 32 kHz, padded). Used
   to bound how much we'll hold waiting for a frame to complete — past that
   the bytes plainly aren't frames, so we stop holding and pass them on. */
const MAX_FRAME_BYTES = 1441;

/* Streaming frame filter for one track. `push` returns the bytes that are
   ready to go out together with how many seconds of audio they are, and
   `flush` releases whatever is left at end of track.

   It runs on every stream, not just when gain is asked for, because the
   pump needs those exact per-frame durations to pace by. With steps = 0 it
   reads frames and changes nothing.

   Sync is acquired conservatively: a candidate header is only believed once
   another header is confirmed exactly one frame length later. 0xFF bytes are
   common inside audio data, and the folder listing also admits flac/ogg/m4a,
   which we must not edit at all — a lone plausible-looking header is not
   enough to start writing into a buffer. Once locked we walk frame to frame
   and stop re-checking; a frame that doesn't parse drops the lock. Anything
   never locked passes through byte for byte, and is paced by the fallback. */
function makeFrameFilter(steps) {
  let carry = new Uint8Array(0);
  let locked = false;
  const stats = { frames: 0, clamped: 0, skipped: 0 };

  return {
    stats,
    push(chunk) {
      const buf = carry.length ? concat(carry, chunk) : chunk;
      let done = 0;   // bytes fully processed and safe to emit
      let seconds = 0;
      let i = 0;
      let waiting = false;
      while (i + 4 <= buf.length) {
        const hdr = parseFrameHeader(buf, i);
        if (!hdr) { locked = false; i++; continue; }
        if (i + hdr.length > buf.length) { waiting = true; break; }
        if (!locked) {
          // Need the next header too before trusting this one.
          if (i + hdr.length + 4 > buf.length) { waiting = true; break; }
          if (!parseFrameHeader(buf, i + hdr.length)) { i++; continue; }
          locked = true;
        }
        if (steps) shiftFrameGain(buf, i, hdr, steps, stats);
        else stats.frames++;
        seconds += hdr.seconds;
        i += hdr.length;
        done = i;
      }
      if (!waiting) {
        // Scanned to the end: only a partial sync word is worth keeping.
        done = Math.max(done, buf.length - 3);
      } else if (buf.length - done > 2 * MAX_FRAME_BYTES + 4) {
        // A held frame is bounded by its own length, so this shouldn't be
        // reachable — but never stall the stream on it. Pass the bytes on
        // untouched and re-acquire sync from scratch.
        locked = false;
        done = buf.length - 3;
      }
      carry = buf.slice(done);
      // `seconds` covers the frames only. Anything emitted around them is
      // passthrough, and the pump prices that from the fallback rate.
      return { bytes: buf.subarray(0, done), seconds };
    },
    flush() {
      const rest = carry;
      carry = new Uint8Array(0);
      return rest;
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const STREAM_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Icy-MetaData',
};

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// HTTP header values are latin-1, so a Hebrew folder name can't be assigned
// directly — it throws and the whole response 500s. Emit the UTF-8 bytes as
// single chars instead: the value is then a legal ByteString, and what goes
// out on the wire is real UTF-8, so players that decode it show Hebrew.
function headerSafe(s) {
  let out = '';
  for (const b of new TextEncoder().encode(s)) out += String.fromCharCode(b);
  return out;
}

// Encode an R2 key for use in a URL while keeping the path separators —
// the same transform index.html applies when it builds a track URL.
function keyToUrl(key) {
  return `${R2_PUBLIC_BASE}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
}

// Every audio object under a folder, paged so folders over 1000 files work.
async function listAudio(bucket, folder) {
  const prefix = folder.replace(/\/?$/, '/');
  const out = [];
  let cursor;
  do {
    const res = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) {
      if (AUDIO_RE.test(o.key)) out.push({ key: o.key, name: o.key.split('/').pop() });
    }
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return out;
}

async function handleStream(path, request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: STREAM_CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: STREAM_CORS });
  }

  const bucket = env.BUCKET;
  if (!bucket) return new Response('R2 bucket not bound (env.BUCKET)', { status: 500, headers: STREAM_CORS });

  const url = new URL(request.url);

  // ── Discovery: what stations exist and what you can call them ──
  if (path === '/stations') {
    const origin = url.origin;
    return mjson({
      stations: STATIONS.map((s) => ({
        folder: s.folder,
        name: s.folder.split('/').pop(),
        aliases: s.names,
        radio: `${origin}/radio?folder=${encodeURIComponent(s.names[0])}`,
        m3u: `${origin}/playlist.m3u?folder=${encodeURIComponent(s.names[0])}`,
      })),
      gain: {
        param: 'gain',
        unit: 'dB',
        note: `Add &gain=<dB> to a /radio URL to play louder. Rounded to ${GAIN_DB_PER_STEP} dB steps, capped at ±${GAIN_MAX_DB} dB. 4.5 suits a telephone hotline.`,
      },
    });
  }

  // `station` reads better in a URL; `folder` is what the site already uses.
  const requested = url.searchParams.get('station') || url.searchParams.get('folder');
  if (!requested) return new Response('Missing folder parameter', { status: 400, headers: STREAM_CORS });
  const folder = resolveFolder(requested);

  const wantShuffle = url.searchParams.get('shuffle') !== '0';
  // `gain` is the documented name; `db` and `volume` are what people guess.
  const steps = gainSteps(
    url.searchParams.get('gain') ?? url.searchParams.get('db') ?? url.searchParams.get('volume'),
  );

  let tracks;
  try {
    tracks = await listAudio(bucket, folder);
  } catch (err) {
    return new Response(`R2 list failed: ${(err && err.message) || err}`, { status: 500, headers: STREAM_CORS });
  }
  if (!tracks.length) return new Response(`No audio files in folder: ${folder}`, { status: 404, headers: STREAM_CORS });

  const order = wantShuffle ? shuffled(tracks) : tracks.sort((a, b) => a.name.localeCompare(b.name));

  // ── M3U: a plain list of direct R2 URLs ──
  if (path === '/playlist.m3u') {
    const lines = ['#EXTM3U'];
    for (const t of order) {
      lines.push(`#EXTINF:-1,${t.name.replace(AUDIO_RE, '')}`);
      lines.push(keyToUrl(t.key));
    }
    return new Response(lines.join('\n') + '\n', {
      headers: {
        ...STREAM_CORS,
        'Content-Type': 'audio/x-mpegurl; charset=utf-8',
        'Content-Disposition': 'inline; filename="station.m3u"',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── /radio: one endless audio/mpeg body, tracks concatenated ──
  const headers = {
    ...STREAM_CORS,
    'Content-Type': 'audio/mpeg',
    // No Content-Length: the body is open-ended, which is what tells a
    // player to treat this as a live station rather than a file download.
    'Cache-Control': 'no-store, no-transform',
    'icy-name': headerSafe(folder.split('/').pop() || 'Oitzer HaNigunim'),
    'icy-description': 'Oitzer HaNigunim',
    // Echo what we actually applied, which is the request rounded to whole
    // 1.5 dB steps and capped — so `?gain=99` is visibly not 99.
    'x-gain-db': String(steps * GAIN_DB_PER_STEP),
  };

  // A HEAD probe (players often send one first) must not spend the budget.
  if (request.method === 'HEAD') return new Response(null, { headers });

  const { readable, writable } = new IdentityTransformStream();

  const pump = async () => {
    const writer = writable.getWriter();
    const startedAt = Date.now();
    let queuedSeconds = 0;   // audio duration written so far
    let bytesPerSec = DEFAULT_BYTES_PER_SEC;
    let played = 0;
    let queue = order;
    try {
      while (played < RADIO_MAX_TRACKS) {
        for (const t of queue) {
          if (played >= RADIO_MAX_TRACKS) break;
          const obj = await bucket.get(t.key);
          played++;
          if (!obj || !obj.body) continue;

          const reader = obj.body.getReader();
          let skip = -1;      // -1 until the ID3v2 header has been inspected
          let sniffed = false;
          // Holds back the final 128 bytes of the track so a trailing ID3v1
          // tag can be dropped instead of played. It is literal "TAG" plus
          // text, and decoders render it as a click at every track change.
          let tail = new Uint8Array(0);
          // Per track, because frame alignment doesn't carry across files:
          // whatever partial frame is left at the end of one track has to be
          // flushed before the next one starts.
          const frames = makeFrameFilter(steps);

          // `seconds` is the real playing time of `data` when we could read
          // it off the frames, or 0 to fall back to the estimated byte rate.
          const paceOut = async (data, seconds) => {
            if (!data.length) return;
            const rate = seconds > 0
              ? data.length / seconds                  // exact, even on VBR
              : bytesPerSec * PACE_MARGIN;             // guess, erring early
            const slice = Math.max(1024, Math.floor(rate * CHUNK_SECONDS));
            for (let off = 0; off < data.length; off += slice) {
              const piece = data.subarray(off, off + slice);
              await writer.write(piece);
              queuedSeconds += piece.length / rate;
              const aheadMs = queuedSeconds * 1000 - (Date.now() - startedAt) - LEAD_SECONDS * 1000;
              if (aheadMs > 0) await sleep(Math.min(aheadMs, 30000));
            }
          };

          const emit = async (data) => {
            const out = frames.push(data);
            await paceOut(out.bytes, out.seconds);
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            let buf = value;

            if (skip === -1) skip = id3TagSize(buf);
            if (skip > 0) {
              // The tag can be larger than one chunk, so drop across reads.
              const drop = Math.min(skip, buf.length);
              skip -= drop;
              buf = buf.subarray(drop);
              if (!buf.length) continue;
            }
            if (!sniffed && buf.length >= 4) {
              bytesPerSec = sniffBytesPerSec(buf) || bytesPerSec;
              sniffed = true;
            }

            // Emit everything except the last 128 bytes seen so far.
            const merged = tail.length ? concat(tail, buf) : buf;
            if (merged.length > 128) {
              await emit(merged.subarray(0, merged.length - 128));
              tail = merged.slice(merged.length - 128);
            } else {
              tail = merged.slice();
            }
          }
          // Whatever is left is audio unless it is an ID3v1 tag.
          if (!(tail.length === 128 && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47)) {
            await emit(tail);
          }
          const rest = frames.flush();
          if (rest.length) await paceOut(rest, 0);
        }
        // Folder exhausted before the budget was — go round again so a
        // short folder still behaves like a continuous station.
        queue = wantShuffle ? shuffled(tracks) : queue;
      }
    } catch (err) {
      // Normal when the listener disconnects mid-track; nothing to do.
    } finally {
      try { await writer.close(); } catch (e) { /* already torn down */ }
    }
  };

  // Keep the invocation alive for as long as we're feeding the body.
  if (ctx && ctx.waitUntil) ctx.waitUntil(pump());
  else pump();

  return new Response(readable, { headers });
}
