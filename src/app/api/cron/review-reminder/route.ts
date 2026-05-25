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
 * Pagination Phase 9 SC0 c1/X (item r) : pageSize=500 + cursor `startAfter()` interne,
 * jusqu'à `MAX_PAGES` (5000 docs cap par run pour respecter Vercel maxDuration 60s).
 * Si truncated=true dans response → run suivant continuera depuis là (next tick CF
 * Scheduler horaire). Future polish Phase 10 : persistance cursor dans
 * `cronState/review-reminder` doc pour reprendre exactement.
 *
 * Method : POST (state-changing — write reviewReminderSent flag).
 *
 * Returns :
 *   { processed: number, sent: number, skipped: number, batchLimit: 500, dryRun: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/sendEmail';
import { sendPushNotification } from '@/lib/notifications/sendPushNotification';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 500;
const MAX_PAGES_DEFAULT = 10; // 5000 docs cap par run (Phase 9 SC0 c1/X cursor)
const REMINDER_WINDOW_START_HOURS = 72; // session ended >= 72h ago → trop tard, skip
const REMINDER_WINDOW_END_HOURS = 48; // session ended < 48h ago → pas encore, skip
const REVIEW_BONUS_CREDITS = 5; // cohérent template + REVIEW_BONUS_CREDITS lib/reviews

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/admin/blocks)
// =====================================================================

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
  let pageSize = BATCH_LIMIT_DEFAULT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > BATCH_LIMIT_DEFAULT) {
      return NextResponse.json(
        { error: 'invalid-limit', detail: `limit must be 1..${BATCH_LIMIT_DEFAULT}` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    pageSize = Math.floor(parsed);
  }
  const maxPagesParam = searchParams.get('maxPages');
  let maxPages = MAX_PAGES_DEFAULT;
  if (maxPagesParam !== null) {
    const parsed = Number(maxPagesParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_PAGES_DEFAULT) {
      return NextResponse.json(
        { error: 'invalid-maxPages', detail: `maxPages must be 1..${MAX_PAGES_DEFAULT}` },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    maxPages = Math.floor(parsed);
  }

  try {
    const { Timestamp } = await import('firebase-admin/firestore');
    const db = await getAdminDb();

    // 3. Compute window
    const nowMs = Date.now();
    const windowStartMs = nowMs - REMINDER_WINDOW_START_HOURS * 60 * 60 * 1000; // 72h ago
    const windowEndMs = nowMs - REMINDER_WINDOW_END_HOURS * 60 * 60 * 1000; // 48h ago

    // 4. Query bookings sessionDate range — pagination cursor Phase 9 SC0 c1/X.
    //    Composite index `bookings: status+sessionDate` ajouté firestore.indexes.json
    //    permet aussi `where status='confirmed' AND sessionDate range` côté Phase 9 polish.
    //    Pour cursor pagination, on utilise sessionDate comme orderBy (stable + range-friendly).
    let processed = 0;
    let sent = 0;
    let skipped = 0;
    let pages = 0;
    let truncated = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastDoc: any = null;

    while (pages < maxPages) {
      let pageQuery = db
        .collection('bookings')
        .where('sessionDate', '>=', Timestamp.fromMillis(windowStartMs))
        .where('sessionDate', '<=', Timestamp.fromMillis(windowEndMs))
        .orderBy('sessionDate', 'asc')
        .limit(pageSize);
      if (lastDoc) {
        pageQuery = pageQuery.startAfter(lastDoc);
      }
      const snap = await pageQuery.get();
      if (snap.empty) break;
      pages++;

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
            // Phase 9 SC3 c2/5 — push-first, email-fallback (Q3=B)
            // Si user.fcmToken set + opt-in (default-on) → push, sinon email fallback
            const userData = userSnap.data();
            const fcmToken = userData?.fcmToken as string | undefined;
            const pushOptIn = (userData?.pushNotificationsEnabled as boolean | undefined) !== false; // default-on cohérent aiSuggestionsOptIn
            let pushDelivered = false;
            if (fcmToken && pushOptIn) {
              try {
                const r = await sendPushNotification({
                  fcmToken,
                  title: `Comment s'est passé ${activityTitle} ?`,
                  body: `30 secondes pour partager ton ressenti. +${REVIEW_BONUS_CREDITS} crédits chat bonus.`,
                  clickUrl: reviewLink,
                  data: { activityId: booking.activityId || '', bookingId: bdoc.id },
                });
                if (r.ok) {
                  pushDelivered = true;
                }
              } catch (err) {
                console.warn('[/api/cron/review-reminder] sendPushNotification threw (fallback email)', err);
              }
            }
            if (!pushDelivered) {
              // Fallback email (legacy comportement) — Fix #156/#157 i18n via user.language
              const { pickUserLang } = await import('@/lib/i18n/getUserLang');
              const userLang = pickUserLang(userData);
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
                lang: userLang,
              });
            }
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

      // Si page partielle (snap.size < pageSize) → done
      if (snap.size < pageSize) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    if (pages >= maxPages) {
      // On a peut-être hit le cap maxPages — possible truncation, run suivant continuera
      truncated = true;
    }

    return NextResponse.json(
      {
        processed,
        sent,
        skipped,
        pages,
        truncated,
        pageSize,
        maxPages,
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
