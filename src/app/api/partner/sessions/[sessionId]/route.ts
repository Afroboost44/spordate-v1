/**
 * Fix B Option 3 — PATCH + DELETE /api/partner/sessions/[sessionId]
 *
 * Remplace l'ancien /api/partner/sessions/[sessionId]/pricing/route.ts (B2)
 * en étendant le scope :
 *  - PATCH : update pricing (B2) ET/OU date+heure (Option 3)
 *  - DELETE : hard delete avec V9 freeze check
 *
 * Body PATCH : { useCustomPrice?: boolean, customPriceCHF?: number,
 *                startAtMillis?: number }
 * Tous champs optionnels — seuls les champs fournis sont updatés.
 *
 * Sécurité :
 *  - verifyAuth Bearer ID token (401 sinon)
 *  - session.partnerId === auth.uid (403 sinon)
 *  - V9 freeze : currentParticipants === 0 (403 'session-frozen' sinon,
 *    cohérent rules Phase 6 anti-cheat validPricingTiersUpdate)
 *
 * @module
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { buildSessionPricingTiers } from '@/lib/billing/sessionPricingTiers';
import { validateSessionDate } from '@/lib/billing/sessionDateValidation';
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
      const { parseServiceAccountKeyDefensive } = await import('@/lib/auth/verifyAuth');
      initializeApp({
        credential: cert(
          parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0],
        ),
      });
    } else {
      initializeApp({
        projectId: (
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude'
        ).trim(),
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

const MAX_PRICE_CHF = 1000;

interface PatchBody {
  useCustomPrice?: boolean;
  customPriceCHF?: number;
  startAtMillis?: number;
}

// =====================================================================
// PATCH
// =====================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'sessionId required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as PatchBody;

    const db = await getAdminDb();
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const session = sessionSnap.data() as Session;

    if (session.partnerId !== uid) {
      return NextResponse.json({ error: 'forbidden', detail: 'not owner' }, { status: 403 });
    }
    if ((session.currentParticipants ?? 0) > 0) {
      return NextResponse.json(
        { error: 'session-frozen', detail: 'session has bookings, V9 anti-cheat freeze' },
        { status: 403 },
      );
    }

    // Build update payload selon les champs fournis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};

    // ----- Pricing -----
    if (typeof body.useCustomPrice === 'boolean') {
      let customPriceCHF: number | undefined;
      if (body.useCustomPrice) {
        const raw = body.customPriceCHF;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return NextResponse.json(
            { error: 'invalid-input', detail: 'customPriceCHF must be finite number' },
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
        updates.pricingTiers = buildSessionPricingTiers({
          mode: 'custom',
          customPriceCHF,
          activityPriceCHF: 0,
        });
        updates.pricingMode = 'custom';
      } else {
        // inherit → re-sync from Activity.defaultPricingTiers
        const activitySnap = await db.collection('activities').doc(session.activityId).get();
        if (!activitySnap.exists) {
          return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
        }
        const activity = activitySnap.data() as Activity;
        const activityPriceCHF = typeof activity.price === 'number' ? activity.price : 0;
        updates.pricingTiers = buildSessionPricingTiers({
          mode: 'inherit',
          activityPricingTiers: activity.defaultPricingTiers,
          activityPriceCHF,
        });
        updates.pricingMode = 'inherit';
      }
    }

    // ----- Date / heure -----
    if (typeof body.startAtMillis === 'number') {
      const validation = validateSessionDate(body.startAtMillis, Date.now());
      if (!validation.valid) {
        const code = validation.reason === 'past'
          ? 'invalid-date-past'
          : validation.reason === 'too-far'
            ? 'invalid-date-too-far'
            : 'invalid-input';
        return NextResponse.json({ error: code, detail: 'startAtMillis invalid' }, { status: 400 });
      }
      const { Timestamp } = await import('firebase-admin/firestore');
      const startTs = Timestamp.fromMillis(body.startAtMillis);
      updates.startAt = startTs;
      // Recompute endAt si on a la durée — keep existing endAt offset
      const durationMs =
        session.endAt && session.startAt && typeof session.endAt.toMillis === 'function'
          ? session.endAt.toMillis() - session.startAt.toMillis()
          : 60 * 60 * 1000; // défaut 1h
      updates.endAt = Timestamp.fromMillis(body.startAtMillis + durationMs);
      // chatOpenAt / chatCloseAt offsets identiques
      const chatOpenOffsetMs =
        session.chatOpenAt && session.startAt && typeof session.chatOpenAt.toMillis === 'function'
          ? session.startAt.toMillis() - session.chatOpenAt.toMillis()
          : 120 * 60 * 1000;
      const chatCloseOffsetMs =
        session.chatCloseAt && session.endAt && typeof session.chatCloseAt.toMillis === 'function'
          ? session.chatCloseAt.toMillis() - session.endAt.toMillis()
          : 30 * 60 * 1000;
      updates.chatOpenAt = Timestamp.fromMillis(body.startAtMillis - chatOpenOffsetMs);
      updates.chatCloseAt = Timestamp.fromMillis(body.startAtMillis + durationMs + chatCloseOffsetMs);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'no fields to update — provide useCustomPrice and/or startAtMillis' },
        { status: 400 },
      );
    }

    const { FieldValue } = await import('firebase-admin/firestore');
    updates.updatedAt = FieldValue.serverTimestamp();
    await sessionSnap.ref.update(updates);

    // Effective price for response
    let effectivePriceCHF = 0;
    let mode: 'custom' | 'inherit' = session.pricingMode === 'custom' ? 'custom' : 'inherit';
    if (updates.pricingMode) mode = updates.pricingMode as 'custom' | 'inherit';
    if (updates.pricingTiers) {
      const earlyTier = (updates.pricingTiers as Array<{ kind: string; price: number }>).find(
        (t) => t.kind === 'early',
      );
      effectivePriceCHF = Math.round((earlyTier?.price ?? 0) / 100);
    } else {
      // Pricing unchanged — return current cache
      effectivePriceCHF = Math.round((session.currentPrice ?? 0) / 100);
    }

    return NextResponse.json(
      { ok: true, sessionId, mode, effectivePriceCHF, updatedFields: Object.keys(updates) },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/partner/sessions/[sessionId]] PATCH fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// =====================================================================
// DELETE
// =====================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'sessionId required' }, { status: 400 });
    }

    const db = await getAdminDb();
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
    }
    const session = sessionSnap.data() as Session;

    if (session.partnerId !== uid) {
      return NextResponse.json({ error: 'forbidden', detail: 'not owner' }, { status: 403 });
    }
    if ((session.currentParticipants ?? 0) > 0) {
      return NextResponse.json(
        { error: 'session-frozen', detail: 'session has bookings, cannot delete' },
        { status: 403 },
      );
    }

    await sessionSnap.ref.delete();

    return NextResponse.json({ ok: true, sessionId }, { status: 200 });
  } catch (err) {
    console.error('[/api/partner/sessions/[sessionId]] DELETE fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
