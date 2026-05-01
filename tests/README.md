# Tests Spordate

Tests standalone pour les services backend. Pas de framework de test (pas de Jest/Vitest/Mocha).

## Tests purs (sans Firestore)

```bash
# Phase 1+2 — services Firestore Sessions (23 cas)
npx tsx tests/sessions-pure.test.ts

# Phase 4 — helpers UI countdown (7 cas)
npx tsx tests/sessions-ui-pure.test.ts
```

`sessions-pure.test.ts` couvre les fonctions service sans accès Firestore (computePricingTier, computeChatWindow, getChatPhase, isSessionBookable). Aucune dépendance externe — peut tourner partout.

`sessions-ui-pure.test.ts` couvre les helpers UI extraits (breakdownMs, formatBadge). Pas de React, pas de Firestore. Importable n'importe où.

## Tests d'intégration (avec emulator Firestore)

```bash
# Phase 2 — services Firestore Sessions (8 cas)
firebase emulators:exec --only firestore "npx tsx tests/sessions-integration.test.ts"

# Phase 3 — webhook Stripe mode 'session' + régression mode 'package' (4 cas)
firebase emulators:exec --only firestore "npx tsx tests/sessions-checkout.test.ts"
```

Nécessite :
- `firebase-tools` CLI installé (`npm install -g firebase-tools`)
- Java 21+ pour l'emulator Firestore
- `@firebase/rules-unit-testing@4.0.1` (déjà en devDep, utilisé par sessions-integration)
- `firestore.rules` chargé depuis le repo (les rules de Phase 1 sont appliquées dans l'emulator)

### `sessions-integration.test.ts` (Phase 2) — 8 cas

1. createSession happy path
2. createSession rejet par rules (autre partner)
3. getSession + subscribeToSession
4. getUpcomingSessions filtré par city
5. bookSession happy path
6. bookSession idempotency (même paymentIntentId)
7. bookSession session pleine
8. bookSession concurrent (race sur la dernière place)

### `sessions-checkout.test.ts` (Phase 3) — 4 cas

3. Webhook session happy path (booking + bundle credits + chatUnlocked)
4. Webhook idempotency (2 retries → 1 seul booking)
5. Webhook session pleine → erreur log + notif user, pas de booking
7. Régression mode 'package' (legacy, sans metadata.mode → flow existant)

Note : on ne teste PAS le flow `/api/checkout` HTTP côté client (T1/T2/T6 du plan)
car l'anti-cheat est garanti par construction (`computePricingTier` server-side
ignore tout `amount`/`tier` envoyé par le client).

### Test seam

`src/services/firestore.ts` exporte une fonction interne `__setSessionsDbForTesting(testDb)` qui permet
d'injecter le Firestore de l'emulator dans les services Phase 2 (Sessions). Côté prod, ce override reste
null et les services utilisent la `db` globale de `@/lib/firebase`.

## Convention

- 1 fichier `.test.ts` par domaine.
- Mini helper `assertEq(actual, expected, label)` au début du fichier — pas de framework.
- `process.exit(1)` si au moins un test échoue.
- Sortie format `PASS  <label>` / `FAIL  <label>` (pas d'emoji pour la portabilité console).
