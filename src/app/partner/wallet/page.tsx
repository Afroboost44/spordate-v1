"use client";

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Wallet, CreditCard, CheckCircle, AlertCircle,
  Building, ArrowUpRight, TrendingUp, Clock, Loader2, ExternalLink
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';

export default function PartnerWalletPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [partnerData, setPartnerData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(true);

  const isConnected = !!partnerData?.stripeAccountId && partnerData?.stripeDetailsSubmitted;

  // Load partner data from Firestore
  useEffect(() => {
    if (!user?.uid || !db) { setLoadingData(false); return; }

    const loadPartner = async () => {
      try {
        // Try direct doc by uid
        const docSnap = await getDoc(doc(db, 'partners', user.uid));
        if (docSnap.exists()) {
          setPartnerData({ id: docSnap.id, ...docSnap.data() });
          setLoadingData(false);
          return;
        }
        // Fallback: query by email
        const q = query(collection(db, 'partners'), where('email', '==', user.email), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          setPartnerData({ id: d.id, ...d.data() });
        }
      } catch (err) {
        console.error('[Wallet] Error loading partner:', err);
      }
      setLoadingData(false);
    };

    loadPartner();
  }, [user]);

  const handleConnectStripe = async () => {
    if (!user?.email || !partnerData?.id) {
      toast({ title: "Erreur", description: "Données partenaire introuvables.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/stripe-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: partnerData.id,
          email: user.email,
          name: partnerData.name || user.displayName || '',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Redirect to Stripe onboarding
      window.location.href = data.onboardingUrl;
    } catch (err: any) {
      console.error('[Stripe Connect]', err);
      toast({
        title: "Erreur de connexion",
        description: err.message || "Impossible de lancer la connexion bancaire.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleOpenDashboard = async () => {
    if (!partnerData?.stripeAccountId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/stripe-connect?accountId=${partnerData.stripeAccountId}&action=dashboard`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.open(data.dashboardUrl, '_blank');
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err.message || "Impossible d'ouvrir le tableau de bord Stripe.",
        variant: "destructive",
      });
    }
    setIsLoading(false);
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extralight tracking-tight">
          Mon Portefeuille
        </h1>
        <p className="text-white/40 font-light mt-1">
          Gérez vos revenus et coordonnées bancaires.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-[#D91CD2]" />
            </div>
            <span className="text-xs text-white/30 uppercase tracking-wider font-light">Solde disponible</span>
          </div>
          <p className="text-3xl font-extralight text-white">0.00 <span className="text-base text-white/30">CHF</span></p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <span className="text-xs text-white/30 uppercase tracking-wider font-light">Revenus totaux</span>
          </div>
          <p className="text-3xl font-extralight text-white">0.00 <span className="text-base text-white/30">CHF</span></p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <ArrowUpRight className="h-5 w-5 text-purple-400" />
            </div>
            <span className="text-xs text-white/30 uppercase tracking-wider font-light">Virements effectués</span>
          </div>
          <p className="text-3xl font-extralight text-white">0</p>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Bank connection card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#D91CD2]/10 border border-[#D91CD2]/20 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-[#D91CD2]" />
            </div>
            <div>
              <h3 className="text-base font-light text-white">Compte bancaire</h3>
              <p className="text-xs text-white/30 font-light">Connexion sécurisée via Stripe</p>
            </div>
          </div>

          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-500/5 border border-green-500/10 rounded-xl">
                <CheckCircle className="h-6 w-6 text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-green-400 font-light">Compte actif</p>
                  <p className="text-xs text-white/30 font-light">
                    {partnerData.stripePayoutsEnabled
                      ? 'Virements activés — vous pouvez recevoir des paiements'
                      : 'En cours de vérification par Stripe'}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleOpenDashboard}
                disabled={isLoading}
                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 font-light rounded-full h-11 text-sm"
              >
                {isLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                Ouvrir mon tableau de bord Stripe
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-yellow-500/5 border border-yellow-500/10 rounded-xl">
                <AlertCircle className="h-4 w-4 text-yellow-400 flex-shrink-0" />
                <p className="text-sm text-yellow-400/80 font-light">
                  Connectez votre banque pour recevoir vos revenus.
                </p>
              </div>
              <Button
                onClick={handleConnectStripe}
                disabled={isLoading}
                className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-semibold rounded-full h-12"
              >
                {isLoading ? (
                  <><Loader2 className="animate-spin mr-2 h-4 w-4" /> Connexion en cours...</>
                ) : (
                  <><Building className="mr-2 h-4 w-4" /> Connecter mon compte bancaire</>
                )}
              </Button>
              <p className="text-xs text-center text-white/20 font-light">
                Vous serez redirigé vers Stripe pour une inscription sécurisée.
              </p>
            </div>
          )}
        </div>

        {/* Withdrawal card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <ArrowUpRight className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-base font-light text-white">Demander un virement</h3>
              <p className="text-xs text-white/30 font-light">Transférer votre solde vers votre banque</p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-xl p-5 text-center space-y-3">
            <p className="text-4xl font-extralight text-white">0.00 <span className="text-lg text-white/30">CHF</span></p>
            <p className="text-xs text-white/20 font-light">Solde disponible pour retrait</p>
          </div>

          <Button
            disabled={!isConnected}
            className={`w-full rounded-full h-12 font-light ${
              isConnected
                ? 'bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white'
                : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
            }`}
          >
            {isConnected ? 'Demander un virement' : 'Connectez votre banque d\'abord'}
          </Button>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h3 className="text-base font-light text-white mb-4">Historique des transactions</h3>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-white/5 border border-white/5 flex items-center justify-center mb-4">
            <Clock className="h-6 w-6 text-white/20" />
          </div>
          <p className="text-white/30 font-light text-sm">Aucune transaction pour le moment</p>
          <p className="text-white/15 font-light text-xs mt-1">
            Les transactions apparaîtront ici quand vous recevrez des paiements.
          </p>
        </div>
      </div>
    </div>
  );
}
