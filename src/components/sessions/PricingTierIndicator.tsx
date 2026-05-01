/**
 * Spordateur — Phase 4
 * <PricingTierIndicator> — affiche les 3 paliers de prix progressifs (Early Bird → Standard → Last Minute)
 * et met en valeur le palier actif.
 *
 * Logique :
 * - Tier passé   → strikethrough + opacity 0.4 + outline neutre
 * - Tier actif   → border #D91CD2 + icon fill + font-semibold + prix en valeur
 * - Tier futur   → border white/20 + opacity 0.7 + font-light
 *
 * Différenciation par ICÔNE + OPACITÉ + TYPOGRAPHIE.
 * AUCUNE différenciation par couleur sémantique (pas de rouge/vert/orange) — charte Afroboost stricte.
 *
 * Affichage :
 *   ┌──────────────┬──────────────┬──────────────┐
 *   │  ✦ EARLY     │  ⏱ STANDARD  │  ⚡ LAST MIN │
 *   │  ─────       │  active      │              │
 *   │  25 CHF      │  35 CHF      │  45 CHF      │
 *   └──────────────┴──────────────┴──────────────┘
 *
 * Layout :
 * - Mobile (< 640px) : 3 segments empilés en colonne
 * - Desktop (≥ 640px) : 3 segments en grille horizontale
 *
 * Accessibilité :
 * - aria-current="step" sur le palier actif (sémantique progress steps)
 * - Texte explicite "Early Bird" / "Standard" / "Last Minute" (pas que l'icône)
 * - aria-label complet sur chaque segment incluant le prix
 *
 * Usage :
 *   <PricingTierIndicator activeTier="standard" tiers={session.pricingTiers} />
 *   <PricingTierIndicator activeTier="early" tiers={session.pricingTiers} showPrices={false} />
 */

'use client';

import { Sparkles, Clock, Zap } from 'lucide-react';
import type { PricingTier, PricingTierKind } from '@/types/firestore';

export interface PricingTierIndicatorProps {
  /** Palier actuellement actif. */
  activeTier: PricingTierKind;
  /** Liste des paliers (avec leurs prix). Doit contenir 1 entrée par PricingTierKind. */
  tiers: PricingTier[];
  /** Si true, affiche les prix sous chaque palier. Défaut true. */
  showPrices?: boolean;
  className?: string;
}

interface TierMeta {
  kind: PricingTierKind;
  label: string;
  Icon: typeof Sparkles;
  rank: number;
}

const TIERS_META: TierMeta[] = [
  { kind: 'early', label: 'Early Bird', Icon: Sparkles, rank: 0 },
  { kind: 'standard', label: 'Standard', Icon: Clock, rank: 1 },
  { kind: 'last_minute', label: 'Last Minute', Icon: Zap, rank: 2 },
];

/** Formate un prix en centimes vers un display CHF (ex: 2500 → "25 CHF"). */
function formatPrice(centimes: number): string {
  const chf = centimes / 100;
  // Si entier, pas de décimales ; sinon 2 décimales
  return chf % 1 === 0 ? `${chf} CHF` : `${chf.toFixed(2)} CHF`;
}

export function PricingTierIndicator({
  activeTier,
  tiers,
  showPrices = true,
  className = '',
}: PricingTierIndicatorProps) {
  const activeRank = TIERS_META.find((t) => t.kind === activeTier)?.rank ?? 0;

  return (
    <ol
      className={`flex flex-col sm:flex-row gap-2 sm:gap-3 list-none p-0 m-0 ${className}`}
      aria-label="Paliers de prix progressifs"
    >
      {TIERS_META.map((meta) => {
        const tier = tiers.find((t) => t.kind === meta.kind);
        const price = tier?.price ?? 0;
        const isActive = meta.kind === activeTier;
        const isPassed = meta.rank < activeRank;

        // Charte stricte — différenciation par opacité + bordure + typographie, JAMAIS par couleur sémantique.
        let containerClass = 'border-white/20 opacity-70 font-light';
        if (isActive) {
          containerClass = 'border-[#D91CD2] opacity-100 font-semibold';
        } else if (isPassed) {
          containerClass = 'border-white/10 opacity-40 font-light';
        }

        // Icône : couleur uniquement #D91CD2 sur le tier actif. Sinon white/40 (passé) ou white/60 (futur).
        let iconClass = 'text-white/60';
        if (isActive) iconClass = 'text-[#D91CD2]';
        else if (isPassed) iconClass = 'text-white/40';

        const labelEl = isPassed ? <s>{meta.label}</s> : meta.label;

        const priceText = showPrices ? formatPrice(price) : null;
        const ariaLabel = `${meta.label}${priceText ? ` ${priceText}` : ''}${isActive ? ' (palier actif)' : isPassed ? ' (palier passé)' : ' (palier futur)'}`;

        return (
          <li
            key={meta.kind}
            aria-current={isActive ? 'step' : undefined}
            aria-label={ariaLabel}
            className={`flex-1 border rounded-lg px-3 py-3 sm:px-4 sm:py-4 bg-black/40 transition-none ${containerClass}`}
          >
            <div className="flex items-center gap-2">
              <meta.Icon className={`h-4 w-4 flex-shrink-0 ${iconClass}`} aria-hidden="true" />
              <span className="text-xs sm:text-sm uppercase tracking-wider text-white">
                {labelEl}
              </span>
            </div>
            {showPrices && (
              <p
                className={`mt-2 text-base sm:text-lg tabular-nums ${isPassed ? 'line-through text-white/40' : 'text-white'}`}
              >
                {priceText}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
