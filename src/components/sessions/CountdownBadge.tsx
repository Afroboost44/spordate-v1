/**
 * Spordateur — Phase 4
 * <CountdownBadge> — countdown compact pour cards de session.
 *
 * Charte Afroboost stricte : #000000 fond, #D91CD2 accent, #FFFFFF texte.
 * Différenciation visuelle par icône + opacité + typographie. JAMAIS par couleur sémantique.
 *
 * Accessibilité :
 * - aria-live="polite" UNIQUEMENT à < 1 minute (sinon SR spammé). Sinon aria-hidden=true sur la
 *   région countdown + aria-label statique sur le parent.
 * - tabular-nums pour éviter le layout shift à chaque tick.
 * - prefers-reduced-motion : pas d'animation au tick (juste les chiffres changent).
 *
 * Usage :
 *   <CountdownBadge target={session.startAt} />
 *   <CountdownBadge target={session.startAt} size="md" label="Démarre dans" />
 *   <CountdownBadge target={session.startAt} expiredText="En cours" />
 */

'use client';

import { Clock } from 'lucide-react';
import { useCountdown } from '@/hooks/useCountdown';
import { formatBadge } from './format';
import type { Timestamp } from 'firebase/firestore';

export interface CountdownBadgeProps {
  /** Cible : Date, Timestamp Firestore, ou epoch ms. */
  target: Date | Timestamp | number;
  /** Variant visuel. Défaut 'sm'. */
  size?: 'sm' | 'md';
  /** Label optionnel affiché avant le compteur (ex: "Dans"). */
  label?: string;
  /** Texte affiché quand la cible est dépassée. Défaut "Démarré". */
  expiredText?: string;
  className?: string;
}

export function CountdownBadge({
  target,
  size = 'sm',
  label,
  expiredText = 'Démarré',
  className = '',
}: CountdownBadgeProps) {
  // Tick 1s — suffisant pour un badge (le chiffre des secondes change).
  // Si target est très loin, le badge affichera juste "J-N HH:MM" qui ne change qu'au passage de minuit.
  // Cf. Phase 7 : optimisation possible avec tickMs adaptatif.
  const { totalMs, isExpired } = useCountdown(target);

  const formatted = formatBadge(target, { expiredText });

  // aria-live actif UNIQUEMENT à < 60s pour éviter de spammer les SR.
  // Au-dessus, le compteur est traité comme décoratif et le label statique de l'aria-label suffit.
  const isCritical = !isExpired && totalMs < 60_000;
  const ariaLive: 'polite' | 'off' = isCritical ? 'polite' : 'off';
  const ariaHidden = isCritical ? undefined : true;

  // Charte stricte :
  // - fond noir/transparent (la card derrière sera #000)
  // - bordure subtile #FFFFFF/10
  // - texte #FFFFFF
  // - icône #D91CD2 (accent)
  const sizeClasses = size === 'sm'
    ? 'text-xs px-2.5 py-1 gap-1.5'
    : 'text-sm px-3 py-1.5 gap-2';

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border border-white/10 bg-black/40 ${sizeClasses} text-white tabular-nums whitespace-nowrap ${className}`}
      aria-label={label ? `${label} ${formatted}` : formatted}
    >
      <Clock className={`${iconSize} text-[#D91CD2] flex-shrink-0`} aria-hidden="true" />
      {label && <span className="text-white/60 font-light">{label}</span>}
      <span
        aria-live={ariaLive}
        aria-hidden={ariaHidden}
        className="font-medium"
      >
        {formatted}
      </span>
    </span>
  );
}
