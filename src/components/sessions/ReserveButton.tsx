/**
 * Spordateur — Phase 5
 * <ReserveButton> — Bouton "Réserver" pour la page détail session.
 *
 * Client Component (gère onClick + auth + POST /api/checkout).
 *
 * Comportement phase-aware (ordre d'évaluation : ended → full → started → default) :
 * - phase 'ended' → "Session terminée" (disabled, prio sur isFull pour précision sémantique)
 * - isFull → "Complet · Plus de places" (disabled, sans waitlist CTA — Phase 7 polish)
 * - phase 'started' + allowLateJoin === false (défaut) → "Session démarrée" (disabled)
 * - phase 'started' + allowLateJoin === true → "Rejoindre — 25 CHF" (actif, Phase 7 polish)
 * - phase 'before' / 'chat-open' + pas plein → "Réserver — 25 CHF" (actif, sub-titre tier)
 *
 * Auth flow :
 * - Pas connecté → router.push('/login?redirect=/sessions/${sessionId}')
 * - Connecté → fetch POST /api/checkout { mode: 'session', sessionId, userId }
 * - Sur 200 → window.location.href = data.url (redirect Stripe Checkout)
 * - Sur erreur → toast (système useToast existant)
 *
 * Charte stricte :
 * - Actif : bg-[#D91CD2] text-black font-medium (le seul bouton vraiment violet de la page)
 * - Disabled : bg-white/5 text-white/30 cursor-not-allowed (différenciation par opacité)
 * - Hover actif : bg-[#D91CD2]/90 (atténuation, pas de scale ni transform — reduced-motion friendly)
 * - Focus visible : ring-2 ring-[#D91CD2] ring-offset-2 ring-offset-black
 * - Loading : opacity-50 + spinner Loader2 motion-safe
 * - w-full par défaut (pattern CTA primaire — plus tappable mobile, layout stable)
 *
 * Accessibilité :
 * - aria-disabled cohérent avec disabled state
 * - aria-busy="true" pendant le loading
 * - Sub-titre tier en text-black plein (WCAG AA : ratio ~6.4:1 sur fond #D91CD2)
 *
 * Usage :
 *   <ReserveButton session={session} phase={phase} isFull={isFull} />
 *   <ReserveButton session={...} phase={...} isFull={...} allowLateJoin />  // Phase 7 polish
 *   <ReserveButton ... className="w-auto" />  // override largeur si besoin
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Session, PricingTierKind } from '@/types/firestore';
import type { SessionPhase } from '@/hooks/useSessionWindow';

export interface ReserveButtonProps {
  session: Session;
  phase: SessionPhase;
  isFull: boolean;
  /** Si true, autorise la réservation même phase='started' (late join). Défaut false. */
  allowLateJoin?: boolean;
  className?: string;
}

const TIER_LABEL: Record<PricingTierKind, string> = {
  early: 'Early Bird',
  standard: 'Standard',
  last_minute: 'Last Minute',
};

/** Formate un prix en centimes vers display CHF. */
function formatPrice(centimes: number): string {
  const chf = centimes / 100;
  return chf % 1 === 0 ? `${chf} CHF` : `${chf.toFixed(2)} CHF`;
}

interface ButtonState {
  label: string;
  subtitle?: string;
  enabled: boolean;
}

/**
 * Calcule l'état visuel du bouton selon phase + isFull + allowLateJoin.
 *
 * Ordre des conditions (important) :
 * 1. ended → "Session terminée" (sémantiquement plus précis que "Complet")
 * 2. isFull → "Complet"
 * 3. started + !allowLateJoin → "Session démarrée"
 * 4. started + allowLateJoin → "Rejoindre"
 * 5. default (before / chat-open + pas plein) → "Réserver"
 */
function computeButtonState(
  session: Session,
  phase: SessionPhase,
  isFull: boolean,
  allowLateJoin: boolean,
): ButtonState {
  const priceText = formatPrice(session.currentPrice);
  const tierText = TIER_LABEL[session.currentTier];

  if (phase === 'ended') {
    return { label: 'Session terminée', enabled: false };
  }
  if (isFull) {
    return { label: 'Complet · Plus de places', enabled: false };
  }
  if (phase === 'started' && !allowLateJoin) {
    return { label: 'Session démarrée', enabled: false };
  }
  if (phase === 'started' && allowLateJoin) {
    return { label: `Rejoindre — ${priceText}`, subtitle: tierText, enabled: true };
  }
  // before / chat-open + pas plein
  return { label: `Réserver — ${priceText}`, subtitle: tierText, enabled: true };
}

export function ReserveButton({
  session,
  phase,
  isFull,
  allowLateJoin = false,
  className = '',
}: ReserveButtonProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const state = computeButtonState(session, phase, isFull, allowLateJoin);

  const handleClick = async () => {
    if (!state.enabled || loading) return;

    // Auth check : redirect login si non connecté, en préservant le retour
    if (!user) {
      router.push(`/login?redirect=/sessions/${session.sessionId}`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'session',
          sessionId: session.sessionId,
          userId: user.uid,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.url) {
        throw new Error('URL Stripe manquante dans la réponse');
      }

      // Redirect vers Stripe Checkout (domaine externe → window.location, pas router.push)
      window.location.href = data.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la réservation';
      toast({
        title: 'Réservation impossible',
        description: message,
        variant: 'destructive',
      });
      setLoading(false);
    }
    // Note : on ne reset pas loading sur succès (la page va rediriger via window.location.href)
  };

  // Classes différenciées par état (charte stricte)
  // w-full par défaut = pattern CTA primaire (plus tappable mobile, layout stable selon copy phase)
  const baseClass =
    'w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black';
  const enabledClass = state.enabled
    ? 'bg-[#D91CD2] text-black font-medium hover:bg-[#D91CD2]/90 cursor-pointer'
    : 'bg-white/5 text-white/30 cursor-not-allowed';
  const loadingClass = loading ? 'opacity-50' : '';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!state.enabled || loading}
      aria-disabled={!state.enabled}
      aria-busy={loading || undefined}
      className={`${baseClass} ${enabledClass} ${loadingClass} ${className}`}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          <span>Redirection vers Stripe…</span>
        </>
      ) : (
        <span className="flex flex-col items-center leading-tight">
          <span className="flex items-center gap-2">
            {state.label}
            {state.enabled && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </span>
          {state.subtitle && (
            <span className="font-light text-xs text-black mt-0.5">
              {state.subtitle}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
