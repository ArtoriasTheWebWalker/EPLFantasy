/* =====================================================
   FPL COMPANION — cross-device state sync Worker
   =====================================================
   A tiny key-value API backed by Cloudflare KV so your
   phone and PC share the same squad. No accounts.

   This is NOT part of the static site — it runs on
   Cloudflare Workers. Deploy it separately (see README).

   Endpoints (under this Worker's URL):
     GET  /health  → { ok:true }
     GET  /state   → { ok:true, data:<blob>|null, updatedAt }
     PUT  /state   → body { data, updatedAt } → saves the blob

   Auth / identity:
     Every request must send header  X-Sync-Code: <your code>
     The code both names your bucket (KV key) and gates access.
     Use a long, unguessable code — it's the only thing
     protecting your data, and it can't be hidden in a
     browser app, so treat it like a password you type once
     per device, not bank-grade security.

   KV binding: this Worker expects a KV namespace bound as
   the variable name  FPL_STATE  (set in the dashboard).
===================================================== */

const ALLOWED_ORIGINS = [
  'https://artoriasthewebwalker.github.io',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];

const MIN_CODE_LEN = 12;

function corsHeaders(origin){
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Code',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    /* CORS preflight */
    if(request.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if(url.pathname === '/health'){
      return json({ ok: true }, 200, origin);
    }

    if(url.pathname !== '/state'){
      return json({ ok: false, error: 'not found' }, 404, origin);
    }

    /* every /state request must carry a sync code */
    const code = request.headers.get('X-Sync-Code') || '';
    if(code.length < MIN_CODE_LEN){
      return json({ ok: false, error: 'missing or too-short sync code' }, 401, origin);
    }
    const key = 'state:' + code;

    if(request.method === 'GET'){
      const stored = await env.FPL_STATE.get(key);
      if(!stored) return json({ ok: true, data: null, updatedAt: 0 }, 200, origin);
      let record;
      try { record = JSON.parse(stored); } catch { record = { data: null, updatedAt: 0 }; }
      return json({ ok: true, data: record.data ?? null, updatedAt: record.updatedAt || 0 }, 200, origin);
    }

    if(request.method === 'PUT'){
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'bad json' }, 400, origin); }

      const record = {
        data: body.data ?? null,
        updatedAt: Number(body.updatedAt) || Date.now(),
      };
      await env.FPL_STATE.put(key, JSON.stringify(record));
      return json({ ok: true, updatedAt: record.updatedAt }, 200, origin);
    }

    return json({ ok: false, error: 'method not allowed' }, 405, origin);
  },
};
