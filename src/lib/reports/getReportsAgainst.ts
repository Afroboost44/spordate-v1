/**
 * Phase 7 sub-chantier 3 commit 2/5 — getReportsAgainst.
 *
 * Liste + count distinct reporters des reports contre reportedId rolling 12 mois.
 * Utilisé par admin queue (commit 4/5) et threshold compute interne (createReport).
 *
 * Anonymat doctrine §D.1 : ce service NE DOIT être appelé que par admin OU par le
 * service interne (createReport). Pas exposé UI user-side.
 *
 * Index requis : `reportedId+createdAt DESC` (déclaré commit 1/5).
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
import { REPORTS_ROLLING_MONTHS, getDistinctReportersAgainst, getReportsDb } from './_internal';

export interface GetReportsAgainstResult {
  reports: Report[];
  /** Count distinct reporters (dédup doctrine §D.3). */
  distinctReportersCount: number;
  /** 1 reportId par distinct reporter (le plus récent). Pour passage triggeringReportIds. */
  triggeringReportIds: string[];
}

export interface GetReportsAgainstOptions {
  /** Window rolling. Défaut REPORTS_ROLLING_MONTHS=12. */
  rollingMonths?: number;
  /** Override pour tests. Défaut new Date(). */
  now?: Date;
}

export async function getReportsAgainst(
  reportedId: string,
  opts: GetReportsAgainstOptions = {},
): Promise<GetReportsAgainstResult> {
  if (!reportedId) {
    return { reports: [], distinctReportersCount: 0, triggeringReportIds: [] };
  }

  const now = opts.now ?? new Date();
  const months = opts.rollingMonths ?? REPORTS_ROLLING_MONTHS;
  const fbDb = getReportsDb();
  const cutoff = Timestamp.fromMillis(now.getTime() - months * 30 * 24 * 60 * 60 * 1000);

  let reports: Report[] = [];
  try {
    const snap = await getDocs(
      query(
        collection(fbDb, 'reports'),
        where('reportedId', '==', reportedId),
        where('createdAt', '>=', cutoff),
        orderBy('createdAt', 'desc'),
      ),
    );
    reports = snap.docs.map((d) => d.data() as Report);
  } catch (err) {
    console.warn('[getReportsAgainst] Index not ready, fallback without orderBy:', err);
    const snap = await getDocs(
      query(collection(fbDb, 'reports'), where('reportedId', '==', reportedId)),
    );
    const cutoffMs = cutoff.toMillis();
    reports = snap.docs
      .map((d) => d.data() as Report)
      .filter((r) => (r.createdAt?.toMillis?.() ?? 0) >= cutoffMs)
      .sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() ?? 0;
        const bMs = b.createdAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });
  }

  // Re-utilise helper pour distinct count + triggeringReportIds (cohérent createReport)
  const { count, triggeringReportIds } = await getDistinctReportersAgainst(reportedId, now);

  return {
    reports,
    distinctReportersCount: count,
    triggeringReportIds,
  };
}
