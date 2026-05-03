/**
 * Spordateur — Phase 5
 * <PricingTimeline> — Wrapper de présentation autour de <PricingTierIndicator> Phase 4.
 *
 * Ajoute :
 * - Titre "Prix progressif"
 * - Ligne explicative "Plus tu réserves tôt, moins c'est cher"
 * - Layout adapté pour la page détail session (le PricingTierIndicator est utilisable
 *   tel quel ailleurs sans ce wrapper)
 *
 * Charte stricte : titre blanc, sous-titre white/70.
 *
 * Usage :
 *   <PricingTimeline activeTier={session.currentTier} tiers={session.pricingTiers} />
 */

import { PricingTierIndicator } from './PricingTierIndicator';
import type { PricingTier, PricingTierKind } from '@/types/firestore';

export interface PricingTimelineProps {
  activeTier: PricingTierKind;
  tiers: PricingTier[];
  /** Si false, cache le titre + sous-titre. Défaut true. */
  showHeader?: boolean;
  /** Si false, masque les prix sous chaque palier (passe au PricingTierIndicator). Défaut true. */
  showPrices?: boolean;
  className?: string;
}

export function PricingTimeline({
  activeTier,
  tiers,
  showHeader = true,
  showPrices = true,
  className = '',
}: PricingTimelineProps) {
  return (
    <section className={`flex flex-col gap-3 ${className}`} aria-labelledby="pricing-timeline-heading">
      {showHeader && (
        <header className="flex flex-col gap-1">
          <h2 id="pricing-timeline-heading" className="text-base sm:text-lg text-white font-light">
            Prix progressif
          </h2>
          <p className="text-xs sm:text-sm text-white/70 font-light">
            Plus tu réserves tôt, moins c&apos;est cher.
          </p>
        </header>
      )}
      <PricingTierIndicator activeTier={activeTier} tiers={tiers} showPrices={showPrices} />
    </section>
  );
}
