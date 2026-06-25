/**
 * BUG #36 COMMIT 4 — POST /api/chat/send-duo-invite
 *
 * Mode Duo : sender paie 2 places via Stripe Checkout. Après confirmation
 * paiement, le webhook handleSessionPayment :
 *  - Crée 2 bookings (sender + invitee via metadata.inviteeUid, réuse fix
 *    Phase 9.5 c47 BUG B)
 *  - Crée le message activity_invite via Admin SDK (mode='duo' +
 *    sponsorPaidAt=now + inviteStatus='pending')
 *
 * Si paiement cancel/fail → no webhook fire → no message + no booking
 * (décision Q-D : abort total).
 *
 * Stripe Checkout pattern aligné `/api/checkout` mode='session' :
 *  - Stripe Connect destination charge (transfer_data + application_fee)
 *  - payment_method_types: ['card', 'twint']
 *  - line_items: 1× (price × 2 seats)
 *  - metadata: complete pour webhook (mode='duo_invite' + activityInvite*
 *    fields pour création du message dénormalisé)
 *
 * @module
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';
import { getSharedStripe } from '@/lib/stripe/sharedStripe';
import { safeStripeProductName } from '@/lib/stripe/safeProductName';
import { computePricingTier, isSessionBookable } from '@/services/firestore';
import { resolvePaymentMethodTypes } from '@/lib/payment/methodResolver';
import type { Session, Activity, PricingTierKind } from '@/types/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;
async function getAdminDb() {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]) });
    } else {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'spordateur-claude',
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

interface BodyShape {
  matchId?: string;
  senderUid?: string;
  receiverUid?: string;
  activityId?: string;
  activityTitle?: string;
  activityCity?: string;
  activitySport?: string;
  activityImageUrl?: string;
}

/** Query Admin SDK : next future session pour activity (réuse logique
 *  getNextFutureSessionForActivity côté Web SDK). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNextFutureSessionAdmin(db: any, activityId: string): Promise<{ sessionId: string; session: Session } | null> {
  const { Timestamp } = await import('firebase-admin/firestore');
  const nowTs = Timestamp.fromMillis(Date.now());
  try {
    const snap = await db
      .collection('sessions')
      .where('activityId', '==', activityId)
      .where('startAt', '>', nowTs)
      .orderBy('startAt', 'asc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { sessionId: snap.docs[0].id, session: snap.docs[0].data() as Session };
  } catch (err) {
    console.warn('[send-duo-invite] index pas prêt, fallback', err);
    const snap = await db.collection('sessions').where('activityId', '==', activityId).limit(20).get();
    const nowMs = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const futures = snap.docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => ({ id: d.id, data: d.data() as Session }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((s: any) => s.data.startAt && s.data.startAt.toMillis() > nowMs);
    if (futures.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    futures.sort((a: any, b: any) => a.data.startAt.toMillis() - b.data.startAt.toMillis());
    return { sessionId: futures[0].id, session: futures[0].data };
  }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as BodyShape;
    if (!body.matchId || !body.senderUid || !body.receiverUid || !body.activityId) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'matchId, senderUid, receiverUid, activityId requis' },
        { status: 400 },
      );
    }
    // BUG hotfix : activityTitle accepté vide, fallback côté server (le doc
    // Firestore activity peut avoir title manquant — webhook utilisera la
    // valeur dénormalisée via metadata.activityInviteActivityTitle).
    const safeActivityTitle = (body.activityTitle ?? '').trim() || 'Activité';
    if (body.senderUid !== uid) {
      return NextResponse.json({ error: 'forbidden', detail: 'senderUid != auth uid' }, { status: 403 });
    }
    if (body.senderUid === body.receiverUid) {
      return NextResponse.json({ error: 'invalid-input', detail: 'self-invite' }, { status: 400 });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe non configuré' }, { status: 503 });
    }

    const db = await getAdminDb();

    // 1. Resolve next future session for activity
    const next = await getNextFutureSessionAdmin(db, body.activityId);
    if (!next) {
      return NextResponse.json(
        { error: 'no-future-session', detail: 'Aucune session future pour cette activité' },
        { status: 409 },
      );
    }
    const { sessionId, session } = next;

    if (!session.pricingTiers || session.pricingTiers.length === 0) {
      return NextResponse.json(
        { error: 'session-no-pricing', detail: 'Pas de tarification configurée' },
        { status: 400 },
      );
    }
    const now = new Date();
    if (!isSessionBookable(session, now)) {
      return NextResponse.json(
        { error: 'session-not-bookable', detail: `status=${session.status}, ${session.currentParticipants}/${session.maxParticipants}` },
        { status: 409 },
      );
    }

    // 2. Compute tier + price server-side (anti-cheat)
    const { tier, price } = computePricingTier(session, now);

    // 3. Read activity for chatCreditsBundle
    const activitySnap = await db.collection('activities').doc(body.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() as Activity;
    const bundleCredits = activity.chatCreditsBundle ?? 50;

    // 4. Stripe Connect setup (réutilise pattern /api/checkout)
    const { getPartnerStripeAccount, ConnectError, assertConnectChargesEnabled } = await import(
      '@/lib/stripe/connectHelpers'
    );
    let partnerStripeAccount: string;
    try {
      partnerStripeAccount = await getPartnerStripeAccount(session.partnerId);
      await assertConnectChargesEnabled(partnerStripeAccount);
    } catch (err) {
      if (err instanceof ConnectError) {
        return NextResponse.json(
          { error: err.code, partnerId: session.partnerId },
          { status: 412 },
        );
      }
      throw err;
    }

    const seats = 2; // Duo = sender + invitee
    const unitAmount = price * seats;
    const grantedCredits = bundleCredits * seats;

    const { getApplicationFeePct } = await import('@/lib/invites/splitMath');
    const feePct = getApplicationFeePct();
    const applicationFeeAmount = Math.round((unitAmount * feePct) / 100);

    // 5. Build Stripe Checkout session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
    const successUrl = `${baseUrl}/chat?match=${encodeURIComponent(body.matchId)}&duoInviteSuccess=true`;
    const cancelUrl = `${baseUrl}/chat?match=${encodeURIComponent(body.matchId)}&duoInviteCancelled=true`;

    const tierLabel: Record<PricingTierKind, string> = {
      early: 'Early Bird', standard: 'Standard', last_minute: 'Last Minute',
    };

    // TODO(twint): le resolver force 'card' tant que TWINT n'est pas éligible côté
    // Stripe — il renverra de nouveau ['card', 'twint'] à la réactivation.
    const paymentMethodTypes = resolvePaymentMethodTypes('all'); // → ['card']

    const stripe = await getSharedStripe();
    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: paymentMethodTypes,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: 'chf',
            product_data: {
              // Anti-régression : safeStripeProductName garantit un name non-vide
              // même si session.title est vide (cf. lib/stripe/safeProductName).
              name: `${safeStripeProductName({
                title: session.title,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                name: activity.title || (activity as any).name || safeActivityTitle,
              })} (Duo — 2 places)`,
              description: `${tierLabel[tier]} • 2 places • ${grantedCredits} crédits chat inclus • Invitation à ${safeActivityTitle}`,
              images: ['https://spordateur.com/logo.png'],
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        transfer_data: { destination: partnerStripeAccount },
        application_fee_amount: applicationFeeAmount,
      },
      metadata: {
        // Champs mode='session' classiques (réuse webhook handleSessionPayment)
        mode: 'session',
        sessionId,
        userId: body.senderUid,
        matchId: body.matchId,
        tier,
        amount: String(unitAmount),
        seats: String(seats),
        isDuoTicket: 'true',
        inviteeUid: body.receiverUid, // Bookings 2e place auto via fix #c47
        activityId: session.activityId,
        partnerId: session.partnerId,
        bundleCredits: String(grantedCredits),
        applicationFeeAmount: String(applicationFeeAmount),
        partnerStripeAccount,
        paymentMethodPreference: 'all',
        // BUG #36 C4 — Marker pour webhook : create message activity_invite post-bookings
        activityInviteMatchId: body.matchId,
        activityInviteSenderUid: body.senderUid,
        activityInviteReceiverUid: body.receiverUid,
        activityInviteActivityTitle: safeActivityTitle.slice(0, 200), // Stripe metadata 500 chars max
        activityInviteActivityCity: (body.activityCity || '').slice(0, 100),
        activityInviteActivitySport: (body.activitySport || '').slice(0, 100),
        activityInviteActivityImageUrl: (body.activityImageUrl || '').slice(0, 400),
      },
    });

    return NextResponse.json({ url: stripeSession.url, sessionId: stripeSession.id }, { status: 200 });
  } catch (err) {
    console.error('[/api/chat/send-duo-invite] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
