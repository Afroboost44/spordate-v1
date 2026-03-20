"use client";

import { useState } from 'react';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { createUserWithEmailAndPassword, updateProfile, signInWithEmailAndPassword } from 'firebase/auth';
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

  // Verify secret from URL
  const isAuthorized = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('secret') === 'spordate2026';

  const createTestPartner = async () => {
    if (!auth || !db || !isFirebaseConfigured) {
      setError('Firebase non configuré');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('Création du compte Firebase Auth...');

    try {
      // 1. Create Firebase Auth account
      let uid: string;
      try {
        const cred = await createUserWithEmailAndPassword(auth, 'bassicustomshoes@gmail.com', 'Afroboost2026!');
        await updateProfile(cred.user, { displayName: 'Afroboost' });
        uid = cred.user.uid;
        setStatus('Compte Auth créé ✓');
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          // Already exists, sign in instead
          setStatus('Compte existe déjà, connexion...');
          const cred = await signInWithEmailAndPassword(auth, 'bassicustomshoes@gmail.com', 'Afroboost2026!');
          uid = cred.user.uid;
          setStatus('Connecté au compte existant ✓');
        } else {
          throw authErr;
        }
      }

      // 2. Create partner document
      setStatus('Création du document partenaire...');
      const partnerId = `partner-${uid}`;
      await setDoc(doc(db, 'partners', partnerId), {
        partnerId,
        name: 'Afroboost',
        email: 'bassicustomshoes@gmail.com',
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

      // 3. Create/update user document with partner role
      setStatus('Mise à jour du profil utilisateur...');
      await setDoc(doc(db, 'users', uid), {
        uid,
        displayName: 'Afroboost',
        email: 'bassicustomshoes@gmail.com',
        role: 'partner',
        city: 'Genève',
        isPremium: false,
        credits: 0,
        createdAt: serverTimestamp(),
      }, { merge: true });

      setStatus('Tout est prêt !');
      setDone(true);
    } catch (err: any) {
      console.error('[Setup Partner]', err);
      setError(err.message || 'Erreur');
    } finally {
      setLoading(false);
    }
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
        <h1 className="text-xl font-semibold text-white mb-6">Créer compte partenaire test</h1>

        <div className="space-y-3 mb-6 text-sm text-white/60">
          <p><span className="text-white/40">Email:</span> <span className="text-white">bassicustomshoes@gmail.com</span></p>
          <p><span className="text-white/40">Mot de passe:</span> <span className="text-white">Afroboost2026!</span></p>
          <p><span className="text-white/40">Nom:</span> <span className="text-white">Afroboost</span></p>
          <p><span className="text-white/40">Statut:</span> <span className="text-green-400">Actif + Approuvé</span></p>
        </div>

        {status && (
          <div className="mb-4 p-3 rounded-lg bg-white/5 text-sm text-white/70">
            {status}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto" />
            <p className="text-green-400 font-medium">Compte partenaire créé !</p>
            <a
              href="/partner/login"
              className="inline-block mt-4 px-6 py-3 bg-[#D91CD2] text-white rounded-full text-sm hover:bg-[#D91CD2]/80 transition"
            >
              Se connecter maintenant →
            </a>
          </div>
        ) : (
          <Button
            onClick={createTestPartner}
            disabled={loading}
            className="w-full h-12 bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white rounded-full"
          >
            {loading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
            Créer le compte partenaire
          </Button>
        )}
      </div>
    </div>
  );
}
