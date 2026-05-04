/**
 * Phase 7 sub-chantier 1 commit 2/6 — getReviews.
 *
 * 3 query functions :
 * - getReviewsByActivity(activityId, opts) : reviews publiées d'une activité (public-facing)
 * - getMyReviews(userId) : reviews dont l'utilisateur est l'auteur (incl. pending)
 * - getPendingReviewsForAdmin(opts) : queue modération admin (status='pending')
 *
 * Tri par défaut : createdAt DESC (plus récentes en premier).
 */

import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type { Review, ReviewStatus } from '@/types/firestore';
import { getReviewsDb } from './_internal';

export interface GetReviewsByActivityOptions {
  /** Filtre status. Défaut 'published' uniquement (public-facing). */
  statusFilter?: ReviewStatus[];
  /** Limite résultats. Défaut 50. */
  limit?: number;
}

export async function getReviewsByActivity(
  activityId: string,
  opts?: GetReviewsByActivityOptions,
): Promise<Review[]> {
  const fbDb = getReviewsDb();
  const statusFilter = opts?.statusFilter ?? ['published'];
  const lim = opts?.limit ?? 50;

  const q = query(
    collection(fbDb, 'reviews'),
    where('activityId', '==', activityId),
    where('status', 'in', statusFilter),
    orderBy('createdAt', 'desc'),
    fbLimit(lim),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Review);
}

/**
 * Reviews dont l'utilisateur est l'AUTEUR (peut inclure pending+published+rejected).
 * Permet à l'utilisateur de voir l'état de ses reviews soumises (pending modération, etc.).
 */
export async function getMyReviews(userId: string): Promise<Review[]> {
  const fbDb = getReviewsDb();
  const q = query(
    collection(fbDb, 'reviews'),
    where('reviewerId', '==', userId),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Review);
}

export interface GetPendingReviewsForAdminOptions {
  /** Limite résultats. Défaut 100 (queue modération raisonnable). */
  limit?: number;
}

/**
 * Queue modération admin : toutes les reviews status='pending' (1-2★ en attente
 * de validation pré-publication).
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler. Le service
 * lui-même ne fait pas le check (rules/ admin UI le font).
 */
export async function getPendingReviewsForAdmin(
  opts?: GetPendingReviewsForAdminOptions,
): Promise<Review[]> {
  const fbDb = getReviewsDb();
  const lim = opts?.limit ?? 100;
  const q = query(
    collection(fbDb, 'reviews'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'asc'), // FIFO : plus anciennes pending d'abord
    fbLimit(lim),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Review);
}
