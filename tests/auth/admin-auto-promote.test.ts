/**
 * Tests Phase 9.5 c9 — POST /api/auth/admin-self-promote.
 *
 * Exécution :
 *   npm run test:auth:admin-auto-promote
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC4 invites api.test.ts).
 *
 * Couverture (5 cas AAP1-AAP6) :
 *   AAP1. isAdminEmail() pure helper : case-insensitive + trim()
 *   AAP2. Login email admin + role !=='admin' → 200 promoted + role='admin' Firestore
 *   AAP3. Idempotent : 2ème call → 200 alreadyAdmin (pas de double audit log)
 *   AAP4. Login email NOT admin → 403 not-eligible (no role change, no audit)
 *   AAP5. Audit log adminActions {actionType:'auto_promote_admin', metadata.email, source}
 *   AAP6. User Firestore not found → 404
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-aap';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-aap';

import { POST as POSTPromote } from '../../src/app/api/auth/admin-self-promote/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { isAdminEmail, ADMIN_EMAILS } from '../../src/lib/sports';

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

async function callPost(authBearer?: string): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = `Bearer ${authBearer}`;
  const req = new Request('http://localhost/api/auth/admin-self-promote', {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTPromote(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  // ===================================================================
  // AAP1 — isAdminEmail pure helper (no emulator)
  // ===================================================================
  section('AAP1 isAdminEmail() — case-insensitive + trim() defensif');
  {
    const adminEmail = ADMIN_EMAILS[0];
    if (isAdminEmail(adminEmail) === true) {
      pass('AAP1.a exact match → true');
    } else {
      fail('AAP1.a', adminEmail);
    }
    if (isAdminEmail(adminEmail.toUpperCase()) === true) {
      pass('AAP1.b uppercase variant → true (case-insensitive)');
    } else {
      fail('AAP1.b');
    }
    if (isAdminEmail(`  ${adminEmail}  `) === true) {
      pass('AAP1.c email avec spaces leading/trailing → true (trim)');
    } else {
      fail('AAP1.c');
    }
    if (isAdminEmail('random@user.com') === false) {
      pass('AAP1.d random email → false');
    } else {
      fail('AAP1.d');
    }
    if (isAdminEmail(null) === false) {
      pass('AAP1.e null → false (defensive)');
    } else {
      fail('AAP1.e');
    }
    if (isAdminEmail(undefined) === false) {
      pass('AAP1.f undefined → false (defensive)');
    } else {
      fail('AAP1.f');
    }
    if (isAdminEmail('') === false) {
      pass('AAP1.g empty string → false');
    } else {
      fail('AAP1.g');
    }
  }

  // ===================================================================
  // AAP2-AAP6 emulator integration
  // ===================================================================
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-aap' });
  }
  const db = getFirestore();

  const ADMIN_UID = 'user_admin_aap';
  const REGULAR_UID = 'user_regular_aap';
  const ADMIN_EMAIL = ADMIN_EMAILS[0];

  async function seedUser(uid: string, email: string, role: string) {
    await db.collection('users').doc(uid).set({
      userId: uid,
      uid,
      email,
      displayName: uid,
      role,
      credits: 0,
    });
  }

  async function clearAll() {
    for (const col of ['users', 'adminActions']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // AAP2 happy promote
  // ===================================================================
  section('AAP2 admin email + role=user → 200 promoted + Firestore role=admin');
  {
    await clearAll();
    await seedUser(ADMIN_UID, ADMIN_EMAIL, 'user');
    _mockUid = ADMIN_UID;

    const res = await callPost('mock_admin_token');
    if (
      res.status === 200 &&
      res.body.ok === true &&
      res.body.alreadyAdmin === false &&
      res.body.role === 'admin'
    ) {
      pass('AAP2 status 200 + ok + role=admin returned');
    } else {
      fail('AAP2', res);
    }

    const userSnap = await db.collection('users').doc(ADMIN_UID).get();
    if (userSnap.data()?.role === 'admin') {
      pass('AAP2.b Firestore users.role=admin persisté');
    } else {
      fail('AAP2.b', userSnap.data());
    }
  }

  // ===================================================================
  // AAP3 idempotent
  // ===================================================================
  section('AAP3 idempotent : 2ème call → alreadyAdmin sans double audit');
  {
    // (continuing from AAP2 state — user is now admin)
    _mockUid = ADMIN_UID;
    const res = await callPost('mock_admin_token');
    if (res.status === 200 && res.body.alreadyAdmin === true) {
      pass('AAP3 alreadyAdmin → 200 + flag set (idempotent)');
    } else {
      fail('AAP3', res);
    }

    const auditSnap = await db
      .collection('adminActions')
      .where('actionType', '==', 'auto_promote_admin')
      .get();
    if (auditSnap.size === 1) {
      pass('AAP3.b audit log = 1 entry seulement (no double log)');
    } else {
      fail('AAP3.b duplicates', auditSnap.size);
    }
  }

  // ===================================================================
  // AAP4 not eligible
  // ===================================================================
  section('AAP4 email not in ADMIN_EMAILS → 403 not-eligible');
  {
    await clearAll();
    await seedUser(REGULAR_UID, 'random@user.com', 'user');
    _mockUid = REGULAR_UID;

    const res = await callPost('mock_random');
    if (res.status === 403 && res.body.error === 'not-eligible') {
      pass('AAP4 random email → 403 not-eligible');
    } else {
      fail('AAP4', res);
    }

    const userSnap = await db.collection('users').doc(REGULAR_UID).get();
    if (userSnap.data()?.role === 'user') {
      pass('AAP4.b role unchanged (still "user")');
    } else {
      fail('AAP4.b', userSnap.data());
    }

    const auditSnap = await db
      .collection('adminActions')
      .where('targetId', '==', REGULAR_UID)
      .get();
    if (auditSnap.empty) {
      pass('AAP4.c no audit log (rejected before write)');
    } else {
      fail('AAP4.c audit orphan', auditSnap.size);
    }
  }

  // ===================================================================
  // AAP5 audit log shape
  // ===================================================================
  section('AAP5 audit log shape — actionType auto_promote_admin + metadata.email + source');
  {
    await clearAll();
    await seedUser(ADMIN_UID, ADMIN_EMAIL, 'user');
    _mockUid = ADMIN_UID;
    await callPost('mock_admin');

    const auditSnap = await db
      .collection('adminActions')
      .where('actionType', '==', 'auto_promote_admin')
      .get();
    if (auditSnap.size !== 1) {
      fail('AAP5 audit count', auditSnap.size);
    } else {
      const a = auditSnap.docs[0].data();
      if (
        a.adminId === 'system' &&
        a.targetType === 'user' &&
        a.targetId === ADMIN_UID &&
        a.metadata?.email === ADMIN_EMAIL &&
        a.metadata?.source === 'login' &&
        a.metadata?.previousRole === 'user'
      ) {
        pass('AAP5 audit shape correct (adminId=system, metadata.email + source + previousRole)');
      } else {
        fail('AAP5 audit shape', a);
      }
    }
  }

  // ===================================================================
  // AAP6 user Firestore missing → 404
  // ===================================================================
  section('AAP6 verifyAuth ok mais user doc absent → 404');
  {
    await clearAll();
    _mockUid = 'user_orphan_aap';
    const res = await callPost('mock_orphan');
    if (res.status === 404 && res.body.error === 'user-not-found') {
      pass('AAP6 → 404 user-not-found');
    } else {
      fail('AAP6', res);
    }
  }

  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Admin Auto-Promote (AAP1-AAP6) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
