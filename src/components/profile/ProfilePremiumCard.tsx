/**
 * BUG #80 — Card "Spordateur Premium" + Boost en haut de la tab Mon profil.
 *
 * Inspirée capture 3 Hinge (Bassi 2026-05-21) : un carousel d'upgrade Premium
 * + 2 quick-actions (Boost / Roses équivalent). Pour Spordateur :
 *  - Premium upgrade (lien /premium)
 *  - Boost activité (lien /partner/boost si user est partenaire, sinon
 *    /payment pour les crédits qui permettent de booster sa visibilité user)
 *
 * Si l'utilisateur est déjà Premium, on remplace le carousel par un badge
 * "Premium actif" + une CTA secondaire (Boost).
 */

'use client';

import Link from 'next/link';
import { Crown, Zap, Heart, Sparkles, ArrowRight } from 'lucide-react';

export interface ProfilePremiumCardProps {
  isPremium: boolean;
  isPartner?: boolean;
}

export function ProfilePremiumCard({ isPremium, isPartner = false }: ProfilePremiumCardProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Banner Premium upgrade ou status */}
      {!isPremium ? (
        <Link
          href="/premium"
          className="group relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-pink-500/10 to-purple-500/10 p-5 flex items-center gap-4 hover:border-accent/50 transition-colors"
        >
          <div className="rounded-full bg-accent/20 p-3 border border-accent/40 shrink-0">
            <Crown className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm sm:text-base text-white font-medium">
              Passe à Spordateur Premium
            </p>
            <p className="text-[11px] sm:text-xs text-white/60 mt-0.5 leading-snug">
              Préférences avancées, plus de visibilité, sans pub.
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-accent shrink-0 group-hover:translate-x-1 transition-transform" />
        </Link>
      ) : (
        <div className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/20 via-pink-500/10 to-purple-500/10 p-5 flex items-center gap-4">
          <div className="rounded-full bg-accent/20 p-3 border border-accent/40 shrink-0">
            <Sparkles className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm sm:text-base text-white font-medium">
              Spordateur Premium actif ✨
            </p>
            <p className="text-[11px] sm:text-xs text-white/60 mt-0.5 leading-snug">
              Tu profites de toutes les fonctionnalités avancées.
            </p>
          </div>
        </div>
      )}

      {/* Quick actions : Boost + Roses-équivalent */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href={isPartner ? '/partner/boost' : '/payment'}
          className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-zinc-900/40 hover:border-accent/30 transition-colors"
        >
          <div className="rounded-full bg-cyan-500/15 border border-cyan-500/30 p-2 shrink-0">
            <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">Boost</p>
            <p className="text-[10px] text-white/40 leading-snug">
              {isPartner
                ? 'Mets ton activité en avant'
                : 'Augmente ta visibilité'}
            </p>
          </div>
        </Link>

        <Link
          href="/discovery"
          className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-zinc-900/40 hover:border-accent/30 transition-colors"
        >
          <div className="rounded-full bg-pink-500/15 border border-pink-500/30 p-2 shrink-0">
            <Heart className="h-4 w-4 text-pink-300" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">Découvrir</p>
            <p className="text-[10px] text-white/40 leading-snug">
              Nouveaux matchs aujourd&apos;hui
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
