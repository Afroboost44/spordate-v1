/**
 * BUG #85 — Bannière qui invite les nouveaux utilisateurs à vérifier leur
 * profil avec un selfie. Pattern Hinge / Bumble : signal fort pour augmenter
 * la confiance entre utilisateurs.
 *
 * Comportement :
 *  - Visible si selfieVerificationStatus est undefined OU 'not_started'
 *  - Cachée si déjà vérifié, en attente, ou rejeté (on ne re-relance pas)
 *  - Dismissible 24h via localStorage (l'utilisateur peut snoozer)
 *
 * À insérer en haut de /discovery et/ou /profile.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BadgeCheck, X, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const DISMISS_KEY = 'spordate_unverified_banner_dismissed_until';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

export function UnverifiedBanner({ className = '' }: { className?: string }) {
  const { userProfile } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      if (Number.isFinite(until) && until > Date.now()) {
        setDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // Hide si pas mounted (anti-flash SSR), pas connecté, ou déjà processé
  if (!mounted) return null;
  if (!userProfile) return null;
  const status = userProfile.selfieVerificationStatus;
  if (status === 'verified' || status === 'pending' || status === 'rejected') return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="status"
      className={`relative rounded-2xl border border-accent/30 bg-gradient-to-r from-accent/15 via-pink-500/10 to-accent/15 p-4 sm:p-5 flex items-start gap-3 ${className}`}
    >
      <div className="rounded-full bg-accent/20 border border-accent/40 p-2 shrink-0">
        <BadgeCheck className="h-5 w-5 text-accent" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm sm:text-base text-white font-medium">
          Vérifie ton profil — gagne 3× plus de matchs
        </p>
        <p className="text-[11px] sm:text-xs text-white/70 leading-relaxed mt-1">
          Prends un selfie rapide pour obtenir le badge ✓ Vérifié.
          Plus sûr pour toi, plus de confiance pour les autres.
        </p>
        <Link
          href="/profile/verify-selfie"
          className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          Lancer la vérification
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Masquer pour 24h"
        className="text-white/40 hover:text-white/80 transition-colors p-1 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
