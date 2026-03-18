"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Crown, Zap, MessageCircle, Star, Shield, Eye,
  CheckCircle, Sparkles, ArrowRight, Loader2, ArrowLeft
} from "lucide-react";
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { useAuth } from '@/context/AuthContext';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

// Visual config (icons, features) — fixed, not admin-editable
const PLAN_VISUALS: Record<string, { features: { icon: any; text: string; highlight: boolean }[] }> = {
  'premium_monthly': {
    features: [
      { icon: Zap, text: 'Matching illimité', highlight: true },
      { icon: Eye, text: 'Profil mis en avant', highlight: false },
      { icon: MessageCircle, text: 'Chat illimité', highlight: false },
      { icon: Shield, text: 'Sans publicité', highlight: false },
    ],
  },
  'premium_yearly': {
    features: [
      { icon: Zap, text: 'Matching illimité', highlight: true },
      { icon: Eye, text: 'Profil mis en avant', highlight: false },
      { icon: MessageCircle, text: 'Chat illimité', highlight: false },
      { icon: Shield, text: 'Sans publicité', highlight: false },
      { icon: Crown, text: 'Badge exclusif', highlight: true },
    ],
  },
};

// Default pricing — overridden by Firestore
const DEFAULT_PLANS = [
  { id: 'premium_monthly', name: 'Premium Mensuel', price: 19.90, interval: 'mois', credits: 5, badge: null as string | null },
  { id: 'premium_yearly', name: 'Premium Annuel', price: 149, interval: 'an', credits: 60, badge: 'Économisez 37%' as string | null },
];

export default function PremiumPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { width, height } = useWindowSize();
  const { user, userProfile, isLoggedIn, loading: authLoading } = useAuth();

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState(DEFAULT_PLANS);

  // Load pricing from Firestore (admin-editable)
  useEffect(() => {
    const loadPricing = async () => {
      if (!db || !isFirebaseConfigured) return;
      try {
        const { doc: firestoreDoc, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(firestoreDoc(db, 'settings', 'pricing'));
        if (snap.exists()) {
          const packages = snap.data()?.packages as Record<string, any> || {};
          setPlans(prev => prev.map(p => {
            const saved = packages[p.id];
            if (!saved) return p;
            return {
              ...p,
              name: saved.label || p.name,
              price: saved.priceCHF ?? (saved.price ? saved.price / 100 : p.price),
              credits: saved.credits ?? p.credits,
            };
          }).filter(p => {
            const saved = packages[p.id];
            return !saved || saved.isActive !== false;
          }));
        }
      } catch { /* use defaults */ }
    };
    loadPricing();
  }, []);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'success') {
      setSuccess(true);
      setShowConfetti(true);
    }
  }, [searchParams]);

  const handleSubscribe = async (planId: string) => {
    if (!isLoggedIn || !user) {
      router.push('/login?redirect=/premium');
      return;
    }

    setLoading(true);
    setSelectedPlan(planId);
    setError(null);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: planId,
          userId: user.uid,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la création du paiement');
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('[Premium] Erreur:', err);
      setError(err instanceof Error ? err.message : 'Erreur serveur');
      setLoading(false);
      setSelectedPlan(null);
    }
  };

  // Already premium
  const isPremium = userProfile?.isPremium;

  // Success screen
  if (success) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 overflow-hidden">
        {showConfetti && <Confetti width={width} height={height} colors={['#D91CD2', '#7B1FA2', '#E91E63', '#FFD700']} />}

        <Card className="w-full max-w-md bg-gradient-to-br from-zinc-900 to-black border-[#D91CD2]/30 shadow-2xl shadow-[#D91CD2]/20">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-[#D91CD2]/20 rounded-full blur-xl animate-pulse" />
                <Crown className="h-24 w-24 text-[#D91CD2] relative z-10" />
              </div>
            </div>
            <CardTitle className="text-3xl font-light text-white mb-2">
              Bienvenue dans le Premium
            </CardTitle>
            <p className="text-base text-gray-400 font-light">
              Votre abonnement est activé. Profitez du matching illimité !
            </p>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <div className="bg-[#D91CD2]/5 border border-[#D91CD2]/20 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-[#D91CD2]" />
                <span className="text-gray-300 font-light">Matching illimité activé</span>
              </div>
              <div className="flex items-center gap-3">
                <Star className="h-5 w-5 text-[#D91CD2]" />
                <span className="text-gray-300 font-light">Crédits ajoutés à votre compte</span>
              </div>
              <div className="flex items-center gap-3">
                <Eye className="h-5 w-5 text-[#D91CD2]" />
                <span className="text-gray-300 font-light">Votre profil est maintenant mis en avant</span>
              </div>
            </div>

            <Button
              size="lg"
              className="w-full bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white font-light text-lg py-6 hover:opacity-90 transition-all shadow-lg shadow-[#D91CD2]/30"
              onClick={() => router.push('/discovery')}
            >
              Découvrir les profils
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Back button — visible on mobile AND desktop */}
      <div className="sticky top-0 z-40 bg-black/80 backdrop-blur-xl border-b border-white/5 px-4 h-12 flex items-center">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition">
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#D91CD2]/10 via-transparent to-transparent" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#D91CD2]/5 rounded-full blur-3xl" />

        <div className="relative container mx-auto max-w-5xl px-4 pt-16 pb-12">
          <div className="text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#D91CD2]/30 bg-[#D91CD2]/5">
              <Sparkles className="h-4 w-4 text-[#D91CD2]" />
              <span className="text-sm text-[#D91CD2] font-light">Spordate Premium</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-light text-white tracking-tight">
              Passez au niveau
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2]">
                supérieur
              </span>
            </h1>

            <p className="text-lg text-gray-400 font-light max-w-xl mx-auto">
              Matching illimité, profil mis en avant et crédits mensuels.
              Maximisez vos chances de trouver votre Sport Date idéal.
            </p>
          </div>
        </div>
      </div>

      {/* Already Premium Banner */}
      {isPremium && (
        <div className="container mx-auto max-w-5xl px-4 mb-8">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-[#D91CD2]/30 bg-[#D91CD2]/5">
            <Crown className="h-6 w-6 text-[#D91CD2]" />
            <div>
              <p className="text-white font-light">Vous êtes déjà Premium !</p>
              <p className="text-sm text-gray-400 font-light">Votre abonnement est actif. Profitez de tous les avantages.</p>
            </div>
          </div>
        </div>
      )}

      {/* Plans */}
      <div className="container mx-auto max-w-5xl px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const isYearly = plan.id === 'premium_yearly';
            const visuals = PLAN_VISUALS[plan.id];
            // Build features list with dynamic credits
            const features = [
              ...(visuals?.features || []).slice(0, 1),
              { icon: Star, text: `${plan.credits} crédits / ${plan.interval}`, highlight: true },
              ...(visuals?.features || []).slice(1),
            ];

            return (
              <div key={plan.id} className="relative">
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 px-4 py-1 text-xs font-medium shadow-lg shadow-amber-500/30">
                      {plan.badge}
                    </Badge>
                  </div>
                )}

                <Card className={`h-full transition-all duration-300 ${
                  isYearly
                    ? 'bg-gradient-to-br from-zinc-900 to-black border-[#D91CD2]/40 shadow-xl shadow-[#D91CD2]/10'
                    : 'bg-gradient-to-br from-zinc-900/80 to-black border-zinc-800 hover:border-zinc-700'
                }`}>
                  <CardHeader className="text-center pb-4 pt-8">
                    <div className="flex justify-center mb-4">
                      <div className={`p-3 rounded-2xl ${
                        isYearly ? 'bg-[#D91CD2]/10' : 'bg-zinc-800'
                      }`}>
                        <Crown className={`h-8 w-8 ${
                          isYearly ? 'text-[#D91CD2]' : 'text-gray-400'
                        }`} />
                      </div>
                    </div>
                    <CardTitle className="text-xl font-light text-white">
                      {plan.name}
                    </CardTitle>
                    <div className="mt-4">
                      <span className="text-5xl font-light text-white">
                        {plan.price % 1 === 0 ? plan.price : plan.price.toFixed(2)}
                      </span>
                      <span className="text-gray-400 font-light ml-1">CHF / {plan.interval}</span>
                    </div>
                    {isYearly && (
                      <p className="text-sm text-[#D91CD2] font-light mt-2">
                        soit ~{(plan.price / 12).toFixed(2)} CHF / mois
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-6 pb-8">
                    <div className="space-y-3">
                      {features.map((feature, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className={`p-1 rounded-lg ${
                            feature.highlight ? 'bg-[#D91CD2]/10' : 'bg-zinc-800/50'
                          }`}>
                            <feature.icon className={`h-4 w-4 ${
                              feature.highlight ? 'text-[#D91CD2]' : 'text-gray-500'
                            }`} />
                          </div>
                          <span className={`text-sm font-light ${
                            feature.highlight ? 'text-white' : 'text-gray-400'
                          }`}>
                            {feature.text}
                          </span>
                        </div>
                      ))}
                    </div>

                    {error && selectedPlan === plan.id && (
                      <p className="text-sm text-red-400 text-center font-light">{error}</p>
                    )}

                    <Button
                      size="lg"
                      disabled={loading || isPremium}
                      onClick={() => handleSubscribe(plan.id)}
                      className={`w-full text-base py-6 font-light transition-all ${
                        isYearly
                          ? 'bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white hover:opacity-90 shadow-lg shadow-[#D91CD2]/30'
                          : 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      {loading && selectedPlan === plan.id ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : isPremium ? (
                        <span className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5" />
                          Déjà abonné
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          S&apos;abonner
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>

        {/* Comparison Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-light text-white text-center mb-10">
            Gratuit vs Premium
          </h2>

          <div className="rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="grid grid-cols-3 bg-zinc-900/50 px-6 py-4 border-b border-zinc-800">
              <div className="text-sm text-gray-400 font-light">Fonctionnalité</div>
              <div className="text-sm text-gray-400 font-light text-center">Gratuit</div>
              <div className="text-sm text-[#D91CD2] font-light text-center">Premium</div>
            </div>

            {[
              { feature: 'Matching par sport', free: true, premium: true },
              { feature: 'Profil personnalisé', free: true, premium: true },
              { feature: 'Matching illimité', free: false, premium: true },
              { feature: 'Chat illimité', free: false, premium: true },
              { feature: 'Profil mis en avant', free: false, premium: true },
              { feature: 'Crédits mensuels', free: false, premium: true },
              { feature: 'Sans publicité', free: false, premium: true },
              { feature: 'Badge exclusif', free: false, premium: 'yearly' },
            ].map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 px-6 py-3.5 ${
                  i % 2 === 0 ? 'bg-zinc-900/20' : ''
                } ${i < 7 ? 'border-b border-zinc-800/50' : ''}`}
              >
                <div className="text-sm text-gray-300 font-light">{row.feature}</div>
                <div className="text-center">
                  {row.free ? (
                    <CheckCircle className="h-5 w-5 text-green-400 mx-auto" />
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>
                <div className="text-center">
                  {row.premium === true ? (
                    <CheckCircle className="h-5 w-5 text-[#D91CD2] mx-auto" />
                  ) : row.premium === 'yearly' ? (
                    <span className="text-xs text-[#D91CD2] font-light">Annuel</span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Not logged in CTA */}
        {!authLoading && !isLoggedIn && (
          <div className="mt-16 text-center">
            <p className="text-gray-400 font-light mb-4">
              Créez un compte pour accéder au Premium
            </p>
            <Button
              variant="outline"
              className="border-[#D91CD2]/30 text-[#D91CD2] hover:bg-[#D91CD2]/10"
              onClick={() => router.push('/signup?redirect=/premium')}
            >
              Créer un compte
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Security */}
        <div className="mt-12 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <Shield className="h-4 w-4" />
            <span className="text-xs font-light">Paiement sécurisé par Stripe — TWINT & Carte</span>
          </div>
          <p className="text-xs text-gray-600 font-light">
            Annulation à tout moment. Vos crédits restants sont conservés.
          </p>
        </div>
      </div>
    </div>
  );
}
