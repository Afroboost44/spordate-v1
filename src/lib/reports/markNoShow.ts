/**
 * Phase 7 sub-chantier 3 commit 3/5 — markNoShow.
 *
 * Partner-only flow : marque un participant comme no-show post-session.
 * Doctrine §9.sexies D.5 : auto-création Report catégorie 'no_show' source='partner_no_show'.
 *
 * Validations :
 *  - sessionId existe + activity.partnerId == partnerId (partner authorized)
 *  - userId a un booking confirmed sur cette session
 *  - session.endAt + 30 min ≤ now (grâce 30 min retard, doctrine §D.5)
 *  - Anti-doublon : pas de report existant {source='partner_no_show', sessionId, reportedId}
 *
 * Threshold compute rolling 90j :
 *  - 1 no-show → warning sanction
 *  - 2 no-show → warning sanction (admin voit count via getNoShowsForUser)
 *  - 3 no-show → suspension_30d + refundDue=true (doctrine §D.5 niveau 3)
 *  - 4+ no-show → ban_permanent
 *
 * Best-effort wire email noShowWarningNotice → TODO commit 5/5.
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { Activity, Booking, Session } from '@/types/firestore';
import { sendEmail } from '@/lib/email/sendEmail';
import {
  NOSHOW_ROLLING_DAYS,
  ReportError,
  computeNoShowThresholdAction,
  fetchReportEmailContext,
  getReportsDb,
} from './_internal';
import { NO_SHOW_CANCEL_WINDOW_HOURS } from './cancelNoShow';
import { triggerAutoSanction } from './triggerAutoSanction';
import { EXCUSE_WINDOW_HOURS_BEFORE_SESSION } from '@/lib/excuses';

/** Grâce 30 min après session.endAt avant marquage no-show (doctrine §D.5). */
export const NO_SHOW_GRACE_MINUTES = 30;

export interface MarkNoShowInput {
  /** Partner uid qui marque (vérifié vs activity.partnerId). */
  partnerId: string;
  sessionId: string;
  /** Participant uid marqué no-show. */
  userId: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface MarkNoShowResult {
  reportId: string;
  /** sanctionId créé si threshold no-show déclenche un level. */
  sanctionId?: string;
  /** Count no-shows rolling 90j après ce mark. */
  noShowCountAfter: number;
}

export async function markNoShow(input: MarkNoShowInput): Promise<MarkNoShowResult> {
  const now = input.now ?? new Date();

  if (!input.partnerId || !input.sessionId || !input.userId) {
    throw new ReportError('invalid-uid', {
      partnerId: input.partnerId,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }
  if (input.partnerId === input.userId) {
    throw new ReportError('self-report', { uid: input.partnerId });
  }

  const fbDb = getReportsDb();

  // 1. Session existe
  const sessionSnap = await getDoc(doc(fbDb, 'sessions', input.sessionId));
  if (!sessionSnap.exists()) {
    throw new ReportError('session-not-found', { sessionId: input.sessionId });
  }
  const session = sessionSnap.data() as Session;

  // 2. Partner authorized via activity.partnerId
  const activitySnap = await getDoc(doc(fbDb, 'activities', session.activityId));
  if (!activitySnap.exists()) {
    throw new ReportError('session-not-found', {
      sessionId: input.sessionId,
      reason: 'activity-missing',
    });
  }
  const activity = activitySnap.data() as Activity;
  if (activity.partnerId !== input.partnerId) {
    throw new ReportError('not-partner', {
      partnerId: input.partnerId,
      activityPartnerId: activity.partnerId,
    });
  }

  // 3. Grâce 30 min (session terminée + délai)
  const sessionEndMs = session.endAt.toMillis();
  const graceEndMs = sessionEndMs + NO_SHOW_GRACE_MINUTES * 60 * 1000;
  if (now.getTime() < graceEndMs) {
    throw new ReportError('grace-period-active', {
      sessionId: input.sessionId,
      sessionEndMs,
      graceEndMs,
      nowMs: now.getTime(),
    });
  }

  // 4. userId a booking confirmed sur cette session
  const bookingsSnap = await getDocs(
    query(
      collection(fbDb, 'bookings'),
      where('userId', '==', input.userId),
      where('sessionId', '==', input.sessionId),
    ),
  );
  const confirmedBooking = bookingsSnap.docs
    .map((d) => d.data() as Booking)
    .find((b) => b.status === 'confirmed');
  if (!confirmedBooking) {
    throw new ReportError('not-confirmed-booker', {
      userId: input.userId,
      sessionId: input.sessionId,
    });
  }

  // 4.bis Phase 9 SC5 c2/4 — Excuse pré-session check (Q1=A 2h grace).
  // Si user a déposé une excuse ≥ EXCUSE_WINDOW_HOURS_BEFORE_SESSION (2h) avant
  // session.startAt → markNoShow skip (no report created, no threshold compute).
  // Best-effort : si query Firestore fail (rules / network) → continue normal flow
  // (graceful degradation — partner peut toujours marquer no-show, doctrine cohérente).
  try {
    const excusesSnap = await getDocs(
      query(
        collection(fbDb, 'excuses'),
        where('userId', '==', input.userId),
        where('sessionId', '==', input.sessionId),
      ),
    );
    if (!excusesSnap.empty) {
      const excuse = excusesSnap.docs[0].data();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const excuseCreatedAtMs = (excuse.createdAt as any)?.toMillis?.();
      if (typeof excuseCreatedAtMs === 'number') {
        const sessionStartMs = session.startAt.toMillis();
        const excuseLeadMs = sessionStartMs - excuseCreatedAtMs;
        const windowMs = EXCUSE_WINDOW_HOURS_BEFORE_SESSION * 60 * 60 * 1000;
        if (excuseLeadMs >= windowMs) {
          // Excuse valide → user-excused (audit trail préservé via /excuses/{id})
          throw new ReportError('user-excused', {
            userId: input.userId,
            sessionId: input.sessionId,
            excuseId: excuse.excuseId,
            excuseLeadMs,
            windowMs,
          });
        }
        // Excuse trop tardive (< 2h avant) : ignored — markNoShow normal flow.
        // L'excuse reste persistée dans /excuses/ pour audit, mais ne protège pas.
      }
    }
  } catch (err) {
    // Re-throw ReportError 'user-excused' (intentional flow control)
    if (err instanceof ReportError && err.code === 'user-excused') throw err;
    // Best-effort silent : autres erreurs (rules, network) → continue normal markNoShow
    console.warn('[markNoShow] excuse pre-check failed (non-blocking, continue normal flow)', {
      sessionId: input.sessionId,
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 5. Anti-doublon : pas de report existant pour cette paire (sessionId, userId, source)
  const existingSnap = await getDocs(
    query(
      collection(fbDb, 'reports'),
      where('reportedId', '==', input.userId),
      where('sessionId', '==', input.sessionId),
    ),
  );
  const alreadyMarked = existingSnap.docs
    .map((d) => d.data())
    .some((r) => r.source === 'partner_no_show');
  if (alreadyMarked) {
    throw new ReportError('duplicate-no-show', {
      userId: input.userId,
      sessionId: input.sessionId,
    });
  }

  // 6. Create Report (source='partner_no_show', category='no_show')
  const ref = doc(collection(fbDb, 'reports'));
  const reportId = ref.id;
  await setDoc(ref, {
    reportId,
    reporterId: input.partnerId,
    reportedId: input.userId,
    category: 'no_show' as const,
    status: 'pending' as const,
    source: 'partner_no_show' as const,
    sessionId: input.sessionId,
    activityId: session.activityId,
    createdAt: serverTimestamp(),
  });

  // 7. Threshold compute rolling 90j sur reportedId où category='no_show'
  const cutoffMs = now.getTime() - NOSHOW_ROLLING_DAYS * 24 * 60 * 60 * 1000;
  const noShowSnap = await getDocs(
    query(
      collection(fbDb, 'reports'),
      where('reportedId', '==', input.userId),
      where('category', '==', 'no_show'),
      where('createdAt', '>=', Timestamp.fromMillis(cutoffMs)),
    ),
  );
  const noShowCountAfter = noShowSnap.size;
  const triggeringReportIds = noShowSnap.docs.map((d) => d.id);

  const action = computeNoShowThresholdAction(noShowCountAfter);

  let sanctionId: string | undefined;
  if (action.level !== null) {
    try {
      sanctionId = await triggerAutoSanction({
        userId: input.userId,
        level: action.level,
        reason: action.reason,
        triggeringReportIds,
        refundDue: action.refundDue || undefined,
      });

      // Snapshot sur le report
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: any = { autoSuspensionApplied: true };
      if (action.level === 'suspension_30d') update.autoSuspensionDurationDays = 30;
      else if (action.level === 'suspension_7d') update.autoSuspensionDurationDays = 7;
      await setDoc(ref, update, { merge: true });
    } catch (err) {
      console.error('[markNoShow] triggerAutoSanction failed (report still created)', {
        reportId,
        userId: input.userId,
        targetLevel: action.level,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 7 sub-chantier 3 commit 5/5 — best-effort sendEmail (2 emails : user + partner)
  // Doctrine : intégrité du marquage > email delivery (jamais throw).
  try {
    const userCtx = await fetchReportEmailContext({
      userId: input.userId,
      activityId: session.activityId,
    });
    if (userCtx.email) {
      const partnerFallback = userCtx.lang === 'en' ? 'the partner' : userCtx.lang === 'de' ? 'der/die Partner:in' : 'le partenaire';
      const sessionFallback = userCtx.lang === 'en' ? 'the session' : userCtx.lang === 'de' ? 'die Session' : 'la session';
      const partnerName = activity.partnerName ?? partnerFallback;
      await sendEmail({
        to: userCtx.email,
        templateName: 'noShowWarningNotice',
        templateData: {
          userName: userCtx.displayName,
          sessionTitle: userCtx.sessionTitle || sessionFallback,
          partnerName,
          noShowCount: noShowCountAfter,
        },
        lang: userCtx.lang,
      });
    }
  } catch (err) {
    console.warn('[markNoShow] sendEmail noShowWarningNotice (user) failed (non-blocking)', {
      reportId,
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const partnerCtx = await fetchReportEmailContext({
      userId: input.partnerId,
      activityId: session.activityId,
    });
    const userCtxForPartner = await fetchReportEmailContext({ userId: input.userId });
    if (partnerCtx.email) {
      const localeMap = { fr: 'fr-CH', en: 'en-GB', de: 'de-CH' } as const;
      const sessionDate = session.startAt?.toDate
        ? session.startAt.toDate().toLocaleDateString(localeMap[partnerCtx.lang], {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const userFallback =
        partnerCtx.lang === 'en' ? 'the participant' : partnerCtx.lang === 'de' ? 'die teilnehmende Person' : 'le participant';
      const sessionFallback =
        partnerCtx.lang === 'en' ? 'the session' : partnerCtx.lang === 'de' ? 'die Session' : 'la session';
      await sendEmail({
        to: partnerCtx.email,
        templateName: 'partnerNoShowConfirmed',
        templateData: {
          partnerName: partnerCtx.displayName,
          userName: userCtxForPartner.displayName || userFallback,
          sessionTitle: partnerCtx.sessionTitle || sessionFallback,
          sessionDate,
          cancelWindowHours: NO_SHOW_CANCEL_WINDOW_HOURS,
        },
        lang: partnerCtx.lang,
      });
    }
  } catch (err) {
    console.warn('[markNoShow] sendEmail partnerNoShowConfirmed failed (non-blocking)', {
      reportId,
      partnerId: input.partnerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { reportId, sanctionId, noShowCountAfter };
}
