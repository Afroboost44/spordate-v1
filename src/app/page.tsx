/**
 * Fix FOUC home — Server Component racine de la landing page.
 *
 * Avant : ce fichier était directement un client component (`"use client"`).
 * Conséquence : le HTML SSR contenait les valeurs par défaut du useState
 * (image Unsplash placeholder, primaryColor = `var(--accent-color)` = couleur
 * charte au lieu de la couleur admin sauvegardée). Pendant 500ms-1.5s après
 * l'hydration, l'utilisateur voyait l'ancien hero, puis l'onSnapshot Firestore
 * client remplaçait → flash visible reporté par Bassi (hero image + couleur
 * d'accent qui clignote au refresh).
 *
 * Maintenant : ce Server Component fetch settings/site via Admin SDK (cache
 * Next.js 60s + revalidateTag('theme:site') purgé par /api/admin/site/revalidate
 * dès qu'admin sauvegarde). Le client component reçoit l'objet en prop
 * `initialSite` et l'utilise comme valeur initiale du useState. Premier
 * paint = bonne image + bonne couleur, zéro FOUC.
 *
 * L'onSnapshot client reste actif côté `LandingPageClient` pour la mise à
 * jour realtime (admin change la couleur → visiteurs déjà sur la page
 * reçoivent l'update sans refresh).
 *
 * @module
 */

import LandingPageClient from '@/components/landing/LandingPageClient';
import { getServerSiteConfig } from '@/lib/site/server';

// Force dynamic rendering : sans ça, Next.js peut servir un HTML statique
// figé au build (avec les anciennes valeurs admin). `force-dynamic` garantit
// que `getServerSiteConfig()` est appelé à chaque request (avec son cache 60s
// interne qui limite quand même les reads Firestore).
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const initialSite = await getServerSiteConfig();
  return <LandingPageClient initialSite={initialSite} />;
}
