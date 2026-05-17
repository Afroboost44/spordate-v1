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

          {/* Mode duo : disabled COMMIT 2, sera actif COMMIT 3 */}
          <button
            type="button"
            disabled
            className="w-full text-left p-4 rounded-xl bg-white/5 border border-white/10 opacity-60 cursor-not-allowed"
            aria-label="Je paie pour les 2 — Bientôt disponible"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-white/40" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-white/70 font-medium text-sm">Je paie pour les 2</p>
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">
                    <Sparkles className="h-2.5 w-2.5" />
                    Bientôt
                  </span>
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">
                  Tu paies maintenant pour 2 places. Ton ami n&apos;aura plus qu&apos;à accepter.
                </p>
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
