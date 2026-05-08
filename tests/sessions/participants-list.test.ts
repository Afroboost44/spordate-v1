/**
 * Tests Phase 9 sub-chantier 1 commit 1/5 — GET /api/sessions/[sessionId]/participants.
 *
 * Exécution :
 *   npm run test:sessions:participants
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/sessions/participants-list.test.ts")
 *
 * Pattern : Admin SDK direct + DI seam mock auth (cohérent SC4 invites api + SC5 admin tests).
 *
 * Couverture (SP1-SP6) :
 *   SP1 user avec booking confirmé → peut lire bookings same session (200)
 *   SP2 user sans booking + session future → 403 forbidden
 *   SP3 user sans booking + session passée → 200 (event ended public)
 *   SP4 admin → toujours 200
 *   SP5 partner de la session → 200
 *   SP6 self-render badge "Toi" — verifie viewerUid match retourne self (assertion logique côté payload, badge UI testé via smoke)
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-participants';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-participants';

import { GET as GETParticipants } from '../../src/app/api/sessions/[sessionId]/participants/route';
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

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callGetParticipants(sessionId: string): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const req = new Request(`http://localhost/api/sessions/${sessionId}/participants`, {
    method: 'GET',
    headers,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await GETParticipants(req, { params: Promise.resolve({ sessionId }) });
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
    initializeApp({ projectId: 'demo-spordate-participants' });
  }
  const db = getFirestore();

  const PARTNER = 'partner_pl';
  const ADMIN = 'admin_pl';
  const ALICE = 'user_alice_pl';
  const BOB = 'user_bob_pl';
  const CHARLIE = 'user_charlie_pl';

  // Helper seeders
  async function seedUser(uid: string, role: 'user' | 'admin' = 'user'): Promise<void> {
    await db.collection('users').doc(uid).set({
      uid,
      email: `${uid}@test.local`,
      displayName: uid,
      photoURL: `https://example.com/${uid}.png`,
      role,
    });
  }

  async function seedSession(opts: {
    sessionId: string;
    partnerId: string;
    endAtMs: number;
  }): Promise<void> {
    const startAtMs = opts.endAtMs - 60 * 60 * 1000;
    await db.collection('sessions').doc(opts.sessionId).set({
      sessionId: opts.sessionId,
      activityId: 'activity_pl',
      partnerId: opts.partnerId,
      creatorId: opts.partnerId,
      sport: 'tennis',
      title: 'Test Session PL',
      city: 'Geneva',
      startAt: Timestamp.fromMillis(startAtMs),
      endAt: Timestamp.fromMillis(opts.endAtMs),
      maxParticipants: 8,
      currentParticipants: 0,
      pricingTiers: [],
      currentTier: 'early',
      currentPrice: 2500,
      status: 'open',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  async function seedBooking(opts: {
    bookingId: string;
    userId: string;
    sessionId: string;
    status?: 'confirmed' | 'cancelled';
  }): Promise<void> {
    await db.collection('bookings').doc(opts.bookingId).set({
      bookingId: opts.bookingId,
      userId: opts.userId,
      userName: opts.userId,
      matchId: 'match_x',
      activityId: 'activity_pl',
      partnerId: PARTNER,
      sport: 'tennis',
      ticketType: 'solo',
      sessionId: opts.sessionId,
      sessionDate: Timestamp.now(),
      status: opts.status ?? 'confirmed',
      transactionId: 'tx_x',
      amount: 2500,
      currency: 'CHF',
      creditsUsed: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['users', 'sessions', 'bookings']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  // Default mock auth
  let _mockUid: string | null = null;
  __setVerifyAuthForTesting(async () => _mockUid);

  // ===================================================================
  // SP1 user avec booking confirmé → 200
  // ===================================================================
  section('SP1 user avec booking confirmé → peut lire bookings (200)');
  {
    await clearAll();
    await Promise.all([
      seedUser(PARTNER),
      seedUser(ALICE),
      seedUser(BOB),
    ]);
    await seedSession({
      sessionId: 'session_sp1',
      partnerId: PARTNER,
      endAtMs: Date.now() + 24 * 60 * 60 * 1000, // future
    });
    await seedBooking({ bookingId: 'b_sp1_alice', userId: ALICE, sessionId: 'session_sp1' });
    await seedBooking({ bookingId: 'b_sp1_bob', userId: BOB, sessionId: 'session_sp1' });

    _mockUid = ALICE; // Alice has a confirmed booking
    const res = await callGetParticipants('session_sp1');
    if (res.status === 200) {
      pass('SP1 status 200');
    } else {
      fail('SP1 unexpected status', res);
    }
    if (res.body.accessReason === 'confirmed-participant') {
      pass('SP1 accessReason=confirmed-participant');
    } else {
      fail('SP1 accessReason', res.body);
    }
    const participants = res.body.participants as Array<{ uid: string }>;
    if (Array.isArray(participants) && participants.length === 2) {
      pass('SP1 2 participants retournés (alice + bob)');
    } else {
      fail('SP1 participants count', res.body);
    }
  }

  // ===================================================================
  // SP2 user sans booking + session future → 403
  // ===================================================================
  section('SP2 user sans booking + session future → 403 forbidden');
  {
    await clearAll();
    await Promise.all([
      seedUser(PARTNER),
      seedUser(ALICE),
      seedUser(CHARLIE), // pas de booking
    ]);
    await seedSession({
      sessionId: 'session_sp2',
      partnerId: PARTNER,
      endAtMs: Date.now() + 24 * 60 * 60 * 1000, // future
    });
    await seedBooking({ bookingId: 'b_sp2_alice', userId: ALICE, sessionId: 'session_sp2' });

    _mockUid = CHARLIE;
    const res = await callGetParticipants('session_sp2');
    if (res.status === 403) {
      pass('SP2 status 403 forbidden');
    } else {
      fail('SP2', res);
    }
  }

  // ===================================================================
  // SP3 session passée → 200 public
  // ===================================================================
  section('SP3 session passée (endAt < now) → 200 public');
  {
    await clearAll();
    await Promise.all([
      seedUser(PARTNER),
      seedUser(ALICE),
      seedUser(CHARLIE),
    ]);
    await seedSession({
      sessionId: 'session_sp3',
      partnerId: PARTNER,
      endAtMs: Date.now() - 24 * 60 * 60 * 1000, // past
    });
    await seedBooking({ bookingId: 'b_sp3_alice', userId: ALICE, sessionId: 'session_sp3' });

    _mockUid = CHARLIE; // sans booking, mais session passée → public
    const res = await callGetParticipants('session_sp3');
    if (res.status === 200 && res.body.accessReason === 'past-session-public') {
      pass('SP3 status 200 + accessReason=past-session-public');
    } else {
      fail('SP3', res);
    }

    // Aussi guest (no auth) doit pouvoir lire
    _mockUid = null;
    const resGuest = await callGetParticipants('session_sp3');
    if (resGuest.status === 200) {
      pass('SP3 guest (no auth) → 200 (past session public)');
    } else {
      fail('SP3 guest', resGuest);
    }
  }

  // ===================================================================
  // SP4 admin → toujours 200
  // ===================================================================
  section('SP4 admin → toujours 200');
  {
    await clearAll();
    await Promise.all([
      seedUser(PARTNER),
      seedUser(ADMIN, 'admin'),
      seedUser(ALICE),
    ]);
    await seedSession({
      sessionId: 'session_sp4',
      partnerId: PARTNER,
      endAtMs: Date.now() + 48 * 60 * 60 * 1000, // future
    });
    await seedBooking({ bookingId: 'b_sp4_alice', userId: ALICE, sessionId: 'session_sp4' });

    _mockUid = ADMIN;
    const res = await callGetParticipants('session_sp4');
    if (res.status === 200 && res.body.accessReason === 'admin') {
      pass('SP4 admin → 200 + accessReason=admin');
    } else {
      fail('SP4', res);
    }
  }

  // ===================================================================
  // SP5 partner de la session → 200
  // ===================================================================
  section('SP5 partner de la session → 200');
  {
    await clearAll();
    await Promise.all([
      seedUser(PARTNER),
      seedUser(ALICE),
    ]);
    await seedSession({
      sessionId: 'session_sp5',
      partnerId: PARTNER,
      endAtMs: Date.now() + 24 * 60 * 60 * 1000, // future
    });
    await seedBooking({ bookingId: 'b_sp5_alice', userId: ALICE, sessionId: 'session_sp5' });

    _mockUid = PARTNER;
    const res = await callGetParticipants('session_sp5');
    if (res.status === 200 && res.body.accessReason === 'partner') {
      pass('SP5 partner → 200 + accessReason=partner');
    } else {
      fail('SP5', res);
    }
  }

  // ===================================================================
  // SP6 self detection — booking inclut viewer
  // ===================================================================
  section('SP6 self detection — viewerUid match dans participants list');
  {
    await clearAll();
    await Promise.all([
      seedUser(PARTNER),
      seedUser(ALICE),
      seedUser(BOB),
    ]);
    await seedSession({
      sessionId: 'session_sp6',
      partnerId: PARTNER,
      endAtMs: Date.now() + 24 * 60 * 60 * 1000, // future
    });
    await seedBooking({ bookingId: 'b_sp6_alice', userId: ALICE, sessionId: 'session_sp6' });
    await seedBooking({ bookingId: 'b_sp6_bob', userId: BOB, sessionId: 'session_sp6' });

    _mockUid = ALICE;
    const res = await callGetParticipants('session_sp6');
    if (res.status !== 200) {
      fail('SP6 status', res);
    } else {
      pass('SP6 alice → 200');
    }
    const participants = (res.body.participants ?? []) as Array<{ uid: string; displayName: string }>;
    const aliceInList = participants.find((p) => p.uid === ALICE);
    if (aliceInList) {
      pass('SP6 alice présente dans participants (badge "Toi" rendu côté UI client)');
    } else {
      fail('SP6 alice missing from participants', participants);
    }
    const bobInList = participants.find((p) => p.uid === BOB);
    if (bobInList) {
      pass('SP6 bob présent (autre user, actions block/report rendues côté UI)');
    } else {
      fail('SP6 bob missing', participants);
    }
  }

  // ===================================================================
  // Bonus : 404 session inexistante
  // ===================================================================
  section('404 session inexistante');
  {
    await clearAll();
    _mockUid = null;
    const res = await callGetParticipants('session_does_not_exist');
    if (res.status === 404 && res.body.error === 'session-not-found') {
      pass('404 session-not-found');
    } else {
      fail('404 session', res);
    }
  }

  // Cleanup
  __setVerifyAuthForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Sessions participants (SP1-SP6 + 404) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
