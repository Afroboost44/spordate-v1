/**
 * Phase 7 sub-chantier 3 commit 2/5 — dismissReport.
 *
 * Admin action : marque un report comme dismissed (verdict = "non retenu").
 * Effets :
 *  - status pending → dismissed
 *  - reviewedBy/reviewedAt set
 *  - decision='dismiss'
 *  - decisionNote optionnelle
 *  - resolvedAt set
 *
 * PAS d'effet sur UserSanction existantes (si threshold avait déclenché auto-suspension,
 * elle reste — admin peut overturn via update userSanction directement Phase 7 commit 3/5
 * ou via admin dashboard sub-chantier 4).
 *
 * ⚠️ Caller responsibility : admin role validé service-side ET rule-side.
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Report } from '@/types/firestore';
import { ReportError, getReportsDb, isAdminRole } from './_internal';

export interface DismissReportInput {
  reportId: string;
  /** Admin uid qui dismiss. Vérification role faite ici. */
  adminId: string;
  /** Note libre admin (optionnel). */
  decisionNote?: string;
}

export async function dismissReport(input: DismissReportInput): Promise<void> {
  if (!input.reportId || !input.adminId) {
    throw new ReportError('invalid-uid', {
      reportId: input.reportId,
      adminId: input.adminId,
    });
  }

  // Defense service-side : vérifier role admin (defense-in-depth, complément rule)
  const isAdmin = await isAdminRole(input.adminId);
  if (!isAdmin) {
    throw new ReportError('not-admin', { adminId: input.adminId });
  }

  const fbDb = getReportsDb();
  const ref = doc(fbDb, 'reports', input.reportId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReportError('report-not-found', { reportId: input.reportId });
  }

  const report = snap.data() as Report;
  if (report.status !== 'pending') {
    throw new ReportError('report-not-pending', {
      reportId: input.reportId,
      currentStatus: report.status,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    status: 'dismissed',
    reviewedBy: input.adminId,
    reviewedAt: serverTimestamp(),
    decision: 'dismiss',
    resolvedAt: serverTimestamp(),
  };
  if (input.decisionNote) update.decisionNote = input.decisionNote;

  await updateDoc(ref, update);
}
