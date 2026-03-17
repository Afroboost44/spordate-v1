"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, Lock, CheckCircle, Smartphone, Apple, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { useAuth } from '@/context/AuthContext';

const ApplePayIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.3-3.14-2.53C4.3 17.68 3 13.75 4.7 10.97c.85-1.48 2.45-2.41 4.05-2.54 1.27-.08 2.46.88 3.25.88.78 0 2.33-1.1 3.92-.92 1.83.23 3.55 1.23 4.37 2.53-2.59 1.59-4.27 4.77-2.25 7.65z"/><path d="M12.03 5.26c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
  </svg>
);

const TWINTIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" opacity="0.7"/>
    <text x="12" y="15" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">TWINT</text>
  </svg>
);

interface CreditPackage {
  id: string;
  dates: number;
  price: number;
  badge?: string;
  description: string;
}

const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'test_1chf',
    dates: 1,
    price: 1,
    badge: 'TEST',
    description: 'Test 1 CHF'
  },
  {
    id: '1_date',
    dates: 1,
    price: 10,
    description: '1 Sport Date'
  },
  {
    id: '3_dates',
    dates: 3,
    price: 25,
    badge: 'Most Popular',
    description: '3 Sport Dates'
  },
  {
    id: '10_dates',
    dates: 10,
    price: 60,
    badge: 'Best Value',
    description: '10 Sport Dates'
  }
];

export default function PaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { width, height } = useWindowSize();
  const { user, isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Check for success/cancel from URL params
  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'success') {
      setPaymentSuccess(true);
      setShowConfetti(true);
    }
  }, [searchParams]);

  const handlePayment = async () => {
    if (!selectedPackage) return;

    if (!isLoggedIn || !user) {
      router.push('/login?redirect=/payment');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: selectedPackage.id,
          userId: user.uid,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du paiement');
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Payment error:', error);
      setLoading(false);
    }
  };

  // Success screen with confetti
  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 overflow-hidden">
        {showConfetti && <Confetti width={width} height={height} />}

        <Card className="w-full max-w-md bg-zinc-900/80 border-green-500/30 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-green-500/20 rounded-full blur-xl animate-pulse" />
                <CheckCircle className="h-24 w-24 text-green-400 relative z-10" />
              </div>
            </div>
            <CardTitle className="text-3xl font-bold text-white mb-2">Paiement confirmé ! 🎉</CardTitle>
            <CardDescription className="text-base text-gray-300">
              Merci ! Vos crédits Sport Date ont été ajoutés à votre compte.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-300">Crédits achetés :</span>
                <span className="text-2xl font-bold text-green-400">{selectedPackage?.dates}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Total payé :</span>
                <span className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400">
                  {selectedPackage?.price} CHF
                </span>
              </div>
            </div>

            <Separator className="bg-white/10" />

            <div className="bg-zinc-900/50 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-2">Vous pouvez maintenant :</p>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Naviguer tous les profils disponibles
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Envoyer des messages à vos matchs
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Réserver vos Sport Dates
                </li>
              </ul>
            </div>

            <Button
              size="lg"
              className="w-full bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold text-lg py-6 hover:from-green-600 hover:to-emerald-600 transition-all shadow-lg shadow-green-500/30"
              onClick={() => router.push('/discover')}
            >
              Découvrir les profils
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-r from-[#D91CD2] to-[#E91E63] rounded-full animate-spin" />
            <div className="absolute inset-2 bg-black rounded-full" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Traitement sécurisé en cours...</h2>
          <p className="text-gray-400">Veuillez ne pas quitter cette page.</p>
        </div>
      </div>
    );
  }

  // Main payment page
  return (
    <div className="min-h-screen bg-black p-4 py-12">
      <div className="container mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-light text-white mb-2">Achetez des crédits</h1>
          <p className="text-gray-400 text-lg">Chaque crédit = 1 Sport Date. Connectez-vous avec d'autres passionnés de sport.</p>
        </div>

        {/* Package Selection Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {CREDIT_PACKAGES.map((pkg) => (
            <div
              key={pkg.id}
              onClick={() => setSelectedPackage(pkg)}
              className={`relative cursor-pointer transition-all duration-300 transform hover:scale-105 ${
                selectedPackage?.id === pkg.id ? 'scale-105' : ''
              }`}
            >
              {/* Badge */}
              {pkg.badge && (
                <div className="absolute -top-3 left-4 z-10">
                  <span className={`inline-block px-4 py-1 rounded-full text-xs font-bold text-white ${
                    pkg.badge === 'Most Popular'
                      ? 'bg-gradient-to-r from-[#D91CD2] to-[#E91E63] shadow-lg shadow-[#D91CD2]/50'
                      : 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg shadow-amber-500/50'
                  }`}>
                    {pkg.badge}
                  </span>
                </div>
              )}

              {/* Card */}
              <Card className={`h-full transition-all duration-300 ${
                selectedPackage?.id === pkg.id
                  ? 'bg-zinc-900/80 border-[#D91CD2]/50 shadow-2xl shadow-[#D91CD2]/20'
                  : 'bg-zinc-900/50 border-white/10 hover:border-white/20'
              } backdrop-blur border`}>
                <CardHeader className="text-center pb-3 pt-6">
                  <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#D91CD2] to-[#E91E63] mb-2">
                    {pkg.dates}
                  </div>
                  <CardTitle className="text-xl text-gray-200">{pkg.description}</CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <Separator className="bg-white/10" />
                  <div>
                    <p className="text-gray-400 text-sm mb-2">Prix</p>
                    <p className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#D91CD2] to-[#E91E63]">
                      {pkg.price} CHF
                    </p>
                  </div>
                  <Separator className="bg-white/10" />
                  <div className="text-sm text-gray-400 space-y-1">
                    <p>• Utilisation illimitée</p>
                    <p>• Sans expiration</p>
                    <p>• Annulation facile</p>
                  </div>
                  <Button
                    variant={selectedPackage?.id === pkg.id ? 'default' : 'outline'}
                    className={`w-full mt-4 transition-all ${
                      selectedPackage?.id === pkg.id
                        ? 'bg-gradient-to-r from-[#D91CD2] to-[#E91E63] text-white border-0'
                        : 'border-white/10 text-gray-300 hover:text-white'
                    }`}
                  >
                    {selectedPackage?.id === pkg.id ? '✓ Sélectionné' : 'Sélectionner'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>

        {/* Divider */}
        {selectedPackage && <Separator className="bg-white/10 my-8" />}

        {/* Payment Methods */}
        {selectedPackage && (
          <div className="mt-8">
            <Card className="bg-zinc-900/50 border-white/10 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-2xl text-white">Moyen de paiement</CardTitle>
                <CardDescription>Choisissez comment vous souhaitez payer</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Stripe Checkout — handles Card, TWINT, Apple Pay */}
                <Button
                  onClick={() => handlePayment()}
                  disabled={loading}
                  className="w-full justify-center h-16 text-base bg-gradient-to-r from-[#D91CD2] to-[#E91E63] text-white font-semibold hover:from-[#C91BC2] hover:to-[#D91D53] transition-all shadow-lg shadow-[#D91CD2]/30"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <CreditCard className="mr-3 h-5 w-5" />
                  )}
                  {loading ? 'Redirection...' : `Payer ${selectedPackage.price} CHF`}
                </Button>

                <div className="flex items-center justify-center gap-4 text-xs text-gray-500 mt-2">
                  <span className="flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> Carte</span>
                  <span className="flex items-center gap-1"><Smartphone className="h-3.5 w-3.5" /> TWINT</span>
                  <span className="flex items-center gap-1"><Apple className="h-3.5 w-3.5" /> Apple Pay</span>
                </div>

                {/* Security Info */}
                <div className="mt-6 p-4 bg-zinc-900/50 rounded-lg border border-white/10">
                  <div className="flex items-start gap-3">
                    <Lock className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-green-400">Paiement 100% sécurisé</p>
                      <p className="text-xs text-gray-400 mt-1">Vos informations de paiement sont chiffrées. Aucun stockage de données sensibles.</p>
                      <p className="text-xs text-gray-500 mt-2">Certifié PCI DSS Level 1</p>
                    </div>
                  </div>
                </div>

                {/* Terms */}
                <p className="text-xs text-center text-gray-500 mt-6">
                  En effectuant ce paiement, vous acceptez nos conditions de service et notre politique de confidentialité.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Fallback message */}
        {!selectedPackage && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">Sélectionnez un package pour continuer</p>
          </div>
        )}
      </div>
    </div>
  );
}
