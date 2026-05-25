"use client";

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Share2, Gift, Copy, Check, ArrowRight,
  Instagram, Music2, Facebook, MessageCircle
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from "@/hooks/use-toast";

export default function SharePage() {
  const { user, userProfile } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const sport = searchParams.get('sport') || 'Sport Date';
  const partner = searchParams.get('partner') || '';
  const [copied, setCopied] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);

  const referralCode = userProfile?.referralCode || 'SPORT';
  const shareUrl = `https://spordateur.com/signup?ref=${referralCode}`;

  const shareText = partner
    ? `Je viens de réserver un ${sport} avec ${partner} sur Spordateur ! Rejoins-moi pour ta prochaine séance`
    : `Je viens de réserver mon ${sport} sur Spordateur ! Trouve ton partenaire sportif`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast({ title: 'Lien copié !' });
    setTimeout(() => setCopied(false), 3000);
  };

  const handleShareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`, '_blank');
    markShared();
  };

  const handleShareInstagram = () => {
    // Instagram ne supporte pas le partage direct par URL, on copie le texte
    navigator.clipboard.writeText(shareText + '\n\n' + shareUrl);
    toast({ title: 'Texte copié !', description: 'Colle-le dans ta story Instagram' });
    window.open('https://instagram.com', '_blank');
    markShared();
  };

  const handleShareTikTok = () => {
    navigator.clipboard.writeText(shareText + '\n\n' + shareUrl);
    toast({ title: 'Texte copié !', description: 'Colle-le dans ta bio ou vidéo TikTok' });
    window.open('https://tiktok.com', '_blank');
    markShared();
  };

  const handleShareFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`, '_blank');
    markShared();
  };

  const markShared = () => {
    if (!rewardClaimed) {
      setRewardClaimed(true);
      toast({
        title: 'Récompense débloquée !',
        description: '+1 crédit offert pour ton prochain Sport Date',
      });
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* Header visuel */}
        <div className="text-center pt-8 pb-4">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-accent/20 rounded-full blur-3xl" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center">
              <Share2 className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-light tracking-tight mb-2">Partage ton Sport Date</h1>
          <p className="text-white/40 text-sm font-light">
            Montre à tes amis que tu bouges. Chaque partage = <span className="text-accent">{t('share_one_credit_offered')}</span>
          </p>
        </div>

        {/* Card récap du date */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center text-xl">
                {sport.includes('Danse') || sport.includes('Zumba') ? '💃' :
                 sport.includes('Fitness') ? '🏋️' :
                 sport.includes('Running') ? '🏃' :
                 sport.includes('Yoga') ? '🧘' : '⚡'}
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">{sport}</p>
                {partner && <p className="text-white/40 text-sm">avec {partner}</p>}
                <p className="text-accent text-xs mt-1">{t('share_reserved_success')}</p>
              </div>
              <Check className="h-6 w-6 text-green-400" />
            </div>
          </CardContent>
        </Card>

        {/* Boutons de partage */}
        <div className="space-y-3">
          <p className="text-xs text-white/30 uppercase tracking-wider font-medium px-1">Partager sur</p>

          {/* WhatsApp */}
          <button
            onClick={handleShareWhatsApp}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#25D366]/10 border border-[#25D366]/20 hover:bg-[#25D366]/20 transition-all active:scale-[0.98] min-h-[56px]"
          >
            <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-white text-sm font-medium">WhatsApp</p>
              <p className="text-white/30 text-xs">{t('share_send_to_friends')}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/20" />
          </button>

          {/* Instagram */}
          <button
            onClick={handleShareInstagram}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#E4405F]/10 border border-[#E4405F]/20 hover:bg-[#E4405F]/20 transition-all active:scale-[0.98] min-h-[56px]"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#833AB4] via-[#E4405F] to-[#FCAF45] flex items-center justify-center">
              <Instagram className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-white text-sm font-medium">Instagram Story</p>
              <p className="text-white/30 text-xs">Partage en story ou en post</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/20" />
          </button>

          {/* TikTok */}
          <button
            onClick={handleShareTikTok}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all active:scale-[0.98] min-h-[56px]"
          >
            <div className="w-10 h-10 rounded-full bg-black border border-white/20 flex items-center justify-center">
              <Music2 className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-white text-sm font-medium">TikTok</p>
              <p className="text-white/30 text-xs">Filme ton Sport Date et partage</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/20" />
          </button>

          {/* Facebook */}
          <button
            onClick={handleShareFacebook}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#1877F2]/10 border border-[#1877F2]/20 hover:bg-[#1877F2]/20 transition-all active:scale-[0.98] min-h-[56px]"
          >
            <div className="w-10 h-10 rounded-full bg-[#1877F2] flex items-center justify-center">
              <Facebook className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-white text-sm font-medium">Facebook</p>
              <p className="text-white/30 text-xs">{t('share_share_with_community')}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-white/20" />
          </button>
        </div>

        {/* Copier le lien */}
        <div className="space-y-2">
          <p className="text-xs text-white/30 uppercase tracking-wider font-medium px-1">Ou copie ton lien</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-12 bg-[#1A1A1A] border border-white/10 rounded-xl flex items-center px-4 overflow-hidden">
              <span className="text-white/50 text-xs truncate">{shareUrl}</span>
            </div>
            <Button
              onClick={handleCopyLink}
              variant="outline"
              size="icon"
              className={`h-12 w-12 border-accent/30 transition-all ${
                copied ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'text-accent hover:bg-accent/10'
              }`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Récompense */}
        <Card className={`border transition-all ${
          rewardClaimed
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-accent/5 border-accent/20'
        }`}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              rewardClaimed ? 'bg-green-500/10' : 'bg-accent/10'
            }`}>
              <Gift className={`h-6 w-6 ${rewardClaimed ? 'text-green-400' : 'text-accent'}`} />
            </div>
            <div className="flex-1">
              {rewardClaimed ? (
                <>
                  <p className="text-green-400 text-sm font-medium">{t('share_reward_unlocked')}</p>
                  <p className="text-white/30 text-xs">{t('share_one_credit_added')}</p>
                </>
              ) : (
                <>
                  <p className="text-white text-sm font-medium">{t('share_earn_free_credit')}</p>
                  <p className="text-white/30 text-xs">Partage sur n'importe quelle plateforme</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CTA retour */}
        <div className="pt-4 pb-8 space-y-3">
          <Link
            href="/activities"
            className="block w-full h-14 bg-white/5 backdrop-blur-xl border border-accent rounded-full text-white font-light text-sm tracking-wider uppercase flex items-center justify-center gap-2 hover:bg-accent/10 transition-all"
          >
            Prêt pour un nouveau date ?
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/activities"
            className="block text-center text-sm text-white/30 hover:text-white/50 transition py-2"
          >
            Retour aux profils
          </Link>
        </div>

      </div>
    </div>
  );
}
