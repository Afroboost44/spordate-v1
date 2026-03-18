"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dumbbell, ArrowRight, CheckCircle, X, TrendingUp, Users, Wallet,
  CalendarCheck, Star, Shield, Zap, Gift, MapPin, Phone, Mail, Building2,
  ChevronRight, ArrowLeft
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

const ACTIVITIES = ['Danse / Zumba', 'Afroboost', 'Fitness', 'Yoga', 'Running', 'Crossfit', 'Massage / Bien-être', 'Autre'];
const CITIES = ['Genève', 'Lausanne', 'Zurich', 'Berne', 'Bâle', 'Lucerne', 'Fribourg', 'Neuchâtel', 'Autre'];

export default function PartnersPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [formData, setFormData] = useState({ name: '', activity: '', city: '', phone: '', email: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In production, save to Firestore
    setSubmitted(true);
    toast({ title: 'Demande envoyée !', description: 'Nous vous contacterons sous 24h.' });
  };

  return (
    <div className="min-h-screen bg-black text-white">

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/90">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-white/40 hover:text-white/70 transition mr-2"><ArrowLeft className="h-5 w-5" /></button>
            <Link href="/" className="flex items-center gap-2">
              <Dumbbell className="h-7 w-7 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] rounded-md p-1 text-white" />
              <span className="text-lg font-light tracking-widest uppercase">Spordateur</span>
            </Link>
          </div>
          <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white text-xs font-normal uppercase tracking-wide px-6 h-10 rounded-full">
            <a href="#formulaire">Devenir partenaire</a>
          </Button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-[70vh] flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#D91CD2]/10 via-black/80 to-black" />
        <div className="relative z-10 container mx-auto px-6 py-24">
          <div className="max-w-2xl space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#D91CD2]/30 bg-[#D91CD2]/5">
              <Gift className="h-4 w-4 text-[#D91CD2]" />
              <span className="text-sm text-[#D91CD2] font-light">Offre de lancement : 1 mois gratuit</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-extralight leading-tight tracking-tight">
              Remplis tes cours avec de
              <span className="text-[#D91CD2]"> nouveaux clients.</span>
            </h1>

            <p className="text-lg font-light text-white/50 max-w-lg leading-relaxed">
              Spordateur t'envoie des personnes prêtes à réserver et à payer pour vivre une expérience sportive à deux.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold text-base px-10 h-14 rounded-full">
                <a href="#formulaire">Devenir partenaire maintenant <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
            </div>

            <div className="flex gap-8 pt-4">
              <div><p className="text-2xl font-light text-white">150+</p><p className="text-xs text-white/30">réservations cette semaine</p></div>
              <div><p className="text-2xl font-light text-white">500+</p><p className="text-xs text-white/30">utilisateurs actifs</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLÈME → SOLUTION ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center max-w-5xl mx-auto">
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-extralight tracking-tight">Tu as du mal à remplir tes créneaux ?</h2>
              <div className="space-y-4">
                {['Cours à moitié vides', 'Dépendance aux réseaux sociaux', 'Clients irréguliers'].map(p => (
                  <div key={p} className="flex items-center gap-3"><X className="h-5 w-5 text-red-400 flex-shrink-0" /><span className="text-white/50 font-light">{p}</span></div>
                ))}
              </div>
            </div>
            <div className="bg-[#D91CD2]/5 border border-[#D91CD2]/20 rounded-3xl p-8 space-y-4">
              <Zap className="h-8 w-8 text-[#D91CD2]" />
              <h3 className="text-xl font-light text-white">La solution Spordateur</h3>
              <p className="text-white/50 font-light leading-relaxed">Des clients motivés, envoyés directement dans tes cours. Ils ont déjà payé — tu n'as plus qu'à les accueillir.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm text-[#D91CD2] uppercase tracking-[0.3em] mb-4">Comment ça marche</p>
            <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">3 étapes. C'est tout.</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { num: '01', title: 'Tu crées ton activité', desc: 'Danse, Zumba, fitness, massage, bien-être… Publie tes créneaux en 2 minutes.', icon: <CalendarCheck className="h-6 w-6" /> },
              { num: '02', title: 'Les utilisateurs réservent', desc: 'Ils découvrent ton activité, payent pour vivre l\'expérience et débloquent leur date.', icon: <Users className="h-6 w-6" /> },
              { num: '03', title: 'Tu accueilles et tu gagnes', desc: 'Tu remplis tes créneaux, fidélises une nouvelle clientèle et augmentes tes revenus.', icon: <Wallet className="h-6 w-6" /> },
            ].map(s => (
              <div key={s.num} className="text-center space-y-4 p-6">
                <div className="w-14 h-14 rounded-2xl bg-[#D91CD2]/10 flex items-center justify-center text-[#D91CD2] mx-auto">{s.icon}</div>
                <span className="text-3xl font-extralight text-white/10">{s.num}</span>
                <h3 className="text-lg font-light text-white">{s.title}</h3>
                <p className="text-sm text-white/40 font-light leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CE QUE TU GAGNES ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-4xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">Plus que des clients,<br /><span className="text-[#D91CD2]">une machine à revenus.</span></h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: <TrendingUp className="h-5 w-5" />, text: 'Augmente ton taux de remplissage' },
              { icon: <Wallet className="h-5 w-5" />, text: 'Génère des revenus réguliers' },
              { icon: <Users className="h-5 w-5" />, text: 'Attire une clientèle jeune et active' },
              { icon: <Star className="h-5 w-5" />, text: 'Profite de la tendance danse & bien-être' },
              { icon: <Zap className="h-5 w-5" />, text: 'Crée une expérience unique (dates sportifs)' },
              { icon: <Shield className="h-5 w-5" />, text: 'Un seul date peut te payer ton abonnement' },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                <div className="text-[#D91CD2]">{b.icon}</div>
                <span className="text-sm text-white/70 font-light">{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OFFRE PARTENAIRE ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-lg">
          <Card className="bg-gradient-to-br from-[#1A1A1A] to-black border-[#D91CD2]/30 shadow-xl shadow-[#D91CD2]/5 overflow-hidden">
            <CardContent className="p-8 space-y-6 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D91CD2]/10 text-[#D91CD2] text-xs">
                <Gift className="h-3.5 w-3.5" /> 1er mois gratuit
              </div>
              <h3 className="text-2xl font-light text-white">Abonnement partenaire</h3>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-5xl font-extralight text-white">49</span>
                <span className="text-white/40">CHF / mois</span>
              </div>
              <div className="space-y-3 text-left">
                {[
                  'Publication illimitée d\'activités',
                  'Visibilité dans l\'app et sur le site',
                  'Accès à de nouveaux clients',
                  'Dashboard de gestion et statistiques',
                  'Support prioritaire',
                  'Code promo 1 mois gratuit',
                ].map(f => (
                  <div key={f} className="flex items-start gap-2.5">
                    <CheckCircle className="h-4 w-4 text-[#D91CD2] mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-white/60 font-light">{f}</span>
                  </div>
                ))}
              </div>
              <Button asChild className="w-full h-14 bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold text-base rounded-full">
                <a href="#formulaire">Activer mon offre gratuite <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
              <p className="text-[11px] text-white/20">Sans engagement — résiliable à tout moment</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── POUR QUI ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-4xl">
          <h2 className="text-3xl font-extralight tracking-tight text-center mb-12">Cette plateforme est faite pour</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {['Coachs fitness', 'Profs de danse', 'Studios Zumba & Afro', 'Studios bien-être', 'Masseurs & thérapeutes', 'Centres sportifs'].map(t => (
              <div key={t} className="p-4 bg-white/5 rounded-2xl border border-white/5 text-center">
                <p className="text-sm text-white/60 font-light">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── URGENCE ── */}
      <section className="py-16 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-2xl text-center space-y-4">
          <p className="text-lg text-white/60 font-light italic">
            "Nous sélectionnons seulement quelques partenaires par ville pour garantir leur visibilité."
          </p>
          <p className="text-[#D91CD2] font-medium">Ta ville est-elle encore disponible ?</p>
        </div>
      </section>

      {/* ── FORMULAIRE ── */}
      <section id="formulaire" className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-lg">
          {submitted ? (
            <div className="text-center space-y-6 py-12">
              <CheckCircle className="h-16 w-16 text-green-400 mx-auto" />
              <h2 className="text-3xl font-light text-white">Demande envoyée !</h2>
              <p className="text-white/40">Nous vous contacterons sous 24h pour activer votre compte.</p>
              <Button asChild variant="outline" className="border-white/20 text-white/60"><Link href="/">Retour à l'accueil</Link></Button>
            </div>
          ) : (
            <>
              <div className="text-center mb-10">
                <h2 className="text-3xl md:text-4xl font-extralight tracking-tight mb-3">Rejoindre Spordateur</h2>
                <p className="text-white/40 font-light">Remplis le formulaire et on s'occupe du reste.</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">Nom de l'établissement *</label>
                  <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Studio Zen, Afro Dance Club..." className="bg-[#1A1A1A] border-white/10 h-12 text-white" required />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">Type d'activité *</label>
                  <Select value={formData.activity} onValueChange={v => setFormData(p => ({ ...p, activity: v }))}>
                    <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12 text-white"><SelectValue placeholder="Choisir" /></SelectTrigger>
                    <SelectContent>{ACTIVITIES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">Ville *</label>
                  <Select value={formData.city} onValueChange={v => setFormData(p => ({ ...p, city: v }))}>
                    <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12 text-white"><SelectValue placeholder="Choisir" /></SelectTrigger>
                    <SelectContent>{CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Téléphone</label>
                    <Input value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder="+41 XX XXX XX XX" className="bg-[#1A1A1A] border-white/10 h-12 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Email *</label>
                    <Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} placeholder="contact@..." className="bg-[#1A1A1A] border-white/10 h-12 text-white" required />
                  </div>
                </div>
                <Button type="submit" className="w-full h-14 bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold text-base rounded-full mt-4">
                  Rejoindre Spordateur <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <div className="flex items-center justify-center gap-4 text-[11px] text-white/20 mt-4">
                  <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Paiement sécurisé</span>
                  <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Support disponible</span>
                  <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> Mise en ligne rapide</span>
                </div>
              </form>
            </>
          )}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-12">
        <div className="container mx-auto px-6 text-center">
          <p className="text-xs text-white/20">2026 Spordateur — Genève, Suisse</p>
        </div>
      </footer>
    </div>
  );
}
