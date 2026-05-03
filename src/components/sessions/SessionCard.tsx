/**
 * Spordateur — Phase 5
 * <SessionCard> — Card principale d'une session, utilisée dans la liste /sessions
 * et dans <UpcomingSessionsWidget>.
 *
 * Variants :
 * - 'full' (défaut) : avec média + titre + countdown + remplissage + prix
 * - 'compact' : sans média, hauteur réduite, pour widget dashboard
 *
 * Charte stricte :
 * - fond #000 (transparent → hérite parent)
 * - bordure white/10, hover/focus border-[#D91CD2]/40
 * - texte white pour titre, white/60 pour secondary
 * - prix en font-medium, accent #D91CD2 sur le chiffre
 *
 * Accessibilité :
 * - <Link> entoure toute la card (skill: touch-target-size — toute la card est cliquable)
 * - focus-visible:ring-2 ring-[#D91CD2] sur le focus
 * - aria-label avec titre + ville + prix pour SR
 * - cursor-pointer (skill)
 *
 * Usage :
 *   <SessionCard session={session} />
 *   <SessionCard session={session} variant="compact" />
 */

import Link from 'next/link';
import { MapPin, ArrowRight } from 'lucide-react';
import { SessionMediaPlayer } from './SessionMediaPlayer';
import { SpotsIndicator } from './SpotsIndicator';
import { CountdownBadge } from './CountdownBadge';
import type { Session } from '@/types/firestore';

export interface SessionCardProps {
  session: Session;
  /** Variant visuel. Défaut 'full'. */
  variant?: 'full' | 'compact';
  /** Optionnel : média à afficher (sinon Picsum placeholder). Lu depuis Activity, pas Session. */
  media?: { type: 'image' | 'video'; url: string; posterUrl?: string };
  className?: string;
}

/** Formate un prix en centimes vers display CHF (ex: 2500 → "25 CHF"). */
function formatPrice(centimes: number): string {
  const chf = centimes / 100;
  return chf % 1 === 0 ? `${chf} CHF` : `${chf.toFixed(2)} CHF`;
}

export function SessionCard({
  session,
  variant = 'full',
  media,
  className = '',
}: SessionCardProps) {
  const href = `/sessions/${session.sessionId}`;
  const priceText = formatPrice(session.currentPrice);
  const isCompact = variant === 'compact';

  const ariaLabel = `${session.title} à ${session.city}, ${priceText}`;

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`group block rounded-xl border border-white/10 bg-black/40 overflow-hidden cursor-pointer transition-colors hover:border-[#D91CD2]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] ${className}`}
    >
      {/* Média (caché en variant compact) */}
      {!isCompact && (
        <SessionMediaPlayer
          media={media}
          alt={session.title}
          aspectRatio="16/9"
        />
      )}

      <div className={`flex flex-col gap-3 ${isCompact ? 'p-3' : 'p-4'}`}>
        {/* Titre + ville */}
        <div className="flex flex-col gap-1">
          <h3 className={`text-white font-medium leading-tight ${isCompact ? 'text-sm' : 'text-base sm:text-lg'}`}>
            {session.title}
          </h3>
          <p className="flex items-center gap-1.5 text-xs text-white/60 font-light">
            <MapPin className="h-3 w-3 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
            <span>{session.city}</span>
          </p>
        </div>

        {/* Countdown (Phase 4) */}
        <CountdownBadge
          target={session.startAt}
          size="sm"
          expiredText="Démarré"
        />

        {/* Remplissage */}
        <SpotsIndicator
          currentParticipants={session.currentParticipants}
          maxParticipants={session.maxParticipants}
          size="sm"
        />

        {/* Prix + CTA visuel */}
        <div className="flex items-end justify-between gap-2 pt-1">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-white/40 font-light">
              À partir de
            </span>
            <span className="text-lg sm:text-xl text-[#D91CD2] font-medium tabular-nums">
              {priceText}
            </span>
          </div>
          <ArrowRight
            className="h-4 w-4 text-white/40 group-hover:text-[#D91CD2] transition-colors flex-shrink-0"
            aria-hidden="true"
          />
        </div>
      </div>
    </Link>
  );
}
