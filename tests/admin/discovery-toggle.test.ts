/**
 * Tests Phase 9.5 c8 BUG 1 — POST /api/admin/site/discovery-toggle.
 *
 * Exécution :
 *   npm run test:admin:discovery-toggle
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC4 invites api.test.ts).
 *
 * Couverture (5 cas DT1-DT5) :
 *   DT1. Admin authentifié + body { enabled:true } → 200 + settings/features.discoveryEnabled=true
 *   DT2. Audit log adminActions {actionType:'toggle_discovery', metadata.enabled} créé
 *   DT3. Cache invalidate → next read renvoie la nouvelle valeur (vérifié via second call)
 *   DT4. Non-admin user → 403 forbidden
 *   DT5. Body manquant ou enabled non-boolean → 400 invalid-input
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-dt';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-dt';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

import { POST as POSTToggle } from '../../src/app/api/admin/site/discovery-toggle/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { invalidateFeatureFlagsCache, getFeatureFlagsAdmin } from '../../src/lib/site/featureFlags';

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
    initializeApp({ projectId: 'demo-spordate-dt' });
  }
  const db = getFirestore();

  const ADMIN_UID = 'user_admin_dt';
  const REGULAR_UID = 'user_regular_dt';

  async function seedUser(uid: string, role: 'admin' | 'user') {
    await db.collection('users').doc(uid).set({
      userId: uid,
      email: `${uid}@test.local`,
      displayName: uid,
      role,
      credits: 0,
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
  // DT1 + DT2 + DT3 happy path
  // ===================================================================
  section('DT1+DT2+DT3 admin toggle ON → 200 + settings/features + audit log + cache invalidate');
  {
    await clearAll();
    await seedUser(ADMIN_UID, 'admin');
    _mockUid = ADMIN_UID;

    const res = await callPost({ enabled: true }, 'mock_admin');
    if (res.status === 200 && res.body.ok === true && res.body.enabled === true) {
      pass('DT1 status 200 + ok + enabled=true');
    } else {
      fail('DT1', res);
    }

    const featuresSnap = await db.collection('settings').doc('features').get();
    if (featuresSnap.exists && featuresSnap.data()?.discoveryEnabled === true) {
      pass('DT1.b settings/features.discoveryEnabled=true persisté');
    } else {
      fail('DT1.b features doc missing', featuresSnap.data());
    }

    const auditSnap = await db
      .collection('adminActions')
      .where('actionType', '==', 'toggle_discovery')
      .get();
    if (auditSnap.size === 1) {
      const a = auditSnap.docs[0].data();
      // Phase 9.5 c21 — targetId changé pour 'features.discoveryMode'.
      // metadata contient maintenant {mode, enabled} (backward compat boolean preserved).
      if (
        a.adminId === ADMIN_UID &&
        a.targetType === 'site_setting' &&
        a.targetId === 'features.discoveryMode' &&
        a.metadata?.enabled === true &&
        a.metadata?.mode === 'open-to-all'
      ) {
        pass('DT2 adminActions audit log {actionType:toggle_discovery, metadata.{mode:open-to-all, enabled:true}}');
      } else {
        fail('DT2 audit shape', a);
      }
    } else {
      fail('DT2 audit count', auditSnap.size);
    }

    // DT3 cache invalidate → second read returns new value
    const flags = await getFeatureFlagsAdmin(db);
    if (flags.discoveryEnabled === true) {
      pass('DT3 cache invalidate after toggle → fresh read renvoie discoveryEnabled=true');
    } else {
      fail('DT3 stale cache', flags);
    }
  }

  // ===================================================================
  // DT4 non-admin forbidden
  // ===================================================================
  section('DT4 non-admin user → 403 forbidden');
  {
    await clearAll();
    await seedUser(REGULAR_UID, 'user');
    _mockUid = REGULAR_UID;

    const res = await callPost({ enabled: true }, 'mock_regular');
    if (res.status === 403 && res.body.error === 'forbidden') {
      pass('DT4 non-admin → 403 forbidden');
    } else {
      fail('DT4', res);
    }

    // Verify NO audit log + NO settings change
    const auditSnap = await db.collection('adminActions').get();
    if (auditSnap.empty) {
      pass('DT4.b non-admin → aucun audit log créé');
    } else {
      fail('DT4.b audit orphan', auditSnap.size);
    }
  }

  // ===================================================================
  // DT5 invalid body
  // ===================================================================
  section('DT5 body invalid → 400 invalid-input');
  {
    await clearAll();
    await seedUser(ADMIN_UID, 'admin');
    _mockUid = ADMIN_UID;

    const r1 = await callPost({}, 'mock_admin');
    if (r1.status === 400 && r1.body.error === 'invalid-input') {
      pass('DT5.a body vide → 400');
    } else {
      fail('DT5.a', r1);
    }
    const r2 = await callPost({ enabled: 'yes' }, 'mock_admin');
    if (r2.status === 400 && r2.body.error === 'invalid-input') {
      pass('DT5.b enabled non-boolean → 400');
    } else {
      fail('DT5.b', r2);
    }
  }

  // Cleanup
  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Discovery Toggle (DT1-DT5) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
