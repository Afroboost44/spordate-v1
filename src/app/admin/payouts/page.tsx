/**
 * Fix #144 — Page admin /admin/payouts.
 *
 * Liste toutes les demandes de virement (collection `payoutRequests`) avec :
 *   - Status pending / completed / cancelled
 *   - IBAN + titulaire (pour copy-paste vers la banque)
 *   - Montant à virer
 *   - Bouton "Marquer comme effectué" → POST /api/admin/payouts/complete
 *
 * Mode in-house wallet (temporaire le temps que Stripe Connect KYC soit validé).
 */
"use client";

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, Clock, XCircle, Copy } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/context/AuthContext';
import { db, auth } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';

interface PayoutRequest {
  id: string;
  partnerId: string;
  partnerName?: string;
  partnerEmail?: string;
  amountCents: number;
  currency: string;
  iban: string;
  ibanHolder: string;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt?: { toDate: () => Date };
  completedAt?: { toDate: () => Date };
}

function formatChf(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function AdminPayoutsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  useEffect(() => {
    if (!db || !user) return;
    const load = async () => {
      try {
        const q = query(
          collection(db!, 'payoutRequests'),
          orderBy('createdAt', 'desc'),
          limit(200),
        );
        const snap = await getDocs(q);
        setPayouts(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<PayoutRequest, 'id'>) })));
      } catch (err) {
        console.error('[admin/payouts] load error', err);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const handleComplete = async (payoutId: string) => {
    if (!confirm('Confirmer que le virement SEPA a bien été exécuté depuis la banque ?')) return;
    setCompleting(payoutId);
    try {
      const token = await auth?.currentUser?.getIdToken();
      const res = await fetch('/api/admin/payouts/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ payoutId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      setPayouts(p => p.map(x => x.id === payoutId ? { ...x, status: 'completed' } : x));
      toast({ title: "Virement marqué comme effectué" });
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Erreur';
      toast({ title: "Erreur", description: m, variant: "destructive" });
    }
    setCompleting(null);
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast({ title: "Copié", description: text });
  };

  const filtered = filter === 'pending'
    ? payouts.filter(p => p.status === 'pending')
    : payouts;

  const totalPendingCents = payouts.filter(p => p.status === 'pending').reduce((a, b) => a + (b.amountCents ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 text-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extralight">Demandes de virement</h1>
          <p className="text-white/40 font-light mt-1 text-sm">
            Total en attente : <span className="text-accent">{formatChf(totalPendingCents)} CHF</span>
            {' '}({payouts.filter(p => p.status === 'pending').length} demande{payouts.filter(p => p.status === 'pending').length > 1 ? 's' : ''})
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-full text-sm font-light border ${filter === 'pending' ? 'bg-accent border-accent text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
          >
            En attente
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full text-sm font-light border ${filter === 'all' ? 'bg-accent border-accent text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
          >
            Tous
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
          <Clock className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 font-light">Aucune demande {filter === 'pending' ? 'en attente' : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(payout => (
            <div key={payout.id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    {payout.status === 'pending' && <Clock className="h-5 w-5 text-yellow-400" />}
                    {payout.status === 'completed' && <CheckCircle className="h-5 w-5 text-green-400" />}
                    {payout.status === 'cancelled' && <XCircle className="h-5 w-5 text-red-400" />}
                    <div>
                      <p className="text-base font-light">
                        {payout.partnerName || payout.partnerId}
                        {payout.partnerEmail && <span className="text-white/30 ml-2 text-xs">({payout.partnerEmail})</span>}
                      </p>
                      <p className="text-xs text-white/30 font-light">
                        {payout.createdAt?.toDate?.().toLocaleString('fr-CH')}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-white/40">IBAN :</span>
                      <span className="font-mono">{payout.iban}</span>
                      <button onClick={() => copy(payout.iban)} className="text-accent hover:text-accent/80" aria-label="Copier IBAN">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white/40">Titulaire :</span>
                      <span>{payout.ibanHolder}</span>
                      <button onClick={() => copy(payout.ibanHolder)} className="text-accent hover:text-accent/80" aria-label="Copier titulaire">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-start md:items-end gap-3">
                  <p className="text-2xl font-extralight">
                    {formatChf(payout.amountCents)} <span className="text-base text-white/30">{payout.currency}</span>
                  </p>
                  {payout.status === 'pending' && (
                    <Button
                      onClick={() => handleComplete(payout.id)}
                      disabled={completing === payout.id}
                      className="bg-accent hover:bg-accent/80 text-white rounded-full h-9 px-4 text-xs font-light"
                    >
                      {completing === payout.id && <Loader2 className="animate-spin mr-2 h-3 w-3" />}
                      Marquer comme effectué
                    </Button>
                  )}
                  {payout.status === 'completed' && (
                    <span className="text-xs text-green-400 font-light">
                      ✓ Virement effectué
                      {payout.completedAt?.toDate && (
                        <span className="text-white/30 ml-1">
                          {payout.completedAt.toDate().toLocaleDateString('fr-CH')}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
