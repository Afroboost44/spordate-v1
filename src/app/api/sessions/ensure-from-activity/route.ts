/**
 * Phase 9.5 c42 — POST /api/sessions/ensure-from-activity.
 *
 * Résout la divergence entre Activity.scheduledAt (UX source-of-truth affichée
 * dans la card listing) et Session.startAt (gate de réservation, requis par
 * handleSessionMode du checkout). Le partner save flow met à jour Activity
 * mais ne crée pas de Session — état orphelin "séance affichée mais bouton
 * désactivé Pas de session planifiée".
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid (any authenticated user)
 *   2. Body { activityId }
 *   3. Read activities/{activityId}, valide scheduledAt > now
 *   4. Query sessions/ where activityId == X AND startAt > now() (déjà existante ?)
 *      → si existe, return son id
 *   5. Sinon, create sessions/{deterministicId} où
 *      deterministicId = `${activityId}_${scheduledAtMs}` (anti-doublon concurrent)
 *      avec pricingTiers = activity.defaultPricingTiers ?? computeFallbackTiers(activity.price)
 *      et chatOpenAt = startAt - chatOpenOffset (default 120min), chatCloseAt = endAt + 30min
 *   6. Return { sessionId, alreadyExisted }
 *
 * Aucune écriture si activity.scheduledAt absent ou passé.
 *
 * @returns 200 { ok, sessionId, alreadyExisted } / 400 / 401 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toMs(raw: unknown): number | null {
  if (raw == null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (typeof r.toMillis === 'function') return r.toMillis();
  if (r instanceof Date) return r.getTime();
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  if (typeof r.seconds === 'number') return r.seconds * 1000;
  return null;
}

interface PricingTier {
  kind: 'early' | 'standard' | 'last_minute';
  price: number;
  activateMinutesBeforeStart: number;
  activateAtFillRate: number;
}

function computeFallbackTiers(activityPriceCHF: number): PricingTier[] {
  const baseCentimes = Math.round(activityPriceCHF * 100);
  return [
    { kind: 'early', price: Math.round(baseCentimes * 0.8), activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
    { kind: 'standard', price: baseCentimes, activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
    { kind: 'last_minute', price: Math.round(baseCentimes * 1.2), activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
  ];
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const activityId = body?.activityId as string;
    if (!activityId || typeof activityId !== 'string') {
      return NextResponse.json({ error: 'invalid-input', detail: 'activityId required' }, { status: 400 });
    }

    const db = await getAdminDb();
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    // 3. Read activity
    const activityRef = db.collection('activities').doc(activityId);
    const activitySnap = await activityRef.get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() ?? {};

    const scheduledAtMs = toMs(activity.scheduledAt);
    const nowMs = Date.now();
    if (scheduledAtMs === null) {
      return NextResponse.json({ error: 'no-scheduled-date', detail: 'activity has no scheduledAt' }, { status: 400 });
    }
    if (scheduledAtMs <= nowMs) {
      return NextResponse.json({ error: 'scheduled-in-past' }, { status: 400 });
    }

    // 4. Existing future session ?
    const existingSnap = await db
      .collection('sessions')
      .where('activityId', '==', activityId)
      .where('startAt', '>', Timestamp.fromMillis(nowMs))
      .orderBy('startAt', 'asc')
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      const found = existingSnap.docs[0];
      return NextResponse.json(
        { ok: true, sessionId: found.id, alreadyExisted: true },
        { status: 200 },
      );
    }

    // 5. Create — deterministic id pour idempotence cross-requests
    const deterministicId = `${activityId}_${scheduledAtMs}`;
    const sessionRef = db.collection('sessions').doc(deterministicId);
    const existingDoc = await sessionRef.get();
    if (existingDoc.exists) {
      return NextResponse.json(
        { ok: true, sessionId: deterministicId, alreadyExisted: true },
        { status: 200 },
      );
    }

    // Résoudre pricingTiers (priorité activity.defaultPricingTiers > fallback auto)
    const priceCHF = typeof activity.price === 'number' ? activity.price : 0;
    let pricingTiers: PricingTier[] = [];
    const defaults = activity.defaultPricingTiers as PricingTier[] | undefined;
    if (defaults && defaults.length > 0) {
      pricingTiers = defaults;
    } else if (priceCHF > 0) {
      pricingTiers = computeFallbackTiers(priceCHF);
    } else {
      return NextResponse.json(
        { error: 'no-pricing', detail: 'activity has no price and no defaultPricingTiers — cannot create session' },
        { status: 400 },
      );
    }

    const durationMinutes = typeof activity.duration === 'number' && activity.duration > 0 ? activity.duration : 60;
    const chatOpenOffsetMinutes = typeof activity.chatOpenOffsetMinutes === 'number' ? activity.chatOpenOffsetMinutes : 120;
    const startMs = scheduledAtMs;
    const endMs = startMs + durationMinutes * 60_000;
    const chatOpenMs = startMs - chatOpenOffsetMinutes * 60_000;
    const chatCloseMs = endMs + 30 * 60_000;
    const earlyPriceCents = pricingTiers.find((t) => t.kind === 'early')?.price ?? pricingTiers[0]?.price ?? 0;

    await sessionRef.set({
      sessionId: deterministicId,
      activityId,
      partnerId: (activity.partnerId as string) ?? '',
      creatorId: (activity.createdBy as string) ?? (activity.partnerId as string) ?? '',
      sport: (activity.sport as string) ?? '',
      title: (activity.title as string) ?? (activity.name as string) ?? '',
      city: (activity.city as string) ?? '',
      startAt: Timestamp.fromMillis(startMs),
      endAt: Timestamp.fromMillis(endMs),
      chatOpenAt: Timestamp.fromMillis(chatOpenMs),
      chatCloseAt: Timestamp.fromMillis(chatCloseMs),
      maxParticipants: typeof activity.maxParticipants === 'number' ? activity.maxParticipants : 10,
      currentParticipants: 0,
      pricingTiers,
      currentTier: 'early',
      currentPrice: earlyPriceCents,
      status: 'open',
      createdBy: (activity.partnerId as string) ?? uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json(
      { ok: true, sessionId: deterministicId, alreadyExisted: false },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/sessions/ensure-from-activity] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
