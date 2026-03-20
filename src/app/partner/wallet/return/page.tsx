"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function StripeConnectReturnPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const accountId = searchParams.get('account');
    const partnerId = searchParams.get('partnerId');

    if (!accountId) {
      setStatus('error');
      setMessage('Paramètres manquants.');
      return;
    }

    const verifyAndSave = async () => {
      try {
        // Verify account status
        const res = await fetch(`/api/stripe-connect?accountId=${accountId}&action=status`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        // Save to Firestore partner doc
        if (db && partnerId) {
          await updateDoc(doc(db, 'partners', partnerId), {
            stripeAccountId: accountId,
            stripeChargesEnabled: data.chargesEnabled || false,
            stripePayoutsEnabled: data.payoutsEnabled || false,
            stripeDetailsSubmitted: data.detailsSubmitted || false,
            bankConnectedAt: new Date(),
          });
        } else if (db && user?.uid) {
          // Fallback: try with user uid as partner id
          try {
            await updateDoc(doc(db, 'partners', user.uid), {
              stripeAccountId: accountId,
              stripeChargesEnabled: data.chargesEnabled || false,
              stripePayoutsEnabled: data.payoutsEnabled || false,
              stripeDetailsSubmitted: data.detailsSubmitted || false,
              bankConnectedAt: new Date(),
            });
          } catch { /* partner doc might not use uid as id */ }
        }

        if (data.detailsSubmitted) {
          setStatus('success');
          setMessage('Votre compte bancaire est connecté avec succès.');
        } else {
          setStatus('error');
          setMessage('L\'inscription Stripe n\'est pas terminée. Veuillez réessayer.');
        }
      } catch (err: any) {
        console.error('[Stripe Return]', err);
        setStatus('error');
        setMessage(err.message || 'Erreur lors de la vérification.');
      }
    };

    verifyAndSave();
  }, [searchParams, user]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-6">
        {status === 'loading' && (
          <>
            <div className="w-16 h-16 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
            </div>
            <p className="text-white/50 font-light">Vérification de votre compte...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <div>
              <h2 className="text-xl font-extralight text-white mb-2">Compte connecté</h2>
              <p className="text-white/40 font-light text-sm">{message}</p>
            </div>
            <Button
              onClick={() => router.push('/partner/wallet')}
              className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white rounded-full h-12 px-8 font-light"
            >
              Retour au portefeuille
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-extralight text-white mb-2">Problème de connexion</h2>
              <p className="text-white/40 font-light text-sm">{message}</p>
            </div>
            <Button
              onClick={() => router.push('/partner/wallet')}
              className="bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-full h-12 px-8 font-light"
            >
              Réessayer
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
