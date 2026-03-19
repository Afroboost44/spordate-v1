"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Building, Lock, Loader2, CheckCircle, AlertTriangle, CreditCard, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { db } from '@/lib/firebase';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

type PartnerStatus = 'loading' | 'no_partner' | 'needs_payment' | 'pending_approval' | 'active' | 'cancelled';

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
      if (!auth || !isFirebaseConfigured) {
        throw new Error("Firebase non configuré.");
      }

      // 1. Authenticate with Firebase
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      // 2. Check if a partner document exists for this user
      if (!db) throw new Error("Firestore non initialisé.");

      const partnerQ = query(
        collection(db, 'partners'),
        where('email', '==', email),
        limit(1)
      );
      const partnerSnap = await getDocs(partnerQ);

      if (partnerSnap.empty) {
        // No partner doc — this user isn't a partner
        setPartnerStatus('no_partner');
        setView('status');
        setIsLoading(false);
        return;
      }

      const partner = partnerSnap.docs[0].data();
      setPartnerName(partner.name || '');

      // 3. Check subscription status
      const subStatus = partner.subscriptionStatus;

      if (subStatus === 'trial' || subStatus === 'expired') {
        // Needs to pay
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

      // 4. Check admin approval
      if (!partner.isApproved) {
        setPartnerStatus('pending_approval');
        setView('status');
        setIsLoading(false);
        return;
      }

      // 5. All good — redirect to dashboard
      router.push('/partner/dashboard');

    } catch (err: any) {
      console.error('[Partner Login]', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError("Email ou mot de passe incorrect.");
      } else if (err.code === 'auth/wrong-password') {
        setError("Mot de passe incorrect.");
      } else if (err.code === 'auth/too-many-requests') {
        setError("Trop de tentatives. Réessayez dans quelques minutes.");
      } else {
        setError(err.message || "Une erreur est survenue.");
      }
      setIsLoading(false);
    }
  };

  const handlePayNow = async () => {
    setIsLoading(true);
    try {
      const userId = auth?.currentUser?.uid;
      if (!userId) throw new Error("Session expirée.");

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: 'partner_monthly', userId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Erreur paiement.");

      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err: any) {
      setError("Erreur lors de l'envoi. Vérifiez l'adresse email.");
    }
    setIsLoading(false);
  };

  // Status screen (after login, shows partner status)
  if (view === 'status') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black p-4">
        <Card className="w-full max-w-md bg-[#0a111a] border-cyan-900/50">
          <CardContent className="pt-8 pb-8 space-y-6">
            {partnerStatus === 'no_partner' && (
              <div className="text-center space-y-4">
                <ShieldAlert className="h-14 w-14 text-orange-400 mx-auto" />
                <h2 className="text-xl font-bold text-white">Compte non partenaire</h2>
                <p className="text-sm text-white/50">
                  Ce compte n&apos;est pas enregistré comme partenaire. Faites une demande pour rejoindre le réseau Spordateur.
                </p>
                <Button asChild className="w-full bg-cyan-600 hover:bg-cyan-500 text-black font-bold">
                  <Link href="/partner/register">Devenir partenaire</Link>
                </Button>
              </div>
            )}

            {partnerStatus === 'needs_payment' && (
              <div className="text-center space-y-4">
                <CreditCard className="h-14 w-14 text-yellow-400 mx-auto" />
                <h2 className="text-xl font-bold text-white">Abonnement requis</h2>
                <p className="text-sm text-white/50">
                  Bienvenue <strong className="text-white">{partnerName}</strong>. Pour activer votre compte partenaire, veuillez souscrire à l&apos;abonnement mensuel.
                </p>
                <div className="bg-[#D91CD2]/10 border border-[#D91CD2]/30 rounded-xl p-4">
                  <p className="text-2xl font-light text-white">49 <span className="text-sm text-white/50">CHF/mois</span></p>
                </div>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button onClick={handlePayNow} disabled={isLoading} className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-bold h-12">
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Payer l&apos;abonnement
                </Button>
              </div>
            )}

            {partnerStatus === 'pending_approval' && (
              <div className="text-center space-y-4">
                <AlertTriangle className="h-14 w-14 text-amber-400 mx-auto" />
                <h2 className="text-xl font-bold text-amber-400">En attente de validation</h2>
                <p className="text-sm text-white/50">
                  Votre abonnement est actif. L&apos;administrateur doit maintenant valider votre compte <strong className="text-white">{partnerName}</strong> pour vous donner accès au portail partenaire.
                </p>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-left space-y-2">
                  <p className="text-sm text-green-400 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Abonnement payé
                  </p>
                  <p className="text-sm text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Validation admin en cours...
                  </p>
                </div>
                <Button onClick={() => router.push('/')} variant="outline" className="w-full border-gray-700 text-gray-400">
                  Retour à l&apos;accueil
                </Button>
              </div>
            )}

            {partnerStatus === 'cancelled' && (
              <div className="text-center space-y-4">
                <ShieldAlert className="h-14 w-14 text-red-400 mx-auto" />
                <h2 className="text-xl font-bold text-red-400">Abonnement annulé</h2>
                <p className="text-sm text-white/50">
                  Votre abonnement partenaire a été annulé. Renouvelez-le pour retrouver l&apos;accès.
                </p>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button onClick={handlePayNow} disabled={isLoading} className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-bold h-12">
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Renouveler l&apos;abonnement
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Forgot password view
  if (view === 'forgot') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black p-4">
        <Card className="w-full max-w-md bg-[#0a111a] border-cyan-900/50">
          <CardHeader>
            <CardTitle className="text-white">Réinitialisation Mot de passe</CardTitle>
            <p className="text-sm text-white/50">Recevez un lien sécurisé par email.</p>
          </CardHeader>
          <CardContent>
            {resetSent ? (
              <div className="text-center space-y-4">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                <p className="text-green-400">Un lien a été envoyé à <strong>{email}</strong>.</p>
                <Button onClick={() => { setView('login'); setResetSent(false); }} className="w-full bg-gray-800">
                  Retour connexion
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <Input
                  type="email"
                  placeholder="Votre email professionnel"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="bg-black/50 border-gray-700 text-white"
                />
                <Button disabled={isLoading} type="submit" className="w-full bg-cyan-600">
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : null} Envoyer le lien
                </Button>
                <Button type="button" variant="ghost" onClick={() => setView('login')} className="w-full text-gray-400">
                  Annuler
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Login form
  return (
    <div className="flex items-center justify-center min-h-screen bg-black p-4">
      <Card className="w-full max-w-md bg-[#0a111a] border-cyan-900/50 shadow-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto bg-cyan-900/20 p-3 rounded-full w-fit mb-4">
            <Building className="h-8 w-8 text-cyan-400" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">Espace Partenaire</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="space-y-2">
              <Label className="text-gray-300">Email Professionnel</Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="bg-black/50 border-gray-700 text-white focus:border-cyan-500"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300">Mot de passe</Label>
                <button type="button" onClick={() => setView('forgot')} className="text-xs text-cyan-400 hover:underline">
                  Mot de passe oublié ?
                </button>
              </div>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="bg-black/50 border-gray-700 text-white focus:border-cyan-500"
              />
            </div>
            <Button disabled={isLoading} type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-black font-bold">
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : <Lock className="mr-2 h-4 w-4" />} Se connecter
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center border-t border-gray-800 pt-6">
          <div className="text-sm text-gray-400">
            Pas encore partenaire ? <Link href="/partner/register" className="text-cyan-400 hover:underline">Faites une demande ici</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
