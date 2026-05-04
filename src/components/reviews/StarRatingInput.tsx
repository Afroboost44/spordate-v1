/**
 * Spordateur — Phase 7 sub-chantier 1 commit 3/6
 * <StarRatingInput> — 5 étoiles cliquables pour saisie note 1-5 (entiers uniquement).
 *
 * Charte stricte : pleines #D91CD2, vides text-white/30, hover preview #D91CD2/60.
 *
 * UX :
 * - Clic 1ère étoile = note 1, 2ème = 2, etc.
 * - Hover : preview de la note potentielle (filled jusqu'au cursor)
 * - Re-clic même étoile (= note actuelle) → désélection (value=null)
 * - Keyboard support : Tab/Space sur chaque bouton (a11y)
 * - Pas de partial fill (entiers uniquement, contrairement à StarRating display)
 *
 * Usage :
 *   const [rating, setRating] = useState<number | null>(null);
 *   <StarRatingInput value={rating} onChange={setRating} />
 */

'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

export interface StarRatingInputProps {
  /** Valeur courante 1-5 ou null si non sélectionnée. */
  value: number | null;
  /** Callback au changement (null si re-clic même étoile = désélection). */
  onChange: (rating: number | null) => void;
  /** Taille des étoiles. Défaut 'lg' (formulaires = grosse cible tactile). */
  size?: 'md' | 'lg';
  /** Si true, désactive l'input. Défaut false. */
  disabled?: boolean;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<StarRatingInputProps['size']>, string> = {
  md: 'h-6 w-6',
  lg: 'h-9 w-9',
};

export function StarRatingInput({
  value,
  onChange,
  size = 'lg',
  disabled = false,
  className = '',
}: StarRatingInputProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const iconSize = SIZE_CLASS[size];

  const handleClick = (rating: number) => {
    if (disabled) return;
    // Re-clic même étoile = désélection
    if (rating === value) {
      onChange(null);
    } else {
      onChange(rating);
    }
  };

  // Valeur affichée : hover preview prend le dessus si hover en cours
  const displayValue = hoverValue !== null ? hoverValue : (value ?? 0);

  return (
    <div
      className={`inline-flex gap-1 ${className}`}
      role="radiogroup"
      aria-label="Note 1 à 5 étoiles"
      onMouseLeave={() => setHoverValue(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const isFilled = star <= displayValue;
        const isHover = hoverValue !== null && hoverValue >= star;
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={() => handleClick(star)}
            onMouseEnter={() => !disabled && setHoverValue(star)}
            onFocus={() => !disabled && setHoverValue(star)}
            onBlur={() => setHoverValue(null)}
            aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
            aria-checked={value === star}
            role="radio"
            className={`p-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              disabled ? '' : 'hover:bg-white/5 cursor-pointer'
            }`}
          >
            <Star
              className={`${iconSize} ${
                isFilled
                  ? isHover && star > (value ?? 0)
                    ? 'text-[#D91CD2]/60 fill-[#D91CD2]/60' // hover preview
                    : 'text-[#D91CD2] fill-[#D91CD2]'
                  : 'text-white/30'
              } transition-colors`}
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
