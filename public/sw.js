// Spordateur Service Worker v28 (Phase 9.5 c49 — bump CACHE_NAME pour purger
// l'ancien cache v24 qui contenait l'ancien logo "S" cached sur les PWA
// installées pre-c46. skipWaiting + clients.claim force activation immédiate
// sans attendre la fermeture des tabs.
const CACHE_NAME = 'spordate-v28';
const OFFLINE_URL = '/offline.html';

// Assets pre-cache (cache-bust ?v=28 cohérent manifest + layout.tsx).
// Phase 9.5 c49 : paths /icons/* (nouveau logo neon) + root-legacy paths
// régénérés AUSSI avec nouveau logo (PWA installées pre-c46 réfèrent ces
// paths root via apple-touch-icon HTML link + ancien manifest cached).
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png?v=28',
  '/icons/icon-512.png?v=28',
  '/icons/apple-touch-icon.png?v=28',
  '/icons/favicon-32.png?v=28',
  '/icons/favicon-16.png?v=28',
  // Root legacy (PWA installées pre-c46 qui requestent ces paths)
  '/icon-192.png?v=28',
  '/icon-512.png?v=28',
  '/icon-maskable-512.png?v=28',
  '/apple-touch-icon.png?v=28',
  '/favicon.ico?v=28',
  '/offline.html',
];

// Install: pre-cache critical assets + skip waiting (active SW v28 immediately)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Phase 9.5 c49 — addAll fails atomically si UN seul asset rejette.
      // Use Promise.allSettled pour log warn + continue (offline.html peut
      // ne pas exister dans dev par ex.).
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          fetch(url).then((res) => (res.ok ? cache.put(url, res) : null))
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate: clean up ALL old caches + claim clients (force fetch handler take
// over without page reload).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip API requests (Firebase, etc.)
  if (event.request.url.includes('/api/') || event.request.url.includes('firestore')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Try cache, then offline page
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
