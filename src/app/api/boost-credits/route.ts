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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Tarification crédits (exporté pour tests + UI)
// =====================================================================
export const BOOST_CREDITS_COST: Record<string, number> = {
  '24h': 30,
  '3d': 70,
  '7d': 100,
};

export const BOOST_DURATION_HOURS: Record<string, number> = {
  '24h': 24,
  '3d': 72,
  '7d': 168,
};

/** Coût en crédits pour une durée donnée. Throw si durée invalide. */
export function computeBoostCost(duration: string): number {
  const cost = BOOST_CREDITS_COST[duration];
  if (!cost) {
    throw new Error(`Invalid boost duration: ${duration}`);
  }
  return cost;
}

/** Taux de conversion CHF/crédit (cohérent bundle Phase 3 : 50 crédits = 25 CHF). */
const CHF_PER_CREDIT = 0.5;

// =====================================================================
// Lazy Admin SDK init (cohérent pattern admin routes)
// =====================================================================
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
    const partnerId = (body?.partnerId as string) || uid;
    const duration = body?.duration as string;
    const city = (body?.city as string) || '';
    const country = (body?.country as string) || '';

    if (!duration || !BOOST_CREDITS_COST[duration]) {
      return NextResponse.json(
        { error: 'invalid-input', detail: `duration must be one of: ${Object.keys(BOOST_CREDITS_COST).join(', ')}` },
        { status: 400 },
      );
    }
    if (!city) {
      return NextResponse.json({ error: 'invalid-input', detail: 'city required' }, { status: 400 });
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

      // Idempotence : aucun boost actif simultané (active=true + expiresAt>now)
      // pour ce partnerId. Évite qu'un partner pile up 3 boosts d'un coup.
      const now = Date.now();
      const activeBoostsSnap = await tx.get(
        boostsCol.where('partnerId', '==', partnerId).where('active', '==', true),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasActive = activeBoostsSnap.docs.some((d: any) => {
        const exp = d.data().expiresAt;
        // Timestamp Admin SDK : toMillis() ; Date legacy : getTime()
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
          detail: 'Un boost est déjà actif pour ce partenaire. Attends son expiration.',
        } as const;
      }

      // Debit credits.
      tx.update(userRef, { credits: FieldValue.increment(-cost) });

      // Create boost doc (server-side, source de vérité).
      const boostRef = boostsCol.doc();
      tx.set(boostRef, {
        boostId: boostRef.id,
        partnerId,
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
