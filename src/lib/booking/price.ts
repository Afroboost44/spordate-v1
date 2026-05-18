/**
 * BUG pricing tiers FIX A — Helper pur pour résoudre le prix de booking à
 * afficher dans le modal Discovery.
 *
 * Contexte : avant ce fix, le booking modal lisait `Activity.price` (CHF
 * entier vitrine). Le backend `/api/checkout` charge en fait
 * `computePricingTier(session).price` (centimes du tier actif). Ces deux
 * valeurs peuvent diverger :
 *  - Activity.price=5 mais session.pricingTiers.early.price=0 → UI affichait
 *    5 CHF, Stripe chargeait 0 (silently free booking).
 *  - Activity.price=0 mais sessions sync avec tiers 5/6/7 → inverse.
 *
 * Fix : lire la session de référence (la prochaine session future résolue
 * via getNextFutureSessionForActivity) et calculer son prix actif via
 * computePricingTier. Fallback vers Activity.price si pas de session
 * disponible (legacy backward compat).
 *
 * @module
 */

import { computePricingTier } from '@/services/firestore';
import type { Activity, Session } from '@/types/firestore';

export interface GetBookingPriceInput {
  /** Session de référence (la prochaine future). null si pas encore résolue. */
  session: Session | null;
  /** Activity pour fallback (legacy `price` vitrine, CHF entier). */
  activity: Pick<Activity, 'price'> | null;
  /** `now` injecté pour rendre la fonction pure / testable. */
  now: Date;
  /** Si true, le prix retourné est ×2 (Duo). */
  isDuo: boolean;
  /** Optionnel — override du compteur (pour preview "si je m'ajoute"). */
  participantsOverride?: number;
}

/**
 * Retourne le prix à afficher dans le booking modal, en CHF entier (arrondi).
 *
 * Logique :
 *  1. Si session présente avec pricingTiers non vide → utilise
 *     `computePricingTier(session, now).price` (centimes) → /100 → CHF.
 *  2. Sinon → fallback sur `activity.price` (CHF entier, legacy vitrine).
 *  3. Multiplie ×2 si isDuo.
 *
 * Le résultat est arrondi à l'entier le plus proche (cohérent avec
 * l'affichage CHF actuel dans le modal et avec `selectedActivity.price`
 * qui était déjà un CHF entier).
 */
export function getBookingPriceCHF(input: GetBookingPriceInput): number {
  const { session, activity, now, isDuo, participantsOverride } = input;
  let baseCHF = 0;

  if (session && Array.isArray(session.pricingTiers) && session.pricingTiers.length > 0) {
    const { price } = computePricingTier(session, now, participantsOverride);
    baseCHF = Math.round(price / 100);
  } else if (activity && typeof activity.price === 'number') {
    baseCHF = activity.price;
  }

  return isDuo ? baseCHF * 2 : baseCHF;
}
