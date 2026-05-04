/**
 * Spordateur — Phase 7 sub-chantier 1 commit 4/6
 * getReviewerProfiles — batch fetch des profils reviewers pour affichage nominatif.
 *
 * Logique :
 * - Filtre les reviews avec anonymized=false (3-5★) — les anonymized=true (1-2★)
 *   ne nécessitent pas de fetch profil (affichées comme "Membre Spordateur")
 * - Extrait les reviewerIds uniques (dédup)
 * - Batch fetch users/{uid} en parallèle via Promise.all
 * - Retourne Map<uid, ReviewerProfile> consommée par ReviewsList
 *
 * Pas de cache — Phase 9 polish pourra ajouter SWR/cache layer pour optimiser.
 */

import { doc, getDoc } from 'firebase/firestore';
import type { Review, UserProfile } from '@/types/firestore';
import { getReviewsDb } from './_internal';

export interface ReviewerProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
}

/**
 * Fetch les profils des reviewers nominatifs (anonymized=false).
 *
 * @param reviews liste des reviews à résoudre
 * @returns Map<uid, ReviewerProfile> — uniquement uids non-anonymisés trouvés en DB.
 *          Reviewers introuvables (compte supprimé, etc.) sont silencieusement ignorés
 *          (ReviewsList retombera sur "Membre Spordateur" via le fallback existant).
 */
export async function getReviewerProfiles(
  reviews: Review[],
): Promise<Map<string, ReviewerProfile>> {
  const fbDb = getReviewsDb();

  // Filter non-anonymized reviewer IDs (uniques)
  const uniqueIds = Array.from(
    new Set(reviews.filter((r) => !r.anonymized).map((r) => r.reviewerId)),
  );

  if (uniqueIds.length === 0) return new Map();

  const profiles = await Promise.all(
    uniqueIds.map(async (uid) => {
      try {
        const snap = await getDoc(doc(fbDb, 'users', uid));
        if (!snap.exists()) return null;
        const data = snap.data() as UserProfile;
        return {
          uid,
          displayName: data.displayName || 'Membre Spordateur',
          photoURL: data.photoURL || undefined,
        } as ReviewerProfile;
      } catch (err) {
        console.warn(`[getReviewerProfiles] Failed to fetch user ${uid}`, err);
        return null;
      }
    }),
  );

  const map = new Map<string, ReviewerProfile>();
  for (const p of profiles) {
    if (p) map.set(p.uid, p);
  }
  return map;
}
