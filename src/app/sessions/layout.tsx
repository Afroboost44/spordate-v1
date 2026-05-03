/**
 * Spordateur — Phase 5
 * Layout partagé /sessions (liste publique) et /sessions/[sessionId] (détail).
 *
 * Server Component (par défaut, pas de 'use client').
 *
 * Pattern projet : suit /src/app/discovery/layout.tsx mais SANS AuthGuard.
 * /sessions est une route publique (discovery anti-ghost-town : doit être visitable
 * sans login pour donner envie). Le clic "Réserver" sur ReserveButton (Phase 5 / diff #7b)
 * déclenche un redirect login en cas d'utilisateur non authentifié.
 *
 * Pas de AuthGuard ici. Pas de container max-width ni bg — les pages enfants gèrent
 * leur propre layout, et le RootLayout (/src/app/layout.tsx) fournit déjà le bg-black
 * global. L'objectif de ce layout est uniquement de poser Header / Footer / BottomNav
 * en cohérence avec le reste du projet.
 *
 * SEO/metadata Next.js :
 * - title : page-spécifique (s'ajoute au template du RootLayout si défini)
 * - description : < 160 chars (SEO best practice)
 * - openGraph + twitter : pour preview sociale (Facebook, LinkedIn, X)
 * - locale fr_CH (Suisse romande, cohérent avec le ciblage)
 */

import type { Metadata } from 'next';
import Footer from '@/components/layout/footer';
import Header from '@/components/layout/header';
import BottomNav from '@/components/layout/bottom-nav';

export const metadata: Metadata = {
  title: 'Sessions — Spordateur',
  description:
    "Réserve ta prochaine session sportive en Suisse romande. Sport, dates, paliers progressifs. Pas de swipe, du sport ensemble.",
  openGraph: {
    title: 'Sessions Spordateur — Du sport pour de vraies rencontres',
    description:
      "Réserve ta prochaine session sportive en Suisse romande. Pas de swipe, du sport ensemble.",
    type: 'website',
    locale: 'fr_CH',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sessions Spordateur',
    description: 'Réserve ta prochaine session sportive en Suisse romande.',
  },
};

export default function SessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="pb-20 md:pb-0">{children}</main>
      <div className="hidden md:block">
        <Footer />
      </div>
      <BottomNav />
    </>
  );
}
