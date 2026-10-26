/* HAYP Dostawy – service worker (działanie offline + instalacja).
   Po każdej zmianie plików podbij numer wersji w CACHE, żeby telefony pobrały nową wersję. */
const CACHE = 'hayp-dostawy-v1.0.1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './leaflet.js',
  './leaflet.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // API map i kafelki mapy idą zawsze przez sieć (bez cache aplikacji).
  if (url.origin !== self.location.origin) return;

  // Pliki aplikacji: najpierw z cache, w tle odświeżenie (nowa wersja widoczna przy kolejnym uruchomieniu).
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) return cached;
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    })
  );
});
