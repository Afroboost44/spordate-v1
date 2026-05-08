/**
 * Tests Phase 9 sub-chantier 3 commit 1/5 — POST /api/cron/session-reminders.
 *
 * Exécution :
 *   npm run test:cron:session-reminders
 *
 * Pattern : Admin SDK direct + mock Resend (Q8=C verify content cohérent SC4 c4/6
 * email-webhook.test.ts + SC2 c2/6 email-split-gift.test.ts).
 *
 * Couverture (SR1-SR5 + auth) :
 *   SR1 booking confirmé sessionDate +25h (window J-1 18-30h) + flag absent → email envoyé + flag set
 *   SR2 booking confirmé sessionDate +1h (window T-0 30-90min) + flag absent → email T-0 envoyé + flag set
 *   SR3 booking reminderJMinus1Sent=true → skip J-1 (idempotency) — flag T-0 indépendant
 *   SR4 booking sessionDate +5h (hors fenêtre J-1 ET T-0) → 0 email envoyé
 *   SR5 cursor pagination : 600 bookings J-1 éligibles → 600 traités sur 2 pages
 *   Auth Bearer manquant/mauvais → 401
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-cron-sr';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-cron-sr';
process.env.CRON_SECRET = 'test-cron-secret-sr';

import { POST as POSTSessionReminders } from '../../src/app/api/cron/session-reminders/route';
import { __setResendForTesting } from '../../src/lib/email/sendEmail';
import { renderTemplate } from '../../src/lib/email/templates';

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

async function callCron(authBearer = 'Bearer test-cron-secret-sr'): Promise<MockResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authBearer) headers.authorization = authBearer;
  const req = new Request('http://localhost/api/cron/session-reminders', {
    method: 'POST',
    headers,
    body: '{}',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const res = await POSTSessionReminders(req);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

// =====================================================================

interface MockResendCall {
  to: string;
  subject?: string;
  html?: string;
  templateName?: string;
}

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-cron-sr' });
  }
  const db = getFirestore();

  // Force RESEND_API_KEY pour activer envoi via mock (sinon loggedOnly mode skip mock)
  process.env.RESEND_API_KEY = 'mock_re_sr';
  const sentMock: MockResendCall[] = [];

  function resetMock(): void {
    sentMock.length = 0;
    __setResendForTesting({
      emails: {
        send: async (opts: {
          to?: string | string[];
          subject?: string;
          html?: string;
        }) => {
          sentMock.push({
            to: Array.isArray(opts.to) ? opts.to[0] : opts.to ?? '',
            subject: opts.subject,
            html: opts.html,
          });
          return { data: { id: `mock_msg_${sentMock.length}` }, error: null };
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
  resetMock();

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
        address: '12 rue du Sport, Geneva',
      });
  }
  async function seedBooking(opts: {
    bookingId: string;
    userId: string;
    activityId: string;
    partnerId: string;
    sessionDateMs: number;
    status?: 'confirmed' | 'cancelled';
    reminderJMinus1Sent?: boolean;
    reminderTMinus0Sent?: boolean;
  }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
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
      sessionId: `session_${opts.bookingId}`,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    if (opts.reminderJMinus1Sent !== undefined) payload.reminderJMinus1Sent = opts.reminderJMinus1Sent;
    if (opts.reminderTMinus0Sent !== undefined) payload.reminderTMinus0Sent = opts.reminderTMinus0Sent;
    await db.collection('bookings').doc(opts.bookingId).set(payload);
  }

  async function clearAll(): Promise<void> {
    for (const col of ['bookings', 'users', 'activities']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    resetMock();
  }

  const PARTNER_UID = 'partner_sr';
  const ACTIVITY_ID = 'act_sr';
  const NOW = Date.now();

  // ===================================================================
  // SR1 booking sessionDate +25h (window J-1) + flag absent → email J-1
  // ===================================================================
  section('SR1 booking sessionDate +25h (window J-1 18-30h) → email J-1 envoyé + flag set');
  {
    await clearAll();
    await seedUser('user_sr1', 'sr1@test.local', 'Marie');
    await seedUser(PARTNER_UID, 'partner@test.local', 'Coach Léa');
    await seedActivity(ACTIVITY_ID, PARTNER_UID, 'Yoga Sunset');
    const bookingId = 'booking_sr1';
    await seedBooking({
      bookingId,
      userId: 'user_sr1',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW + 25 * 60 * 60 * 1000, // 25h ahead — within (18, 30)h
    });

    const res = await callCron();
    if (res.status === 200) {
      pass('SR1 cron 200');
    } else {
      fail('SR1 status', res);
    }
    const j = res.body.jMinus1 as { sent: number; processed: number };
    if (j?.sent === 1 && j?.processed === 1) {
      pass('SR1 jMinus1 sent=1 processed=1');
    } else {
      fail('SR1 jMinus1 counters', j);
    }
    if (sentMock.length === 1) {
      pass('SR1 Resend mock called 1×');
    } else {
      fail('SR1 mock calls', sentMock);
    }
    if (sentMock[0]?.subject?.includes('Yoga Sunset') && sentMock[0]?.subject?.toLowerCase().includes('demain')) {
      pass('SR1 subject contient activityTitle + "demain" (Q8=C verify content)');
    } else {
      fail('SR1 subject', sentMock[0]?.subject);
    }
    const snap = await db.collection('bookings').doc(bookingId).get();
    if (snap.data()?.reminderJMinus1Sent === true) {
      pass('SR1 booking.reminderJMinus1Sent=true persisted');
    } else {
      fail('SR1 flag', snap.data());
    }
  }

  // ===================================================================
  // SR2 booking sessionDate +1h (window T-0) → email T-0
  // ===================================================================
  section('SR2 booking sessionDate +1h (window T-0 30-90min) → email T-0 envoyé + flag set');
  {
    await clearAll();
    await seedUser('user_sr2', 'sr2@test.local', 'Bob');
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID, 'Padel Match');
    const bookingId = 'booking_sr2';
    await seedBooking({
      bookingId,
      userId: 'user_sr2',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW + 60 * 60 * 1000, // 60min ahead — within (30, 90)min
    });

    const res = await callCron();
    const t = res.body.tMinus0 as { sent: number; processed: number };
    if (t?.sent === 1 && t?.processed === 1) {
      pass('SR2 tMinus0 sent=1 processed=1');
    } else {
      fail('SR2 tMinus0 counters', t);
    }
    if (sentMock.length === 1) {
      pass('SR2 Resend mock called 1×');
    } else {
      fail('SR2 mock calls', sentMock);
    }
    if (sentMock[0]?.subject?.toLowerCase().includes('1h') && sentMock[0]?.subject?.includes('Padel Match')) {
      pass('SR2 subject contient "1h" + activityTitle (T-0 template)');
    } else {
      fail('SR2 subject T-0', sentMock[0]?.subject);
    }
    const snap = await db.collection('bookings').doc(bookingId).get();
    if (snap.data()?.reminderTMinus0Sent === true) {
      pass('SR2 booking.reminderTMinus0Sent=true persisted');
    } else {
      fail('SR2 flag', snap.data());
    }
  }

  // ===================================================================
  // SR3 idempotency : reminderJMinus1Sent=true → skip J-1 (T-0 flag indépendant)
  // ===================================================================
  section('SR3 reminderJMinus1Sent=true → skip J-1 (idempotency)');
  {
    await clearAll();
    await seedUser('user_sr3', 'sr3@test.local');
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);
    await seedBooking({
      bookingId: 'booking_sr3',
      userId: 'user_sr3',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW + 25 * 60 * 60 * 1000, // J-1 window
      reminderJMinus1Sent: true, // already sent
    });

    const res = await callCron();
    const j = res.body.jMinus1 as { sent: number; skipped: number; processed: number };
    if (j?.sent === 0 && j?.skipped === 1 && j?.processed === 1) {
      pass('SR3 jMinus1 sent=0 skipped=1 (already flagged)');
    } else {
      fail('SR3 jMinus1', j);
    }
    if (sentMock.length === 0) {
      pass('SR3 zéro Resend mock call (skip silent)');
    } else {
      fail('SR3 unexpected mock calls', sentMock);
    }
  }

  // ===================================================================
  // SR4 sessionDate +5h (hors fenêtre J-1 ET T-0) → 0 email
  // ===================================================================
  section('SR4 sessionDate +5h (hors window J-1 18-30h ET T-0 30-90min) → 0 email');
  {
    await clearAll();
    await seedUser('user_sr4', 'sr4@test.local');
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);
    await seedBooking({
      bookingId: 'booking_sr4',
      userId: 'user_sr4',
      activityId: ACTIVITY_ID,
      partnerId: PARTNER_UID,
      sessionDateMs: NOW + 5 * 60 * 60 * 1000, // 5h ahead — hors fenêtres (entre T-0 90min et J-1 18h)
    });

    const res = await callCron();
    const j = res.body.jMinus1 as { processed: number };
    const t = res.body.tMinus0 as { processed: number };
    if (j?.processed === 0 && t?.processed === 0) {
      pass('SR4 J-1 + T-0 processed=0 (hors fenêtres)');
    } else {
      fail('SR4 processed', { j, t });
    }
    if (sentMock.length === 0) {
      pass('SR4 zéro email envoyé');
    } else {
      fail('SR4 unexpected emails', sentMock);
    }
  }

  // ===================================================================
  // SR5 cursor pagination : 600 bookings J-1 → 600 traités sur 2 pages
  // ===================================================================
  section('SR5 cursor pagination : 600 bookings J-1 éligibles → 600 traités sur 2 pages');
  {
    await clearAll();
    await seedUser(PARTNER_UID, 'partner@test.local');
    await seedActivity(ACTIVITY_ID, PARTNER_UID);

    // Seed 600 bookings éligibles J-1 (sessionDate +24h, distinct users)
    const seedPromises: Promise<void>[] = [];
    for (let i = 0; i < 600; i++) {
      const uid = `user_sr5_${i}`;
      seedPromises.push(seedUser(uid, `sr5_${i}@test.local`));
      seedPromises.push(
        seedBooking({
          bookingId: `booking_sr5_${i}`,
          userId: uid,
          activityId: ACTIVITY_ID,
          partnerId: PARTNER_UID,
          // Distribute sessionDates within J-1 window (18-30h) to avoid orderBy ties
          sessionDateMs: NOW + (24 * 60 * 60 * 1000 + i * 1000),
        }),
      );
    }
    await Promise.all(seedPromises);

    const res = await callCron();
    const j = res.body.jMinus1 as { sent: number; processed: number; pages: number; truncated: boolean };
    if (j?.processed === 600 && j?.sent === 600) {
      pass('SR5 jMinus1 processed=600 sent=600 (cursor pagination 2 pages)');
    } else {
      fail('SR5 counters', j);
    }
    if (j?.pages === 2) {
      pass('SR5 jMinus1 pages=2 (500 + 100)');
    } else {
      fail('SR5 pages', j);
    }
    if (j?.truncated === false) {
      pass('SR5 jMinus1 truncated=false');
    } else {
      fail('SR5 truncated', j);
    }
  }

  // ===================================================================
  // Auth check
  // ===================================================================
  section('Auth — Bearer manquant/mauvais → 401');
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
  // Bonus : render templates direct verify content (Q8=C)
  // ===================================================================
  section('Bonus templates render direct verify content (Q8=C)');
  {
    const r1 = renderTemplate('sessionReminderJMinus1', {
      userName: 'Alice',
      sessionTitle: 'Tennis Lac',
      partnerName: 'Coach Lac',
      sessionDate: 'Sam 18 mai · 14h00',
      sessionAddress: 'Quai Wilson, Geneva',
      sessionLink: 'https://spordateur.com/sessions/sx',
    });
    if (r1.subject.includes('Tennis Lac') && r1.subject.toLowerCase().includes('demain')) {
      pass('Bonus J-1 template subject contient activityTitle + "demain"');
    } else {
      fail('Bonus J-1 subject', r1.subject);
    }
    if (r1.html.includes('Quai Wilson') && r1.html.includes('Sam 18 mai')) {
      pass('Bonus J-1 body contient address + sessionDate');
    } else {
      fail('Bonus J-1 body parts');
    }

    const r2 = renderTemplate('sessionReminderTMinus0', {
      userName: 'Bob',
      sessionTitle: 'Padel',
      partnerName: 'Coach P',
      sessionDate: 'Lun 20 mai · 18h00',
      sessionLink: 'https://spordateur.com/sessions/sy',
    });
    if (r2.subject.toLowerCase().includes('1h') && r2.subject.includes('Padel')) {
      pass('Bonus T-0 template subject contient "1h" + activityTitle');
    } else {
      fail('Bonus T-0 subject', r2.subject);
    }
  }

  // Cleanup
  __setResendForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Cron session-reminders (SR1-SR5 + auth + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
