/**
 * Phase 9 sub-chantier 4 commit 5/6 — POST /api/users/[id]/moderate-bio (server-only Genkit).
 *
 * Pipeline :
 *   1. Parse + validate body {bio} (≤ 500 chars)
 *   2. Hash userId via SHA-256 (cohérent §C.Q2 anti-leak — never log raw uid)
 *   3. runProfileBioModerator(input) Genkit Gemini Flash + cache 24h + rate limit
 *   4. Admin SDK update users/{uid}.bioModeration = {toxicity, profanity, contactLeak, recommendation, motive, modelVersion, scoredAt}
 *   5. Si recommendation='flag' → log adminAction type='profile_bio_flag' adminId='system' (Q7=A silent)
 *   6. Return 200 OK (caller fire-and-forget)
 *
 * Doctrine SC4 :
 *  - Q3=A admin keep final decision (IA = signal admin)
 *  - Q4=B fire-and-forget client-side (cohérent /api/anti-leak SC2 hotfix isolation)
 *  - Q7=A flag silent + admin queue : bio reste visible no UX disruption Phase 9
 *  - Trust body (cohérent /api/reviews/[id]/moderate SC4 c2/6 — caller updateUser client-side)
 *  - Best-effort : caller fire-and-forget, jamais block UX si fail
 */

import { NextRequest, NextResponse } from 'next/server';
import { runProfileBioModerator } from '@/ai/flows/profile-bio-moderator';
import { AiError } from '@/ai/genkit';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =====================================================================
// Lazy Admin SDK init (cohérent /api/reviews/[id]/moderate SC4 c2/6)
// =====================================================================

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
    const { id: uid } = await context.params;
    if (!uid) {
      return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
    }

    const body = await request.json();
    if (
      typeof body?.bio !== 'string' ||
      body.bio.length === 0 ||
      body.bio.length > 1000 // Phase 9 cap large pour anti-DoS — UserProfile.bio limite UX upstream
    ) {
      return NextResponse.json(
        {
          error: 'invalid-input',
          detail: 'bio (1-1000 chars) required',
        },
        { status: 400 },
      );
    }

    const userHashFull = await sha256Hex(uid);
    const userHashId = userHashFull.slice(0, 16); // 16 chars suffit (cohérent §C.Q2)

    const aiResult = await runProfileBioModerator({
      bio: body.bio,
      userHashId,
    });

    // Persist bioModeration via Admin SDK (bypass rules — server-only post-Genkit)
    const { Timestamp } = await import('firebase-admin/firestore');
    const db = await getAdminDb();
    await db.collection('users').doc(uid).update({
      bioModeration: {
        toxicity: aiResult.toxicity,
        profanity: aiResult.profanity,
        contactLeak: aiResult.contactLeak,
        recommendation: aiResult.recommendation,
        motive: aiResult.motive,
        modelVersion: aiResult.modelVersion,
        scoredAt: Timestamp.now(),
      },
    });

    // Si flag → log adminAction silent (Q7=A admin queue admin tab investigue manuellement)
    if (aiResult.recommendation === 'flag') {
      const adminActionRef = db.collection('adminActions').doc();
      await adminActionRef.set({
        actionId: adminActionRef.id,
        adminId: 'system',
        actionType: 'profile_bio_flag',
        targetType: 'user',
        targetId: uid,
        reason: aiResult.motive,
        metadata: {
          toxicity: aiResult.toxicity,
          profanity: aiResult.profanity,
          contactLeak: aiResult.contactLeak,
          modelVersion: aiResult.modelVersion,
        },
        createdAt: Timestamp.now(),
      });
    }

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
    console.error('[/api/users/[id]/moderate-bio] unexpected error:', err);
    return NextResponse.json(
      {
        error: 'internal-error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
