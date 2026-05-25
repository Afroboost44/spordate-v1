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
import { useLanguage } from '@/context/LanguageContext';
import { resolveActiveReferralCode } from '@/lib/referral/refStorage';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

// BUG #93 — Visuals des 4 nouveaux plans Premium (PRICING-PROPOSAL.md §5).
// Les 4 paliers partagent les mêmes avantages structurels ; seule la durée
// + le quota de crédits mensuels change. Les visuals listent les avantages
// communs, le rendu y injecte dynamiquement la ligne "X crédits".
// BUG #164 — `text` est désormais une CLÉ i18n (ex: 'premium_feat_likes_24h'),
// pas une string FR. Le rendu fait `t(feature.text)` côté composant pour
// produire FR/EN/DE selon la langue active.
const PLAN_VISUALS: Record<string, { features: { icon: any; text: string; highlight: boolean }[] }> = {
  'premium_24h': {
    features: [
      { icon: Zap, text: 'premium_feat_likes_24h', highlight: true },
      { icon: Eye, text: 'premium_feat_see_likers', highlight: false },
      { icon: Shield, text: 'premium_feat_verified_badge', highlight: false },
    ],
  },
  'premium_week': {
    features: [
      { icon: Zap, text: 'premium_feat_likes_7d', highlight: true },
      { icon: Eye, text: 'premium_feat_see_likers', highlight: false },
      { icon: MessageCircle, text: 'premium_feat_advanced_filters', highlight: false },
      { icon: Shield, text: 'premium_feat_verified_badge', highlight: false },
    ],
  },
  'premium_month': {
    features: [
      { icon: Zap, text: 'premium_feat_likes_unlimited', highlight: true },
      { icon: Eye, text: 'premium_feat_see_likers', highlight: false },
      { icon: MessageCircle, text: 'premium_feat_advanced_filters', highlight: false },
      { icon: Shield, text: 'premium_feat_priority_verif', highlight: false },
      { icon: Star, text: 'premium_feat_boost_monthly', highlight: true },
    ],
  },
  'premium_year': {
    features: [
      { icon: Zap, text: 'premium_feat_likes_unlimited', highlight: true },
      { icon: Eye, text: 'premium_feat_see_likers', highlight: false },
      { icon: MessageCircle, text: 'premium_feat_advanced_filters', highlight: false },
      { icon: Shield, text: 'premium_feat_priority_verif', highlight: false },
      { icon: Star, text: 'premium_feat_boost_monthly', highlight: true },
      { icon: Crown, text: 'premium_feat_loyalty_badge', highlight: true },
    ],
  },
  // Legacy (conservé si Firestore les affiche encore le temps de la migration)
  'premium_monthly': {
    features: [
      { icon: Zap, text: 'premium_feat_legacy_unlimited_match', highlight: true },
      { icon: Eye, text: 'premium_feat_legacy_profile_boost', highlight: false },
      { icon: MessageCircle, text: 'premium_feat_legacy_unlimited_chat', highlight: false },
      { icon: Shield, text: 'premium_feat_legacy_ad_free', highlight: false },
    ],
  },
  'premium_yearly': {
    features: [
      { icon: Zap, text: 'premium_feat_legacy_unlimited_match', highlight: true },
      { icon: Eye, text: 'premium_feat_legacy_profile_boost', highlight: false },
      { icon: MessageCircle, text: 'premium_feat_legacy_unlimited_chat', highlight: false },
      { icon: Shield, text: 'premium_feat_legacy_ad_free', highlight: false },
      { icon: Crown, text: 'premium_feat_legacy_exclusive_badge', highlight: true },
    ],
  },
};

// BUG #93 — Default pricing : 4 paliers Premium (PRICING-PROPOSAL.md §5).
// BUG #164 — name/interval/badge sont des CLÉS i18n (rendues via t()).
const DEFAULT_PLANS = [
  { id: 'premium_24h',   name: 'premium_plan_24h_name',   price: 4.90,   interval: 'premium_interval_24h',  credits: 50,  badge: null as string | null },
  { id: 'premium_week',  name: 'premium_plan_week_name',  price: 14.90,  interval: 'premium_interval_week', credits: 100, badge: null as string | null },
  { id: 'premium_month', name: 'premium_plan_month_name', price: 29.90,  interval: 'premium_interval_month', credits: 200, badge: 'premium_badge_popular' as string | null },
  { id: 'premium_year',  name: 'premium_plan_year_name',  price: 199.90, interval: 'premium_interval_year', credits: 250, badge: 'premium_badge_save_44' as string | null },
];

export default function PremiumPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { width, height } = useWindowSize();
  const { user, userProfile, isLoggedIn, loading: authLoading } = useAuth();
  const { t } = useLanguage();

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
      // Phase A — propage le code de parrainage (priorité user.referredBy >
      // localStorage capture pré-signup) → Stripe metadata → webhook processCommission.
      const referralCode = resolveActiveReferralCode(userProfile?.referredBy);
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: planId,
          userId: user.uid,
          referralCode,
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
        {showConfetti && <Confetti width={width} height={height} colors={['var(--accent-color)', '#7B1FA2', '#E91E63', '#FFD700']} />}

        <Card className="w-full max-w-md bg-gradient-to-br from-zinc-900 to-black border-accent/30 shadow-2xl shadow-accent/20">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-accent/20 rounded-full blur-xl animate-pulse" />
                <Crown className="h-24 w-24 text-accent relative z-10" />
              </div>
            </div>
            <CardTitle className="text-3xl font-light text-white mb-2">
              {t('premium_welcome_title')}
            </CardTitle>
            <p className="text-base text-gray-400 font-light">
              {t('premium_welcome_subtitle')}
            </p>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-accent" />
                <span className="text-gray-300 font-light">{t('premium_matching_unlimited')}</span>
              </div>
              <div className="flex items-center gap-3">
                <Star className="h-5 w-5 text-accent" />
                <span className="text-gray-300 font-light">{t('premium_credits_added')}</span>
              </div>
              <div className="flex items-center gap-3">
                <Eye className="h-5 w-5 text-accent" />
                <span className="text-gray-300 font-light">{t('premium_profile_boosted')}</span>
              </div>
            </div>

            <Button
              size="lg"
              className="w-full bg-accent text-white font-light text-lg py-6 hover:opacity-90 transition-all shadow-lg shadow-accent/30"
              onClick={() => router.push('/activities')}
            >
              {t('premium_discover_profiles_cta')}
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
          <ArrowLeft className="h-4 w-4" /> {t('common_back')}
        </button>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/10 via-transparent to-transparent" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl" />

        <div className="relative container mx-auto max-w-5xl px-4 pt-16 pb-12">
          <div className="text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-accent/30 bg-accent/5">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-sm text-accent font-light">{t('premium_brand_label')}</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-light text-white tracking-tight">
              {t('premium_hero_title_part1')}
              <span className="block text-transparent bg-clip-text bg-accent">
                {t('premium_hero_title_part2')}
              </span>
            </h1>

            <p className="text-lg text-gray-400 font-light max-w-xl mx-auto">
              {t('premium_hero_subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Already Premium Banner */}
      {isPremium && (
        <div className="container mx-auto max-w-5xl px-4 mb-8">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-accent/30 bg-accent/5">
            <Crown className="h-6 w-6 text-accent" />
            <div>
              <p className="text-white font-light">{t('premium_already_active')}</p>
              <p className="text-sm text-gray-400 font-light">{t('premium_subscription_active')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Plans — BUG #93 : 4 paliers (24h / 1 sem / 1 mois / 1 an). Grid responsive. */}
      <div className="container mx-auto max-w-7xl px-4 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            // BUG #93 — `isFeatured` = plan mis en avant visuellement (border + gradient
            // accent). On choisit le 1 an car c'est le meilleur ratio CHF/mois.
            // L'ancien `isYearly` est gardé en alias pour les composants conditionnels.
            const isFeatured = plan.id === 'premium_year' || plan.id === 'premium_yearly';
            const isYearly = isFeatured;
            const visuals = PLAN_VISUALS[plan.id];
            // Build features list with dynamic credits
            const features = [
              ...(visuals?.features || []).slice(0, 1),
              { icon: Star, text: t('premium_credits_per_interval', { credits: plan.credits, interval: t(plan.interval) }), highlight: true, isLiteral: true },
              ...(visuals?.features || []).slice(1),
            ];

            return (
              <div key={plan.id} className="relative">
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 px-4 py-1 text-xs font-medium shadow-lg shadow-amber-500/30">
                      {t(plan.badge)}
                    </Badge>
                  </div>
                )}

                <Card className={`h-full transition-all duration-300 ${
                  isYearly
                    ? 'bg-gradient-to-br from-zinc-900 to-black border-accent/40 shadow-xl shadow-accent/10'
                    : 'bg-gradient-to-br from-zinc-900/80 to-black border-zinc-800 hover:border-zinc-700'
                }`}>
                  <CardHeader className="text-center pb-4 pt-8">
                    <div className="flex justify-center mb-4">
                      <div className={`p-3 rounded-2xl ${
                        isYearly ? 'bg-accent/10' : 'bg-zinc-800'
                      }`}>
                        <Crown className={`h-8 w-8 ${
                          isYearly ? 'text-accent' : 'text-gray-400'
                        }`} />
                      </div>
                    </div>
                    <CardTitle className="text-xl font-light text-white">
                      {t(plan.name)}
                    </CardTitle>
                    <div className="mt-4">
                      <span className="text-5xl font-light text-white">
                        {(() => {
                          // BUG #101 — Défensif : si pricing Firestore a un format
                          // inattendu (price undefined / NaN), affiche "0" plutôt
                          // que de crasher la page sur .toFixed() / .price % 1.
                          const safePrice = typeof plan.price === 'number' && Number.isFinite(plan.price) ? plan.price : 0;
                          return safePrice % 1 === 0 ? safePrice : safePrice.toFixed(2);
                        })()}
                      </span>
                      <span className="text-gray-400 font-light ml-1">CHF / {t(plan.interval)}</span>
                    </div>
                    {isYearly && typeof plan.price === 'number' && Number.isFinite(plan.price) && (
                      <p className="text-sm text-accent font-light mt-2">
                        {t('premium_year_equivalent', { price: (plan.price / 12).toFixed(2) })}
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-6 pb-8">
                    <div className="space-y-3">
                      {features.map((feature, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className={`p-1 rounded-lg ${
                            feature.highlight ? 'bg-accent/10' : 'bg-zinc-800/50'
                          }`}>
                            <feature.icon className={`h-4 w-4 ${
                              feature.highlight ? 'text-accent' : 'text-gray-500'
                            }`} />
                          </div>
                          <span className={`text-sm font-light ${
                            feature.highlight ? 'text-white' : 'text-gray-400'
                          }`}>
                            {(feature as any).isLiteral ? feature.text : t(feature.text)}
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
                          ? 'bg-accent text-white hover:opacity-90 shadow-lg shadow-accent/30'
                          : 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      {loading && selectedPlan === plan.id ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : isPremium ? (
                        <span className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5" />
                          {t('premium_already_subscribed')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          {t('premium_subscribe_cta')}
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
            {t('premium_compare_title')}
          </h2>

          <div className="rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="grid grid-cols-3 bg-zinc-900/50 px-6 py-4 border-b border-zinc-800">
              <div className="text-sm text-gray-400 font-light">{t('premium_feature_label')}</div>
              <div className="text-sm text-gray-400 font-light text-center">{t('premium_compare_free')}</div>
              <div className="text-sm text-accent font-light text-center">{t('premium_compare_premium')}</div>
            </div>

            {[
              { feature: 'premium_compare_sport_match', free: true, premium: true },
              { feature: 'premium_compare_custom_profile', free: true, premium: true },
              { feature: 'premium_compare_unlimited_match', free: false, premium: true },
              { feature: 'premium_compare_unlimited_chat', free: false, premium: true },
              { feature: 'premium_compare_profile_boost', free: false, premium: true },
              { feature: 'premium_compare_monthly_credits', free: false, premium: true },
              { feature: 'premium_compare_no_ads', free: false, premium: true },
              { feature: 'premium_compare_exclusive_badge', free: false, premium: 'yearly' },
            ].map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 px-6 py-3.5 ${
                  i % 2 === 0 ? 'bg-zinc-900/20' : ''
                } ${i < 7 ? 'border-b border-zinc-800/50' : ''}`}
              >
                <div className="text-sm text-gray-300 font-light">{t(row.feature)}</div>
                <div className="text-center">
                  {row.free ? (
                    <CheckCircle className="h-5 w-5 text-green-400 mx-auto" />
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>
                <div className="text-center">
                  {row.premium === true ? (
                    <CheckCircle className="h-5 w-5 text-accent mx-auto" />
                  ) : row.premium === 'yearly' ? (
                    <span className="text-xs text-accent font-light">{t('premium_compare_yearly_only')}</span>
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
              {t('premium_signup_prompt')}
            </p>
            <Button
              variant="outline"
              className="border-accent/30 text-accent hover:bg-accent/10"
              onClick={() => router.push('/signup?redirect=/premium')}
            >
              {t('premium_signup_cta')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Security */}
        <div className="mt-12 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <Shield className="h-4 w-4" />
            <span className="text-xs font-light">{t('premium_secure_stripe')}</span>
          </div>
          <p className="text-xs text-gray-600 font-light">
            {t('premium_cancel_anytime')}
          </p>
        </div>
      </div>
    </div>
  );
}
