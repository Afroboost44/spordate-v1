/**
 * Fix audit Stripe refund visibility — POST /api/cron/retry-failed-refunds.
 *
 * Comble le trou « refund best-effort sans retry / sans alerte » identifié dans
 * l'audit système d'invitation : si refundForInvite échoue (Stripe timeout, code
 * erreur réseau), l'invitation reste declined/expired et personne ne renvoie le
 * remboursement.
 *
 * Pipeline :
 *   1. Auth Bearer ${CRON_SECRET} (cohérent /api/cron/expire-invites).
 *   2. Query : invites où refundState.status == 'failed' AND attempts < 5.
 *   3. Cooldown : skip si lastAttemptAt > now - 30 min (évite hammer).
 *   4. Pour chaque match : appelle refundForInvite (qui gère lui-même les transitions
 *      refundState in-progress -> succeeded/failed + escalation manual-review au 5e KO).
 *   5. Pagination : pageSize=100, maxPages=5 (500 docs cap par run, Vercel safe).
 *
 * Cadence recommandée : toutes les 30 minutes (cohérent cooldown).
 *
 * Idempotence :
 *   - refundForInvite skip si refundState.status === 'succeeded' (garde-fou).
 *   - Stripe idempotency_key = `refund-invite-${inviteId}` côté Stripe.
 *
 * Returns : { processed, retried, succeeded, failed, escalated, pages, truncated }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_LIMIT_DEFAULT = 100;
const MAX_PAGES_DEFAULT = 5; // 500 docs cap par run
const COOLDOWN_MS_DEFAULT = 30 * 60 * 1000; // 30 min
const MAX_ATTEMPTS = 5;

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

  const cooldownMsParam = searchParams.get('cooldownMs');
  let cooldownMs = COOLDOWN_MS_DEFAULT;
  if (cooldownMsParam !== null) {
    const parsed = Number(cooldownMsParam);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: 'invalid-cooldownMs' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    cooldownMs = Math.floor(parsed);
  }

  try {
    const db = await getAdminDb();
    const nowMs = Date.now();
    const cooldownThresholdMs = nowMs - cooldownMs;

    let processed = 0;
    let retried = 0;
    let succeeded = 0;
    let failed = 0;
    let escalated = 0;
    let pages = 0;
    let truncated = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastDoc: any = null;

    // Lazy import refundForInvite (server-only, évite cycles)
    const { refundForInvite } = await import('@/lib/stripe/refundForInvite');

    while (pages < maxPages) {
      let pageQuery = db
        .collection('invites')
        .where('refundState.status', '==', 'failed')
        .where('refundState.attempts', '<', MAX_ATTEMPTS)
        .orderBy('refundState.attempts', 'asc')
        .limit(pageSize);
      if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
      const snap = await pageQuery.get();
      if (snap.empty) break;
      pages++;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of snap.docs as any[]) {
        processed++;
        const data = d.data();
        const lastAttemptAtMs =
          data?.refundState?.lastAttemptAt &&
          typeof data.refundState.lastAttemptAt.toMillis === 'function'
            ? data.refundState.lastAttemptAt.toMillis()
            : 0;

        // Cooldown : skip si dernière tentative < 30 min
        if (lastAttemptAtMs > cooldownThresholdMs) {
          continue;
        }

        if (dryRun) {
          retried++;
          continue;
        }

        try {
          const result = await refundForInvite({ inviteId: d.id });
          retried++;
          if (result.ok && result.refundId) {
            succeeded++;
          } else {
            failed++;
            // Re-read pour savoir si escalation
            try {
              const post = await d.ref.get();
              if (post.data()?.refundState?.status === 'manual-review') {
                escalated++;
              }
            } catch (_e) { /* silent */ }
          }
          console.info('[/api/cron/retry-failed-refunds] retry', {
            inviteId: d.id,
            result,
          });
        } catch (err) {
          failed++;
          console.warn('[/api/cron/retry-failed-refunds] retry threw', {
            inviteId: d.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (dryRun) break;
      if (snap.size < pageSize) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    if (pages >= maxPages) {
      truncated = true;
    }

    return NextResponse.json(
      {
        processed,
        retried,
        succeeded,
        failed,
        escalated,
        pages,
        truncated,
        pageSize,
        maxPages,
        cooldownMs,
        dryRun,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/cron/retry-failed-refunds] fatal', err);
    return NextResponse.json(
      { error: 'cron-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
