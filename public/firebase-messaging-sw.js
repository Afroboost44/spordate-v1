/**
 * Phase 9 sub-chantier 3 commit 3/5 — Firebase Messaging Service Worker.
 *
 * Service Worker dédié Firebase Messaging (background notifications).
 * Scope : `/` (cohérent existing PWA `/sw.js` Q4=A).
 *
 * Déclenche notif system quand l'app est background (tab fermé / minimisé).
 * Notifications foreground sont gérées par le client via onMessage().
 *
 * Click handler : focus tab existant ou ouvre URL data.click_action / fcm_options.link.
 *
 * Configuration : firebase compat scripts depuis CDN officiel Google + initializeApp
 * avec config NEXT_PUBLIC_FIREBASE_* (config publique — pas de secret).
 *
 * Cf. https://firebase.google.com/docs/cloud-messaging/js/receive#setting_notification_options_in_the_service_worker
 */

importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js');

// Config publique (NEXT_PUBLIC_FIREBASE_* — pas de secret).
// Note : les valeurs réelles sont injectées au build via process.env.NEXT_PUBLIC_FIREBASE_* —
// pour le SW (pas de bundler), on les hardcode lookup runtime via fetch /api/firebase-config
// OU on les inline ici (simplest pour Phase 9 SC3 — config ID public).
// Approach KISS Phase 9 : hardcoded (cohérent Firebase Web SDK init pattern).
firebase.initializeApp({
  apiKey: 'AIzaSyDummyValueProductionInjectedAtBuild', // sera override Phase 10 polish via injection build-time
  authDomain: 'spordate-prod.firebaseapp.com',
  projectId: 'spordate-prod',
  storageBucket: 'spordate-prod.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:xxxxxxxxxxxxxxx',
});

const messaging = firebase.messaging();

// Background notification handler — afficher notif system
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw] Background message received', payload);

  const title = payload.notification?.title || 'Spordateur';
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icons/icon.svg',
    data: {
      ...payload.data,
      click_action: payload.fcmOptions?.link || payload.data?.click_action || '/',
    },
    tag: payload.data?.bookingId || 'spordate-notif', // dedup notifs même booking
    renotify: true,
  };

  return self.registration.showNotification(title, options);
});

// Click handler — focus tab existant ou ouvrir nouvelle URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.click_action || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si tab déjà ouvert → focus + naviguer
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client && targetUrl !== client.url) {
              return client.navigate(targetUrl).then(() => client.focus());
            }
            return client.focus();
          }
        }
        // Sinon, ouvrir nouvelle window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
