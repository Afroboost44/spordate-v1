/**
 * BUG #15 — Résolution d'une préférence de paiement UI vers le tableau
 * Stripe `payment_method_types` attendu par checkout.sessions.create.
 *
 * Avant : /api/checkout hardcodait `payment_method_types: ['card', 'twint']`
 * → Stripe Checkout affichait les 2 boutons sur sa propre page hosted, donc
 * l'utilisateur choisissait après la redirection. Bassi veut que le choix
 * soit explicite côté Spordateur (onglet Carte vs onglet TWINT vs Crédits).
 *
 * Le helper :
 *  - 'card'  → ['card']    (Stripe Checkout n'affiche que Carte)
 *  - 'twint' → ['twint']   (Stripe Checkout n'affiche que TWINT)
 *  - 'all' / undefined / null / '' / unknown → ['card', 'twint'] (legacy default,
 *    pour rétrocompat avec les autres call sites checkout/credits/premium
 *    qui n'envoient pas encore de préférence).
 *
 * @module
 */

export type PaymentMethodPreference = 'card' | 'twint' | 'all';
export type StripePaymentMethodType = 'card' | 'twint';

/**
 * Convertit une préférence (potentiellement venant d'un body HTTP non-typé)
 * en tableau Stripe payment_method_types.
 *
 * TODO(twint): réactiver TWINT quand l'éligibilité Stripe du compte est OK.
 * Tant que TWINT n'est pas éligible, Stripe rejette TOUTE session contenant
 * 'twint' ("The payment method type provided: twint is invalid"). On force donc
 * 'card' pour TOUTES les préférences (y compris l'onglet TWINT de discovery, qui
 * retombe sur carte au lieu de planter). 'card' affiche aussi automatiquement
 * Apple Pay / Google Pay sur les appareils compatibles.
 *
 * Pour réactiver TWINT plus tard, restaurer :
 *   if (preference === 'card') return ['card'];
 *   if (preference === 'twint') return ['twint'];
 *   return ['card', 'twint'];
 */
export function resolvePaymentMethodTypes(
  preference: string | null | undefined,
): StripePaymentMethodType[] {
  void preference; // TODO(twint): la préférence sera de nouveau lue à la réactivation
  return ['card'];
}
