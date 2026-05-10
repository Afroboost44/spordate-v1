"use client";

/**
 * Phase 8 SC4 commit 5/6 + Phase 9 SC2 c5/6 — InviteButton component.
 *
 * Modal dédié pour création invite — extension Phase 9 SC2 c5/6 :
 *  - Q1=A inviter choisit mode (RadioGroup individual/split/gift)
 *  - Q5=A range slider 10-90% pour split (step 10%)
 *  - Display preview montants CHF par mode
 *  - Si mode!='individual' → POST /api/invites enrichit invite + return checkoutUrl
 *    déclenchant ensuite POST /api/checkout mode='invite-prepay' (commit 3/6)
 *  - Charte stricte black/#D91CD2/white
 */

import * as React from 'react';
import { useState } from 'react';
import { Send, Loader2, UserPlus, Users, Gift, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const MAX_MESSAGE_LEN = 200;

type InviteMode = 'individual' | 'split' | 'gift';

interface InviteButtonProps {
  activityId: string;
  sessionId: string;
  toUserId: string;
  toUserName: string;
  /** Phase 9 SC2 c5/6 — total session price CHF centimes (optional, for UI preview).
   *  Si absent, preview montants n'est pas affiché (juste mode RadioGroup). */
  totalCents?: number;
  variant?: 'primary' | 'secondary';
  label?: string;
  className?: string;
}

export function InviteButton({
  activityId,
  sessionId,
  toUserId,
  toUserName,
  totalCents,
  variant = 'secondary',
  label,
  className,
}: InviteButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  // Phase 9 SC2 c5/6 — mode selection (Q1=A inviter choisit)
  const [mode, setMode] = useState<InviteMode>('individual');
  const [splitInviterRatio, setSplitInviterRatio] = useState<number>(0.5);

  const triggerLabel = label || `Inviter ${toUserName}`;
  const isAuth = !!user;

  // Phase 9 SC2 c5/6 — preview montants (si totalCents fourni)
  const previewAmounts = (() => {
    if (!totalCents || totalCents <= 0) return null;
    const totalChf = (totalCents / 100).toFixed(2);
    if (mode === 'individual') {
      return { youChf: '0.00', otherChf: totalChf, totalChf, hint: `${toUserName} paie tout` };
    }
    if (mode === 'gift') {
      return { youChf: totalChf, otherChf: '0.00', totalChf, hint: `Tu offres tout (cadeau)` };
    }
    // split
    const inviterCents = Math.round(totalCents * splitInviterRatio);
    const inviteeCents = totalCents - inviterCents;
    return {
      youChf: (inviterCents / 100).toFixed(2),
      otherChf: (inviteeCents / 100).toFixed(2),
      totalChf,
      hint: `Tu paies ${(splitInviterRatio * 100).toFixed(0)}%, ${toUserName} paie ${(100 - splitInviterRatio * 100).toFixed(0)}%`,
    };
  })();

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: 'Connexion requise',
        description: 'Connecte-toi pour envoyer une invitation.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = {
        toUserId,
        activityId,
        sessionId,
        message: message.trim() || undefined,
        mode,
      };
      if (mode === 'split') body.splitInviterRatio = splitInviterRatio;

      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          inviteId?: string;
          mode?: string;
        };

        // Phase 9 SC2 c5/6 — si mode!='individual', enchaîner Stripe checkout invite-prepay
        if ((data.mode === 'split' || data.mode === 'gift') && data.inviteId) {
          try {
            const prepayRes = await fetch('/api/checkout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ mode: 'invite-prepay', inviteId: data.inviteId }),
            });
            const prepayData = (await prepayRes.json().catch(() => ({}))) as {
              url?: string;
              error?: string;
              detail?: string;
            };
            if (prepayRes.ok && prepayData.url) {
              // Redirect Stripe checkout pour A pay sa part
              window.location.href = prepayData.url;
              return;
            }
            const reason = prepayData.detail || prepayData.error || 'Erreur paiement';
            toast({
              title: 'Invitation créée — paiement requis',
              description: `${toUserName} a été notifié·e mais ton paiement (${data.mode}) n'a pas pu démarrer : ${reason}`,
              variant: 'destructive',
            });
          } catch (err) {
            console.warn('[InviteButton] prepay checkout failed', err);
            toast({
              title: 'Invitation créée — paiement requis',
              description: `Réessaye de payer ta part depuis la page d'invitation.`,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Invitation envoyée',
            description: `${toUserName} a reçu ton invitation par email.`,
            className: 'bg-green-600 text-white',
          });
        }
        setOpen(false);
        setMessage('');
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      const errorCode = data.error || `http-${response.status}`;
      let userMessage = data.detail || 'Une erreur est survenue.';

      if (response.status === 409 || errorCode === 'invalid-status') {
        userMessage = `Tu as déjà invité ${toUserName} pour cette session.`;
      } else if (errorCode === 'session-too-soon') {
        userMessage = 'Cette session démarre dans moins d’1h, invitation impossible.';
      } else if (errorCode === 'self-invite-forbidden') {
        userMessage = 'Tu ne peux pas t’inviter toi-même.';
      } else if (errorCode === 'invalid-split-ratio') {
        userMessage = 'Ratio split invalide (10-90%).';
      } else if (errorCode === 'invalid-mode') {
        userMessage = 'Mode d\'invitation invalide.';
      } else if (response.status === 401) {
        userMessage = 'Session expirée — reconnecte-toi pour inviter.';
      } else if (response.status === 404) {
        userMessage = 'Session introuvable.';
      }

      toast({
        title: 'Invitation refusée',
        description: userMessage,
        variant: 'destructive',
      });
    } catch (err) {
      console.warn('[InviteButton] fetch failed', err);
      toast({
        title: 'Erreur réseau',
        description: 'Réessaye dans un instant.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const messageLen = message.length;
  const messageOver = messageLen > MAX_MESSAGE_LEN;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!isAuth}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-colors',
          variant === 'primary'
            ? 'bg-[#D91CD2] text-black hover:opacity-90 disabled:opacity-40'
            : 'border border-white/15 text-white/70 hover:text-white hover:border-[#D91CD2]/40 disabled:opacity-40 disabled:cursor-not-allowed',
          className,
        )}
        title={isAuth ? `Inviter ${toUserName}` : 'Connecte-toi pour inviter'}
      >
        <UserPlus className="h-3.5 w-3.5" />
        {triggerLabel}
      </button>

      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent className="bg-black border border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white font-light text-lg">
              Inviter {toUserName}
            </DialogTitle>
            <DialogDescription className="text-gray-400 font-light text-sm leading-relaxed pt-2">
              Choisis comment partager le coût de la session avec {toUserName}.
            </DialogDescription>
          </DialogHeader>

          {/* Phase 9 SC2 c5/6 — mode selection RadioGroup */}
          <div className="space-y-3 pt-2">
            <Label className="text-xs text-white/50 font-light">Mode de paiement</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as InviteMode)}
              className="space-y-1.5"
            >
              <ModeOption
                value="individual"
                checked={mode === 'individual'}
                icon={<User className="h-4 w-4" />}
                title="Chacun paye sa part"
                description={`${toUserName} paye sa session — toi rien.`}
              />
              <ModeOption
                value="split"
                checked={mode === 'split'}
                icon={<Users className="h-4 w-4" />}
                title="Partager le coût"
                description="Toi + lui/elle, en pourcentage choisi."
              />
              <ModeOption
                value="gift"
                checked={mode === 'gift'}
                icon={<Gift className="h-4 w-4" />}
                title="Offrir (cadeau)"
                description="Toi paye 100% — c'est cadeau !"
              />
            </RadioGroup>
          </div>

          {/* Slider split ratio (Q5=A 10-90%) */}
          {mode === 'split' && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-white/50 font-light">Ta part</Label>
                <span className="text-xs text-[#D91CD2] font-medium">
                  {(splitInviterRatio * 100).toFixed(0)}%
                </span>
              </div>
              <Slider
                value={[Math.round(splitInviterRatio * 100)]}
                onValueChange={(v) => setSplitInviterRatio(v[0] / 100)}
                min={10}
                max={90}
                step={10}
                disabled={loading}
                className="[&_[role=slider]]:bg-[#D91CD2] [&_[role=slider]]:border-[#D91CD2]"
              />
            </div>
          )}

          {/* Preview montants (si totalCents fourni) */}
          {previewAmounts && (
            <div className="bg-white/5 rounded-lg border border-zinc-800 p-3 mt-2 space-y-1">
              <p className="text-[11px] text-white/40 uppercase tracking-wider">Aperçu</p>
              <p className="text-xs text-white/70 font-light leading-relaxed">
                {previewAmounts.hint}
              </p>
              <div className="flex justify-between text-sm pt-1 border-t border-white/5 mt-1.5">
                <span className="text-white/60">Toi</span>
                <span className="text-[#D91CD2] font-medium">{previewAmounts.youChf} CHF</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">{toUserName}</span>
                <span className="text-white">{previewAmounts.otherChf} CHF</span>
              </div>
              <div className="flex justify-between text-xs text-white/40 pt-1 border-t border-white/5">
                <span>Total session</span>
                <span>{previewAmounts.totalChf} CHF</span>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <label htmlFor="invite-message" className="text-xs text-white/50 font-light">
              Message optionnel <span className="text-white/30">({MAX_MESSAGE_LEN} max)</span>
            </label>
            <Textarea
              id="invite-message"
              placeholder={`Tu m'accompagnes ?`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_MESSAGE_LEN + 50}
              rows={2}
              className="bg-zinc-900 border-zinc-800 text-white placeholder:text-gray-600 font-light resize-none focus-visible:ring-[#D91CD2]/30"
              disabled={loading}
            />
            <div className="flex justify-end">
              <span
                className={cn(
                  'text-[11px] font-light',
                  messageOver ? 'text-red-400' : 'text-white/30',
                )}
              >
                {messageLen}/{MAX_MESSAGE_LEN}
              </span>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="text-white/50 hover:text-white"
            >
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || messageOver}
              className="bg-[#D91CD2] text-white font-light hover:opacity-90"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === 'individual' ? 'Envoi…' : 'Redirection paiement…'}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {mode === 'individual'
                    ? "Envoyer l'invitation"
                    : mode === 'gift'
                      ? `Offrir & payer`
                      : `Envoyer & payer ma part`}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =====================================================================
// Sub-component : ModeOption (RadioGroupItem styled card)
// =====================================================================

function ModeOption({
  value,
  checked,
  icon,
  title,
  description,
}: {
  value: string;
  checked: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      htmlFor={`mode-${value}`}
      className={cn(
        'flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors',
        checked
          ? 'border-[#D91CD2] bg-[#D91CD2]/5'
          : 'border-zinc-800 hover:border-white/15',
      )}
    >
      <RadioGroupItem
        value={value}
        id={`mode-${value}`}
        className={cn(
          'mt-1 border-white/30',
          checked && 'border-[#D91CD2] text-[#D91CD2]',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm text-white">
          <span className={checked ? 'text-[#D91CD2]' : 'text-white/60'}>{icon}</span>
          <span className="font-medium">{title}</span>
        </div>
        <p className="text-xs text-white/50 font-light mt-0.5">{description}</p>
      </div>
    </label>
  );
}
