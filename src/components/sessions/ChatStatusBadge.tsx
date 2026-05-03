/**
 * Spordateur — Phase 5
 * <ChatStatusBadge> — Affiche l'état du chat d'une session selon sa phase.
 *
 * Phases (depuis useSessionWindow Phase 4) :
 * - 'before'    → Lock icon + "Chat verrouillé"
 * - 'chat-open' → MessageCircle icon + "Chat ouvert"
 * - 'started'   → Activity icon + "En cours"
 * - 'ended'     → Archive icon + "Archivé"
 *
 * Charte stricte : icône #D91CD2 sur les phases actives (chat-open, started),
 * blanc/40 (atténué) pour locked et ended (différenciation par OPACITÉ + icône, pas couleur).
 *
 * Accessibilité :
 * - aria-label statique (le badge est juste informatif)
 * - Texte explicite à côté de l'icône (skill: color-not-only)
 *
 * Usage :
 *   <ChatStatusBadge phase={sessionWindow.phase} />
 *   <ChatStatusBadge phase="before" size="sm" />
 */

import { Lock, MessageCircle, Activity, Archive } from 'lucide-react';
import type { SessionPhase } from '@/hooks/useSessionWindow';

export interface ChatStatusBadgeProps {
  phase: SessionPhase;
  size?: 'sm' | 'md';
  className?: string;
}

interface PhaseMeta {
  Icon: typeof Lock;
  label: string;
  /** True si la phase est "active" (icône en accent #D91CD2). False = atténuée white/40. */
  active: boolean;
}

const PHASE_META: Record<SessionPhase, PhaseMeta> = {
  before: { Icon: Lock, label: 'Chat verrouillé', active: false },
  'chat-open': { Icon: MessageCircle, label: 'Chat ouvert', active: true },
  started: { Icon: Activity, label: 'En cours', active: true },
  ended: { Icon: Archive, label: 'Archivé', active: false },
};

export function ChatStatusBadge({
  phase,
  size = 'md',
  className = '',
}: ChatStatusBadgeProps) {
  const meta = PHASE_META[phase];

  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-0.5 gap-1.5'
    : 'text-sm px-2.5 py-1 gap-2';

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const iconColor = meta.active ? 'text-[#D91CD2]' : 'text-white/40';
  const textColor = meta.active ? 'text-white' : 'text-white/60';

  return (
    <span
      className={`inline-flex items-center rounded-full border border-white/10 bg-black/40 ${sizeClasses} ${textColor} font-light whitespace-nowrap ${className}`}
      aria-label={`État du chat : ${meta.label}`}
    >
      <meta.Icon className={`${iconSize} ${iconColor} flex-shrink-0`} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
