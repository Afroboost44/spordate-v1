/**
 * Phase 9 sub-chantier 4 commit 2/6 — POST /api/reviews/[id]/moderate (server-only Genkit).
 *
 * Pipeline :
 *   1. Parse + validate body {rating, comment, activityTitle?, reviewerId}
 *   2. Hash reviewerId via SHA-256 (cohérent §C.Q2 anti-leak — never log raw uid)
 *   3. runReviewModerator(input) Genkit Gemini Flash + cache 24h + rate limit
 *   4. Admin SDK updateDoc reviews/{id}.aiSuggestion={...} avec serverTimestamp
 *   5. Return 200 OK (caller fire-and-forget)
 *
 * Doctrine SC4 :
 *  - Q3=A admin keep final decision (IA = suggestion uniquement)
 *  - Cohérent /api/anti-leak SC2 hotfix : isole Genkit server-only du client bundle
 *  - Trust body (cohérent /api/anti-leak — Bearer Phase 10 hardening)
 *  - Best-effort : caller (createReview) fire-and-forget, jamais block UX si fail
 *
 * Auth : trust body cohérent /api/anti-leak SC2. Pas critique car :
 *   - Le doc reviews/{id} est gated par rules (write rating ≤ 2 only par reviewer)
 *   - aiSuggestion est purement informatif (admin tranche)
 *   - Volume bound par rate limiter Genkit per-user 10/min
 */

import { NextRequest, NextResponse } from 'next/server';
import { runReviewModerator } from '@/ai/flows/review-moderator';
import { AiError } from '@/ai/genkit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/cron/*)
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

// =====================================================================
// SHA-256 hex via Web Crypto (Node 20+)
// =====================================================================

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// =====================================================================
// POST handler
// =====================================================================

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
      ![1, 2].includes(body?.rating) ||
      typeof body?.comment !== 'string' ||
      body.comment.length === 0 ||
      body.comment.length > 2000 ||
      typeof body?.reviewerId !== 'string' ||
      body.reviewerId.length === 0
    ) {
      return NextResponse.json(
        {
          error: 'invalid-input',
          detail: 'rating (1|2), comment (1-2000 chars), reviewerId required',
        },
        { status: 400 },
      );
    }

    const reviewerHashFull = await sha256Hex(body.reviewerId);
    const reviewerHashId = reviewerHashFull.slice(0, 16); // 16 chars suffit (cohérent §C.Q2)

    const aiResult = await runReviewModerator({
      rating: body.rating as 1 | 2,
      comment: body.comment,
      activityTitle: typeof body.activityTitle === 'string' ? body.activityTitle : undefined,
      reviewerHashId,
    });

    // Persist via Admin SDK (bypass rules — server-only after Genkit success)
    const { Timestamp } = await import('firebase-admin/firestore');
    const db = await getAdminDb();
    await db.collection('reviews').doc(reviewId).update({
      aiSuggestion: {
        civility: aiResult.civility,
        factuality: aiResult.factuality,
        recommendation: aiResult.recommendation,
        motive: aiResult.motive,
        modelVersion: aiResult.modelVersion,
        scoredAt: Timestamp.now(),
      },
    });

    return NextResponse.json(
      { ok: true, recommendation: aiResult.recommendation },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof AiError && err.code === 'rate-limit-exceeded') {
      return NextResponse.json(
        { error: 'rate-limit-exceeded', detail: err.message },
        { status: 429 },
      );
    }
    console.error('[/api/reviews/[id]/moderate] unexpected error:', err);
    return NextResponse.json(
      {
        error: 'internal-error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
