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
