/**
 * Phase 9.5 c29b BUG FF — POST /api/boost-credits.
 *
 * Alternative au paiement Stripe : permet à un partner de payer un boost
 * en débitant ses crédits Spordate. Taux validé 0.50 CHF/crédit (cohérent
 * avec le bundle 50 crédits = 25 CHF de Phase 3) :
 *   24h (15 CHF) =  30 crédits
 *    3d (35 CHF) =  70 crédits
 *    7d (50 CHF) = 100 crédits
 *
 * Pipeline (atomic via runTransaction) :
 *   1. Verify Bearer ID token → uid
 *   2. Body { partnerId, duration, city, country }
 *   3. Compute cost via computeBoostCost(duration) (throw si duration invalide)
 *   4. runTransaction :
 *      a. Read users/{uid}.credits — return 400 si < cost
 *      b. Idempotence : check qu'aucun boost actif (active=true + expiresAt>now)
 *         pour ce partnerId — return 409 si déjà boosté (évite double-boost)
 *      c. users/{uid}.credits = increment(-cost)
 *      d. Create boosts/{auto} avec paidWith='credits', creditsSpent, amountChf
 *      e. Create transactions/{auto} type='boost_credits', creditsGranted=-cost
 *   5. Return { success, boostId, creditsRemaining, expiresAt }
 *
 * Aucun webhook Stripe nécessaire — le débit + activation sont synchrones,
 * idempotents (étape b), et tracés (transactions/).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
// Phase 9.5 c30 — constants déplacées dans src/lib/billing/boostCredits.ts
// (contrainte Next.js 15 : route files ne peuvent pas exporter autre chose que
// POST/GET/etc). Les tests + UI consomment depuis @/lib/billing/boostCredits.
import {
  BOOST_CREDITS_COST,
  BOOST_DURATION_HOURS,
  CHF_PER_CREDIT,
  computeBoostCost,
} from '@/lib/billing/boostCredits';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent pattern admin routes)
// =====================================================================
// =====================================================================
// POST handler
// =====================================================================
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    // Phase 9.5 c33 BUG#4 — Forcer partnerId = uid (Bearer auth) au lieu de body.partnerId.
    // Cohérent avec Activity.partnerId écrit côté partner/offers (= user.uid) et empêche
    // un partner d'écrire un boost pour un autre partner. Le client pouvait envoyer un
    // partner doc id != user.uid (cas Partner créé en flow séparé), provoquant
    // un mismatch silencieux côté lecture (/partner/boost et /discovery).
    const partnerId = uid;
    const duration = body?.duration as string;
    const city = (body?.city as string) || '';
    const country = (body?.country as string) || '';
    // BUG #69 — activityId obligatoire (1 boost = 1 activité ciblée).
    const activityId = (body?.activityId as string) || '';

    if (!duration || !BOOST_CREDITS_COST[duration]) {
      return NextResponse.json(
        { error: 'invalid-input', detail: `duration must be one of: ${Object.keys(BOOST_CREDITS_COST).join(', ')}` },
        { status: 400 },
      );
    }
    if (!city) {
      return NextResponse.json({ error: 'invalid-input', detail: 'city required' }, { status: 400 });
    }
    if (!activityId) {
      return NextResponse.json(
        { error: 'activity-required', detail: 'Choisis l\'activité à booster.' },
        { status: 400 },
      );
    }

    const cost = computeBoostCost(duration);
    const hours = BOOST_DURATION_HOURS[duration];
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    const userRef = db.collection('users').doc(uid);
    const boostsCol = db.collection('boosts');
    const txnsCol = db.collection('transactions');

    // Atomic : credit check + idempotence + debit + boost creation + log.
    // `db` est typé `any` (cf. lazy admin init pattern), donc tx/refs aussi.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await db.runTransaction(async (tx: any) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { error: 'user-not-found', status: 404 } as const;
      }
      const credits = (userSnap.data()?.credits as number | undefined) ?? 0;
      if (credits < cost) {
        return {
          error: 'insufficient-credits',
          status: 400,
          have: credits,
          need: cost,
        } as const;
      }

      // BUG #69 — Validation : l'activity existe et appartient au partner.
      const activityRef = db.collection('activities').doc(activityId);
      const activitySnap = await tx.get(activityRef);
      if (!activitySnap.exists) {
        return { error: 'activity-not-found', status: 404 } as const;
      }
      if (activitySnap.data()?.partnerId !== partnerId) {
        return {
          error: 'activity-not-owned',
          status: 403,
          detail: 'Cette activité ne t\'appartient pas.',
        } as const;
      }

      // BUG #69 — Idempotence : aucun boost actif pour (partnerId, activityId, city).
      // Un partner peut désormais avoir plusieurs boosts simultanés pour la même ville,
      // tant qu'ils ciblent des activités différentes.
      const now = Date.now();
      const activeBoostsSnap = await tx.get(
        boostsCol
          .where('partnerId', '==', partnerId)
          .where('active', '==', true)
          .where('city', '==', city),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasActive = activeBoostsSnap.docs.some((d: any) => {
        const data = d.data();
        // Si le boost existant cible une AUTRE activity (ou pas d'activityId =
        // legacy boost qui boost tout le compte), on autorise le nouveau boost.
        if (data.activityId && data.activityId !== activityId) return false;
        const exp = data.expiresAt;
        const expMs =
          typeof exp?.toMillis === 'function'
            ? exp.toMillis()
            : exp instanceof Date
              ? exp.getTime()
              : 0;
        return expMs > now;
      });
      if (hasActive) {
        return {
          error: 'already-boosted',
          status: 409,
          detail: `Cette activité est déjà boostée pour ${city}. Attends son expiration ou choisis une autre activité/ville.`,
        } as const;
      }

      // Debit credits.
      tx.update(userRef, { credits: FieldValue.increment(-cost) });

      // Create boost doc (server-side, source de vérité).
      const boostRef = boostsCol.doc();
      tx.set(boostRef, {
        boostId: boostRef.id,
        partnerId,
        activityId, // BUG #69 — persisté pour filtre Discovery par activité
        city,
        country,
        duration,
        active: true,
        paidWith: 'credits',
        creditsSpent: cost,
        amountChf: cost * CHF_PER_CREDIT, // pour analytics (cohérent ratio bundle)
        expiresAt: Timestamp.fromDate(expiresAt),
        createdAt: FieldValue.serverTimestamp(),
      });

      // Log transaction (debit crédits, traçabilité).
      const txnRef = txnsCol.doc();
      tx.set(txnRef, {
        transactionId: txnRef.id,
        userId: uid,
        type: 'boost_credits',
        creditsGranted: -cost, // négatif = débit (cohérent autoCorrector.ts)
        amountChf: cost * CHF_PER_CREDIT,
        relatedBoostId: boostRef.id,
        status: 'succeeded',
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true as const,
        boostId: boostRef.id,
        creditsRemaining: credits - cost,
      };
    });

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error, ...(('detail' in result) && { detail: result.detail }), ...(('have' in result) && { have: result.have, need: result.need }) },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        success: true,
        boostId: result.boostId,
        creditsRemaining: result.creditsRemaining,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/boost-credits] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
