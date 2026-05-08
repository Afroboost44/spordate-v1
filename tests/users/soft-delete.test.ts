/**
 * Tests Phase 9 sub-chantier 6 commit 3/4 — softDeleteUser + restoreSoftDeletedUser + cron purge.
 *
 * Exécution :
 *   npm run test:users:soft-delete
 *
 * Pattern : @firebase/rules-unit-testing emulator + DI seam (cohérent SC5 c1 + SC6 c1-c2).
 *
 * Couverture (SD1-SD5 + bonus) :
 *   SD1 softDeleteUser happy → softDeletedAt + softDeleteScheduledPurgeAt = +30j set
 *   SD2 already soft-deleted → throw 'already-soft-deleted' (idempotency)
 *   SD3 restoreSoftDeletedUser dans grace → soft delete fields cleared
 *   SD4 restoreSoftDeletedUser après grace → throw 'grace-expired'
 *   SD5 cron purge anonymise PII (displayName/email/photoURL=null + anonymizedAt set) après grace 30j
 *
 * Bonus :
 *   - rules anti-spoof : Bob set softDeletedAt sur Alice → DENIED par rules
 *   - user déjà anonymisé (cron banlist 24mo SC5 c3) → skip soft delete (idempotency 'already-anonymized')
 *   - reason 501 chars → throw 'invalid-input' (max 500)
 *   - boundary grace 30j exact → still restorable (inclusive)
 *   - isSoftDeleted helper + softDeleteGraceDaysRemaining helper
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-soft-delete';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-soft-delete';
process.env.CRON_SECRET = 'test-cron-secret-sd';

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

import {
  __setSoftDeleteDbForTesting,
  softDeleteUser,
  restoreSoftDeletedUser,
  isSoftDeleted,
  softDeleteGraceDaysRemaining,
  SoftDeleteError,
  SOFT_DELETE_GRACE_DAYS,
  SOFT_DELETE_REASON_MAX_LENGTH,
} from '../../src/lib/users';
import { POST as POSTPurge } from '../../src/app/api/cron/purge-old-data/route';
import type { UserProfile } from '../../src/types/firestore';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

async function expectThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await fn();
    fail(`${label} (expected throw '${expectedCode}', got success)`);
  } catch (err) {
    if (err instanceof SoftDeleteError && err.code === expectedCode) {
      pass(label);
    } else {
      const code = err instanceof SoftDeleteError ? err.code : (err as Error).message;
      fail(`${label} (expected '${expectedCode}', got '${code}')`);
    }
  }
}

// =====================================================================

async function setupUser(
  fbDb: Firestore,
  uid: string,
  extra: Partial<UserProfile> = {},
): Promise<void> {
  await setDoc(doc(fbDb, 'users', uid), {
    uid,
    email: `${uid}@test.local`,
    displayName: uid,
    photoURL: `https://photo.example/${uid}.jpg`,
    bio: `Bio ${uid}`,
    role: 'user',
    ...extra,
  });
}

async function clearAllUsers(fbDb: Firestore): Promise<void> {
  const snap = await getDocs(collection(fbDb, 'users'));
  for (const d of snap.docs) await deleteDoc(d.ref).catch(() => {});
}

async function callPurgeCron(): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-cron-secret-sd',
  };
  const req = new Request('http://localhost/api/cron/purge-old-data', {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTPurge(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-soft-delete',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // Service tests via rules-disabled
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setSoftDeleteDbForTesting(fbDb);

    // ===================================================================
    // SD1 : softDeleteUser happy
    // ===================================================================
    section('SD1 softDeleteUser happy → softDeletedAt + scheduledPurgeAt=+30j');
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_sd1';
      await setupUser(fbDb, ALICE);

      const now = Date.now();
      const result = await softDeleteUser({
        uid: ALICE,
        reason: 'Test reason SD1',
        now: new Date(now),
      });
      const expectedPurgeMs = now + SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      if (
        result.uid === ALICE &&
        Math.abs(result.scheduledPurgeAtMs - expectedPurgeMs) < 1000
      ) {
        pass(`SD1 result returned uid + scheduledPurgeAtMs (~+${SOFT_DELETE_GRACE_DAYS}j)`);
      } else {
        fail('SD1 result mismatch', { result, expectedPurgeMs });
      }

      const userSnap = await getDoc(doc(fbDb, 'users', ALICE));
      const userData = userSnap.data() as UserProfile;
      if (userData.softDeletedAt) {
        pass('SD1 softDeletedAt persisté');
      } else {
        fail('SD1 softDeletedAt missing', userData);
      }
      if (userData.softDeleteScheduledPurgeAt) {
        pass('SD1 softDeleteScheduledPurgeAt persisté');
      } else {
        fail('SD1 softDeleteScheduledPurgeAt missing', userData);
      }
      if (userData.softDeleteReason === 'Test reason SD1') {
        pass('SD1 softDeleteReason persisté');
      } else {
        fail('SD1 softDeleteReason mismatch', userData);
      }
    }

    // ===================================================================
    // SD2 : already soft-deleted → throw 'already-soft-deleted'
    // ===================================================================
    section("SD2 already soft-deleted → throw 'already-soft-deleted' (idempotency)");
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_sd2';
      await setupUser(fbDb, ALICE);
      const now = Date.now();
      await softDeleteUser({ uid: ALICE, now: new Date(now) });
      await expectThrows(
        () => softDeleteUser({ uid: ALICE, now: new Date(now + 60_000) }),
        'already-soft-deleted',
        "SD2 2e softDeleteUser → throw 'already-soft-deleted'",
      );
    }

    // ===================================================================
    // SD3 : restoreSoftDeletedUser dans grace → fields cleared
    // ===================================================================
    section('SD3 restoreSoftDeletedUser dans grace → fields cleared');
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_sd3';
      await setupUser(fbDb, ALICE);
      const now = Date.now();
      await softDeleteUser({ uid: ALICE, reason: 'will restore', now: new Date(now) });

      // Restore 5j later (within grace)
      const restoreAt = now + 5 * 24 * 60 * 60 * 1000;
      await restoreSoftDeletedUser({ uid: ALICE, now: new Date(restoreAt) });

      const userSnap = await getDoc(doc(fbDb, 'users', ALICE));
      const userData = userSnap.data() as UserProfile;
      if (
        userData.softDeletedAt == null &&
        userData.softDeleteScheduledPurgeAt == null &&
        userData.softDeleteReason == null
      ) {
        pass('SD3 soft delete fields cleared (softDeletedAt/scheduledPurgeAt/reason all null)');
      } else {
        fail('SD3 fields not cleared', userData);
      }
    }

    // ===================================================================
    // SD4 : restoreSoftDeletedUser après grace → throw 'grace-expired'
    // ===================================================================
    section("SD4 restoreSoftDeletedUser après grace → throw 'grace-expired'");
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_sd4';
      await setupUser(fbDb, ALICE);
      const now = Date.now();
      await softDeleteUser({ uid: ALICE, now: new Date(now) });

      // Restore 31j later (past grace)
      const restoreAt = now + 31 * 24 * 60 * 60 * 1000;
      await expectThrows(
        () => restoreSoftDeletedUser({ uid: ALICE, now: new Date(restoreAt) }),
        'grace-expired',
        "SD4 restore +31j → throw 'grace-expired'",
      );
    }

    // ===================================================================
    // SD5 : cron purge anonymise PII après grace
    // ===================================================================
    section('SD5 cron purge anonymise PII (displayName/email/photoURL=null + anonymizedAt set)');
    await clearAllUsers(fbDb);
    {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      const { getFirestore, Timestamp: AdminTs } = await import('firebase-admin/firestore');
      if (!getApps().length) {
        initializeApp({ projectId: 'demo-spordate-soft-delete' });
      }
      const adminDb = getFirestore();

      const ALICE = 'user_alice_sd5';
      // Seed user via Admin SDK avec scheduledPurgeAt déjà passé (simulate user soft-deleted >30j ago)
      await adminDb
        .collection('users')
        .doc(ALICE)
        .set({
          uid: ALICE,
          email: 'alice_sd5@test.local',
          displayName: 'Alice SD5',
          photoURL: 'https://photo.example/alice.jpg',
          bio: 'Bio Alice',
          role: 'user',
          softDeletedAt: AdminTs.fromMillis(Date.now() - 31 * 24 * 60 * 60 * 1000),
          softDeleteScheduledPurgeAt: AdminTs.fromMillis(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1j passé
        });

      const res = await callPurgeCron();
      if (res.status === 200) {
        pass('SD5 cron purge HTTP 200');
      } else {
        fail('SD5 cron should be 200', res);
      }
      if ((res.body?.softDeletedAnonymized as number) >= 1) {
        pass('SD5 cron softDeletedAnonymized count ≥ 1');
      } else {
        fail('SD5 cron softDeletedAnonymized should be ≥ 1', res.body);
      }

      // Verify user PII anonymized
      const userSnap = await adminDb.collection('users').doc(ALICE).get();
      const data = userSnap.data();
      if (
        data?.displayName === null &&
        data?.email === null &&
        data?.photoURL === null &&
        data?.anonymizedAt
      ) {
        pass('SD5 PII anonymisé : displayName/email/photoURL=null + anonymizedAt set');
      } else {
        fail('SD5 PII anonymize mismatch', data);
      }
    }

    // ===================================================================
    // Bonus : user déjà anonymisé → skip soft delete (idempotency)
    // ===================================================================
    section("Bonus user déjà anonymisé (cron banlist 24mo) → throw 'already-anonymized'");
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_already_anon';
      await setupUser(fbDb, ALICE, { anonymizedAt: Timestamp.now() });
      await expectThrows(
        () => softDeleteUser({ uid: ALICE }),
        'already-anonymized',
        "Bonus already anonymized → throw 'already-anonymized'",
      );
    }

    // ===================================================================
    // Bonus : reason > 500 chars → throw 'invalid-input'
    // ===================================================================
    section("Bonus reason > 500 chars → throw 'invalid-input'");
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_long_reason';
      await setupUser(fbDb, ALICE);
      const tooLong = 'a'.repeat(SOFT_DELETE_REASON_MAX_LENGTH + 1);
      await expectThrows(
        () => softDeleteUser({ uid: ALICE, reason: tooLong }),
        'invalid-input',
        `Bonus reason ${SOFT_DELETE_REASON_MAX_LENGTH + 1} chars → throw 'invalid-input'`,
      );
      // Boundary 500 chars exact → OK
      const boundary = 'b'.repeat(SOFT_DELETE_REASON_MAX_LENGTH);
      try {
        const r = await softDeleteUser({ uid: ALICE, reason: boundary });
        if (r.uid === ALICE) {
          pass(`Bonus reason exactly ${SOFT_DELETE_REASON_MAX_LENGTH} chars → success (inclusive)`);
        } else {
          fail('Bonus boundary should succeed', r);
        }
      } catch (err) {
        fail('Bonus boundary should not throw', err);
      }
    }

    // ===================================================================
    // Bonus : boundary grace 30j exact → still restorable (inclusive)
    // ===================================================================
    section('Bonus boundary grace 30j exact → still restorable (inclusive)');
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_boundary_grace';
      await setupUser(fbDb, ALICE);
      const now = Date.now();
      await softDeleteUser({ uid: ALICE, now: new Date(now) });
      // Restore exactly 30j later (inclusive)
      const exactlyAt = now + SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      try {
        await restoreSoftDeletedUser({ uid: ALICE, now: new Date(exactlyAt) });
        pass('Bonus exact 30j boundary → restore succeeds (inclusive)');
      } catch (err) {
        fail('Bonus boundary 30j should succeed', err);
      }
      // 1ms past → throw
      await setupUser(fbDb, ALICE); // re-setup
      await softDeleteUser({ uid: ALICE, now: new Date(now) });
      await expectThrows(
        () =>
          restoreSoftDeletedUser({
            uid: ALICE,
            now: new Date(exactlyAt + 1),
          }),
        'grace-expired',
        "Bonus +1ms past 30j → throw 'grace-expired'",
      );
    }

    // ===================================================================
    // Bonus : isSoftDeleted + softDeleteGraceDaysRemaining helpers
    // ===================================================================
    section('Bonus isSoftDeleted + softDeleteGraceDaysRemaining helpers');
    await clearAllUsers(fbDb);
    {
      const ALICE = 'user_alice_helpers';
      await setupUser(fbDb, ALICE);
      const now = Date.now();
      await softDeleteUser({ uid: ALICE, now: new Date(now) });

      const userSnap = await getDoc(doc(fbDb, 'users', ALICE));
      const user = userSnap.data() as UserProfile;
      if (isSoftDeleted(user, new Date(now)) === true) {
        pass('Bonus isSoftDeleted=true juste après softDelete');
      } else {
        fail('Bonus isSoftDeleted should be true', user);
      }
      const days = softDeleteGraceDaysRemaining(user, new Date(now));
      if (days === SOFT_DELETE_GRACE_DAYS) {
        pass(`Bonus softDeleteGraceDaysRemaining = ${SOFT_DELETE_GRACE_DAYS} (juste après softDelete)`);
      } else {
        fail(`Bonus days remaining should be ${SOFT_DELETE_GRACE_DAYS}`, { days });
      }

      // 5j later → 25j remaining
      const days5 = softDeleteGraceDaysRemaining(user, new Date(now + 5 * 24 * 60 * 60 * 1000));
      if (days5 === SOFT_DELETE_GRACE_DAYS - 5) {
        pass(`Bonus +5j → ${days5} jours restants`);
      } else {
        fail('Bonus +5j calculation', { days5 });
      }

      // After grace → 0
      const daysExpired = softDeleteGraceDaysRemaining(
        user,
        new Date(now + (SOFT_DELETE_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000),
      );
      if (daysExpired === 0) {
        pass('Bonus past grace → 0 jours restants');
      } else {
        fail('Bonus past grace should be 0', { daysExpired });
      }
    }
  });

  // ===================================================================
  // Bonus rules : Bob set softDeletedAt sur Alice → DENIED
  // ===================================================================
  section('Bonus rules anti-spoof : Bob set softDeletedAt sur Alice → DENIED');
  {
    const ALICE = 'user_alice_rules';
    const BOB = 'user_bob_rules';

    // Setup users via rules-disabled
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fbDb = asFirestore(ctx.firestore());
      await setupUser(fbDb, ALICE);
      await setupUser(fbDb, BOB);
    });

    // Bob authenticated tries to update Alice's user doc
    const bobCtx = env.authenticatedContext(BOB);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bobDb: Firestore = asFirestore((bobCtx as any).firestore());
    let denied = false;
    try {
      await setDoc(
        doc(bobDb, 'users', ALICE),
        {
          softDeletedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code;
      if (code === 'permission-denied' || code === 'firestore/permission-denied') {
        denied = true;
      }
    }
    if (denied) {
      pass('Bonus rules : Bob spoof Alice softDeletedAt → DENIED');
    } else {
      fail('Bonus rules should deny Bob spoof');
    }
  }

  __setSoftDeleteDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Soft Delete (SD1-SD5 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);

  if (_failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
