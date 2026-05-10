/**
 * Spordateur — Phase 4
 * Helpers de formatage countdown (PURES, sans React).
 *
 * Extraits du composant CountdownBadge pour testabilité (importable sans charger React).
 */

import { breakdownMs } from '@/hooks/useCountdown';
import { tsToMs } from '@/lib/firestore/timestamp';

/**
 * Convertit Date | Timestamp Firestore | epoch ms | JSON {seconds,nanoseconds} en epoch ms.
 *
 * Phase 9.5 c14 BUG1 fix : utilise tsToMs centralisé qui gère les 4 formats
 * incluant le Timestamp sérialisé SSR (cause du crash /sessions →
 * SessionCard → CountdownBadge → formatBadge → toMs).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMs(target: any): number {
  return tsToMs(target);
}

export interface FormatBadgeOptions {
  /** Texte affiché quand la cible est dépassée. Défaut "Démarré". */
  expiredText?: string;
  /** Date courante de référence. Défaut new Date(). Utilisé pour les tests purs. */
  now?: Date;
}

/**
 * Formate un countdown vers une cible en string compact pour `<CountdownBadge>`.
 *
 * Plages :
 * - > 24h    → `"J-N HH:MM"` (jour cible + heure locale absolue de la cible)
 * - 1h-24h   → `"Xh Ymin"`
 * - 1min-1h  → `"Xmin Ys"`
 * - < 1min   → `"Xs"`
 * - ≤ 0      → options.expiredText ?? `"Démarré"`
 *
 * Les heures sont affichées en TZ LOCALE du client (ex: "17:00" pour un cours à 17h local).
 */
export function formatBadge(
  target: Date | { toMillis: () => number } | number,
  options?: FormatBadgeOptions,
): string {
  const targetMs = toMs(target);
  const nowMs = (options?.now ?? new Date()).getTime();
  const remainingMs = targetMs - nowMs;

  if (remainingMs <= 0) return options?.expiredText ?? 'Démarré';

  const { days, hours, minutes, seconds } = breakdownMs(remainingMs);

  // > 24h : afficher J-N + heure locale absolue de la cible
  if (days > 0) {
    const targetDate = new Date(targetMs);
    const hh = String(targetDate.getHours()).padStart(2, '0');
    const mm = String(targetDate.getMinutes()).padStart(2, '0');
    return `J-${days} ${hh}:${mm}`;
  }

  // 1h-24h : "Xh Ymin"
  if (hours >= 1) {
    return `${hours}h ${minutes}min`;
  }

  // 1min-1h : "Xmin Ys"
  if (minutes >= 1) {
    return `${minutes}min ${seconds}s`;
  }

  // < 1min : "Xs"
  return `${seconds}s`;
}
