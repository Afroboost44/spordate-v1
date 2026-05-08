/**
 * Tests Phase 9 sub-chantier 3 commit 3/5 — UI opt-in/opt-out push notifications.
 *
 * Exécution :
 *   npm run test:notifications:push-opt-in
 *
 * Pattern : Admin SDK direct + DI seam mock messaging (cohérent SC3 c2/5 pattern).
 * Pour helper client-side `registerPushNotifications`, on stub global navigator/Notification/PushManager.
 *
 * Couverture (POI1-POI5) :
 *   POI1 UserProfile.pushNotificationsEnabled undefined → cron treats as opt-in (default-on)
 *   POI2 UserProfile.pushNotificationsEnabled=false → cron skip push (use email fallback)
 *   POI3 isPushSupported() : navigator.serviceWorker absent → false
 *   POI4 isPushSupported() : Notification absent → false
 *   POI5 isPushSupported() : PushManager absent (Safari iOS <16.4) → false (Q6=A silent skip)
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-poi';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-poi';
process.env.CRON_SECRET = 'test-cron-secret-poi';
process.env.RESEND_API_KEY = 'mock_re_poi';

import { POST as POSTReviewReminder } from '../../src/app/api/cron/review-reminder/route';
import { __setMessagingForTesting } from '../../src/lib/notifications/sendPushNotification';
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
// Mock FCM messaging (cohérent SC3 c2/5)
// =====================================================================

class MockMessaging {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public sendCalls: any[] = [];
  reset() {
    this.sendCalls = [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(message: any): Promise<string> {
    this.sendCalls.push({ message });
    return `mock_msg_${this.sendCalls.length}`;
  }
}
const mockMessaging = new MockMessaging();

// Mock Resend
interface MockResendCall {
  to: string;
}
const sentMockResend: MockResendCall[] = [];
function resetResend(): void {
  sentMockResend.length = 0;
  __setResendForTesting({
    emails: {
      send: async (opts: { to?: string | string[] }) => {
        sentMockResend.push({
          to: Array.isArray(opts.to) ? opts.to[0] : opts.to ?? '',
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
    authorization: 'Bearer test-cron-secret-poi',
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

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-poi' });
  }
  const db = getFirestore();

  __setMessagingForTesting(mockMessaging);
  resetResend();

  // Helper seeders
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
  const PARTNER = 'partner_poi';
  const ACTIVITY = 'act_poi';

  // ===================================================================
  // POI1 pushNotificationsEnabled undefined → default-on (push appelé)
  // ===================================================================
  section("POI1 pushNotificationsEnabled undefined → default-on (push appelé)");
  {
    await clearAll();
    await seedUser({
      uid: 'user_poi1',
      email: 'p1@test.local',
      fcmToken: 'fcm_p1',
      // pushNotificationsEnabled NOT set → undefined → default-on
    });
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_poi1',
      userId: 'user_poi1',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000,
    });

    const res = await callReviewReminderCron();
    if (res.status === 200 && (res.body.sent as number) === 1) {
      pass('POI1 cron 200 sent=1');
    } else {
      fail('POI1 cron', res);
    }
    if (mockMessaging.sendCalls.length === 1) {
      pass('POI1 push appelé (default-on undefined === true)');
    } else {
      fail('POI1 push calls', mockMessaging.sendCalls.length);
    }
    if (sentMockResend.length === 0) {
      pass('POI1 zéro Resend (push delivered)');
    } else {
      fail('POI1 unexpected email', sentMockResend);
    }
  }

  // ===================================================================
  // POI2 pushNotificationsEnabled=false → cron skip push, email fallback
  // ===================================================================
  section('POI2 pushNotificationsEnabled=false → cron skip push, email fallback');
  {
    await clearAll();
    await seedUser({
      uid: 'user_poi2',
      email: 'p2@test.local',
      fcmToken: 'fcm_p2_optout',
      pushNotificationsEnabled: false, // opt-out explicit
    });
    await seedActivityAndPartner(ACTIVITY, PARTNER);
    await seedBooking({
      bookingId: 'b_poi2',
      userId: 'user_poi2',
      activityId: ACTIVITY,
      partnerId: PARTNER,
      sessionDateMs: NOW - 50 * 60 * 60 * 1000,
    });

    const res = await callReviewReminderCron();
    if ((res.body.sent as number) === 1) {
      pass('POI2 sent=1');
    } else {
      fail('POI2 sent', res.body);
    }
    if (mockMessaging.sendCalls.length === 0) {
      pass('POI2 zéro push call (opt-out explicit)');
    } else {
      fail('POI2 unexpected push', mockMessaging.sendCalls);
    }
    if (sentMockResend.length === 1) {
      pass('POI2 email fallback envoyé');
    } else {
      fail('POI2 email count', sentMockResend);
    }
  }

  // ===================================================================
  // POI3-POI5 isPushSupported() — stub globalThis
  // ===================================================================
  section('POI3 isPushSupported() : navigator.serviceWorker absent → false');
  {
    // Test pure function logic via stub globals. Nous chargeons le module fresh
    // après chaque stub pour isoler.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const originalNavigator = g.navigator;
    const originalNotification = g.Notification;
    const originalPushManager = g.PushManager;
    const originalWindow = g.window;

    // Stub : window present, navigator absent
    g.window = {};
    g.navigator = undefined;
    g.Notification = function () {};
    g.PushManager = function () {};

    try {
      delete require.cache[require.resolve('../../src/lib/notifications/registerPush')];
    } catch {
      /* ESM context */
    }
    const { isPushSupported } = await import(
      '../../src/lib/notifications/registerPush?t=poi3' as string
    ).catch(async () => {
      // Fallback : re-import without query (cache may not differentiate)
      return await import('../../src/lib/notifications/registerPush');
    });

    if (isPushSupported() === false) {
      pass('POI3 navigator absent → isPushSupported=false');
    } else {
      fail('POI3 should be false', { result: isPushSupported() });
    }

    // Restore
    g.navigator = originalNavigator;
    g.Notification = originalNotification;
    g.PushManager = originalPushManager;
    g.window = originalWindow;
  }

  section('POI4 isPushSupported() : Notification absent → false');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const originalNavigator = g.navigator;
    const originalNotification = g.Notification;
    const originalPushManager = g.PushManager;
    const originalWindow = g.window;

    g.window = {};
    g.navigator = { serviceWorker: {} };
    g.Notification = undefined;
    g.PushManager = function () {};

    const { isPushSupported } = await import('../../src/lib/notifications/registerPush');

    if (isPushSupported() === false) {
      pass('POI4 Notification absent → isPushSupported=false');
    } else {
      fail('POI4 should be false', { result: isPushSupported() });
    }

    g.navigator = originalNavigator;
    g.Notification = originalNotification;
    g.PushManager = originalPushManager;
    g.window = originalWindow;
  }

  section('POI5 isPushSupported() : PushManager absent (Safari iOS <16.4) → false (Q6=A)');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const originalNavigator = g.navigator;
    const originalNotification = g.Notification;
    const originalPushManager = g.PushManager;
    const originalWindow = g.window;

    g.window = {};
    g.navigator = { serviceWorker: {} };
    g.Notification = function () {};
    g.PushManager = undefined;

    const { isPushSupported } = await import('../../src/lib/notifications/registerPush');

    if (isPushSupported() === false) {
      pass('POI5 PushManager absent → isPushSupported=false (Q6=A silent skip)');
    } else {
      fail('POI5 should be false', { result: isPushSupported() });
    }

    g.navigator = originalNavigator;
    g.Notification = originalNotification;
    g.PushManager = originalPushManager;
    g.window = originalWindow;
  }

  // ===================================================================
  // Bonus : isPushSupported() en environnement Node (no window) → false
  // ===================================================================
  section('Bonus isPushSupported() en environnement Node (no window) → false');
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const originalWindow = g.window;
    g.window = undefined;

    const { isPushSupported } = await import('../../src/lib/notifications/registerPush');
    if (isPushSupported() === false) {
      pass('Bonus Node env (no window) → false (server-safe)');
    } else {
      fail('Bonus should be false', { result: isPushSupported() });
    }

    g.window = originalWindow;
  }

  // Cleanup
  __setMessagingForTesting(null);
  __setResendForTesting(null);
  await clearAll();

  console.log('');
  console.log('====== Résumé Push Opt-In (POI1-POI5 + bonus) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
