/**
 * Phase 9 sub-chantier 5 commit 3/4 — POST /api/users/[id]/recompute-rating.
 *
 * Pipeline server-side :
 *   1. Parse + validate uid param
 *   2. recomputeRevieweeAverageRating(uid) Admin SDK query reviews published + update user doc
 *   3. Return {ok: true, averageRating, reviewCount}
 *
 * Doctrine SC5 :
 *  - Caller : awardReviewBonus client-side fire-and-forget post-publish
 *  - Server-only Admin SDK pour bypass rules (cohérent SC4 c2/6 moderate-review pattern)
 *  - Trust uid path param (pas de Bearer — fire-and-forget side-effect, no PII leak)
 *  - Best-effort : caller fire-and-forget, jamais block UX si fail
 */

import { NextRequest, NextResponse } from 'next/server';
import { recomputeRevieweeAverageRating } from '@/lib/matching/recomputeRating';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: uid } = await context.params;
    if (!uid) {
      return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
    }

    const result = await recomputeRevieweeAverageRating(uid);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        averageRating: result.averageRating,
        reviewCount: result.reviewCount,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/users/[id]/recompute-rating] unexpected error:', err);
    return NextResponse.json(
      {
        error: 'internal-error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
