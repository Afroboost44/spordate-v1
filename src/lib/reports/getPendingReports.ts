/**
 * Phase 7 sub-chantier 4 commit 1/4 — getPendingReports.
 *
 * Admin queue : liste reports status='pending' triés par priorité catégorie
 * (doctrine §D.2 — urgent rouge → basse vert) puis FIFO createdAt ASC.
 *
 * Sort applied client-side (vs Firestore orderBy) car priority est dérivée
 * de category enum — pas un champ Firestore. Le tri par status='pending' utilise
 * l'index `status+createdAt DESC` déjà déclaré.
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler. Le service
 * lui-même ne fait pas le check (rules + admin UI le font).
 */

import {
  collection,
  getDocs,
  limit as fbLimit,
  query,
  where,
} from 'firebase/firestore';
import type { Report } from '@/types/firestore';
import { REPORT_CATEGORY_PRIORITY, getReportsDb } from './_internal';

export interface GetPendingReportsOptions {
  /** Max docs retournés. Défaut 100 (admin queue typique). */
  limit?: number;
}

export async function getPendingReports(
  opts: GetPendingReportsOptions = {},
): Promise<Report[]> {
  const fbDb = getReportsDb();
  const lim = opts.limit ?? 100;

  const snap = await getDocs(
    query(collection(fbDb, 'reports'), where('status', '==', 'pending'), fbLimit(lim)),
  );
  const reports = snap.docs.map((d) => d.data() as Report);

  // Sort par priorité (asc — urgent first) puis createdAt ASC (FIFO oldest first)
  reports.sort((a, b) => {
    const prioA = REPORT_CATEGORY_PRIORITY[a.category] ?? 99;
    const prioB = REPORT_CATEGORY_PRIORITY[b.category] ?? 99;
    if (prioA !== prioB) return prioA - prioB;
    const aMs = a.createdAt?.toMillis?.() ?? 0;
    const bMs = b.createdAt?.toMillis?.() ?? 0;
    return aMs - bMs;
  });

  return reports;
}
