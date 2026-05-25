"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowRight, CheckCircle, X, TrendingUp, Users, Wallet,
  CalendarCheck, Star, Shield, Zap, Gift, Loader2, ArrowLeft
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import BackButton from '@/components/BackButton';
import { SpordateurLogo } from '@/components/SpordateurLogo';
import { useLanguage } from '@/context/LanguageContext';

const ACTIVITIES = ['Danse / Zumba', 'Afroboost', 'Fitness', 'Yoga', 'Running', 'Crossfit', 'Massage / Bien-être', 'Autre'];
const SWISS_CITIES = ['Genève', 'Lausanne', 'Zurich', 'Berne', 'Bâle', 'Lucerne', 'Fribourg', 'Neuchâtel'];
const COUNTRIES: Record<string, string[]> = {
  'France': ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Bordeaux', 'Lille', 'Strasbourg', 'Autre'],
  'Belgique': ['Bruxelles', 'Anvers', 'Liège', 'Gand', 'Charleroi', 'Autre'],
  'Canada': ['Montréal', 'Toronto', 'Vancouver', 'Ottawa', 'Québec', 'Autre'],
  'Côte d\'Ivoire': ['Abidjan', 'Yamoussoukro', 'Bouaké', 'Autre'],
  'Sénégal': ['Dakar', 'Thiès', 'Saint-Louis', 'Autre'],
  'Cameroun': ['Douala', 'Yaoundé', 'Bafoussam', 'Autre'],
  'RD Congo': ['Kinshasa', 'Lubumbashi', 'Goma', 'Autre'],
  'Maroc': ['Casablanca', 'Rabat', 'Marrakech', 'Tanger', 'Autre'],
  'Guinée': ['Conakry', 'Nzérékoré', 'Kankan', 'Autre'],
  'Mali': ['Bamako', 'Sikasso', 'Autre'],
  'Burkina Faso': ['Ouagadougou', 'Bobo-Dioulasso', 'Autre'],
  'Autre pays': [],
};

export default function PartnersPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { t } = useLanguage();
  const [formData, setFormData] = useState({ name: '', activity: '', city: '', phone: '', email: '' });
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [locationMode, setLocationMode] = useState<'swiss' | 'international'>('swiss');
  const [selectedCountry, setSelectedCountry] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      let saved = false;

      // Try client-side Firestore first
      if (db && isFirebaseConfigured) {
        try {
          const requestRef = doc(collection(db, 'partnerRequests'));
          await setDoc(requestRef, {
            requestId: requestRef.id,
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            activity: formData.activity,
            city: formData.city,
            status: 'pending',
            notes: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          // Also create notification
          const notifRef = doc(collection(db, 'notifications'));
          await setDoc(notifRef, {
            notificationId: notifRef.id,
            userId: 'admin',
            type: 'partner_request',
            title: t('partners_notif_title'),
            body: t('partners_notif_body', { name: formData.name, city: formData.city }),
            data: { requestId: requestRef.id, partnerName: formData.name, email: formData.email },
            isRead: false,
            createdAt: serverTimestamp(),
          });
          saved = true;
        } catch (clientErr) {
          console.warn('[Partner Request] Client-side write failed, trying API:', clientErr);
        }
      }

      // Fallback: API route (needs FIREBASE_SERVICE_ACCOUNT_KEY on server)
      if (!saved) {
        const res = await fetch('/api/partner-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            activity: formData.activity,
            city: formData.city,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('partners_error_submit_short'));
      }

      setSubmitted(true);
      toast({ title: t('partners_toast_sent_title'), description: t('partners_toast_sent_desc') });

    } catch (err: any) {
      console.error('[Partner Request]', err);
      setError(t('partners_error_submit_long'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
        <BackButton fallbackUrl="/activities" />

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/90">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-white/40 hover:text-white/70 transition mr-2"><ArrowLeft className="h-5 w-5" /></button>
            <Link href="/" className="flex items-center gap-2">
              {/* Accent feature — SVG inline (admin Couleur principale). */}
              <SpordateurLogo className="h-8 w-8 text-accent" />
              <span className="text-lg font-light tracking-widest uppercase">{t('partners_brand')}</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/partner/login" className="text-xs text-white/50 hover:text-white/80 transition hidden sm:inline">
              {t('partners_nav_partner_space')}
            </Link>
            <Button asChild className="bg-accent hover:bg-accent/80 text-white text-xs font-normal uppercase tracking-wide px-6 h-10 rounded-full">
              <a href="#formulaire">{t('partners_nav_become')}</a>
            </Button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-[70vh] flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/10 via-black/80 to-black" />
        <div className="relative z-10 container mx-auto px-6 py-24">
          <div className="max-w-2xl space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-accent/30 bg-accent/5">
              <Gift className="h-4 w-4 text-accent" />
              <span className="text-sm text-accent font-light">{t('partners_hero_badge')}</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-extralight leading-tight tracking-tight">
              {t('partners_hero_title_pre')}
              <span className="text-accent"> {t('partners_hero_title_accent')}</span>
            </h1>

            <p className="text-lg font-light text-white/50 max-w-lg leading-relaxed">
              {t('partners_hero_subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button asChild className="bg-accent hover:bg-accent/80 text-white font-semibold text-base px-10 h-14 rounded-full">
                <a href="#formulaire">{t('partners_hero_cta')} <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
            </div>

            <div className="flex gap-8 pt-4">
              <div><p className="text-2xl font-light text-white">150+</p><p className="text-xs text-white/30">{t('partners_hero_stat_bookings')}</p></div>
              <div><p className="text-2xl font-light text-white">500+</p><p className="text-xs text-white/30">{t('partners_hero_stat_users')}</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLÈME → SOLUTION ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center max-w-5xl mx-auto">
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-extralight tracking-tight">{t('partners_problem_title')}</h2>
              <div className="space-y-4">
                {[t('partners_problem_item_1'), t('partners_problem_item_2'), t('partners_problem_item_3')].map(p => (
                  <div key={p} className="flex items-center gap-3"><X className="h-5 w-5 text-red-400 flex-shrink-0" /><span className="text-white/50 font-light">{p}</span></div>
                ))}
              </div>
            </div>
            <div className="bg-accent/5 border border-accent/20 rounded-3xl p-8 space-y-4">
              <Zap className="h-8 w-8 text-accent" />
              <h3 className="text-xl font-light text-white">{t('partners_solution_title')}</h3>
              <p className="text-white/50 font-light leading-relaxed">{t('partners_solution_desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm text-accent uppercase tracking-[0.3em] mb-4">{t('partners_how_eyebrow')}</p>
            <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">{t('partners_how_title')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { num: '01', title: t('partners_how_step1_title'), desc: t('partners_how_step1_desc'), icon: <CalendarCheck className="h-6 w-6" /> },
              { num: '02', title: t('partners_how_step2_title'), desc: t('partners_how_step2_desc'), icon: <Users className="h-6 w-6" /> },
              { num: '03', title: t('partners_how_step3_title'), desc: t('partners_how_step3_desc'), icon: <Wallet className="h-6 w-6" /> },
            ].map(s => (
              <div key={s.num} className="text-center space-y-4 p-6">
                <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mx-auto">{s.icon}</div>
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
            <h2 className="text-3xl md:text-5xl font-extralight tracking-tight">{t('partners_gains_title_pre')}<br /><span className="text-accent">{t('partners_gains_title_accent')}</span></h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: <TrendingUp className="h-5 w-5" />, text: t('partners_gain_1') },
              { icon: <Wallet className="h-5 w-5" />, text: t('partners_gain_2') },
              { icon: <Users className="h-5 w-5" />, text: t('partners_gain_3') },
              { icon: <Star className="h-5 w-5" />, text: t('partners_gain_4') },
              { icon: <Zap className="h-5 w-5" />, text: t('partners_gain_5') },
              { icon: <Shield className="h-5 w-5" />, text: t('partners_gain_6') },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                <div className="text-accent">{b.icon}</div>
                <span className="text-sm text-white/70 font-light">{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OFFRE PARTENAIRE ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-lg">
          <Card className="bg-gradient-to-br from-[#1A1A1A] to-black border-accent/30 shadow-xl shadow-accent/5 overflow-hidden">
            <CardContent className="p-8 space-y-6 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs">
                <Gift className="h-3.5 w-3.5" /> {t('partners_offer_badge')}
              </div>
              <h3 className="text-2xl font-light text-white">{t('partners_offer_title')}</h3>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-5xl font-extralight text-white">49</span>
                <span className="text-white/40">{t('partners_offer_price_unit')}</span>
              </div>
              <div className="space-y-3 text-left">
                {[
                  t('partners_offer_feat_1'),
                  t('partners_offer_feat_2'),
                  t('partners_offer_feat_3'),
                  t('partners_offer_feat_4'),
                  t('partners_offer_feat_5'),
                  t('partners_offer_feat_6'),
                ].map(f => (
                  <div key={f} className="flex items-start gap-2.5">
                    <CheckCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-white/60 font-light">{f}</span>
                  </div>
                ))}
              </div>
              <Button asChild className="w-full h-14 bg-accent hover:bg-accent/80 text-white font-semibold text-base rounded-full">
                <a href="#formulaire">{t('partners_offer_cta')} <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
              <p className="text-[11px] text-white/20">{t('partners_offer_no_commit')}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── POUR QUI ── */}
      <section className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-4xl">
          <h2 className="text-3xl font-extralight tracking-tight text-center mb-12">{t('partners_forwho_title')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[t('partners_forwho_1'), t('partners_forwho_2'), t('partners_forwho_3'), t('partners_forwho_4'), t('partners_forwho_5'), t('partners_forwho_6')].map(label => (
              <div key={label} className="p-4 bg-white/5 rounded-2xl border border-white/5 text-center">
                <p className="text-sm text-white/60 font-light">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── URGENCE ── */}
      <section className="py-16 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-2xl text-center space-y-4">
          <p className="text-lg text-white/60 font-light italic">
            {t('partners_urgency_quote')}
          </p>
          <p className="text-accent font-medium">{t('partners_urgency_question')}</p>
        </div>
      </section>

      {/* ── FORMULAIRE ── */}
      <section id="formulaire" className="py-24 border-t border-white/5">
        <div className="container mx-auto px-6 max-w-lg">
          {submitted ? (
            <div className="text-center space-y-6 py-12">
              <CheckCircle className="h-16 w-16 text-green-400 mx-auto" />
              <h2 className="text-3xl font-light text-white">{t('partners_sent_title')}</h2>
              <p className="text-white/40">
                {t('partners_sent_desc')}
              </p>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-3">
                <p className="text-xs text-white/30 uppercase tracking-wider mb-3">{t('partners_next_steps')}</p>
                <div className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs">1</span>
                  <span className="text-sm text-white/60">{t('partners_step_1_done')}</span>
                  <CheckCircle className="h-4 w-4 text-green-400 ml-auto" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs">2</span>
                  <span className="text-sm text-white/60">{t('partners_step_2_admin')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full bg-white/10 text-white/30 flex items-center justify-center text-xs">3</span>
                  <span className="text-sm text-white/40">{t('partners_step_3_account')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full bg-white/10 text-white/30 flex items-center justify-center text-xs">4</span>
                  <span className="text-sm text-white/40">{t('partners_step_4_portal')}</span>
                </div>
              </div>
              <Button asChild variant="outline" className="border-white/20 text-white/60">
                <Link href="/">{t('partners_back_home')}</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="text-center mb-10">
                <h2 className="text-3xl md:text-4xl font-extralight tracking-tight mb-3">{t('partners_form_title')}</h2>
                <p className="text-white/40 font-light">{t('partners_form_subtitle')}</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">{t('partners_form_field_name')}</label>
                  <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder={t('partners_form_field_name_placeholder')} className="bg-[#1A1A1A] border-white/10 h-12 text-white" required />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">{t('partners_form_field_activity')}</label>
                  <Select value={formData.activity} onValueChange={v => setFormData(p => ({ ...p, activity: v }))}>
                    <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12 text-white"><SelectValue placeholder={t('partners_form_select_placeholder')} /></SelectTrigger>
                    <SelectContent>{ACTIVITIES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">{t('partners_form_field_location')}</label>
                  {/* Swiss / International toggle */}
                  <div className="flex gap-2 mb-3">
                    <button type="button" onClick={() => { setLocationMode('swiss'); setSelectedCountry(''); setFormData(p => ({ ...p, city: '' })); }}
                      className={`flex-1 h-10 rounded-full text-sm font-light transition ${locationMode === 'swiss' ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'}`}>
                      {t('partners_form_loc_swiss')}
                    </button>
                    <button type="button" onClick={() => { setLocationMode('international'); setFormData(p => ({ ...p, city: '' })); }}
                      className={`flex-1 h-10 rounded-full text-sm font-light transition ${locationMode === 'international' ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'}`}>
                      {t('partners_form_loc_international')}
                    </button>
                  </div>

                  {locationMode === 'swiss' ? (
                    <Select value={formData.city} onValueChange={v => setFormData(p => ({ ...p, city: v }))}>
                      <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12 text-white"><SelectValue placeholder={t('partners_form_city_placeholder_swiss')} /></SelectTrigger>
                      <SelectContent>{SWISS_CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <div className="space-y-3">
                      <Select value={selectedCountry} onValueChange={v => { setSelectedCountry(v); setFormData(p => ({ ...p, city: '' })); }}>
                        <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12 text-white"><SelectValue placeholder={t('partners_form_country_placeholder')} /></SelectTrigger>
                        <SelectContent>{Object.keys(COUNTRIES).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                      {selectedCountry && COUNTRIES[selectedCountry]?.length > 0 && (
                        <Select value={formData.city} onValueChange={v => setFormData(p => ({ ...p, city: `${v}, ${selectedCountry}` }))}>
                          <SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12 text-white"><SelectValue placeholder={t('partners_form_city_placeholder_intl')} /></SelectTrigger>
                          <SelectContent>{COUNTRIES[selectedCountry].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      {selectedCountry === 'Autre pays' && (
                        <Input placeholder={t('partners_form_city_placeholder_other')} value={formData.city} onChange={e => setFormData(p => ({ ...p, city: e.target.value }))}
                          className="bg-[#1A1A1A] border-white/10 h-12 text-white" />
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">{t('partners_form_field_phone')}</label>
                    <Input value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder="+41 XX XXX XX XX" className="bg-[#1A1A1A] border-white/10 h-12 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">{t('partners_form_field_email')}</label>
                    <Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} placeholder="contact@..." className="bg-[#1A1A1A] border-white/10 h-12 text-white" required />
                  </div>
                </div>
                <Button type="submit" disabled={isLoading} className="w-full h-14 bg-accent hover:bg-accent/80 text-white font-semibold text-base rounded-full mt-4">
                  {isLoading ? <Loader2 className="animate-spin mr-2 h-5 w-5" /> : null}
                  {t('partners_form_submit')} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <div className="flex items-center justify-center gap-4 text-[11px] text-white/20 mt-4">
                  <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> {t('partners_badge_secure')}</span>
                  <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> {t('partners_badge_support')}</span>
                  <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> {t('partners_badge_fast')}</span>
                </div>
                <p className="text-center text-sm text-white/40 mt-6">
                  {t('partners_form_already')}{' '}
                  <Link href="/partner/login" className="text-accent hover:underline">
                    {t('partners_form_login_link')}
                  </Link>
                </p>
              </form>
            </>
          )}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-12">
        <div className="container mx-auto px-6 text-center">
          <p className="text-xs text-white/20">{t('partners_footer_copyright')}</p>
        </div>
      </footer>
    </div>
  );
}
