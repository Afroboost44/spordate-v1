"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet, Users, TrendingUp, Copy, ExternalLink,
  Loader2, AlertCircle, ArrowUpRight, Clock, CheckCircle
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  getCreator, createCreator, getCreatorReferrals, requestPayout
} from "@/services/firestore";
import type { Creator, Referral } from "@/types/firestore";
import { Timestamp } from 'firebase/firestore';

function formatCHF(amount: number): string {
  return amount.toFixed(2) + ' CHF';
}

function formatDate(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as string);
  return d.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CreatorDashboardPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [creator, setCreator] = useState<Creator | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingPayout, setRequestingPayout] = useState(false);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      try {
        let c = await getCreator(user.uid);

        // Auto-create creator profile if not exists
        if (!c) {
          c = await createCreator(user.uid, user.displayName || 'Créateur');
          toast({ title: 'Profil créateur activé !' });
        }

        setCreator(c);

        const refs = await getCreatorReferrals(user.uid);
        setReferrals(refs);
      } catch (err) {
        console.error('Erreur chargement créateur:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  const handleCopyLink = () => {
    if (!creator?.referralLink) return;
    navigator.clipboard.writeText(creator.referralLink);
    toast({ title: 'Lien copié !' });
  };

  const handleRequestPayout = async () => {
    if (!creator || creator.pendingPayout < 10) {
      toast({
        variant: 'destructive',
        title: 'Minimum 10 CHF',
        description: 'Tu dois avoir au moins 10 CHF de commission pour demander un retrait.'
      });
      return;
    }

    setRequestingPayout(true);
    try {
      await requestPayout(
        creator.creatorId,
        creator.pendingPayout,
        creator.payoutMethod || 'twint',
        creator.payoutDetails || {}
      );
      toast({ title: 'Demande envoyée !', description: 'Tu recevras ton paiement sous 48h.' });

      // Refresh
      const updated = await getCreator(creator.creatorId);
      if (updated) setCreator(updated);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: String(err) });
    } finally {
      setRequestingPayout(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle className="h-12 w-12 text-white/20 mb-4" />
        <p className="text-white/50">Impossible de charger le profil créateur.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-light tracking-tight">Dashboard Créateur</h1>
          <p className="text-sm text-white/40 mt-1">Suis tes revenus et tes filleuls en temps réel</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="h-4 w-4 text-[#D91CD2]" />
                <span className="text-xs text-white/40 uppercase tracking-wider">Gains totaux</span>
              </div>
              <p className="text-2xl font-light text-white">{formatCHF(creator.totalEarnings)}</p>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-green-400" />
                <span className="text-xs text-white/40 uppercase tracking-wider">En attente</span>
              </div>
              <p className="text-2xl font-light text-green-400">{formatCHF(creator.pendingPayout)}</p>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-white/40 uppercase tracking-wider">Filleuls</span>
              </div>
              <p className="text-2xl font-light text-white">{creator.totalReferrals}</p>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpRight className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-white/40 uppercase tracking-wider">Achats</span>
              </div>
              <p className="text-2xl font-light text-white">{creator.totalPurchases}</p>
            </CardContent>
          </Card>
        </div>

        {/* Lien de parrainage */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-light tracking-wide">Ton lien créateur</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-12 bg-black/60 border border-white/10 rounded-xl flex items-center px-4 overflow-hidden">
                <span className="text-white/60 text-sm truncate">{creator.referralLink}</span>
              </div>
              <Button
                onClick={handleCopyLink}
                variant="outline"
                size="icon"
                className="h-12 w-12 border-[#D91CD2]/30 text-[#D91CD2] hover:bg-[#D91CD2]/10"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-white/30">
              Commission : <span className="text-[#D91CD2]">{(creator.commissionRate * 100).toFixed(0)}%</span> sur chaque achat via ton lien
            </p>
          </CardContent>
        </Card>

        {/* Bouton retrait */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white/50">Solde disponible pour retrait</p>
              <p className="text-3xl font-light text-green-400 mt-1">{formatCHF(creator.pendingPayout)}</p>
              <p className="text-xs text-white/30 mt-1">Méthode : {creator.payoutMethod === 'twint' ? 'TWINT' : 'Virement bancaire'}</p>
            </div>
            <Button
              onClick={handleRequestPayout}
              disabled={requestingPayout || creator.pendingPayout < 10}
              className="h-14 px-8 bg-white/5 backdrop-blur-xl border border-[#D91CD2] text-white font-light tracking-wider uppercase hover:bg-[#D91CD2]/10 disabled:opacity-30"
            >
              {requestingPayout ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Wallet className="h-4 w-4 mr-2" />
              )}
              Demander un retrait
            </Button>
          </CardContent>
        </Card>

        {/* Historique filleuls */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-light tracking-wide">Mes filleuls</CardTitle>
          </CardHeader>
          <CardContent>
            {referrals.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-10 w-10 text-white/10 mx-auto mb-3" />
                <p className="text-sm text-white/30">Aucun filleul pour le moment</p>
                <p className="text-xs text-white/20 mt-1">Partage ton lien pour commencer à gagner</p>
              </div>
            ) : (
              <div className="space-y-2">
                {referrals.map((ref) => (
                  <div key={ref.referralId} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                        <Users className="h-4 w-4 text-white/30" />
                      </div>
                      <div>
                        <p className="text-sm text-white/70">Filleul</p>
                        <p className="text-xs text-white/30">{formatDate(ref.createdAt)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${
                          ref.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                          ref.status === 'first_purchase' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                          'bg-white/5 text-white/30 border-white/10'
                        }`}>
                          {ref.status === 'active' ? 'Actif' :
                           ref.status === 'first_purchase' ? '1er achat' :
                           'Inscrit'}
                        </Badge>
                      </div>
                      {ref.totalCommission > 0 && (
                        <p className="text-xs text-green-400 mt-1">+{formatCHF(ref.totalCommission)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
