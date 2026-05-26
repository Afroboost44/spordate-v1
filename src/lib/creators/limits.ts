/**
 * Limites du système créateurs / payouts Spordateur.
 *
 * Centralise les bornes anti-abuse pour les retraits créateurs :
 *  - MIN_PAYOUT_CHF : seuil minimal pour qu'un creator puisse demander un retrait.
 *    Lu par `requestPayout` (server-side guard) ET par la dashboard creator
 *    (UX disable bouton si solde < seuil).
 *
 * Pourquoi ce seuil :
 *  Audit 2026-05 : un attaquant peut DevTools-bypass le bouton désactivé et
 *  envoyer un payout de 0.01 CHF, ce qui spammerait la file admin de traitements
 *  manuels et générerait des coûts bancaires disproportionnés (frais TWINT /
 *  virements bancaires > 0.50 CHF par transfert). Le guard côté `requestPayout`
 *  bloque l'attaque en throw 'payout-below-minimum' avant tout autre check.
 *
 * RÈGLE : si on relève le seuil ici, il faut ALIGNER la condition côté
 *  `src/app/creator/dashboard/page.tsx` (handleRequestPayout + disabled prop)
 *  pour rester cohérent UX/UI. Idéalement consommer cette constante côté client
 *  également — c'est ce que fait le call site depuis le fix audit.
 *
 * Valeur en CHF entier (pas en centimes) — cohérent avec `Creator.pendingPayout`
 * qui stocke en CHF directe (cf. types/firestore Creator).
 */

/**
 * Plancher absolu (en CHF) pour le montant minimum de retrait.
 *
 * Bassi peut surcharger ce seuil depuis /admin/manage > onglet Tarifs
 * (champ `minPayoutCHF` du doc Firestore `settings/pricing`) — typiquement pour
 * le RELEVER (50 CHF, 100 CHF) si les frais bancaires augmentent. La règle
 * firestore.rules empêche techniquement de stocker une valeur < 10 CHF, et
 * `validatePayoutRequest` clamp ici en défense en profondeur : on n'accepte
 * JAMAIS un seuil < MIN_PAYOUT_CHF, peu importe ce qui est en base.
 *
 * Si tu veux changer ce floor, fais-le aussi côté firestore.rules pour rester
 * cohérent.
 */
export const MIN_PAYOUT_CHF = 10;

/**
 * Erreur typée levée par `requestPayout` quand le montant demandé est sous le seuil.
 * Le call site client mappe ce code sur le toast i18n `payout_min_amount_error`.
 */
export const PAYOUT_BELOW_MINIMUM_ERROR = 'payout-below-minimum';

/**
 * Erreur typée levée par `requestPayout` quand le creator n'a pas assez de
 * solde pour couvrir le montant demandé.
 */
export const INSUFFICIENT_BALANCE_ERROR = 'insufficient-balance';

/**
 * Validation pure du montant de payout — utilisable en pur (tests sans emulator).
 * Retourne un descriptif typé. Le caller (requestPayout) le convertit en throw.
 *
 *  - `amount < effectiveMin`         → { ok: false, reason: 'payout-below-minimum' }
 *  - `amount > pendingPayout`        → { ok: false, reason: 'insufficient-balance' }
 *  - sinon                            → { ok: true }
 *
 * `minOverride` est la valeur paramétrée par Bassi via /admin/manage > Tarifs
 * (champ `settings/pricing.minPayoutCHF`). On clamp toujours à `MIN_PAYOUT_CHF`
 * comme plancher absolu — Bassi peut RELEVER le seuil (ex: 50 CHF) mais jamais
 * le descendre sous 10 CHF, par défense en profondeur cohérente avec
 * firestore.rules. Si `minOverride` est omis / invalide → fallback constante.
 */
export type PayoutValidationResult =
  | { ok: true }
  | { ok: false; reason: typeof PAYOUT_BELOW_MINIMUM_ERROR | typeof INSUFFICIENT_BALANCE_ERROR };

export function validatePayoutRequest(
  amount: number,
  pendingPayout: number,
  minOverride?: number,
): PayoutValidationResult {
  // Calcul du seuil effectif : max(MIN_PAYOUT_CHF, override admin si valide).
  // Un override invalide (NaN, négatif, non-number) tombe sur le fallback
  // constante MIN_PAYOUT_CHF — jamais sous le plancher.
  const overrideValid =
    typeof minOverride === 'number' && Number.isFinite(minOverride) && minOverride > MIN_PAYOUT_CHF;
  const effectiveMin = overrideValid ? minOverride : MIN_PAYOUT_CHF;

  // Garde durci : amount doit être un number fini > 0 ET >= seuil effectif.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < effectiveMin) {
    return { ok: false, reason: PAYOUT_BELOW_MINIMUM_ERROR };
  }
  if (pendingPayout < amount) {
    return { ok: false, reason: INSUFFICIENT_BALANCE_ERROR };
  }
  return { ok: true };
}
