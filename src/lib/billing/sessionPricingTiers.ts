/**
 * Fix B B2 — Helper pur pour construire le tableau PricingTier[] à
 * appliquer sur Session.pricingTiers selon le mode partner override.
 *
 *  - mode='custom' : 3 tiers identiques au customPriceCHF (centimes après
 *    × 100). Modèle "Override total" décision Bassi : computePricingTier
 *    retourne toujours customPriceCHF quel que soit le moment ou le fill.
 *
 *  - mode='inherit' : copie exacte de activityPricingTiers si non-vides,
 *    sinon fallback computeFallbackTiers(activityPriceCHF) (Phase 9.5 c29a,
 *    progression early × 0.8 / standard × 1 / last_minute × 1.2).
 *
 * Clamp défensif : customPriceCHF négatif → 0 (free booking flow géré
 * en aval). Arrondi à l'entier centime (Math.round).
 *
 * @module
 */

import type { PricingTier, PricingTierKind } from '@/types/firestore';

/**
 * Fallback tiers calibrés (Phase 9.5 c29a). Dupliqué localement pour rester
 * self-contained (services/firestore.ts importe le Web SDK Firebase et ne peut
 * pas être tiré dans un endpoint Node sans coût ; même pattern que
 * /api/sessions/ensure-from-activity).
 *
 * Multiplicateurs : early × 0.8 / standard × 1 / last_minute × 1.2.
 * Triggers : early dès 7j, standard 24h ou 50% fill, last_minute 1h ou 90% fill.
 */
function computeFallbackTiersLocal(activityPriceCHF: number): PricingTier[] {
  const baseCentimes = Math.round(activityPriceCHF * 100);
  return [
    {
      kind: 'early',
      price: Math.round(baseCentimes * 0.8),
      activateMinutesBeforeStart: 10080,
      activateAtFillRate: 0,
    },
    {
      kind: 'standard',
      price: baseCentimes,
      activateMinutesBeforeStart: 1440,
      activateAtFillRate: 0.5,
    },
    {
      kind: 'last_minute',
      price: Math.round(baseCentimes * 1.2),
      activateMinutesBeforeStart: 60,
      activateAtFillRate: 0.9,
    },
  ];
}

export interface BuildSessionPricingTiersInput {
  mode: 'custom' | 'inherit';
  /** Requis si mode='custom'. CHF (peut être décimal). */
  customPriceCHF?: number;
  /** Si mode='inherit', copie ces tiers (priorité). */
  activityPricingTiers?: PricingTier[];
  /** Fallback inherit si activityPricingTiers absent/vide (CHF entier). */
  activityPriceCHF: number;
}

const TIER_TRIGGERS: Record<PricingTierKind, {
  activateMinutesBeforeStart: number;
  activateAtFillRate: number;
}> = {
  early: { activateMinutesBeforeStart: 10080, activateAtFillRate: 0 },
  standard: { activateMinutesBeforeStart: 1440, activateAtFillRate: 0.5 },
  last_minute: { activateMinutesBeforeStart: 60, activateAtFillRate: 0.9 },
};

/**
 * Retourne 3 tiers (early/standard/last_minute) calibrés selon le mode.
 * Structure stable : ordering early < standard < last_minute,
 * activateMinutesBeforeStart + activateAtFillRate constants par kind.
 */
export function buildSessionPricingTiers(input: BuildSessionPricingTiersInput): PricingTier[] {
  if (input.mode === 'custom') {
    const cents = Math.max(0, Math.round((input.customPriceCHF ?? 0) * 100));
    return (['early', 'standard', 'last_minute'] as PricingTierKind[]).map((kind) => ({
      kind,
      price: cents,
      ...TIER_TRIGGERS[kind],
    }));
  }

  // mode='inherit'
  if (input.activityPricingTiers && input.activityPricingTiers.length > 0) {
    // Copie exacte (les triggers de l'activity peuvent diverger des defaults).
    return input.activityPricingTiers.map((t) => ({
      kind: t.kind,
      price: t.price,
      activateMinutesBeforeStart: t.activateMinutesBeforeStart,
      activateAtFillRate: t.activateAtFillRate,
    }));
  }

  // Fallback : tiers calibrés depuis Activity.price (legacy vitrine).
  return computeFallbackTiersLocal(input.activityPriceCHF);
}
