# Phase 9 SC3 c3/5 — Smoke test manuel push notifications

Tests automated SC3 c2-c3 (PUSH1-PUSH4 + POI1-POI5 = ~25 assertions automated).
Ce doc complète avec les paths browser-specific qui ne peuvent pas être couverts
par tests Node-side.

## Pré-requis

- Vercel prod déployé
- Firestore rules déployées
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY` configuré (Vercel env vars production)
- Compte test connecté à `/profile`

## Browser support matrix

| Browser | Push API | Service Worker | Expected |
|---|---|---|---|
| Chrome 80+ desktop | ✅ | ✅ | Toggle activable, push reçus |
| Chrome Android | ✅ | ✅ | Toggle activable, push reçus |
| Firefox 64+ desktop | ✅ | ✅ | Toggle activable, push reçus |
| Safari macOS 16.4+ | ✅ | ✅ | Toggle activable, push reçus |
| Safari iOS 16.4+ | ✅ (PWA installée) | ✅ | Toggle activable si PWA installée — sinon disabled |
| Safari iOS <16.4 | ❌ | ✅ | Toggle disabled silently (Q6=A) — email fallback |
| Edge desktop | ✅ | ✅ | Toggle activable, push reçus |

## Flow nominal — toggle ON depuis /profile

1. **Connecte-toi à Spordateur** sur Chrome/Firefox/Safari (≥16.4)
2. **Ouvre `/profile`** → section "Confidentialité"
3. **Toggle "Notifications push"** : doit être **OFF par défaut visuellement** (mais default-on côté serveur)
   - *Note* : par défaut `pushNotificationsEnabled !== false` côté serveur, mais sans `fcmToken` → email fallback Q3=B
   - Le toggle UI reflète l'état effective : `enabled && supported`
4. **Clique pour activer** → `Notification.requestPermission()` prompt browser → "Autoriser"
5. **Toast** : "Notifications activées — Tu recevras les rappels..."
6. **Vérifie Firestore** `users/{uid}` :
   - `fcmToken` set (string ~150 chars)
   - `pushNotificationsEnabled: true`

## Flow refus permission

1. Toggle ON sur navigator support
2. Click "Bloquer" sur Notification prompt
3. Toast destructive : "Permission refusée par ton navigateur..."
4. Toggle revert OFF (optimistic UI rollback)
5. Vérifie Firestore : `fcmToken` NOT set, `pushNotificationsEnabled` NOT set (ou inchangé)

## Flow toggle OFF

1. Pré-requis : `fcmToken` set + `pushNotificationsEnabled: true`
2. **Toggle "Notifications push"** OFF
3. **Toast info** : "Notifications désactivées — Tu recevras toujours les emails fallback."
4. Vérifie Firestore : `fcmToken` removed (deleteField), `pushNotificationsEnabled: false`
5. Test cron/review-reminder en prod → user reçoit email fallback (no push)

## Flow Safari iOS <16.4 (Q6=A silent skip)

1. Ouvre Spordateur sur Safari iOS 15.x
2. `/profile` → section "Confidentialité"
3. Toggle disabled (greyed out)
4. Description sous toggle : "Ton navigateur ne supporte pas les notifications push (Safari iOS <16.4 par exemple). Tu recevras les rappels par email uniquement."
5. Pas de toggle clickable, pas de prompt
6. User reçoit emails (legacy fallback)

## Flow background push

1. Toggle ON + permission granted
2. **Ferme tous les onglets Spordateur** (background)
3. **Trigger** : un cron `review-reminder` ou `session-reminders` fire
4. **Notif system apparaît** (icône Spordateur, title, body)
5. **Click notif** → focus tab existant OU ouvre `clickUrl` (sessions/[id], etc.)
6. Vérifie navigation correcte

## Flow background push avec data deeplink

1. Toggle ON
2. Cron `session-reminders` J-1 fire pour booking session_xyz
3. Notif title "Demain : Yoga Sunset" + body "Sam 18 mai 14h00 avec Coach Léa"
4. Click → ouvre `/sessions/session_xyz`
5. Vérifie page session ouvre correctement

## Edge cases anti-doublon (FCM tag)

1. Toggle ON
2. Cron fire push pour booking_x (tag=booking_x dans firebase-messaging-sw.js)
3. Cron fire 2nd push pour MÊME booking_x (replay/race)
4. **Notif precedente remplacée** (FCM `tag` + `renotify`)
5. Pas de doublon dans notification center

## Token cleanup (Phase 10 polish — pas Phase 9 SC3 c3)

1. Toggle ON sur device A → `fcmToken: "tokenA"` persisted
2. Toggle ON sur device B (même user) → `fcmToken: "tokenB"` overwrite (single token per user MVP)
3. Cron push → tokenB only (device A inactif)
4. Phase 10 polish : multi-device support (`users/{uid}/fcmTokens/{tokenId}` subcollection)

## Différé Phase 10 (NON couvert SC3 c3)

- ⏭️ Multi-device tokens (subcollection vs single field)
- ⏭️ Auto-cleanup tokens 'token-not-registered' (signal already typed dans helper)
- ⏭️ VAPID key injection build-time dans firebase-messaging-sw.js (current : hardcoded config publique)
- ⏭️ A/B test push title/body wording (engagement metrics)
- ⏭️ Analytics push delivery rate (Firebase Cloud Messaging dashboard)

## Régression check

- [ ] User sans fcmToken → email fallback (Q3=B legacy preserved)
- [ ] User avec fcmToken + opt-out → email fallback
- [ ] User avec fcmToken + opt-in → push delivered (no email)
- [ ] Push fail (token invalid) → email fallback auto best-effort
- [ ] aiSuggestionsOptIn toggle inchangé (Phase 8 SC0 préservé)
- [ ] Build SUCCESS Vercel (firebase-messaging-sw.js servi à `/firebase-messaging-sw.js`)
- [ ] Service Worker registered visible dans browser DevTools → Application → Service Workers
