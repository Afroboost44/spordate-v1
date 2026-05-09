/**
 * Phase 9.5 c8 — <RechargeBanner> sur pages chat si credits === 0.
 *
 * Banner top "Plus de crédits — recharge ici" avec CTA → /payment.
 * À mounter dans /chat layout ou /chat/[id] page (caller responsability — c8 wire `/chat`).
 *
 * Logic :
 *  - Hidden si user pas authentifié OU credits > 0 OU loading initial.
 *  - Click CTA → router.push('/payment')
 *  - Charte black/#D91CD2/white.
 */

'use client';

import { useRouter } from 'next/navigation';
import { Coins, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCredits } from '@/hooks/useCredits';

export function RechargeBanner() {
  const { isLoggedIn } = useAuth();
  const { credits } = useCredits();
  const router = useRouter();

  if (!isLoggedIn) return null;
  if (credits > 0) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[#D91CD2]/40 bg-gradient-to-r from-[#D91CD2]/15 via-black to-[#D91CD2]/10 px-4 py-2.5 text-sm text-white"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Coins className="h-4 w-4 text-[#D91CD2] shrink-0" />
        <span className="truncate">
          <span className="font-medium">Plus de crédits chat.</span>{' '}
          <span className="text-white/70">Recharge pour continuer à discuter.</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => router.push('/payment')}
        className="inline-flex items-center gap-1 rounded-full bg-[#D91CD2] px-3 py-1 text-xs font-semibold text-white hover:bg-[#D91CD2]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D91CD2] focus-visible:ring-offset-2 focus-visible:ring-offset-black shrink-0"
      >
        Recharger
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}
