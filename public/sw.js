// Service Worker for Gemini CLI UI PWA
// Keep index.html synchronized with Vite's content-hashed asset filenames.
const CACHE_NAME = 'gemini-ui-v3-filetree-tooltip';
const OFFLINE_URL = '/index.html';
const urlsToCache = [
  OFFLINE_URL,
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames =>
        Promise.all(
          cacheNames.map(cacheName =>
            cacheName === CACHE_NAME ? Promise.resolve() : caches.delete(cacheName)
          )
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Network-first for the application shell so a rebuild cannot leave the
  // browser pointing at an old hashed JS/CSS filename.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Vite assets are content-hashed build outputs. Never satisfy them from the
  // app-shell cache; a stale asset reference should fail rather than be hidden.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});