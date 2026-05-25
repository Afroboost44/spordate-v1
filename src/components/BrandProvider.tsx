/**
 * Fix #132 — BrandProvider client component.
 *
 * Reçoit le brand initial via SSR (getServerBrand depuis le root layout) et
 * le pousse dans le module-level state de useBrandLogos AVANT le premier render
 * client. Élimine le FOUC où SpordateurLogo affichait le SVG fallback pendant
 * ~200ms avant que Firestore renvoie l'URL.
 *
 * Ensuite : s'abonne à Firestore via onSnapshot pour réagir aux changements
 * temps réel (admin upload nouveau logo → tous les composants se rafraîchissent).
 *
 * Pattern cohérent ThemeProvider (qui fait pareil pour primaryColor).
 *
 * @module
 */

'use client';

import { useEffect } from 'react';
import type { BrandLogos } from '@/lib/brand/generateLogos';
import { setInitialBrand } from '@/lib/brand/useBrandLogos';

interface BrandProviderProps {
  /** Brand fetché côté serveur (peut être null si rien n'est encore configuré). */
  initialBrand: BrandLogos | null;
  children: React.ReactNode;
}

export function BrandProvider({ initialBrand, children }: BrandProviderProps) {
  // Injecter le brand initial dans le store partagé AVANT le premier render des
  // consommateurs (useBrandLogos lit currentBrand au useState initial).
  // Cette init synchrone est essentielle pour éliminer le FOUC.
  if (typeof window !== 'undefined' && initialBrand) {
    setInitialBrand(initialBrand);
  }

  useEffect(() => {
    // Si on n'a pas eu d'initialBrand au SSR (pas encore configuré), on
    // injecte quand même null pour signifier "déjà initialisé".
    setInitialBrand(initialBrand ?? null);
  }, [initialBrand]);

  return <>{children}</>;
}
