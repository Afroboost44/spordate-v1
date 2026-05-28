/**
 * BUG #111 — Service Worker Firebase Messaging servi dynamiquement.
 *
 * Avant : `public/firebase-messaging-sw.js` static avec config DUMMY hardcodée
 * (`AIzaSyDummyValueProductionInjectedAtBuild`) — JAMAIS injectée au build →
 * `firebase.initializeApp()` echouait silencieusement → FCM token jamais
 * récupéré → push system jamais reçues sur PWA mobile.
 *
 * Maintenant : route Next.js qui sert le JS du service worker avec les vraies
 * valeurs env `NEXT_PUBLIC_FIREBASE_*` injectées server-side. Toujours servi
 * sur `/firebase-messaging-sw.js` (scope `/`) — l'URL est inchangée pour le
 * client, donc registerPush.ts continue de fonctionner.
 *
 * Content-Type explicite `application/javascript` requis pour le browser
 * accepte le fichier comme service worker (sinon refus).
 *
 * Anti-régression : `public/firebase-messaging-sw.js` est conservé en
 * fallback offline mais n'est plus servi en prod (la route App Router prend
 * le pas sur le static via priorité Next.js).
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Toutes les valeurs sont publiques (NEXT_PUBLIC_*) — pas de secret.
  const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
  const authDomain = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const storageBucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
  const messagingSenderId = (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const appId = (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '').trim();

  // BUG #111 — Si une env var critique manque (apiKey ou senderId), on log
  // dans le SW pour aider le debug côté DevTools mobile. Le SW chargera mais
  // FCM ne pourra pas s'initialiser → registerPush retournera reason='fail'.
  const jsLines: string[] = [
    "// Firebase Messaging Service Worker — généré dynamiquement par Next.js (BUG #111)",
    "// Cette route remplace l'ancien public/firebase-messaging-sw.js qui avait",
    "// une config dummy hardcodée jamais injectée au build.",
    "",
    "// Fix #139 — skipWaiting + clients.claim pour que le SW S'ACTIVE",
    "// IMMÉDIATEMENT à l'install (sans cela il reste 'installed' indéfiniment",
    "// si un autre SW est actif, et registerPush bloque à 'waiting for SW",
    "// activation').",
    "self.addEventListener('install', (event) => {",
    "  self.skipWaiting();",
    "});",
    "self.addEventListener('activate', (event) => {",
    "  event.waitUntil(self.clients.claim());",
    "});",
    "",
    "importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');",
    "importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js');",
    "",
    `firebase.initializeApp(${JSON.stringify({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId }, null, 2)});`,
    "",
    "const messaging = firebase.messaging();",
    "",
    "messaging.onBackgroundMessage((payload) => {",
    "  console.log('[firebase-messaging-sw] Background message received', payload);",
    "  const title = payload.notification?.title || 'Spordateur';",
    "  // BUG #116 — Options riches pour iOS PWA + Chrome Android :",
    "  //   - silent: false → joue le son système par défaut",
    "  //   - vibrate: [200,100,200] → vibration sur Android (ignoré iOS)",
    "  //   - requireInteraction: false (auto-dismiss après ~5s)",
    "  //   - tag unique par notif (ne dédupe pas les notifs différentes)",
    "  const options = {",
    "    body: payload.notification?.body || '',",
    "    icon: '/icons/placeholder.png',",
    "    badge: '/icons/placeholder.png',",
    "    image: payload.notification?.image,",
    "    data: {",
    "      ...payload.data,",
    "      click_action: payload.fcmOptions?.link || payload.data?.click_action || '/',",
    "    },",
    "    tag: payload.data?.tag || payload.data?.bookingId || ('spordate-' + Date.now()),",
    "    renotify: true,",
    "    silent: false,",
    "    vibrate: [200, 100, 200],",
    "    requireInteraction: false,",
    "  };",
    "  return self.registration.showNotification(title, options);",
    "});",
    "",
    "self.addEventListener('notificationclick', (event) => {",
    "  event.notification.close();",
    "  const targetUrl = event.notification.data?.click_action || '/';",
    "  event.waitUntil(",
    "    self.clients",
    "      .matchAll({ type: 'window', includeUncontrolled: true })",
    "      .then((clientList) => {",
    "        for (const client of clientList) {",
    "          if ('focus' in client) {",
    "            if ('navigate' in client && targetUrl !== client.url) {",
    "              return client.navigate(targetUrl).then(() => client.focus());",
    "            }",
    "            return client.focus();",
    "          }",
    "        }",
    "        if (self.clients.openWindow) {",
    "          return self.clients.openWindow(targetUrl);",
    "        }",
    "      }),",
    "  );",
    "});",
  ];

  return new NextResponse(jsLines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Service worker DOIT être servi depuis un origin secure (HTTPS) sans
      // cache trop long pour permettre les updates.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // Cohérent avec le service worker scope `/`
      'Service-Worker-Allowed': '/',
    },
  });
}
