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

import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { Report, SanctionLevel, UserSanction } from '@/types/firestore';
import { Timestamp } from 'firebase/firestore';
import { ReportError, getReportsDb, isAdminRole } from './_internal';

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

  // 2. Manual sanction si demandée
  let manualSanctionId: string | undefined;
  if (input.manualSanctionLevel) {
    const sanctionRef = doc(collection(fbDb, 'userSanctions'));
    manualSanctionId = sanctionRef.id;

    const isWarning = input.manualSanctionLevel === 'warning';
    const isPermanent = input.manualSanctionLevel === 'ban_permanent';
    let endsAt: Timestamp | undefined;
    if (!isWarning && !isPermanent) {
      const days = input.manualSanctionLevel === 'suspension_7d' ? 7 : 30;
      endsAt = Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const payload: Record<string, unknown> = {
      sanctionId: manualSanctionId,
      userId: report.reportedId,
      level: input.manualSanctionLevel,
      reason: 'manual_admin' as UserSanction['reason'],
      triggeringReportIds: [input.reportId],
      startsAt: serverTimestamp(),
      appealable: !isWarning,
      appealUsed: false,
      isActive: true,
      createdBy: input.adminId,
      createdAt: serverTimestamp(),
    };
    if (endsAt) payload.endsAt = endsAt;

    await setDoc(sanctionRef, payload);
  }

  return { manualSanctionId };
}
