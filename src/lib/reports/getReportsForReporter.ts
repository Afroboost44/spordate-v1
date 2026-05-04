/**
 * Phase 7 sub-chantier 3 commit 2/5 — getReportsForReporter.
 *
 * Liste des reports émis par un user (pour vérif rate-limit + history personnelle).
 *
 * Mode 'rate-limit' : reports rolling 24h (utilisé pour UI rate-limit check pré-submit
 * et tests RP17).
 * Mode 'all' : full history du reporter (audit perso, page settings éventuelle).
 *
 * Index requis : `reporterId+createdAt DESC` (déclaré commit 1/5).
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
import { getReportsDb } from './_internal';

export interface GetReportsForReporterOptions {
  /** 'rate-limit' = rolling 24h, 'all' = full history. Défaut 'all'. */
  scope?: 'rate-limit' | 'all';
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export async function getReportsForReporter(
  reporterId: string,
  opts: GetReportsForReporterOptions = {},
): Promise<Report[]> {
  if (!reporterId) return [];
  const fbDb = getReportsDb();
  const now = opts.now ?? new Date();
  const scope = opts.scope ?? 'all';

  try {
    if (scope === 'rate-limit') {
      const cutoff = Timestamp.fromMillis(now.getTime() - 24 * 60 * 60 * 1000);
      const snap = await getDocs(
        query(
          collection(fbDb, 'reports'),
          where('reporterId', '==', reporterId),
          where('createdAt', '>=', cutoff),
          orderBy('createdAt', 'desc'),
        ),
      );
      return snap.docs.map((d) => d.data() as Report);
    }

    // scope === 'all'
    const snap = await getDocs(
      query(
        collection(fbDb, 'reports'),
        where('reporterId', '==', reporterId),
        orderBy('createdAt', 'desc'),
      ),
    );
    return snap.docs.map((d) => d.data() as Report);
  } catch (err) {
    console.warn('[getReportsForReporter] Index not ready, fallback without orderBy:', err);
    const snap = await getDocs(
      query(collection(fbDb, 'reports'), where('reporterId', '==', reporterId)),
    );
    const results = snap.docs.map((d) => d.data() as Report);
    if (scope === 'rate-limit') {
      const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
      return results.filter((r) => r.createdAt?.toMillis?.() >= cutoffMs);
    }
    return results.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });
  }
}
