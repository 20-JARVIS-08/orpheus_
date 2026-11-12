/* ORPHEUS service worker: makes the web version installable and usable offline.
   Bump VERSION whenever you upload a new index.html so visitors get the update. */
<<<<<<< HEAD
const VERSION = 'orpheus-v4';
=======
const VERSION = 'orpheus-v3';
>>>>>>> origin/main
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'fonts/fonts.css',
  'fonts/orbitron-latin-500-normal.woff2',
  'fonts/orbitron-latin-700-normal.woff2',
  'fonts/share-tech-mono-latin-400-normal.woff2',
  'fonts/vazirmatn-arabic-400-normal.woff2',
  'fonts/vazirmatn-latin-400-normal.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.headers.has('range')) return; // never touch media streaming
  if (url.pathname.includes('/downloads/')) return; // installers always come straight from the server

  // pages: try the network first so updates arrive, fall back to the cached copy when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // everything else: serve from cache instantly, refresh in the background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
