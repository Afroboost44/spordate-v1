/**
 * Tests Phase 8 sub-chantier 5 commit 2/5 — POST /api/cron/review-reminder.
 *
 * Exécution :
 *   npm run test:cron:review-reminder
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/cron/review-reminder.test.ts")
 *
 * Pattern : Admin SDK direct (cohérent SC4 invites/api.test.ts + SC5 admin/blocks-api.test.ts).
 *
 * Couverture (RR1-RR5) :
 *   RR1 booking confirmed + sessionDate -50h + reviewReminderSent !== true → flag set
 *   RR2 reviewReminderSent=true → skip (idempotency)
 *   RR3 sessionDate -24h (pas encore 48h) → skip
 *   RR4 sessionDate -100h (>72h) → skip
 *   RR5 batch limit honored : 600 bookings éligibles → 500 traités max
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-cron-rr';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-cron-rr';
process.env.CRON_SECRET = 'test-cron-secret-rr';

import { POST as POSTReviewReminder } from '../../src/app/api/cron/review-reminder/route';

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

async function callCron(authBearer = 'Bearer test-cron-secret-rr', query = ''): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = authBearer;
  const req = new Request(`http://localhost/api/cron/review-reminder${query}`, {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTReviewReminder(req);
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
    initializeApp({ projectId: 'demo-spordate-cron-rr' });
  }
  const db = getFirestore();

  // Helper seeders
  async function seedUser(uid: string, email: string, displayName?: string): Promise<void> {
    await db
      .collection('users')
      .doc(uid)
      .set({
        uid,
        email,
        displayName: displayName ?? `User ${uid}`,
        role: 'user',
      });
  }
  async function seedActivity(activityId: string, partnerId: string, title?: string): Promise<void> {
    await db
      .collection('activities')
      .doc(activityId)
      .set({
        activityId,
        partnerId,
        title: title ?? `Activity ${activityId}`,
        sport: 'tennis',
        city: 'Geneva',
      });
  }
  async function seedBooking(opts: {
    bookingId: string;
    userId: string;
    activityId: string;
    partnerId: string;
    sessionDateMs: number;
    status?: 'confirmed' | 'cancelled';
    reviewReminderSent?: boolean;
  }): Promise<void> {
    await db
      .collection('bookings')
      .doc(opts.bookingId)
      .set({
        bookingId: opts.bookingId,
        userId: opts.userId,
        userName: opts.userId,
        matchId: 'match_x',
        activityId: opts.activityId,
        partnerId: opts.partnerId,
        sport: 'tennis',
        ticketType: 'solo',
        sessionDate: Timestamp.fromMillis(opts.sessionDateMs),
        status: opts.status ?? 'confirmed',
        transactionId: 'tx_x',
        amount: 2500,
        currency: 'CHF',
        creditsUsed: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...(opts.reviewReminderSent !== undefined ? { reviewReminderSent: opts.reviewReminderSent } : {}),
      });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['bookings', 'users', 'activities']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  // Common fixture
  const PARTNER_UID = 'partner_rr';
  const ACTIVITY_ID = 'act_rr';
  const NOW = Date.now();

  // ===================================================================
  // RR1 happy path : sessionDate -50h + reviewReminderSent !== true
  // ===================================================================
  section('RR1 booking sessionDate -50h + flag absent → email sent + flag set');
  {
    await clearAll();
    await seedUser('user_rr1', 'rr1@test.local', 'Marie');
    await seedUser(PARTNER_UID, 'partner@test.local', 'Coach Léa');
    await seedActivity(ACTIVITY_ID, PARTNER_UID, 'Yoga Boost');
    const bookingId = 'booking_rr1';
    await seedBooking({
      bookingId,
      userId: 'user_rr1',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000, // 50h ago — within (48h, 72h)
    });

    const res = await callCron();
    if (res.status === 200) {
      pass('RR1 cron returned 200');
    } else {
      fail('RR1 status', res);
    }
    if (res.body.processed === 1 && res.body.sent === 1) {
      pass('RR1 processed=1 sent=1');
    } else {
      fail('RR1 counters', res.body);
    }

    const snap = await db.collection('bookings').doc(bookingId).get();
    if (snap.data()?.reviewReminderSent === true) {
      pass('RR1 booking.reviewReminderSent=true persisted');
    } else {
      fail('RR1 flag not set', snap.data());
    }
  }

  // ===================================================================
  // RR2 idempotency : reviewReminderSent=true → skip
  // ===================================================================
  section('RR2 reviewReminderSent=true → skip (idempotency)');
  {
    await clearAll();
    await seedUser('user_rr2', 'rr2@test.local');
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);
    await seedBooking({
      bookingId: 'booking_rr2',
      userId: 'user_rr2',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000,
      reviewReminderSent: true,
    });

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 1 && res.body.sent === 0 && res.body.skipped === 1) {
      pass('RR2 reviewReminderSent=true → processed=1 sent=0 skipped=1');
    } else {
      fail('RR2', res.body);
    }
  }

  // ===================================================================
  // RR3 too soon : sessionDate -24h (still within 48h grace, not eligible)
  // ===================================================================
  section('RR3 sessionDate -24h (avant 48h) → query excludes (out of window)');
  {
    await clearAll();
    await seedUser('user_rr3', 'rr3@test.local');
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);
    await seedBooking({
      bookingId: 'booking_rr3',
      userId: 'user_rr3',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW - 24 * 60 * 60 * 1000, // -24h, too recent
    });

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 0) {
      pass('RR3 sessionDate -24h excluded by query → processed=0');
    } else {
      fail('RR3', res.body);
    }

    const snap = await db.collection('bookings').doc('booking_rr3').get();
    if (snap.data()?.reviewReminderSent !== true) {
      pass('RR3 flag remains unset (not flagged)');
    } else {
      fail('RR3 flag wrongly set');
    }
  }

  // ===================================================================
  // RR4 too late : sessionDate -100h (past 72h window)
  // ===================================================================
  section('RR4 sessionDate -100h (après 72h) → query excludes');
  {
    await clearAll();
    await seedUser('user_rr4', 'rr4@test.local');
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);
    await seedBooking({
      bookingId: 'booking_rr4',
      userId: 'user_rr4',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW - 100 * 60 * 60 * 1000, // -100h, too old
    });

    const res = await callCron();
    if (res.status === 200 && res.body.processed === 0) {
      pass('RR4 sessionDate -100h excluded → processed=0');
    } else {
      fail('RR4', res.body);
    }
  }

  // ===================================================================
  // RR5 batch limit honored
  // ===================================================================
  section('RR5 batch limit : 600 bookings éligibles → 500 traités max');
  {
    await clearAll();
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);

    // Seed 600 bookings éligibles (sessionDate -50h, distinct users)
    const seedPromises: Promise<void>[] = [];
    for (let i = 0; i < 600; i++) {
      const uid = `user_rr5_${i}`;
      seedPromises.push(seedUser(uid, `rr5_${i}@test.local`));
      seedPromises.push(
        seedBooking({
          bookingId: `booking_rr5_${i}`,
          userId: uid,
          activityId: ACTIVITY_ID,
          partnerId: PARTNER_UID,
          sessionDateMs: NOW - 50 * 60 * 60 * 1000,
        }),
      );
    }
    await Promise.all(seedPromises);

    const res = await callCron();
    if (res.status === 200 && (res.body.processed as number) === 500) {
      pass('RR5 processed=500 (batch limit honored)');
    } else {
      fail('RR5 processed', res.body);
    }
    if ((res.body.batchLimit as number) === 500) {
      pass('RR5 batchLimit=500 dans response');
    } else {
      fail('RR5 batchLimit', res.body);
    }
  }

  // ===================================================================
  // Auth check (sanity)
  // ===================================================================
  section('Auth — Bearer manquant → 401');
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

  // ===================================================================
  // Cleanup
  // ===================================================================
  await clearAll();

  console.log('');
  console.log('====== Résumé Cron review-reminder (RR1-RR5 + auth) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
