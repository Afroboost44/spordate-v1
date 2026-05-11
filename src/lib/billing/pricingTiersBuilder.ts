/**
 * Phase 9.5 c31 BUG HH — Pure helpers pour l'édition des 3 paliers de prix
 * progressifs côté UI partner (/partner/offers).
 *
 * Cohérent avec `computeFallbackTiers(activityPriceCHF)` de services/firestore.ts :
 * mêmes triggers temporel/remplissage (7j+0% / 24h+50% / 1h+90%), même conversion
 * CHF → centimes. La différence : ici l'utilisateur édite manuellement chaque
 * palier (le fallback automatique c29a reste filet de sécurité si le partner
 * ne configure rien).
 */

import type { PricingTier } from '@/types/firestore';

export interface PricingTiersInput {
  /** Prix Early Bird en CHF entier (input partner). */
  earlyCHF: number;
  /** Prix Standard en CHF entier (input partner). */
  standardCHF: number;
  /** Prix Last Minute en CHF entier (input partner). */
  lastMinuteCHF: number;
}

/**
 * Erreurs possibles à la validation. Messages stables pour la table i18n côté UI.
 */
export type PricingValidationError = 'positive' | 'order';

/**
 * Suggère 3 paliers de prix à partir du prix de base — utilisé pour pré-remplir
 * les inputs quand le partner active le toggle pour la première fois. Identique
 * aux multiplicateurs de computeFallbackTiers (80/100/120%).
 */
export function suggestPricingTiersFromBase(basePriceCHF: number): PricingTiersInput {
  return {
    earlyCHF: Math.round(basePriceCHF * 0.8),
    standardCHF: basePriceCHF,
    lastMinuteCHF: Math.round(basePriceCHF * 1.2),
  };
}

/**
 * Valide les 3 paliers. Throw avec un message clé pour mapping i18n côté UI.
 *  - 'positive' : au moins un palier <= 0
 *  - 'order' : pas dans l'ordre croissant early < standard < last_minute
 */
export function validatePricingTiers(input: PricingTiersInput): void {
  if (input.earlyCHF <= 0 || input.standardCHF <= 0 || input.lastMinuteCHF <= 0) {
    throw new Error('positive');
  }
  if (
    !(input.earlyCHF < input.standardCHF && input.standardCHF < input.lastMinuteCHF)
  ) {
    throw new Error('order');
  }
}

/**
 * Construit le payload Activity.defaultPricingTiers depuis l'état UI :
 *  - toggle OFF → [] (signifie "pas de prix progressif, utiliser activity.price")
 *  - toggle ON → 3 tiers (centimes, triggers identiques au fallback c29a)
 *
 * NE valide PAS l'input — appeler `validatePricingTiers()` avant pour vérifier
 * l'ordre et la positivité. Si invalide, comportement non spécifié.
 */
export function buildPricingTiersPayload(
  enabled: boolean,
  input: PricingTiersInput,
): PricingTier[] {
  if (!enabled) return [];
  return [
    {
      kind: 'early',
      price: Math.round(input.earlyCHF * 100),
      activateMinutesBeforeStart: 10080, // 7 jours
      activateAtFillRate: 0,
    },
    {
      kind: 'standard',
      price: Math.round(input.standardCHF * 100),
      activateMinutesBeforeStart: 1440, // 24 heures
      activateAtFillRate: 0.5,
    },
    {
      kind: 'last_minute',
      price: Math.round(input.lastMinuteCHF * 100),
      activateMinutesBeforeStart: 60, // 1 heure
      activateAtFillRate: 0.9,
    },
  ];
}

/**
 * Parse les tiers Firestore (centimes) → input UI (CHF) pour pré-remplir
 * les 3 inputs à l'ouverture de la modal d'édition. Si un kind manque,
 * fallback à 0 (le toggle sera quand même considéré ON par la UI car
 * defaultPricingTiers.length > 0).
 */
export function parsePricingTiersFromFirestore(
  tiers: PricingTier[] | undefined | null,
): PricingTiersInput | null {
  if (!tiers || tiers.length === 0) return null;
  const early = tiers.find((t) => t.kind === 'early');
  const standard = tiers.find((t) => t.kind === 'standard');
  const last = tiers.find((t) => t.kind === 'last_minute');
  return {
    earlyCHF: early ? early.price / 100 : 0,
    standardCHF: standard ? standard.price / 100 : 0,
    lastMinuteCHF: last ? last.price / 100 : 0,
  };
}
