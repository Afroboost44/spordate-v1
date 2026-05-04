/**
 * Spordateur — Phase 7 sub-chantier 3 commit 2/5
 * Reports service — internal helpers, DI seam, constants, error codes.
 *
 * Pattern DI seam cohérent src/lib/reviews/_internal.ts + src/lib/blocks/_internal.ts :
 * - __setReportsDbForTesting(db) → override Firestore client pour tests unit
 * - getReportsDb() retourne db importé de @/lib/firebase en prod
 *
 * Cf. architecture.md §9.sexies D + F pour la doctrine reports + sanctions complète.
 *
 * NOTE Phase 7 commit 2/5 : `_triggerSanctionStub` est une implémentation minimale
 * qui crée une UserSanction sans wire email + denorm. Commit 3/5 extrait cette
 * logique vers triggerAutoSanction.ts avec :
 *  - email userSanctionNotice via sendEmail
 *  - denorm preparation (NON écrit côté client Phase 7, cf. Q3 doctrine)
 *  - appeal flow flags
 */

import { db } from '@/lib/firebase';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  Booking,
  Report,
  SanctionLevel,
  SanctionReason,
  Session,
  UserProfile,
} from '@/types/firestore';

// =====================================================================
// DI seam (test injection)
// =====================================================================

let _testDb: Firestore | null = null;

export function __setReportsDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

export function getReportsDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}

// =====================================================================
// Constants (doctrine §9.sexies D + F)
// =====================================================================

/** Rate limit anti-abus doctrine §D.3 (rolling 24h). */
export const RATE_LIMIT_PER_DAY = 3;

/** Fenêtre report doctrine §D.4 : 30 jours post-session. */
export const REPORT_WINDOW_DAYS = 30;

/** Rolling window threshold compute reports généraux doctrine §D.3. */
export const REPORTS_ROLLING_MONTHS = 12;

/** Rolling window threshold compute no-show doctrine §D.5. */
export const NOSHOW_ROLLING_DAYS = 90;

/** Min length freeText pour category='autre' (cohérent rule create). */
export const FREETEXT_MIN_LENGTH = 10;

/** Min length appeal note (cohérent rule update userSanctions). */
export const APPEAL_NOTE_MIN_LENGTH = 20;

/**
 * Threshold compute reports généraux (rolling 12 mois, distinct reporters).
 * Doctrine §D.3 :
 *   1 → review humaine, PAS d'action auto
 *   2 → suspension_7d auto + review
 *   3+ → suspension_30d auto + review prioritaire
 */
export function computeReportsThresholdAction(distinctReporterCount: number): {
  level: SanctionLevel | null;
  reason: SanctionReason;
} {
  if (distinctReporterCount >= 3) return { level: 'suspension_30d', reason: 'reports_threshold' };
  if (distinctReporterCount === 2) return { level: 'suspension_7d', reason: 'reports_threshold' };
  // 0 ou 1 : pas d'action auto
  return { level: null, reason: 'reports_threshold' };
}

/**
 * Threshold compute no-show (rolling 90j, count brut sur reportedId où category='no_show').
 * Doctrine §D.5 :
 *   1 → warning email
 *   2 → warning + flag profil (admin voit le compteur ; service produit warning level)
 *   3 → suspension_30d + refundDue (refund partner)
 *   4+ → ban_permanent
 *
 * Note : 1er ET 2ème no-show produisent le même level='warning'. Le "flag" mentionné
 * doctrine pour le 2ème = signal admin via getNoShowsForUser (count >=2 visible queue).
 * Phase 9 polish pourra introduire un level intermédiaire si nécessaire.
 */
export function computeNoShowThresholdAction(noShowCount: number): {
  level: SanctionLevel | null;
  reason: SanctionReason;
  refundDue: boolean;
} {
  if (noShowCount >= 4) return { level: 'ban_permanent', reason: 'no_show_threshold', refundDue: false };
  if (noShowCount === 3) return { level: 'suspension_30d', reason: 'no_show_threshold', refundDue: true };
  if (noShowCount >= 1) return { level: 'warning', reason: 'no_show_threshold', refundDue: false };
  return { level: null, reason: 'no_show_threshold', refundDue: false };
}

// =====================================================================
// Error codes (machine-parseable)
// =====================================================================

export type ReportErrorCode =
  | 'self-report'
  | 'rate-limit-exceeded'
  | 'no-shared-session'
  | 'report-window-closed'
  | 'freetext-required'
  | 'invalid-category'
  | 'invalid-uid'
  | 'report-not-found'
  | 'report-not-pending'
  | 'not-admin'
  | 'invalid-decision'
  // No-show + sanctions specific (commit 3/5)
  | 'not-partner'
  | 'session-not-found'
  | 'grace-period-active'
  | 'not-confirmed-booker'
  | 'duplicate-no-show'
  | 'sanction-not-found'
  | 'not-sanction-owner'
  | 'not-appealable'
  | 'appeal-already-used'
  | 'appeal-note-too-short'
  | 'cancel-window-closed'
  | 'report-not-cancellable';

export class ReportError extends Error {
  constructor(
    public code: ReportErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ReportError';
  }
}

// =====================================================================
// Helpers : participation + shared session
// =====================================================================

/**
 * Récupère les sessionIds passés (endAt < now) auxquels userId a participé.
 * Cohérent pattern reviews/_internal.ts mais cross-activity (reports peuvent
 * être créés sans activityId spécifique).
 */
async function getAttendedPastSessionIds(userId: string, now: Date): Promise<string[]> {
  const fbDb = getReportsDb();
  // Query bookings confirmés du user (single where, filter status client-side)
  const bookingsSnap = await getDocs(
    query(collection(fbDb, 'bookings'), where('userId', '==', userId)),
  );
  const sessionIds = bookingsSnap.docs
    .map((d) => d.data() as Booking)
    .filter((b) => b.status === 'confirmed' && b.sessionId)
    .map((b) => b.sessionId as string);

  if (sessionIds.length === 0) return [];

  // Filtrer sessions passées (endAt < now)
  const sessions = await Promise.all(
    sessionIds.map(async (sid) => {
      const snap = await getDoc(doc(fbDb, 'sessions', sid));
      return snap.exists() ? (snap.data() as Session) : null;
    }),
  );
  return sessions
    .filter((s): s is Session => s !== null && s.endAt.toMillis() < now.getTime())
    .map((s) => s.sessionId);
}

/**
 * Trouve la session passée la plus récente partagée entre 2 users.
 * Cross-activity (vs reviews qui scope par activityId).
 * Retourne null si aucune session partagée.
 */
export async function findLatestSharedPastSession(
  userA: string,
  userB: string,
  now: Date,
): Promise<Session | null> {
  const [aSessionIds, bSessionIds] = await Promise.all([
    getAttendedPastSessionIds(userA, now),
    getAttendedPastSessionIds(userB, now),
  ]);

  // Intersection
  const sharedIds = aSessionIds.filter((id) => bSessionIds.includes(id));
  if (sharedIds.length === 0) return null;

  // Récupérer Session docs
  const fbDb = getReportsDb();
  const sessions = await Promise.all(
    sharedIds.map(async (sid) => {
      const snap = await getDoc(doc(fbDb, 'sessions', sid));
      return snap.exists() ? (snap.data() as Session) : null;
    }),
  );
  const validSessions = sessions.filter((s): s is Session => s !== null);
  if (validSessions.length === 0) return null;
  return validSessions.reduce((latest, s) =>
    s.endAt.toMillis() > latest.endAt.toMillis() ? s : latest,
  );
}

// =====================================================================
// Helpers : threshold + rate limit queries
// =====================================================================

/**
 * Count distinct reporterIds qui ont reporté reportedId rolling 12 mois.
 * Doctrine §D.3 dédup : 2 reports même reporter sur même reporté = compté 1.
 *
 * Retourne aussi la liste des reportIds (1 par distinct reporter, le plus récent)
 * pour passer à `triggeringReportIds` de UserSanction.
 */
export async function getDistinctReportersAgainst(
  reportedId: string,
  now: Date,
): Promise<{ count: number; triggeringReportIds: string[] }> {
  const fbDb = getReportsDb();
  const cutoff = Timestamp.fromMillis(
    now.getTime() - REPORTS_ROLLING_MONTHS * 30 * 24 * 60 * 60 * 1000,
  );
  const snap = await getDocs(
    query(
      collection(fbDb, 'reports'),
      where('reportedId', '==', reportedId),
      where('createdAt', '>=', cutoff),
    ),
  );
  // Dedup by reporterId (premier vu par doc order — pas crucial pour count)
  const reportersByReportId = new Map<string, string>();
  for (const d of snap.docs) {
    const r = d.data() as Report;
    if (!reportersByReportId.has(r.reporterId)) {
      reportersByReportId.set(r.reporterId, r.reportId);
    }
  }
  return {
    count: reportersByReportId.size,
    triggeringReportIds: Array.from(reportersByReportId.values()),
  };
}

/**
 * Count reports émis par reporterId rolling 24h (rate limit doctrine §D.3).
 * Q8 décision : query rolling 24h, pas de denorm dailyCount.
 */
export async function getDailyReportCountByReporter(
  reporterId: string,
  now: Date,
): Promise<number> {
  const fbDb = getReportsDb();
  const cutoff = Timestamp.fromMillis(now.getTime() - 24 * 60 * 60 * 1000);
  const snap = await getDocs(
    query(
      collection(fbDb, 'reports'),
      where('reporterId', '==', reporterId),
      where('createdAt', '>=', cutoff),
    ),
  );
  return snap.size;
}

// =====================================================================
// Helpers : auth role check (admin)
// =====================================================================

/**
 * Vérifie que userId a le rôle 'admin' dans Firestore users/.
 * Utilisé par dismissReport/sustainReport pour gating service-side
 * (defense complémentaire à isAdmin() dans rules).
 */
export async function isAdminRole(userId: string): Promise<boolean> {
  if (!userId) return false;
  const fbDb = getReportsDb();
  const snap = await getDoc(doc(fbDb, 'users', userId));
  if (!snap.exists()) return false;
  const data = snap.data() as UserProfile;
  return data.role === 'admin';
}

// =====================================================================
// Auto-trigger sanction extraction
// =====================================================================
//
// Phase 7 commit 2/5 contenait `_triggerSanctionStub` ici. Commit 3/5 a extrait
// la logique vers `src/lib/reports/triggerAutoSanction.ts` (service public propre).
// Les unused imports `serverTimestamp` + `setDoc` restent utilisés par les helpers
// au-dessus (_internal.ts ne contient plus de write Firestore directement).
