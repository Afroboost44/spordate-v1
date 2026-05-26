/**
 * BUG #92 — Prix Spordateur (likes + boost user + boost partenaire).
 *
 * Source de vérité : Firestore `settings/pricing` (doc unique, partagé avec
 * `chatPricing.ts`). L'admin édite via /admin/manage > tab Tarifs.
 *
 * Conventions :
 *   - Les coûts en CRÉDITS sont des entiers >= 0.
 *   - Les prix en CHF sont des nombres >= 0 avec 2 décimales.
 *   - `freeLikesPerDay` est le quota offert avant que les likes ne coûtent
 *     des crédits (alignement Tinder free / Hinge free).
 *
 * Anti-régression (PRICING-PROPOSAL.md §8) :
 *   - Les ACTIVITÉS se payent uniquement par Stripe carte/TWINT — ces prix
 *     concernent UNIQUEMENT les services intra-app.
 *   - Le boost partenaire est en CHF (dépense pro coachs/clubs) et passera
 *     par /api/checkout/boost-partner (fix #93), pas par les crédits.
 */

import type { Firestore } from 'firebase-admin/firestore';

// =====================================================================
// Defaults (fallback si doc absent ou champ manquant) — fix #92
// =====================================================================

export const DEFAULT_SITE_PRICING = {
  /** Coût en crédits d'un like premium (après quota gratuit). */
  likeCost: 1,
  /** Quota de likes offerts par jour avant débit de crédits. */
  freeLikesPerDay: 10,

  /** Coût en crédits du Boost User 30 minutes. */
  boostUser30minCost: 50,
  /** Coût en crédits du Boost User 1 heure. */
  boostUser1hCost: 90,
  /** Coût en crédits du Boost User 6 heures. */
  boostUser6hCost: 300,

  /** BUG #95 — Prix CHF du Boost Partenaire 24 heures (durées alignées sur
   * /partner/boost : 24h / 3 jours / 1 semaine). */
  boostPartner24hPriceCHF: 15,
  /** Prix CHF du Boost Partenaire 3 jours. */
  boostPartner3dPriceCHF: 35,
  /** Prix CHF du Boost Partenaire 1 semaine (7 jours). */
  boostPartner7dPriceCHF: 50,

  /**
   * Montant minimum (CHF) qu'un creator doit avoir pour demander un retrait.
   * Floor absolu : 10 CHF (cf. firestore.rules + `MIN_PAYOUT_CHF`). Bassi peut
   * RELEVER ce seuil depuis /admin/manage > Tarifs, jamais le descendre.
   */
  minPayoutCHF: 10,

  /**
   * TVA Suisse — paramétrable admin (OFF par défaut).
   * Quand activée, la TVA s'affiche sur le checkout, le wallet partenaire et
   * (à terme) les emails de confirmation. Le calcul passe par
   * `computeVat()` dans `@/lib/pricing/vat`.
   *
   * Pourquoi ces 3 champs :
   *   - vatEnabled  : permet à Bassi d'activer/désactiver la TVA sans
   *     redéployer (mais aussi de revenir en arrière si besoin).
   *   - vatRate     : pourcentage (par défaut 7.7 pour le taux standard CH).
   *     Clampé entre 0 et 30 pour éviter les fat-finger admin.
   *   - vatMode     : 'included' = prix TTC affiché, on déduit le HT
   *     (recommandé B2C Suisse — le client voit le prix final).
   *     'added' = prix HT affiché, TVA en plus (B2B / cas particuliers).
   */
  vatEnabled: false,
  vatRate: 7.7,
  vatMode: 'included' as 'included' | 'added',
} as const;

export interface SitePricing {
  likeCost: number;
  freeLikesPerDay: number;
  boostUser30minCost: number;
  boostUser1hCost: number;
  boostUser6hCost: number;
  boostPartner24hPriceCHF: number;
  boostPartner3dPriceCHF: number;
  boostPartner7dPriceCHF: number;
  minPayoutCHF: number;
  vatEnabled: boolean;
  vatRate: number;
  vatMode: 'included' | 'added';
}

// =====================================================================
// Helpers (server-side, Admin SDK)
// =====================================================================

/** Lit le doc settings/pricing avec fallback defaults. Server-only. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSitePricing(db: any): Promise<SitePricing> {
  try {
    const snap = await db.collection('settings').doc('pricing').get();
    if (!snap.exists) return { ...DEFAULT_SITE_PRICING };
    const data = snap.data() || {};
    return {
      likeCost: sanitizeInt(data.likeCost, DEFAULT_SITE_PRICING.likeCost),
      freeLikesPerDay: sanitizeInt(data.freeLikesPerDay, DEFAULT_SITE_PRICING.freeLikesPerDay),
      boostUser30minCost: sanitizeInt(data.boostUser30minCost, DEFAULT_SITE_PRICING.boostUser30minCost),
      boostUser1hCost: sanitizeInt(data.boostUser1hCost, DEFAULT_SITE_PRICING.boostUser1hCost),
      boostUser6hCost: sanitizeInt(data.boostUser6hCost, DEFAULT_SITE_PRICING.boostUser6hCost),
      boostPartner24hPriceCHF: sanitizeChf(data.boostPartner24hPriceCHF, DEFAULT_SITE_PRICING.boostPartner24hPriceCHF),
      boostPartner3dPriceCHF:  sanitizeChf(data.boostPartner3dPriceCHF,  DEFAULT_SITE_PRICING.boostPartner3dPriceCHF),
      boostPartner7dPriceCHF:  sanitizeChf(data.boostPartner7dPriceCHF,  DEFAULT_SITE_PRICING.boostPartner7dPriceCHF),
      minPayoutCHF:            sanitizeChf(data.minPayoutCHF,            DEFAULT_SITE_PRICING.minPayoutCHF),
      vatEnabled:              sanitizeVatEnabled(data.vatEnabled,       DEFAULT_SITE_PRICING.vatEnabled),
      vatRate:                 sanitizeVatRate(data.vatRate,             DEFAULT_SITE_PRICING.vatRate),
      vatMode:                 sanitizeVatMode(data.vatMode,             DEFAULT_SITE_PRICING.vatMode),
    };
  } catch (err) {
    console.warn('[sitePricing] read failed, using defaults', err);
    return { ...DEFAULT_SITE_PRICING };
  }
}

// =====================================================================
// Validation helpers (partagés client + server pour cohérence)
// =====================================================================

/** Sanitize un entier crédits : >= 0, entier, fallback default si invalide. */
export function sanitizeInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** Sanitize un prix CHF : >= 0, arrondi 2 décimales, max 9999 pour safety. */
export function sanitizeChf(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n > 9999) return fallback;
  return Math.round(n * 100) / 100;
}

/** Sanitize le toggle TVA : strict boolean, sinon fallback. */
export function sanitizeVatEnabled(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  return fallback;
}

/**
 * Sanitize un taux TVA : pourcentage entre 0 et 30 (safety cap). Si invalide
 * → fallback. On garde 1 décimale arrondie (ex: 7.7, 8.1, 25.0).
 */
export function sanitizeVatRate(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0 || n > 30) return fallback;
  return Math.round(n * 10) / 10;
}

/** Sanitize le mode TVA : whitelist stricte. */
export function sanitizeVatMode(
  raw: unknown,
  fallback: 'included' | 'added',
): 'included' | 'added' {
  return raw === 'included' || raw === 'added' ? raw : fallback;
}
