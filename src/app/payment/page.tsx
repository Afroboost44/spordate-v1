"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Zap, Crown, Rocket, Lock, CreditCard, Smartphone, Apple, Loader2, ArrowLeft, Gift, Star } from "lucide-react";
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

interface CreditPackage {
  id: string;
  credits: number;
  price: number;
  pricePerCredit: number;
  savings?: string;
  badge?: string;
  color: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

const PACKAGES: CreditPackage[] = [
  {
    id: '1_date',
    credits: 1,
    price: 10,
    pricePerCredit: 10,
    title: 'Starter',
    subtitle: 'Idéal pour tester',
    color: 'from-emerald-500 to-teal-500',
    icon: <Zap className="h-6 w-6" />,
    features: [
      '1 crédit = 1 date sportif',
      'Accès à toutes les activités',
      'Débloque la conversation',
    ],
    cta: 'Commencer',
  },
  {
    id: '3_dates',
    credits: 3,
    price: 25,
    pricePerCredit: 8.33,
    savings: '15%',
    badge: 'Populaire',
    title: 'Populaire',
    subtitle: 'Multiplie les rencontres',
    color: 'from-[#D91CD2] to-[#E91E63]',
    icon: <Star className="h-6 w-6" />,
    features: [
      '3 crédits = 3 dates',
      'Économise 15%',
      'Accès prioritaire Afroboost & Zumba',
      'Offre la plus choisie',
    ],
    cta: 'Choisir cette offre',
    popular: true,
  },
  {
    id: '10_dates',
    credits: 10,
    price: 60,
    pricePerCredit: 6,
    savings: '40%',
    badge: 'Meilleur prix',
    title: 'Premium',
    subtitle: 'Passe à l\'action',
    color: 'from-amber-500 to-orange-500',
    icon: <Rocket className="h-6 w-6" />,
    features: [
      '10 crédits = 10 dates',
      'Économise jusqu\'à 40%',
      'Accès prioritaire + suggestions',
      'Expérience complète',
    ],
    cta: 'Passer au Premium',
  },
];

export default function PaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { width, height } = useWindowSize();
  const { user, isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (searchParams.get('status') === 'success') {
      setPaymentSuccess(true);
      setShowConfetti(true);
    }
  }, [searchParams]);

  const selectedPkg = PACKAGES.find(p => p.id === selectedId);

  const handlePayment = async (pkg: CreditPackage) => {
    if (!isLoggedIn || !user) {
      router.push('/login?redirect=/payment');
      return;
    }

    setSelectedId(pkg.id);
    setLoading(true);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id, userId: user.uid }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erreur');
      if (data.url) window.location.href = data.url;
    } catch (error) {
      console.error('Payment error:', error);
      setLoading(false);
    }
  };

  // Success screen
  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        {showConfetti && <Confetti width={width} height={height} />}
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-green-500/20 rounded-full blur-2xl animate-pulse" />
            <CheckCircle className="h-20 w-20 text-green-400 relative z-10" />
          </div>
          <h1 className="text-3xl font-light text-white">Paiement confirmé !</h1>
          <p className="text-white/40">Vos crédits ont été ajoutés à votre compte.</p>
          <Button
            onClick={() => router.push(`/share?sport=Sport+Date`)}
            className="w-full h-14 bg-gradient-to-r from-[#D91CD2] to-[#E91E63] text-white rounded-full"
          >
            Partager mon Sport Date
          </Button>
          <Link href="/discovery" className="block text-sm text-white/30 hover:text-white/50">
            Retour aux profils
          </Link>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-[#D91CD2] animate-spin mx-auto mb-4" />
          <p className="text-white/40">Redirection vers le paiement sécurisé...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pb-20 md:pb-0">
      {/* Back button */}
      <div className="sticky top-0 z-40 bg-black/80 backdrop-blur-xl border-b border-white/5 px-4 h-12 flex items-center">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition">
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 md:py-16">
        {/* Header */}
        <div className="text-center mb-10 md:mb-14">
          <p className="text-xs text-[#D91CD2] uppercase tracking-[0.3em] mb-3">Crédits Sport Date</p>
          <h1 className="text-3xl md:text-5xl font-light text-white tracking-tight mb-3">
            Trouve ton match.<br />Bouge ensemble.
          </h1>
          <p className="text-white/40 text-sm max-w-md mx-auto">
            Chaque crédit débloque un date sportif. Pas de discussion inutile, des rencontres réelles.
          </p>
        </div>

        {/* Packages */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 mb-12">
          {PACKAGES.map((pkg) => (
            <Card
              key={pkg.id}
              className={`relative overflow-hidden transition-all duration-300 cursor-pointer group ${
                pkg.popular
                  ? 'bg-[#1A1A1A] border-[#D91CD2]/40 shadow-lg shadow-[#D91CD2]/10 md:scale-105'
                  : 'bg-[#111] border-white/5 hover:border-white/15'
              }`}
              onClick={() => setSelectedId(pkg.id)}
            >
              {/* Badge */}
              {pkg.badge && (
                <div className="absolute -top-0 right-0">
                  <span className={`inline-block px-3 py-1 text-[10px] font-bold text-white uppercase tracking-wider rounded-bl-xl bg-gradient-to-r ${pkg.color}`}>
                    {pkg.badge}
                  </span>
                </div>
              )}

              <CardContent className="p-6 md:p-7">
                {/* Icon + Title */}
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${pkg.color} flex items-center justify-center text-white mb-5`}>
                  {pkg.icon}
                </div>
                <h3 className="text-lg font-medium text-white mb-0.5">{pkg.title}</h3>
                <p className="text-xs text-white/30 mb-5">{pkg.subtitle}</p>

                {/* Price */}
                <div className="flex items-baseline gap-1 mb-5">
                  <span className="text-4xl font-light text-white">{pkg.price}</span>
                  <span className="text-sm text-white/40">CHF</span>
                  {pkg.savings && (
                    <span className="ml-2 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                      -{pkg.savings}
                    </span>
                  )}
                </div>

                {/* Features */}
                <div className="space-y-2.5 mb-6">
                  {pkg.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-white/50">
                      <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePayment(pkg); }}
                  className={`w-full h-12 rounded-full font-light text-sm tracking-wider uppercase flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                    pkg.popular
                      ? `bg-gradient-to-r ${pkg.color} text-white shadow-lg shadow-[#D91CD2]/20`
                      : 'bg-white/5 backdrop-blur-xl border border-white/10 text-white hover:bg-white/10'
                  }`}
                >
                  {pkg.cta}
                </button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Trust badges */}
        <div className="text-center space-y-3 mb-12">
          <div className="flex items-center justify-center gap-6 text-xs text-white/30">
            <span className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Carte</span>
            <span className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> TWINT</span>
            <span className="flex items-center gap-1.5"><Apple className="h-3.5 w-3.5" /> Apple Pay</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-white/20">
            <Lock className="h-3 w-3" />
            <span>Paiement sécurisé par Stripe — Activation instantanée</span>
          </div>
        </div>

        {/* Bonus section */}
        <div className="max-w-md mx-auto">
          <Card className="bg-[#D91CD2]/5 border-[#D91CD2]/15">
            <CardContent className="p-5 flex items-center gap-4">
              <Gift className="h-8 w-8 text-[#D91CD2] flex-shrink-0" />
              <div>
                <p className="text-sm text-white font-medium">Invite un ami = crédits offerts</p>
                <p className="text-xs text-white/30">Partage ton lien de parrainage et gagne des crédits gratuits</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
