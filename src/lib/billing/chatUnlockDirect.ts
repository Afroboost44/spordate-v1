/**
 * Phase 9.5 c38b — Constants + helpers chat unlock direct (sans match mutuel).
 *
 * Permet à un user de débloquer un chat instantanément avec un autre user en
 * dépensant des crédits Spordate, sans avoir besoin d'un match mutuel ❤️↔️❤️.
 * Coût validé : 5 crédits (cf taux 0.5 CHF/crédit → équivalent 2.50 CHF).
 *
 * Distinct du flow boost-credits (qui paie la visibilité côté partner) :
 * c'est ici un flow "premium dating" côté user — paie pour court-circuiter
 * le mutual matching.
 */

export const CHAT_UNLOCK_DIRECT_COST = 5;
export const CHF_PER_CREDIT = 0.5;

/** Retourne le coût en crédits (constant pour l'instant — exposé pour tests
 *  et future variation par tier Premium). */
export function computeChatUnlockCost(): number {
  return CHAT_UNLOCK_DIRECT_COST;
}
