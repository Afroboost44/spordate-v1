/**
 * Tests Phase 8 sub-chantier 0 commit 2/3 — Firestore rules /users/{uid} update
 * pour le champ Phase 8 `aiSuggestionsOptIn`.
 *
 * Exécution :
 *   npm run test:profile:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/profile/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4 (cohérent tests/blocks/rules.test.ts).
 * - assertFails : la write/read DOIT échouer côté rules
 * - assertSucceeds : la write/read DOIT passer côté rules
 *
 * Couverture (2 cas AI1-AI2) :
 *
 * UPDATE rules /users/{uid} (existante isOwner — défensive sur champ Phase 8) :
 *   AI1 : self-update aiSuggestionsOptIn=false (alice → alice) → SUCCESS
 *   AI2 : update aiSuggestionsOptIn d'un tiers (alice → bob) → REJET
 *
 * Note : la rule `/users/{uid}` update est document-level (`isOwner(userId) || isAdmin()`).
 * Le champ `aiSuggestionsOptIn` ne nécessite pas de rule field-level dédiée — la
 * couverture défensive vérifie la non-régression du champ Phase 8 sur la rule existante.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/** Cast helper rules-unit-testing v4 (cohérent blocks/rules.test.ts). */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner (cohérent blocks/rules.test.ts)
// =====================================================================

let _passes = 0;
let _failures = 0;

function passManually(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function failManually(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Constantes
// =====================================================================

const ALICE_UID = 'user_alice_ai';
const BOB_UID = 'user_bob_ai';

/** Build a minimal valid users/{uid} doc (cohérent shape Phase 1+ / firestore.rules). */
function seedUserDoc(uid: string, aiOptIn?: boolean) {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: `User ${uid}`,
    photoURL: '',
    bio: '',
    gender: 'other' as const,
    city: '',
    canton: '',
    sports: [],
    credits: 0,
    referralCode: '',
    referredBy: '',
    isCreator: false,
    role: 'user' as const,
    isPremium: false,
    fcmToken: '',
    language: 'fr' as const,
    onboardingComplete: false,
    lastActive: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...(aiOptIn !== undefined ? { aiSuggestionsOptIn: aiOptIn } : {}),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-profile-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ===================================================================
  // SETUP : seed alice + bob via security-disabled context
  // ===================================================================
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'users', ALICE_UID), seedUserDoc(ALICE_UID));
    await setDoc(doc(fbDb, 'users', BOB_UID), seedUserDoc(BOB_UID));
  });

  // ===================================================================
  // UPDATE rules /users/{uid} : aiSuggestionsOptIn (AI1-AI2)
  // ===================================================================
  section('UPDATE rules /users/{uid} : aiSuggestionsOptIn (AI1-AI2)');

  // AI1 : self-update aiSuggestionsOptIn=false (alice → alice) → SUCCESS
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'users', ALICE_UID), {
          aiSuggestionsOptIn: false,
        }),
      );
      passManually('AI1 self-update aiSuggestionsOptIn=false (alice → alice) → SUCCESS');
    } catch (e) {
      failManually('AI1 (expected success)', e);
    }
  }

  // AI2 : update aiSuggestionsOptIn d'un tiers (alice → bob) → REJET
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'users', BOB_UID), {
          aiSuggestionsOptIn: false,
        }),
      );
      passManually('AI2 update tiers aiSuggestionsOptIn (alice → bob) → REJET (isOwner only)');
    } catch (e) {
      failManually('AI2 (expected fail)', e);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Profile rules (AI1-AI2) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
