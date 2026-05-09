"use client";

import { Button } from "@/components/ui/button";
import { Share2, Copy, PartyPopper, Users, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { StepGrowthProps } from "./types";

export function StepGrowth({ referralCode, onGoToProfile }: StepGrowthProps) {
  const { toast } = useToast();
  const shareUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}?ref=${referralCode}` 
    : `${process.env.NEXT_PUBLIC_APP_URL || ''}?ref=${referralCode}`;

  const shareReferralLink = async () => {
    const shareText = `Rejoins-moi sur Spordateur pour trouver des partenaires de sport ! 🏃‍♂️🎾`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Spordateur - Trouve ton partenaire de sport",
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
      title: "Lien copié !",
      description: "Le lien a été copié dans le presse-papier.",
    });
  };

  return (
    <div className="space-y-6 text-center">
      {/* Success banner */}
      <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
        <div className="flex items-center justify-center gap-2 text-green-400">
          <PartyPopper className="h-5 w-5" />
          <p className="font-semibold">Ton compte est créé !</p>
        </div>
      </div>

      {/* Referral code display */}
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Gift className="h-4 w-4" />
          <p className="text-sm">Ton code de parrainage :</p>
        </div>
        <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl">
          <p className="font-mono text-2xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            {referralCode}
          </p>
        </div>
      </div>

      {/* Share link */}
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Users className="h-4 w-4" />
          <p className="text-sm">Partage ce lien avec tes amis :</p>
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
          Copier
        </Button>
        <Button
          onClick={shareReferralLink}
          className="flex-1 bg-gradient-to-r from-[#7B1FA2] to-[#E91E63] text-white font-semibold group"
          data-testid="share-link"
        >
          <Share2 className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" /> 
          Partager
        </Button>
      </div>

      {/* Go to profile */}
      <Button
        onClick={onGoToProfile}
        variant="ghost"
        className="w-full mt-2 text-muted-foreground hover:text-foreground"
        data-testid="go-to-profile"
      >
        Accéder à mon profil →
      </Button>
    </div>
  );
}
