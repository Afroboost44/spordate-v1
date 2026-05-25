"use client";

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building, ShieldCheck, Loader2, CreditCard, Tag,
  CheckCircle, ArrowLeft, ArrowRight
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { createPartner } from '@/services/firestore';
import { GeoPoint, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { SpordateurLogo } from '@/components/SpordateurLogo';
import { useLanguage } from '@/context/LanguageContext';

export default function PartnerRegisterPage() {
  const { t } = useLanguage();
  const [step, setStep] = useState<'form' | 'payment' | 'done'>('form');
  const router = useRouter();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', confirm: '', ide: '',
    phone: '', address: '', city: '', canton: '',
    // BUG #57 — étendu : bar/club/restaurant (Cadre & Ambiance) + sports-store (BUG #58 à venir)
    type: 'studio' as 'gym' | 'studio' | 'outdoor' | 'pool' | 'bar' | 'club' | 'restaurant' | 'sports-store',
    description: '', promoCode: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [promoValid, setPromoValid] = useState<boolean | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [usedPromo, setUsedPromo] = useState(false);

  const checkPromoCode = async (code: string) => {
    if (!code.trim() || !db) { setPromoValid(null); return; }
    setPromoChecking(true);
    try {
      const promoQ = query(collection(db, 'promos'), where('code', '==', code.toUpperCase()), where('isActive', '==', true), limit(1));
      const snap = await getDocs(promoQ);
      setPromoValid(!snap.empty);
    } catch { setPromoValid(false); }
    setPromoChecking(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (formData.password !== formData.confirm) { setError(t('partner_register_err_passwords_mismatch')); return; }
    if (formData.password.length < 6) { setError(t('partner_register_err_password_too_short')); return; }
    setIsLoading(true);

    try {
      if (!auth || !isFirebaseConfigured) throw new Error(t('partner_register_err_firebase_not_configured'));
      const hasPromo = formData.promoCode.trim() !== '' && promoValid === true;

      const cred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      await updateProfile(cred.user, { displayName: formData.name });

      const pid = await createPartner({
        name: formData.name, email: formData.email, phone: formData.phone,
        address: formData.address, city: formData.city || 'Genève', canton: formData.canton || 'GE',
        geoPoint: new GeoPoint(46.2044, 6.1432), type: formData.type, description: formData.description,
        logo: '', images: [],
        status: hasPromo ? 'pending_validation' : 'pending_payment',
        subscriptionStatus: hasPromo ? 'active' : 'trial',
        subscriptionEnd: null as any, monthlyFee: hasPromo ? 0 : 4900,
        promoCode: hasPromo ? formData.promoCode.toUpperCase() : '',
        referralId: '', isApproved: false, isActive: false,
      });

      setPartnerId(pid);
      setUsedPromo(hasPromo);

      if (hasPromo) {
        setStep('done');
        toast({ title: t('partner_register_toast_promo_applied'), description: t('partner_register_toast_pending_admin') });
      } else {
        setStep('payment');
      }
    } catch (err: any) {
      console.error('[Partner Register]', err);
      if (err.code === 'auth/email-already-in-use') setError(t('partner_register_err_email_in_use'));
      else if (err.code === 'auth/weak-password') setError(t('partner_register_err_password_too_short'));
      else setError(err.message || t('partner_register_err_generic'));
    } finally { setIsLoading(false); }
  };

  const handlePayment = async () => {
    setIsLoading(true);
    setError('');
    try {
      const userId = auth?.currentUser?.uid;
      if (!userId) throw new Error(t('partner_register_err_session_expired'));
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: 'partner_monthly', userId, partnerId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || t('partner_register_err_payment'));
      window.location.href = data.url;
    } catch (err: any) { setError(err.message); setIsLoading(false); }
  };

  // ── NAV ──
  const Nav = () => (
    <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/90">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-white/40 hover:text-white/70 transition mr-2">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            {/* Accent feature — SVG inline (admin Couleur principale). */}
            <SpordateurLogo className="h-8 w-8 text-accent" />
            <span className="text-lg font-light tracking-widest uppercase">Spordateur</span>
          </Link>
        </div>
        <Link href="/partner/login" className="text-sm text-accent hover:text-accent/80 transition font-light">
          {t('partner_register_already_partner')}
        </Link>
      </div>
    </nav>
  );

  // ── STEP 3: DONE ──
  if (step === 'done') {
    return (
      <div className="min-h-screen bg-black text-white">
        <Nav />
        <div className="flex items-center justify-center min-h-[85vh] px-4">
          <div className="max-w-md w-full text-center space-y-8">
            <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
              <ShieldCheck className="h-10 w-10 text-green-400" />
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-extralight tracking-tight">
                {usedPromo ? t('partner_register_promo_activated') : t('partner_register_application_sent')}
              </h1>
              <p className="text-white/50 font-light leading-relaxed">
                {usedPromo
                  ? t('partner_register_done_promo_desc')
                  : t('partner_register_done_paid_desc')}
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-3">
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${usedPromo ? 'bg-green-400' : 'bg-yellow-400'}`} />
                <span className="text-sm text-white/60 font-light">
                  {usedPromo ? t('partner_register_step_payment_free') : t('partner_register_step_payment_subscription')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-sm text-white/60 font-light">{t('partner_register_step_admin_validation')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="text-sm text-white/40 font-light">{t('partner_register_step_portal_access')}</span>
              </div>
            </div>

            <Button onClick={() => router.push('/')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-8 h-12">
              {t('partner_register_back_home')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 2: PAYMENT ──
  if (step === 'payment') {
    return (
      <div className="min-h-screen bg-black text-white">
        <Nav />
        <div className="flex items-center justify-center min-h-[85vh] px-4">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto">
                <CreditCard className="h-8 w-8 text-accent" />
              </div>
              <h1 className="text-3xl font-extralight tracking-tight">{t('partner_register_subscription_title')}</h1>
              <p className="text-white/50 font-light">{t('partner_register_subscription_desc')}</p>
            </div>

            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="bg-accent/10 border border-accent/20 rounded-3xl p-8 text-center space-y-6">
              <div>
                <p className="text-5xl font-extralight text-white">49 <span className="text-xl text-white/40">{t('partner_register_chf_month')}</span></p>
                <p className="text-xs text-white/30 mt-2 font-light">{t('partner_register_cancel_anytime')}</p>
              </div>
              <div className="space-y-3 text-left">
                {[
                  t('partner_register_feature_portal'),
                  t('partner_register_feature_unlimited_activities'),
                  t('partner_register_feature_bookings_tracking'),
                  t('partner_register_feature_visibility'),
                ].map(f => (
                  <div key={f} className="flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-accent flex-shrink-0" />
                    <span className="text-sm text-white/60 font-light">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={handlePayment}
              disabled={isLoading}
              className="w-full bg-accent hover:bg-accent/80 text-white font-semibold h-14 text-base rounded-full"
            >
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-5 w-5" />}
              {t('partner_register_pay_activate')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 1: FORM ──
  return (
    <div className="min-h-screen bg-black text-white">
      <Nav />

      {/* Hero */}
      <section className="relative py-16 md:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        <div className="relative container mx-auto px-6 text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-accent/30 bg-accent/5">
            <Building className="h-4 w-4 text-accent" />
            <span className="text-sm text-accent font-light">{t('partner_register_partner_space')}</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extralight tracking-tight leading-tight">
            {t('partner_register_hero_join')} <span className="text-accent">Spordateur.</span>
          </h1>
          <p className="text-white/50 font-light max-w-md mx-auto">
            {t('partner_register_hero_subtitle')}
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="pb-24">
        <div className="container mx-auto px-6 max-w-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm text-accent uppercase tracking-[0.2em] font-light">{t('partner_register_studio_info')}</h3>

              <div>
                <Label className="text-white/40 text-xs font-light">{t('partner_register_club_name_label')}</Label>
                <Input placeholder={t('partner_register_club_name_placeholder')} required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white/40 text-xs font-light">{t('partner_register_ide_number_label')} <span className="text-white/20">{t('partner_register_optional')}</span></Label>
                  <Input placeholder="CHE-123.456.789" value={formData.ide} onChange={e => setFormData({...formData, ide: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
                </div>
                <div>
                  <Label className="text-white/40 text-xs font-light">{t('partner_register_type_label')}</Label>
                  <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}
                    className="w-full h-12 mt-1.5 bg-black/50 text-white border border-white/10 rounded-xl px-3 text-sm focus:border-accent/50 outline-none">
                    <option value="studio">{t('partner_register_type_studio')}</option>
                    <option value="gym">{t('partner_register_type_gym')}</option>
                    <option value="outdoor">{t('partner_register_type_outdoor')}</option>
                    <option value="pool">{t('partner_register_type_pool')}</option>
                    {/* BUG #57 — nouveaux types venue (Cadre & Ambiance dans le form activité) */}
                    <option value="bar">{t('partner_register_type_bar')}</option>
                    <option value="club">{t('partner_register_type_club')}</option>
                    <option value="restaurant">{t('partner_register_type_restaurant')}</option>
                    {/* BUG #58 — placeholder (champs spécifiques à venir) */}
                    <option value="sports-store">{t('partner_register_type_sports_store')}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm text-accent uppercase tracking-[0.2em] font-light">{t('partner_register_contact')}</h3>

              <div>
                <Label className="text-white/40 text-xs font-light">{t('partner_register_email_pro_label')}</Label>
                <Input type="email" placeholder={t('partner_register_email_placeholder')} required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                  className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white/40 text-xs font-light">{t('partner_register_phone_label')}</Label>
                  <Input placeholder="+41 22 ..." value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
                </div>
                <div>
                  <Label className="text-white/40 text-xs font-light">{t('partner_register_city_label')}</Label>
                  <Input placeholder={t('partner_register_city_placeholder')} value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
                </div>
              </div>

              <div>
                <Label className="text-white/40 text-xs font-light">{t('partner_register_address_label')}</Label>
                <Input placeholder={t('partner_register_address_placeholder')} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}
                  className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm text-accent uppercase tracking-[0.2em] font-light">{t('partner_register_access')}</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white/40 text-xs font-light">{t('partner_register_password_label')}</Label>
                  <Input type="password" placeholder={t('partner_register_password_placeholder')} required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
                </div>
                <div>
                  <Label className="text-white/40 text-xs font-light">{t('partner_register_confirm_label')}</Label>
                  <Input type="password" placeholder={t('partner_register_confirm_placeholder')} required value={formData.confirm} onChange={e => setFormData({...formData, confirm: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-accent/50 mt-1.5 h-12 rounded-xl" />
                </div>
              </div>

              {/* Promo code */}
              <div>
                <Label className="text-white/40 text-xs font-light flex items-center gap-1.5">
                  <Tag className="h-3 w-3" /> {t('partner_register_promo_code_label')}
                </Label>
                <div className="relative mt-1.5">
                  <Input
                    placeholder={t('partner_register_promo_placeholder')}
                    value={formData.promoCode}
                    onChange={e => { setFormData({...formData, promoCode: e.target.value}); setPromoValid(null); }}
                    onBlur={() => checkPromoCode(formData.promoCode)}
                    className={`bg-black/50 text-white border-white/10 focus:border-accent/50 h-12 rounded-xl pr-10 uppercase ${
                      promoValid === true ? 'border-green-500/50' : promoValid === false ? 'border-red-500/50' : ''
                    }`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {promoChecking && <Loader2 className="h-4 w-4 text-white/30 animate-spin" />}
                    {promoValid === true && <CheckCircle className="h-4 w-4 text-green-400" />}
                    {promoValid === false && <span className="text-red-400 text-xs">✗</span>}
                  </div>
                </div>
                {promoValid === true && <p className="text-xs text-green-400 mt-1.5 font-light">{t('partner_register_promo_valid')}</p>}
                {promoValid === false && formData.promoCode.trim() !== '' && <p className="text-xs text-red-400 mt-1.5 font-light">{t('partner_register_promo_invalid')}</p>}
              </div>
            </div>

            <Button type="submit" disabled={isLoading}
              className="w-full bg-accent hover:bg-accent/80 text-white font-semibold h-14 text-base rounded-full">
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : null}
              {formData.promoCode && promoValid === true
                ? t('partner_register_create_account_free')
                : <>{t('partner_register_continue_to_payment')} <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>

            <p className="text-center text-sm text-white/30 font-light">
              {t('partner_register_already_partner_question')} <Link href="/partner/login" className="text-accent hover:underline">{t('partner_register_sign_in')}</Link>
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
