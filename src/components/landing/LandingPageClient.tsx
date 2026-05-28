"use client";

/**
 * Fix FOUC home — Client component de la landing page.
 *
 * Avant : `src/app/page.tsx` était directement client component. Le useState
 * initial contenait des valeurs par défaut (image unsplash, primaryColor =
 * `var(--accent-color)`, textes hero…), le SSR renvoyait ce HTML, puis
 * l'onSnapshot Firestore écrasait après 0.5-1.5s → flash visible du hero
 * et de la couleur sur la home.
 *
 * Maintenant : ce composant accepte `initialSite` en prop (fourni par le
 * Server Component parent qui a déjà fetché settings/site via Admin SDK).
 * Le useState initial = merge { ...DEFAULTS, ...initialSite } → premier
 * paint correct. L'onSnapshot reste pour le realtime admin (couleur/image
 * propagées sans refresh).
 *
 * @module
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { saveReferralCode } from '@/lib/referral/refStorage';
import { PartnerContactDialog } from '@/components/landing/PartnerContactDialog';
import { useLanguage } from '@/context/LanguageContext';

// ─── S LOGO COMPONENT ────────────────────────────────────
// Accent feature : inline SVG suit text-accent (dynamique admin /admin Couleur principale).
import { SpordateurLogo } from '@/components/SpordateurLogo';

function SLogo({ className = "h-8 w-8" }: { className?: string }) {
  return <SpordateurLogo className={`${className} text-accent`} />;
}

// ─── DATA ───────────────────────────────────────────────

interface ActivityItem {
  id: string;
  name: string;
  type: 'dance' | 'sport';
  image: string;
}

const FEATURED_ACTIVITIES: ActivityItem[] = [
  { id: 'afroboost',     name: 'Afroboost',      type: 'dance', image: 'https://images.unsplash.com/photo-1524594152303-9fd13543fe6e?w=600&h=400&fit=crop' },
  { id: 'zumba',         name: 'Zumba',           type: 'dance', image: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600&h=400&fit=crop' },
  { id: 'salsa',         name: 'Salsa',           type: 'dance', image: 'https://images.unsplash.com/photo-1545959570-a94084071b5d?w=600&h=400&fit=crop' },
  { id: 'hiphop',        name: 'Hip-Hop',         type: 'dance', image: 'https://images.unsplash.com/photo-1547153760-18fc86324498?w=600&h=400&fit=crop' },
  { id: 'tennis',        name: 'Tennis',          type: 'sport', image: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=600&h=400&fit=crop' },
  { id: 'yoga',          name: 'Yoga',            type: 'sport', image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600&h=400&fit=crop' },
  { id: 'fitness',       name: 'Fitness',         type: 'sport', image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&h=400&fit=crop' },
  { id: 'dance_fitness', name: 'Dance Fitness',   type: 'dance', image: 'https://images.unsplash.com/photo-1504609773096-104ff2c73ba4?w=600&h=400&fit=crop' },
];

const TESTIMONIALS = [
  { name: 'Amina K.', location: 'Genève', image: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=200&h=200&fit=crop&crop=face', text: "J'ai trouvé ma partenaire d'Afroboost. On se motive chaque semaine, c'est devenu notre rituel.", activity: 'Afroboost' },
  { name: 'Karim D.', location: 'Zurich', image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face', text: "Fan de salsa depuis 3 ans, j'ai enfin trouvé une partenaire à mon niveau.", activity: 'Salsa' },
  { name: 'Léa M.', location: 'Lausanne', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face', text: "J'ai découvert le Dance Fitness via l'app. Ambiance incroyable, zéro pression.", activity: 'Dance Fitness' },
  { name: 'David N.', location: 'Bern', image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face', text: "Bachata en duo, c'est 100x mieux. On danse, on rigole, c'est tout.", activity: 'Bachata' },
];

const SWISS_CITIES = ['Genève', 'Zurich', 'Lausanne', 'Bern', 'Bâle', 'Lucerne', 'Neuchâtel', 'Fribourg'];

// Valeurs par défaut côté client — utilisées uniquement si le Server Component
// n'a pas pu fetcher settings/site (Firestore down au SSR). Sinon, initialSite
// passé en prop remplit déjà ces champs avec les bonnes valeurs admin.
const DEFAULT_SITE_FIELDS: Record<string, string> = {
  heroTitle1: "Rencontre quelqu'un", heroTitle2: "en partageant une", heroTitle3: "activité sportive.",
  heroSubtitle: "Danse, fitness, running... Choisis ton sport, matche, et vis une vraie rencontre.",
  ctaText: "Commencer", primaryColor: "var(--accent-color)",
  heroImage: "https://images.unsplash.com/photo-1524594152303-9fd13543fe6e?w=1920&h=1080&fit=crop",
  step1Title: "Choisis ton style", step1Desc: "Afroboost, Salsa, Tennis, Yoga... Sélectionne tes activités et ton niveau.", step1Image: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&h=600&fit=crop",
  step2Title: "Matche & discute", step2Desc: "On te propose des partenaires près de toi. Connecte-toi, organise ta session.", step2Image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&h=600&fit=crop",
  step3Title: "Bouge & kiffe", step3Desc: "Retrouve ton match dans un studio partenaire. L'expérience commence ici.", step3Image: "https://images.unsplash.com/photo-1529516548873-9ce57c8f155e?w=800&h=600&fit=crop",
  sectionTitle: "Trouve ton move.", sectionSubtitle: "Sport ou danse, débutant ou avancé. Chaque activité est une opportunité de rencontre.",
  ctaFinalTitle: "Prêt à bouger ?", ctaFinalSubtitle: "Rejoins la communauté. Trouve ton partenaire.", ctaFinalButton: "Créer mon profil",
  testimonialsTitle: "Ils bougent déjà ensemble.",
  swissTitle: "Actif dans toute la Suisse.", swissSubtitle: "Studios partenaires, salles de danse et espaces fitness.", swissImage: "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=800&h=1000&fit=crop",
  partnerTitle: "Studio de danse ou salle de sport ?", partnerSubtitle: "Rejoins le réseau Spordateur. Remplis tes cours, gagne en visibilité.", partnerCta1: "Devenir partenaire", partnerCta2: "Nous contacter",
};

interface LandingPageClientProps {
  /**
   * Site config fetchée côté serveur (Server Component parent). Pré-remplit
   * le useState dès le premier render → zéro FOUC sur hero image / couleur.
   * Si vide (Firestore down au SSR), fallback sur DEFAULT_SITE_FIELDS.
   */
  initialSite: Record<string, string>;
}

// ─── COMPONENT ──────────────────────────────────────────

export default function LandingPageClient({ initialSite }: LandingPageClientProps) {
  // Fix #157 — câblage useLanguage pour traduction FR/EN/DE de toute la landing.
  const { t } = useLanguage();
  const [hoveredActivity, setHoveredActivity] = useState<string | null>(null);
  // Fix #127 — état du dialog "Nous contacter" (formulaire partenaire home)
  const [contactOpen, setContactOpen] = useState(false);
  // Fix FOUC — useState initial = merge defaults + données SSR. Le serveur a
  // déjà fetché settings/site via Admin SDK et nous passe le résultat en prop.
  // Le premier paint contient déjà le bon hero image + la bonne couleur.
  const [site, setSite] = useState<Record<string, string>>({
    ...DEFAULT_SITE_FIELDS,
    ...initialSite,
  });

  // Phase A — Capture `?ref=CODE` au landing : persist en localStorage (TTL 30j),
  // consommé au signup pour user.referredBy + à chaque /api/checkout via
  // resolveActiveReferralCode().
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) saveReferralCode(ref);
  }, []);

  useEffect(() => {
    // Fix #146 — onSnapshot au lieu de getDoc one-shot.
    // Avant : si admin sauvait une nouvelle URL hero, le user de la home
    //         affichait l'ancienne valeur tant qu'il ne rechargeait pas.
    // Maintenant : tout changement dans settings/site se propage automatiquement
    //              en temps réel à tous les onglets ouverts.
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    const subscribe = async () => {
      try {
        const { initializeApp, getApps } = await import('firebase/app');
        const { getFirestore, doc, onSnapshot } = await import('firebase/firestore');
        const firebaseConfig = {
          apiKey: (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim(),
          authDomain: (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim(),
          projectId: (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim(),
        };
        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const db = getFirestore(app);
        if (cancelled) return;
        unsubscribe = onSnapshot(
          doc(db, 'settings', 'site'),
          (snap) => {
            if (snap.exists()) {
              const raw = snap.data() as Record<string, unknown>;
              // Filtre les sous-objets non-string (ex: brand) pour rester
              // compatible avec le shape Record<string, string> existant.
              const flat: Record<string, string> = {};
              for (const [k, v] of Object.entries(raw)) {
                if (typeof v === 'string') flat[k] = v;
              }
              setSite(prev => ({ ...prev, ...flat }));
            }
          },
          () => { /* silent — keep defaults if rules block */ },
        );
      } catch { /* use defaults */ }
    };
    subscribe();
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/90">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <SLogo className="h-8 w-8" />
            <span className="text-lg font-light tracking-widest uppercase text-white">Spordateur</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#method" className="text-sm font-light text-white/50 hover:text-white transition tracking-wide uppercase">{t('landing_method')}</a>
            <a href="#activities" className="text-sm font-light text-white/50 hover:text-white transition tracking-wide uppercase">{t('nav_activities')}</a>
            <a href="#stories" className="text-sm font-light text-white/50 hover:text-white transition tracking-wide uppercase">{t('landing_testimonials')}</a>
            {/* Bug fix Bassi 28/05 — Bouton REJOINDRE (header) : rounded-none
                → rounded-full pour matcher visuellement le CTA "Commencer"
                (rounded-full ligne 204). Cohérence UX premium. */}
            <Button asChild className="bg-accent hover:bg-accent/80 text-white text-sm font-normal tracking-wide uppercase px-6 h-10 rounded-full">
              <Link href="/signup">{t('landing_join')}</Link>
            </Button>
          </div>
          <div className="md:hidden">
            <Button asChild size="sm" className="bg-accent hover:bg-accent/80 text-white text-xs font-normal tracking-wide uppercase rounded-full">
              <Link href="/signup">{t('landing_join')}</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-[80vh] flex items-center">
        <div className="absolute inset-0 z-0">
          <img src={site.heroImage} alt="Dance" style={{position:"absolute",inset:0,width:"100%",height:"100%"}} className="absolute inset-0 w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black" />
        </div>
        <div className="relative z-10 container mx-auto px-4 md:px-6 py-16 md:py-24">
          <div className="max-w-3xl space-y-8">
            <p className="text-sm font-light tracking-[0.3em] uppercase text-accent">Sport &middot; Danse &middot; Rencontres</p>
            <h1 className="text-4xl md:text-7xl font-extralight leading-[0.95] tracking-tight text-white">
              {site.heroTitle1}<br />{site.heroTitle2}<br />
              <span style={{ color: site.primaryColor }} className="neon-text">{site.heroTitle3}</span>
            </h1>
            <p className="text-base md:text-lg font-light text-white/60 max-w-lg leading-relaxed">{site.heroSubtitle}</p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button asChild className="text-white font-semibold text-base tracking-wide px-10 h-14 rounded-full neon-glow" style={{ backgroundColor: site.primaryColor }}>
                <Link href="/signup">{site.ctaText}</Link>
              </Button>
              <Button asChild variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/5 font-light text-sm tracking-wide uppercase px-8 h-14 rounded-full">
                <Link href="#method">{t('landing_how_it_works')} <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── METHOD ── */}
      <section id="method" className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-xl mb-12">
            <p className="text-sm font-light tracking-[0.3em] uppercase text-accent mb-3">{t('landing_method')}</p>
            <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">{t('landing_three_steps_title')}<br />{t('landing_three_steps_subtitle')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
            {[
              { num: '01', title: site.step1Title, desc: site.step1Desc, image: site.step1Image },
              { num: '02', title: site.step2Title, desc: site.step2Desc, image: site.step2Image },
              { num: '03', title: site.step3Title, desc: site.step3Desc, image: site.step3Image },
            ].map((step) => (
              <div key={step.num} className="bg-black p-6 md:p-10 group">
                <div className="relative h-48 md:h-56 mb-6 overflow-hidden">
                  <img src={step.image} alt={step.title} style={{position:"absolute",inset:0,width:"100%",height:"100%"}} className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                  <div className="absolute inset-0 bg-black/30 group-hover:bg-transparent transition-all duration-700" />
                </div>
                <span className="text-4xl font-extralight text-white/10 block mb-4">{step.num}</span>
                <h3 className="text-lg font-normal tracking-wide text-white mb-3">{step.title}</h3>
                <p className="text-sm font-light text-white/40 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ACTIVITIES GRID ── */}
      <section id="activities" className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-12 gap-4">
            <div>
              <p className="text-sm font-light tracking-[0.3em] uppercase text-accent mb-3">{t('nav_activities')}</p>
              <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">{site.sectionTitle}</h2>
            </div>
            <p className="text-sm font-light text-white/40 max-w-sm leading-relaxed">{t('landing_section_subtitle_activities')}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
            {FEATURED_ACTIVITIES.map((activity) => (
              <div key={activity.id} className="relative bg-[#0A0A0A] group cursor-pointer overflow-hidden" onMouseEnter={() => setHoveredActivity(activity.id)} onMouseLeave={() => setHoveredActivity(null)}>
                <div className="relative h-44 md:h-64 overflow-hidden">
                  <img src={activity.image} alt={activity.name} style={{position:"absolute",inset:0,width:"100%",height:"100%"}} className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" />
                  <div className="absolute inset-0 bg-black/50 group-hover:bg-black/20 transition-all duration-500" />
                </div>
                <div className="p-4 md:p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs md:text-sm font-normal tracking-wide uppercase text-white">{activity.name}</h3>
                    <span className={`text-[10px] tracking-widest uppercase font-light ${activity.type === 'dance' ? 'text-accent' : 'text-white/30'}`}>{activity.type === 'dance' ? t('landing_activity_type_dance') : t('landing_activity_type_sport')}</span>
                  </div>
                </div>
                <div className={`absolute inset-0 border transition-all duration-500 pointer-events-none ${hoveredActivity === activity.id ? 'border-accent/50' : 'border-transparent'}`} />
              </div>
            ))}
          </div>
          {/* Level matching */}
          <div className="mt-12 border border-white/5 p-6 md:p-10 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1">
              <h3 className="text-xl font-light tracking-wide mb-3">{t('landing_level_matching_title')}</h3>
              <p className="text-sm font-light text-white/40 leading-relaxed max-w-md">{t('landing_level_matching_desc')}</p>
            </div>
            <div className="flex gap-6">
              {[t('landing_level_beginner'), t('landing_level_intermediate'), t('landing_level_advanced')].map((level) => (
                <div key={level} className="text-center group cursor-pointer">
                  <div className="h-14 w-14 border border-white/10 group-hover:border-accent transition-colors duration-300 flex items-center justify-center mb-2">
                    <span className="text-xs font-light text-white/30 group-hover:text-accent transition-colors uppercase">{level.charAt(0)}</span>
                  </div>
                  <span className="text-[10px] font-light text-white/30 tracking-wide uppercase">{level}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="stories" className="py-16 md:py-24 border-t border-white/5">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-xl mb-12">
            <p className="text-sm font-light tracking-[0.3em] uppercase text-accent mb-3">{t('landing_testimonials')}</p>
            <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">{site.testimonialsTitle}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/5">
            {TESTIMONIALS.map((testimonial, idx) => (
              <div key={idx} className="bg-black p-6 md:p-10 group">
                <p className="text-base font-light text-white/70 leading-relaxed mb-8 italic">&ldquo;{testimonial.text}&rdquo;</p>
                <div className="flex items-center gap-4">
                  <div className="h-11 w-11 rounded-full overflow-hidden grayscale group-hover:grayscale-0 transition-all duration-500">
                    <img src={testimonial.image} alt={testimonial.name} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-sm font-normal text-white">{testimonial.name}</p>
                    <p className="text-xs font-light text-white/30">{testimonial.location} &middot; {testimonial.activity}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SWISS COVERAGE ── */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm font-light tracking-[0.3em] uppercase text-accent mb-3">{t('landing_coverage')}</p>
              <h2 className="text-3xl md:text-4xl font-extralight tracking-tight mb-6">{site.swissTitle}</h2>
              <p className="text-sm font-light text-white/40 leading-relaxed mb-8">{site.swissSubtitle}</p>
              <div className="grid grid-cols-2 gap-3">
                {SWISS_CITIES.map((city) => (
                  <div key={city} className="flex items-center gap-3 py-2 border-b border-white/5">
                    <div className="h-1.5 w-1.5" style={{ backgroundColor: site.primaryColor }} />
                    <span className="text-sm font-light text-white/60">{city}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative h-72 md:h-[420px] overflow-hidden">
              <img src={site.swissImage} alt="Switzerland" style={{position:"absolute",inset:0,width:"100%",height:"100%"}} className="absolute inset-0 w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* ── PARTNER CTA ── */}
      <section className="py-16 md:py-24 border-t border-white/5">
        <div className="container mx-auto px-4 md:px-6 text-center max-w-3xl">
          <p className="text-sm font-light tracking-[0.3em] uppercase text-accent mb-4">{t('landing_partners')}</p>
          <h2 className="text-2xl md:text-4xl font-extralight tracking-tight mb-6">{site.partnerTitle}</h2>
          <p className="text-sm font-light text-white/40 leading-relaxed mb-10 max-w-lg mx-auto">{site.partnerSubtitle}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild className="text-white font-normal text-sm tracking-wide uppercase px-8 h-12 rounded-none neon-glow" style={{ backgroundColor: site.primaryColor }}>
              <Link href="/partners">{site.partnerCta1}</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setContactOpen(true)}
              className="border-white/20 text-white/70 hover:text-white hover:bg-white/5 font-light text-sm tracking-wide uppercase px-8 h-12 rounded-none"
            >
              {site.partnerCta2}
            </Button>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative py-16 md:py-24 overflow-hidden">
        <div className="absolute inset-0">
          <img src="https://images.unsplash.com/photo-1524594152303-9fd13543fe6e?w=1920&h=800&fit=crop" alt="Dance" style={{position:"absolute",inset:0,width:"100%",height:"100%"}} className="absolute inset-0 w-full h-full object-cover opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black" />
        </div>
        <div className="relative z-10 container mx-auto px-4 md:px-6 text-center">
          <h2 className="text-3xl md:text-6xl font-extralight tracking-tight mb-6">{site.ctaFinalTitle}</h2>
          <p className="text-base font-light text-white/50 mb-10 max-w-md mx-auto">{site.ctaFinalSubtitle}</p>
          <Button asChild className="text-white font-normal text-sm tracking-widest uppercase px-12 h-14 rounded-none neon-glow" style={{ backgroundColor: site.primaryColor }}>
            <Link href="/signup">{site.ctaFinalButton}</Link>
          </Button>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-12">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1 space-y-3">
              <div className="flex items-center gap-2.5">
                <SLogo className="h-7 w-7" />
                <span className="text-base font-light tracking-widest uppercase text-white">Spordateur</span>
              </div>
              <p className="text-xs font-light text-white/30 leading-relaxed">{t('footer_baseline')}</p>
            </div>
            <div>
              <h4 className="text-xs font-normal tracking-widest uppercase text-white/50 mb-4">{t('footer_section_dances')}</h4>
              <ul className="space-y-2 text-xs font-light text-white/30">
                <li><a href="#" className="hover:text-white transition">Afroboost</a></li>
                <li><a href="#" className="hover:text-white transition">Zumba</a></li>
                <li><a href="#" className="hover:text-white transition">Salsa &amp; Bachata</a></li>
                <li><a href="#" className="hover:text-white transition">Hip-Hop</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-normal tracking-widest uppercase text-white/50 mb-4">{t('footer_section_company')}</h4>
              <ul className="space-y-2 text-xs font-light text-white/30">
                <li><a href="#" className="hover:text-white transition">{t('footer_about_us')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer_studios')}</a></li>
                {/* Fix #129 — Blog et Presse cachés (pages pas encore créées) */}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-normal tracking-widest uppercase text-white/50 mb-4">{t('footer_section_legal')}</h4>
              <ul className="space-y-2 text-xs font-light text-white/30">
                <li><a href="#" className="hover:text-white transition">{t('footer_privacy')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer_terms')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer_cookies')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer_contact')}</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center text-xs font-light text-white/20">
            <Link href="/login" className="hover:text-white/40 transition">{t('footer_copyright')}</Link>
            <div className="flex gap-6 mt-3 md:mt-0">
              <a href="#" className="hover:text-white/60 transition tracking-wide uppercase">Instagram</a>
              <a href="#" className="hover:text-white/60 transition tracking-wide uppercase">TikTok</a>
              <a href="#" className="hover:text-white/60 transition tracking-wide uppercase">YouTube</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Fix #127 — Modal formulaire NOUS CONTACTER (section partenaires) */}
      <PartnerContactDialog open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}
