"use client";

/**
 * Phase 9 sub-chantier 1 commit 3/5 — <ActivityInviteSection>.
 *
 * Comble Différé Phase 9 (architecture.md ligne 1333) :
 *   « ⏳ /activities/[id] dropdown matches invite trigger »
 *
 * Client island sur /activities/[id] :
 *   1. useAuth → si pas user → silent hide
 *   2. fetch /api/users/me/matches Bearer → matches accepted
 *   3. Si pas de sessionId (resolved server-side) → silent hide (rien à inviter)
 *   4. Si matches.length === 0 → silent hide (pas de match inviteable)
 *   5. Render section "Inviter un match" + Select dropdown otherUser
 *   6. Sur sélection → render <InviteButton variant='secondary'>
 *
 * Charte stricte black/#D91CD2/white user-facing.
 */

import * as React from 'react';
import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { InviteButton } from '@/components/invites/InviteButton';
import { cn } from '@/lib/utils';

export interface ActivityInviteSectionProps {
  activityId: string;
  /** Phase 9 SC1 c3/5 — sessionId next future, resolved server-side. */
  sessionId?: string;
}

interface MatchOut {
  matchId: string;
  otherUser: {
    uid: string;
    displayName: string;
    photoURL?: string;
  };
}

interface MatchesResponse {
  matches: MatchOut[];
  count: number;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; matches: MatchOut[] }
  | { kind: 'error' };

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function ActivityInviteSection({ activityId, sessionId }: ActivityInviteSectionProps) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ kind: 'error' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/users/me/matches', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        });
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const data = (await res.json()) as MatchesResponse;
        setState({ kind: 'ok', matches: data.matches ?? [] });
      } catch (err) {
        if (cancelled) return;
        console.warn('[ActivityInviteSection] fetch matches failed', err);
        setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // Silent hide : pas de session future / pas auth / error / matches vides
  if (!sessionId) return null;
  if (authLoading) return null;
  if (!user) return null;
  if (state.kind === 'error') return null;
  if (state.kind === 'loading') return null; // skeleton inutile pour cette section
  if (state.matches.length === 0) return null;

  const selectedMatch = state.matches.find((m) => m.matchId === selectedMatchId) ?? null;

  return (
    <section
      aria-labelledby="invite-section-heading"
      className="flex flex-col gap-4 pt-6 border-t border-white/5"
    >
      <h2
        id="invite-section-heading"
        className="text-xs uppercase tracking-[0.18em] text-white/40 font-light flex items-center gap-2"
      >
        <UserPlus className="h-3 w-3" aria-hidden="true" />
        Inviter un match
      </h2>
      <p className="text-sm text-white/60 font-light leading-relaxed">
        Invite un de tes matchs à participer à cette session. Chacun paye sa part (mode Individuel).
      </p>

      {/* Liste matches en chips sélectables */}
      <div className="flex flex-wrap gap-2">
        {state.matches.map((m) => (
          <button
            key={m.matchId}
            type="button"
            onClick={() => setSelectedMatchId(m.matchId)}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors text-sm font-light',
              selectedMatchId === m.matchId
                ? 'border-accent bg-accent/10 text-white'
                : 'border-white/10 bg-white/5 text-white/70 hover:border-accent/40 hover:text-white',
            )}
          >
            <Avatar className="h-5 w-5 border border-white/10">
              {m.otherUser.photoURL && (
                <AvatarImage src={m.otherUser.photoURL} alt={m.otherUser.displayName} />
              )}
              <AvatarFallback className="bg-zinc-900 text-white/70 text-[10px]">
                {initials(m.otherUser.displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[140px]">{m.otherUser.displayName}</span>
          </button>
        ))}
      </div>

      {/* Action : InviteButton conditional sur sélection */}
      {selectedMatch && (
        <div className="flex items-center gap-3 mt-1">
          <InviteButton
            activityId={activityId}
            sessionId={sessionId}
            toUserId={selectedMatch.otherUser.uid}
            toUserName={selectedMatch.otherUser.displayName}
            variant="primary"
            label={`Inviter ${selectedMatch.otherUser.displayName}`}
          />
          <button
            type="button"
            onClick={() => setSelectedMatchId(null)}
            className="text-xs text-white/40 hover:text-white font-light"
          >
            Annuler
          </button>
        </div>
      )}
    </section>
  );
}
