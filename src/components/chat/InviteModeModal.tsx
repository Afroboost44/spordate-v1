/**
 * BUG #36 COMMIT 2 — Modal sélection mode d'invitation.
 *
 * 2 modes (décision Bassi Q3) :
 *  - 'individual' : Chacun paie sa part — receiver accept → page de réservation
 *  - 'duo' : Je paie pour 2 — sender pré-paie via Stripe (COMMIT 3, ici disabled)
 *
 * COMMIT 2 : seul mode 'individual' activé. Bouton Duo affiche "Bientôt
 * disponible" pour préparer l'UX (signaler que c'est prévu pour bientôt).
 *
 * @module
 */

'use client';

import { Users, UserCheck, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ActivityInviteMode } from '@/types/firestore';

interface InviteModeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityTitle: string;
  onSelectMode: (mode: ActivityInviteMode) => void;
}

export function InviteModeModal({ open, onOpenChange, activityTitle, onSelectMode }: InviteModeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Comment tu invites ?</DialogTitle>
          <DialogDescription className="text-white/40 text-xs">
            Activité : <span className="text-[#D91CD2]">{activityTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {/* Mode individual : actif COMMIT 2 */}
          <button
            type="button"
            onClick={() => onSelectMode('individual')}
            className="w-full text-left p-4 rounded-xl bg-[#D91CD2]/5 border border-[#D91CD2]/30 hover:bg-[#D91CD2]/10 hover:border-[#D91CD2]/50 transition active:scale-[0.98]"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#D91CD2]/15 flex items-center justify-center flex-shrink-0">
                <UserCheck className="h-5 w-5 text-[#D91CD2]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm">Chacun paie sa part</p>
                <p className="text-[11px] text-white/50 mt-0.5">
                  Invitation gratuite à envoyer. Ton ami paiera sa propre place en acceptant.
                </p>
              </div>
            </div>
          </button>

          {/* BUG #36 C3 — Mode duo activé (Stripe Checkout 2 places) */}
          <button
            type="button"
            onClick={() => onSelectMode('duo')}
            className="w-full text-left p-4 rounded-xl bg-[#D91CD2]/5 border border-[#D91CD2]/30 hover:bg-[#D91CD2]/10 hover:border-[#D91CD2]/50 transition active:scale-[0.98]"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#D91CD2]/15 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-[#D91CD2]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-white font-medium text-sm">Je paie pour les 2</p>
                  <Sparkles className="h-3 w-3 text-[#D91CD2]" />
                </div>
                <p className="text-[11px] text-white/50 mt-0.5">
                  Tu paies maintenant 2 places via Stripe. Ton ami n&apos;a plus qu&apos;à accepter.
                </p>
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
