/**
 * BUG #3 — Helpers de cycle de vie activity / session.
 *
 * Quand un partenaire supprime une activity (hard-delete = doc supprimé) OU la
 * désactive (soft-delete = isActive:false), ses sessions futures doivent être
 * traitées comme annulées :
 *  - cascade côté /partner/offers (marque les sessions futures status='cancelled')
 *  - le cron session-reminders skip les bookings d'activity indisponible
 *  - /sessions/[id] affiche un banner "activité annulée" + désactive Réserver
 *  - la migration one-shot répare les sessions déjà orphelines en prod
 *
 * Pures (no Firestore, no DOM, no network) → testables unit.
 *
 * @module
 */

/**
 * Une activity est "indisponible" si elle a été hard-deleted (snapshot absent →
 * `null`/`undefined`) OU soft-deleted (`isActive === false`).
 */
export function isActivityUnavailable(
  activity: { isActive?: boolean } | null | undefined,
): boolean {
  return !activity || activity.isActive === false;
}

/**
 * Une session n'est plus réservable si son activity parente est indisponible
 * OU si la session elle-même a été annulée (`status === 'cancelled'`).
 */
export function isSessionUnavailable(
  activity: { isActive?: boolean } | null | undefined,
  session: { status?: string } | null | undefined,
): boolean {
  return isActivityUnavailable(activity) || session?.status === 'cancelled';
}

/**
 * Une session doit être cascade-annulée (status → 'cancelled') suite à la
 * suppression/désactivation de son activity si :
 *  - elle existe et a un `startAt` exploitable
 *  - son `startAt` est dans le futur (on ne touche jamais une session passée)
 *  - elle n'est pas déjà 'cancelled' (idempotent) ni 'completed' (déjà vécue)
 *
 * @param nowMs Date.now() en millisecondes (injecté pour testabilité).
 */
export function shouldCancelSessionOnActivityRemoval(
  session:
    | { status?: string; startAt?: { toMillis?: () => number } }
    | null
    | undefined,
  nowMs: number,
): boolean {
  if (!session) return false;
  if (session.status === 'cancelled' || session.status === 'completed') {
    return false;
  }
  const startMs = session.startAt?.toMillis?.();
  return typeof startMs === 'number' && startMs > nowMs;
}
