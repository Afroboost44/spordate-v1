/**
 * Phase 7 sub-chantier 2 commit 3/4 — <BlockUserDialog>.
 *
 * Modal Dialog confirmation avant un block. Affiche les conséquences UX claires :
 * - invisibilité mutuelle (sessions/profils/messages)
 * - pas de notification au bloqué (anti-confrontation, doctrine §9.sexies E)
 * - réversibilité depuis /profile/blocks
 *
 * Submit → blockUser({blockerId: currentUserId, blockedId: targetUid}).
 * Loading state pendant le call. Errors typées BlockError → toast adapté.
 *
 * Charte stricte : Dialog black bg, accent #D91CD2 sur CTA Bloquer, white/70 secondaire.
 *
 * Note : pas de notification email ni in-app envoyée au bloqué — la doctrine
 * §9.sexies E privilégie l'anti-confrontation. Le bouton CTA est intentionnellement
 * neutre (pas rouge "danger") car c'est une action légitime utilisée fréquemment.
 */

'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { blockUser, BlockError } from '@/lib/blocks';

export interface BlockUserDialogProps {
  /** UID cible du block. */
  targetUid: string;
  /** Nom affiché dans le titre (ex: "Marie"). */
  targetName: string;
  /** UID de l'utilisateur courant — caller responsabilité de fournir l'auth context. */
  currentUserId: string;
  /** Contrôlé par parent. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback succès — passe blockId pour permettre refresh local. */
  onBlocked?: (blockId: string) => void;
}

export function BlockUserDialog({
  targetUid,
  targetName,
  currentUserId,
  open,
  onOpenChange,
  onBlocked,
}: BlockUserDialogProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await blockUser({
        blockerId: currentUserId,
        blockedId: targetUid,
      });

      const description = result.alreadyBlocked
        ? `${targetName} était déjà bloqué·e.`
        : `${targetName} ne pourra plus te voir, et tu ne le·la verras plus non plus.`;

      toast({
        title: 'Utilisateur bloqué',
        description,
      });

      onOpenChange(false);
      onBlocked?.(result.blockId);
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Block non effectué';

      if (err instanceof BlockError) {
        switch (err.code) {
          case 'self-block':
            title = 'Impossible';
            description = 'Tu ne peux pas te bloquer toi-même.';
            break;
          case 'invalid-uid':
            title = 'UID invalide';
            description = 'L\'identifiant utilisateur est invalide.';
            break;
          default:
            description = `Code : ${err.code}`;
        }
      }

      toast({
        title,
        description,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white font-light text-xl">
            Bloquer {targetName} ?
          </DialogTitle>
          <DialogDescription className="text-white/70 font-light leading-relaxed pt-2">
            Tu ne verras plus son profil, ses sessions, ses messages.
            <br />
            Lui non plus ne te verra plus.
          </DialogDescription>
        </DialogHeader>

        <div className="border-l-2 border-[#D91CD2] pl-3 py-1 my-2">
          <p className="text-xs text-white/70 font-light leading-relaxed">
            Aucune notification ne lui sera envoyée.
            <br />
            Réversible à tout moment depuis <span className="text-white">/profile/blocks</span>.
          </p>
        </div>

        <DialogFooter className="flex flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="flex-1 border-white/10 text-white hover:bg-white/5"
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 bg-[#D91CD2] text-black font-medium hover:bg-[#D91CD2]/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" aria-hidden="true" />
                Blocage…
              </>
            ) : (
              'Bloquer'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
