// BUG #111 — Ce fichier statique a été NEUTRALISÉ. Le service worker FCM
// est désormais servi dynamiquement par /src/app/firebase-messaging-sw.js/route.ts
// qui injecte les vraies env vars Firebase au lieu des valeurs dummy.
//
// Si tu vois ce contenu dans le navigateur, c'est que la route Next.js n'a pas
// pris le pas sur le fichier statique. Vérifier :
//   1. Le déploiement contient bien le nouveau code (rsync + docker build)
//   2. Le cache PWA a été vidé (Application → Storage → Clear site data)
//   3. Le service worker a été unregister (DevTools → Application → SW → Unregister)
//
// Cette ligne console.warn permet d'identifier en DevTools si le mauvais SW
// est servi (alerts mais ne casse pas).
console.warn('[firebase-messaging-sw] STALE FILE — should be served from /app route');
