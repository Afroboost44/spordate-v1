/**
 * Phase 7 sub-chantier 1 commit 2/6 — softDeleteReview.
 *
 * Suppression soft d'une review : par l'auteur (volonté de retirer) OU par admin
 * (modération post-publication).
 *
 * Pas de hard delete (audit trail conservé). Effet :
 * - status = 'rejected'
 * - comment = '' (anonymisation contenu)
 * - deletedAt = now (flag soft delete)
 * - deletedBy = userId (auteur ou admin)
 * - Pas de modification du rating, reviewerId, revieweeId, etc. (intégrité audit)
 *
 * Note : ce service n'est PAS soumis à la rule firestore (delete admin-only) car
 * il fait un UPDATE, pas un DELETE. Le rule update permet à l'auteur de modifier
 * sa review dans la fenêtre éditable, mais ici on touche status/comment/deletedAt
 * qui sont en-dehors du scope rule update (status immuable côté client). Donc
 * cette fonction doit être appelée côté SERVEUR (Admin SDK bypass rules) OU
 * via un endpoint API qui valide l'autorisation. Phase 7 sub-chantier 4 (admin
 * dashboard) wireera l'endpoint avec auth check.
 *
 * Pour l'instant Phase 7 commit 2/6 : la fonction expose la logique métier,
 * Phase 8 wireera l'endpoint sécurisé.
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Review } from '@/types/firestore';
import { ReviewError, getReviewsDb } from './_internal';

export interface SoftDeleteReviewInput {
  reviewId: string;
  /** UID de l'utilisateur qui demande la suppression (vérification ci-dessous). */
  deletedBy: string;
  /** Si true, bypass le check 'reviewer-self'. Pour usage admin dashboard. */
  isAdmin?: boolean;
}

export async function softDeleteReview(input: SoftDeleteReviewInput): Promise<void> {
  const fbDb = getReviewsDb();
  const ref = doc(fbDb, 'reviews', input.reviewId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReviewError('review-not-found', { reviewId: input.reviewId });
  }
  const review = snap.data() as Review;

  // Vérif autorisation : reviewer self OU admin (caller passe isAdmin=true)
  const isAuthorOrAdmin = input.isAdmin === true || review.reviewerId === input.deletedBy;
  if (!isAuthorOrAdmin) {
    throw new ReviewError('not-authorized', {
      reviewId: input.reviewId,
      deletedBy: input.deletedBy,
      reviewerId: review.reviewerId,
    });
  }

  // Soft delete : status='rejected', comment vidé, traces audit
  await updateDoc(ref, {
    status: 'rejected',
    comment: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deletedAt: serverTimestamp() as any,
    deletedBy: input.deletedBy,
  });
}
