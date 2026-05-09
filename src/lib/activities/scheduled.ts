/**
 * Phase 9.5 c11 — formatScheduledLabel pure helper.
 *
 * Formate une date de séance pour affichage card listing :
 *  - Date dans le futur (cohérent c11 — partner planifie ses séances) :
 *    "Mar 12 mai · 19h30"  (jour court FR + jour mois + heure HHhmm)
 *  - Si pas de date OU date null/undefined → "Date à venir"
 *  - Si date dans le passé → "Date passée — voir prochaines"
 *
 * Pure (no DOM, no Firestore) → testable unit.
 *
 * @module
 */

const DAYS_FR_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS_FR_SHORT = [
  'jan', 'fév', 'mars', 'avr', 'mai', 'juin',
  'juil', 'août', 'sept', 'oct', 'nov', 'déc',
];

export interface ScheduledLike {
  /** Firestore Timestamp (toMillis) OR Date OR ms epoch OR null/undefined. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduledAt?: any;
}

/**
 * Convertit une valeur scheduledAt (Timestamp/Date/number/null/undef) en epoch ms.
 * Returns null si non-convertible.
 */
function toMs(raw: unknown): number | null {
  if (raw == null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (typeof r.toMillis === 'function') return r.toMillis();
  if (r instanceof Date) return r.getTime();
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  // Defensive : Firestore Timestamp via JSON ré-hydraté = { seconds, nanoseconds }
  if (typeof r.seconds === 'number') return r.seconds * 1000;
  return null;
}

/**
 * Format pour ActivityCard listing.
 *
 * @param activity Object avec champ scheduledAt optionnel
 * @param now Epoch ms (injectable pour tests)
 * @returns Label affichable (toujours non-null, fallback "Date à venir")
 */
export function formatScheduledLabel(
  activity: ScheduledLike,
  now: number = Date.now(),
): string {
  const ms = toMs(activity.scheduledAt);
  if (ms === null) return 'Date à venir';
  if (ms < now) return 'Date passée — voir prochaines';

  const d = new Date(ms);
  const dayLabel = DAYS_FR_SHORT[d.getDay()];
  const monthLabel = MONTHS_FR_SHORT[d.getMonth()];
  const dayNum = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dayLabel} ${dayNum} ${monthLabel} · ${hh}h${mm}`;
}

/**
 * @returns true si scheduledAt est défini ET dans le futur (utile pour gating UI).
 */
export function hasUpcomingSchedule(
  activity: ScheduledLike,
  now: number = Date.now(),
): boolean {
  const ms = toMs(activity.scheduledAt);
  if (ms === null) return false;
  return ms >= now;
}
