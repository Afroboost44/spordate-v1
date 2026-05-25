/**
 * Logo Spordateur — affiche l'image uploadée par l'admin si configurée,
 * sinon fallback sur le SVG inline "S" stylisé historique.
 *
 * Fix #131 — Lit settings/site.brand via useBrandLogos() hook (onSnapshot
 * realtime). Quand l'admin uploade un nouveau logo via /admin/manage page
 * Site, TOUTES les instances de SpordateurLogo (header, footer, modals,
 * PWARegister, signup, login, partner pages…) se mettent à jour en direct
 * sans refresh.
 *
 * Fallback SVG : preserve l'aspect "currentColor → text-accent" du composant
 * historique. Utilise le path "S" courbe + 2 cercles, design original.
 *
 * @module
 */

'use client';

import { useBrandLogos, getBestLogoUrl } from '@/lib/brand/useBrandLogos';

interface SpordateurLogoProps {
  /** Tailwind classes (size + couleur override via text-X). Défaut text-accent. */
  className?: string;
  /** Label aria pour a11y. */
  ariaLabel?: string;
}

export function SpordateurLogo({
  className = 'h-7 w-7 text-accent',
  ariaLabel = 'Spordateur',
}: SpordateurLogoProps) {
  const brand = useBrandLogos();
  const imageUrl = getBestLogoUrl(brand);

  // Fix #131 + #135 — Si l'admin a uploadé un logo, on l'affiche dans un
  // ROND NOIR (rounded-full bg-black) avec le PNG transparent du logo au
  // centre. Charte Spordateur cohérente : icône partout sur fond noir circulaire.
  // Le className parent (h-7 w-7, h-10 w-10, h-24 w-24...) sert à dimensionner
  // le wrapper. L'image est en object-contain à 75% pour laisser une marge
  // visuelle propre (le logo ne touche pas les bords du cercle).
  if (imageUrl) {
    return (
      <span
        className={`${className} inline-flex items-center justify-center bg-black rounded-full overflow-hidden`}
        role="img"
        aria-label={ariaLabel}
      >
        <img
          src={imageUrl}
          alt=""
          className="w-[75%] h-[75%] object-contain"
        />
      </span>
    );
  }

  // Fallback SVG historique (suit currentColor → text-accent dynamique)
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <path
        d="M20.5 8C20.5 8 22.5 8 22.5 10.5C22.5 13 18 13.5 16 14.5C14 15.5 9.5 16 9.5 19.5C9.5 23 13 24 13 24"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="7.5" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="16" cy="24.5" r="2" fill="currentColor" opacity="0.6" />
    </svg>
  );
}
