// StackNote service worker — network-first with an offline cache.
// Bump CACHE whenever a deployment ships changed files so stale caches are purged.
const CACHE = 'stacknote-v3';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './js/data.js',
  './js/core.js',
  './js/app.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html'])))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  // Never cache or intercept cross-origin traffic (e.g. optional Supabase sync).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) =>
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return (await caches.match('./index.html')) ||
              new Response('Offline — open StackNote while online once to cache it.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
              });
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        })
    )
  );
});
