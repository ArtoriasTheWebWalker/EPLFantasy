/* =====================================================
   SERVICE WORKER — caches the static app shell only.

   Never touches the FPL proxy (fpl-proxy-*.workers.dev) or the sync
   worker (fpl-sync.*.workers.dev) — those are a different origin,
   already have their own freshness rules in js/api.js and js/sync.js,
   and must always be reachable live. This only makes the shell itself
   (HTML/CSS/JS/icons) load instantly on a repeat visit and keeps the
   app opening, with your saved squad, when there's no connection.

   Strategy: stale-while-revalidate. Serve the cached file immediately
   if there is one, and refresh the cache from the network in the
   background for next time — never blocks a paint on a network round
   trip, but still stays current within a session or two.

   Bump CACHE_NAME whenever the shell's file list changes materially,
   so old entries get swept on the next activate.
===================================================== */

const CACHE_NAME = 'fplc-shell-v2';   // v2: forces a clean cache after the Table page restructure

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/performance.css',
  './css/draft.css',
  './css/table.css',
  './js/app.js',
  './js/api.js',
  './js/store.js',
  './js/ui.js',
  './js/sync.js',
  './js/config.js',
  './js/performance.js',
  './js/draft.js',
  './js/table.js',
  './pages/performance.html',
  './pages/draft.html',
  './pages/table.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  /* same-origin GET requests only — everything else (the FPL proxy,
     the sync worker, any POST/PUT) passes straight through untouched */
  if(url.origin !== location.origin || req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);   // offline — fall back to whatever's cached

      return cached || network;
    })
  );
});
