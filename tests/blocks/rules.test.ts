/**
 * Tests Phase 7 sub-chantier 2 commit 4/4 — Firestore rules /blocks/{blockId}
 * defense-in-depth (cohérent rules commit 1/4).
 *
 * Exécution :
 *   npm run test:blocks:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/blocks/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4 (cohérent tests/reviews/rules.test.ts).
 * - assertFails : la write/read DOIT échouer côté rules
 * - assertSucceeds : la write/read DOIT passer côté rules
 *
 * Couverture (12 cas RB1-RB12) :
 *
 * CREATE rules (defense-in-depth commit 1/4) :
 *   RB1 : create blockerId == auth.uid + doc-id pattern correct → SUCCESS
 *   RB2 : create blockerId spoofé (≠ auth.uid) → REJET (anti-spoofing)
 *   RB3 : create self-block (blockerId == blockedId) → REJET
 *   RB4 : create createdAt != server time → REJET (anti-backdate)
 *   RB5 : create doc-id pattern hors `${blockerId}_${blockedId}` → REJET
 *
 * READ rules :
 *   RB6 : read par blocker → SUCCESS
 *   RB7 : read par blocked → SUCCESS
 *   RB8 : read par tiers (ni blocker ni blocked) → REJET
 *
 * UPDATE rules :
 *   RB9 : update toujours → REJET (immuable)
 *
 * DELETE rules :
 *   RB10 : delete par blocker → SUCCESS
 *   RB11 : delete par blocked → REJET (réservé blocker)
 *   RB12 : delete par tiers → REJET
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
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/** Cast helper rules-unit-testing v4 (cohérent reviews/rules.test.ts). */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner (cohérent reviews/rules.test.ts)
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

const ALICE_UID = 'user_alice_rb';
const BOB_UID = 'user_bob_rb';
const CHARLIE_UID = 'user_charlie_rb';

/** Construit un payload valide pour create (cohérent firestore.rules section /blocks). */
function validBlockPayload(opts: { blockerId: string; blockedId: string }) {
  return {
    blockId: `${opts.blockerId}_${opts.blockedId}`,
    blockerId: opts.blockerId,
    blockedId: opts.blockedId,
    createdAt: serverTimestamp(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-blocks-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ===================================================================
  // SETUP : pas de docs users requis (rule blocks ne fait pas de get cross-collection)
  // ===================================================================

  // ===================================================================
  // CREATE rules — defense-in-depth (RB1-RB5)
  // ===================================================================
  section('CREATE rules : defense-in-depth (RB1-RB5)');

  // RB1 : create blockerId == auth.uid + doc-id pattern correct → SUCCESS
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const payload = validBlockPayload({ blockerId: ALICE_UID, blockedId: BOB_UID });
    try {
      await assertSucceeds(
        setDoc(doc(fbDb, 'blocks', `${ALICE_UID}_${BOB_UID}`), payload),
      );
      passManually('RB1 create blockerId == auth.uid + doc-id correct → SUCCESS');
    } catch (e) {
      failManually('RB1 (expected success)', e);
    }
  }

  // RB2 : create blockerId spoofé (≠ auth.uid) → REJET
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const payload = validBlockPayload({ blockerId: BOB_UID, blockedId: CHARLIE_UID }); // spoofé
    try {
      await assertFails(
        setDoc(doc(fbDb, 'blocks', `${BOB_UID}_${CHARLIE_UID}`), payload),
      );
      passManually('RB2 create blockerId spoofé (≠ auth.uid) → REJET (anti-spoofing)');
    } catch (e) {
      failManually('RB2 (expected fail)', e);
    }
  }

  // RB3 : create self-block (blockerId == blockedId) → REJET
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const payload = validBlockPayload({ blockerId: ALICE_UID, blockedId: ALICE_UID });
    try {
      await assertFails(
        setDoc(doc(fbDb, 'blocks', `${ALICE_UID}_${ALICE_UID}`), payload),
      );
      passManually('RB3 create self-block (blockerId == blockedId) → REJET');
    } catch (e) {
      failManually('RB3 (expected fail)', e);
    }
  }

  // RB4 : create createdAt != server time → REJET (anti-backdate)
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const payload = {
      blockId: `${ALICE_UID}_${CHARLIE_UID}`,
      blockerId: ALICE_UID,
      blockedId: CHARLIE_UID,
      createdAt: Timestamp.fromMillis(Date.now() - 1000 * 60 * 60), // 1h ago — pas request.time
    };
    try {
      await assertFails(
        setDoc(doc(fbDb, 'blocks', `${ALICE_UID}_${CHARLIE_UID}`), payload),
      );
      passManually('RB4 create createdAt != server time (backdate) → REJET');
    } catch (e) {
      failManually('RB4 (expected fail)', e);
    }
  }

  // RB5 : create doc-id pattern hors `${blockerId}_${blockedId}` → REJET
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    const payload = validBlockPayload({ blockerId: ALICE_UID, blockedId: CHARLIE_UID });
    try {
      // Doc-id "wrong-id-pattern" ne matche pas blockerId + '_' + blockedId
      await assertFails(setDoc(doc(fbDb, 'blocks', 'wrong-id-pattern'), payload));
      passManually('RB5 create doc-id hors pattern → REJET');
    } catch (e) {
      failManually('RB5 (expected fail)', e);
    }
  }

  // ===================================================================
  // READ rules (RB6-RB8)
  // ===================================================================
  section('READ rules (RB6-RB8)');

  // Setup : block ALICE → BOB déjà créé en RB1. Réutilisé pour les reads.
  const READ_BLOCK_ID = `${ALICE_UID}_${BOB_UID}`;

  // RB6 : read par blocker (Alice) → SUCCESS
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'blocks', READ_BLOCK_ID)));
      passManually('RB6 read par blocker (Alice) → SUCCESS');
    } catch (e) {
      failManually('RB6 (expected success)', e);
    }
  }

  // RB7 : read par blocked (Bob) → SUCCESS (mutuelle invisibilité côté client)
  {
    const bobCtx = env.authenticatedContext(BOB_UID);
    const fbDb = asFirestore(bobCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'blocks', READ_BLOCK_ID)));
      passManually('RB7 read par blocked (Bob) → SUCCESS (mutuelle invisibilité)');
    } catch (e) {
      failManually('RB7 (expected success)', e);
    }
  }

  // RB8 : read par tiers (Charlie, ni blocker ni blocked) → REJET
  {
    const charlieCtx = env.authenticatedContext(CHARLIE_UID);
    const fbDb = asFirestore(charlieCtx.firestore());
    try {
      await assertFails(getDoc(doc(fbDb, 'blocks', READ_BLOCK_ID)));
      passManually('RB8 read par tiers (Charlie) → REJET');
    } catch (e) {
      failManually('RB8 (expected fail)', e);
    }
  }

  // ===================================================================
  // UPDATE rules (RB9)
  // ===================================================================
  section('UPDATE rules : immuable (RB9)');

  // RB9 : update toujours → REJET (immuable, même par blocker)
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'blocks', READ_BLOCK_ID), {
          blockedId: CHARLIE_UID, // tentative mutation
        }),
      );
      passManually('RB9 update même par blocker → REJET (immuable)');
    } catch (e) {
      failManually('RB9 (expected fail)', e);
    }
  }

  // ===================================================================
  // DELETE rules (RB10-RB12)
  // ===================================================================
  section('DELETE rules (RB10-RB12)');

  // Setup : block CHARLIE → BOB pour tests delete (le RB10 va supprimer ALICE→BOB,
  // donc on prépare une nouvelle paire pour RB11/RB12 indépendants)
  const DELETE_BLOCK_ID = `${CHARLIE_UID}_${BOB_UID}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'blocks', DELETE_BLOCK_ID), {
      blockId: DELETE_BLOCK_ID,
      blockerId: CHARLIE_UID,
      blockedId: BOB_UID,
      createdAt: Timestamp.now(),
    });
  });

  // RB10 : delete par blocker (Alice supprime son block ALICE→BOB) → SUCCESS
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertSucceeds(deleteDoc(doc(fbDb, 'blocks', READ_BLOCK_ID)));
      passManually('RB10 delete par blocker (Alice) → SUCCESS');
    } catch (e) {
      failManually('RB10 (expected success)', e);
    }
  }

  // RB11 : delete par blocked (Bob essaie de supprimer CHARLIE→BOB) → REJET
  {
    const bobCtx = env.authenticatedContext(BOB_UID);
    const fbDb = asFirestore(bobCtx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'blocks', DELETE_BLOCK_ID)));
      passManually('RB11 delete par blocked (Bob) → REJET (réservé blocker)');
    } catch (e) {
      failManually('RB11 (expected fail)', e);
    }
  }

  // RB12 : delete par tiers (Alice essaie de supprimer CHARLIE→BOB qui ne la concerne pas) → REJET
  {
    const aliceCtx = env.authenticatedContext(ALICE_UID);
    const fbDb = asFirestore(aliceCtx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'blocks', DELETE_BLOCK_ID)));
      passManually('RB12 delete par tiers (Alice sur CHARLIE→BOB) → REJET');
    } catch (e) {
      failManually('RB12 (expected fail)', e);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Blocks rules (RB1-RB12) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
