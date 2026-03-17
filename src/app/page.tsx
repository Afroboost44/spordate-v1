"use client";

import React, { useState } from 'react';
import Link from 'next/link';
// Using img tags for external images reliability
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowRight,
  ChevronRight,
  Dumbbell,
} from 'lucide-react';

// ─── DATA ───────────────────────────────────────────────

interface ActivityItem {
  id: string;
  name: string;
  type: 'dance' | 'sport';
  image: string;
}

const FEATURED_ACTIVITIES: ActivityItem[] = [
  { id: 'afroboost',     name: 'Afroboost',      type: 'dance', image: 'https://picsum.photos/seed/afroboost/600/400' },
  { id: 'zumba',         name: 'Zumba',           type: 'dance', image: 'https://picsum.photos/seed/zumba/600/400' },
  { id: 'salsa',         name: 'Salsa',           type: 'dance', image: 'https://picsum.photos/seed/salsa/600/400' },
  { id: 'hiphop',        name: 'Hip-Hop',         type: 'dance', image: 'https://picsum.photos/seed/hiphop/600/400' },
  { id: 'tennis',        name: 'Tennis',          type: 'sport', image: 'https://picsum.photos/seed/tennis/600/400' },
  { id: 'yoga',          name: 'Yoga',            type: 'sport', image: 'https://picsum.photos/seed/yogasport/600/400' },
  { id: 'fitness',       name: 'Fitness',         type: 'sport', image: 'https://picsum.photos/seed/fitness/600/400' },
  { id: 'dance_fitness', name: 'Dance Fitness',   type: 'dance', image: 'https://picsum.photos/seed/dancefitness/600/400' },
];

interface Testimonial {
  name: string;
  location: string;
  image: string;
  text: string;
  activity: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Amina K.',
    location: 'Geneve',
    image: 'https://picsum.photos/seed/amina/200/200',
    text: 'J\'ai trouve ma partenaire d\'Afroboost. On se motive chaque semaine, c\'est devenu notre rituel.',
    activity: 'Afroboost',
  },
  {
    name: 'Karim D.',
    location: 'Zurich',
    image: 'https://picsum.photos/seed/karim/200/200',
    text: 'Fan de salsa depuis 3 ans, j\'ai enfin trouve une partenaire a mon niveau. Le premier pas devient facile.',
    activity: 'Salsa',
  },
  {
    name: 'Lea M.',
    location: 'Lausanne',
    image: 'https://picsum.photos/seed/leam/200/200',
    text: 'J\'ai decouvert le Dance Fitness via l\'app. Ambiance incroyable, zero pression.',
    activity: 'Dance Fitness',
  },
  {
    name: 'David N.',
    location: 'Bern',
    image: 'https://picsum.photos/seed/davidn/200/200',
    text: 'Bachata en duo, c\'est 100x mieux. On danse, on rigole, c\'est tout.',
    activity: 'Bachata',
  },
];

const SWISS_CITIES = ['Geneve', 'Zurich', 'Lausanne', 'Bern', 'Bale', 'Lucerne', 'Neuchatel', 'Fribourg'];

// ─── COMPONENT ──────────────────────────────────────────

export default function LandingPage() {
  const [hoveredActivity, setHoveredActivity] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/90">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Dumbbell className="h-8 w-8 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] rounded-md p-1 text-white" />
            <span className="text-xl font-light tracking-widest uppercase text-white">Spordateur</span>
          </Link>
          <div className="hidden md:flex items-center gap-10">
            <a href="#method" className="text-sm font-light text-white/50 hover:text-white transition tracking-wide uppercase">Methode</a>
            <a href="#activities" className="text-sm font-light text-white/50 hover:text-white transition tracking-wide uppercase">Activites</a>
            <a href="#stories" className="text-sm font-light text-white/50 hover:text-white transition tracking-wide uppercase">Temoignages</a>
            <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white text-sm font-normal tracking-wide uppercase px-6 h-10 rounded-none">
              <Link href="/signup">Rejoindre</Link>
            </Button>
          </div>
          <div className="md:hidden">
            <Button asChild size="sm" className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white text-xs font-normal tracking-wide uppercase rounded-none">
              <Link href="/signup">Rejoindre</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-[90vh] flex items-center">
        {/* Background image */}
        <div className="absolute inset-0 z-0">
          <img
            src="https://picsum.photos/seed/hero-dance/1920/1080"
            alt="Dance"
            style={{position:"absolute",inset:0,width:"100%",height:"100%"}}
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black" />
        </div>

        <div className="relative z-10 container mx-auto px-6 py-32 md:py-48">
          <div className="max-w-3xl space-y-10">
            <p className="text-sm font-light tracking-[0.3em] uppercase text-[#D91CD2]">
              Sport &middot; Danse &middot; Rencontres
            </p>

            <h1 className="text-5xl md:text-8xl font-extralight leading-[0.95] tracking-tight text-white">
              Rencontre quelqu'un
              <br />
              en partageant une
              <br />
              <span className="text-[#D91CD2] neon-text">activité sportive.</span>
            </h1>

            <p className="text-lg md:text-xl font-light text-white/60 max-w-lg leading-relaxed">
              Danse, fitness, running... Choisis ton sport, matche, et vis une vraie rencontre.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold text-base tracking-wide px-12 h-16 rounded-full neon-glow">
                <Link href="/signup">Commencer</Link>
              </Button>
              <Button asChild variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/5 font-light text-sm tracking-wide uppercase px-10 h-16 rounded-full">
                <Link href="#method">
                  Comment ça marche <ArrowRight className="ml-3 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── METHOD (How it works) ── */}
      <section id="method" className="py-32 md:py-48">
        <div className="container mx-auto px-6">
          <div className="max-w-xl mb-20">
            <p className="text-sm font-light tracking-[0.3em] uppercase text-[#D91CD2] mb-4">Methode</p>
            <h2 className="text-4xl md:text-6xl font-extralight tracking-tight">
              Trois etapes.<br />C&apos;est tout.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5">
            {[
              {
                num: '01',
                title: 'Choisis ton style',
                desc: 'Afroboost, Salsa, Tennis, Yoga... Selectionne tes activites et ton niveau.',
                image: 'https://picsum.photos/seed/step1/800/600',
              },
              {
                num: '02',
                title: 'Matche & discute',
                desc: 'On te propose des partenaires pres de toi. Connecte-toi, organise ta session.',
                image: 'https://picsum.photos/seed/step2/800/600',
              },
              {
                num: '03',
                title: 'Bouge & kiffe',
                desc: 'Retrouve ton match dans un studio partenaire. L\'experience commence ici.',
                image: 'https://picsum.photos/seed/step3/800/600',
              },
            ].map((step) => (
              <div key={step.num} className="bg-black p-10 md:p-14 group">
                <div className="relative h-64 mb-10 overflow-hidden">
                  <img
                    src={step.image}
                    alt={step.title}
                    style={{position:"absolute",inset:0,width:"100%",height:"100%"}}
                    className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-black/30 group-hover:bg-transparent transition-all duration-700" />
                </div>
                <span className="text-5xl font-extralight text-white/10 block mb-6">{step.num}</span>
                <h3 className="text-xl font-normal tracking-wide text-white mb-4">{step.title}</h3>
                <p className="text-sm font-light text-white/40 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ACTIVITIES GRID ── */}
      <section id="activities" className="py-32 md:py-48">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-20 gap-6">
            <div>
              <p className="text-sm font-light tracking-[0.3em] uppercase text-[#D91CD2] mb-4">Activites</p>
              <h2 className="text-4xl md:text-6xl font-extralight tracking-tight">
                Trouve ton move.
              </h2>
            </div>
            <p className="text-sm font-light text-white/40 max-w-sm leading-relaxed">
              Sport ou danse, debutant ou avance. Chaque activite est une opportunite de rencontre.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
            {FEATURED_ACTIVITIES.map((activity) => (
              <div
                key={activity.id}
                className="relative bg-[#0A0A0A] group cursor-pointer overflow-hidden"
                onMouseEnter={() => setHoveredActivity(activity.id)}
                onMouseLeave={() => setHoveredActivity(null)}
              >
                <div className="relative h-52 md:h-72 overflow-hidden">
                  <img
                    src={activity.image}
                    alt={activity.name}
                    style={{position:"absolute",inset:0,width:"100%",height:"100%"}}
                    className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-black/50 group-hover:bg-black/20 transition-all duration-500" />
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-normal tracking-wide uppercase text-white">{activity.name}</h3>
                    <span className={`text-[10px] tracking-widest uppercase font-light ${activity.type === 'dance' ? 'text-[#D91CD2]' : 'text-white/30'}`}>
                      {activity.type === 'dance' ? 'Danse' : 'Sport'}
                    </span>
                  </div>
                </div>
                {/* Neon border on hover */}
                <div className={`absolute inset-0 border transition-all duration-500 pointer-events-none ${
                  hoveredActivity === activity.id ? 'border-[#D91CD2]/50' : 'border-transparent'
                }`} />
              </div>
            ))}
          </div>

          {/* Level matching */}
          <div className="mt-20 border border-white/5 p-10 md:p-14 flex flex-col md:flex-row items-center gap-10">
            <div className="flex-1">
              <h3 className="text-2xl font-light tracking-wide mb-4">Matching par niveau</h3>
              <p className="text-sm font-light text-white/40 leading-relaxed max-w-md">
                Debutant, intermediaire ou avance. On te matche avec des partenaires de ton niveau pour une experience optimale des le premier pas.
              </p>
            </div>
            <div className="flex gap-6">
              {['Debutant', 'Intermediaire', 'Avance'].map((level) => (
                <div key={level} className="text-center group cursor-pointer">
                  <div className="h-16 w-16 border border-white/10 group-hover:border-[#D91CD2] transition-colors duration-300 flex items-center justify-center mb-3">
                    <span className="text-xs font-light text-white/30 group-hover:text-[#D91CD2] transition-colors uppercase">{level.charAt(0)}</span>
                  </div>
                  <span className="text-[10px] font-light text-white/30 tracking-wide uppercase">{level}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="stories" className="py-32 md:py-48 border-t border-white/5">
        <div className="container mx-auto px-6">
          <div className="max-w-xl mb-20">
            <p className="text-sm font-light tracking-[0.3em] uppercase text-[#D91CD2] mb-4">Temoignages</p>
            <h2 className="text-4xl md:text-6xl font-extralight tracking-tight">
              Ils bougent deja ensemble.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/5">
            {TESTIMONIALS.map((t, idx) => (
              <div key={idx} className="bg-black p-10 md:p-14 group">
                <p className="text-lg font-light text-white/70 leading-relaxed mb-10 italic">
                  &ldquo;{t.text}&rdquo;
                </p>
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 overflow-hidden grayscale group-hover:grayscale-0 transition-all duration-500">
                    <img
                      src={t.image}
                      alt={t.name}
                      
                      
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-normal text-white">{t.name}</p>
                    <p className="text-xs font-light text-white/30">
                      {t.location} &middot; {t.activity}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SWISS COVERAGE ── */}
      <section className="py-32 md:py-48">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-20 items-center">
            <div>
              <p className="text-sm font-light tracking-[0.3em] uppercase text-[#D91CD2] mb-4">Couverture</p>
              <h2 className="text-4xl md:text-5xl font-extralight tracking-tight mb-8">
                Actif dans toute la Suisse.
              </h2>
              <p className="text-sm font-light text-white/40 leading-relaxed mb-10">
                Studios partenaires, salles de danse et espaces fitness. Trouve un spot pres de chez toi.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {SWISS_CITIES.map((city) => (
                  <div key={city} className="flex items-center gap-3 py-2 border-b border-white/5">
                    <div className="h-1.5 w-1.5 bg-[#D91CD2]" />
                    <span className="text-sm font-light text-white/60">{city}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative h-96 md:h-[500px] overflow-hidden">
              <img
                src="https://picsum.photos/seed/swiss/800/1000"
                alt="Switzerland"
                style={{position:"absolute",inset:0,width:"100%",height:"100%"}}
                className="absolute inset-0 w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* ── PARTNER CTA ── */}
      <section className="py-32 md:py-48 border-t border-white/5">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <p className="text-sm font-light tracking-[0.3em] uppercase text-[#D91CD2] mb-6">Partenaires</p>
          <h2 className="text-3xl md:text-5xl font-extralight tracking-tight mb-8">
            Studio de danse ou salle de sport ?
          </h2>
          <p className="text-sm font-light text-white/40 leading-relaxed mb-12 max-w-lg mx-auto">
            Rejoins le reseau Spordateur. Remplis tes cours, gagne en visibilite et connecte-toi avec des sportifs motives.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-normal text-sm tracking-wide uppercase px-10 h-14 rounded-none neon-glow">
              <Link href="/partners">Devenir partenaire</Link>
            </Button>
            <Button variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/5 font-light text-sm tracking-wide uppercase px-10 h-14 rounded-none">
              Nous contacter
            </Button>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative py-32 md:py-48 overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://picsum.photos/seed/finalcta/1920/800"
            alt="Dance"
            style={{position:"absolute",inset:0,width:"100%",height:"100%"}}
            className="absolute inset-0 w-full h-full object-cover opacity-15"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black" />
        </div>
        <div className="relative z-10 container mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-7xl font-extralight tracking-tight mb-8">
            Pret a bouger ?
          </h2>
          <p className="text-lg font-light text-white/50 mb-12 max-w-md mx-auto">
            Rejoins la communaute. Trouve ton partenaire.
          </p>
          <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-normal text-sm tracking-widest uppercase px-14 h-16 rounded-none neon-glow">
            <Link href="/signup">Creer mon profil</Link>
          </Button>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-20">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Dumbbell className="h-7 w-7 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] rounded-md p-1 text-white" />
                <span className="text-lg font-light tracking-widest uppercase text-white">Spordateur</span>
              </div>
              <p className="text-xs font-light text-white/30 leading-relaxed">
                La plateforme suisse de rencontres par le sport et la danse.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-normal tracking-widest uppercase text-white/50 mb-6">Danses</h4>
              <ul className="space-y-3 text-xs font-light text-white/30">
                <li><a href="#" className="hover:text-white transition">Afroboost</a></li>
                <li><a href="#" className="hover:text-white transition">Zumba</a></li>
                <li><a href="#" className="hover:text-white transition">Salsa &amp; Bachata</a></li>
                <li><a href="#" className="hover:text-white transition">Hip-Hop</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-normal tracking-widest uppercase text-white/50 mb-6">Entreprise</h4>
              <ul className="space-y-3 text-xs font-light text-white/30">
                <li><a href="#" className="hover:text-white transition">A propos</a></li>
                <li><a href="#" className="hover:text-white transition">Studios partenaires</a></li>
                <li><a href="#" className="hover:text-white transition">Blog</a></li>
                <li><a href="#" className="hover:text-white transition">Presse</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-normal tracking-widest uppercase text-white/50 mb-6">Legal</h4>
              <ul className="space-y-3 text-xs font-light text-white/30">
                <li><a href="#" className="hover:text-white transition">Confidentialite</a></li>
                <li><a href="#" className="hover:text-white transition">Conditions</a></li>
                <li><a href="#" className="hover:text-white transition">Cookies</a></li>
                <li><a href="#" className="hover:text-white transition">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/5 pt-10 flex flex-col md:flex-row justify-between items-center text-xs font-light text-white/20">
            <p>2026 Spordateur. Tous droits reserves.</p>
            <div className="flex gap-8 mt-4 md:mt-0">
              <a href="#" className="hover:text-white/60 transition tracking-wide uppercase">Instagram</a>
              <a href="#" className="hover:text-white/60 transition tracking-wide uppercase">TikTok</a>
              <a href="#" className="hover:text-white/60 transition tracking-wide uppercase">YouTube</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
