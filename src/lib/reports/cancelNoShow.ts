/**
 * Phase 7 sub-chantier 3 commit 3/5 — cancelNoShow.
 *
 * Partner annule un no-show qu'il a marqué (typo fix, geste empathique).
 * Fenêtre 24h post-création du report (au-delà = figé, doctrine §F audit trail).
 *
 * Validations :
 *  - report existe + report.reporterId == partnerId (anti-spoofing)
 *  - report.source === 'partner_no_show' (pas un report user-side)
 *  - report.createdAt + 24h ≥ now (within 24h undo window)
 *  - report.status in ['pending', 'actioned'] (pas déjà dismissed)
 *
 * Update report : status='dismissed', decision='dismiss', decisionNote='partner cancel within 24h'.
 *
 * Edge case Phase 7 : si une UserSanction a été déclenchée par ce report
 * (triggeringReportIds includes reportId), elle reste active. Phase 8 polish
 * pourra recompute threshold + désactiver auto. Phase 7 = log warning admin
 * pour traitement manuel via admin dashboard sub-chantier 4.
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Report } from '@/types/firestore';
import { ReportError, getReportsDb } from './_internal';

/** Fenêtre undo pour partner après mark no-show (24h). */
export const NO_SHOW_CANCEL_WINDOW_HOURS = 24;

export interface CancelNoShowInput {
  /** Partner qui annule (doit == report.reporterId). */
  partnerId: string;
  reportId: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export async function cancelNoShow(input: CancelNoShowInput): Promise<void> {
  if (!input.partnerId || !input.reportId) {
    throw new ReportError('invalid-uid', {
      partnerId: input.partnerId,
      reportId: input.reportId,
    });
  }

  const now = input.now ?? new Date();
  const fbDb = getReportsDb();
  const ref = doc(fbDb, 'reports', input.reportId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new ReportError('report-not-found', { reportId: input.reportId });
  }
  const report = snap.data() as Report;

  if (report.source !== 'partner_no_show' || report.reporterId !== input.partnerId) {
    throw new ReportError('report-not-cancellable', {
      reportId: input.reportId,
      source: report.source,
      reportReporterId: report.reporterId,
      callerPartnerId: input.partnerId,
    });
  }

  if (report.status === 'dismissed') {
    throw new ReportError('report-not-cancellable', {
      reportId: input.reportId,
      reason: 'already-dismissed',
    });
  }

  const createdAtMs = report.createdAt?.toMillis?.() ?? 0;
  const cancelDeadlineMs = createdAtMs + NO_SHOW_CANCEL_WINDOW_HOURS * 60 * 60 * 1000;
  if (now.getTime() > cancelDeadlineMs) {
    throw new ReportError('cancel-window-closed', {
      reportId: input.reportId,
      createdAtMs,
      cancelDeadlineMs,
    });
  }

  // Phase 7 edge case : si une sanction avait été déclenchée par ce report,
  // elle reste active (pas de recompute). Log warning pour admin traitement.
  if ((report as Report).autoSuspensionApplied === true) {
    console.warn(
      '[cancelNoShow] sanction auto déclenchée par ce report — reste active. Admin doit overturn manuellement (Phase 8 polish : recompute threshold).',
      { reportId: input.reportId, reportedId: report.reportedId },
    );
  }

  await updateDoc(ref, {
    status: 'dismissed',
    decision: 'dismiss',
    decisionNote: `partner cancel within ${NO_SHOW_CANCEL_WINDOW_HOURS}h`,
    resolvedAt: serverTimestamp(),
  });
}
