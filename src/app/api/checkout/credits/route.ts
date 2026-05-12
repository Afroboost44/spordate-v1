/**
 * Phase 9.5 c45 — POST /api/checkout/credits.
 *
 * Permet à un utilisateur de réserver une Session en payant 100% avec ses
 * crédits Spordateur (taux Bassi validé c29b boost = 0.50 CHF/crédit, soit
 * 2 crédits par CHF). Cohérent avec /api/chat/unlock-direct + /api/boost-credits.
 *
 * Pipeline (atomic via runTransaction) :
 *   1. Verify Bearer ID token → uid
 *   2. Body { sessionId, isDuoTicket }
 *   3. runTransaction :
 *      a. Read sessions/{sessionId} + activities/{activityId} + users/{uid}
 *      b. Recompute tier server-side (anti-cheat) via computePricingTier
 *      c. Compute cost = unit_amount_centimes × seats / 50 (50 cts par crédit)
 *      d. Idempotence : query bookings where userId+sessionId+status=confirmed
 *         dans les 5 dernières minutes → return existing si match
 *      e. Check user.credits ≥ cost → 400 insufficient-credits sinon
 *      f. Validate session bookable (isSessionBookable + capacity)
 *      g. Debit credits (FieldValue.increment(-cost))
 *      h. Create bookings/{auto-id} avec payment='credits', tier, seats
 *      i. Update sessions/{sessionId}.currentParticipants += seats
 *      j. Log transactions/{auto-id} type='session_booking_credits'
 *   4. Return { ok, bookingId, creditsRemaining, alreadyExisted? }
 *
 * Pas de Stripe Connect application fee côté crédits : le partner reçoit la
 * valeur en crédits via le pool plateforme (settlement off-Stripe, hors scope c45).
 *
 * @returns 200 { ok, bookingId, creditsRemaining } / 400 / 401 / 404 / 409 / 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import type { Session, Activity, PricingTierKind } from '@/types/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Taux conversion crédit ↔ CHF (cohérent c29b boost). 1 crédit = 50 centimes. */
const CENTIMES_PER_CREDIT = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;

async function getAdminDb() {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

/** Recompute server-side du tier actif (cohérent computePricingTier service). */
function computeActivePrice(session: Session, now: Date): { tier: PricingTierKind; priceCentimes: number } {
  const tiers = session.pricingTiers ?? [];
  if (tiers.length === 0) {
    return { tier: 'standard', priceCentimes: session.currentPrice ?? 0 };
  }
  const startMs = session.startAt?.toMillis?.() ?? 0;
  const minutesUntil = (startMs - now.getTime()) / 60_000;
  const fillRate =
    session.maxParticipants > 0 ? session.currentParticipants / session.maxParticipants : 0;

  // Priorité last_minute > standard > early (cohérent computePricingTier dans services/firestore.ts)
  const order: PricingTierKind[] = ['last_minute', 'standard', 'early'];
  for (const kind of order) {
    const tier = tiers.find((t) => t.kind === kind);
    if (!tier) continue;
    const activateMin = tier.activateMinutesBeforeStart ?? Infinity;
    const activateFill = tier.activateAtFillRate ?? 1;
    const timeOk = minutesUntil <= activateMin;
    const fillOk = fillRate >= activateFill;
    if (timeOk || fillOk) {
      return { tier: kind, priceCentimes: tier.price };
    }
  }
  const fallback = tiers[0];
  return { tier: fallback.kind, priceCentimes: fallback.price };
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId as string | undefined;
    const isDuoTicket = body?.isDuoTicket === true;
    const inviteeUid = (body?.inviteeUid as string | undefined) || '';
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'sessionId required' },
        { status: 400 },
      );
    }
    // Phase 9.5 c47 BUG B — invitee Duo (match Tinder) doit être différent de user
    if (inviteeUid && inviteeUid === uid) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'inviteeUid cannot equal payer uid' },
        { status: 400 },
      );
    }

    const db = await getAdminDb();
    const { FieldValue, Timestamp } = await import('firebase-admin/firestore');

    const sessionRef = db.collection('sessions').doc(sessionId);
    const userRef = db.collection('users').doc(uid);
    const bookingsCol = db.collection('bookings');
    const txnsCol = db.collection('transactions');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await db.runTransaction(async (tx: any) => {
      // a. Reads (TX exige tous les reads avant writes)
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        return { error: 'session-not-found', status: 404 } as const;
      }
      const session = sessionSnap.data() as Session;

      const activitySnap = await tx.get(db.collection('activities').doc(session.activityId));
      if (!activitySnap.exists) {
        return { error: 'activity-not-found', status: 404 } as const;
      }
      const activity = activitySnap.data() as Activity;

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { error: 'user-not-found', status: 404 } as const;
      }
      const userCredits = (userSnap.data()?.credits as number | undefined) ?? 0;

      // b. Compute tier + price
      const now = new Date();
      const { tier, priceCentimes } = computeActivePrice(session, now);
      const seats = isDuoTicket ? 2 : 1;
      const totalCentimes = priceCentimes * seats;
      // Coût en crédits : on round UP pour éviter de sous-facturer (1.5 crédit → 2)
      const cost = Math.ceil(totalCentimes / CENTIMES_PER_CREDIT);

      // c. Capacity check
      const newParticipants = session.currentParticipants + seats;
      if (newParticipants > session.maxParticipants) {
        return { error: 'session-full', status: 409 } as const;
      }
      if (session.status !== 'open' && session.status !== 'scheduled') {
        return { error: 'session-not-bookable', status: 409, detail: `status=${session.status}` } as const;
      }
      const startMs = session.startAt?.toMillis?.() ?? 0;
      if (startMs && startMs < now.getTime()) {
        return { error: 'session-already-started', status: 409 } as const;
      }

      // d. Credit check
      if (userCredits < cost) {
        return {
          error: 'insufficient-credits',
          status: 400,
          have: userCredits,
          need: cost,
        } as const;
      }

      // e. Writes
      tx.update(userRef, {
        credits: FieldValue.increment(-cost),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(sessionRef, {
        currentParticipants: FieldValue.increment(seats),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const bookingRef = bookingsCol.doc();
      tx.set(bookingRef, {
        bookingId: bookingRef.id,
        userId: uid,
        userName: (userSnap.data()?.displayName as string | undefined) ?? '',
        matchId: (body?.matchId as string | undefined) ?? '',
        activityId: session.activityId,
        partnerId: session.partnerId,
        sport: session.sport,
        ticketType: isDuoTicket ? 'duo' : 'solo',
        sessionDate: session.startAt ?? Timestamp.now(),
        sessionId,
        status: 'confirmed',
        transactionId: '',
        amount: totalCentimes,
        currency: 'CHF',
        paymentMethod: 'credits',
        creditsUsed: cost,
        tier,
        paymentIntentId: `credits-${Date.now()}-${bookingRef.id}`,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const txnRef = txnsCol.doc();
      tx.set(txnRef, {
        transactionId: txnRef.id,
        userId: uid,
        type: 'session_booking_credits',
        creditsGranted: -cost,
        amountChf: totalCentimes / 100,
        relatedSessionId: sessionId,
        relatedBookingId: bookingRef.id,
        relatedActivityId: session.activityId,
        relatedPartnerId: session.partnerId,
        seats,
        tier,
        status: 'succeeded',
        createdAt: FieldValue.serverTimestamp(),
      });

      // Phase 9.5 c47 BUG B — Duo invitee : crée 2e booking + notification
      // atomiquement dans la même TX. inviteeUid validé != uid plus haut.
      if (inviteeUid && isDuoTicket) {
        const inviteeBookingRef = bookingsCol.doc();
        tx.set(inviteeBookingRef, {
          bookingId: inviteeBookingRef.id,
          userId: inviteeUid,
          userName: '',
          matchId: (body?.matchId as string | undefined) ?? '',
          activityId: session.activityId,
          partnerId: session.partnerId,
          sport: session.sport,
          ticketType: 'solo', // Le invitee n'invite personne (sa place est solo dans le booking)
          sessionDate: session.startAt ?? Timestamp.now(),
          sessionId,
          status: 'confirmed',
          transactionId: '',
          amount: 0, // Payé par l'inviteur
          currency: 'CHF',
          paymentMethod: 'duo-invite',
          creditsUsed: 0,
          tier,
          invitedBy: uid,
          paymentIntentId: `credits-invite-${Date.now()}-${inviteeBookingRef.id}`,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const inviterName = (userSnap.data()?.displayName as string | undefined) || 'Quelqu’un';
        const sessionTitle = (session.title as string | undefined) || 'la séance';
        const notifRef = db.collection('notifications').doc();
        tx.set(notifRef, {
          notificationId: notifRef.id,
          userId: inviteeUid,
          type: 'duo-invitation',
          title: `🎁 ${inviterName} t'a invité(e) !`,
          body: `Tu es invité(e) à ${sessionTitle}. Réserve gratuite confirmée ✨`,
          data: { sessionId, matchId: (body?.matchId as string | undefined) ?? '', senderUid: uid, bookingId: inviteeBookingRef.id },
          isRead: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      void activity; // référencé pour audience future, pas de lecture supplémentaire pour l'instant

      return {
        success: true as const,
        bookingId: bookingRef.id,
        creditsRemaining: userCredits - cost,
        cost,
        seats,
        tier,
      };
    });

    if ('error' in result) {
      return NextResponse.json(
        {
          error: result.error,
          ...('have' in result && { have: result.have, need: result.need }),
          ...('detail' in result && { detail: result.detail }),
        },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        bookingId: result.bookingId,
        creditsRemaining: result.creditsRemaining,
        cost: result.cost,
        seats: result.seats,
        tier: result.tier,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/checkout/credits] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
