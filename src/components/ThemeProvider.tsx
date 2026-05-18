"use client";

/**
 * Accent feature — ThemeProvider client component.
 *
 * Écoute settings/site.primaryColor en realtime (onSnapshot) et injecte la
 * couleur d'accent dans plusieurs CSS variables au niveau document.documentElement :
 *  - --accent-color  : hex direct (ex: '#D91CD2')
 *  - --accent-color-rgb : triplet RGB (ex: '217 28 210') pour rgb(... / X)
 *  - --primary / --accent / --sidebar-primary / --ring : HSL stripped pour
 *    les tokens shadcn (Tailwind theme.colors.primary → hsl(var(--primary)))
 *
 * L'admin /admin/manage > tab Site permet de changer la couleur — propagation
 * automatique sans refresh grâce au listener Firestore realtime.
 *
 * Skip si Firebase non configuré (cas SSR/build/dev sans .env) — keep defaults
 * du :root globals.css. Skip silencieusement aussi en cas d'erreur fetch
 * (les defaults charte Spordateur restent appliqués).
 *
 * @module
 */

import { useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { hexToHsl, hexToRgb, isValidHexColor } from '@/lib/theme/colorConversion';

function applyAccentColor(hex: string): void {
  if (typeof document === 'undefined') return;
  if (!isValidHexColor(hex)) return;
  try {
    const root = document.documentElement;
    root.style.setProperty('--accent-color', hex);
    root.style.setProperty('--accent-color-rgb', hexToRgb(hex));
    const hsl = hexToHsl(hex);
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--accent', hsl);
    root.style.setProperty('--sidebar-primary', hsl);
    root.style.setProperty('--ring', hsl);
  } catch (err) {
    console.warn('[ThemeProvider] applyAccentColor failed (silent)', err);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!db || !isFirebaseConfigured) return;
    const ref = doc(db, 'settings', 'site');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        const hex = data?.primaryColor as string | undefined;
        if (hex && isValidHexColor(hex)) {
          applyAccentColor(hex);
        }
      },
      (err) => {
        console.warn('[ThemeProvider] onSnapshot error (silent — keeping defaults)', err);
      },
    );
    return () => unsub();
  }, []);

  return <>{children}</>;
}
