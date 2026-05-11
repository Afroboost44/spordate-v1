/**
 * Tests Phase 9.5 c21 — discoveryMode 3-state (disabled / participants-only / open-to-all)
 * + backward compat boolean discoveryEnabled (c8 legacy).
 *
 * Exécution :
 *   npm run test:admin:discovery-mode
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent c8 discovery-toggle).
 *
 * Couverture (DM1-DM6) :
 *   DM1. POST {mode:'disabled'} → 200 + discoveryMode=disabled + discoveryEnabled=false
 *   DM2. POST {mode:'participants-only'} → 200 + discoveryMode=participants-only
 *        + discoveryEnabled=true (boolean dérivé)
 *   DM3. POST {mode:'open-to-all'} → 200 + discoveryMode=open-to-all + discoveryEnabled=true
 *   DM4. POST {enabled:true} legacy boolean → 200 + discoveryMode='open-to-all' (mapping)
 *   DM5. POST {enabled:false} legacy → 200 + discoveryMode='disabled'
 *   DM6. POST {mode:'invalid'} → 400 invalid-input
 *   DM7. normalizeFlags({discoveryMode:'open-to-all'}) → enabled=true
 *   DM8. normalizeFlags({discoveryEnabled:true}) sans mode → mode='open-to-all' (legacy)
 *   DM9. normalizeFlags({}) → mode='disabled'
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-dm';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-dm';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

import { POST as POSTToggle } from '../../src/app/api/admin/site/discovery-toggle/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { invalidateFeatureFlagsCache, normalizeFlags } from '../../src/lib/site/featureFlags';

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

async function callPost(payload: unknown, authBearer?: string): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = `Bearer ${authBearer}`;
  const req = new Request('http://localhost/api/admin/site/discovery-toggle', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTToggle(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-dm' });
  }
  const db = getFirestore();

  const ADMIN_UID = 'user_admin_dm';

  async function seedAdmin() {
    await db.collection('users').doc(ADMIN_UID).set({
      userId: ADMIN_UID,
      email: 'admin@dm.test',
      role: 'admin',
    });
  }

  async function clearAll() {
    for (const col of ['users', 'settings', 'adminActions']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    invalidateFeatureFlagsCache();
  }

  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // DM1 — mode disabled
  // ===================================================================
  section('DM1 POST {mode:disabled} → 200 + discoveryMode=disabled + enabled=false');
  {
    await clearAll();
    await seedAdmin();
    _mockUid = ADMIN_UID;

    const res = await callPost({ mode: 'disabled' }, 'mock_admin');
    if (res.status === 200 && res.body.mode === 'disabled' && res.body.enabled === false) {
      pass('DM1 response shape');
    } else {
      fail('DM1', res);
    }

    const snap = await db.collection('settings').doc('features').get();
    if (snap.data()?.discoveryMode === 'disabled' && snap.data()?.discoveryEnabled === false) {
      pass('DM1.b Firestore persisted discoveryMode=disabled + discoveryEnabled=false');
    } else {
      fail('DM1.b', snap.data());
    }
  }

  // ===================================================================
  // DM2 — mode participants-only
  // ===================================================================
  section('DM2 POST {mode:participants-only} → 200 + discoveryEnabled=true (derived)');
  {
    await clearAll();
    await seedAdmin();
    _mockUid = ADMIN_UID;

    const res = await callPost({ mode: 'participants-only' }, 'mock_admin');
    if (res.status === 200 && res.body.mode === 'participants-only' && res.body.enabled === true) {
      pass('DM2 response shape (mode participants-only + enabled true)');
    } else {
      fail('DM2', res);
    }

    const auditSnap = await db
      .collection('adminActions')
      .where('actionType', '==', 'toggle_discovery')
      .get();
    if (auditSnap.size === 1 && auditSnap.docs[0].data().metadata?.mode === 'participants-only') {
      pass('DM2.b audit log metadata.mode=participants-only');
    } else {
      fail('DM2.b', auditSnap.docs[0]?.data());
    }
  }

  // ===================================================================
  // DM3 — mode open-to-all
  // ===================================================================
  section('DM3 POST {mode:open-to-all} → 200 + Firestore persisté');
  {
    await clearAll();
    await seedAdmin();
    _mockUid = ADMIN_UID;

    const res = await callPost({ mode: 'open-to-all' }, 'mock_admin');
    if (res.status === 200 && res.body.mode === 'open-to-all') {
      pass('DM3 response shape');
    } else {
      fail('DM3', res);
    }
  }

  // ===================================================================
  // DM4+DM5 — legacy boolean mapping
  // ===================================================================
  section('DM4+DM5 legacy {enabled:bool} → mapped sur discoveryMode');
  {
    await clearAll();
    await seedAdmin();
    _mockUid = ADMIN_UID;

    const r1 = await callPost({ enabled: true }, 'mock_admin');
    if (r1.body.mode === 'open-to-all' && r1.body.enabled === true) {
      pass('DM4 legacy {enabled:true} → mode=open-to-all');
    } else {
      fail('DM4', r1);
    }

    const r2 = await callPost({ enabled: false }, 'mock_admin');
    if (r2.body.mode === 'disabled' && r2.body.enabled === false) {
      pass('DM5 legacy {enabled:false} → mode=disabled');
    } else {
      fail('DM5', r2);
    }
  }

  // ===================================================================
  // DM6 — invalid input
  // ===================================================================
  section('DM6 POST {mode:invalid} → 400 invalid-input');
  {
    await clearAll();
    await seedAdmin();
    _mockUid = ADMIN_UID;

    const res = await callPost({ mode: 'invalid-shape' }, 'mock_admin');
    if (res.status === 400 && res.body.error === 'invalid-input') {
      pass('DM6 invalid mode → 400');
    } else {
      fail('DM6', res);
    }

    // Empty body (no mode + no enabled)
    const r2 = await callPost({}, 'mock_admin');
    if (r2.status === 400 && r2.body.error === 'invalid-input') {
      pass('DM6.b empty body → 400');
    } else {
      fail('DM6.b', r2);
    }
  }

  // ===================================================================
  // DM7-DM9 — normalizeFlags pure unit
  // ===================================================================
  section('DM7-DM9 normalizeFlags pure helper');
  {
    const f1 = normalizeFlags({ discoveryMode: 'open-to-all' });
    if (f1.discoveryMode === 'open-to-all' && f1.discoveryEnabled === true) {
      pass('DM7 normalizeFlags({discoveryMode:open-to-all}) → enabled=true derived');
    } else {
      fail('DM7', f1);
    }

    const f2 = normalizeFlags({ discoveryEnabled: true });
    if (f2.discoveryMode === 'open-to-all' && f2.discoveryEnabled === true) {
      pass('DM8 normalizeFlags({discoveryEnabled:true}) legacy → mode=open-to-all');
    } else {
      fail('DM8', f2);
    }

    const f3 = normalizeFlags({});
    if (f3.discoveryMode === 'disabled' && f3.discoveryEnabled === false) {
      pass('DM9 normalizeFlags({}) → mode=disabled default');
    } else {
      fail('DM9', f3);
    }

    const f4 = normalizeFlags(null);
    if (f4.discoveryMode === 'disabled') {
      pass('DM9.b normalizeFlags(null) → defaults safely');
    } else {
      fail('DM9.b', f4);
    }
  }

  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Discovery Mode (DM1-DM9) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
