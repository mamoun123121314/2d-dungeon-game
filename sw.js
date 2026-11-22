/* Offline-first cache for Dungeon Rogue. Bump CACHE when shipping. */
const CACHE = 'dungeon-rogue-v3-2026-11';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './assets/icon.svg', './assets/icon-maskable.svg',
  './src/game-core.js', './src/audio/creature-voices.js',
  './src/render/dungeon-detail.js', './src/pwa.js'
];
self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  ev.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      /* refresh in the background, but answer instantly from cache */
      fetch(req).then((res) => { if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (e) {
      return (await caches.match('./index.html')) || Response.error();
    }
  })());
});
