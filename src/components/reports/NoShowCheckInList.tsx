/**
 * Phase 7 sub-chantier 3 commit 5/5 — <NoShowCheckInList>.
 *
 * Liste participants confirmed d'une session pour partner check-in post-session.
 * Doctrine §D.5 : partner marque les no-shows + auto-création Report category='no_show'.
 *
 * Pour chaque row :
 *  - Avatar + nom
 *  - Si pas encore marqué → bouton "Marquer no-show"
 *  - Si déjà marqué + within 24h → bouton "Annuler" avec compteur Xh restant
 *  - Si déjà marqué + >24h → badge silencieux "No-show enregistré"
 *
 * Loading state per-user pendant submit. Charte stricte black/#D91CD2/white.
 */

'use client';

import { useState } from 'react';
import { Loader2, UserX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { NO_SHOW_CANCEL_WINDOW_HOURS } from '@/lib/reports';

export interface NoShowParticipant {
  userId: string;
  displayName: string;
  photoURL?: string;
  /** True si déjà marqué no-show. */
  hasNoShow?: boolean;
  /** ID du report partner_no_show si hasNoShow (utilisé pour cancelNoShow). */
  noShowReportId?: string;
  /** ms depuis création du report (utilisé pour cancel window check). */
  noShowAgeMs?: number;
}

export interface NoShowCheckInListProps {
  participants: NoShowParticipant[];
  /** Callback appelé au mark — caller appelle markNoShow service + refresh state. */
  onMarkNoShow: (userId: string) => Promise<void>;
  /** Callback appelé au cancel — caller appelle cancelNoShow service + refresh state. */
  onCancelNoShow: (reportId: string) => Promise<void>;
  className?: string;
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function formatHoursLeft(ageMs: number | undefined): string {
  if (ageMs === undefined) return '';
  const remainingMs = NO_SHOW_CANCEL_WINDOW_HOURS * 60 * 60 * 1000 - ageMs;
  if (remainingMs <= 0) return '';
  const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
  return `${hours}h`;
}

interface RowProps {
  participant: NoShowParticipant;
  onMark: () => Promise<void>;
  onCancel: () => Promise<void>;
}

function ParticipantRow({ participant, onMark, onCancel }: RowProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleMark = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onMark();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCancel();
    } finally {
      setSubmitting(false);
    }
  };

  const cancelable =
    participant.hasNoShow === true &&
    participant.noShowAgeMs !== undefined &&
    participant.noShowAgeMs < NO_SHOW_CANCEL_WINDOW_HOURS * 60 * 60 * 1000;

  return (
    <article className="flex items-center gap-3 py-3 border-b border-white/10 last:border-0">
      <Avatar className="h-10 w-10 shrink-0">
        {participant.photoURL && <AvatarImage src={participant.photoURL} alt={participant.displayName} />}
        <AvatarFallback className="bg-white/10 text-white/70 text-sm">
          {getInitials(participant.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <p className="text-sm text-white font-medium truncate">{participant.displayName}</p>
        {participant.hasNoShow === true && (
          <p className="text-xs text-[#D91CD2]/90 font-light">No-show enregistré</p>
        )}
      </div>
      {participant.hasNoShow !== true ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleMark}
          disabled={submitting}
          className="h-8 px-3 border-white/10 text-white/70 hover:bg-white/5 hover:text-[#D91CD2] hover:border-[#D91CD2]/40 font-light shrink-0 disabled:opacity-40"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <>
              <UserX className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Marquer no-show
            </>
          )}
        </Button>
      ) : cancelable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={submitting}
          className="h-8 px-3 border-white/10 text-white/70 hover:bg-white/5 hover:text-white hover:border-white/30 font-light shrink-0 disabled:opacity-40"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            `Annuler (${formatHoursLeft(participant.noShowAgeMs)})`
          )}
        </Button>
      ) : (
        <span className="text-xs text-white/40 font-light shrink-0">Délai dépassé</span>
      )}
    </article>
  );
}

export function NoShowCheckInList({
  participants,
  onMarkNoShow,
  onCancelNoShow,
  className = '',
}: NoShowCheckInListProps) {
  if (participants.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
        <p className="text-sm text-white/50 font-light">Aucun participant confirmé sur cette session</p>
      </div>
    );
  }

  return (
    <section className={`flex flex-col ${className}`}>
      {participants.map((p) => (
        <ParticipantRow
          key={p.userId}
          participant={p}
          onMark={() => onMarkNoShow(p.userId)}
          onCancel={() => p.noShowReportId ? onCancelNoShow(p.noShowReportId) : Promise.resolve()}
        />
      ))}
    </section>
  );
}
