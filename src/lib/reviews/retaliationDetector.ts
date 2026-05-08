/**
 * Phase 9 sub-chantier 4 commit 4/6 — Heuristique détection représailles cross-user reviews.
 *
 * Doctrine SC4 Q5=A : flag review si une cross-review du revieweeId sur le reviewerId
 * existe sur la MÊME session ET dans les 24h précédentes. Q6=A : silent log adminAction
 * (admin investigue manuellement, no email Phase 9).
 *
 * Pattern :
 *   - detectRetaliation() : query Firestore reviews where reviewerId=X AND revieweeId=Y AND
 *     createdAt > now-24h, puis client-side filter sessionId.
 *   - Conçu pour Admin SDK (server-side via API route /api/reviews/[id]/check-retaliation)
 *     parce que client SDK rules denient lecture des reviews pending d'autres users.
 *   - DI seam __setRetaliationAdminDbForTesting (cohérent SC2 c5/6 pattern Admin SDK tests).
 *
 * Cas canonique attrappé Phase 9 : Alice→Bob 5★ (publié) puis Bob→Alice 1★ (pending) within 24h
 * same-session = retaliation pattern punitif détecté.
 *
 * Limitation : si les 2 reviews sont pending (rating ≤ 2 simultanés), client SDK rules
 * limiteraient les reads — c'est pourquoi server-side Admin SDK est utilisé.
 *
 * @module
 */

import type { Timestamp } from 'firebase-admin/firestore';

// =====================================================================
// Constants
// =====================================================================

/** Q5=A heuristique fenêtre 24h same-session. */
export const RETALIATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// =====================================================================
// DI seam (test injection cohérent SC2 refundForInvite Admin SDK pattern)
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDbOverride: any = null;

/**
 * @internal — utilisé UNIQUEMENT par les tests pour injecter Admin SDK Firestore
 * connecté à l'emulator.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setRetaliationAdminDbForTesting(testDb: any): void {
  _adminDbOverride = testDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAdminDb(): Promise<any> {
  if (_adminDbOverride) return _adminDbOverride;
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
  return getFirestore();
}

// =====================================================================
// Types
// =====================================================================

export interface DetectRetaliationInput {
  /** ReviewId de la review en cours (exclu de la query pour éviter self-match si déjà write). */
  reviewId: string;
  /** Auteur de la review en cours. */
  reviewerId: string;
  /** Cible de la review en cours. */
  revieweeId: string;
  /** Session partagée. */
  sessionId: string;
  /** Timestamp ms de la review en cours (pour calcul deltaMs). */
  createdAtMs: number;
}

export interface DetectRetaliationResult {
  isRetaliation: boolean;
  /** Doc-id du suspect prior cross-review (si trouvé). */
  suspectReviewId?: string;
  /** Delta ms entre suspect.createdAt et current.createdAtMs (audit). */
  deltaMs?: number;
  /** Raison FR courte (audit). */
  reason?: string;
}

// =====================================================================
// detectRetaliation
// =====================================================================

/**
 * Pure helper : query reviews where reviewerId=revieweeId, revieweeId=reviewerId,
 * createdAt > now-24h, puis client-side filter sessionId === input.sessionId.
 *
 * Returns isRetaliation=true si match trouvé. Sinon false (silent — caller décide).
 *
 * Best-effort : ne throw jamais (console.warn si query fail). Caller fire-and-forget.
 */
export async function detectRetaliation(
  input: DetectRetaliationInput,
): Promise<DetectRetaliationResult> {
  const { reviewId, reviewerId, revieweeId, sessionId, createdAtMs } = input;
  if (!reviewerId || !revieweeId || !sessionId) {
    return { isRetaliation: false };
  }
  if (reviewerId === revieweeId) {
    return { isRetaliation: false };
  }

  try {
    const db = await getAdminDb();
    const { Timestamp: AdminTimestamp } = await import('firebase-admin/firestore');
    const cutoffMs = createdAtMs - RETALIATION_WINDOW_MS;
    // Query : prior reviews where reviewerId=revieweeId AND revieweeId=reviewerId
    //         AND createdAt within 24h before current.createdAtMs.
    // Index composite : reviews(reviewerId+revieweeId+createdAt DESC).
    const snap = await db
      .collection('reviews')
      .where('reviewerId', '==', revieweeId)
      .where('revieweeId', '==', reviewerId)
      .where('createdAt', '>=', AdminTimestamp.fromMillis(cutoffMs))
      .where('createdAt', '<', AdminTimestamp.fromMillis(createdAtMs))
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    if (snap.empty) {
      return { isRetaliation: false };
    }

    // Client-side filter sessionId === input.sessionId (Q5=A same-session heuristic)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const docSnap of snap.docs as any[]) {
      const data = docSnap.data();
      if (!data) continue;
      if (data.reviewId === reviewId) continue; // skip self-match (defensive)
      if (data.sessionId !== sessionId) continue; // different session → skip
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const priorCreatedAt = (data.createdAt as any)?.toMillis?.();
      if (typeof priorCreatedAt !== 'number') continue;
      const deltaMs = createdAtMs - priorCreatedAt;
      return {
        isRetaliation: true,
        suspectReviewId: data.reviewId,
        deltaMs,
        reason: `Cross-review same session within ${Math.round(deltaMs / 3600_000)}h (Q5=A 24h window)`,
      };
    }
    return { isRetaliation: false };
  } catch (err) {
    // Best-effort silent — caller fire-and-forget logs warning
    console.warn('[retaliationDetector] query failed (non-blocking)', err);
    return { isRetaliation: false };
  }
}

// =====================================================================
// applyRetaliationFlag — server-side update + adminAction (Admin SDK)
// =====================================================================

export interface ApplyRetaliationFlagInput {
  reviewId: string;
  suspectReviewId: string;
  deltaMs: number;
  reason: string;
}

export interface ApplyRetaliationFlagResult {
  ok: boolean;
  reason?: string;
}

/**
 * Update review.flaggedAsRetaliation + retaliationDeltaMs + retaliationSuspectReviewId
 * + log adminAction type='review_retaliation_flag' adminId='system' (Q6=A silent).
 *
 * Idempotent : skip si review.flaggedAsRetaliation déjà true.
 * Best-effort : caller (API route) fire-and-forget si fail.
 */
export async function applyRetaliationFlag(
  input: ApplyRetaliationFlagInput,
): Promise<ApplyRetaliationFlagResult> {
  const { reviewId, suspectReviewId, deltaMs, reason } = input;
  if (!reviewId || !suspectReviewId) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    const db = await getAdminDb();
    const { Timestamp: AdminTimestamp } = await import('firebase-admin/firestore');

    const ref = db.collection('reviews').doc(reviewId);
    const snap = await ref.get();
    if (!snap.exists) {
      return { ok: false, reason: 'review-not-found' };
    }
    const data = snap.data();
    if (data?.flaggedAsRetaliation === true) {
      return { ok: true, reason: 'already-flagged-idempotent' };
    }

    // Update review with flag
    await ref.update({
      flaggedAsRetaliation: true,
      retaliationDeltaMs: deltaMs,
      retaliationSuspectReviewId: suspectReviewId,
    });

    // Log adminAction (Q6=A silent — adminId='system')
    const adminActionRef = db.collection('adminActions').doc();
    await adminActionRef.set({
      actionId: adminActionRef.id,
      adminId: 'system',
      actionType: 'review_retaliation_flag',
      targetType: 'review',
      targetId: reviewId,
      reason,
      metadata: {
        suspectReviewId,
        deltaMs,
        deltaHours: Math.round(deltaMs / 3600_000),
      },
      createdAt: AdminTimestamp.now() as unknown as Timestamp,
    });

    return { ok: true };
  } catch (err) {
    console.warn('[retaliationDetector] applyRetaliationFlag failed (non-blocking)', err);
    return {
      ok: false,
      reason: `apply-failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
