/**
 * Tests Phase 9 sub-chantier 1 commit 4/5 — POST /api/cron/expire-invites.
 *
 * Exécution :
 *   npm run test:cron:expire-invites
 *
 * Pattern : Admin SDK direct (cohérent SC5 c2/5 cron + SC0 c1/X cursor pagination).
 *
 * Couverture (EI1-EI5 + auth) :
 *   EI1 invite status='pending' + expiresAt < now → status='expired' + processed=1
 *   EI2 invite status='pending' + expiresAt > now → preserve (status reste pending)
 *   EI3 invite status='accepted' déjà → skip (idempotency, only pending matchent query)
 *   EI4 600 invites éligibles + maxPages=10 default → processed=600 sur 2 pages, truncated=false
 *   EI5 1100 invites éligibles + maxPages=2 → processed=1000 + truncated=true
 *   Auth Bearer manquant/mauvais → 401
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-cron-ei';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-cron-ei';
process.env.CRON_SECRET = 'test-cron-secret-ei';

import { POST as POSTExpireInvites } from '../../src/app/api/cron/expire-invites/route';

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

async function callCron(authBearer = 'Bearer test-cron-secret-ei', query = ''): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = authBearer;
  const req = new Request(`http://localhost/api/cron/expire-invites${query}`, {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTExpireInvites(req);
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
    initializeApp({ projectId: 'demo-spordate-cron-ei' });
  }
  const db = getFirestore();

  // Helper seeder
  async function seedInvite(opts: {
    inviteId: string;
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    expiresAtMs: number;
    fromUserId?: string;
    toUserId?: string;
    sessionId?: string;
  }): Promise<void> {
    await db.collection('invites').doc(opts.inviteId).set({
      inviteId: opts.inviteId,
      fromUserId: opts.fromUserId ?? 'user_alice_ei',
      toUserId: opts.toUserId ?? 'user_bob_ei',
      activityId: 'activity_ei',
      sessionId: opts.sessionId ?? 'session_ei',
      status: opts.status,
      expiresAt: Timestamp.fromMillis(opts.expiresAtMs),
      createdAt: Timestamp.now(),
    });
  }

  async function clearAll(): Promise<void> {
    const snap = await db.collection('invites').get();
    for (const d of snap.docs) await d.ref.delete().catch(() => {});
  }

  const NOW = Date.now();

  // ===================================================================
  // EI1 invite pending + expiresAt passé → expired
  // ===================================================================
  section('EI1 invite pending + expiresAt < now → status=expired + processed=1');
  {
    await clearAll();
    await seedInvite({ inviteId: 'invite_ei1', status: 'pending', expiresAtMs: NOW - 60_000 });

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 1) {
      pass('EI1 status 200 + processed=1');
    } else {
      fail('EI1', res);
    }

    const snap = await db.collection('invites').doc('invite_ei1').get();
    if (snap.data()?.status === 'expired') {
      pass('EI1 invite_ei1 status=expired persisted');
    } else {
      fail('EI1 status not expired', snap.data());
    }
  }

  // ===================================================================
  // EI2 invite pending + expiresAt futur → preserve
  // ===================================================================
  section('EI2 invite pending + expiresAt > now → preserve (no touch)');
  {
    await clearAll();
    await seedInvite({
      inviteId: 'invite_ei2',
      status: 'pending',
      expiresAtMs: NOW + 5 * 24 * 60 * 60_000, // 5 days future
    });

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 0) {
      pass('EI2 processed=0 (no expirable invite)');
    } else {
      fail('EI2', res);
    }

    const snap = await db.collection('invites').doc('invite_ei2').get();
    if (snap.data()?.status === 'pending') {
      pass('EI2 invite_ei2 status=pending preserved');
    } else {
      fail('EI2 status was changed', snap.data());
    }
  }

  // ===================================================================
  // EI3 invite accepted déjà → skip (only pending matchent)
  // ===================================================================
  section('EI3 invite status=accepted déjà → skip (only pending matchent query)');
  {
    await clearAll();
    await seedInvite({
      inviteId: 'invite_ei3',
      status: 'accepted',
      expiresAtMs: NOW - 60_000, // already past
    });

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 0) {
      pass('EI3 processed=0 (status=accepted skipped)');
    } else {
      fail('EI3', res);
    }

    const snap = await db.collection('invites').doc('invite_ei3').get();
    if (snap.data()?.status === 'accepted') {
      pass('EI3 invite_ei3 status=accepted preserved (no overwrite)');
    } else {
      fail('EI3 accepted was changed', snap.data());
    }
  }

  // ===================================================================
  // EI4 600 invites éligibles + default maxPages=10 → 600 traités sur 2 pages
  // ===================================================================
  section('EI4 600 invites éligibles → cursor pagination 600 sur 2 pages, truncated=false');
  {
    await clearAll();
    const seedPromises: Promise<void>[] = [];
    for (let i = 0; i < 600; i++) {
      seedPromises.push(
        seedInvite({
          inviteId: `invite_ei4_${i}`,
          status: 'pending',
          // distribute expiresAt to avoid orderBy ties
          expiresAtMs: NOW - 60_000 - i,
        }),
      );
    }
    await Promise.all(seedPromises);

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 600) {
      pass('EI4 processed=600 (cursor pagination 2 pages)');
    } else {
      fail('EI4 processed', res.body);
    }
    if (res.body.pages === 2) {
      pass('EI4 pages=2 (500 + 100)');
    } else {
      fail('EI4 pages', res.body);
    }
    if (res.body.truncated === false) {
      pass('EI4 truncated=false (toutes pages traitées)');
    } else {
      fail('EI4 truncated', res.body);
    }
  }

  // ===================================================================
  // EI5 1100 invites + maxPages=2 → 1000 traités truncated=true
  // ===================================================================
  section('EI5 1100 invites + maxPages=2 → processed=1000 + truncated=true');
  {
    await clearAll();
    const seedPromises: Promise<void>[] = [];
    for (let i = 0; i < 1100; i++) {
      seedPromises.push(
        seedInvite({
          inviteId: `invite_ei5_${i}`,
          status: 'pending',
          expiresAtMs: NOW - 60_000 - i,
        }),
      );
    }
    await Promise.all(seedPromises);

    const res = await callCron('Bearer test-cron-secret-ei', '?maxPages=2');
    if (res.status === 200 && res.body.processed === 1000) {
      pass('EI5 processed=1000 (maxPages=2 × pageSize=500)');
    } else {
      fail('EI5 processed', res.body);
    }
    if (res.body.truncated === true) {
      pass('EI5 truncated=true (cap maxPages atteint)');
    } else {
      fail('EI5 truncated', res.body);
    }
  }

  // ===================================================================
  // Auth check
  // ===================================================================
  section('Auth — Bearer manquant → 401 / mauvais → 401');
  {
    const res = await callCron('');
    if (res.status === 401) {
      pass('Bearer manquant → 401');
    } else {
      fail('auth no bearer', res);
    }

    const resBad = await callCron('Bearer wrong-secret');
    if (resBad.status === 401) {
      pass('Bearer mauvais → 401');
    } else {
      fail('auth bad bearer', resBad);
    }
  }

  // Cleanup
  await clearAll();

  console.log('');
  console.log('====== Résumé Cron expire-invites (EI1-EI5 + auth) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
