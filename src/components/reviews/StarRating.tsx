/**
 * Spordateur — Phase 7 sub-chantier 1 commit 3/6
 * <StarRating> — affichage de 5 étoiles avec support partial fill (4.6 = 4 pleines + 60%).
 *
 * Charte stricte (cf. .clauderules RÈGLE 2 + audit Phase 7) :
 * - Étoiles pleines : #D91CD2 (accent unique de la charte)
 * - Étoiles vides : text-white/30 (différenciation par opacité, pas par couleur)
 * - Background reste transparent (hérite parent black)
 *
 * Display only — pour input cliquable, voir StarRatingInput.tsx.
 *
 * Implémentation partial fill : stack 2 Star icons (outline + filled),
 * outline en background, filled clipped via CSS overflow + width %.
 *
 * Usage :
 *   <StarRating value={4.6} />            // 4 pleines + 60% partial + 0 vides
 *   <StarRating value={3} size="sm" />    // 3 pleines + 2 vides, taille sm
 *   <StarRating value={4.6} showValue={false} />  // sans label "(X.X)"
 */

import { Star } from 'lucide-react';

export interface StarRatingProps {
  /** Note 0-5 (peut être décimal pour partial fill, ex: 4.6). */
  value: number;
  /** Taille des étoiles. Défaut 'md'. */
  size?: 'sm' | 'md' | 'lg';
  /** Si true, affiche la valeur numérique à droite (ex: "4.6"). Défaut true. */
  showValue?: boolean;
  /** Décimales pour la valeur affichée. Défaut 1 (ex: "4.6"). */
  precision?: number;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<StarRatingProps['size']>, string> = {
  sm: 'h-3 w-3',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
};

const TEXT_SIZE_CLASS: Record<NonNullable<StarRatingProps['size']>, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export function StarRating({
  value,
  size = 'md',
  showValue = true,
  precision = 1,
  className = '',
}: StarRatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const iconSize = SIZE_CLASS[size];
  const textSize = TEXT_SIZE_CLASS[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label={`Note : ${clamped.toFixed(precision)} sur 5`}
      role="img"
    >
      <span className="inline-flex gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => {
          // Pour chaque étoile : combien remplie en %
          const fill = Math.max(0, Math.min(1, clamped - i)); // 0..1
          const fillPercent = Math.round(fill * 100);
          return (
            <span key={i} className="relative inline-block">
              {/* Étoile vide en background (outline) */}
              <Star
                className={`${iconSize} text-white/30`}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {/* Étoile pleine clipée selon fillPercent */}
              {fillPercent > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden pointer-events-none"
                  style={{ width: `${fillPercent}%` }}
                  aria-hidden="true"
                >
                  <Star
                    className={`${iconSize} text-[#D91CD2] fill-[#D91CD2]`}
                    strokeWidth={1.5}
                  />
                </span>
              )}
            </span>
          );
        })}
      </span>
      {showValue && (
        <span className={`${textSize} text-white font-medium tabular-nums`}>
          {clamped.toFixed(precision)}
        </span>
      )}
    </span>
  );
}
