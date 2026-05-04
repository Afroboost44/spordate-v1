/**
 * Phase 7 sub-chantier 3 commit 3/5 — getNoShowsForUser.
 *
 * Liste les no-shows enregistrés contre userId rolling 90j (doctrine §D.5).
 * Tri DESC par createdAt. Index composite `reportedId+category+createdAt DESC`
 * (déclaré commit 1/5).
 *
 * Usage : admin dashboard (sub-chantier 4) pour afficher count + history,
 * partner check-in UI (commit 5/5) pour hint sur les "no-show réguliers".
 */

import {
  Timestamp,
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type { Report } from '@/types/firestore';
import { NOSHOW_ROLLING_DAYS, getReportsDb } from './_internal';

export interface GetNoShowsForUserOptions {
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
  /** Override window rolling. Défaut NOSHOW_ROLLING_DAYS=90. */
  rollingDays?: number;
}

export async function getNoShowsForUser(
  userId: string,
  opts: GetNoShowsForUserOptions = {},
): Promise<Report[]> {
  if (!userId) return [];
  const fbDb = getReportsDb();
  const now = opts.now ?? new Date();
  const days = opts.rollingDays ?? NOSHOW_ROLLING_DAYS;
  const cutoff = Timestamp.fromMillis(now.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const snap = await getDocs(
      query(
        collection(fbDb, 'reports'),
        where('reportedId', '==', userId),
        where('category', '==', 'no_show'),
        where('createdAt', '>=', cutoff),
        orderBy('createdAt', 'desc'),
      ),
    );
    return snap.docs.map((d) => d.data() as Report);
  } catch (err) {
    console.warn('[getNoShowsForUser] Index not ready, fallback without orderBy:', err);
    const snap = await getDocs(
      query(
        collection(fbDb, 'reports'),
        where('reportedId', '==', userId),
        where('category', '==', 'no_show'),
      ),
    );
    const cutoffMs = cutoff.toMillis();
    return snap.docs
      .map((d) => d.data() as Report)
      .filter((r) => (r.createdAt?.toMillis?.() ?? 0) >= cutoffMs)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }
}
