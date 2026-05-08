/**
 * Phase 9 sub-chantier 4 commit 4/6 — POST /api/reviews/[id]/check-retaliation.
 *
 * Pipeline server-side :
 *   1. Parse body {reviewerId, revieweeId, sessionId, createdAtMs}
 *   2. detectRetaliation(input) Admin SDK query (cross-user same-session within 24h)
 *   3. Si match : applyRetaliationFlag(reviewId, suspectReviewId, deltaMs, reason)
 *      → update review.flaggedAsRetaliation=true + retaliationDeltaMs + retaliationSuspectReviewId
 *      + adminAction type='review_retaliation_flag' adminId='system' (Q6=A silent)
 *   4. Return {flagged: boolean, deltaMs?, suspectReviewId?}
 *
 * Doctrine SC4 :
 *  - Q5=A 24h same-session window
 *  - Q6=A silent log adminAction (admin investigue manuellement, no email Phase 9)
 *  - Pattern cohérent /api/reviews/[id]/moderate SC4 c2/6 — server-only Admin SDK
 *  - Trust body (cohérent /api/anti-leak SC2 — caller est createReview client-side fire-and-forget)
 *  - Best-effort : never throw (caller fire-and-forget, jamais block UX)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  detectRetaliation,
  applyRetaliationFlag,
} from '@/lib/reviews/retaliationDetector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: reviewId } = await context.params;
    if (!reviewId) {
      return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
    }

    const body = await request.json();
    if (
      typeof body?.reviewerId !== 'string' ||
      typeof body?.revieweeId !== 'string' ||
      typeof body?.sessionId !== 'string' ||
      typeof body?.createdAtMs !== 'number' ||
      body.reviewerId.length === 0 ||
      body.revieweeId.length === 0 ||
      body.sessionId.length === 0
    ) {
      return NextResponse.json(
        {
          error: 'invalid-input',
          detail: 'reviewerId, revieweeId, sessionId, createdAtMs required',
        },
        { status: 400 },
      );
    }

    const detection = await detectRetaliation({
      reviewId,
      reviewerId: body.reviewerId,
      revieweeId: body.revieweeId,
      sessionId: body.sessionId,
      createdAtMs: body.createdAtMs,
    });

    if (!detection.isRetaliation) {
      return NextResponse.json({ flagged: false }, { status: 200 });
    }

    const apply = await applyRetaliationFlag({
      reviewId,
      suspectReviewId: detection.suspectReviewId!,
      deltaMs: detection.deltaMs!,
      reason: detection.reason ?? 'cross-review same session within 24h',
    });

    return NextResponse.json(
      {
        flagged: true,
        suspectReviewId: detection.suspectReviewId,
        deltaMs: detection.deltaMs,
        applyOk: apply.ok,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/reviews/[id]/check-retaliation] unexpected error:', err);
    return NextResponse.json(
      {
        error: 'internal-error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
