/**
 * Phase 7 sub-chantier 3 commit 2/5 — sustainReport.
 *
 * Admin action : marque un report comme sustained (verdict = "retenu").
 * Effets :
 *  - status pending → actioned
 *  - reviewedBy/reviewedAt set
 *  - decision='sustain'
 *  - decisionNote optionnelle
 *  - resolvedAt set
 *
 * Manual sanction trigger optionnel : si admin spécifie sanctionLevel, crée une
 * UserSanction avec reason='manual_admin' et triggeringReportIds=[reportId].
 *
 * ⚠️ Caller responsibility : admin role validé service-side ET rule-side.
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Report, SanctionLevel } from '@/types/firestore';
import { logAdminAction } from '@/lib/admin-actions';
import { ReportError, getReportsDb, isAdminRole } from './_internal';
import { triggerAutoSanction } from './triggerAutoSanction';

export interface SustainReportInput {
  reportId: string;
  /** Admin uid qui sustain. Vérification role faite ici. */
  adminId: string;
  /** Note libre admin (optionnel). */
  decisionNote?: string;
  /**
   * Si fourni, déclenche une sanction manuelle (reason='manual_admin').
   * Sinon : sustain enregistré sans sanction (admin pourra créer manuellement plus tard).
   */
  manualSanctionLevel?: SanctionLevel;
}

export interface SustainReportResult {
  /** sanctionId créé si manualSanctionLevel fourni, sinon undefined. */
  manualSanctionId?: string;
}

export async function sustainReport(input: SustainReportInput): Promise<SustainReportResult> {
  if (!input.reportId || !input.adminId) {
    throw new ReportError('invalid-uid', {
      reportId: input.reportId,
      adminId: input.adminId,
    });
  }

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

  // 1. Update report → actioned
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    status: 'actioned',
    reviewedBy: input.adminId,
    reviewedAt: serverTimestamp(),
    decision: 'sustain',
    resolvedAt: serverTimestamp(),
  };
  if (input.decisionNote) update.decisionNote = input.decisionNote;

  await updateDoc(ref, update);

  // Phase 7 sub-chantier 5 commit 2/3 — audit trail (sustain report)
  await logAdminAction({
    adminId: input.adminId,
    actionType: 'report_sustain',
    targetType: 'report',
    targetId: input.reportId,
    reason: input.decisionNote,
  });

  // 2. Manual sanction si demandée — délégué à triggerAutoSanction (cohérence flow)
  let manualSanctionId: string | undefined;
  if (input.manualSanctionLevel) {
    manualSanctionId = await triggerAutoSanction({
      userId: report.reportedId,
      level: input.manualSanctionLevel,
      reason: 'manual_admin',
      triggeringReportIds: [input.reportId],
      createdBy: input.adminId,
    });

    // Phase 7 sub-chantier 5 commit 2/3 — audit trail (manual sanction creation)
    await logAdminAction({
      adminId: input.adminId,
      actionType: 'sanction_manual_create',
      targetType: 'sanction',
      targetId: manualSanctionId,
      reason: input.decisionNote,
      metadata: { level: input.manualSanctionLevel, sourceReportId: input.reportId },
    });
  }

  return { manualSanctionId };
}
