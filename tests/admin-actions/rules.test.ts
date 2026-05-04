/**
 * Tests Phase 7 sub-chantier 5 commit 3/3 — Firestore rules /adminActions/
 * defense-in-depth (cohérent rules commit 2/3).
 *
 * Exécution :
 *   npm run test:admin-actions:rules
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/admin-actions/rules.test.ts")
 *
 * Pattern : @firebase/rules-unit-testing v4.
 *
 * Couverture AA1-AA10 :
 *
 * CREATE rules (defense-in-depth Q4) :
 *   AA1 : create par admin + payload valide → SUCCESS
 *   AA2 : create par non-admin → REJET
 *   AA3 : adminId spoofé (≠ auth.uid) → REJET
 *   AA4 : actionType invalid (hors enum 8 values) → REJET
 *   AA5 : targetType invalid (hors enum 3 values) → REJET
 *   AA6 : createdAt != request.time (backdate) → REJET
 *   AA7 : keys hasOnly violation (champ extra) → REJET
 *
 * UPDATE + DELETE :
 *   AA8 : update toujours → REJET (immuable)
 *   AA9 : delete toujours → REJET (audit 24mo)
 *
 * READ :
 *   AA10 : read par non-admin → REJET
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

const ADMIN_UID = 'user_admin_aa';
const NON_ADMIN_UID = 'user_normal_aa';

function validAdminActionPayload(opts: {
  adminId: string;
  actionType?: string;
  targetType?: string;
  targetId?: string;
}) {
  return {
    actionId: 'will-be-overridden',
    adminId: opts.adminId,
    actionType: opts.actionType ?? 'review_publish',
    targetType: opts.targetType ?? 'review',
    targetId: opts.targetId ?? 'review_aa1',
    createdAt: serverTimestamp(),
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-admin-actions-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // -------------------------------------------------------------------
  // SETUP : users (admin role pour ADMIN_UID)
  // -------------------------------------------------------------------
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    await setDoc(doc(fbDb, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin-aa@test.local',
      displayName: 'Admin AA',
      role: 'admin',
    });
    await setDoc(doc(fbDb, 'users', NON_ADMIN_UID), {
      uid: NON_ADMIN_UID,
      email: 'user-aa@test.local',
      displayName: 'User AA',
      role: 'user',
    });
  });

  // ===================================================================
  // CREATE rules (AA1-AA7)
  // ===================================================================
  section('/adminActions/ CREATE rules : defense-in-depth (AA1-AA7)');

  // AA1 : admin happy path
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = validAdminActionPayload({ adminId: ADMIN_UID });
    try {
      await assertSucceeds(setDoc(doc(fbDb, 'adminActions', 'aa1-happy'), payload));
      passManually('AA1 admin + payload valide → SUCCESS');
    } catch (e) {
      failManually('AA1 (expected success)', e);
    }
  }

  // AA2 : non-admin create
  {
    const userCtx = env.authenticatedContext(NON_ADMIN_UID);
    const fbDb = asFirestore(userCtx.firestore());
    const payload = validAdminActionPayload({ adminId: NON_ADMIN_UID });
    try {
      await assertFails(setDoc(doc(fbDb, 'adminActions', 'aa2-nonadmin'), payload));
      passManually('AA2 non-admin → REJET');
    } catch (e) {
      failManually('AA2 (expected fail)', e);
    }
  }

  // AA3 : adminId spoofé (admin auth + adminId pointe sur quelqu'un d'autre)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = validAdminActionPayload({ adminId: NON_ADMIN_UID }); // spoofed
    try {
      await assertFails(setDoc(doc(fbDb, 'adminActions', 'aa3-spoof'), payload));
      passManually('AA3 adminId spoofé (≠ auth.uid) → REJET');
    } catch (e) {
      failManually('AA3 (expected fail)', e);
    }
  }

  // AA4 : actionType invalid (hors enum 8 values)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = validAdminActionPayload({
      adminId: ADMIN_UID,
      actionType: 'fake_action_type',
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'adminActions', 'aa4-bad-type'), payload));
      passManually('AA4 actionType hors enum → REJET');
    } catch (e) {
      failManually('AA4 (expected fail)', e);
    }
  }

  // AA5 : targetType invalid (hors enum 3 values)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = validAdminActionPayload({
      adminId: ADMIN_UID,
      targetType: 'block', // hors enum (Phase 9 polish)
    });
    try {
      await assertFails(setDoc(doc(fbDb, 'adminActions', 'aa5-bad-target'), payload));
      passManually('AA5 targetType hors enum → REJET');
    } catch (e) {
      failManually('AA5 (expected fail)', e);
    }
  }

  // AA6 : createdAt != request.time (backdate)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = {
      ...validAdminActionPayload({ adminId: ADMIN_UID }),
      createdAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000), // 1h ago
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'adminActions', 'aa6-backdate'), payload));
      passManually('AA6 createdAt != request.time (backdate) → REJET');
    } catch (e) {
      failManually('AA6 (expected fail)', e);
    }
  }

  // AA7 : keys hasOnly violation (champ extra)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    const payload = {
      ...validAdminActionPayload({ adminId: ADMIN_UID }),
      extraField: 'unauthorized', // hors keys hasOnly
    };
    try {
      await assertFails(setDoc(doc(fbDb, 'adminActions', 'aa7-extra'), payload));
      passManually('AA7 keys hasOnly viole (champ extra) → REJET');
    } catch (e) {
      failManually('AA7 (expected fail)', e);
    }
  }

  // ===================================================================
  // UPDATE + DELETE (AA8-AA9)
  // ===================================================================
  section('/adminActions/ UPDATE + DELETE (AA8-AA9)');

  const ACTION_FOR_MUTATIONS = 'aa1-happy'; // créé en AA1

  // AA8 : update toujours → REJET (immuable)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertFails(
        updateDoc(doc(fbDb, 'adminActions', ACTION_FOR_MUTATIONS), {
          reason: 'Tentative update interdite',
        }),
      );
      passManually('AA8 update par admin → REJET (audit immuable)');
    } catch (e) {
      failManually('AA8 (expected fail)', e);
    }
  }

  // AA9 : delete toujours → REJET (audit 24mo)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertFails(deleteDoc(doc(fbDb, 'adminActions', ACTION_FOR_MUTATIONS)));
      passManually('AA9 delete par admin → REJET (conservation 24 mois)');
    } catch (e) {
      failManually('AA9 (expected fail)', e);
    }
  }

  // ===================================================================
  // READ (AA10)
  // ===================================================================
  section('/adminActions/ READ : admin only (AA10)');

  // AA10a : non-admin tente read → REJET
  {
    const userCtx = env.authenticatedContext(NON_ADMIN_UID);
    const fbDb = asFirestore(userCtx.firestore());
    try {
      await assertFails(getDoc(doc(fbDb, 'adminActions', ACTION_FOR_MUTATIONS)));
      passManually('AA10 read par non-admin → REJET');
    } catch (e) {
      failManually('AA10 (expected fail)', e);
    }
  }

  // AA10b (bonus) : admin read → SUCCESS (vérif positif read scope admin)
  {
    const adminCtx = env.authenticatedContext(ADMIN_UID);
    const fbDb = asFirestore(adminCtx.firestore());
    try {
      await assertSucceeds(getDoc(doc(fbDb, 'adminActions', ACTION_FOR_MUTATIONS)));
      passManually('AA10b read par admin → SUCCESS');
    } catch (e) {
      failManually('AA10b (expected success)', e);
    }
  }

  await env.cleanup();

  console.log('');
  console.log('====== Résumé /adminActions/ rules (AA1-AA10) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
