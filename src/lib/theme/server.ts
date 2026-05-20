/**
 * Server-side helper — fetch settings/site.primaryColor at SSR time pour
 * éliminer le FOUC (Flash Of Unstyled Content) qui apparaissait sur ~1s
 * entre le premier paint (couleur par défaut #D91CD2 du globals.css :root)
 * et la propagation client du ThemeProvider après onSnapshot Firestore.
 *
 * Le RootLayout (server component) appelle getServerTheme() puis injecte
 * un <style> inline dans <head> avec les CSS variables --accent-color /
 * --accent-color-rgb / --primary / --accent / --sidebar-primary / --ring
 * mises sur la couleur sauvegardée. Le ThemeProvider client reste pour
 * propager les changements admin en realtime (pas de refresh nécessaire).
 *
 * Utilise Firebase Admin SDK (bypass des rules) → fonctionne même si les
 * rules `settings/site` restent en `if isAuth()` (defense-in-depth :
 * server-side fetch n'a pas besoin du fix de rules public read pour bosser).
 *
 * Cache Next.js : `unstable_cache` revalidate 60s pour limiter les reads
 * Firestore sur une page très chargée (homepage). Trade-off : update admin
 * met jusqu'à 60s à apparaître sur les nouveaux SSR ; mais le ThemeProvider
 * client met à jour les visiteurs déjà sur la page en realtime, donc OK.
 *
 * @module
 */

import { unstable_cache } from 'next/cache';
import { getAdminDb } from '@/lib/firebase/admin';
import { hexToHsl, hexToRgb, isValidHexColor } from './colorConversion';

/** Couleur par défaut Spordateur — synchro avec globals.css :root. */
const DEFAULT_HEX = '#D91CD2';

export interface ServerTheme {
  hex: string;
  rgb: string; // "R G B" pour rgb(var(--X) / α)
  hsl: string; // "H S% L%" pour hsl(var(--X))
}

/** Lit primaryColor depuis settings/site via Admin SDK. Fallback defaut sur erreur. */
async function fetchPrimaryColor(): Promise<string> {
  try {
    const db = await getAdminDb();
    const snap = await db.collection('settings').doc('site').get();
    if (!snap.exists) return DEFAULT_HEX;
    const data = snap.data();
    const hex = typeof data?.primaryColor === 'string' ? data.primaryColor : null;
    if (hex && isValidHexColor(hex)) return hex;
    return DEFAULT_HEX;
  } catch {
    // Silent fallback — pas de log bruyant en SSR (FB Admin SDK peut throw
    // en local sans .env, on veut juste keep going avec la couleur par défaut).
    return DEFAULT_HEX;
  }
}

const getCachedPrimaryColor = unstable_cache(
  fetchPrimaryColor,
  ['theme-primary-color'],
  {
    revalidate: 60,
    tags: ['theme:site'],
  },
);

/**
 * Récupère le thème (hex + dérivés HSL/RGB) à utiliser pour rendre les CSS
 * variables côté serveur. Cache 60s via unstable_cache (revalidate).
 */
export async function getServerTheme(): Promise<ServerTheme> {
  const hex = await getCachedPrimaryColor();
  return {
    hex,
    rgb: hexToRgb(hex),
    hsl: hexToHsl(hex),
  };
}

/** CSS string à injecter dans `<style>` en <head> du root layout. */
export function buildThemeStyleString(theme: ServerTheme): string {
  return `:root{--accent-color:${theme.hex};--accent-color-rgb:${theme.rgb};--primary:${theme.hsl};--accent:${theme.hsl};--sidebar-primary:${theme.hsl};--ring:${theme.hsl};}`;
}
