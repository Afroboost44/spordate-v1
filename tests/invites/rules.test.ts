/**
 * Tests Phase 8 sub-chantier 4 commit 1/6 — Firestore rules /invites/{id}.
 *
 * Exécution :
 *   npm run test:invites:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/invites/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4 (cohérent tests/blocks/rules.test.ts).
 *
 * Couverture (6 cas INV1-INV6) :
 *   INV1 : create owner (auth.uid == fromUserId) + status='pending' + doc-id pattern → SUCCESS
 *   INV2 : create avec fromUserId spoofé (auth.uid ≠ fromUserId) → REJET
 *   INV3 : create avec doc-id pattern incorrect (anti-doublon Q10=B) → REJET
 *   INV4 : update accept par toUserId (status pending → accepted + acceptedAt) → SUCCESS
 *   INV5 : update accept par fromUserId (path b reserved toUserId) → REJET
 *   INV6 : update fromUserId immuable (toUserId tente de changer fromUserId) → REJET
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
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
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

const ALICE_UID = 'user_alice_inv';
const BOB_UID = 'user_bob_inv';
const CHARLIE_UID = 'user_charlie_inv';
const SESSION_ID = 'session_inv_1';
const ACTIVITY_ID = 'activity_inv_1';

/** Doc-id pattern Q10=B : `${fromUserId}_${toUserId}_${sessionId}`. */
function inviteDocId(from: string, to: string, sessionId: string): string {
  return `${from}_${to}_${sessionId}`;
}

/** Build payload create valide (anti-doublon doc-id pattern enforced). */
function validInvitePayload(from: string, to: string, sessionId: string) {
  const futureExpiry = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 jours
  return {
    inviteId: inviteDocId(from, to, sessionId),
    fromUserId: from,
    toUserId: to,
    activityId: ACTIVITY_ID,
    sessionId,
    status: 'pending' as const,
    expiresAt: futureExpiry,
    createdAt: serverTimestamp(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-invites-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ===================================================================
  // CREATE rules (INV1-INV3)
  // ===================================================================
  section('CREATE rules /invites/{id} (INV1-INV3)');

  // INV1 : create owner (auth.uid == fromUserId) → SUCCESS
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const docId = inviteDocId(ALICE_UID, BOB_UID, SESSION_ID);
    try {
      await assertSucceeds(
        setDoc(doc(fbDb, 'invites', docId), validInvitePayload(ALICE_UID, BOB_UID, SESSION_ID)),
      );
      passManually('INV1 create owner alice → bob session_1 → SUCCESS');
    } catch (e) {
      failManually('INV1 (expected success)', e);
    }
  }

  // INV2 : create avec fromUserId spoofé (alice écrit fromUserId='bob') → REJET
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const docId = inviteDocId(BOB_UID, CHARLIE_UID, SESSION_ID);
    try {
      await assertFails(
        setDoc(doc(fbDb, 'invites', docId), validInvitePayload(BOB_UID, CHARLIE_UID, SESSION_ID)),
      );
      passManually('INV2 create fromUserId spoofé (alice écrit from=bob) → REJET (anti-spoof)');
    } catch (e) {
      failManually('INV2 (expected fail anti-spoof)', e);
    }
  }

  // INV3 : create avec doc-id pattern incorrect (anti-doublon Q10=B)
  // Pattern attendu = `${fromUserId}_${toUserId}_${sessionId}`. Si alice utilise un autre id → REJET.
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const wrongDocId = 'random_wrong_id_pattern';
    try {
      await assertFails(
        setDoc(
          doc(fbDb, 'invites', wrongDocId),
          validInvitePayload(ALICE_UID, BOB_UID, SESSION_ID),
        ),
      );
      passManually('INV3 create avec doc-id hors pattern → REJET (anti-doublon Q10=B)');
    } catch (e) {
      failManually('INV3 (expected fail doc-id pattern)', e);
    }
  }

  // ===================================================================
  // UPDATE rules (INV4-INV6)
  // ===================================================================
  section('UPDATE rules /invites/{id} : transitions strictes (INV4-INV6)');

  // Setup : seed un invite pending alice→bob session_2 via security-disabled
  const SETUP_SESSION_ID = 'session_inv_2';
  const setupDocId = inviteDocId(ALICE_UID, BOB_UID, SETUP_SESSION_ID);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'invites', setupDocId), {
      inviteId: setupDocId,
      fromUserId: ALICE_UID,
      toUserId: BOB_UID,
      activityId: ACTIVITY_ID,
      sessionId: SETUP_SESSION_ID,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: Timestamp.now(),
    });
  });

  // INV4 : update accept par toUserId (bob) → SUCCESS
  {
    const bobCtx = env.authenticatedContext(BOB_UID);
    const fbDb = asFirestore(bobCtx.firestore());
    try {
      await assertSucceeds(
        updateDoc(doc(fbDb, 'invites', setupDocId), {
          status: 'accepted',
          acceptedAt: serverTimestamp(),
        }),
      );
      passManually('INV4 update accept par toUserId (bob) → SUCCESS (path a)');
    } catch (e) {
      failManually('INV4 (expected success accept toUserId)', e);
    }
  }

  // INV5 : update accept par fromUserId (alice) → REJET (path b reserved toUserId)
  // Setup nouveau invite pending pour test indépendant
  const SESSION_3 = 'session_inv_3';
  const docId3 = inviteDocId(ALICE_UID, BOB_UID, SESSION_3);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'invites', docId3), {
      inviteId: docId3,
      fromUserId: ALICE_UID,
      toUserId: BOB_UID,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_3,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: Timestamp.now(),
    });
  });
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'invites', docId3), {
          status: 'accepted',
          acceptedAt: serverTimestamp(),
        }),
      );
      passManually('INV5 update accept par fromUserId (alice) → REJET (path a reserved toUserId)');
    } catch (e) {
      failManually('INV5 (expected fail fromUserId accept)', e);
    }
  }

  // INV6 : update fromUserId immuable (bob essaie de changer fromUserId='charlie')
  const SESSION_4 = 'session_inv_4';
  const docId4 = inviteDocId(ALICE_UID, BOB_UID, SESSION_4);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'invites', docId4), {
      inviteId: docId4,
      fromUserId: ALICE_UID,
      toUserId: BOB_UID,
      activityId: ACTIVITY_ID,
      sessionId: SESSION_4,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: Timestamp.now(),
    });
  });
  {
    const bobCtx = env.authenticatedContext(BOB_UID);
    const fbDb = asFirestore(bobCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'invites', docId4), {
          fromUserId: CHARLIE_UID, // ❌ tentative mutation champ immuable
          status: 'accepted',
          acceptedAt: serverTimestamp(),
        }),
      );
      passManually('INV6 update fromUserId immuable (bob change vers charlie) → REJET');
    } catch (e) {
      failManually('INV6 (expected fail immutable fromUserId)', e);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Invites rules (INV1-INV6) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
