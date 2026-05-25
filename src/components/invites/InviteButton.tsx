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
import { useLanguage } from '@/context/LanguageContext';
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
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  // Phase 9 SC2 c5/6 — mode selection (Q1=A inviter choisit)
  const [mode, setMode] = useState<InviteMode>('individual');
  const [splitInviterRatio, setSplitInviterRatio] = useState<number>(0.5);

  const triggerLabel = label || t('invite_button_label', { name: toUserName });
  const isAuth = !!user;

  // Phase 9 SC2 c5/6 — preview montants (si totalCents fourni)
  const previewAmounts = (() => {
    if (!totalCents || totalCents <= 0) return null;
    const totalChf = (totalCents / 100).toFixed(2);
    if (mode === 'individual') {
      return { youChf: '0.00', otherChf: totalChf, totalChf, hint: t('invite_hint_individual', { name: toUserName }) };
    }
    if (mode === 'gift') {
      return { youChf: totalChf, otherChf: '0.00', totalChf, hint: t('invite_hint_gift') };
    }
    // split
    const inviterCents = Math.round(totalCents * splitInviterRatio);
    const inviteeCents = totalCents - inviterCents;
    return {
      youChf: (inviterCents / 100).toFixed(2),
      otherChf: (inviteeCents / 100).toFixed(2),
      totalChf,
      hint: t('invite_hint_split', { you: (splitInviterRatio * 100).toFixed(0), other: (100 - splitInviterRatio * 100).toFixed(0), name: toUserName }),
    };
  })();

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: t('invite_login_required_title'),
        description: t('invite_login_required_desc'),
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
            const reason = prepayData.detail || prepayData.error || t('invite_payment_generic_error');
            toast({
              title: t('invite_created_payment_required_title'),
              description: t('invite_created_payment_required_desc', { name: toUserName, mode: data.mode || '', reason }),
              variant: 'destructive',
            });
          } catch (err) {
            console.warn('[InviteButton] prepay checkout failed', err);
            toast({
              title: t('invite_created_payment_required_title'),
              description: t('invite_retry_payment_desc'),
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: t('invite_sent_title'),
            description: t('invite_sent_desc', { name: toUserName }),
            className: 'bg-green-600 text-white',
          });
        }
        setOpen(false);
        setMessage('');
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      const errorCode = data.error || `http-${response.status}`;
      let userMessage = data.detail || t('invite_generic_error');

      if (response.status === 409 || errorCode === 'invalid-status') {
        userMessage = t('invite_err_already_invited', { name: toUserName });
      } else if (errorCode === 'session-too-soon') {
        userMessage = t('invite_err_session_too_soon');
      } else if (errorCode === 'self-invite-forbidden') {
        userMessage = t('invite_err_self_invite');
      } else if (errorCode === 'invalid-split-ratio') {
        userMessage = t('invite_err_invalid_split');
      } else if (errorCode === 'invalid-mode') {
        userMessage = t('invite_err_invalid_mode');
      } else if (response.status === 401) {
        userMessage = t('invite_err_session_expired');
      } else if (response.status === 404) {
        userMessage = t('invite_err_session_not_found');
      }

      toast({
        title: t('invite_refused_title'),
        description: userMessage,
        variant: 'destructive',
      });
    } catch (err) {
      console.warn('[InviteButton] fetch failed', err);
      toast({
        title: t('invite_network_error_title'),
        description: t('invite_network_error_desc'),
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
            ? 'bg-accent text-black hover:opacity-90 disabled:opacity-40'
            : 'border border-white/15 text-white/70 hover:text-white hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed',
          className,
        )}
        title={isAuth ? t('invite_button_title_auth', { name: toUserName }) : t('invite_button_title_unauth')}
      >
        <UserPlus className="h-3.5 w-3.5" />
        {triggerLabel}
      </button>

      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent className="bg-black border border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white font-light text-lg">
              {t('invite_dialog_title', { name: toUserName })}
            </DialogTitle>
            <DialogDescription className="text-gray-400 font-light text-sm leading-relaxed pt-2">
              {t('invite_dialog_desc', { name: toUserName })}
            </DialogDescription>
          </DialogHeader>

          {/* Phase 9 SC2 c5/6 — mode selection RadioGroup */}
          <div className="space-y-3 pt-2">
            <Label className="text-xs text-white/50 font-light">{t('invite_mode_label')}</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as InviteMode)}
              className="space-y-1.5"
            >
              <ModeOption
                value="individual"
                checked={mode === 'individual'}
                icon={<User className="h-4 w-4" />}
                title={t('invite_mode_individual_title')}
                description={t('invite_mode_individual_desc', { name: toUserName })}
              />
              <ModeOption
                value="split"
                checked={mode === 'split'}
                icon={<Users className="h-4 w-4" />}
                title={t('invite_mode_split_title')}
                description={t('invite_mode_split_desc')}
              />
              <ModeOption
                value="gift"
                checked={mode === 'gift'}
                icon={<Gift className="h-4 w-4" />}
                title={t('invite_mode_gift_title')}
                description={t('invite_mode_gift_desc')}
              />
            </RadioGroup>
          </div>

          {/* Slider split ratio (Q5=A 10-90%) */}
          {mode === 'split' && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-white/50 font-light">{t('invite_your_share_label')}</Label>
                <span className="text-xs text-accent font-medium">
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
                className="[&_[role=slider]]:bg-accent [&_[role=slider]]:border-accent"
              />
            </div>
          )}

          {/* Preview montants (si totalCents fourni) */}
          {previewAmounts && (
            <div className="bg-white/5 rounded-lg border border-zinc-800 p-3 mt-2 space-y-1">
              <p className="text-[11px] text-white/40 uppercase tracking-wider">{t('invite_preview_label')}</p>
              <p className="text-xs text-white/70 font-light leading-relaxed">
                {previewAmounts.hint}
              </p>
              <div className="flex justify-between text-sm pt-1 border-t border-white/5 mt-1.5">
                <span className="text-white/60">{t('invite_preview_you')}</span>
                <span className="text-accent font-medium">{previewAmounts.youChf} CHF</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">{toUserName}</span>
                <span className="text-white">{previewAmounts.otherChf} CHF</span>
              </div>
              <div className="flex justify-between text-xs text-white/40 pt-1 border-t border-white/5">
                <span>{t('invite_preview_total')}</span>
                <span>{previewAmounts.totalChf} CHF</span>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <label htmlFor="invite-message" className="text-xs text-white/50 font-light">
              {t('invite_message_label')} <span className="text-white/30">({MAX_MESSAGE_LEN} max)</span>
            </label>
            <Textarea
              id="invite-message"
              placeholder={t('invite_message_placeholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_MESSAGE_LEN + 50}
              rows={2}
              className="bg-zinc-900 border-zinc-800 text-white placeholder:text-gray-600 font-light resize-none focus-visible:ring-accent/30"
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
              {t('common_cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || messageOver}
              className="bg-accent text-white font-light hover:opacity-90"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === 'individual' ? t('invite_sending') : t('invite_redirecting_payment')}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {mode === 'individual'
                    ? t('invite_submit_send')
                    : mode === 'gift'
                      ? t('invite_submit_gift')
                      : t('invite_submit_split')}
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
          ? 'border-accent bg-accent/5'
          : 'border-zinc-800 hover:border-white/15',
      )}
    >
      <RadioGroupItem
        value={value}
        id={`mode-${value}`}
        className={cn(
          'mt-1 border-white/30',
          checked && 'border-accent text-accent',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm text-white">
          <span className={checked ? 'text-accent' : 'text-white/60'}>{icon}</span>
          <span className="font-medium">{title}</span>
        </div>
        <p className="text-xs text-white/50 font-light mt-0.5">{description}</p>
      </div>
    </label>
  );
}
