/**
 * Phase 9.5 c8 — <CreditsBadge> dans Header global.
 *
 * Affiche le solde crédits chat de l'utilisateur connecté, mis à jour en
 * temps réel via useCredits hook (onSnapshot Firestore).
 *
 * UX :
 *  - Icone Coins + count + label "crédits" (label caché sur mobile)
 *  - Tooltip on hover : "Tu as X crédits chat. 1 crédit = 1 message."
 *  - Click → navigate /payment (recharge pack)
 *  - Animation pulse #D91CD2 1.2s quand le count augmente (effet "you got credits")
 *  - Hide si user pas authentifié OU loading initial
 *
 * Charte stricte : black bg + #D91CD2 accent + white text.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Coins } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { useLanguage } from '@/context/LanguageContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function CreditsBadge() {
  const { isLoggedIn, loading: authLoading } = useAuth();
  const { credits } = useCredits();
  const router = useRouter();
  const { t } = useLanguage();
  const prevRef = useRef<number | null>(null);
  const [pulsing, setPulsing] = useState(false);

  // Animation pulse quand credits augmente (Coins burst feeling)
  useEffect(() => {
    if (prevRef.current === null) {
      prevRef.current = credits;
      return;
    }
    if (credits > prevRef.current) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 1200);
      prevRef.current = credits;
      return () => clearTimeout(t);
    }
    prevRef.current = credits;
  }, [credits]);

  if (authLoading || !isLoggedIn) return null;

  const handleClick = () => {
    router.push('/payment');
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            aria-label={t('credits_badge_aria_label', { credits })}
            className={`relative inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-black/60 px-2.5 py-1 text-sm font-medium text-white transition-colors hover:border-accent/60 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              pulsing ? 'credits-badge-pulse' : ''
            }`}
          >
            <Coins className="h-4 w-4 text-accent" />
            <span className="tabular-nums">{credits}</span>
            <span className="hidden lg:inline text-xs text-white/60">{t('credits_badge_label')}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-zinc-900 border border-accent/40 text-white"
        >
          <p className="text-xs">
            {t('credits_badge_tooltip_prefix')} <span className="font-semibold text-accent">{credits}</span> {t('credits_badge_tooltip_suffix')}
            <br />
            <span className="text-white/60">{t('credits_badge_tooltip_hint')}</span>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
