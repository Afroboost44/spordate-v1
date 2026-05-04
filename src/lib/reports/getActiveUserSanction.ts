/**
 * Phase 7 sub-chantier 3 commit 3/5 — getActiveUserSanction.
 *
 * Fast check : retourne la UserSanction active courante du user (la plus récente).
 * Utilisé par :
 *  - SanctionBanner UI (commit 5/5) : affichage banner sticky si sanction active
 *  - Login flow (Q6) : check au login + setInterval 5 min
 *  - Action gating (booking, etc.) : refuser actions si user banni/suspendu
 *
 * Index requis : `userId+isActive+createdAt DESC` (déclaré commit 1/5).
 *
 * Note : si endsAt < now, on retourne quand même la sanction. Le caller décide
 * si appeler updateDoc(isActive=false) (cleanup expiry). Phase 8 polish : cron
 * périodique qui désactive les sanctions expirées en batch.
 */

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type { UserSanction } from '@/types/firestore';
import { getReportsDb } from './_internal';

export async function getActiveUserSanction(userId: string): Promise<UserSanction | null> {
  if (!userId) return null;
  const fbDb = getReportsDb();

  try {
    const snap = await getDocs(
      query(
        collection(fbDb, 'userSanctions'),
        where('userId', '==', userId),
        where('isActive', '==', true),
        orderBy('createdAt', 'desc'),
        limit(1),
      ),
    );
    if (snap.empty) return null;
    return snap.docs[0].data() as UserSanction;
  } catch (err) {
    console.warn('[getActiveUserSanction] Index not ready, fallback without orderBy:', err);
    const snap = await getDocs(
      query(
        collection(fbDb, 'userSanctions'),
        where('userId', '==', userId),
        where('isActive', '==', true),
      ),
    );
    if (snap.empty) return null;
    const sanctions = snap.docs.map((d) => d.data() as UserSanction);
    sanctions.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    return sanctions[0];
  }
}
