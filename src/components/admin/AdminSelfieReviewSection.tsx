/**
 * BUG #89 — Section admin : review des selfies de vérification.
 *
 * Liste les users avec selfieVerificationStatus === 'pending', affiche pour
 * chacun le selfie soumis + la photo de profil côte à côte. L'admin peut :
 *  - Approuver → status = 'verified' (badge ✓ Vérifié apparaît partout)
 *  - Rejeter → status = 'rejected' (user peut re-essayer)
 *
 * À insérer dans /admin/manage tab Tarifs (ou nouvelle tab dédiée).
 */

'use client';

import { useEffect, useState } from 'react';
import {
  BadgeCheck, X, Check, Loader2, ShieldCheck, RefreshCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import {
  collection, query, where, getDocs, doc, updateDoc, serverTimestamp, limit,
} from 'firebase/firestore';

interface PendingUser {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  selfieVerificationUrl?: string;
  selfieVerificationSubmittedAt?: { toDate?: () => Date };
}

export function AdminSelfieReviewSection() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = async () => {
    if (!db || !isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('selfieVerificationStatus', '==', 'pending'),
        limit(20),
      );
      const snap = await getDocs(q);
      const list: PendingUser[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          displayName: data.displayName || 'Utilisateur',
          email: data.email,
          photoURL: data.photoURL || data.photos?.[0],
          selfieVerificationUrl: data.selfieVerificationUrl,
          selfieVerificationSubmittedAt: data.selfieVerificationSubmittedAt,
        };
      });
      setPending(list);
    } catch (err) {
      console.error('[AdminSelfieReview] load failed', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les vérifications en attente.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (uid: string, decision: 'verified' | 'rejected') => {
    if (!db) return;
    setActioning(uid);
    try {
      await updateDoc(doc(db, 'users', uid), {
        selfieVerificationStatus: decision,
        selfieVerificationDecidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Retire de la liste locale
      setPending((prev) => prev.filter((u) => u.uid !== uid));
      toast({
        title: decision === 'verified' ? 'Profil vérifié ✓' : 'Selfie rejeté',
        description:
          decision === 'verified'
            ? "L'utilisateur reçoit le badge bleu sur tous ses profils."
            : "L'utilisateur pourra réessayer avec un nouveau selfie.",
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[AdminSelfieReview] decide failed', err);
      toast({
        title: 'Erreur',
        description: 'La décision n\'a pas pu être enregistrée.',
        variant: 'destructive',
      });
    } finally {
      setActioning(null);
    }
  };

  return (
    <Card className="bg-[#1A1A1A] border-white/5">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base text-white flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          Vérifications selfie en attente ({pending.length})
        </CardTitle>
        <Button
          onClick={() => void load()}
          variant="outline"
          size="sm"
          disabled={loading}
          className="border-white/10 text-white/80 hover:border-accent/40"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <BadgeCheck className="h-10 w-10 text-white/20" />
            <p className="text-sm text-white/60">Aucune vérification en attente.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {pending.map((u) => (
              <li
                key={u.uid}
                className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-white/10 bg-zinc-900/40"
              >
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="text-sm text-white font-medium">
                    {u.displayName}
                  </div>
                  {u.email && (
                    <div className="text-[11px] text-white/40">{u.email}</div>
                  )}
                  <div className="text-[10px] text-white/30">
                    UID : <span className="font-mono">{u.uid.slice(0, 8)}…</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button
                      onClick={() => void decide(u.uid, 'verified')}
                      disabled={actioning === u.uid}
                      className="bg-green-600 hover:bg-green-700 text-white"
                      size="sm"
                    >
                      {actioning === u.uid ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5 mr-1" />
                      )}
                      Approuver
                    </Button>
                    <Button
                      onClick={() => void decide(u.uid, 'rejected')}
                      disabled={actioning === u.uid}
                      variant="outline"
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                      size="sm"
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Rejeter
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                  {/* Selfie soumis */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-white/40">
                      Selfie
                    </span>
                    {u.selfieVerificationUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.selfieVerificationUrl}
                        alt="Selfie de vérification"
                        className="w-32 h-40 rounded-lg object-cover border border-accent/30"
                      />
                    ) : (
                      <div className="w-32 h-40 rounded-lg bg-zinc-800 flex items-center justify-center text-[10px] text-white/40">
                        Aucun
                      </div>
                    )}
                  </div>
                  {/* Photo de profil */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-white/40">
                      Photo profil
                    </span>
                    {u.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.photoURL}
                        alt="Photo de profil"
                        className="w-32 h-40 rounded-lg object-cover border border-white/15"
                      />
                    ) : (
                      <div className="w-32 h-40 rounded-lg bg-zinc-800 flex items-center justify-center text-[10px] text-white/40">
                        Aucune
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
