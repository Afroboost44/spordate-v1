# Tests Spordate

Tests standalone pour les services backend. Pas de framework de test (pas de Jest/Vitest/Mocha).

## Tests purs (sans Firestore)

```bash
npx tsx tests/sessions-pure.test.ts
```

Couvre les fonctions sans accès Firestore (computePricingTier, computeChatWindow, getChatPhase, isSessionBookable). Aucune dépendance externe — peut tourner partout.

## Tests d'intégration (avec emulator Firestore)

```bash
firebase emulators:exec --only firestore "npx tsx tests/sessions-integration.test.ts"
```

Nécessite :
- `firebase-tools` CLI installé (`npm install -g firebase-tools`)
- `@firebase/rules-unit-testing@4.0.1` (déjà en devDep)
- `firestore.rules` chargé depuis le repo (les rules de Phase 1 sont appliquées dans l'emulator)

Couvre 8 cas :
1. createSession happy path
2. createSession rejet par rules (autre partner)
3. getSession + subscribeToSession
4. getUpcomingSessions filtré par city
5. bookSession happy path
6. bookSession idempotency (même paymentIntentId)
7. bookSession session pleine
8. bookSession concurrent (race sur la dernière place)

### Test seam

`src/services/firestore.ts` exporte une fonction interne `__setSessionsDbForTesting(testDb)` qui permet
d'injecter le Firestore de l'emulator dans les services Phase 2 (Sessions). Côté prod, ce override reste
null et les services utilisent la `db` globale de `@/lib/firebase`.

## Convention

- 1 fichier `.test.ts` par domaine.
- Mini helper `assertEq(actual, expected, label)` au début du fichier — pas de framework.
- `process.exit(1)` si au moins un test échoue.
- Sortie format `PASS  <label>` / `FAIL  <label>` (pas d'emoji pour la portabilité console).
