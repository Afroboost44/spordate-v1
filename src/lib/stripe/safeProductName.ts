/**
 * Fix anti-régression — Garantit un `name` non-vide pour Stripe
 * `line_items[*].price_data.product_data.name`.
 *
 * Stripe rejette le payload avec l'erreur suivante (visible côté UI invité
 * via toast "Acceptation impossible") :
 *
 *   You passed an empty string for
 *   'line_items[0][price_data][product_data][name]'. We assume empty values
 *   are an attempt to unset a parameter; however
 *   'line_items[0][price_data][product_data][name]' cannot be unset. You
 *   should remove 'line_items[0][price_data][product_data][name]' from your
 *   request or supply a non-empty value.
 *
 * Cas qui produit le bug en prod :
 *   1. Activity créée à une époque où le champ s'appelait `name` (legacy
 *      partner UI) puis le service migre vers `title` → l'ancien doc n'a
 *      ni `title` ni `name` après normalisation.
 *   2. Session crée via `/api/partner/sessions/create` qui copie
 *      `(activity.title as string) ?? ''` → écrit `session.title = ''`.
 *   3. `/api/checkout` mode='invite-accept' lit cette session et passe
 *      `name: session.title` (= '') à Stripe.
 *
 * Cascade de fallback :
 *   1. `input.title` (trimmé) si non-vide
 *   2. `input.name`  (trimmé) si non-vide (legacy Activity field)
 *   3. `input.fallback` (trimmé) si non-vide (call-site override)
 *   4. constante `DEFAULT_PRODUCT_NAME` = "Réservation activité Spordateur"
 *
 * Le résultat est tronqué à 250 chars (limite Stripe pour product_data.name).
 *
 * Usage OBLIGATOIRE (cf. CLAUDE.md anti-régression) pour TOUT call site qui
 * construit `line_items[*].price_data.product_data.name` à partir d'un
 * champ dynamique (activity.title, session.title, etc.). Vérifié par
 * `tests/admin/stripe-line-items-name.test.js`.
 *
 * Les noms 100% statiques (ex. `name: 'Pack Starter'`) restent autorisés
 * sans helper.
 *
 * @module lib/stripe/safeProductName
 */

/** Fallback ultime si aucun champ n'est exploitable. */
export const DEFAULT_PRODUCT_NAME = 'Réservation activité Spordateur';

/** Limite Stripe API (chars). */
const STRIPE_NAME_MAX_LENGTH = 250;

export interface SafeStripeProductNameInput {
  /** Champ canonique Spordateur (Activity.title, Session.title). */
  title?: string | null;
  /** Champ legacy Activity (forms partner antérieurs). */
  name?: string | null;
  /**
   * Optional. Si défini ET non-vide après trim, utilisé en priorité 3
   * (avant le DEFAULT_PRODUCT_NAME). Sert aux call sites qui veulent
   * un fallback métier (ex. "Cadeau Spordateur" pour un gift sans titre).
   */
  fallback?: string | null;
}

/**
 * Retourne un `name` non-vide, prêt à passer à `product_data.name` Stripe.
 *
 * Garanties :
 *   - jamais empty string
 *   - jamais > 250 chars
 *   - jamais null/undefined
 *
 * @example
 *   safeStripeProductName({ title: session.title })
 *   // → "Salsa Mercredi" ou "Réservation activité Spordateur" si vide
 *
 *   safeStripeProductName({ title: activity.title, name: activity.name })
 *   // → priorité title, fallback name (legacy)
 *
 *   safeStripeProductName({ title: '', fallback: 'Cadeau Spordateur' })
 *   // → "Cadeau Spordateur"
 */
export function safeStripeProductName(input: SafeStripeProductNameInput): string {
  const candidates: Array<string | null | undefined> = [
    input.title,
    input.name,
    input.fallback,
    DEFAULT_PRODUCT_NAME,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    return trimmed.length > STRIPE_NAME_MAX_LENGTH
      ? trimmed.slice(0, STRIPE_NAME_MAX_LENGTH)
      : trimmed;
  }
  // Inatteignable : DEFAULT_PRODUCT_NAME est non-vide. Belt-and-suspenders :
  return DEFAULT_PRODUCT_NAME;
}
