/**
 * Spordateur — Phase 5
 * <InterestCounter> — Compteur d'intérêt cumulatif (Tactique 5 anti-ghost-town).
 *
 * Server Component (statique en Phase 5 — sera live en Phase 7 via subscribeToInterests
 * + collection activityViews ou similar).
 *
 * Affichage : icône Users (Lucide) + chiffre tabular-nums + label "membres intéressés".
 * - Singulier géré (count === 1 → "1 membre intéressé")
 * - count === 0 → ne rend rien (jamais de "0 intéressés", cohérent avec SpotsIndicator
 *   qui n'affiche jamais "0/N")
 *
 * Wording : "membres intéressés" (et non "sportifs" / "personnes") — plus
 * communautaire et inclusif. Pas de fenêtre temporelle ("cette semaine") pour
 * rester future-proof : la définition rolling-7d / ISO-week sera tranchée en
 * Phase 7 et le wording n'aura pas à bouger.
 *
 * Charte stricte :
 * - Icône #D91CD2
 * - Chiffre en text-white font-medium tabular-nums (relief sur label white/70)
 * - Aucune animation (statique)
 *
 * Variants :
 * - 'inline' (défaut) : badge horizontal compact (utilisé hero ou inline card)
 * - 'card' : encart avec border + padding (utilisé /sessions vide ou widget dashboard)
 *
 * Mock fallback : MOCK_INTEREST_COUNT depuis sessions-mock (47) si count omis.
 *
 * Usage :
 *   <InterestCounter />                       // 47 (mock)
 *   <InterestCounter count={123} />           // 123
 *   <InterestCounter count={1} />             // "1 membre intéressé" (singulier)
 *   <InterestCounter count={0} />             // null (anti-ghost-town)
 *   <InterestCounter variant="card" />        // version encart
 */

import { Users } from 'lucide-react';
import { MOCK_INTEREST_COUNT } from '@/lib/sessions-mock';

export interface InterestCounterProps {
  /** Nombre de membres intéressés. Si omis, fallback MOCK_INTEREST_COUNT (47). */
  count?: number;
  /** Variant visuel. Défaut 'inline'. */
  variant?: 'inline' | 'card';
  className?: string;
}

export function InterestCounter({
  count,
  variant = 'inline',
  className = '',
}: InterestCounterProps) {
  const value = count ?? MOCK_INTEREST_COUNT;

  // Anti-ghost-town : on n'affiche jamais "0 membres intéressés"
  if (value <= 0) return null;

  const label = value === 1 ? 'membre intéressé' : 'membres intéressés';

  if (variant === 'card') {
    return (
      <div
        className={`flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 ${className}`}
      >
        <Users className="h-5 w-5 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
        <p className="text-sm text-white/70 font-light">
          <span className="text-white font-medium tabular-nums">{value}</span>{' '}
          {label}
        </p>
      </div>
    );
  }

  return (
    <p
      className={`flex items-center gap-2 text-sm text-white/70 font-light ${className}`}
    >
      <Users className="h-4 w-4 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
      <span>
        <span className="text-white font-medium tabular-nums">{value}</span>{' '}
        {label}
      </span>
    </p>
  );
}
