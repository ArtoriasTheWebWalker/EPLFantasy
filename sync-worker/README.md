# FPL Companion — sync Worker

A tiny Cloudflare Worker + KV store that lets the app share one squad
across devices (phone + PC). It is **not** part of the static site — it
runs on Cloudflare Workers and the app talks to it over HTTPS.

## Deploy (Cloudflare dashboard)

1. **Create a KV namespace**
   - Dashboard → *Storage & Databases* → *KV* → **Create namespace**
   - Name it `fpl-state` (any name is fine).

2. **Create the Worker**
   - *Compute (Workers)* → *Workers & Pages* → **Create** → **Worker**
   - Name it `fpl-sync` → **Deploy** the starter → **Edit code**
   - Replace everything with the contents of [`worker.js`](worker.js) → **Deploy**.

3. **Bind the KV namespace** (this is the step people forget)
   - Worker → *Settings* → *Bindings* → **Add** → *KV namespace*
   - **Variable name:** `FPL_STATE`  (must match exactly)
   - **Namespace:** `fpl-state` → **Save** / redeploy.

4. **Test it**
   - Open `https://fpl-sync.<your-subdomain>.workers.dev/health`
   - You should see `{"ok":true}`.

5. Send the Worker URL back — it gets wired into `js/sync.js` in the app.

## How it works
- One JSON blob per **sync code** (`state:<code>` in KV).
- The sync code is sent as the `X-Sync-Code` header; it identifies the
  bucket and gates access. Minimum 12 chars. It cannot be truly hidden in
  a browser app, so it's "keep casual strangers out", not real auth.
- `GET /state` reads, `PUT /state` writes `{ data, updatedAt }`.
- CORS is limited to the site origin + localhost dev in `ALLOWED_ORIGINS`.
