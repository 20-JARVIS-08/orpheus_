/* ORPHEUS service worker: makes the web version installable and usable offline.
   Bump VERSION whenever you upload a new index.html so visitors get the update. */
const VERSION = 'orpheus-v8';
const SHELL = [
  './',
  'index.html',
  'vocal-worklet.js',
  'sep-worker.js',
  'live.js',
  'lib/peerjs.min.js',
  'vendor/ort/ort.min.js',
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

/* cross-origin isolation (lets the AI vocal engine use several CPU threads); everything served here is same-origin, so nothing breaks */
const iso = (r) => {
  if (!r || r.type === 'opaque' || r.status < 200 || r.status > 299 || r.status === 204) return r;
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'require-corp'); h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
};

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
  if (url.pathname.includes('/models/')) return; // the 65 MB AI model is cached by sep-worker.js itself

  // pages: try the network first so updates arrive, fall back to the cached copy when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('index.html', copy));
          return iso(res);
        })
        .catch(() => caches.match('index.html').then((r) => iso(r || null) || caches.match('./').then(iso)))
    );
    return;
  }

  // everything else: serve from cache instantly, refresh in the background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return iso(res);
        })
        .catch(() => iso(hit));
      return hit ? iso(hit) : net;
    })
  );
});
