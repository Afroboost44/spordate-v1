/**
 * Spordateur — Phase 4
 * Hook qui retourne la phase actuelle de la fenêtre chat d'une session
 * et le temps avant la prochaine transition.
 *
 * Réutilise getChatPhase (Phase 2, fonction pure de src/services/firestore.ts).
 *
 * Phases :
 * - 'before'    : now < chatOpenAt (chat pas encore ouvert)
 * - 'chat-open' : chatOpenAt <= now < startAt (chat ouvert, événement pas commencé)
 * - 'started'   : startAt <= now < chatCloseAt (événement en cours, chat encore ouvert)
 * - 'ended'     : now >= chatCloseAt (chat archivé en lecture seule)
 *
 * Usage :
 *   const { phase, msUntilNext, nextPhase } = useSessionWindow(session);
 *   if (phase === 'before') showCountdown(msUntilNext);
 */

import { useEffect, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { getChatPhase } from '@/services/firestore';
import type { Session } from '@/types/firestore';
import { useServerTimeOffset } from './useServerTimeOffset';

export type SessionPhase = 'before' | 'chat-open' | 'started' | 'ended';

export interface SessionWindowState {
  phase: SessionPhase;
  /** Date de la prochaine transition, ou null si phase='ended'. */
  nextPhaseAt: Date | null;
  /** Type de la prochaine phase, ou null si phase='ended'. */
  nextPhase: SessionPhase | null;
  /** ms restants avant nextPhaseAt. 0 si phase='ended'. */
  msUntilNext: number;
}

/** Type minimal accepté — duck-typing pour permettre Pick<Session, ...> ou objet partiel. */
type SessionLike = Pick<Session, 'chatOpenAt' | 'startAt' | 'endAt' | 'chatCloseAt'>;

/** Pure helper : retourne la prochaine transition d'une session à un instant T. */
function computeNext(session: SessionLike, now: Date): {
  phase: SessionPhase;
  nextPhaseAt: Date | null;
  nextPhase: SessionPhase | null;
  msUntilNext: number;
} {
  const phase = getChatPhase(session, now) as SessionPhase;
  const nowMs = now.getTime();

  let nextPhaseAt: Date | null = null;
  let nextPhase: SessionPhase | null = null;

  switch (phase) {
    case 'before':
      nextPhaseAt = session.chatOpenAt.toDate();
      nextPhase = 'chat-open';
      break;
    case 'chat-open':
      nextPhaseAt = session.startAt.toDate();
      nextPhase = 'started';
      break;
    case 'started':
      nextPhaseAt = session.chatCloseAt.toDate();
      nextPhase = 'ended';
      break;
    case 'ended':
      // Pas de phase suivante.
      break;
  }

  const msUntilNext = nextPhaseAt ? Math.max(0, nextPhaseAt.getTime() - nowMs) : 0;
  return { phase, nextPhaseAt, nextPhase, msUntilNext };
}

export function useSessionWindow(session: SessionLike): SessionWindowState {
  const serverOffset = useServerTimeOffset();

  const [state, setState] = useState<SessionWindowState>(() =>
    computeNext(session, new Date(Date.now() + serverOffset)),
  );

  useEffect(() => {
    // Recalcule immédiatement au mount / changement de session.
    setState(computeNext(session, new Date(Date.now() + serverOffset)));

    // Tick toutes les secondes — assez fin pour détecter une transition au moment où elle arrive.
    const id = setInterval(() => {
      setState(computeNext(session, new Date(Date.now() + serverOffset)));
    }, 1000);

    return () => clearInterval(id);
    // Re-init si la session change (id, dates) ; on compare via toMillis pour stabilité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.chatOpenAt?.toMillis?.(),
    session.startAt?.toMillis?.(),
    session.endAt?.toMillis?.(),
    session.chatCloseAt?.toMillis?.(),
    serverOffset,
  ]);

  return state;
}

// Note : pour `Timestamp` ré-export silencieux (au cas où un consommateur veut typer un mock) :
export { Timestamp };
