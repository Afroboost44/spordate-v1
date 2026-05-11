// Spordateur Service Worker v24 (Phase 9.5 c24 — bump CACHE_NAME force invalidate
// tous les caches précédents au prochain activate event → re-fetch les NEW icons
// Bassi (cercle Afroboost) et purge l'ancien logo placeholder caché par iOS PWA).
const CACHE_NAME = 'spordate-v24';
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache (cache-bust via ?v=24 cohérent manifest + layout.tsx)
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png?v=24',
  '/icon-512.png?v=24',
  '/icon-maskable-512.png?v=24',
  '/apple-touch-icon.png?v=24',
  '/favicon.ico?v=24',
  '/offline.html',
];

// Install: pre-cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
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
