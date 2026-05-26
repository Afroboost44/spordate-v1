/**
 * Helper de calcul TVA Spordateur — utilisable côté client ET serveur
 * (composants React, routes API, Cloud Functions, templates email).
 *
 * Source de vérité des settings : `settings/pricing` (cf. sitePricing.ts).
 * 3 champs concernés :
 *   - vatEnabled : toggle global (OFF par défaut, pas d'impact si false).
 *   - vatRate    : pourcentage (ex: 7.7 pour le taux standard CH).
 *   - vatMode    : 'included' = prix TTC affiché, on déduit le HT.
 *                  'added'    = prix HT affiché, TVA ajoutée par-dessus.
 *
 * Doctrine arrondi :
 *   On arrondit chaque ligne (subtotal, vat, total) à 2 décimales via
 *   Math.round(x * 100) / 100. C'est l'arrondi commercial standard. Pour
 *   les besoins comptables stricts (déclaration TVA), faire la somme des
 *   lignes peut introduire un écart d'arrondi de ±0.01 CHF par ligne —
 *   acceptable pour B2C, à raffiner si on attaque le B2B.
 *
 * Anti-régression : si vatEnabled=false, on retourne un breakdown
 * "transparent" (vat=0, subtotal=total=amount) pour que les callers
 * puissent toujours rendre la même UI conditionnelle sans branchement
 * explicite.
 */

export type VatMode = 'included' | 'added';

export interface VatBreakdown {
  /** Reflète l'état du toggle admin — utile pour conditionner l'affichage. */
  enabled: boolean;
  mode: VatMode;
  /** Pourcentage (ex: 7.7). */
  rate: number;
  /** Hors taxes (HT), arrondi 2 décimales. */
  subtotalCHF: number;
  /** Montant de la TVA, arrondi 2 décimales. */
  vatCHF: number;
  /** Toutes taxes comprises (TTC), arrondi 2 décimales. */
  totalCHF: number;
}

export interface VatOpts {
  enabled: boolean;
  mode: VatMode;
  rate: number;
}

/** Arrondit à 2 décimales (centime CHF). */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Calcule la ventilation TVA d'un montant CHF.
 *
 * @param amountCHF Le montant tel qu'affiché à l'utilisateur. Si mode='included',
 *                  c'est le TTC. Si mode='added', c'est le HT. Si enabled=false,
 *                  c'est simplement le total (pas de TVA appliquée).
 * @param opts      Settings TVA lus depuis `settings/pricing`.
 * @returns         Breakdown complet avec subtotalCHF, vatCHF, totalCHF.
 *
 * @example
 *   // Mode 'included' (recommandé B2C Suisse) : 100 CHF TTC à 7.7%
 *   computeVat(100, { enabled: true, mode: 'included', rate: 7.7 })
 *   // → { enabled: true, mode: 'included', rate: 7.7,
 *   //     subtotalCHF: 92.85, vatCHF: 7.15, totalCHF: 100 }
 *
 * @example
 *   // Mode 'added' : 100 CHF HT à 7.7% → total 107.70 CHF
 *   computeVat(100, { enabled: true, mode: 'added', rate: 7.7 })
 *   // → { subtotalCHF: 100, vatCHF: 7.7, totalCHF: 107.7 }
 *
 * @example
 *   // Désactivé (default OFF) : breakdown transparent
 *   computeVat(100, { enabled: false, mode: 'included', rate: 7.7 })
 *   // → { enabled: false, subtotalCHF: 100, vatCHF: 0, totalCHF: 100 }
 */
export function computeVat(amountCHF: number, opts: VatOpts): VatBreakdown {
  // Défensif : si amount invalide, on retourne tout à 0 plutôt que de
  // propager du NaN dans l'UI (qui afficherait "NaN CHF").
  const safeAmount = Number.isFinite(amountCHF) && amountCHF >= 0 ? amountCHF : 0;
  const safeRate = Number.isFinite(opts.rate) && opts.rate >= 0 ? opts.rate : 0;

  if (!opts.enabled) {
    return {
      enabled: false,
      mode: opts.mode,
      rate: safeRate,
      subtotalCHF: round2(safeAmount),
      vatCHF: 0,
      totalCHF: round2(safeAmount),
    };
  }

  if (opts.mode === 'included') {
    // Le montant passé EST le TTC. On déduit le HT.
    const subtotal = safeAmount / (1 + safeRate / 100);
    const vat = safeAmount - subtotal;
    return {
      enabled: true,
      mode: 'included',
      rate: safeRate,
      subtotalCHF: round2(subtotal),
      vatCHF: round2(vat),
      totalCHF: round2(safeAmount),
    };
  }

  // mode === 'added' : le montant passé EST le HT. TVA en plus.
  const vat = safeAmount * (safeRate / 100);
  const total = safeAmount + vat;
  return {
    enabled: true,
    mode: 'added',
    rate: safeRate,
    subtotalCHF: round2(safeAmount),
    vatCHF: round2(vat),
    totalCHF: round2(total),
  };
}

/**
 * Formate un montant CHF en chaîne "X.XX CHF" (locale-neutre, on garde le
 * point décimal pour cohérence avec les pages checkout existantes qui
 * utilisent `toFixed(2)`).
 */
export function formatChfAmount(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toFixed(2)} CHF`;
}
