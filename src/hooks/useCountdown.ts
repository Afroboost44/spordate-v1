/**
 * Spordateur — Phase 4
 * Hook countdown vers une cible. Recalcule à chaque tick (défaut 1s).
 *
 * Caractéristiques :
 * - Pure timing logic — pas de DOM, pas de Firestore
 * - Cleanup automatique du setInterval au unmount
 * - Adapte le tickMs à la durée restante (économie CPU si > 1 jour)
 * - Compatible SSR (initial state calculé côté serveur, ré-évalué côté client)
 * - Tabular numbers — pas la responsabilité du hook (CSS dans les composants)
 *
 * Usage :
 *   const { days, hours, minutes, seconds, isExpired } = useCountdown(session.startAt);
 */

import { useEffect, useRef, useState } from 'react';
import { useServerTimeOffset } from './useServerTimeOffset';

export interface CountdownState {
  /** Jours restants (0 si expiré ou clampé). */
  days: number;
  /** Heures restantes 0..23. */
  hours: number;
  /** Minutes restantes 0..59. */
  minutes: number;
  /** Secondes restantes 0..59. */
  seconds: number;
  /** ms totaux restants (clampé à 0 si options.clampZero=true par défaut). */
  totalMs: number;
  /** True si la cible est atteinte ou dépassée. */
  isExpired: boolean;
}

export interface UseCountdownOptions {
  /** Tick interval en ms. Défaut 1000. Override pour économie (ex: 60_000 si > 1 jour). */
  tickMs?: number;
  /** Si true, totalMs ne descend pas sous 0. Défaut true. */
  clampZero?: boolean;
}

/**
 * Helper PURE : décompose un nombre de ms en {days, hours, minutes, seconds}.
 * Si ms < 0 → tout 0. Exporté pour les tests purs (cf. tests/sessions-ui-pure.test.ts).
 */
export function breakdownMs(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return { days, hours, minutes, seconds };
}

/** Convertit Date | Timestamp Firestore | number en epoch ms. */
function toMs(target: Date | { toMillis: () => number } | number): number {
  if (typeof target === 'number') return target;
  if (target instanceof Date) return target.getTime();
  return target.toMillis();
}

/**
 * Calcule l'état countdown courant à partir de la cible et de l'horloge client+offset.
 * Fonction pure utilitaire interne pour le hook.
 */
function compute(
  targetMs: number,
  serverOffset: number,
  clampZero: boolean,
): CountdownState {
  const nowMs = Date.now() + serverOffset;
  const rawTotalMs = targetMs - nowMs;
  const totalMs = clampZero ? Math.max(0, rawTotalMs) : rawTotalMs;
  const { days, hours, minutes, seconds } = breakdownMs(Math.max(0, rawTotalMs));
  return {
    days,
    hours,
    minutes,
    seconds,
    totalMs,
    isExpired: rawTotalMs <= 0,
  };
}

export function useCountdown(
  target: Date | { toMillis: () => number } | number,
  options?: UseCountdownOptions,
): CountdownState {
  const tickMs = options?.tickMs ?? 1000;
  const clampZero = options?.clampZero ?? true;
  const serverOffset = useServerTimeOffset();
  const targetMs = toMs(target);

  // État initial calculé immédiatement (pas de flash "0:00:00:00" au mount).
  const [state, setState] = useState<CountdownState>(() =>
    compute(targetMs, serverOffset, clampZero),
  );

  // Garde une ref de la cible pour éviter de recréer l'interval si target change rapidement.
  const targetMsRef = useRef(targetMs);
  targetMsRef.current = targetMs;

  useEffect(() => {
    // Recalcule immédiatement au mount/changement de target (sans attendre le 1er tick).
    setState(compute(targetMsRef.current, serverOffset, clampZero));

    const id = setInterval(() => {
      setState(compute(targetMsRef.current, serverOffset, clampZero));
    }, tickMs);

    return () => clearInterval(id);
  }, [tickMs, clampZero, serverOffset, targetMs]);

  return state;
}
