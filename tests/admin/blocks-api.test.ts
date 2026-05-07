/**
 * Tests Phase 8 sub-chantier 5 commit 1/5 — GET /api/admin/blocks.
 *
 * Exécution :
 *   npm run test:admin:blocks
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/admin/blocks-api.test.ts")
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC4 invites/api.test.ts).
 *
 * Couverture (BLK-API1-BLK-API4) :
 *   BLK-API1 GET sans Bearer → 401 unauthenticated
 *   BLK-API2 GET avec uid non-admin → 403 forbidden
 *   BLK-API3 GET avec uid admin → 200 { blocks: [...], count: N }
 *   BLK-API4 GET ?limit=invalid → 400 invalid-limit
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-admin-blocks';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-admin-blocks';

import { GET as GETBlocks } from '../../src/app/api/admin/blocks/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';

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

// =====================================================================
// Helpers
// =====================================================================

const ADMIN_UID = 'admin_blocks_test';
const USER_UID = 'user_blocks_test';

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callGet(query?: string): Promise<MockResponse> {
  const url = `http://localhost/api/admin/blocks${query ?? ''}`;
  const req = new Request(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await GETBlocks(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-admin-blocks' });
  }
  const db = getFirestore();

  // Seed users : 1 admin + 1 standard user
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID,
    email: 'admin@test.local',
    displayName: 'Admin Test',
    role: 'admin',
  });
  await db.collection('users').doc(USER_UID).set({
    uid: USER_UID,
    email: 'user@test.local',
    displayName: 'User Test',
    role: 'user',
  });

  // Seed 3 blocks
  for (let i = 0; i < 3; i++) {
    const blockerId = `blocker_${i}`;
    const blockedId = `blocked_${i}`;
    const docId = `${blockerId}_${blockedId}`;
    await db.collection('blocks').doc(docId).set({
      blockId: docId,
      blockerId,
      blockedId,
      createdAt: Timestamp.fromMillis(Date.now() - i * 60_000),
    });
  }

  // Default mock auth — overridden per test
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // BLK-API1 no auth → 401
  // ===================================================================
  section('BLK-API1 GET sans Bearer (mock returns null) → 401');
  {
    _mockUid = null;
    const res = await callGet();
    if (res.status === 401 && res.body.error === 'unauthenticated') {
      pass('BLK-API1 no auth → 401 unauthenticated');
    } else {
      fail('BLK-API1', res);
    }
  }

  // ===================================================================
  // BLK-API2 non-admin → 403
  // ===================================================================
  section('BLK-API2 GET avec uid non-admin → 403');
  {
    _mockUid = USER_UID;
    const res = await callGet();
    if (res.status === 403 && res.body.error === 'forbidden') {
      pass('BLK-API2 non-admin → 403 forbidden');
    } else {
      fail('BLK-API2', res);
    }
  }

  // ===================================================================
  // BLK-API3 admin → 200 blocks list
  // ===================================================================
  section('BLK-API3 GET avec uid admin → 200 + blocks list');
  {
    _mockUid = ADMIN_UID;
    const res = await callGet();
    if (res.status === 200 && Array.isArray(res.body.blocks)) {
      pass('BLK-API3 admin → 200 + blocks array returned');
    } else {
      fail('BLK-API3 unexpected response', res);
    }
    const blocks = res.body.blocks as Array<{ blockId: string }>;
    if (blocks.length === 3) {
      pass('BLK-API3 3 blocks retournés');
    } else {
      fail(`BLK-API3 attendu 3 blocks, reçu ${blocks.length}`);
    }
    if (res.body.count === 3) {
      pass('BLK-API3 count=3 cohérent avec blocks.length');
    } else {
      fail('BLK-API3 count mismatch', res.body.count);
    }
  }

  // ===================================================================
  // BLK-API4 limit param invalide → 400
  // ===================================================================
  section('BLK-API4 GET ?limit=invalid → 400 invalid-limit');
  {
    _mockUid = ADMIN_UID;

    const resNeg = await callGet('?limit=-5');
    if (resNeg.status === 400 && resNeg.body.error === 'invalid-limit') {
      pass('BLK-API4 limit=-5 → 400 invalid-limit');
    } else {
      fail('BLK-API4 limit=-5', resNeg);
    }

    const resHuge = await callGet('?limit=10000');
    if (resHuge.status === 400 && resHuge.body.error === 'invalid-limit') {
      pass('BLK-API4 limit=10000 → 400 invalid-limit');
    } else {
      fail('BLK-API4 limit=10000', resHuge);
    }

    const resOk = await callGet('?limit=2');
    const blocks = (resOk.body.blocks ?? []) as unknown[];
    if (resOk.status === 200 && blocks.length === 2) {
      pass('BLK-API4 limit=2 → 200 + 2 blocks');
    } else {
      fail('BLK-API4 limit=2', resOk);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setVerifyAuthForTesting(null);
  // Cleanup blocks (preserve users for re-runs sanity)
  const blocksSnap = await db.collection('blocks').get();
  for (const d of blocksSnap.docs) await d.ref.delete().catch(() => {});

  console.log('');
  console.log('====== Résumé Admin Blocks API (BLK-API1-BLK-API4) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
