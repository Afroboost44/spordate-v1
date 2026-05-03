/**
 * Spordateur — Phase 5
 * <SpotsIndicator> — Barre de remplissage des places d'une session.
 *
 * Tactique 2 anti-ghost-town : ne JAMAIS afficher "0/N" ou "1/N".
 * - Si currentParticipants < minVisibleCount (défaut 3) → "Places limitées · N max"
 * - Sinon → "X/N inscrits" + barre proportionnelle
 *
 * Charte stricte : barre #D91CD2 sur fond white/10, jamais de rouge/vert/orange.
 *
 * Accessibilité :
 * - role="meter" pour les SR (avec aria-valuenow/min/max)
 * - Texte explicite (pas que la barre visuelle)
 *
 * Usage :
 *   <SpotsIndicator currentParticipants={5} maxParticipants={10} />
 *   <SpotsIndicator currentParticipants={1} maxParticipants={10} />  // affiche "Places limitées"
 *   <SpotsIndicator currentParticipants={5} maxParticipants={10} minVisibleCount={5} />
 */

import { Users } from 'lucide-react';

export interface SpotsIndicatorProps {
  currentParticipants: number;
  maxParticipants: number;
  /** Seuil minimum pour afficher le compteur exact. Défaut 3 (Tactique 2). */
  minVisibleCount?: number;
  /** Variant compact ou plein. Défaut 'full'. */
  size?: 'sm' | 'full';
  className?: string;
}

export function SpotsIndicator({
  currentParticipants,
  maxParticipants,
  minVisibleCount = 3,
  size = 'full',
  className = '',
}: SpotsIndicatorProps) {
  // Edge case : maxParticipants invalide
  const safeMax = Math.max(1, maxParticipants);
  const safeCurrent = Math.max(0, currentParticipants);
  const fillRatio = Math.min(1, safeCurrent / safeMax);

  // Tactique 2 : sous le seuil, on ne montre pas le compte exact.
  const showCount = safeCurrent >= minVisibleCount;

  const labelText = showCount
    ? `${safeCurrent}/${safeMax} inscrits`
    : `Places limitées · ${safeMax} max`;

  const ariaLabel = showCount
    ? `${safeCurrent} places sur ${safeMax} prises`
    : `Places limitées, maximum ${safeMax} participants`;

  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const barHeight = size === 'sm' ? 'h-1' : 'h-1.5';

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className={`flex items-center gap-2 ${textSize} text-white/80 font-light`}>
        <Users className="h-3.5 w-3.5 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
        <span>{labelText}</span>
      </div>
      <div
        className={`w-full ${barHeight} rounded-full bg-white/10 overflow-hidden`}
        role="meter"
        aria-label={ariaLabel}
        aria-valuenow={safeCurrent}
        aria-valuemin={0}
        aria-valuemax={safeMax}
      >
        <div
          className="h-full bg-[#D91CD2] rounded-full"
          style={{ width: `${fillRatio * 100}%` }}
        />
      </div>
    </div>
  );
}
