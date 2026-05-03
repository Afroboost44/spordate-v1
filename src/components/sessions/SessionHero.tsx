/**
 * Spordateur — Phase 5
 * <SessionHero> — Hero header de la page détail session.
 *
 * Server Component (pas de 'use client') — compose des Client Components :
 * <SessionMediaPlayer>, <CountdownHero>, <ChatStatusBadge>, <ReserveButton>.
 * Next.js gère la frontière server/client automatiquement.
 *
 * Layout :
 * - Mobile : 1 colonne (média en haut, info en dessous)
 * - Desktop (≥1024px) : 2 colonnes (média gauche 60%, info droite 40%)
 *
 * Charte stricte : titre blanc, secondary white/70, accent #D91CD2.
 *
 * Accessibilité :
 * - <h1> unique sur la page (SEO + structure)
 * - Image LCP marquée priority pour optimiser First Paint
 *
 * Usage :
 *   <SessionHero session={session} phase={phase} media={activity.thumbnailMedia} partnerName={activity.partnerName} />
 */

import { MapPin, Building2 } from 'lucide-react';
import { SessionMediaPlayer } from './SessionMediaPlayer';
import { CountdownHero } from './CountdownHero';
import { ChatStatusBadge } from './ChatStatusBadge';
import { ReserveButton } from './ReserveButton';
import type { SessionPhase } from '@/hooks/useSessionWindow';
import type { Session } from '@/types/firestore';

export interface SessionHeroProps {
  session: Session;
  /** Phase actuelle (depuis useSessionWindow Phase 4). */
  phase: SessionPhase;
  /** Média de l'activity parent (optionnel — fallback Picsum sinon). */
  media?: { type: 'image' | 'video'; url: string; posterUrl?: string };
  /** Nom du partenaire (depuis Activity.partnerName). */
  partnerName?: string;
  className?: string;
}

/**
 * Détermine la cible du countdown selon la phase :
 * - before / chat-open → startAt (countdown vers le démarrage)
 * - started → endAt (countdown vers la fin)
 * - ended → endAt (déjà passé, isExpired sera true)
 */
function getCountdownTarget(session: Session, phase: SessionPhase) {
  if (phase === 'started' || phase === 'ended') return session.endAt;
  return session.startAt;
}

export function SessionHero({
  session,
  phase,
  media,
  partnerName,
  className = '',
}: SessionHeroProps) {
  const target = getCountdownTarget(session, phase);
  const isFull = session.currentParticipants >= session.maxParticipants;

  return (
    <header className={`flex flex-col lg:flex-row gap-6 lg:gap-10 items-stretch ${className}`}>
      {/* Colonne média (gauche desktop, top mobile) */}
      <div className="lg:w-3/5 flex-shrink-0">
        <SessionMediaPlayer
          media={media}
          alt={session.title}
          aspectRatio="16/9"
          priority
          className="rounded-xl"
        />
      </div>

      {/* Colonne info (droite desktop, bottom mobile) */}
      <div className="lg:w-2/5 flex flex-col justify-center gap-5">
        {/* Sport + état chat */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-[0.2em] text-[#D91CD2] font-light">
            {session.sport}
          </span>
          <span className="text-white/20" aria-hidden="true">·</span>
          <ChatStatusBadge phase={phase} size="sm" />
        </div>

        {/* Titre H1 */}
        <h1 className="text-3xl sm:text-4xl lg:text-5xl text-white font-light leading-tight">
          {session.title}
        </h1>

        {/* Ville + partenaire */}
        <div className="flex flex-col gap-1.5 text-sm text-white/70 font-light">
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
            <span>{session.city}</span>
          </p>
          {partnerName && (
            <p className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#D91CD2] flex-shrink-0" aria-hidden="true" />
              <span>{partnerName}</span>
            </p>
          )}
        </div>

        {/* Countdown grand format (Phase 4) */}
        <div className="mt-2">
          <CountdownHero target={target} phase={phase} />
        </div>

        {/* Bouton Réserver (Client Component) — phase-aware copy + état */}
        <ReserveButton session={session} phase={phase} isFull={isFull} />
      </div>
    </header>
  );
}
