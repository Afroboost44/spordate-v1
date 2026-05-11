/**
 * Phase 9.5 c29b BUG FF — Constants + helpers boost via crédits Spordate.
 *
 * Extrait de /api/boost-credits/route.ts pour respecter la contrainte Next.js 15
 * qui n'autorise que les exports HTTP (POST/GET/etc) dans les route files.
 * Permet aussi la réutilisation côté tests + UI client sans pulling du runtime
 * server-only.
 *
 * Tarification validée Phase 9.5 c29b :
 *   Boost 24h (15 CHF) =  30 crédits  (0.50 CHF/crédit)
 *        3d (35 CHF) =  70 crédits
 *        7d (50 CHF) = 100 crédits
 */

export const BOOST_CREDITS_COST: Record<string, number> = {
  '24h': 30,
  '3d': 70,
  '7d': 100,
};

export const BOOST_DURATION_HOURS: Record<string, number> = {
  '24h': 24,
  '3d': 72,
  '7d': 168,
};

/** Taux de conversion CHF/crédit (cohérent bundle Phase 3 : 50 crédits = 25 CHF). */
export const CHF_PER_CREDIT = 0.5;

/** Coût en crédits pour une durée donnée. Throw si durée invalide. */
export function computeBoostCost(duration: string): number {
  const cost = BOOST_CREDITS_COST[duration];
  if (!cost) {
    throw new Error(`Invalid boost duration: ${duration}`);
  }
  return cost;
}
