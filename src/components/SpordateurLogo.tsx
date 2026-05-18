/**
 * Accent feature — Logo Spordateur en SVG inline (S stylisé neon).
 *
 * Remplace l'usage `<img src="/icons/icon-192.png">` qui était statique
 * (PNG charte officielle rose). Cette version utilise `currentColor`,
 * donc suit la couleur du parent (typiquement `text-accent` → suit
 * --accent-color du ThemeProvider, dynamique via /admin "Couleur principale").
 *
 * Shape source : public/offline.html (la même courbe "S" + 2 cercles
 * d'extrémité, design original Spordateur).
 *
 * Usage :
 *   <SpordateurLogo className="h-7 w-7" />          // default text-accent
 *   <SpordateurLogo className="h-8 w-8 text-white"> // override couleur
 *
 * @module
 */

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
