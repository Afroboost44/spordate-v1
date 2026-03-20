"use client";

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dumbbell, Building, ShieldCheck, Loader2, CreditCard, Tag,
  CheckCircle, ArrowLeft, ArrowRight
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { createPartner } from '@/services/firestore';
import { GeoPoint, collection, query, where, getDocs, limit } from 'firebase/firestore';

export default function PartnerRegisterPage() {
  const [step, setStep] = useState<'form' | 'payment' | 'done'>('form');
  const router = useRouter();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', confirm: '', ide: '',
    phone: '', address: '', city: '', canton: '',
    type: 'studio' as 'gym' | 'studio' | 'outdoor' | 'pool',
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
    if (formData.password !== formData.confirm) { setError("Les mots de passe ne correspondent pas."); return; }
    if (formData.password.length < 6) { setError("Le mot de passe doit contenir au moins 6 caractères."); return; }
    setIsLoading(true);

    try {
      if (!auth || !isFirebaseConfigured) throw new Error("Firebase non configuré.");
      const hasPromo = formData.promoCode.trim() !== '' && promoValid === true;

      const cred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      await updateProfile(cred.user, { displayName: formData.name });

      const pid = await createPartner({
        name: formData.name, email: formData.email, phone: formData.phone,
        address: formData.address, city: formData.city || 'Genève', canton: formData.canton || 'GE',
        geoPoint: new GeoPoint(46.2044, 6.1432), type: formData.type, description: formData.description,
        logo: '', images: [],
        subscriptionStatus: hasPromo ? 'active' : 'trial',
        subscriptionEnd: null as any, monthlyFee: hasPromo ? 0 : 4900,
        promoCode: hasPromo ? formData.promoCode.toUpperCase() : '',
        referralId: '', isApproved: false, isActive: false,
      });

      setPartnerId(pid);
      setUsedPromo(hasPromo);

      if (hasPromo) {
        setStep('done');
        toast({ title: "Code promo appliqué", description: "En attente de validation admin." });
      } else {
        setStep('payment');
      }
    } catch (err: any) {
      console.error('[Partner Register]', err);
      if (err.code === 'auth/email-already-in-use') setError("Email déjà utilisé. Essayez de vous connecter.");
      else if (err.code === 'auth/weak-password') setError("Mot de passe trop court (min. 6 caractères).");
      else setError(err.message || "Une erreur est survenue.");
    } finally { setIsLoading(false); }
  };

  const handlePayment = async () => {
    setIsLoading(true);
    setError('');
    try {
      const userId = auth?.currentUser?.uid;
      if (!userId) throw new Error("Session expirée.");
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: 'partner_monthly', userId, partnerId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Erreur paiement.");
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
            <Dumbbell className="h-7 w-7 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] rounded-md p-1 text-white" />
            <span className="text-lg font-light tracking-widest uppercase">Spordateur</span>
          </Link>
        </div>
        <Link href="/partner/login" className="text-sm text-[#D91CD2] hover:text-[#D91CD2]/80 transition font-light">
          Déjà partenaire ?
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
                {usedPromo ? 'Code promo activé !' : 'Candidature envoyée !'}
              </h1>
              <p className="text-white/50 font-light leading-relaxed">
                {usedPromo
                  ? "Votre accès gratuit est enregistré. L'administrateur va valider votre compte."
                  : "Votre dossier est enregistré. Après le paiement, l'administrateur validera votre compte."}
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-3">
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${usedPromo ? 'bg-green-400' : 'bg-yellow-400'}`} />
                <span className="text-sm text-white/60 font-light">
                  {usedPromo ? 'Paiement : offert (code promo)' : 'Paiement de l\'abonnement (49 CHF/mois)'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-sm text-white/60 font-light">Validation par l&apos;administrateur</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="text-sm text-white/40 font-light">Accès au portail partenaire</span>
              </div>
            </div>

            <Button onClick={() => router.push('/')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-8 h-12">
              Retour à l&apos;accueil
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
              <div className="w-16 h-16 rounded-2xl bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center mx-auto">
                <CreditCard className="h-8 w-8 text-[#D91CD2]" />
              </div>
              <h1 className="text-3xl font-extralight tracking-tight">Abonnement Partenaire</h1>
              <p className="text-white/50 font-light">Un abonnement mensuel est requis pour accéder au portail.</p>
            </div>

            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="bg-gradient-to-br from-[#D91CD2]/10 to-purple-900/10 border border-[#D91CD2]/20 rounded-3xl p-8 text-center space-y-6">
              <div>
                <p className="text-5xl font-extralight text-white">49 <span className="text-xl text-white/40">CHF/mois</span></p>
                <p className="text-xs text-white/30 mt-2 font-light">Annulable à tout moment</p>
              </div>
              <div className="space-y-3 text-left">
                {[
                  'Portail de gestion complet',
                  'Publication d\'activités illimitée',
                  'Suivi des réservations en temps réel',
                  'Visibilité sur la plateforme Spordateur',
                ].map(f => (
                  <div key={f} className="flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-[#D91CD2] flex-shrink-0" />
                    <span className="text-sm text-white/60 font-light">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={handlePayment}
              disabled={isLoading}
              className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-14 text-base rounded-full"
            >
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-5 w-5" />}
              Payer et activer mon compte
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
        <div className="absolute inset-0 bg-gradient-to-b from-[#D91CD2]/5 via-transparent to-transparent" />
        <div className="relative container mx-auto px-6 text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#D91CD2]/30 bg-[#D91CD2]/5">
            <Building className="h-4 w-4 text-[#D91CD2]" />
            <span className="text-sm text-[#D91CD2] font-light">Espace Partenaire</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extralight tracking-tight leading-tight">
            Rejoins le réseau <span className="text-[#D91CD2]">Spordateur.</span>
          </h1>
          <p className="text-white/50 font-light max-w-md mx-auto">
            Crée ton compte partenaire et commence à recevoir des réservations.
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="pb-24">
        <div className="container mx-auto px-6 max-w-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm text-[#D91CD2] uppercase tracking-[0.2em] font-light">Informations du studio</h3>

              <div>
                <Label className="text-white/40 text-xs font-light">Nom du Club / Studio</Label>
                <Input placeholder="Ex: Afroboost Genève" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white/40 text-xs font-light">Numéro IDE <span className="text-white/20">(optionnel)</span></Label>
                  <Input placeholder="CHE-123.456.789" value={formData.ide} onChange={e => setFormData({...formData, ide: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
                </div>
                <div>
                  <Label className="text-white/40 text-xs font-light">Type</Label>
                  <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}
                    className="w-full h-12 mt-1.5 bg-black/50 text-white border border-white/10 rounded-xl px-3 text-sm focus:border-[#D91CD2]/50 outline-none">
                    <option value="studio">Studio de danse</option>
                    <option value="gym">Salle de sport</option>
                    <option value="outdoor">Plein air</option>
                    <option value="pool">Piscine</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm text-[#D91CD2] uppercase tracking-[0.2em] font-light">Contact</h3>

              <div>
                <Label className="text-white/40 text-xs font-light">Email Professionnel</Label>
                <Input type="email" placeholder="contact@votreclub.ch" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                  className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white/40 text-xs font-light">Téléphone</Label>
                  <Input placeholder="+41 22 ..." value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
                </div>
                <div>
                  <Label className="text-white/40 text-xs font-light">Ville</Label>
                  <Input placeholder="Genève" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
                </div>
              </div>

              <div>
                <Label className="text-white/40 text-xs font-light">Adresse</Label>
                <Input placeholder="Rue du Studio 10" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}
                  className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm text-[#D91CD2] uppercase tracking-[0.2em] font-light">Accès</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white/40 text-xs font-light">Mot de passe</Label>
                  <Input type="password" placeholder="Min. 6 caractères" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
                </div>
                <div>
                  <Label className="text-white/40 text-xs font-light">Confirmer</Label>
                  <Input type="password" placeholder="Confirmer" required value={formData.confirm} onChange={e => setFormData({...formData, confirm: e.target.value})}
                    className="bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 mt-1.5 h-12 rounded-xl" />
                </div>
              </div>

              {/* Promo code */}
              <div>
                <Label className="text-white/40 text-xs font-light flex items-center gap-1.5">
                  <Tag className="h-3 w-3" /> Code Promo (optionnel)
                </Label>
                <div className="relative mt-1.5">
                  <Input
                    placeholder="Ex: PARTNER2026"
                    value={formData.promoCode}
                    onChange={e => { setFormData({...formData, promoCode: e.target.value}); setPromoValid(null); }}
                    onBlur={() => checkPromoCode(formData.promoCode)}
                    className={`bg-black/50 text-white border-white/10 focus:border-[#D91CD2]/50 h-12 rounded-xl pr-10 uppercase ${
                      promoValid === true ? 'border-green-500/50' : promoValid === false ? 'border-red-500/50' : ''
                    }`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {promoChecking && <Loader2 className="h-4 w-4 text-white/30 animate-spin" />}
                    {promoValid === true && <CheckCircle className="h-4 w-4 text-green-400" />}
                    {promoValid === false && <span className="text-red-400 text-xs">✗</span>}
                  </div>
                </div>
                {promoValid === true && <p className="text-xs text-green-400 mt-1.5 font-light">Code valide — accès gratuit</p>}
                {promoValid === false && formData.promoCode.trim() !== '' && <p className="text-xs text-red-400 mt-1.5 font-light">Code invalide ou expiré</p>}
              </div>
            </div>

            <Button type="submit" disabled={isLoading}
              className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-14 text-base rounded-full">
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : null}
              {formData.promoCode && promoValid === true
                ? 'Créer mon compte (gratuit)'
                : <>Continuer vers le paiement <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>

            <p className="text-center text-sm text-white/30 font-light">
              Déjà partenaire ? <Link href="/partner/login" className="text-[#D91CD2] hover:underline">Se connecter</Link>
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
