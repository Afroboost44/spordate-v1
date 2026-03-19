"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dumbbell, Building, Lock, Loader2, CheckCircle, AlertTriangle,
  CreditCard, ShieldAlert, ArrowLeft
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { auth, isFirebaseConfigured, db } from '@/lib/firebase';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

type PartnerStatus = 'loading' | 'no_partner' | 'needs_payment' | 'pending_approval' | 'active' | 'cancelled' | 'refused';

export default function PartnerLoginPage() {
  const router = useRouter();
  const [view, setView] = useState<'login' | 'forgot' | 'status'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [partnerStatus, setPartnerStatus] = useState<PartnerStatus>('loading');
  const [partnerName, setPartnerName] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (!auth || !isFirebaseConfigured) throw new Error("Firebase non configuré.");
      const cred = await signInWithEmailAndPassword(auth, email, password);

      if (!db) throw new Error("Firestore non initialisé.");
      const partnerQ = query(collection(db, 'partners'), where('email', '==', email), limit(1));
      const partnerSnap = await getDocs(partnerQ);

      if (partnerSnap.empty) {
        setPartnerStatus('no_partner');
        setView('status');
        setIsLoading(false);
        return;
      }

      const partner = partnerSnap.docs[0].data();
      setPartnerName(partner.name || '');
      const subStatus = partner.subscriptionStatus;

      if (subStatus === 'trial' || subStatus === 'expired') {
        setPartnerStatus('needs_payment');
        setView('status');
        setIsLoading(false);
        return;
      }
      if (subStatus === 'cancelled') {
        setPartnerStatus('cancelled');
        setView('status');
        setIsLoading(false);
        return;
      }
      if (!partner.isApproved) {
        setPartnerStatus('pending_approval');
        setView('status');
        setIsLoading(false);
        return;
      }

      router.push('/partner/dashboard');
    } catch (err: any) {
      console.error('[Partner Login]', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') setError("Email ou mot de passe incorrect.");
      else if (err.code === 'auth/wrong-password') setError("Mot de passe incorrect.");
      else if (err.code === 'auth/too-many-requests') setError("Trop de tentatives. Réessayez plus tard.");
      else setError(err.message || "Une erreur est survenue.");
      setIsLoading(false);
    }
  };

  const handlePayNow = async () => {
    setIsLoading(true);
    try {
      const userId = auth?.currentUser?.uid;
      if (!userId) throw new Error("Session expirée.");
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: 'partner_monthly', userId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Erreur paiement.");
      window.location.href = data.url;
    } catch (err: any) { setError(err.message); setIsLoading(false); }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch { setError("Erreur lors de l'envoi. Vérifiez l'email."); }
    setIsLoading(false);
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
        <Link href="/partner/register" className="text-sm text-[#D91CD2] hover:text-[#D91CD2]/80 transition font-light">
          Devenir partenaire
        </Link>
      </div>
    </nav>
  );

  // ── STATUS SCREENS ──
  if (view === 'status') {
    return (
      <div className="min-h-screen bg-black text-white">
        <Nav />
        <div className="flex items-center justify-center min-h-[85vh] px-4">
          <div className="max-w-md w-full text-center space-y-6">
            {partnerStatus === 'no_partner' && (
              <>
                <div className="w-20 h-20 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mx-auto">
                  <ShieldAlert className="h-10 w-10 text-orange-400" />
                </div>
                <h1 className="text-2xl font-extralight tracking-tight">Compte non partenaire</h1>
                <p className="text-white/50 font-light">Ce compte n&apos;est pas enregistré comme partenaire.</p>
                <Button asChild className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-12 rounded-full px-8">
                  <Link href="/partner/register">Devenir partenaire</Link>
                </Button>
              </>
            )}

            {partnerStatus === 'needs_payment' && (
              <>
                <div className="w-20 h-20 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center mx-auto">
                  <CreditCard className="h-10 w-10 text-yellow-400" />
                </div>
                <h1 className="text-2xl font-extralight tracking-tight">Abonnement requis</h1>
                <p className="text-white/50 font-light">
                  Bienvenue <strong className="text-white">{partnerName}</strong>. Activez votre abonnement pour accéder au portail.
                </p>
                <div className="bg-[#D91CD2]/5 border border-[#D91CD2]/20 rounded-2xl p-6">
                  <p className="text-4xl font-extralight text-white">49 <span className="text-lg text-white/40">CHF/mois</span></p>
                </div>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button onClick={handlePayNow} disabled={isLoading} className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-14 rounded-full">
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Payer l&apos;abonnement
                </Button>
              </>
            )}

            {partnerStatus === 'pending_approval' && (
              <>
                <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
                  <AlertTriangle className="h-10 w-10 text-amber-400" />
                </div>
                <h1 className="text-2xl font-extralight tracking-tight text-amber-400">En attente de validation</h1>
                <p className="text-white/50 font-light">
                  Votre abonnement est actif. L&apos;administrateur va valider <strong className="text-white">{partnerName}</strong> pour activer votre portail.
                </p>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <span className="text-sm text-green-400 font-light">Abonnement payé</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full border-2 border-amber-400 animate-pulse" />
                    <span className="text-sm text-amber-400 font-light">Validation admin en cours...</span>
                  </div>
                </div>
                <Button onClick={() => router.push('/')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-8 h-12">
                  Retour à l&apos;accueil
                </Button>
              </>
            )}

            {partnerStatus === 'cancelled' && (
              <>
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
                  <ShieldAlert className="h-10 w-10 text-red-400" />
                </div>
                <h1 className="text-2xl font-extralight tracking-tight text-red-400">Abonnement annulé</h1>
                <p className="text-white/50 font-light">Votre abonnement a été annulé. Renouvelez-le pour retrouver l&apos;accès.</p>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button onClick={handlePayNow} disabled={isLoading} className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-14 rounded-full">
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Renouveler l&apos;abonnement
                </Button>
              </>
            )}

            {partnerStatus === 'refused' && (
              <>
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
                  <ShieldAlert className="h-10 w-10 text-red-400" />
                </div>
                <h1 className="text-2xl font-extralight tracking-tight text-red-400">Demande refusée</h1>
                <p className="text-white/50 font-light">Votre demande de partenariat a été refusée. Contactez-nous pour plus d&apos;informations.</p>
                <Button onClick={() => router.push('/')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-8 h-12">
                  Retour à l&apos;accueil
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── FORGOT PASSWORD ──
  if (view === 'forgot') {
    return (
      <div className="min-h-screen bg-black text-white">
        <Nav />
        <div className="flex items-center justify-center min-h-[85vh] px-4">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center space-y-3">
              <h1 className="text-2xl font-extralight tracking-tight">Réinitialisation</h1>
              <p className="text-white/50 font-light">Recevez un lien sécurisé par email.</p>
            </div>

            {resetSent ? (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
                  <CheckCircle className="h-8 w-8 text-green-400" />
                </div>
                <p className="text-green-400 font-light">Un lien a été envoyé à <strong>{email}</strong>.</p>
                <Button onClick={() => { setView('login'); setResetSent(false); }} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light rounded-full px-8 h-12">
                  Retour connexion
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <Input type="email" placeholder="Votre email professionnel" value={email} onChange={e => setEmail(e.target.value)} required
                  className="bg-black/50 border-white/10 text-white h-12 rounded-xl focus:border-[#D91CD2]/50" />
                <Button disabled={isLoading} type="submit" className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-12 rounded-full">
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : null} Envoyer le lien
                </Button>
                <button type="button" onClick={() => setView('login')} className="w-full text-sm text-white/30 hover:text-white/50 font-light py-2">
                  Annuler
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── LOGIN FORM ──
  return (
    <div className="min-h-screen bg-black text-white">
      <Nav />

      <div className="flex items-center justify-center min-h-[85vh] px-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center mx-auto">
              <Building className="h-8 w-8 text-[#D91CD2]" />
            </div>
            <h1 className="text-3xl font-extralight tracking-tight">Espace Partenaire</h1>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
              <div>
                <Label className="text-white/40 text-xs font-light">Email Professionnel</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  className="bg-black/50 border-white/10 text-white h-12 rounded-xl mt-1.5 focus:border-[#D91CD2]/50" />
              </div>
              <div>
                <div className="flex justify-between items-center">
                  <Label className="text-white/40 text-xs font-light">Mot de passe</Label>
                  <button type="button" onClick={() => setView('forgot')} className="text-xs text-[#D91CD2] hover:underline font-light">
                    Mot de passe oublié ?
                  </button>
                </div>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  className="bg-black/50 border-white/10 text-white h-12 rounded-xl mt-1.5 focus:border-[#D91CD2]/50" />
              </div>
            </div>

            <Button disabled={isLoading} type="submit" className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold h-14 text-base rounded-full">
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : <Lock className="mr-2 h-4 w-4" />}
              Se connecter
            </Button>
          </form>

          <p className="text-center text-sm text-white/30 font-light">
            Pas encore partenaire ? <Link href="/partner/register" className="text-[#D91CD2] hover:underline">Faites une demande ici</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
