/**
 * Phase 9 sub-chantier 6 commit 3/4 — /profile/delete page user-facing RGPD/nLPD Art. 17.
 *
 * Doctrine architecture.md ligne 899 + §H : droit à l'effacement.
 *
 * Client component — useAuth pour user.uid + load softDeletedAt status via onSnapshot
 * (cohérent NotificationBadge SC3 c4 pattern). Pas d'Admin SDK côté server (pas critique
 * pour ce flow user-facing — softDelete reste owner-driven).
 *
 * Charte stricte black/#D91CD2/white user-facing.
 */

'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteAccountActions } from '@/components/profile/DeleteAccountActions';
import {
  isSoftDeleted,
  softDeleteGraceDaysRemaining,
} from '@/lib/users';
import type { UserProfile } from '@/types/firestore';

export default function ProfileDeletePage() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid || !db) {
      setLoading(false);
      return;
    }
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
        setLoading(false);
      },
      (err) => {
        console.warn('[ProfileDeletePage] onSnapshot error', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.uid]);

  if (authLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <p className="text-white/40 text-sm">Chargement...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <p className="text-white/60 text-sm">
          Connecte-toi pour gérer la suppression de ton compte.
        </p>
      </div>
    );
  }

  const alreadySoftDeleted = profile ? isSoftDeleted(profile) : false;
  const graceDaysRemaining = profile ? softDeleteGraceDaysRemaining(profile) : 0;
  const alreadyAnonymized = !!profile?.anonymizedAt;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card className="bg-zinc-950 border border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Trash2 className="h-5 w-5 text-red-400" />
            Supprimer mon compte
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {alreadyAnonymized ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-white/60">
              Ce compte a été anonymisé. Aucune action supplémentaire possible.
            </div>
          ) : (
            <DeleteAccountActions
              isAlreadySoftDeleted={alreadySoftDeleted}
              graceDaysRemaining={graceDaysRemaining}
            />
          )}

          <div className="text-[11px] text-white/30 leading-relaxed border-t border-white/5 pt-4">
            <p className="font-medium text-white/40 mb-1">Doctrine RGPD/nLPD</p>
            <p>
              RGPD Art. 17 — Droit à l&apos;effacement. nLPD Art. 19 — Devoir d&apos;information.
              La suppression suit un délai de grâce de 30 jours pendant lequel tu peux
              annuler. Après ce délai, tes données personnelles (nom, email, photo, bio)
              seront anonymisées de façon irréversible. Les éléments d&apos;audit trail T&S
              (reviews anonymes, reports) sont conservés conformément à la doctrine
              architecture.md §H.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
