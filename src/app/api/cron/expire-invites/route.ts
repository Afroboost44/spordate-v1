/**
 * Phase 9 sub-chantier 1 commit 4/5 — POST /api/cron/expire-invites.
 *
 * Comble Différé Phase 9 SC4 close-out (architecture.md ligne 1334) :
 *   « ⏭️ Cron expireInvitesIfDue() deployment Cloud Functions Scheduler »
 *
 * Pipeline (cohérent SC5 c2/5 review-reminder pattern) :
 *   1. Auth Bearer ${CRON_SECRET}
 *   2. Pagination cursor : query invites where status='pending' AND expiresAt <= now
 *      ORDER BY expiresAt ASC → batch update status='expired' par page
 *   3. pageSize=500, maxPages=10 (5000 docs cap par run, Vercel maxDuration 60s safe)
 *   4. truncated=true si maxPages atteint → run suivant continuera (every 60 min)
 *
 * Idempotency : status='pending' → 'expired' transition, batch update.
 * Re-runs sont safe — les invites déjà 'expired' ne re-matchent plus la query.
 *
 * Best-effort : per-batch failure logged + continue (jamais throw fatal).
 *
 * Returns : { processed, pages, truncated, pageSize, maxPages, dryRun }
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 500;
const MAX_PAGES_DEFAULT = 10; // 5000 docs cap par run

// =====================================================================
// Lazy Admin SDK init (cohérent SC4+SC5+SC1 c1-c3)
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

export async function POST(req: NextRequest) {
  // 1. Auth Bearer CRON_SECRET
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
    const { Timestamp } = await import('firebase-admin/firestore');
    const db = await getAdminDb();

    const nowTs = Timestamp.fromMillis(Date.now());

    let processed = 0;
    let pages = 0;
    let refundsAttempted = 0;
    let truncated = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastDoc: any = null;
    const inviteIdsToRefund: string[] = [];

    while (pages < maxPages) {
      let pageQuery = db
        .collection('invites')
        .where('status', '==', 'pending')
        .where('expiresAt', '<=', nowTs)
        .orderBy('expiresAt', 'asc')
        .limit(pageSize);
      if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
      const snap = await pageQuery.get();
      if (snap.empty) break;
      pages++;

      // Phase 9 SC2 c5/6 — collect invites éligibles refund AVANT batch update
      // (mode Split/Gift + inviterPaymentIntentId set + non déjà refunded)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of snap.docs as any[]) {
        const data = d.data();
        const mode = (data?.mode as string) ?? 'individual';
        if (
          mode !== 'individual' &&
          data?.inviterPaymentIntentId &&
          !data?.inviterRefundedAt
        ) {
          inviteIdsToRefund.push(d.id);
        }
      }

      // Batch update status='expired' (Admin SDK bypass rules)
      if (!dryRun) {
        try {
          const batch = db.batch();
          for (const d of snap.docs) {
            batch.update(d.ref, { status: 'expired' });
          }
          await batch.commit();
        } catch (err) {
          console.warn('[/api/cron/expire-invites] batch update failed (skip page)', {
            page: pages,
            error: err instanceof Error ? err.message : String(err),
          });
          // Best-effort : log + continue (next page)
          break;
        }
      }
      processed += snap.size;

      // Si dryRun → on ne write pas, mêmes docs reviendront → break
      // Sinon, si page partielle (snap.size < pageSize) → done
      if (dryRun) break;
      if (snap.size < pageSize) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    if (pages >= maxPages) {
      truncated = true;
    }

    // Phase 9 SC2 c5/6 — refund auto best-effort post-batch (Q6=A retain-not-trap)
    // Effectué hors batch principal pour éviter Stripe latency × N inside loop.
    if (!dryRun && inviteIdsToRefund.length > 0) {
      const { refundForInvite } = await import('@/lib/stripe/refundForInvite');
      for (const inviteId of inviteIdsToRefund) {
        try {
          const result = await refundForInvite({ inviteId });
          if (result.ok && result.refundId) {
            refundsAttempted++;
          }
          console.info('[/api/cron/expire-invites] refund auto', { inviteId, result });
        } catch (err) {
          console.warn('[/api/cron/expire-invites] refund failed (best-effort)', {
            inviteId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return NextResponse.json(
      {
        processed,
        pages,
        truncated,
        pageSize,
        maxPages,
        dryRun,
        // Phase 9 SC2 c5/6 — refund metrics
        refundsAttempted,
        refundCandidates: inviteIdsToRefund.length,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/cron/expire-invites] fatal', err);
    return NextResponse.json(
      { error: 'cron-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
