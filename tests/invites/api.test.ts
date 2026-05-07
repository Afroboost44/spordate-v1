/**
 * Tests Phase 8 sub-chantier 4 commit 3/6 — API routes Invite.
 *
 * Exécution :
 *   npm run test:invites:api
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/invites/api.test.ts")
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC3 c3/6 SAR tests).
 * ENV vars FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT set BEFORE imports.
 *
 * Couverture (6 cas INV-API1-INV-API6) :
 *   INV-API1 POST /api/invites happy → 200 + invite created
 *   INV-API2 POST /api/invites self-invite → 400 (self-invite-forbidden)
 *   INV-API3 POST /api/invites unauthenticated (no Bearer) → 401
 *   INV-API4 POST /api/invites/[id]/decline by toUserId → 200 status='declined'
 *   INV-API5 POST /api/invites/[id]/decline by fromUserId → 403 (forbidden path b)
 *   INV-API6 POST /api/checkout mode='invite-accept' invalid status → 409 (idempotency)
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-inv-api';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-inv-api';
// Stripe key fake (route invite-accept early validates BEFORE stripe call)
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

import { POST as POSTInvite } from '../../src/app/api/invites/route';
import { POST as POSTDecline } from '../../src/app/api/invites/[id]/decline/route';
import { POST as POSTCheckout } from '../../src/app/api/checkout/route';
import { __setVerifyAuthForTesting } from '../../src/lib/auth/verifyAuth';
import { __setInvitesDbForTesting, makeInviteDocId } from '../../src/lib/invites/service';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import type { Firestore } from 'firebase/firestore';

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

function fail(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Constants + helpers
// =====================================================================

const ALICE_UID = 'user_alice_invapi';
const BOB_UID = 'user_bob_invapi';
const CHARLIE_UID = 'user_charlie_invapi';

const ACTIVITY_ID = 'activity_invapi_1';
const SESSION_ID = 'session_invapi_1';

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callPost(
  handler: (req: Request) => Promise<Response>,
  url: string,
  payload: Record<string, unknown> | null,
  authBearer?: string,
): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = `Bearer ${authBearer}`;
  const req = new Request(url, {
    method: 'POST',
    headers,
    body: payload ? JSON.stringify(payload) : '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await handler(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function callDecline(inviteId: string, authBearer?: string): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = `Bearer ${authBearer}`;
  const req = new Request(`http://localhost/api/invites/${inviteId}/decline`, {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTDecline(req, { params: Promise.resolve({ id: inviteId }) });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

async function main(): Promise<void> {
  // Init Admin SDK pointing à l'emulator (pour seed + verify reads bypass rules)
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-inv-api' });
  }
  const db = getFirestore();

  // Init rules-unit-testing env (client SDK pour service helpers via DI seam)
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-inv-api',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  /** Inject client SDK Firestore (authenticatedContext) pour service helpers via DI seam. */
  function injectClientSdk(authUid: string): void {
    __setInvitesDbForTesting(asFirestore(env.authenticatedContext(authUid).firestore()));
  }

  // Setup helpers
  const nowMs = Date.now();
  async function seedSession(sessionId: string, startAtMs: number) {
    const endAtMs = startAtMs + 60 * 60_000;
    await db.collection('sessions').doc(sessionId).set({
      sessionId,
      activityId: ACTIVITY_ID,
      partnerId: 'partner_test',
      creatorId: 'creator_test',
      sport: 'tennis',
      title: 'Test Session',
      city: 'Geneva',
      startAt: Timestamp.fromMillis(startAtMs),
      endAt: Timestamp.fromMillis(endAtMs),
      chatOpenAt: Timestamp.fromMillis(startAtMs - 2 * 60 * 60_000),
      chatCloseAt: Timestamp.fromMillis(endAtMs),
      maxParticipants: 8,
      currentParticipants: 0,
      pricingTiers: [],
      currentTier: 'early',
      currentPrice: 2500,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async function seedInvite(
    inviteId: string,
    fromUserId: string,
    toUserId: string,
    sessionId: string,
    status: string,
  ) {
    await db.collection('invites').doc(inviteId).set({
      inviteId,
      fromUserId,
      toUserId,
      activityId: ACTIVITY_ID,
      sessionId,
      status,
      expiresAt: Timestamp.fromMillis(nowMs + 5 * 24 * 60 * 60_000),
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  async function clearAll() {
    const collections = ['invites', 'sessions'];
    for (const col of collections) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  // Default mock auth — will be overridden per-test
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // INV-API1 happy path
  // ===================================================================
  section('INV-API1 POST /api/invites happy path → 200 + invite created');
  {
    await clearAll();
    await seedSession(SESSION_ID, nowMs + 5 * 24 * 60 * 60_000);
    _mockUid = ALICE_UID;
    injectClientSdk(ALICE_UID); // Service createInvite write fromUserId=alice → rule allow

    const res = await callPost(
      POSTInvite as never,
      'http://localhost/api/invites',
      { toUserId: BOB_UID, activityId: ACTIVITY_ID, sessionId: SESSION_ID, message: 'On y va ?' },
      'mock_token_alice',
    );

    if (res.status === 200 && res.body.status === 'pending' && typeof res.body.inviteId === 'string') {
      pass('INV-API1 status 200 + invitePending + inviteId returned');
    } else {
      fail('INV-API1', res);
    }

    // Verify doc persisted via Admin SDK
    const expectedId = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_ID);
    const snap = await db.collection('invites').doc(expectedId).get();
    if (snap.exists && snap.data()?.fromUserId === ALICE_UID) {
      pass('INV-API1 invite persistée Firestore (fromUserId=alice)');
    } else {
      fail('INV-API1 invite not persisted', snap.data());
    }
  }

  // ===================================================================
  // INV-API2 self-invite → 400
  // ===================================================================
  section('INV-API2 self-invite (from==to) → 400');
  {
    await clearAll();
    await seedSession(SESSION_ID, nowMs + 5 * 24 * 60 * 60_000);
    _mockUid = ALICE_UID;

    const res = await callPost(
      POSTInvite as never,
      'http://localhost/api/invites',
      { toUserId: ALICE_UID, activityId: ACTIVITY_ID, sessionId: SESSION_ID },
      'mock_token_alice',
    );

    if (res.status === 400 && res.body.error === 'self-invite-forbidden') {
      pass('INV-API2 self-invite → 400 self-invite-forbidden');
    } else {
      fail('INV-API2', res);
    }
  }

  // ===================================================================
  // INV-API3 unauthenticated → 401
  // ===================================================================
  section('INV-API3 unauthenticated (no Bearer / mock returns null) → 401');
  {
    await clearAll();
    _mockUid = null; // verifyAuth returns null

    const res = await callPost(
      POSTInvite as never,
      'http://localhost/api/invites',
      { toUserId: BOB_UID, activityId: ACTIVITY_ID, sessionId: SESSION_ID },
      // No authBearer header
    );

    if (res.status === 401 && res.body.error === 'unauthenticated') {
      pass('INV-API3 no auth → 401 unauthenticated');
    } else {
      fail('INV-API3', res);
    }
  }

  // ===================================================================
  // INV-API4 decline by toUserId → 200 declined
  // ===================================================================
  section('INV-API4 POST /api/invites/[id]/decline by toUserId → 200 declined');
  {
    await clearAll();
    const inviteId = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_ID);
    await seedSession(SESSION_ID, nowMs + 5 * 24 * 60 * 60_000);
    await seedInvite(inviteId, ALICE_UID, BOB_UID, SESSION_ID, 'pending');
    _mockUid = BOB_UID; // Bob is toUserId
    injectClientSdk(BOB_UID); // Service declineInvite update path b → rule allow

    const res = await callDecline(inviteId, 'mock_token_bob');

    if (res.status === 200 && res.body.status === 'declined') {
      pass('INV-API4 decline by bob → 200 status=declined');
    } else {
      fail('INV-API4', res);
    }

    const snap = await db.collection('invites').doc(inviteId).get();
    if (snap.data()?.status === 'declined' && snap.data()?.declinedAt) {
      pass('INV-API4 invite status=declined + declinedAt persisté');
    } else {
      fail('INV-API4 invite not updated', snap.data());
    }
  }

  // ===================================================================
  // INV-API5 decline by fromUserId → 403
  // ===================================================================
  section('INV-API5 POST /api/invites/[id]/decline by fromUserId → 403 forbidden');
  {
    await clearAll();
    const inviteId = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_ID);
    await seedSession(SESSION_ID, nowMs + 5 * 24 * 60 * 60_000);
    await seedInvite(inviteId, ALICE_UID, BOB_UID, SESSION_ID, 'pending');
    _mockUid = ALICE_UID; // Alice is fromUserId — should fail decline (path b reserved toUserId)
    injectClientSdk(ALICE_UID); // Service decline read invite (service throws forbidden before write)

    const res = await callDecline(inviteId, 'mock_token_alice');

    if (res.status === 403 && res.body.error === 'forbidden') {
      pass('INV-API5 decline by alice (fromUserId) → 403 forbidden');
    } else {
      fail('INV-API5', res);
    }
  }

  // ===================================================================
  // INV-API6 checkout invite-accept invalid status → 409
  // ===================================================================
  section('INV-API6 POST /api/checkout mode=invite-accept status≠pending → 409');
  {
    await clearAll();
    const inviteId = makeInviteDocId(ALICE_UID, BOB_UID, SESSION_ID);
    await seedSession(SESSION_ID, nowMs + 5 * 24 * 60 * 60_000);
    // Invite already accepted — early validation should reject before Stripe call
    await seedInvite(inviteId, ALICE_UID, BOB_UID, SESSION_ID, 'accepted');
    _mockUid = BOB_UID;

    const res = await callPost(
      POSTCheckout as never,
      'http://localhost/api/checkout',
      { mode: 'invite-accept', inviteId },
      'mock_token_bob',
    );

    if (res.status === 409 && res.body.error === 'invalid-status') {
      pass('INV-API6 status=accepted → 409 invalid-status (idempotency)');
    } else {
      fail('INV-API6', res);
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  __setVerifyAuthForTesting(null);
  __setInvitesDbForTesting(null);
  await clearAll();
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Invites API (INV-API1-INV-API6) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
