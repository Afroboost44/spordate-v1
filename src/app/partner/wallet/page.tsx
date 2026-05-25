/**
 * Fix #144 — Page /partner/wallet refactorisée pour le modèle in-house wallet.
 *
 * Le partner voit :
 *   - Solde disponible (partner.balance, en centimes)
 *   - Revenus totaux (partner.totalRevenue)
 *   - Nombre de virements demandés (partner.payoutCount)
 *   - Formulaire IBAN (sauvegarde dans partner.iban / partner.ibanHolder)
 *   - Bouton "Demander un virement" → POST /api/wallet/request-payout
 *
 * Mode in-house wallet : la plateforme est marchand de référence, l'admin exécute
 * les virements SEPA manuellement depuis sa banque (le temps que Stripe Connect
 * KYC soit validé). Une fois Connect activé, ce flow sera remplacé par les
 * payouts Stripe automatiques.
 */
"use client";

import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import {
  Wallet, CheckCircle, AlertCircle,
  ArrowUpRight, TrendingUp, Clock, Loader2, CreditCard,
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { db } from '@/lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, limit, orderBy,
} from 'firebase/firestore';

interface PartnerWallet {
  id: string;
  balance?: number; // en centimes CHF
  totalRevenue?: number; // en centimes CHF
  payoutCount?: number;
  iban?: string;
  ibanHolder?: string;
}

interface WalletTransaction {
  walletTransactionId: string;
  type: 'sale_credit' | 'payout_request' | 'payout_completed';
  amountCents: number;
  currency: string;
  createdAt?: { toDate: () => Date };
}

function formatChf(cents?: number) {
  const v = (cents ?? 0) / 100;
  return v.toFixed(2);
}

export default function PartnerWalletPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [partnerData, setPartnerData] = useState<PartnerWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [iban, setIban] = useState('');
  const [ibanHolder, setIbanHolder] = useState('');
  const [savingIban, setSavingIban] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);

  const hasIban = useMemo(() => !!(partnerData?.iban && partnerData.iban.length >= 10), [partnerData]);
  const balanceCents = partnerData?.balance ?? 0;
  const canRequestPayout = hasIban && balanceCents > 0;

  // Load partner data + transactions
  useEffect(() => {
    if (!user?.uid || !db) { setLoadingData(false); return; }
    const fbDb = db;

    const load = async () => {
      try {
        let partnerSnap = await getDoc(doc(fbDb, 'partners', user.uid));
        let partnerId = user.uid;

        if (!partnerSnap.exists()) {
          partnerSnap = await getDoc(doc(fbDb, 'partners', `partner-${user.uid}`));
          partnerId = `partner-${user.uid}`;
        }

        if (!partnerSnap.exists() && user.email) {
          const q = query(collection(fbDb, 'partners'), where('email', '==', user.email), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            partnerSnap = snap.docs[0] as typeof partnerSnap;
            partnerId = snap.docs[0].id;
          }
        }

        if (partnerSnap.exists()) {
          const data = partnerSnap.data();
          setPartnerData({ id: partnerId, ...data });
          setIban((data?.iban as string) || '');
          setIbanHolder((data?.ibanHolder as string) || '');

          // Load last 20 transactions
          try {
            const txQ = query(
              collection(fbDb, 'walletTransactions'),
              where('partnerId', '==', partnerId),
              orderBy('createdAt', 'desc'),
              limit(20),
            );
            const txSnap = await getDocs(txQ);
            setTransactions(txSnap.docs.map(d => ({ walletTransactionId: d.id, ...(d.data() as Omit<WalletTransaction, 'walletTransactionId'>) })));
          } catch {
            // Composite index may be missing — skip silently
          }
        }
      } catch (err) {
        console.error('[Wallet] Error loading partner:', err);
      }
      setLoadingData(false);
    };

    load();
  }, [user]);

  const handleSaveIban = async () => {
    if (!user?.uid || !partnerData?.id) return;
    if (!iban.trim() || !ibanHolder.trim()) {
      toast({ title: t('partner_wallet_toast_missing_title'), description: t('partner_wallet_toast_missing_desc'), variant: "destructive" });
      return;
    }
    setSavingIban(true);
    try {
      const token = await (await import('@/lib/firebase')).auth?.currentUser?.getIdToken();
      const res = await fetch('/api/wallet/update-iban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ partnerId: partnerData.id, iban: iban.trim().replace(/\s+/g, ''), ibanHolder: ibanHolder.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('partner_wallet_server_error'));
      toast({ title: t('partner_wallet_toast_iban_saved_title'), description: t('partner_wallet_toast_iban_saved_desc') });
      setPartnerData(p => p ? { ...p, iban: iban.trim().replace(/\s+/g, ''), ibanHolder: ibanHolder.trim() } : p);
    } catch (err) {
      const m = err instanceof Error ? err.message : t('partner_wallet_error');
      toast({ title: t('partner_wallet_error'), description: m, variant: "destructive" });
    }
    setSavingIban(false);
  };

  const handleRequestPayout = async () => {
    if (!user?.uid || !partnerData?.id) return;
    if (balanceCents <= 0) return;
    setRequestingPayout(true);
    try {
      const token = await (await import('@/lib/firebase')).auth?.currentUser?.getIdToken();
      const res = await fetch('/api/wallet/request-payout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ partnerId: partnerData.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('partner_wallet_server_error'));
      toast({ title: t('partner_wallet_toast_payout_title'), description: t('partner_wallet_toast_payout_desc') });
      setPartnerData(p => p ? { ...p, balance: 0, payoutCount: (p.payoutCount ?? 0) + 1 } : p);
    } catch (err) {
      const m = err instanceof Error ? err.message : t('partner_wallet_error');
      toast({ title: t('partner_wallet_error'), description: m, variant: "destructive" });
    }
    setRequestingPayout(false);
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-extralight tracking-tight">
          {t('partner_wallet_page_title')}
        </h1>
        <p className="text-white/40 font-light mt-1">
          {t('partner_wallet_page_subtitle')}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-accent" />
            </div>
            <span className="text-xs text-white/30 uppercase tracking-wider font-light">{t('partner_wallet_balance_label')}</span>
          </div>
          <p className="text-3xl font-extralight text-white">{formatChf(balanceCents)} <span className="text-base text-white/30">CHF</span></p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <span className="text-xs text-white/30 uppercase tracking-wider font-light">{t('partner_wallet_revenue_label')}</span>
          </div>
          <p className="text-3xl font-extralight text-white">{formatChf(partnerData?.totalRevenue)} <span className="text-base text-white/30">CHF</span></p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <ArrowUpRight className="h-5 w-5 text-purple-400" />
            </div>
            <span className="text-xs text-white/30 uppercase tracking-wider font-light">{t('partner_wallet_payouts_count_label')}</span>
          </div>
          <p className="text-3xl font-extralight text-white">{partnerData?.payoutCount ?? 0}</p>
        </div>
      </div>

      {/* IBAN + withdrawal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* IBAN card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-light text-white">{t('partner_wallet_iban_card_title')}</h3>
              <p className="text-xs text-white/30 font-light">{t('partner_wallet_iban_card_subtitle')}</p>
            </div>
          </div>

          {hasIban && (
            <div className="flex items-center gap-3 p-4 bg-green-500/5 border border-green-500/10 rounded-xl">
              <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
              <div>
                <p className="text-sm text-green-400 font-light">{t('partner_wallet_iban_saved')}</p>
                <p className="text-xs text-white/40 font-light font-mono">
                  {partnerData?.iban?.replace(/(.{4})/g, '$1 ').trim()}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-white/40 mb-1 font-light">{t('partner_wallet_iban_field_label')}</label>
              <input
                type="text"
                value={iban}
                onChange={(e) => setIban(e.target.value.toUpperCase())}
                placeholder="CH00 0000 0000 0000 0000 0"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-light text-white placeholder:text-white/20 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1 font-light">{t('partner_wallet_holder_field_label')}</label>
              <input
                type="text"
                value={ibanHolder}
                onChange={(e) => setIbanHolder(e.target.value)}
                placeholder={t('partner_wallet_holder_placeholder')}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-light text-white placeholder:text-white/20 focus:outline-none focus:border-accent/50"
              />
            </div>
            <Button
              onClick={handleSaveIban}
              disabled={savingIban}
              className="w-full bg-accent hover:bg-accent/80 text-white font-light rounded-full h-11"
            >
              {savingIban ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              {hasIban ? t('partner_wallet_update_iban_btn') : t('partner_wallet_save_iban_btn')}
            </Button>
          </div>
        </div>

        {/* Withdrawal card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <ArrowUpRight className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-base font-light text-white">{t('partner_wallet_payout_card_title')}</h3>
              <p className="text-xs text-white/30 font-light">{t('partner_wallet_payout_card_subtitle')}</p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-xl p-5 text-center space-y-2">
            <p className="text-4xl font-extralight text-white">{formatChf(balanceCents)} <span className="text-lg text-white/30">CHF</span></p>
            <p className="text-xs text-white/20 font-light">{t('partner_wallet_balance_label')}</p>
          </div>

          {!hasIban && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/5 border border-yellow-500/10 rounded-xl">
              <AlertCircle className="h-4 w-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400/80 font-light">
                {t('partner_wallet_iban_required_warning')}
              </p>
            </div>
          )}

          <Button
            onClick={handleRequestPayout}
            disabled={!canRequestPayout || requestingPayout}
            className={`w-full rounded-full h-12 font-light ${
              canRequestPayout
                ? 'bg-accent hover:bg-accent/80 text-white'
                : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
            }`}
          >
            {requestingPayout && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
            {!hasIban
              ? t('partner_wallet_btn_iban_first')
              : balanceCents <= 0
                ? t('partner_wallet_btn_no_balance')
                : `${t('partner_wallet_btn_request')} ${formatChf(balanceCents)} CHF`}
          </Button>
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h3 className="text-base font-light text-white mb-4">{t('partner_wallet_history_title')}</h3>
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-white/5 border border-white/5 flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 text-white/20" />
            </div>
            <p className="text-white/30 font-light text-sm">{t('partner_wallet_history_empty')}</p>
            <p className="text-white/15 font-light text-xs mt-1">
              {t('partner_wallet_history_empty_desc')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {transactions.map(tx => (
              <div key={tx.walletTransactionId} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-light text-white">
                    {tx.type === 'sale_credit' && `💰 ${t('partner_wallet_tx_sale')}`}
                    {tx.type === 'payout_request' && `📤 ${t('partner_wallet_tx_payout_req')}`}
                    {tx.type === 'payout_completed' && `✅ ${t('partner_wallet_tx_payout_done')}`}
                  </p>
                  <p className="text-xs text-white/30 font-light">
                    {tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleString('fr-CH') : ''}
                  </p>
                </div>
                <p className={`text-sm font-light ${tx.type === 'sale_credit' ? 'text-green-400' : 'text-purple-400'}`}>
                  {tx.type === 'sale_credit' ? '+' : '−'}{formatChf(Math.abs(tx.amountCents))} {tx.currency}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
