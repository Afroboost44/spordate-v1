/**
 * Phase 7 sub-chantier 3 commit 2/5 — Reports service public API.
 *
 * Module index : re-exports services + types + DI seam pour tests.
 *
 * Usage Phase 7 sub-chantiers 3-5 (UI + admin + integration) :
 *
 *   import { createReport, dismissReport, sustainReport } from '@/lib/reports';
 *
 * Cf. architecture.md §9.sexies D + F pour la doctrine reports + sanctions complète.
 */

// Service functions
export { createReport, type CreateReportInput, type CreateReportResult } from './createReport';
export {
  getReportsForReporter,
  type GetReportsForReporterOptions,
} from './getReportsForReporter';
export {
  getReportsAgainst,
  type GetReportsAgainstOptions,
  type GetReportsAgainstResult,
} from './getReportsAgainst';
export { dismissReport, type DismissReportInput } from './dismissReport';
export {
  sustainReport,
  type SustainReportInput,
  type SustainReportResult,
} from './sustainReport';
// Phase 7 sub-chantier 3 commit 3/5 — no-show + sanctions + appeals
export {
  triggerAutoSanction,
  type TriggerAutoSanctionInput,
} from './triggerAutoSanction';
export {
  markNoShow,
  type MarkNoShowInput,
  type MarkNoShowResult,
  NO_SHOW_GRACE_MINUTES,
} from './markNoShow';
export {
  getNoShowsForUser,
  type GetNoShowsForUserOptions,
} from './getNoShowsForUser';
export { getActiveUserSanction } from './getActiveUserSanction';
export { appealSanction, type AppealSanctionInput } from './appealSanction';
export {
  cancelNoShow,
  type CancelNoShowInput,
  NO_SHOW_CANCEL_WINDOW_HOURS,
} from './cancelNoShow';

// Errors + helpers + constants
export {
  ReportError,
  type ReportErrorCode,
  RATE_LIMIT_PER_DAY,
  REPORT_WINDOW_DAYS,
  REPORTS_ROLLING_MONTHS,
  NOSHOW_ROLLING_DAYS,
  FREETEXT_MIN_LENGTH,
  APPEAL_NOTE_MIN_LENGTH,
  computeReportsThresholdAction,
  computeNoShowThresholdAction,
  findLatestSharedPastSession,
  getDistinctReportersAgainst,
  getDailyReportCountByReporter,
  isAdminRole,
} from './_internal';

// Test seams (utilisés uniquement par tests/reports/*.test.ts)
export { __setReportsDbForTesting } from './_internal';
