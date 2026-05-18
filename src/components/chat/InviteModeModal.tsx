/**
 * BUG #36 COMMIT 2 — Modal sélection mode d'invitation.
 * BUG #38 — Bouton "Je paie pour les 2" désactivé si pas de session future.
 *
 * 2 modes (décision Bassi Q3) :
 *  - 'individual' : Chacun paie sa part — receiver accept → page de réservation
 *  - 'duo' : Je paie pour 2 — sender pré-paie via Stripe (COMMIT 4 ON)
 *
 * Mode Duo requiert une session future programmée (le Stripe Checkout est
 * adossé à une session précise pour le booking). Si pas de session future
 * → bouton Duo grisé + sous-texte explicatif. Mode Individual reste actif
 * (carte créée sans booking, partner programmera une session après).
 *
 * @module
 */

'use client';

import { Users, UserCheck, Sparkles, CalendarOff } from 'lucide-react';
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
  /** BUG #38 — Si false, le bouton Duo est désactivé (pas de session future
   *  programmée). Défaut true (backward-compat). */
  hasFutureSession?: boolean;
  onSelectMode: (mode: ActivityInviteMode) => void;
}

export function InviteModeModal({
  open,
  onOpenChange,
  activityTitle,
  hasFutureSession = true,
  onSelectMode,
}: InviteModeModalProps) {
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
          {/* Mode individual : toujours actif (pas besoin de session future) */}
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

          {/* BUG #36 C4 — Mode duo Stripe Checkout réel.
              BUG #38 — Désactivé si pas de session future (le paiement est
              adossé à une session précise, impossible sans). */}
          <button
            type="button"
            onClick={() => onSelectMode('duo')}
            disabled={!hasFutureSession}
            className={`w-full text-left p-4 rounded-xl border transition ${
              hasFutureSession
                ? 'bg-[#D91CD2]/5 border-[#D91CD2]/30 hover:bg-[#D91CD2]/10 hover:border-[#D91CD2]/50 active:scale-[0.98]'
                : 'bg-white/[0.02] border-white/10 cursor-not-allowed opacity-60'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  hasFutureSession ? 'bg-[#D91CD2]/15' : 'bg-white/5'
                }`}
              >
                <Users className={`h-5 w-5 ${hasFutureSession ? 'text-[#D91CD2]' : 'text-white/30'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={`font-medium text-sm ${hasFutureSession ? 'text-white' : 'text-white/40'}`}>
                    Je paie pour les 2
                  </p>
                  {hasFutureSession ? (
                    <Sparkles className="h-3 w-3 text-[#D91CD2]" />
                  ) : (
                    <span className="ml-1 inline-flex items-center gap-1 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">
                      <CalendarOff className="h-2.5 w-2.5" />
                      Sans session future
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/50 mt-0.5">
                  {hasFutureSession
                    ? "Tu paies maintenant pour 2 places. Ton ami n'a plus qu'à accepter."
                    : "Cette activité n'a plus de session prévue. Utilise « Chacun paie sa part » — votre ami réservera quand une nouvelle session sera disponible."}
                </p>
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
