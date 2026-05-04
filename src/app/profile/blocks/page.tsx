/**
 * Phase 7 sub-chantier 2 commit 3/4 — Page /profile/blocks.
 *
 * Écran de gestion personnel des blocks (doctrine §9.sexies E réversibilité).
 *
 * Pattern Client component + AuthGuard cohérent /profile/[uid]/page.tsx :
 * 1. AuthGuard : redirect /login si non connecté
 * 2. useEffect parallèle : getBlockedByMe + batch getUser pour profils
 * 3. BlocksManagementList rend la liste avec onUnblock handler
 * 4. onUnblock : appelle unblockUser → toast → refresh local (filter out)
 *
 * Charte stricte : header sticky black/90, max-w-lg centré, hover #D91CD2 sur back button.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  BlocksManagementList,
  type BlockedUserProfile,
} from '@/components/blocks/BlocksManagementList';
import { getBlockedByMe, unblockUser } from '@/lib/blocks';
import { getUser } from '@/services/firestore';
import type { Block } from '@/types/firestore';

function BlocksPageContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [userProfiles, setUserProfiles] = useState<Map<string, BlockedUserProfile>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadBlocks = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      const list = await getBlockedByMe(user.uid);
      setBlocks(list);

      // Batch fetch user profiles (cohérent getReviewerProfiles pattern sub-chantier 1)
      if (list.length > 0) {
        const uniqueIds = Array.from(new Set(list.map((b) => b.blockedId)));
        const profiles = await Promise.all(
          uniqueIds.map(async (uid) => {
            try {
              const u = await getUser(uid);
              if (!u) return null;
              return {
                uid,
                displayName: u.displayName || 'Membre Spordateur',
                photoURL: u.photoURL || undefined,
              } as BlockedUserProfile;
            } catch (err) {
              console.warn(`[BlocksPage] Failed to fetch user ${uid}`, err);
              return null;
            }
          }),
        );
        const map = new Map<string, BlockedUserProfile>();
        for (const p of profiles) {
          if (p) map.set(p.uid, p);
        }
        setUserProfiles(map);
      } else {
        setUserProfiles(new Map());
      }
    } catch (err) {
      console.error('[BlocksPage] Error loading blocks', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger ta liste de blocks.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [user?.uid, toast]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  const handleUnblock = useCallback(
    async (blockedId: string) => {
      if (!user?.uid) return;
      try {
        await unblockUser({ blockerId: user.uid, blockedId });
        // Refresh local : filter out le block supprimé (évite re-fetch full list)
        setBlocks((prev) => prev.filter((b) => b.blockedId !== blockedId));
        toast({
          title: 'Utilisateur débloqué',
          description: 'Vous pouvez à nouveau vous voir mutuellement.',
        });
      } catch (err) {
        console.error('[BlocksPage] unblock failed', err);
        toast({
          title: 'Erreur',
          description: 'Le déblocage a échoué. Réessaye.',
          variant: 'destructive',
        });
        throw err;
      }
    },
    [user?.uid, toast],
  );

  return (
    <div className="min-h-screen bg-black">
      {/* Header sticky cohérent /profile/[uid] */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-[#D91CD2]"
          onClick={() => router.push('/profile')}
          aria-label="Retour au profil"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-white font-light text-lg">Utilisateurs bloqués</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <p className="text-xs text-white/50 font-light leading-relaxed mb-6">
          Les utilisateurs bloqués ne voient plus ton profil, tes sessions ni tes messages.
          Réciproque côté ton compte. Aucune notification ne leur est envoyée.
        </p>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="h-6 w-6 text-white/30 motion-safe:animate-spin" />
            <p className="text-xs text-white/40 font-light">Chargement…</p>
          </div>
        ) : (
          <BlocksManagementList
            blocks={blocks}
            userProfiles={userProfiles}
            onUnblock={handleUnblock}
          />
        )}
      </div>
    </div>
  );
}

export default function BlocksPage() {
  return (
    <AuthGuard>
      <BlocksPageContent />
    </AuthGuard>
  );
}
