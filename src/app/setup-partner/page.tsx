"use client";

import { useState } from 'react';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { createUserWithEmailAndPassword, updateProfile, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, setDoc, serverTimestamp, GeoPoint } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle } from 'lucide-react';

/**
 * Page temporaire pour créer un compte partenaire test
 * Accès: /setup-partner?secret=spordate2026
 * À SUPPRIMER après utilisation
 */
export default function SetupPartnerPage() {
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isAuthorized = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('secret') === 'spordate2026';

  const createPartnerDoc = async (uid: string, email: string, displayName: string) => {
    if (!db) throw new Error('Firestore non initialisé');

    // Create partner document
    setStatus('Création du document partenaire...');
    const partnerId = `partner-${uid}`;
    await setDoc(doc(db, 'partners', partnerId), {
      partnerId,
      name: displayName,
      email,
      phone: '',
      address: '',
      city: 'Genève',
      canton: 'GE',
      geoPoint: new GeoPoint(46.2044, 6.1432),
      type: 'studio',
      description: 'Studio de danse Afroboost',
      logo: '',
      images: [],
      subscriptionStatus: 'active',
      subscriptionEnd: null,
      monthlyFee: 0,
      promoCode: '',
      referralId: '',
      isApproved: true,
      isActive: true,
      totalBookings: 0,
      totalRevenue: 0,
      rating: 0,
      reviewCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setStatus('Document partenaire créé ✓');

    // Create/update user document
    setStatus('Mise à jour du profil utilisateur...');
    await setDoc(doc(db, 'users', uid), {
      uid,
      displayName,
      email,
      role: 'partner',
      city: 'Genève',
      isPremium: false,
      credits: 0,
      createdAt: serverTimestamp(),
    }, { merge: true });

    setStatus('Tout est prêt !');
    setDone(true);
  };

  const handleEmailSetup = async () => {
    if (!auth || !db || !isFirebaseConfigured) { setError('Firebase non configuré'); return; }
    setLoading(true);
    setError('');
    setStatus('Création du compte...');

    try {
      let uid: string;
      try {
        const cred = await createUserWithEmailAndPassword(auth, 'bassicustomshoes@gmail.com', 'Afroboost2026!');
        await updateProfile(cred.user, { displayName: 'Afroboost' });
        uid = cred.user.uid;
        setStatus('Compte Auth créé ✓');
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          setStatus('Compte existe déjà, connexion...');
          const cred = await signInWithEmailAndPassword(auth, 'bassicustomshoes@gmail.com', 'Afroboost2026!');
          uid = cred.user.uid;
          setStatus('Connecté ✓');
        } else { throw authErr; }
      }
      await createPartnerDoc(uid, 'bassicustomshoes@gmail.com', 'Afroboost');
    } catch (err: any) {
      console.error('[Setup Partner]', err);
      setError(err.message || 'Erreur');
    } finally { setLoading(false); }
  };

  const handleGoogleSetup = async () => {
    if (!auth || !db || !isFirebaseConfigured) { setError('Firebase non configuré'); return; }
    setLoading(true);
    setError('');
    setStatus('Connexion Google...');

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      setStatus(`Connecté en tant que ${user.email} ✓`);
      await createPartnerDoc(user.uid, user.email || '', user.displayName || 'Afroboost');
    } catch (err: any) {
      console.error('[Setup Partner Google]', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Erreur');
      }
    } finally { setLoading(false); }
  };

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/40">Accès non autorisé</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold text-white mb-2">Créer compte partenaire test</h1>
        <p className="text-sm text-white/40 mb-6">Choisissez une méthode de connexion</p>

        {status && (
          <div className="mb-4 p-3 rounded-lg bg-white/5 text-sm text-white/70">{status}</div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{error}</div>
        )}

        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto" />
            <p className="text-green-400 font-medium">Compte partenaire créé !</p>
            <a href="/partner/login"
              className="inline-block mt-4 px-6 py-3 bg-[#D91CD2] text-white rounded-full text-sm hover:bg-[#D91CD2]/80 transition">
              Se connecter maintenant →
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Google — recommended */}
            <Button onClick={handleGoogleSetup} disabled={loading}
              className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-light text-base rounded-full flex items-center justify-center gap-3">
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : (
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Continuer avec Google (recommandé)
            </Button>

            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/20">ou</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Email/Password */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
              <p className="text-white/60"><span className="text-white/30">Email:</span> bassicustomshoes@gmail.com</p>
              <p className="text-white/60"><span className="text-white/30">Mot de passe:</span> Afroboost2026!</p>
            </div>
            <Button onClick={handleEmailSetup} disabled={loading}
              className="w-full h-12 bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white rounded-full">
              {loading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              Créer avec email/mot de passe
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
