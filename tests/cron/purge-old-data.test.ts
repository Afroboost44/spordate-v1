/**
 * Tests Phase 8 sub-chantier 5 commit 3/5 — POST /api/cron/purge-old-data.
 *
 * Exécution :
 *   npm run test:cron:purge
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/cron/purge-old-data.test.ts")
 *
 * Pattern : Admin SDK direct (cohérent SC5 c1-c2 cron + admin tests).
 *
 * Couverture (PG1-PG6) :
 *   PG1 adminAction createdAt -25mo → delete
 *   PG2 adminAction createdAt -23mo → preserve
 *   PG3 user banned + sanction -25mo → anonymize (PII null + anonymizedAt set)
 *   PG4 user banned + sanction -10mo → preserve (pas encore 24mo)
 *   PG5 idempotency : user déjà anonymizedAt set → skip (no double-write)
 *   PG6 dry-run mode : retourne counts mais pas d'écriture
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-cron-purge';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-cron-purge';
process.env.CRON_SECRET = 'test-cron-secret-purge';

import { POST as POSTPurge } from '../../src/app/api/cron/purge-old-data/route';

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

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callPurge(query = ''): Promise<MockResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-cron-secret-purge',
  };
  const req = new Request(`http://localhost/api/cron/purge-old-data${query}`, {
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
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-cron-purge' });
  }
  const db = getFirestore();

  const NOW = Date.now();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MS_PER_MONTH = 30 * MS_PER_DAY;

  // Seeders
  async function seedAdminAction(actionId: string, createdAtMs: number): Promise<void> {
    await db
      .collection('adminActions')
      .doc(actionId)
      .set({
        actionId,
        adminId: 'admin_test',
        actionType: 'review_publish',
        targetType: 'review',
        targetId: 'review_x',
        createdAt: Timestamp.fromMillis(createdAtMs),
      });
  }

  async function seedBannedUser(opts: {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    sanctionId: string;
    sanctionCreatedAtMs: number;
    anonymizedAt?: number;
  }): Promise<void> {
    // Seed sanction
    await db
      .collection('userSanctions')
      .doc(opts.sanctionId)
      .set({
        sanctionId: opts.sanctionId,
        userId: opts.uid,
        level: 'ban_permanent',
        reason: 'no_show_threshold',
        triggeringReportIds: ['rep_x'],
        startsAt: Timestamp.fromMillis(opts.sanctionCreatedAtMs),
        appealable: true,
        appealUsed: false,
        isActive: true,
        createdAt: Timestamp.fromMillis(opts.sanctionCreatedAtMs),
      });
    // Seed user with denorm
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userPayload: any = {
      uid: opts.uid,
      email: opts.email,
      displayName: opts.displayName,
      photoURL: opts.photoURL ?? 'https://example.com/avatar.png',
      phoneNumber: '+41791234567',
      activeSanctionId: opts.sanctionId,
      activeSanctionLevel: 'ban_permanent',
      role: 'user',
    };
    if (opts.anonymizedAt) {
      userPayload.anonymizedAt = Timestamp.fromMillis(opts.anonymizedAt);
    }
    await db.collection('users').doc(opts.uid).set(userPayload);
  }

  async function clearAll(): Promise<void> {
    for (const col of ['adminActions', 'users', 'userSanctions']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  // ===================================================================
  // PG1 + PG2 : adminActions purge / preserve
  // ===================================================================
  section('PG1+PG2 adminActions: -25mo delete / -23mo preserve');
  {
    await clearAll();
    await seedAdminAction('aa_old', NOW - 25 * MS_PER_MONTH);
    await seedAdminAction('aa_recent', NOW - 23 * MS_PER_MONTH);

    const res = await callPurge();
    if (res.status === 200) {
      pass('PG1 cron 200');
    } else {
      fail('PG1 status', res);
    }
    if (res.body.adminActionsDeleted === 1) {
      pass('PG1 adminActionsDeleted=1');
    } else {
      fail('PG1 adminActionsDeleted', res.body);
    }

    const oldExists = (await db.collection('adminActions').doc('aa_old').get()).exists;
    const recentExists = (await db.collection('adminActions').doc('aa_recent').get()).exists;
    if (oldExists === false) {
      pass('PG1 aa_old deleted');
    } else {
      fail('PG1 aa_old should be deleted');
    }
    if (recentExists === true) {
      pass('PG2 aa_recent preserved (not deleted)');
    } else {
      fail('PG2 aa_recent should still exist');
    }
  }

  // ===================================================================
  // PG3 + PG4 : banlist anonymize / preserve
  // ===================================================================
  section('PG3+PG4 banlist: -25mo anonymize / -10mo preserve');
  {
    await clearAll();
    await seedBannedUser({
      uid: 'user_pg3_old',
      email: 'old@test.local',
      displayName: 'Old Banned User',
      sanctionId: 'sanction_pg3_old',
      sanctionCreatedAtMs: NOW - 25 * MS_PER_MONTH,
    });
    await seedBannedUser({
      uid: 'user_pg4_recent',
      email: 'recent@test.local',
      displayName: 'Recent Banned User',
      sanctionId: 'sanction_pg4_recent',
      sanctionCreatedAtMs: NOW - 10 * MS_PER_MONTH,
    });

    const res = await callPurge();
    if (res.status === 200 && res.body.usersAnonymized === 1) {
      pass('PG3 usersAnonymized=1');
    } else {
      fail('PG3 usersAnonymized', res.body);
    }

    const oldUser = (await db.collection('users').doc('user_pg3_old').get()).data();
    if (oldUser?.displayName === null && oldUser?.email === null) {
      pass('PG3 PII nullified (displayName + email)');
    } else {
      fail('PG3 PII not nullified', oldUser);
    }
    if (oldUser?.photoURL === null && oldUser?.phoneNumber === null) {
      pass('PG3 PII nullified (photoURL + phoneNumber)');
    } else {
      fail('PG3 PII other fields not nullified', oldUser);
    }
    if (oldUser?.anonymizedAt) {
      pass('PG3 anonymizedAt set');
    } else {
      fail('PG3 anonymizedAt missing', oldUser);
    }

    const recentUser = (await db.collection('users').doc('user_pg4_recent').get()).data();
    if (recentUser?.displayName === 'Recent Banned User' && !recentUser?.anonymizedAt) {
      pass('PG4 user -10mo preserved (PII intact, anonymizedAt absent)');
    } else {
      fail('PG4 user wrongly anonymized', recentUser);
    }
  }

  // ===================================================================
  // PG5 idempotency : déjà anonymisé → skip
  // ===================================================================
  section('PG5 idempotency : user déjà anonymizedAt set → skip');
  {
    await clearAll();
    await seedBannedUser({
      uid: 'user_pg5_already',
      email: 'already@test.local',
      displayName: 'Already Anonymized',
      sanctionId: 'sanction_pg5',
      sanctionCreatedAtMs: NOW - 30 * MS_PER_MONTH,
      anonymizedAt: NOW - 5 * MS_PER_MONTH, // already anonymized 5 months ago
    });

    const before = (await db.collection('users').doc('user_pg5_already').get()).data();
    const beforeAnonymizedAtMs = before?.anonymizedAt?.toMillis?.() ?? 0;

    const res = await callPurge();
    if (res.status === 200 && res.body.usersAnonymized === 0) {
      pass('PG5 usersAnonymized=0 (already done)');
    } else {
      fail('PG5 should skip', res.body);
    }

    const after = (await db.collection('users').doc('user_pg5_already').get()).data();
    const afterAnonymizedAtMs = after?.anonymizedAt?.toMillis?.() ?? 0;
    if (beforeAnonymizedAtMs === afterAnonymizedAtMs) {
      pass('PG5 anonymizedAt unchanged (no double-write)');
    } else {
      fail('PG5 anonymizedAt was overwritten', { before: beforeAnonymizedAtMs, after: afterAnonymizedAtMs });
    }
  }

  // ===================================================================
  // PG6 dry-run mode
  // ===================================================================
  section('PG6 dry-run : counts retournés mais pas écriture');
  {
    await clearAll();
    await seedAdminAction('aa_dry_old', NOW - 25 * MS_PER_MONTH);
    await seedBannedUser({
      uid: 'user_pg6_dry',
      email: 'dry@test.local',
      displayName: 'Dry Run User',
      sanctionId: 'sanction_pg6',
      sanctionCreatedAtMs: NOW - 30 * MS_PER_MONTH,
    });

    const res = await callPurge('?dryRun=true');
    if (res.status === 200 && res.body.dryRun === true) {
      pass('PG6 dryRun=true reflected in response');
    } else {
      fail('PG6 dryRun flag', res.body);
    }
    if (res.body.adminActionsDeleted === 1 && res.body.usersAnonymized === 1) {
      pass('PG6 counts reported (1+1) sans écrire');
    } else {
      fail('PG6 counts', res.body);
    }

    // Verify NO writes happened
    const aaExists = (await db.collection('adminActions').doc('aa_dry_old').get()).exists;
    if (aaExists === true) {
      pass('PG6 adminAction NOT deleted (dry-run preserved)');
    } else {
      fail('PG6 adminAction was deleted in dry-run');
    }
    const userData = (await db.collection('users').doc('user_pg6_dry').get()).data();
    if (userData?.displayName === 'Dry Run User' && !userData?.anonymizedAt) {
      pass('PG6 user PII NOT nullified (dry-run preserved)');
    } else {
      fail('PG6 user was anonymized in dry-run', userData);
    }
  }

  // ===================================================================
  // Auth check (sanity)
  // ===================================================================
  section('Auth — Bearer mauvais → 401');
  {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      authorization: 'Bearer wrong-secret',
    };
    const req = new Request('http://localhost/api/cron/purge-old-data', {
      method: 'POST',
      headers,
      body: '{}',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    const res = await POSTPurge(req);
    if (res.status === 401) {
      pass('Bearer mauvais → 401');
    } else {
      fail('auth check', { status: res.status });
    }
  }

  // Cleanup
  await clearAll();

  console.log('');
  console.log('====== Résumé Cron purge-old-data (PG1-PG6 + auth) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
