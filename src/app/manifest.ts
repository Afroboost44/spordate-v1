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
  const v = brand?.version ? `?v=${brand.version}` : '?v=30';

  // Icons : si brand configuré, on utilise les URLs Firebase Storage. Sinon
  // on retombe sur les PNG statiques de public/icons/ (cohérent legacy).
  const icons: MetadataRoute.Manifest['icons'] = [];

  if (brand?.maskable192Url) {
    icons.push({
      src: `${brand.maskable192Url}${v}`,
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable',
    });
  }
  if (brand?.maskable512Url) {
    icons.push({
      src: `${brand.maskable512Url}${v}`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    });
  }
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

  // Fallback statique : si aucun brand configuré, on garde le legacy PWA setup.
  if (icons.length === 0) {
    icons.push(
      {
        src: '/icons/icon-192.png?v=30',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-192.png?v=30',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png?v=30',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png?v=30',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/apple-touch-icon.png?v=30',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    );
  }

  return {
    name: 'Spordateur',
    short_name: 'Spordateur',
    description: 'La plateforme suisse de rencontres par le sport et la danse.',
    start_url: '/?v=30',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'portrait-primary',
    scope: '/',
    icons,
    categories: ['social', 'sports', 'lifestyle'],
  };
}
