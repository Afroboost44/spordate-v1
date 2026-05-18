"use client";

/**
 * Phase 9 sub-chantier 1 commit 1/5 — <SessionParticipantCard>.
 *
 * Carte compacte un participant à une session : Avatar + displayName + actions
 * block/report (icon ghost via BlockButton/ReportButton variant 'chat').
 *
 * Charte stricte black/#D91CD2/white user-facing (cohérent SC4 invite components).
 *
 * Self render : badge "Toi" sans actions (cohérent doctrine — pas de self-block/report).
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BlockButton } from '@/components/blocks/BlockButton';
import { ReportButton } from '@/components/reports/ReportButton';

export interface SessionParticipant {
  uid: string;
  displayName: string;
  photoURL?: string;
}

export interface SessionParticipantCardProps {
  participant: SessionParticipant;
  /** Auth uid du viewer (null = pas connecté → pas d'actions). */
  viewerUid: string | null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export function SessionParticipantCard({ participant, viewerUid }: SessionParticipantCardProps) {
  const isSelf = viewerUid !== null && viewerUid === participant.uid;

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-xl bg-white/5 border border-zinc-800">
      <Avatar className="h-9 w-9 border border-white/10">
        {participant.photoURL && <AvatarImage src={participant.photoURL} alt={participant.displayName} />}
        <AvatarFallback className="bg-zinc-900 text-white/70 text-xs font-light">
          {initials(participant.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-light truncate">
          {participant.displayName}
          {isSelf && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent border border-accent/30 align-middle">
              Toi
            </span>
          )}
        </p>
      </div>
      {!isSelf && viewerUid && (
        <div className="flex items-center gap-1">
          <ReportButton
            variant="chat"
            targetUid={participant.uid}
            targetName={participant.displayName}
            currentUserId={viewerUid}
          />
          <BlockButton
            variant="chat"
            targetUid={participant.uid}
            targetName={participant.displayName}
            currentUserId={viewerUid}
          />
        </div>
      )}
    </div>
  );
}
