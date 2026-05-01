/**
 * Spordateur — Phase 4
 * <CountdownHero> — countdown grand format pour la page détail d'une session.
 *
 * Affichage :
 *   ┌────────────────────────────────────────┐
 *   │     03 j  18 h  42 m  15 s             │
 *   │     ──── ──── ──── ────                │
 *   │    JOURS HEURES MIN  SEC               │
 *   │                                         │
 *   │     Cours dans 3 jours                  │
 *   └────────────────────────────────────────┘
 *
 * Charte Afroboost stricte : #000000 fond, #D91CD2 accent, #FFFFFF texte.
 * Pas d'animation (prefers-reduced-motion respecté par défaut — les chiffres changent juste).
 *
 * Accessibilité :
 * - tabular-nums strict (chiffres alignés colonne par colonne)
 * - aria-live="polite" sur la région entière, mais aria-hidden=true sur les chiffres > 60s
 *   pour éviter de spammer les SR
 * - phase optionnelle pour afficher un sous-titre contextuel ("Cours dans 3 jours" / "Chat ouvert" / etc.)
 *
 * Usage :
 *   <CountdownHero target={session.startAt} />
 *   <CountdownHero target={session.startAt} phase="chat-open" />
 *   <CountdownHero target={session.endAt} expiredTitle="Session terminée" />
 */

'use client';

import { useCountdown } from '@/hooks/useCountdown';
import type { SessionPhase } from '@/hooks/useSessionWindow';
import type { Timestamp } from 'firebase/firestore';

export interface CountdownHeroProps {
  /** Cible : Date, Timestamp Firestore, ou epoch ms. */
  target: Date | Timestamp | number;
  /** Phase optionnelle pour afficher un sous-titre contextuel. */
  phase?: SessionPhase;
  /** Texte affiché quand la cible est dépassée. Défaut dépend du contexte. */
  expiredTitle?: string;
  className?: string;
}

const PHASE_SUBTITLE: Record<SessionPhase, string> = {
  before: 'Le chat ouvre dans',
  'chat-open': 'Démarre dans',
  started: 'En cours · termine dans',
  ended: 'Terminé',
};

/** Pad une valeur sur 2 chiffres : 5 → "05", 12 → "12". */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function CountdownHero({
  target,
  phase,
  expiredTitle,
  className = '',
}: CountdownHeroProps) {
  const { days, hours, minutes, seconds, totalMs, isExpired } = useCountdown(target);

  const isCritical = !isExpired && totalMs < 60_000;
  const ariaLive: 'polite' | 'off' = isCritical ? 'polite' : 'off';

  if (isExpired) {
    return (
      <div
        className={`text-center ${className}`}
        role="status"
        aria-live="polite"
      >
        <p className="text-white/60 text-sm uppercase tracking-wider font-light">
          {expiredTitle ?? (phase === 'ended' ? 'Terminé' : 'Démarré')}
        </p>
      </div>
    );
  }

  const subtitle = phase ? PHASE_SUBTITLE[phase] : null;

  const segments = [
    { value: days, label: 'JOURS' },
    { value: hours, label: 'HEURES' },
    { value: minutes, label: 'MIN' },
    { value: seconds, label: 'SEC' },
  ];

  return (
    <div className={`text-center ${className}`}>
      {/* Chiffres principaux — tabular-nums pour alignement colonne stable */}
      <div
        className="flex items-end justify-center gap-3 sm:gap-6 tabular-nums"
        aria-live={ariaLive}
        aria-hidden={isCritical ? undefined : true}
      >
        {segments.map((seg) => (
          <div key={seg.label} className="flex flex-col items-center">
            <span className="text-5xl sm:text-6xl md:text-7xl font-light text-white leading-none">
              {pad2(seg.value)}
            </span>
            <span className="mt-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] text-white/40 font-light">
              {seg.label}
            </span>
          </div>
        ))}
      </div>

      {/* Sous-titre contextuel — informationnel, statique, lisible par SR */}
      {subtitle && (
        <p className="mt-6 text-sm sm:text-base text-white/70 font-light">
          {subtitle}
        </p>
      )}
    </div>
  );
}
