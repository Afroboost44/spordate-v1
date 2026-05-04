/**
 * Phase 7 sub-chantier 3 commit 2/5 — createReport.
 *
 * Crée un report formel anonyme avec validations doctrine §9.sexies D :
 * - Anti-self : reporterId != reportedId
 * - Category enum : 6 catégories valides
 * - freeText OBLIGATOIRE (≥10 chars) si category='autre'
 * - Validation participation : reporter + reported partagent ≥1 session passée
 * - Window : refus si latest shared session.endAt < now - 30 jours
 * - Rate limit : refus si >3 reports émis par reporter rolling 24h
 * - Pas de dédup au create (doctrine §D.3 : 2 reports même paire ALLOWED, comptés 1 dans threshold)
 *
 * Auto-trigger sanction si threshold atteint (cf. _triggerSanctionStub) :
 * - 2 distinct reporters → suspension_7d auto
 * - 3+ distinct reporters → suspension_30d auto
 *
 * STUB Phase 7 commit 2/5 — l'auto-trigger appelle _triggerSanctionStub interne.
 * Commit 3/5 refactor vers triggerAutoSanction.ts avec wire email + appeal flow.
 *
 * Source = 'user' (l'autre source 'partner_no_show' est gérée par markNoShow commit 3/5).
 */

import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { Report, ReportCategory } from '@/types/firestore';
import { sendEmail } from '@/lib/email/sendEmail';
import {
  REPORT_CATEGORY_LABELS,
  ReportError,
  FREETEXT_MIN_LENGTH,
  RATE_LIMIT_PER_DAY,
  REPORT_WINDOW_DAYS,
  computeReportsThresholdAction,
  fetchReportEmailContext,
  findLatestSharedPastSession,
  getDailyReportCountByReporter,
  getDistinctReportersAgainst,
  getReportsDb,
} from './_internal';
import { triggerAutoSanction } from './triggerAutoSanction';

/** SLA admin response heures (doctrine §D.3 = 72h Phase 7). */
const ADMIN_REVIEW_SLA_HOURS = 72;

const VALID_CATEGORIES: ReportCategory[] = [
  'harassment_sexuel',
  'comportement_agressif',
  'fake_profile',
  'substance_etat_problematique',
  'no_show',
  'autre',
];

export interface CreateReportInput {
  reporterId: string;
  reportedId: string;
  category: ReportCategory;
  /** Obligatoire ≥10 chars si category='autre'. Optionnel sinon. */
  freeTextReason?: string;
  /** Si fourni, lié au sessionId. Sinon, latest shared trouvée automatiquement. */
  sessionId?: string;
  activityId?: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface CreateReportResult {
  reportId: string;
  /** True si une UserSanction a été déclenchée par cet appel (threshold atteint). */
  autoSanctionTriggered: boolean;
  /** sanctionId créé si autoSanctionTriggered, sinon undefined. */
  sanctionId?: string;
  /** Snapshot du count distinct reporters après ce report. */
  distinctReportersAfter: number;
}

export async function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  const now = input.now ?? new Date();

  // 1. Validation inputs basiques
  if (!input.reporterId || !input.reportedId) {
    throw new ReportError('invalid-uid', {
      reporterId: input.reporterId,
      reportedId: input.reportedId,
    });
  }
  if (input.reporterId === input.reportedId) {
    throw new ReportError('self-report', { uid: input.reporterId });
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    throw new ReportError('invalid-category', { category: input.category });
  }
  if (input.category === 'autre') {
    const ft = input.freeTextReason ?? '';
    if (ft.length < FREETEXT_MIN_LENGTH) {
      throw new ReportError('freetext-required', {
        length: ft.length,
        min: FREETEXT_MIN_LENGTH,
      });
    }
  }

  // 2. Validation participation : shared session past
  const sharedSession = await findLatestSharedPastSession(
    input.reporterId,
    input.reportedId,
    now,
  );
  if (!sharedSession) {
    throw new ReportError('no-shared-session', {
      reporterId: input.reporterId,
      reportedId: input.reportedId,
    });
  }

  // 3. Window check : refus si >30j depuis latest shared session.endAt
  const endsAtMs = sharedSession.endAt.toMillis();
  const windowEndMs = endsAtMs + REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() > windowEndMs) {
    throw new ReportError('report-window-closed', {
      sharedSessionId: sharedSession.sessionId,
      sessionEndAtMs: endsAtMs,
      windowEndMs,
    });
  }

  // 4. Rate limit anti-abus (rolling 24h, doctrine §D.3 + Q8)
  const dailyCount = await getDailyReportCountByReporter(input.reporterId, now);
  if (dailyCount >= RATE_LIMIT_PER_DAY) {
    throw new ReportError('rate-limit-exceeded', {
      reporterId: input.reporterId,
      dailyCount,
      limit: RATE_LIMIT_PER_DAY,
    });
  }

  // 5. Write Firestore (status='pending', source='user', server-managed champs absents)
  const fbDb = getReportsDb();
  const ref = doc(collection(fbDb, 'reports'));
  const reportId = ref.id;
  const payload: Record<string, unknown> = {
    reportId,
    reporterId: input.reporterId,
    reportedId: input.reportedId,
    category: input.category,
    status: 'pending' as const,
    source: 'user' as const,
    createdAt: serverTimestamp(),
  };
  if (input.freeTextReason) payload.freeTextReason = input.freeTextReason;
  if (input.sessionId) payload.sessionId = input.sessionId;
  if (input.activityId) payload.activityId = input.activityId;
  // Default sur sharedSession trouvée si pas explicitement passée (traçabilité)
  if (!input.sessionId) payload.sessionId = sharedSession.sessionId;
  if (!input.activityId) payload.activityId = sharedSession.activityId;

  await setDoc(ref, payload);

  // 6. Threshold compute après ce report (rolling 12mo, distinct reporters)
  const { count: distinctCount, triggeringReportIds } =
    await getDistinctReportersAgainst(input.reportedId, now);

  const action = computeReportsThresholdAction(distinctCount);

  let autoSanctionTriggered = false;
  let sanctionId: string | undefined;

  if (action.level !== null) {
    try {
      sanctionId = await triggerAutoSanction({
        userId: input.reportedId,
        reason: action.reason,
        level: action.level,
        triggeringReportIds,
      });
      autoSanctionTriggered = true;

      // Snapshot info report : autoSuspension applied
      await setDoc(
        ref,
        {
          autoSuspensionApplied: true,
          autoSuspensionDurationDays: action.level === 'suspension_7d' ? 7 : 30,
        },
        { merge: true },
      );
    } catch (err) {
      // Best-effort : report créé, sanction failed → admin la déclenchera manuellement
      console.error('[createReport] triggerAutoSanction failed (report still created)', {
        reportId,
        reportedId: input.reportedId,
        targetLevel: action.level,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 7 sub-chantier 3 commit 5/5 — best-effort sendEmail reportSubmitted au reporter
  try {
    const ctx = await fetchReportEmailContext({ userId: input.reporterId });
    if (ctx.email) {
      await sendEmail({
        to: ctx.email,
        templateName: 'reportSubmitted',
        templateData: {
          reporterName: ctx.displayName,
          categoryLabel: REPORT_CATEGORY_LABELS[input.category] ?? input.category,
          slaHours: ADMIN_REVIEW_SLA_HOURS,
        },
      });
    }
  } catch (err) {
    console.warn('[createReport] sendEmail reportSubmitted failed (non-blocking)', {
      reportId,
      reporterId: input.reporterId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    reportId,
    autoSanctionTriggered,
    sanctionId,
    distinctReportersAfter: distinctCount,
  };
}

// Re-export Report type for callers
export type { Report } from '@/types/firestore';
