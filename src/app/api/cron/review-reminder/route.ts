/**
 * Phase 8 sub-chantier 5 commit 2/5 — POST /api/cron/review-reminder.
 *
 * Comble Différé Phase 8 ligne 885 architecture.md :
 *   « ⏳ Push reminder 48h post-session (template `reviewReminder` wire) »
 *
 * Q3=A : email Resend seul Phase 8 (template `reviewReminder` existe templates.ts).
 * Push web différé Phase 9 UX.
 *
 * Architecture (Option β cohérent refresh-pricing) :
 *   Cloud Functions Scheduler (every 60 min, Europe/Zurich)
 *      ↓ HTTPS POST + Authorization: Bearer ${CRON_SECRET}
 *   /api/cron/review-reminder (cette route)
 *      ↓ Firestore Admin SDK : query bookings sessionDate within (now-72h, now-48h)
 *      ↓ Filter status='confirmed' + reviewReminderSent !== true
 *      ↓ Per-booking : sendEmail reviewReminder + write reviewReminderSent=true
 *
 * Idempotency : flag `Booking.reviewReminderSent=true` set après envoi (ou tentative
 * loggedOnly dev). Replay-safe — runs ultérieurs skip les bookings déjà flaggés.
 *
 * Batch limit 500 par run (cohérent purge-old-data Phase 8 SC5 c3/5). Volume launch
 * phase 8 = quelques bookings/heure, marge confortable. Phase 9 polish : pagination
 * cursor si volume > 500/h.
 *
 * Method : POST (state-changing — write reviewReminderSent flag).
 *
 * Returns :
 *   { processed: number, sent: number, skipped: number, batchLimit: 500, dryRun: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/sendEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 500;
const REMINDER_WINDOW_START_HOURS = 72; // session ended >= 72h ago → trop tard, skip
const REMINDER_WINDOW_END_HOURS = 48; // session ended < 48h ago → pas encore, skip
const REVIEW_BONUS_CREDITS = 5; // cohérent template + REVIEW_BONUS_CREDITS lib/reviews

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/admin/blocks)
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bookingDocReadable(data: any): boolean {
  if (!data) return false;
  if (data.status !== 'confirmed') return false;
  if (data.reviewReminderSent === true) return false;
  return true;
}

export async function POST(req: NextRequest) {
  // 1. Auth check
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 2. Parse query params
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === 'true';
  const limitParam = searchParams.get('limit');
  let batchLimit = BATCH_LIMIT_DEFAULT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > BATCH_LIMIT_DEFAULT) {
      return NextResponse.json(
        { error: 'invalid-limit', detail: `limit must be 1..${BATCH_LIMIT_DEFAULT}` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    batchLimit = Math.floor(parsed);
  }

  try {
    const { Timestamp } = await import('firebase-admin/firestore');
    const db = await getAdminDb();

    // 3. Compute window
    const nowMs = Date.now();
    const windowStartMs = nowMs - REMINDER_WINDOW_START_HOURS * 60 * 60 * 1000; // 72h ago
    const windowEndMs = nowMs - REMINDER_WINDOW_END_HOURS * 60 * 60 * 1000; // 48h ago

    // 4. Query bookings dont sessionDate dans la fenêtre (range single-field index auto)
    //    KISS Phase 8 : 1 inequality field (sessionDate). Filter status + flag client-side.
    //    Phase 9 polish : composite index status+sessionDate si volume > batchLimit/h.
    const snap = await db
      .collection('bookings')
      .where('sessionDate', '>=', Timestamp.fromMillis(windowStartMs))
      .where('sessionDate', '<=', Timestamp.fromMillis(windowEndMs))
      .limit(batchLimit)
      .get();

    let processed = 0;
    let sent = 0;
    let skipped = 0;

    for (const bdoc of snap.docs) {
      processed++;
      const booking = bdoc.data();
      if (!bookingDocReadable(booking)) {
        skipped++;
        continue;
      }
      try {
        // Lookup user (email + displayName), activity (title), partner (displayName)
        const [userSnap, activitySnap, partnerSnap] = await Promise.all([
          db.collection('users').doc(booking.userId).get(),
          booking.activityId
            ? db.collection('activities').doc(booking.activityId).get()
            : Promise.resolve(null),
          booking.partnerId
            ? db.collection('users').doc(booking.partnerId).get()
            : Promise.resolve(null),
        ]);
        const userEmail = userSnap.data()?.email as string | undefined;
        if (!userEmail) {
          // Pas d'email → on flag quand même pour pas re-tenter à chaque run
          if (!dryRun) {
            await bdoc.ref.update({ reviewReminderSent: true });
          }
          skipped++;
          continue;
        }
        const userName = (userSnap.data()?.displayName as string | undefined) || 'Hello';
        const activityTitle =
          (activitySnap?.data()?.title as string | undefined) || booking.sport || 'ta session';
        const partnerName =
          (partnerSnap?.data()?.displayName as string | undefined) || 'le partenaire';
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
        const reviewLink = booking.activityId
          ? `${baseUrl}/activities/${booking.activityId}/review`
          : `${baseUrl}/dashboard?action=review`;

        if (!dryRun) {
          // sendEmail wrapper retourne ok=true en mode loggedOnly aussi (pas de RESEND_API_KEY).
          // Tests fonctionnent sans key — flag set sur loggedOnly cohérent prod intent.
          await sendEmail({
            to: userEmail,
            templateName: 'reviewReminder',
            templateData: {
              userName,
              sessionTitle: activityTitle,
              partnerName,
              reviewLink,
              creditsBonus: REVIEW_BONUS_CREDITS,
            },
          });
          // Flag idempotency même si sendEmail throw (best-effort) — pour pas re-tenter
          // un booking en boucle si infra email transient down.
          await bdoc.ref.update({ reviewReminderSent: true });
        }
        sent++;
      } catch (err) {
        console.warn('[/api/cron/review-reminder] per-booking failure (best-effort)', {
          bookingId: bdoc.id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped++;
      }
    }

    return NextResponse.json(
      {
        processed,
        sent,
        skipped,
        batchLimit,
        dryRun,
        windowStartMs,
        windowEndMs,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/cron/review-reminder] fatal', err);
    return NextResponse.json(
      { error: 'cron-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
