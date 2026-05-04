/**
 * Spordateur — Phase 7 sub-chantier 1 commit 2/6
 * Reviews service — internal helpers, DI seams, constants.
 *
 * Pattern DI seam cohérent src/lib/email/sendEmail.ts (sub-chantier 0) :
 * - __setReviewsDbForTesting(db) → override Firestore client pour tests unit
 * - __setCreditsServiceForTesting(adder) → override updateUserCredits pour tests
 *
 * En prod : getReviewsDb() retourne db importé de @/lib/firebase, getCreditsAdder()
 * retourne updateUserCredits importé de @/services/firestore.
 *
 * Cf. architecture.md §9.sexies C pour la doctrine reviews complète.
 */

import { db } from '@/lib/firebase';
import { updateUserCredits } from '@/services/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  Activity,
  Booking,
  CreditType,
  Session,
  UserProfile,
} from '@/types/firestore';

// =====================================================================
// DI seams (test injection)
// =====================================================================

let _testDb: Firestore | null = null;

export type CreditsAdder = (
  uid: string,
  amount: number,
  type: CreditType,
  description: string,
  relatedId?: string,
) => Promise<number>;

let _testCreditsAdder: CreditsAdder | null = null;

export function __setReviewsDbForTesting(testDb: Firestore | null): void {
  _testDb = testDb;
}

export function __setCreditsServiceForTesting(adder: CreditsAdder | null): void {
  _testCreditsAdder = adder;
}

export function getReviewsDb(): Firestore {
  if (_testDb) return _testDb;
  if (!db) {
    throw new Error('Firestore not initialized — check Firebase config (NEXT_PUBLIC_FIREBASE_*)');
  }
  return db;
}

export function getCreditsAdder(): CreditsAdder {
  return _testCreditsAdder ?? updateUserCredits;
}

// =====================================================================
// Constants doctrine §9.sexies C
// =====================================================================

export const REVIEW_BONUS_CREDITS = 5;
export const COOLING_OFF_HOURS = 24;
export const REVIEW_WINDOW_DAYS = 7;
export const EDITABLE_HOURS_AFTER_PUB = 24;
export const COMMENT_MIN_LENGTH = 10;
export const COMMENT_MAX_LENGTH = 500;

// =====================================================================
// Error codes (machine-parseable)
// =====================================================================

export type ReviewErrorCode =
  | 'review-not-found'
  | 'review-already-exists'
  | 'reviewer-not-eligible'
  | 'reviewee-not-eligible'
  | 'no-shared-session'
  | 'cooling-off-not-elapsed'
  | 'review-window-closed'
  | 'comment-too-short'
  | 'comment-too-long'
  | 'rating-out-of-range'
  | 'reviewer-equals-reviewee'
  | 'not-reviewer'
  | 'review-not-published'
  | 'edit-window-closed'
  | 'cross-tier-rating-change'
  | 'invalid-fields'
  | 'review-not-pending'
  | 'invalid-decision'
  | 'not-authorized'
  | 'credits-already-awarded'
  | 'activity-not-found';

export class ReviewError extends Error {
  constructor(
    public code: ReviewErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ReviewError';
  }
}

// =====================================================================
// Helpers : participation + shared session
// =====================================================================

/**
 * Récupère les sessionIds passés (endAt < now) auxquels userId a participé sur cette activity.
 *
 * Pour un participant : query bookings status=='confirmed', activityId, userId, sessionDate < now.
 * Pour le partenaire de l'activity : tous les sessionIds passés de l'activity sont considérés
 *   "attendus" (le partenaire est implicitement présent à toutes ses sessions).
 *
 * Retourne array de sessionIds.
 */
export async function getAttendedPastSessionIds(
  activityId: string,
  userId: string,
  partnerId: string,
  now: Date,
): Promise<string[]> {
  const fbDb = getReviewsDb();

  // Cas partenaire : compte comme ayant participé à toutes les sessions passées
  if (userId === partnerId) {
    const sessionsSnap = await getDocs(
      query(collection(fbDb, 'sessions'), where('activityId', '==', activityId)),
    );
    return sessionsSnap.docs
      .map((d) => d.data() as Session)
      .filter((s) => s.endAt.toMillis() < now.getTime())
      .map((s) => s.sessionId);
  }

  // Cas participant : query bookings confirmés
  const bookingsSnap = await getDocs(
    query(
      collection(fbDb, 'bookings'),
      where('activityId', '==', activityId),
      where('userId', '==', userId),
      where('status', '==', 'confirmed'),
    ),
  );
  const sessionIds = bookingsSnap.docs
    .map((d) => d.data() as Booking)
    .filter((b) => b.sessionId)
    .map((b) => b.sessionId as string);

  // Filtrer les sessions passées (endAt < now)
  if (sessionIds.length === 0) return [];
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
 * Trouve la session passée la plus récente partagée entre deux users sur cette activity.
 * Retourne null si aucune session partagée.
 */
export async function findLatestSharedPastSession(
  activityId: string,
  userA: string,
  userB: string,
  partnerId: string,
  now: Date,
): Promise<Session | null> {
  const [aSessionIds, bSessionIds] = await Promise.all([
    getAttendedPastSessionIds(activityId, userA, partnerId, now),
    getAttendedPastSessionIds(activityId, userB, partnerId, now),
  ]);

  // Intersection
  const sharedIds = aSessionIds.filter((id) => bSessionIds.includes(id));
  if (sharedIds.length === 0) return null;

  // Récupérer les Session docs
  const fbDb = getReviewsDb();
  const sessions = await Promise.all(
    sharedIds.map(async (sid) => {
      const snap = await getDoc(doc(fbDb, 'sessions', sid));
      return snap.exists() ? (snap.data() as Session) : null;
    }),
  );

  // Plus récente par endAt
  const validSessions = sessions.filter((s): s is Session => s !== null);
  if (validSessions.length === 0) return null;
  return validSessions.reduce((latest, s) =>
    s.endAt.toMillis() > latest.endAt.toMillis() ? s : latest,
  );
}

/**
 * Contexte minimal nécessaire à l'envoi d'un email review :
 * - email (recipient — null si user introuvable, dans ce cas pas d'email envoyé)
 * - userName (personnalisation greeting, '' fallback)
 * - sessionTitle (subject + body, '' fallback)
 *
 * Best-effort : tous les fetches sont try/catch, retournent valeurs par défaut.
 * Utilisé par awardReviewBonus, createReview (pending branch), moderateReview.
 */
export interface ReviewEmailContext {
  email: string | null;
  userName: string;
  sessionTitle: string;
}

export async function fetchReviewEmailContext(
  userId: string,
  activityId: string,
): Promise<ReviewEmailContext> {
  const fbDb = getReviewsDb();
  let email: string | null = null;
  let userName = '';
  let sessionTitle = '';

  try {
    const userSnap = await getDoc(doc(fbDb, 'users', userId));
    if (userSnap.exists()) {
      const data = userSnap.data() as UserProfile;
      email = data.email ?? null;
      userName = data.displayName ?? '';
    }
  } catch (err) {
    console.warn('[fetchReviewEmailContext] user fetch failed (non-blocking)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const actSnap = await getDoc(doc(fbDb, 'activities', activityId));
    if (actSnap.exists()) {
      sessionTitle = (actSnap.data() as Activity).title ?? '';
    }
  } catch (err) {
    console.warn('[fetchReviewEmailContext] activity fetch failed (non-blocking)', {
      activityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { email, userName, sessionTitle };
}

/**
 * Vérifie qu'une review n'existe pas déjà pour (activityId, reviewerId).
 * Anti-duplicate par doctrine §9.sexies C : 1 review max par activité par reviewer.
 */
export async function reviewAlreadyExists(
  activityId: string,
  reviewerId: string,
): Promise<boolean> {
  const fbDb = getReviewsDb();
  const snap = await getDocs(
    query(
      collection(fbDb, 'reviews'),
      where('activityId', '==', activityId),
      where('reviewerId', '==', reviewerId),
    ),
  );
  return !snap.empty;
}
