"use client";

/**
 * Phase 9 sub-chantier 1 commit 1/5 — <ParticipantsList>.
 *
 * Client island sur /sessions/[sessionId] qui charge la liste participants via
 * `/api/sessions/[sessionId]/participants` (Bearer auth si user connecté). Cohérent
 * pattern SC4 InviteActionsClient + SC0 c1/X server-side defense-in-depth.
 *
 * Visibility :
 *   - 200 → render liste participants + SessionParticipantCard
 *   - 403 → render rien (silent — viewer pas autorisé, ne pas leak existence liste)
 *   - 404 → render rien (session not found, page principale aura déjà géré)
 *   - autres errors → render rien (best-effort UX)
 *
 * Loading skeleton : 3 placeholder cards (Avatar gris pulse).
 */

import * as React from 'react';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SessionParticipantCard, type SessionParticipant } from './SessionParticipantCard';

export interface ParticipantsListProps {
  sessionId: string;
}

interface ParticipantsResponse {
  sessionId: string;
  accessReason: string;
  count: number;
  participants: SessionParticipant[];
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: ParticipantsResponse }
  | { kind: 'forbidden' }
  | { kind: 'error' };

export function ParticipantsList({ sessionId }: ParticipantsListProps) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (user) {
          try {
            const idToken = await user.getIdToken();
            headers.authorization = `Bearer ${idToken}`;
          } catch (err) {
            console.warn('[ParticipantsList] getIdToken failed (proceeding as guest)', err);
          }
        }
        const res = await fetch(`/api/sessions/${sessionId}/participants`, {
          method: 'GET',
          headers,
        });
        if (cancelled) return;
        if (res.status === 403) {
          setState({ kind: 'forbidden' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const data = (await res.json()) as ParticipantsResponse;
        setState({ kind: 'ok', data });
      } catch (err) {
        if (cancelled) return;
        console.warn('[ParticipantsList] fetch failed', err);
        setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user, authLoading]);

  // Silent hide for forbidden/error/empty
  if (state.kind === 'forbidden' || state.kind === 'error') return null;

  if (state.kind === 'loading') {
    return (
      <section
        aria-labelledby="participants-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="participants-heading"
          className="text-xs uppercase tracking-[0.18em] text-white/40 font-light flex items-center gap-2"
        >
          <Users className="h-3 w-3" aria-hidden="true" />
          Participants
        </h2>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-2 px-3 rounded-xl bg-white/5 border border-zinc-800 animate-pulse"
            >
              <div className="h-9 w-9 rounded-full bg-zinc-800" />
              <div className="flex-1 h-4 rounded bg-zinc-800/70" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // state.kind === 'ok'
  if (state.data.count === 0) return null;

  return (
    <section
      aria-labelledby="participants-heading"
      className="flex flex-col gap-3"
    >
      <h2
        id="participants-heading"
        className="text-xs uppercase tracking-[0.18em] text-white/40 font-light flex items-center gap-2"
      >
        <Users className="h-3 w-3" aria-hidden="true" />
        Participants ({state.data.count})
      </h2>
      <div className="space-y-2">
        {state.data.participants.map((p) => (
          <SessionParticipantCard
            key={p.uid}
            participant={p}
            viewerUid={user?.uid ?? null}
          />
        ))}
      </div>
    </section>
  );
}
