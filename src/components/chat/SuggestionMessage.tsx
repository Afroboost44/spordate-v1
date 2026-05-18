"use client";

/**
 * Phase 8 SC3 commit 5/6 + Phase 9 SC1 c2/5 — UI bot card SuggestionMessage.
 *
 * Doctrine §D.Q4 : message bot inline avec avatar Spordateur distinct + label "Suggestion"
 * + 1-3 cards activities + boutons quick-book vers /activities/{id}.
 *
 * Phase 9 SC1 c2/5 (Q7=B 2 actions distinctes) :
 *   - Bouton primary "Réserver" → /activities/[id] (existing flow)
 *   - Bouton secondary "Inviter [otherUserName]" → <InviteButton> (Phase 8 SC4)
 *     conditional render si `card.nextSessionId` présent + `viewerUid` !== `otherUserId`
 *
 * Charte stricte black/#D91CD2/white (cohérent autres components Phase 7+8+9).
 */

import * as React from 'react';
import Link from 'next/link';
import { Sparkles, Calendar, ArrowRight } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import type { ChatMessage, SuggestionCard } from '@/types/firestore';
import { InviteButton } from '@/components/invites/InviteButton';

// =====================================================================
// Helpers
// =====================================================================

const FR_DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const FR_MONTHS = [
  'jan', 'fév', 'mars', 'avr', 'mai', 'juin',
  'juil', 'août', 'sept', 'oct', 'nov', 'déc',
];

/** Format absolu FR : "Dim 12 mai · 14h30" — pour nextSessionAt SuggestionCard. */
function formatNextSessionAt(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '';
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  const day = FR_DAYS[date.getDay()];
  const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
  const dateNum = date.getDate();
  const month = FR_MONTHS[date.getMonth()];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${dayLabel} ${dateNum} ${month} · ${hours}h${minutes !== '00' ? minutes : ''}`;
}

/**
 * Phase 9 SC1 c2/5 — Pure helper testable décidant si InviteButton doit s'afficher.
 *
 * Conditions toutes-requises :
 *   - card.nextSessionId présent (sinon pas de target session)
 *   - viewerUid présent (user connecté)
 *   - otherUserId présent (target invite déterminé)
 *   - viewerUid !== otherUserId (anti self-invite)
 */
export interface ShouldShowInviteButtonInput {
  nextSessionId?: string;
  viewerUid?: string | null;
  otherUserId?: string | null;
}

export function shouldShowInviteButton(input: ShouldShowInviteButtonInput): boolean {
  if (!input.nextSessionId) return false;
  if (!input.viewerUid) return false;
  if (!input.otherUserId) return false;
  if (input.viewerUid === input.otherUserId) return false;
  return true;
}

// =====================================================================
// Sub-component : SuggestionCardItem
// =====================================================================

interface SuggestionCardItemProps {
  card: SuggestionCard;
  /** Phase 9 SC1 c2/5 — viewer uid pour gating InviteButton. */
  viewerUid?: string | null;
  /** Phase 9 SC1 c2/5 — autre participant uid (target invite). */
  otherUserId?: string | null;
  /** Phase 9 SC1 c2/5 — autre participant displayName pour label "Inviter X". */
  otherUserName?: string | null;
}

function SuggestionCardItem({
  card,
  viewerUid,
  otherUserId,
  otherUserName,
}: SuggestionCardItemProps) {
  const sessionDate = formatNextSessionAt(card.nextSessionAt);
  const showInvite = shouldShowInviteButton({
    nextSessionId: card.nextSessionId,
    viewerUid,
    otherUserId,
  });

  return (
    <div
      className={cn(
        'border border-white/10 rounded-xl p-3 hover:border-accent/30',
        'transition-colors',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-white text-sm font-medium truncate flex-1 leading-tight">
          {card.title || 'Activité'}
        </h4>
      </div>

      <div className="flex items-center gap-1.5 text-white/50 text-xs font-light">
        <span className="capitalize">{card.sport || '—'}</span>
        {card.city && (
          <>
            <span className="text-white/20">•</span>
            <span>{card.city}</span>
          </>
        )}
      </div>

      {sessionDate && (
        <div className="flex items-center gap-1.5 mt-1.5 text-white/40 text-xs font-light">
          <Calendar className="h-3 w-3 flex-shrink-0" />
          <span>{sessionDate}</span>
        </div>
      )}

      {card.reason && (
        <p className="mt-2 text-white/60 text-xs italic font-light leading-relaxed">
          {card.reason}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <Link
          href={`/activities/${card.activityId}`}
          className={cn(
            'inline-flex items-center gap-1 bg-accent text-black text-xs font-medium',
            'px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity',
          )}
        >
          Réserver
          <ArrowRight className="h-3 w-3" />
        </Link>
        {showInvite && card.nextSessionId && otherUserId && otherUserName && (
          <InviteButton
            activityId={card.activityId}
            sessionId={card.nextSessionId}
            toUserId={otherUserId}
            toUserName={otherUserName}
            variant="secondary"
            label={`Inviter ${otherUserName}`}
          />
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Main : SuggestionMessage
// =====================================================================

export interface SuggestionMessageProps {
  message: ChatMessage;
  /** Phase 9 SC1 c2/5 — auth uid du viewer (chat user) pour gating InviteButton. */
  viewerUid?: string | null;
  /** Phase 9 SC1 c2/5 — autre participant chat uid (target des invites). */
  otherUserId?: string | null;
  /** Phase 9 SC1 c2/5 — autre participant displayName pour label bouton. */
  otherUserName?: string | null;
}

export function SuggestionMessage({
  message,
  viewerUid,
  otherUserId,
  otherUserName,
}: SuggestionMessageProps) {
  // Defensive : si pas de suggestions ou type différent, render rien
  if (message.type !== 'ai_suggestion' || !message.suggestions || message.suggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 my-2">
      {/* Bot avatar */}
      <div
        className={cn(
          'flex-shrink-0 h-7 w-7 rounded-full bg-accent/10 border border-accent/20',
          'flex items-center justify-center',
        )}
        title="Spordateur IA — suggestions d'activités"
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" />
      </div>

      {/* Bubble */}
      <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%] flex-1">
        {/* Header */}
        <div className="text-[11px] text-white/40 font-light mb-2.5 flex items-center gap-1.5">
          <span>🤖</span>
          <span>Spordateur · Suggestion</span>
        </div>

        {/* Cards */}
        <div className="space-y-2">
          {message.suggestions.map((card) => (
            <SuggestionCardItem
              key={card.activityId}
              card={card}
              viewerUid={viewerUid}
              otherUserId={otherUserId}
              otherUserName={otherUserName}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
