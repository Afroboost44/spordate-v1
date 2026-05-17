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

const BOTH: StripePaymentMethodType[] = ['card', 'twint'];

/**
 * Convertit une préférence (potentiellement venant d'un body HTTP non-typé)
 * en tableau Stripe payment_method_types. Defensive : tout input non
 * reconnu retombe sur ['card', 'twint'] (back-compat).
 */
export function resolvePaymentMethodTypes(
  preference: string | null | undefined,
): StripePaymentMethodType[] {
  if (preference === 'card') return ['card'];
  if (preference === 'twint') return ['twint'];
  return [...BOTH];
}
