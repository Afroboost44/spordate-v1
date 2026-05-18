/**
 * BUG #36 COMMIT 1 — Helpers purs activity_invite (chat).
 *
 * 3 helpers :
 *  - buildActivityInvitePayload : construit le ChatMessage shape pour send
 *  - validateInviteStatusTransition : transitions lifecycle autorisées
 *  - isInviteExpired : check 24h avant nextSessionAt OU session passée
 *
 * Le storage utilise un message Firestore chats/{matchId}/messages/{id} avec
 * type='activity_invite' + invite={...} + inviteStatus='pending'.
 * Rules : create par sender (gratuit, pas de check credits), update status
 * par receiver (pending→accepted/declined) ou system (pending→expired).
 *
 * @module
 */

import type { ActivityInviteMode, InviteStatus, ActivityInviteData } from '@/types/firestore';

// =====================================================================
// displayActivityTitle
// =====================================================================

/**
 * BUG #38 — Fallback chain user-meaningful pour afficher un titre d'activité
 * quand le champ Firestore `title` est vide/whitespace (legacy data ou test
 * data). Ordre :
 *   1. title.trim() s'il est non-vide
 *   2. "sport · city" si les deux sont fournis
 *   3. sport seul si présent
 *   4. "Activité" en dernier recours (jamais retourner '')
 *
 * Utilisé par ActivitySelectorModal (carte) + InviteModeModal (description)
 * + buildActivityInvitePayload (snapshot dénormalisé).
 */
export function displayActivityTitle(input: {
  title?: string;
  sport?: string;
  city?: string;
}): string {
  const title = (input.title ?? '').trim();
  if (title) return title;
  const sport = (input.sport ?? '').trim();
  const city = (input.city ?? '').trim();
  if (sport && city) return `${sport} · ${city}`;
  if (sport) return sport;
  return 'Activité';
}

// =====================================================================
// buildActivityInvitePayload
// =====================================================================

export interface BuildInviteInput {
  senderId: string;
  activityId: string;
  activityTitle: string;
  inviteMode: ActivityInviteMode;
  /** Optionnel — session ID de la prochaine session future. */
  nextSessionId?: string;
  /** Optionnel — timestamp prochaine session (pour expired check). */
  nextSessionAt?: Date | { toDate(): Date } | null;
  /** Optionnel — dénormalisé snapshot. */
  activityCity?: string;
  activitySport?: string;
  activityImageUrl?: string;
}

/**
 * Payload prêt à passer à addDoc(chats/{matchId}/messages/{auto}).
 * Le caller ajoute `createdAt: serverTimestamp()` au write final (impossible
 * de mettre serverTimestamp dans un helper pur — pas serializable).
 */
export interface ActivityInvitePayload {
  senderId: string;
  text: string;
  type: 'activity_invite';
  readBy: string[];
  invite: ActivityInviteData;
  inviteStatus: InviteStatus;
}

export function buildActivityInvitePayload(input: BuildInviteInput): ActivityInvitePayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextSessionAtConverted = input.nextSessionAt
    ? // best-effort cast vers Timestamp-like (sera réinjecté à l'arrivée par caller si Date)
      (input.nextSessionAt as any)
    : undefined;

  // BUG #36 hotfix + BUG #38 — Firestore refuse les `undefined`. activityTitle
  // peut arriver undefined/empty (legacy activities sans `title`). Fallback chain
  // displayActivityTitle privilégie info user-meaningful (sport · city) avant
  // de retomber sur 'Activité' générique. Le snapshot Firestore stocke la
  // valeur résolue (cohérent avec l'affichage dans le picker + modal mode).
  const safeTitle = displayActivityTitle({
    title: input.activityTitle,
    sport: input.activitySport,
    city: input.activityCity,
  });

  // Build invite avec ONLY les champs définis (skip undefined → Firestore-safe).
  const invite: ActivityInviteData = {
    activityId: input.activityId,
    inviteMode: input.inviteMode,
    activityTitle: safeTitle,
  };
  if (input.nextSessionId) invite.nextSessionId = input.nextSessionId;
  if (nextSessionAtConverted) invite.nextSessionAt = nextSessionAtConverted;
  if (input.activityCity) invite.activityCity = input.activityCity;
  if (input.activitySport) invite.activitySport = input.activitySport;
  if (input.activityImageUrl) invite.activityImageUrl = input.activityImageUrl;

  return {
    senderId: input.senderId,
    text: '',
    type: 'activity_invite',
    readBy: [input.senderId],
    invite,
    inviteStatus: 'pending',
  };
}

// =====================================================================
// validateInviteStatusTransition
// =====================================================================

export interface TransitionContext {
  /** True si auth.uid !== senderId (receiver tries to update). */
  isReceiver: boolean;
  /** True si appel system (Cloud Function expiration cron). Default false. */
  isSystem?: boolean;
}

/**
 * Vrai si la transition `from → to` est autorisée selon le contexte.
 *
 *  Règles :
 *   - from doit être 'pending' (immutable une fois finalisé)
 *   - to ≠ from (no-op interdit)
 *   - pending → accepted/declined : isReceiver required (sender peut pas s'auto-accepter)
 *   - pending → expired : isSystem required (cron, pas client)
 */
export function validateInviteStatusTransition(
  from: InviteStatus,
  to: InviteStatus,
  ctx: TransitionContext,
): boolean {
  if (from !== 'pending') return false;
  if (to === from) return false;
  if (to === 'accepted' || to === 'declined') {
    return ctx.isReceiver === true;
  }
  if (to === 'expired') {
    return ctx.isSystem === true;
  }
  return false;
}

// =====================================================================
// isInviteExpired
// =====================================================================

/** Fenêtre avant nextSessionAt sous laquelle l'invite est considérée expirée. */
export const INVITE_EXPIRY_HOURS_BEFORE_SESSION = 24;

interface InviteExpiryInput {
  /** nextSessionAt en Timestamp (Firestore) OU Date OU null/undefined. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextSessionAt?: any;
}

// =====================================================================
// buildFutureSessionActivityIdSet + filterActivitiesWithFutureSession
// =====================================================================

/**
 * BUG #36 post-hotfix — Pré-filtre helpers pour ActivitySelectorModal.
 *
 * Le picker d'activités ne doit montrer QUE les activités qui ont une
 * session future programmée — sinon le mode Duo échoue avec 409
 * `no-future-session` au moment du Stripe Checkout. Le mode Individual
 * pourrait techniquement fonctionner sans, mais l'UX est meilleure en
 * filtrant uniformément (date visible dans la carte, pas de fausse promesse).
 */

export interface FutureSessionLite {
  activityId: string;
  /** ms epoch — caller convertit Firestore Timestamp via toMillis() avant. */
  startAtMs: number;
}

/**
 * Construit un Set d'activityIds qui ont au moins une session future à
 * partir d'un tableau plat de sessions. Tolère duplicates (same activityId
 * plusieurs fois) — résultat dédupliqué par Set.
 */
export function buildFutureSessionActivityIdSet(
  sessions: FutureSessionLite[],
  nowMs: number,
): Set<string> {
  const set = new Set<string>();
  for (const s of sessions) {
    if (s && s.activityId && typeof s.startAtMs === 'number' && s.startAtMs > nowMs) {
      set.add(s.activityId);
    }
  }
  return set;
}

/**
 * Filtre un tableau d'activités pour ne garder que celles présentes dans le
 * Set d'IDs futurs. Préserve l'ordre original (important pour le UI : list
 * souvent triée par date de création desc, on veut pas reshuffler).
 */
export function filterActivitiesWithFutureSession<T extends { activityId: string }>(
  activities: T[],
  futureSessionActivityIds: Set<string>,
): T[] {
  return activities.filter((a) => futureSessionActivityIds.has(a.activityId));
}

/**
 * Vrai si l'invite est considérée expirée à `nowMs` :
 *  - nextSessionAt absent → false (pas d'expiration possible)
 *  - nextSessionAt déjà passé → true
 *  - nextSessionAt dans <24h → true
 */
export function isInviteExpired(invite: InviteExpiryInput, nowMs: number): boolean {
  const sessionAt = invite.nextSessionAt;
  if (!sessionAt) return false;
  // Support Date OR Firestore Timestamp (toMillis() ou toDate())
  let sessionMs: number;
  if (sessionAt instanceof Date) {
    sessionMs = sessionAt.getTime();
  } else if (typeof sessionAt === 'object' && sessionAt && typeof sessionAt.toMillis === 'function') {
    sessionMs = sessionAt.toMillis();
  } else if (typeof sessionAt === 'object' && sessionAt && typeof sessionAt.toDate === 'function') {
    sessionMs = sessionAt.toDate().getTime();
  } else {
    return false; // shape inconnue → defensive
  }
  const expiryThreshold = sessionMs - INVITE_EXPIRY_HOURS_BEFORE_SESSION * 3600 * 1000;
  return nowMs >= expiryThreshold;
}
