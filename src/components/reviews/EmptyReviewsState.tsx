/**
 * Spordateur — Phase 7 sub-chantier 1 commit 3/6
 * <EmptyReviewsState> — état vide pour ReviewsList sans avis.
 *
 * 2 variants pour 2 contextes :
 * - 'profile' : profil utilisateur sans aucun avis reçu
 *   → "Nouveau membre" (cohérent doctrine §9.sexies G + §9.ter Tactique 2 anti-ghost-town,
 *      jamais "0 reviews")
 * - 'activity' : page activity sans avis
 *   → "Aucun avis pour cette activité — sois le premier à en parler" (encouragement)
 *
 * Charte stricte : black bg, accent #D91CD2 via icône, text white/70 secondaire.
 */

import { Sparkles, MessageCircle } from 'lucide-react';

export interface EmptyReviewsStateProps {
  variant: 'profile' | 'activity';
  className?: string;
}

export function EmptyReviewsState({
  variant,
  className = '',
}: EmptyReviewsStateProps) {
  if (variant === 'profile') {
    return (
      <div
        className={`flex flex-col items-center text-center gap-3 py-8 px-6 ${className}`}
        role="status"
        aria-live="polite"
      >
        <Sparkles
          className="h-10 w-10 text-[#D91CD2]"
          aria-hidden="true"
          strokeWidth={1.25}
        />
        <p className="text-base text-white font-medium">Nouveau membre</p>
        <p className="text-sm text-white/70 font-light leading-relaxed max-w-xs">
          Ce profil n&apos;a pas encore reçu d&apos;avis. Les premiers retours arriveront
          après les prochaines sessions partagées.
        </p>
      </div>
    );
  }

  // variant === 'activity'
  return (
    <div
      className={`flex flex-col items-center text-center gap-3 py-8 px-6 ${className}`}
      role="status"
      aria-live="polite"
    >
      <MessageCircle
        className="h-10 w-10 text-[#D91CD2]"
        aria-hidden="true"
        strokeWidth={1.25}
      />
      <p className="text-base text-white font-medium">Aucun avis pour cette activité</p>
      <p className="text-sm text-white/70 font-light leading-relaxed max-w-xs">
        Sois le premier à partager ton ressenti après ta prochaine session — ça
        aidera les autres membres à choisir.
      </p>
    </div>
  );
}
