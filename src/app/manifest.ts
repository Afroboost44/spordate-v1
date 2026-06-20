/**
 * Fix #128 — Manifest PWA dynamique (remplace public/manifest.json statique).
 *
 * Next.js sert le manifest depuis /manifest.webmanifest avec ce fichier. Le
 * layout.tsx référence "/manifest.json" dans metadata, mais Next écoute aussi
 * /manifest.webmanifest et délivre le même contenu. On fournit les deux URLs
 * pour compatibilité (un router rewrite garderait public/manifest.json comme
 * cache si nécessaire).
 *
 * Lit settings/site.brand côté serveur via Admin SDK (cached 60s via
 * getServerBrand()) et expose les icônes 192/512 standard + maskable dans
 * le tableau `icons`. Fallback sur les PNG statiques /icons/* si pas de brand.
 *
 * @module
 */

import type { MetadataRoute } from 'next';
import { getServerBrand } from '@/lib/brand/server';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getServerBrand();
  // Fix #209 — bump fallback version v32 → v35 cohérent avec SW_VERSION pour
  // forcer cache-bust sur la prochaine visite mobile (Bassi).
  const v = brand?.version ? `?v=${brand.version}` : '?v=40';

  // Icons : si brand configuré, on utilise les URLs Firebase Storage. Sinon
  // on retombe sur les PNG statiques de public/icons/ (cohérent legacy).
  const icons: MetadataRoute.Manifest['icons'] = [];

  // Fix #209 (Hypothèse C — purpose 'maskable' mal interprété par Material 3) —
  // On RETIRE les déclarations purpose: 'maskable'. Plusieurs launchers Android
  // (Pixel Launcher M3, Samsung One UI 6+) appliquent au maskable un masque
  // circulaire + un fond clair par défaut tiré du thème système. Le PNG avec
  // fond noir baked-in est alors COMPOSITIONNÉ par-dessus ce fond clair côté
  // launcher → le carré blanc visible chez Bassi.
  //
  // En ne déclarant QUE `purpose: 'any'` avec un fond noir baked-in dans le
  // PNG, le launcher pose simplement le carré PNG tel quel (pas de masque, pas
  // de fond système), comportement prévisible et identique tous launchers.
  //
  // Les variants maskable512Url restent générés côté admin (pour future
  // compat) mais NE SONT PLUS exposés au manifest.
  // Fix #208 — icons "any" : le PNG a un fond NOIR opaque baked-in donc le
  // launcher Android peut le poser tel quel sur le home screen sans ajouter
  // de fond blanc auto.
  if (brand?.icon192Url) {
    icons.push({
      src: `${brand.icon192Url}${v}`,
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    });
  }
  if (brand?.icon512Url) {
    icons.push({
      src: `${brand.icon512Url}${v}`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    });
  }
  if (brand?.monochrome512Url) {
    icons.push({
      src: `${brand.monochrome512Url}${v}`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'monochrome',
    });
  }
  if (brand?.appleTouch180Url) {
    icons.push({
      src: `${brand.appleTouch180Url}${v}`,
      sizes: '180x180',
      type: 'image/png',
      purpose: 'any',
    });
  }

  // Fix #206 — Fallback neutre : un seul placeholder rose accent uni, sans
  // motif "S". Tous les anciens PNG /icons/icon-*.png ont été supprimés
  // physiquement du repo. Tant que l'admin n'a pas uploadé son brand custom,
  // le navigateur affiche ce carré neutre (cohérent avec layout.tsx fallback).
  if (icons.length === 0) {
    // Fix #209 — fallback : un seul slot `purpose: 'any'`. Plus de `maskable`
    // qui invite le launcher Android à appliquer son thème clair (bug carré
    // blanc home screen).
    icons.push({
      src: '/icons/placeholder.png?v=40',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    });
  }

  return {
    name: 'Spordateur',
    short_name: 'Spordateur',
    description: 'La plateforme suisse de rencontres par le sport et la danse.',
    start_url: '/?v=40',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'portrait-primary',
    scope: '/',
    icons,
    categories: ['social', 'sports', 'lifestyle'],
  };
}
