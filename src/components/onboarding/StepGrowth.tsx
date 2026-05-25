"use client";

import { Button } from "@/components/ui/button";
import { Share2, Copy, PartyPopper, Users, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/context/LanguageContext";
import type { StepGrowthProps } from "./types";

export function StepGrowth({ referralCode, onGoToProfile }: StepGrowthProps) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}?ref=${referralCode}`
    : `${process.env.NEXT_PUBLIC_APP_URL || ''}?ref=${referralCode}`;

  const shareReferralLink = async () => {
    const shareText = t('step_growth_share_text');

    if (navigator.share) {
      try {
        await navigator.share({
          title: t('step_growth_share_title'),
          text: shareText,
          url: shareUrl,
        });
      } catch (error) {
        console.log("Partage annulé");
      }
    } else {
      await copyReferralLink();
    }
  };

  const copyReferralLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast({
      title: t('step_growth_link_copied_title'),
      description: t('step_growth_link_copied_desc'),
    });
  };

  return (
    <div className="space-y-6 text-center">
      {/* Success banner */}
      <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
        <div className="flex items-center justify-center gap-2 text-green-400">
          <PartyPopper className="h-5 w-5" />
          <p className="font-semibold">{t('step_growth_account_created')}</p>
        </div>
      </div>

      {/* Referral code display */}
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Gift className="h-4 w-4" />
          <p className="text-sm">{t('step_growth_referral_code_label')}</p>
        </div>
        <div className="p-4 bg-accent/10 border border-accent/30 rounded-xl">
          <p className="font-mono text-2xl font-bold tracking-wider text-accent">
            {referralCode}
          </p>
        </div>
      </div>

      {/* Share link */}
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Users className="h-4 w-4" />
          <p className="text-sm">{t('step_growth_share_link_label')}</p>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg text-xs break-all font-mono text-muted-foreground">
          {shareUrl}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          onClick={copyReferralLink}
          variant="outline"
          className="flex-1 group"
          data-testid="copy-link"
        >
          <Copy className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
          {t('step_growth_copy')}
        </Button>
        <Button
          onClick={shareReferralLink}
          className="flex-1 bg-accent text-white font-semibold group"
          data-testid="share-link"
        >
          <Share2 className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
          {t('step_growth_share')}
        </Button>
      </div>

      {/* Go to profile */}
      <Button
        onClick={onGoToProfile}
        variant="ghost"
        className="w-full mt-2 text-muted-foreground hover:text-foreground"
        data-testid="go-to-profile"
      >
        {t('step_growth_go_to_profile')}
      </Button>
    </div>
  );
}
