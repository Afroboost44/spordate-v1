/**
 * Phase 9 sub-chantier 3 commit 1/5 — POST /api/cron/session-reminders.
 *
 * Email rappels session :
 *  - J-1 (24h avant) — Q1=B window 18-30h (cron horaire tolérant lag)
 *  - T-0 (1h avant) — Q2=A window 30-90min
 *
 * Pipeline (cohérent SC5 c2/5 review-reminder + SC0 c1/X cursor pagination) :
 *   1. Auth Bearer ${CRON_SECRET}
 *   2. Dual dispatch : J-1 batch puis T-0 batch (each scope-isolated)
 *   3. Per batch : query bookings status='confirmed' + sessionDate dans window
 *      + flag `reminder*Sent !== true` → sendEmail + flag set
 *   4. Cursor pagination Phase 9 SC0 c1/X (pageSize=500, maxPages=10)
 *   5. Best-effort silent per booking (continue on fail)
 *
 * Idempotency : flags `Booking.reminderJMinus1Sent` + `Booking.reminderTMinus0Sent`.
 * Replay-safe — runs ultérieurs skip les bookings déjà flaggés.
 *
 * Method : POST (state-changing — write reminder flags).
 *
 * Returns :
 *   {
 *     jMinus1: { processed, sent, skipped, pages, truncated },
 *     tMinus0: { processed, sent, skipped, pages, truncated },
 *     pageSize, maxPages, dryRun
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/sendEmail';
import { sendPushNotification } from '@/lib/notifications/sendPushNotification';
import { isActivityUnavailable } from '@/lib/activities/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 500;
const MAX_PAGES_DEFAULT = 10; // 5000 docs cap par run (cohérent SC0 c1/X)

// Q1=B window J-1 : sessionDate ∈ (now+18h, now+30h)
const J_MINUS_1_WINDOW_START_HOURS = 18;
const J_MINUS_1_WINDOW_END_HOURS = 30;

// Q2=A window T-0 : sessionDate ∈ (now+30min, now+90min)
const T_MINUS_0_WINDOW_START_MINUTES = 30;
const T_MINUS_0_WINDOW_END_MINUTES = 90;

// =====================================================================
// Lazy Admin SDK init (cohérent SC4 + SC5 + SC1)
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

interface BatchResult {
  processed: number;
  sent: number;
  skipped: number;
  pages: number;
  truncated: boolean;
}

interface ProcessBatchOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  windowStartMs: number;
  windowEndMs: number;
  flagField: 'reminderJMinus1Sent' | 'reminderTMinus0Sent';
  templateName: 'sessionReminderJMinus1' | 'sessionReminderTMinus0';
  pageSize: number;
  maxPages: number;
  dryRun: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bookingDocReadable(data: any, flagField: string): boolean {
  if (!data) return false;
  if (data.status !== 'confirmed') return false;
  if (data[flagField] === true) return false;
  return true;
}

async function processBatch(opts: ProcessBatchOptions): Promise<BatchResult> {
  const { Timestamp } = await import('firebase-admin/firestore');

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let pages = 0;
  let truncated = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastDoc: any = null;

  while (pages < opts.maxPages) {
    let pageQuery = opts.db
      .collection('bookings')
      .where('sessionDate', '>=', Timestamp.fromMillis(opts.windowStartMs))
      .where('sessionDate', '<=', Timestamp.fromMillis(opts.windowEndMs))
      .orderBy('sessionDate', 'asc')
      .limit(opts.pageSize);
    if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
    const snap = await pageQuery.get();
    if (snap.empty) break;
    pages++;

    for (const bdoc of snap.docs) {
      processed++;
      const booking = bdoc.data();
      if (!bookingDocReadable(booking, opts.flagField)) {
        skipped++;
        continue;
      }
      try {
        const [userSnap, activitySnap, partnerSnap] = await Promise.all([
          opts.db.collection('users').doc(booking.userId).get(),
          booking.activityId
            ? opts.db.collection('activities').doc(booking.activityId).get()
            : Promise.resolve(null),
          booking.partnerId
            ? opts.db.collection('users').doc(booking.partnerId).get()
            : Promise.resolve(null),
        ]);
        // BUG #3 — skip si l'activity parente a été supprimée (snapshot absent)
        // ou désactivée (isActive=false). Évite d'envoyer "C'est demain !" pour
        // une activité qui n'existe plus. Flag idempotency posé pour ne pas
        // re-scanner ce booking orphelin à chaque run horaire.
        if (booking.activityId) {
          const activityData = activitySnap?.exists ? activitySnap.data() : null;
          if (isActivityUnavailable(activityData)) {
            console.warn(
              `[/api/cron/session-reminders ${opts.flagField}] skip — activity indisponible (supprimée/désactivée)`,
              { bookingId: bdoc.id, activityId: booking.activityId },
            );
            if (!opts.dryRun) {
              await bdoc.ref.update({ [opts.flagField]: true });
            }
            skipped++;
            continue;
          }
        }

        const userEmail = userSnap.data()?.email as string | undefined;
        if (!userEmail) {
          if (!opts.dryRun) {
            await bdoc.ref.update({ [opts.flagField]: true });
          }
          skipped++;
          continue;
        }
        const userName = (userSnap.data()?.displayName as string | undefined) || '';
        const activityTitle =
          (activitySnap?.data()?.title as string | undefined) || booking.sport || 'ta session';
        const partnerName =
          (partnerSnap?.data()?.displayName as string | undefined) || 'le partenaire';
        const sessionAddress =
          (activitySnap?.data()?.address as string | undefined) ||
          (activitySnap?.data()?.city as string | undefined) ||
          undefined;
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
        const sessionLink = booking.sessionId
          ? `${baseUrl}/sessions/${booking.sessionId}`
          : `${baseUrl}/dashboard`;
        const sessionDateStr = formatSessionDateFR(booking.sessionDate);

        if (!opts.dryRun) {
          // Phase 9 SC3 c2/5 — push-first, email-fallback (Q3=B)
          const userData = userSnap.data();
          const fcmToken = userData?.fcmToken as string | undefined;
          const pushOptIn = (userData?.pushNotificationsEnabled as boolean | undefined) !== false;
          let pushDelivered = false;
          if (fcmToken && pushOptIn) {
            try {
              const isJMinus1 = opts.flagField === 'reminderJMinus1Sent';
              const r = await sendPushNotification({
                fcmToken,
                title: isJMinus1 ? `Demain : ${activityTitle}` : `Dans 1h : ${activityTitle}`,
                body: isJMinus1
                  ? `${sessionDateStr} avec ${partnerName}`
                  : `${sessionDateStr}${sessionAddress ? ` — ${sessionAddress}` : ''}`,
                clickUrl: sessionLink,
                data: {
                  bookingId: bdoc.id,
                  sessionId: booking.sessionId || '',
                  reminderKind: isJMinus1 ? 'jMinus1' : 'tMinus0',
                },
              });
              if (r.ok) {
                pushDelivered = true;
              }
            } catch (err) {
              console.warn(
                `[/api/cron/session-reminders ${opts.flagField}] sendPushNotification threw (fallback email)`,
                err,
              );
            }
          }
          if (!pushDelivered) {
            // Fallback email (legacy comportement)
            await sendEmail({
              to: userEmail,
              templateName: opts.templateName,
              templateData: {
                userName,
                sessionTitle: activityTitle,
                partnerName,
                sessionDate: sessionDateStr,
                sessionAddress,
                sessionLink,
              },
            });
          }
          // Flag idempotency (cohérent SC5 c2/5 — anti-double-reminder même si fail)
          await bdoc.ref.update({ [opts.flagField]: true });
        }
        sent++;
      } catch (err) {
        console.warn(`[/api/cron/session-reminders ${opts.flagField}] per-booking failure`, {
          bookingId: bdoc.id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped++;
      }
    }

    if (snap.size < opts.pageSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  if (pages >= opts.maxPages) truncated = true;

  return { processed, sent, skipped, pages, truncated };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSessionDateFR(ts: any): string {
  if (!ts || typeof ts.toMillis !== 'function') return '';
  const date = new Date(ts.toMillis());
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = ['jan', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} · ${hours}h${minutes !== '00' ? minutes : ''}`;
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

  // 2. Parse params
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
    const db = await getAdminDb();
    const nowMs = Date.now();

    // 3. Q1=B J-1 batch (window 18-30h)
    const jMinus1 = await processBatch({
      db,
      windowStartMs: nowMs + J_MINUS_1_WINDOW_START_HOURS * 60 * 60 * 1000,
      windowEndMs: nowMs + J_MINUS_1_WINDOW_END_HOURS * 60 * 60 * 1000,
      flagField: 'reminderJMinus1Sent',
      templateName: 'sessionReminderJMinus1',
      pageSize,
      maxPages,
      dryRun,
    });

    // 4. Q2=A T-0 batch (window 30-90min)
    const tMinus0 = await processBatch({
      db,
      windowStartMs: nowMs + T_MINUS_0_WINDOW_START_MINUTES * 60 * 1000,
      windowEndMs: nowMs + T_MINUS_0_WINDOW_END_MINUTES * 60 * 1000,
      flagField: 'reminderTMinus0Sent',
      templateName: 'sessionReminderTMinus0',
      pageSize,
      maxPages,
      dryRun,
    });

    return NextResponse.json(
      { jMinus1, tMinus0, pageSize, maxPages, dryRun },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/cron/session-reminders] fatal', err);
    return NextResponse.json(
      { error: 'cron-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
