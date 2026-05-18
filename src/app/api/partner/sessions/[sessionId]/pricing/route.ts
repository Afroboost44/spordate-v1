/**
 * Fix B B2 — PATCH /api/partner/sessions/[sessionId]/pricing
 *
 * Permet au partenaire d'override le prix d'une session précise (ou de
 * réinitialiser depuis Activity.defaultPricingTiers).
 *
 * Pipeline :
 *  1. verifyAuth Bearer ID token → uid
 *  2. Load session by id (404 si absent)
 *  3. Verify ownership : session.partnerId === auth.uid (sinon 403)
 *  4. V9 freeze : si currentParticipants > 0 → 403 (rules firestore.rules
 *     bloquent déjà côté rules via validPricingTiersUpdate, mais on
 *     retourne un 403 explicite plutôt que de laisser le rules-denied
 *     remonter à l'utilisateur)
 *  5. Validate body : { useCustomPrice: boolean, customPriceCHF?: number 0..1000 }
 *  6. Build new pricingTiers via buildSessionPricingTiers (mode 'custom' ou
 *     'inherit') et update Admin SDK :
 *       - pricingTiers : new array
 *       - pricingMode  : 'custom' | 'inherit' (audit + UI badge)
 *       - updatedAt    : server timestamp
 *     (Pas de currentTier/currentPrice write — recomputé runtime via
 *     computePricingTier, rules les bloquent de toute façon.)
 *
 * Return : { ok, sessionId, mode, effectivePriceCHF }
 *
 * Codes d'erreur :
 *   401 unauthenticated
 *   403 forbidden (not owner | V9 freeze)
 *   404 session-not-found | activity-not-found (mode=inherit)
 *   400 invalid-input
 *   500 internal
 *
 * @module
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { buildSessionPricingTiers } from '@/lib/billing/sessionPricingTiers';
import type { Session, Activity } from '@/types/firestore';

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

interface BodyShape {
  useCustomPrice?: boolean;
  customPriceCHF?: number;
}

const MAX_PRICE_CHF = 1000;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      // Diagnostic log pour cas 401 mystérieux (env, expiration, aud mismatch)
      const authHeader = request.headers.get('authorization');
      console.warn('[/api/partner/sessions/.../pricing] verifyAuth returned null', {
        hasAuthHeader: !!authHeader,
        startsWithBearer: authHeader?.startsWith('Bearer ') ?? false,
        tokenLength: authHeader ? authHeader.slice(7).length : 0,
        projectIdEnv: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '(unset)',
        hasServiceAccountKey: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
      });
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'sessionId required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as BodyShape;
    if (typeof body.useCustomPrice !== 'boolean') {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'useCustomPrice must be boolean' },
        { status: 400 },
      );
    }

    let customPriceCHF: number | undefined;
    if (body.useCustomPrice) {
      const raw = body.customPriceCHF;
      if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw)) {
        return NextResponse.json(
          { error: 'invalid-input', detail: 'customPriceCHF must be a finite number when useCustomPrice=true' },
          { status: 400 },
        );
      }
      if (raw < 0 || raw > MAX_PRICE_CHF) {
        return NextResponse.json(
          { error: 'invalid-input', detail: `customPriceCHF out of range (0..${MAX_PRICE_CHF})` },
          { status: 400 },
        );
      }
      customPriceCHF = raw;
    }

    const db = await getAdminDb();

    // Load session
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const session = sessionSnap.data() as Session;

    // Ownership
    if (session.partnerId !== uid) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'session not owned by auth uid' },
        { status: 403 },
      );
    }

    // V9 freeze
    if ((session.currentParticipants ?? 0) > 0) {
      return NextResponse.json(
        { error: 'session-frozen', detail: 'session has bookings, price locked (V9 anti-cheat)' },
        { status: 403 },
      );
    }

    // Build new tiers
    let newTiers;
    let mode: 'custom' | 'inherit';
    let activityPriceCHF = 0;
    if (body.useCustomPrice) {
      mode = 'custom';
      newTiers = buildSessionPricingTiers({
        mode: 'custom',
        customPriceCHF,
        activityPriceCHF: 0,
      });
    } else {
      mode = 'inherit';
      // Load Activity pour récupérer defaultPricingTiers + price legacy
      const activitySnap = await db.collection('activities').doc(session.activityId).get();
      if (!activitySnap.exists) {
        return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
      }
      const activity = activitySnap.data() as Activity;
      activityPriceCHF = typeof activity.price === 'number' ? activity.price : 0;
      newTiers = buildSessionPricingTiers({
        mode: 'inherit',
        activityPricingTiers: activity.defaultPricingTiers,
        activityPriceCHF,
      });
    }

    const { FieldValue } = await import('firebase-admin/firestore');
    await sessionSnap.ref.update({
      pricingTiers: newTiers,
      pricingMode: mode,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Compute effective price (early tier = celui actif au moment de la
    // création/édition d'une session avant booking). En mode 'custom', les
    // 3 tiers sont identiques → effective = customPriceCHF.
    const earlyTier = newTiers.find((t) => t.kind === 'early');
    const effectivePriceCHF =
      mode === 'custom'
        ? (customPriceCHF ?? 0)
        : Math.round((earlyTier?.price ?? 0) / 100);

    return NextResponse.json(
      { ok: true, sessionId, mode, effectivePriceCHF },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/partner/sessions/[sessionId]/pricing] fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
