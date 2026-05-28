/**
 * Fix B Option 3 — POST /api/partner/sessions/create
 *
 * Crée une nouvelle session pour une activité du partenaire.
 *
 * Pipeline :
 *  1. verifyAuth Bearer ID token → uid (401 sinon)
 *  2. Validate body : { activityId, startAtMillis, useCustomPrice?, customPriceCHF? }
 *  3. Load activity, check partnerId === uid (403 sinon)
 *  4. Validate startAtMillis : future + max 1 an (400 sinon)
 *  5. Build pricingTiers via buildSessionPricingTiers
 *  6. Create sessions/{auto-id} avec champs dénormalisés (sport, title,
 *     city, partnerId, etc.) cohérents avec /api/sessions/ensure-from-activity
 *  7. Return { sessionId, mode, effectivePriceCHF, startAt }
 *
 * @module
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { buildSessionPricingTiers } from '@/lib/billing/sessionPricingTiers';
import { validateSessionDate } from '@/lib/billing/sessionDateValidation';
import type { Activity } from '@/types/firestore';

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

interface BodyShape {
  activityId?: string;
  startAtMillis?: number;
  useCustomPrice?: boolean;
  customPriceCHF?: number;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as BodyShape;
    if (typeof body.activityId !== 'string' || !body.activityId) {
      return NextResponse.json({ error: 'invalid-input', detail: 'activityId required' }, { status: 400 });
    }
    if (typeof body.startAtMillis !== 'number' || !Number.isFinite(body.startAtMillis)) {
      return NextResponse.json({ error: 'invalid-input', detail: 'startAtMillis required' }, { status: 400 });
    }
    if (typeof body.useCustomPrice !== 'boolean') {
      return NextResponse.json({ error: 'invalid-input', detail: 'useCustomPrice required boolean' }, { status: 400 });
    }

    const dateCheck = validateSessionDate(body.startAtMillis, Date.now());
    if (!dateCheck.valid) {
      const code =
        dateCheck.reason === 'past'
          ? 'invalid-date-past'
          : dateCheck.reason === 'too-far'
            ? 'invalid-date-too-far'
            : 'invalid-input';
      return NextResponse.json({ error: code, detail: 'startAtMillis invalid' }, { status: 400 });
    }

    let customPriceCHF: number | undefined;
    if (body.useCustomPrice) {
      const raw = body.customPriceCHF;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return NextResponse.json(
          { error: 'invalid-input', detail: 'customPriceCHF must be finite number when useCustomPrice=true' },
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
    const activitySnap = await db.collection('activities').doc(body.activityId).get();
    if (!activitySnap.exists) {
      return NextResponse.json({ error: 'activity-not-found' }, { status: 404 });
    }
    const activity = activitySnap.data() as Activity;
    if (activity.partnerId !== uid) {
      return NextResponse.json({ error: 'forbidden', detail: 'activity not owned by auth uid' }, { status: 403 });
    }

    const activityPriceCHF = typeof activity.price === 'number' ? activity.price : 0;
    let pricingTiers;
    let mode: 'custom' | 'inherit';
    if (body.useCustomPrice) {
      mode = 'custom';
      pricingTiers = buildSessionPricingTiers({
        mode: 'custom',
        customPriceCHF,
        activityPriceCHF: 0,
      });
    } else {
      mode = 'inherit';
      pricingTiers = buildSessionPricingTiers({
        mode: 'inherit',
        activityPricingTiers: activity.defaultPricingTiers,
        activityPriceCHF,
      });
    }

    const earlyTier = pricingTiers.find((t) => t.kind === 'early');
    const earlyPriceCents = earlyTier?.price ?? pricingTiers[0]?.price ?? 0;

    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    const startMs = body.startAtMillis;
    // Durée par défaut depuis activity.duration (minutes) ou 60min fallback
    const durationMinutes = typeof activity.duration === 'number' && activity.duration > 0 ? activity.duration : 60;
    const endMs = startMs + durationMinutes * 60 * 1000;
    // chatOpenOffset depuis activity.chatOpenOffsetMinutes (défaut Phase 4 = 120min)
    const chatOpenOffsetMinutes =
      typeof activity.chatOpenOffsetMinutes === 'number' ? activity.chatOpenOffsetMinutes : 120;
    const chatOpenMs = startMs - chatOpenOffsetMinutes * 60 * 1000;
    const chatCloseMs = endMs + 30 * 60 * 1000;

    // Deterministic id pour idempotence cross-requests (cohérent ensure-from-activity)
    const deterministicId = `${body.activityId}_${startMs}`;
    const sessionRef = db.collection('sessions').doc(deterministicId);
    const existingDoc = await sessionRef.get();
    if (existingDoc.exists) {
      return NextResponse.json(
        { error: 'session-already-exists', detail: 'a session already exists at this datetime', sessionId: deterministicId },
        { status: 409 },
      );
    }

    await sessionRef.set({
      sessionId: deterministicId,
      activityId: body.activityId,
      partnerId: activity.partnerId,
      creatorId: (activity.createdBy as string) ?? activity.partnerId,
      sport: (activity.sport as string) ?? '',
      // Anti-régression bug Stripe "product_data[name] cannot be empty" :
      // legacy activities ont `name` au lieu de `title`. Si les deux sont
      // absents, la session était créée avec title='' → Stripe rejette le
      // checkout invite-accept. On hydrate via cascade title → name → fallback
      // pour garantir un title non-vide sur la session.
      title:
        (activity.title as string)?.trim() ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((activity as any).name as string)?.trim() ||
        '',
      city: (activity.city as string) ?? '',
      startAt: Timestamp.fromMillis(startMs),
      endAt: Timestamp.fromMillis(endMs),
      chatOpenAt: Timestamp.fromMillis(chatOpenMs),
      chatCloseAt: Timestamp.fromMillis(chatCloseMs),
      maxParticipants: typeof activity.maxParticipants === 'number' ? activity.maxParticipants : 10,
      currentParticipants: 0,
      pricingTiers,
      pricingMode: mode,
      currentTier: 'early',
      currentPrice: earlyPriceCents,
      status: 'open',
      createdBy: activity.partnerId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json(
      {
        ok: true,
        sessionId: deterministicId,
        mode,
        effectivePriceCHF: Math.round(earlyPriceCents / 100),
        startAt: startMs,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/partner/sessions/create] POST fatal', err);
    return NextResponse.json(
      { error: 'internal', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
