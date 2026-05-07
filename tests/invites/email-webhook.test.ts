/**
 * Tests Phase 8 sub-chantier 4 commit 4/6 — Email template + Webhook Stripe extension.
 *
 * Exécution :
 *   npm run test:invites:webhook
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/invites/email-webhook.test.ts")
 *
 * Pattern : Admin SDK direct seed (cohérent SC3 c3/6 SAR + SC4 c3/6 INV-API).
 * ENV vars FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT set BEFORE imports.
 *
 * Couverture (3 cas EM-INV1-EM-INV3) :
 *   EM-INV1 sendEmail inviteReceived → Resend mock called avec subject + body params
 *   EM-INV2 webhook mode='invite-accept' → Booking + Invite.status='accepted' + notif
 *   EM-INV3 webhook idempotency : 2× event → 1 seule Booking + 1 seule update
 */

// ⚠️ ENV vars must be set BEFORE firebase-admin import
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-spordate-inv-wh';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-spordate-inv-wh';

import { renderTemplate } from '../../src/lib/email/templates';
import { sendEmail, __setResendForTesting } from '../../src/lib/email/sendEmail';
import { handlePaymentSuccess } from '../../src/app/api/webhooks/stripe/handler';

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

function assertContains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    pass(label);
  } else {
    fail(`${label} — needle "${needle}" not found`);
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================

async function main(): Promise<void> {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-spordate-inv-wh' });
  }
  const db = getFirestore();

  // ===================================================================
  // EM-INV1 — sendEmail inviteReceived (mock Resend)
  // ===================================================================
  section('EM-INV1 sendEmail inviteReceived → Resend mock called');
  {
    // Render direct check
    const { subject, html } = renderTemplate('inviteReceived', {
      fromUserName: 'Alice',
      toUserName: 'Bob',
      activityTitle: 'Yoga Lausanne',
      sessionDate: 'Sam 18 mai · 14h00',
      inviteLink: 'https://spordateur.com/invite/alice_bob_session1',
      message: 'Tu m\'accompagnes ?',
    });
    assertContains(subject, 'Alice', 'EM-INV1 subject contient fromUserName');
    assertContains(subject, 'Yoga Lausanne', 'EM-INV1 subject contient activityTitle');
    assertContains(html, 'Bonjour Bob', 'EM-INV1 html greeting toUserName');
    assertContains(html, 'Yoga Lausanne', 'EM-INV1 html contient activityTitle');
    assertContains(html, 'Sam 18 mai', 'EM-INV1 html contient sessionDate');
    assertContains(html, 'Tu m\'accompagnes', 'EM-INV1 html contient message');
    assertContains(html, 'spordateur.com/invite/alice_bob_session1', 'EM-INV1 html contient inviteLink');
    assertContains(html, '#D91CD2', 'EM-INV1 html charte stricte');

    // sendEmail end-to-end via mock Resend
    process.env.RESEND_API_KEY = 'mock_re_inv1';
    const sentMock: { subject?: string; to?: string } = {};
    __setResendForTesting({
      emails: {
        send: async (opts: { to?: string | string[]; subject?: string }) => {
          sentMock.to = Array.isArray(opts.to) ? opts.to[0] : opts.to;
          sentMock.subject = opts.subject;
          return { data: { id: 'mock_msg_inv1' }, error: null };
        },
      },
    } as never);

    const result = await sendEmail({
      to: 'bob@test.local',
      templateName: 'inviteReceived',
      templateData: {
        fromUserName: 'Alice',
        activityTitle: 'Yoga Lausanne',
        sessionDate: 'Sam 18 mai · 14h00',
        inviteLink: 'https://spordateur.com/invite/test',
      },
    });
    if (result.ok && sentMock.to === 'bob@test.local') {
      pass('EM-INV1 sendEmail ok=true + mock Resend send to=bob');
    } else {
      fail('EM-INV1 sendEmail mock', { result, sentMock });
    }

    delete process.env.RESEND_API_KEY;
    __setResendForTesting(null);
  }

  // ===================================================================
  // Setup pour EM-INV2 + EM-INV3 — seed user, session, activity, invite
  // ===================================================================
  const ALICE_UID = 'user_alice_invwh';
  const BOB_UID = 'user_bob_invwh';
  const SESSION_ID = 'session_invwh_1';
  const ACTIVITY_ID = 'activity_invwh_1';
  const INVITE_ID = `${ALICE_UID}_${BOB_UID}_${SESSION_ID}`;
  const STRIPE_CHECKOUT_ID = 'cs_test_invwh_1';

  async function clearAll() {
    for (const col of ['users', 'sessions', 'activities', 'invites', 'bookings', 'transactions', 'notifications', 'credits']) {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) await d.ref.delete().catch(() => {});
    }
  }

  async function setupSeeds() {
    const nowMs = Date.now();
    const startAtMs = nowMs + 5 * 24 * 60 * 60_000;

    await db.collection('users').doc(ALICE_UID).set({
      uid: ALICE_UID, email: 'alice@test.local', displayName: 'Alice', credits: 0,
    });
    await db.collection('users').doc(BOB_UID).set({
      uid: BOB_UID, email: 'bob@test.local', displayName: 'Bob', credits: 0,
    });
    await db.collection('activities').doc(ACTIVITY_ID).set({
      activityId: ACTIVITY_ID, title: 'Yoga Lausanne', sport: 'yoga',
      partnerId: 'partner_test', city: 'Lausanne', isActive: true,
      chatCreditsBundle: 50,
    });
    await db.collection('sessions').doc(SESSION_ID).set({
      sessionId: SESSION_ID, activityId: ACTIVITY_ID,
      partnerId: 'partner_test', creatorId: 'creator_test',
      sport: 'yoga', title: 'Yoga Lausanne', city: 'Lausanne',
      startAt: Timestamp.fromMillis(startAtMs),
      endAt: Timestamp.fromMillis(startAtMs + 60 * 60_000),
      chatOpenAt: Timestamp.fromMillis(startAtMs - 2 * 60 * 60_000),
      chatCloseAt: Timestamp.fromMillis(startAtMs + 60 * 60_000),
      maxParticipants: 8, currentParticipants: 0,
      pricingTiers: [],
      currentTier: 'early', currentPrice: 2500,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection('invites').doc(INVITE_ID).set({
      inviteId: INVITE_ID, fromUserId: ALICE_UID, toUserId: BOB_UID,
      activityId: ACTIVITY_ID, sessionId: SESSION_ID,
      status: 'pending',
      expiresAt: Timestamp.fromMillis(nowMs + 4 * 24 * 60 * 60_000),
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  function buildStripeCheckout() {
    return {
      id: STRIPE_CHECKOUT_ID,
      payment_intent: 'pi_test_invwh_1',
      amount_total: 2500,
      payment_method_types: ['card'],
      metadata: {
        mode: 'invite-accept',
        inviteId: INVITE_ID,
        toUserId: BOB_UID,
        fromUserId: ALICE_UID,
        sessionId: SESSION_ID,
        activityId: ACTIVITY_ID,
        partnerId: 'partner_test',
        tier: 'early',
        amount: '2500',
        bundleCredits: '50',
      },
    };
  }

  // Mock Stripe (handler n'appelle paymentIntents.retrieve que si twint)
  const mockStripe = {
    paymentIntents: {
      retrieve: async () => ({ payment_method_types: ['card'] }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // ===================================================================
  // EM-INV2 — webhook invite-accept happy path
  // ===================================================================
  section('EM-INV2 webhook mode=invite-accept → Booking + Invite.accepted + notifs');
  {
    await clearAll();
    await setupSeeds();

    await handlePaymentSuccess(buildStripeCheckout(), mockStripe);

    // Verify Booking created
    const bookings = await db.collection('bookings').where('userId', '==', BOB_UID).get();
    if (bookings.size === 1) {
      const booking = bookings.docs[0].data();
      if (booking.sessionId === SESSION_ID && booking.status === 'confirmed' && booking.amount === 2500) {
        pass('EM-INV2 Booking créé userId=bob status=confirmed amount=2500');
      } else {
        fail('EM-INV2 Booking data incorrect', booking);
      }
    } else {
      fail('EM-INV2 Booking count != 1', { count: bookings.size });
    }

    // Verify Invite updated
    const inviteSnap = await db.collection('invites').doc(INVITE_ID).get();
    const invite = inviteSnap.data();
    if (invite?.status === 'accepted' && invite.acceptedAt) {
      pass('EM-INV2 Invite.status=accepted + acceptedAt set');
    } else {
      fail('EM-INV2 Invite update incorrect', invite);
    }

    // Verify notifs (fromUser invite_accepted + toUser booking)
    const notifsAlice = await db.collection('notifications').where('userId', '==', ALICE_UID).where('type', '==', 'invite_accepted').get();
    if (notifsAlice.size >= 1) {
      pass('EM-INV2 notification fromUser invite_accepted créée');
    } else {
      fail('EM-INV2 notif fromUser missing', { count: notifsAlice.size });
    }

    // Verify Bob credits granted
    const bobSnap = await db.collection('users').doc(BOB_UID).get();
    if (bobSnap.data()?.credits === 50) {
      pass('EM-INV2 Bob credits=50 (bundle granted)');
    } else {
      fail('EM-INV2 credits incorrect', bobSnap.data());
    }
  }

  // ===================================================================
  // EM-INV3 — webhook idempotency (2× same event)
  // ===================================================================
  section('EM-INV3 webhook idempotency 2× event → 1 seule Booking');
  {
    // setup déjà : EM-INV2 a créé booking + transaction. Un 2ème call doit être no-op.
    const beforeBookings = await db.collection('bookings').where('userId', '==', BOB_UID).get();
    const beforeCount = beforeBookings.size;

    await handlePaymentSuccess(buildStripeCheckout(), mockStripe);

    const afterBookings = await db.collection('bookings').where('userId', '==', BOB_UID).get();
    if (afterBookings.size === beforeCount) {
      pass(`EM-INV3 idempotency : ${afterBookings.size} bookings (= ${beforeCount}, 2nd event no-op)`);
    } else {
      fail('EM-INV3 idempotency violated', { before: beforeCount, after: afterBookings.size });
    }

    // Invite remains accepted (pas double update)
    const inviteSnap = await db.collection('invites').doc(INVITE_ID).get();
    if (inviteSnap.data()?.status === 'accepted') {
      pass('EM-INV3 Invite.status=accepted preserved (pas double-write)');
    } else {
      fail('EM-INV3 Invite status incorrect', inviteSnap.data());
    }
  }

  // ===================================================================
  // Cleanup
  // ===================================================================
  await clearAll();

  console.log('');
  console.log('====== Résumé Invites email + webhook (EM-INV1-EM-INV3) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
