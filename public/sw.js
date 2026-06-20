// Spordateur Service Worker v35 (Fix #209 — bug PWA mobile persistant fond
// blanc carré home screen + flash blanc splash. Bump v34 → v35 pour FORCER
// la purge complète des anciens caches (manifest, icons PNG anciennes URL
// avec ?v=32) sur la prochaine ouverture mobile chez Bassi. Conjointement :
//  - alpha=false sur canvas → PNG OPAQUE (plus de halo blanc anti-aliasing)
//  - purpose='maskable' retiré du manifest → launcher Android pose juste
//    le PNG noir tel quel (pas de thème clair appliqué dessus)
//  - Cache-Control: max-age=0 sur /manifest.webmanifest → re-fetch obligé
//    à chaque ouverture PWA, plus de cache 7j Android Chrome silencieux.
// La bump SW est CRUCIALE car même avec headers HTTP corrects, le SW v34
// pourrait servir un manifest cache stale jusqu'à activation du nouveau SW.)
// v33 (Fix #206 — suppression définitive de l'ancien logo "S". Le precache
// ne référence plus aucun /icons/icon-*.png ni /apple-touch-icon.png ni
// /favicon.ico — ces fichiers ont été supprimés physiquement du repo.)
// v32 (Fix #204 v2 — stratégies de cache séparées :
// CacheFirst pour les assets immuables Next.js (/_next/static/* avec hash dans
// nom = immuables par contrat), NetworkFirst strict (timeout 4s) pour les
// navigations HTML, et bypass SW total pour les chunks JS non cachés.
// Avant : network-first global → si réseau timeout, fallback retournait un
// VIEUX chunk JS depuis le cache (mismatch hash avec HTML nouveau) → crash
// "client-side exception" reporté par Bassi sur plusieurs pages après déploiement.
// SW_VERSION sert aussi à invalider tous les caches existants à l'install
// (le suffix BUILD_ID injecté par next.config.ts garantit un body distinct
// à chaque build, donc updatefound + SKIP_WAITING à chaque déploiement).
const SW_VERSION = 'v37';
const CACHE_NAME = `spordate-${SW_VERSION}`;
// Cache séparé pour assets long-life (/_next/static/* immuables). Reste utile
// même quand on bump CACHE_NAME car ces fichiers sont addressés par hash unique.
const STATIC_CACHE_NAME = `spordate-static-${SW_VERSION}`;
const OFFLINE_URL = '/offline.html';
// Préfixes considérés comme immuables (hash dans le nom de fichier → URL stable
// par contrat Next.js). Pour ces URLs : CacheFirst → zéro risque de mismatch.
const IMMUTABLE_PREFIXES = ['/_next/static/'];

// Fix #206 — Tous les anciens PNG du logo "S" ont été supprimés physiquement
// du repo. Le precache ne contient plus que le placeholder neutre + offline.
const PRECACHE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/placeholder.png?v=35',
  '/offline.html',
];

// Install: pre-cache critical assets + skip waiting (active SW v28 immediately)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Phase 9.5 c50 — addAll fails atomically si UN seul asset rejette.
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

// Activate: clean up ALL old caches sauf nos 2 caches courants (CACHE_NAME +
// STATIC_CACHE_NAME). claim clients → le SW prend immédiatement le contrôle
// des onglets ouverts, déclenche controllerchange côté PWARegister.tsx, qui
// affiche le toast et reload pour repartir sur un bundle JS cohérent.
self.addEventListener('activate', (event) => {
  const KEEP = new Set([CACHE_NAME, STATIC_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fix #204 — message listener pour SKIP_WAITING envoyé par PWARegister.tsx
// quand une nouvelle version est détectée en arrière-plan. Permet d'activer
// immédiatement le nouveau SW sans attendre la fermeture du navigateur. Le
// PWARegister écoute ensuite 'controllerchange' pour recharger la page et
// éviter de tourner avec un mix vieux JS bundle / nouveau SW.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Helpers de stratégies (Fix #204 v2). Trois stratégies cohabitent :
//
// 1. CacheFirst (immutable Next.js static) — /_next/static/* contient un hash
//    dans le nom de fichier, donc une URL = un et un seul contenu pour
//    toujours. On sert depuis le cache si dispo, sinon on fetch et on met en
//    cache. Aucun risque de mismatch.
//
// 2. NetworkFirst with timeout (navigations HTML) — on essaye le réseau avec
//    un timeout court (4s) pour rester réactif. Si OK, on met à jour le cache
//    et on renvoie. Sinon, on retombe sur le cache (et offline.html en
//    dernier recours pour les navigations).
//
// 3. NetworkOnly (le reste) — passe-plat. Évite que le SW interfère avec des
//    requêtes dynamiques (Firebase, /api/, images Firebase Storage, etc.).
//    Important : si l'asset n'est PAS dans le cache et que le réseau échoue,
//    on renvoie une 503 explicite plutôt qu'un vieux fichier inadapté.

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Pas de fallback : si on n'a pas le chunk et qu'on ne peut pas le
    // fetcher, mieux vaut une erreur claire qu'un mauvais bundle JS qui
    // exploserait au runtime.
    return new Response('Asset unavailable', { status: 503 });
  }
}

function networkWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network-timeout')), timeoutMs);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await networkWithTimeout(request, 4000);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (Firebase Storage, YouTube thumbs, etc.) —
  // passe-plat navigateur, le SW n'intercepte pas.
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip API + Firestore + Firebase Storage proxies (toujours dynamique, ne
  // doit JAMAIS être servi depuis le cache).
  if (
    request.url.includes('/api/') ||
    request.url.includes('firestore') ||
    request.url.includes('firebase')
  ) {
    return;
  }

  const url = new URL(request.url);

  // 1) Assets Next.js immuables → CacheFirst.
  //    Le hash dans /_next/static/chunks/abc123.js garantit que cette URL
  //    pointe pour toujours sur le même contenu. C'est le fix critique du
  //    bug Bassi : avant, network-first pouvait timeout puis renvoyer un
  //    VIEUX chunk depuis le cache (ancien hash conservé) → mismatch avec
  //    l'HTML nouveau → "client-side exception".
  if (IMMUTABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 2) Navigations HTML → NetworkFirst avec timeout court → fallback cache
  //    → offline.html en dernier recours.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 3) Reste (images locales /public/*, manifest, polices) → NetworkFirst
  //    classique : on tente le réseau, on met en cache au passage, on
  //    retombe sur le cache si offline. Pas de risque de mismatch ici car
  //    ce sont des assets stables addressés par nom fixe (icônes, etc.).
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      })),
  );
});
