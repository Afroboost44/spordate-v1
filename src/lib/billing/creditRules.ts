/**
 * Phase 9.5 c7 — Credit rules central config.
 *
 * Doctrine économie crédits :
 *  - Réservation gratuite (price === 0) → freeActivityBundle (5 par défaut)
 *  - Réservation payante → priceCHF × paidActivityRatio (2 par défaut, ex 30 CHF → 60)
 *  - Override per-activity : si Activity.chatCreditsBundle défini → utilise CETTE valeur
 *    (priorité : per-activity > central rules)
 *
 * Defer Phase 10 : settings/credits Firestore override admin UI runtime.
 *
 * @module
 */

import type { Activity } from '@/types/firestore';

// =====================================================================
// Constants central rules (defaults)
// =====================================================================

export const CREDIT_RULES = {
  /** Réservation gratuite → bundle minimal (engagement immédiat). */
  freeActivityBundle: 5,
  /** Réservation payante → ratio crédits par CHF (priceCHF × ratio). */
  paidActivityRatio: 2,
} as const;

// =====================================================================
// Helpers
// =====================================================================

/**
 * Helper : retourne `true` si l'activité est gratuite (price === 0).
 * Defensive : null/undefined → considéré payant (pas de free-grant accidentel).
 */
export function isFreeBooking(
  activity: Pick<Activity, 'price'> | null | undefined,
): boolean {
  if (!activity) return false;
  if (typeof activity.price !== 'number') return false;
  return activity.price === 0;
}

/**
 * Calcule le nombre de crédits à grant lors d'une réservation.
 *
 * Priorité :
 *   1. activity.chatCreditsBundle si défini (override per-activity Phase 3)
 *   2. Sinon : free → CREDIT_RULES.freeActivityBundle, paid → priceCHF × paidActivityRatio
 *
 * @param activity Activity (or partial avec price + chatCreditsBundle?)
 * @returns Nombre crédits chat à grant (entier ≥ 0)
 * @throws Error si activity null OR price NaN/négatif
 */
export function computeBundledCredits(
  activity: Pick<Activity, 'price' | 'chatCreditsBundle'> | null | undefined,
): number {
  if (!activity) {
    throw new Error('computeBundledCredits: activity required');
  }
  if (typeof activity.price !== 'number' || Number.isNaN(activity.price) || activity.price < 0) {
    throw new Error(`computeBundledCredits: invalid price ${activity.price}`);
  }

  // Priorité 1 — per-activity override (Phase 3 Activity.chatCreditsBundle)
  if (
    typeof activity.chatCreditsBundle === 'number' &&
    !Number.isNaN(activity.chatCreditsBundle) &&
    activity.chatCreditsBundle >= 0
  ) {
    return Math.floor(activity.chatCreditsBundle);
  }

  // Priorité 2 — central rules
  if (activity.price === 0) {
    return CREDIT_RULES.freeActivityBundle;
  }
  return Math.floor(activity.price * CREDIT_RULES.paidActivityRatio);
}
