/**
 * Tests Phase 9 sub-chantier 3 commit 2/5 — sendPushNotification helper +
 * intégration push-first/email-fallback dans crons review-reminder + session-reminders.
 *
 * Exécution :
 *   npm run test:notifications:send-push
 *
 * Pattern : Admin SDK direct + DI seam mock messaging + Resend mock (cohérent SC2 c3/6
 * + SC5 c4/5 + SC3 c1/5 patterns).
 *
 * Couverture (PUSH1-PUSH4 + bonus) :
 *   PUSH1 sendPushNotification valid token → mock messaging.send appelé + return ok=true + messageId
 *   PUSH2 token invalid (mock throw 'invalid-registration-token') → return ok=false reason='token-invalid' (no throw)
 *   PUSH3 review-reminder cron : user avec fcmToken + opt-in → push appelé + email skipped (Q3=B)
 *   PUSH4 review-reminder cron : user sans fcmToken → email fallback (legacy comportement)
 *   Bonus session-reminders cron J-1 push-first / fallback patterns
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-push';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-push';
process.env.CRON_SECRET = 'test-cron-secret-push';
process.env.RESEND_API_KEY = 'mock_re_push';

import {
  sendPushNotification,
  __setMessagingForTesting,
} from '../../src/lib/notifications/sendPushNotification';
import { POST as POSTReviewReminder } from '../../src/app/api/cron/review-reminder/route';
import { POST as POSTSessionReminders } from '../../src/app/api/cron/session-reminders/route';
import { __setResendForTesting } from '../../src/lib/email/sendEmail';

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
// Mock FCM messaging
// =====================================================================

interface MockSendCall {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
}

class MockMessaging {
  public sendCalls: MockSendCall[] = [];
  public failOnToken = new Set<string>();
  public errorCodeForToken = new Map<string, string>();
  private _counter = 0;

  reset() {
    this.sendCalls = [];
    this.failOnToken.clear();
    this.errorCodeForToken.clear();
    this._counter = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(message: any): Promise<string> {
    this.sendCalls.push({ message });
    if (this.failOnToken.has(message.token)) {
      const code = this.errorCodeForToken.get(message.token) || 'messaging/invalid-registration-token';
      const err = new Error(`Mock FCM error ${code}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).code = code;
      throw err;
    }
    this._counter++;
    return `mock_fcm_msg_${this._counter}`;
  }
}

const mockMessaging = new MockMessaging();

// Mock Resend
interface MockResendCall {
  to: string;
  subject?: string;
  templateName?: string;
}
const sentMockResend: MockResendCall[] = [];

function resetResend(): void {
  sentMockResend.length = 0;
  __setResendForTesting({
    emails: {
      send: async (opts: { to?: string | string[]; subject?: string }) => {
        sentMockResend.push({
          to: Array.isArray(opts.to) ? opts.to[0] : opts.to ?? '',
          subject: opts.subject,
        });
        return { data: { id: `mock_re_${sentMockResend.length}` }, error: null };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

// =====================================================================

interface MockResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callReviewReminderCron(): Promise<MockResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-cron-secret-push',
  };
  const req = new Request('http://localhost/api/cron/review-reminder', {
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

async function callSessionRemindersCron(): Promise<MockResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer test-cron-secret-push',
  };
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

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-push' });
  }
  const db = getFirestore();

  // Wire DI seams
  __setMessagingForTesting(mockMessaging);
  resetResend();

  // ===================================================================
  // PUSH1 sendPushNotification valid token
  // ===================================================================
  section('PUSH1 sendPushNotification valid token → mock messaging.send + ok=true');
  {
    mockMessaging.reset();
    const r = await sendPushNotification({
      fcmToken: 'fcm_valid_token',
      title: 'Test push title',
      body: 'Test push body',
      clickUrl: 'https://spordateur.com/sessions/x',
      data: { bookingId: 'booking_x' },
    });
    if (r.ok && r.messageId) {
      pass('PUSH1 ok=true + messageId returned');
    } else {
      fail('PUSH1 result', r);
    }
    if (mockMessaging.sendCalls.length === 1) {
      pass('PUSH1 messaging.send called 1×');
    } else {
      fail('PUSH1 send calls', mockMessaging.sendCalls.length);
    }
    const sentMsg = mockMessaging.sendCalls[0]?.message;
    if (sentMsg?.token === 'fcm_valid_token' && sentMsg?.notification?.title === 'Test push title') {
      pass('PUSH1 message shape OK (token + notification.title)');
    } else {
      fail('PUSH1 message shape', sentMsg);
    }
    if (sentMsg?.webpush?.fcmOptions?.link === 'https://spordateur.com/sessions/x') {
      pass('PUSH1 webpush.fcmOptions.link set (clickUrl)');
    } else {
      fail('PUSH1 clickUrl not set', sentMsg?.webpush);
    }
  }

  // ===================================================================
  // PUSH2 token invalid → return ok=false reason='token-invalid'
  // ===================================================================
  section("PUSH2 token invalid (FCM throw) → return ok=false reason='token-invalid' (no throw)");
  {
    mockMessaging.reset();
    mockMessaging.failOnToken.add('fcm_bad_token');
    mockMessaging.errorCodeForToken.set('fcm_bad_token', 'messaging/invalid-registration-token');

    const r = await sendPushNotification({
      fcmToken: 'fcm_bad_token',
      title: 'Test',
      body: 'Body',
    });
    if (!r.ok && r.reason === 'token-invalid') {
      pass('PUSH2 ok=false reason=token-invalid (no throw)');
    } else {
      fail('PUSH2 result', r);
    }
  }

  // ===================================================================
  // PUSH2b token-not-registered (variant)
  // ===================================================================
  section("PUSH2b token-not-registered (FCM stale) → reason='token-not-registered'");
  {
    mockMessaging.reset();
    mockMessaging.failOnToken.add('fcm_stale_token');
    mockMessaging.errorCodeForToken.set('fcm_stale_token', 'messaging/registration-token-not-registered');

    const r = await sendPushNotification({
      fcmToken: 'fcm_stale_token',
      title: 'X',
      body: 'Y',
    });
    if (!r.ok && r.reason === 'token-not-registered') {
      pass('PUSH2b reason=token-not-registered');
    } else {
      fail('PUSH2b result', r);
    }
  }

  // ===================================================================
  // Helper seeders for crons integration
  // ===================================================================
  async function seedUser(opts: {
    uid: string;
    email: string;
    fcmToken?: string;
    pushNotificationsEnabled?: boolean;
  }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      uid: opts.uid,
      email: opts.email,
      displayName: opts.uid,
    };
    if (opts.fcmToken) payload.fcmToken = opts.fcmToken;
    if (opts.pushNotificationsEnabled !== undefined) {
      payload.pushNotificationsEnabled = opts.pushNotificationsEnabled;
    }
    await db.collection('users').doc(opts.uid).set(payload);
  }

  async function seedActivityAndPartner(activityId: string, partnerUid: string): Promise<void> {
    await db.collection('activities').doc(activityId).set({
      activityId,
      partnerId: partnerUid,
      title: `Activity ${activityId}`,
      sport: 'tennis',
      city: 'Geneva',
      address: 'Test address',
    });
    await db.collection('users').doc(partnerUid).set({
      uid: partnerUid,
      email: `${partnerUid}@partner.local`,
      displayName: 'Partner Test',
    });
  }

  async function seedBooking(opts: {
    bookingId: string;
    userId: string;
    activityId: string;
    partnerId: string;
    sessionDateMs: number;
  }): Promise<void> {
    await db.collection('bookings').doc(opts.bookingId).set({
      bookingId: opts.bookingId,
      userId: opts.userId,
      userName: opts.userId,
      matchId: 'match_x',
      activityId: opts.activityId,
      partnerId: opts.partnerId,
      sport: 'tennis',
      ticketType: 'solo',
      sessionDate: Timestamp.fromMillis(opts.sessionDateMs),
      status: 'confirmed',
      transactionId: 'tx_x',
      amount: 2500,
      currency: 'CHF',
      creditsUsed: 0,
      sessionId: `session_${opts.bookingId}`,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  async function clearAll(): Promise<void> {
    for (const col of ['bookings', 'users', 'activities']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
    mockMessaging.reset();
    resetResend();
  }

  const NOW = Date.now();
  const PARTNER = 'partner_push';
  const ACTIVITY = 'act_push';

  // ===================================================================
  // PUSH3 review-reminder : user fcmToken + opt-in → push, email skipped
  // ===================================================================
  section('PUSH3 review-reminder user fcmToken + opt-in → push appelé + email skipped (Q3=B)');
  {
    await clearAll();
    await seedUser({ uid: 'user_push3', email: 'p3@test.local', fcmToken: 'fcm_p3' });
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_p3',
      userId: 'user_push3',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000, // -50h within (-72h, -48h) reviewReminder window
    });

    const res = await callReviewReminderCron();
    if (res.status === 200 && (res.body.sent as number) === 1) {
      pass('PUSH3 cron 200 sent=1');
    } else {
      fail('PUSH3 cron result', res);
    }
    if (mockMessaging.sendCalls.length === 1) {
      pass('PUSH3 messaging.send called 1× (push)');
    } else {
      fail('PUSH3 push calls', mockMessaging.sendCalls.length);
    }
    if (sentMockResend.length === 0) {
      pass('PUSH3 zéro Resend call (email skipped — Q3=B push delivered)');
    } else {
      fail('PUSH3 unexpected email', sentMockResend);
    }
    const snap = await db.collection('bookings').doc('b_p3').get();
    if (snap.data()?.reviewReminderSent === true) {
      pass('PUSH3 booking.reviewReminderSent=true persisted');
    } else {
      fail('PUSH3 flag', snap.data());
    }
  }

  // ===================================================================
  // PUSH4 review-reminder : user sans fcmToken → email fallback
  // ===================================================================
  section('PUSH4 review-reminder user sans fcmToken → email fallback (legacy)');
  {
    await clearAll();
    await seedUser({ uid: 'user_push4', email: 'p4@test.local' /* no fcmToken */ });
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_p4',
      userId: 'user_push4',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000,
    });

    const res = await callReviewReminderCron();
    if (res.status === 200 && (res.body.sent as number) === 1) {
      pass('PUSH4 cron 200 sent=1');
    } else {
      fail('PUSH4 cron result', res);
    }
    if (mockMessaging.sendCalls.length === 0) {
      pass('PUSH4 zéro push call (no fcmToken)');
    } else {
      fail('PUSH4 unexpected push', mockMessaging.sendCalls);
    }
    if (sentMockResend.length === 1) {
      pass('PUSH4 email fallback envoyé (Q3=B legacy)');
    } else {
      fail('PUSH4 email count', sentMockResend);
    }
  }

  // ===================================================================
  // PUSH4b user fcmToken + opt-out → email fallback
  // ===================================================================
  section('PUSH4b user fcmToken + pushNotificationsEnabled=false → email fallback');
  {
    await clearAll();
    await seedUser({
      uid: 'user_push4b',
      email: 'p4b@test.local',
      fcmToken: 'fcm_optout',
      pushNotificationsEnabled: false, // opt-out explicit
    });
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_p4b',
      userId: 'user_push4b',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000,
    });

    const res = await callReviewReminderCron();
    if ((res.body.sent as number) === 1 && mockMessaging.sendCalls.length === 0 && sentMockResend.length === 1) {
      pass('PUSH4b opt-out → push skipped + email fallback');
    } else {
      fail('PUSH4b', { res: res.body, push: mockMessaging.sendCalls.length, email: sentMockResend.length });
    }
  }

  // ===================================================================
  // PUSH4c push fail → fallback email auto
  // ===================================================================
  section('PUSH4c push fail (token invalid) → fallback email auto');
  {
    await clearAll();
    await seedUser({
      uid: 'user_push4c',
      email: 'p4c@test.local',
      fcmToken: 'fcm_p4c_bad',
    });
    mockMessaging.failOnToken.add('fcm_p4c_bad');
    mockMessaging.errorCodeForToken.set('fcm_p4c_bad', 'messaging/invalid-registration-token');
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_p4c',
      userId: 'user_push4c',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000,
    });

    const res = await callReviewReminderCron();
    if (mockMessaging.sendCalls.length === 1 && sentMockResend.length === 1) {
      pass('PUSH4c push attempted then email fallback (best-effort)');
    } else {
      fail('PUSH4c', { push: mockMessaging.sendCalls.length, email: sentMockResend.length });
    }
    if ((res.body.sent as number) === 1) {
      pass('PUSH4c sent=1 (single delivery via email fallback)');
    } else {
      fail('PUSH4c sent', res.body);
    }
  }

  // ===================================================================
  // Bonus session-reminders J-1 push-first
  // ===================================================================
  section('Bonus session-reminders J-1 user fcmToken → push J-1 + email skipped');
  {
    await clearAll();
    await seedUser({
      uid: 'user_sr_push',
      email: 'srp@test.local',
      fcmToken: 'fcm_sr_push',
    });
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_sr_push',
      userId: 'user_sr_push',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW + 24 * 60 * 60 * 1000, // J-1 window 18-30h
    });

    const res = await callSessionRemindersCron();
    const j = res.body.jMinus1 as { sent: number };
    if (j?.sent === 1) {
      pass('Bonus session-reminders J-1 sent=1');
    } else {
      fail('Bonus J-1 sent', j);
    }
    if (mockMessaging.sendCalls.length === 1) {
      pass('Bonus session-reminders J-1 push appelé');
    } else {
      fail('Bonus push calls', mockMessaging.sendCalls.length);
    }
    if (sentMockResend.length === 0) {
      pass('Bonus session-reminders J-1 email skipped (push delivered)');
    } else {
      fail('Bonus unexpected email', sentMockResend);
    }
    const sentMsg = mockMessaging.sendCalls[0]?.message;
    if (sentMsg?.notification?.title?.toLowerCase().includes('demain')) {
      pass('Bonus session-reminders J-1 push title contient "demain"');
    } else {
      fail('Bonus push title', sentMsg?.notification);
    }
  }

  // Cleanup
  __setMessagingForTesting(null);
  __setResendForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Push Notifications (PUSH1-PUSH4 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
