"use client";

/**
 * Phase 8 sub-chantier 3 commit 5/6 — UI bot card SuggestionMessage.
 *
 * Doctrine §D.Q4 : message bot inline avec avatar Spordate distinct + label "Suggestion"
 * + 1-3 cards activities + boutons quick-book vers /activities/{id}.
 *
 * Charte stricte black/#D91CD2/white (cohérent autres components Phase 7+8).
 *
 * Pure component (props-only, pas de useEffect/useState heavy) — render conditional
 * dans chat/page.tsx quand `message.type === 'ai_suggestion' && suggestions.length > 0`.
 */

import * as React from 'react';
import Link from 'next/link';
import { Sparkles, Calendar, ArrowRight } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import type { ChatMessage, SuggestionCard } from '@/types/firestore';

// =====================================================================
// Helpers (date formatting Phase 8 SC3)
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

// =====================================================================
// Sub-component : SuggestionCardItem
// =====================================================================

function SuggestionCardItem({ card }: { card: SuggestionCard }) {
  const sessionDate = formatNextSessionAt(card.nextSessionAt);

  return (
    <Link
      href={`/activities/${card.activityId}`}
      className={cn(
        'block border border-white/10 rounded-xl p-3 hover:border-[#D91CD2]/30',
        'transition-colors group',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-white text-sm font-medium truncate flex-1 leading-tight">
          {card.title || 'Activité'}
        </h4>
        <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-[#D91CD2] transition-colors flex-shrink-0 mt-0.5" />
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

      <div className="mt-2.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 bg-[#D91CD2] text-black text-xs font-medium',
            'px-3 py-1.5 rounded-lg group-hover:opacity-90 transition-opacity',
          )}
        >
          Réserver
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

// =====================================================================
// Main : SuggestionMessage
// =====================================================================

export function SuggestionMessage({ message }: { message: ChatMessage }) {
  // Defensive : si pas de suggestions ou type différent, render rien
  if (message.type !== 'ai_suggestion' || !message.suggestions || message.suggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 my-2">
      {/* Bot avatar */}
      <div
        className={cn(
          'flex-shrink-0 h-7 w-7 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20',
          'flex items-center justify-center',
        )}
        title="Spordate IA — suggestions d'activités"
      >
        <Sparkles className="h-3.5 w-3.5 text-[#D91CD2]" />
      </div>

      {/* Bubble */}
      <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%] flex-1">
        {/* Header */}
        <div className="text-[11px] text-white/40 font-light mb-2.5 flex items-center gap-1.5">
          <span>🤖</span>
          <span>Spordate · Suggestion</span>
        </div>

        {/* Cards */}
        <div className="space-y-2">
          {message.suggestions.map((card) => (
            <SuggestionCardItem key={card.activityId} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
