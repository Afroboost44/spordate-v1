"use client";

/**
 * Phase 8 sub-chantier 4 commit 5/6 — Client island actions accept/decline pour /invite/[id].
 *
 * Server Component page rend les data (read-only). Ce client island handle l'auth
 * + les CTAs Accept/Refuse uniquement pour toUserId. Pour fromUserId/non-participant,
 * cache les actions (page reste consultable mais inactive).
 *
 * Accept → fetch POST /api/checkout mode='invite-accept' → redirect Stripe URL
 * Refuse → fetch POST /api/invites/[id]/decline → toast + page reload
 *
 * Fix audit refund visibility — exporte également InviteRefundBanner : affiche un
 * encart explicite du statut refund (succeeded/in-progress/failed/manual-review)
 * pour les invitations declined ou expired (Split/Gift).
 */

import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check, X, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface InviteActionsClientProps {
  inviteId: string;
  fromUserId: string;
  toUserId: string;
  /** Affiché si user n'est pas le toUserId (pour debug + UX clair). */
  toUserName: string;
}

export function InviteActionsClient({
  inviteId,
  fromUserId,
  toUserId,
  toUserName,
}: InviteActionsClientProps) {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('invite_loading')}
      </div>
    );
  }

  // Pas auth ou viewer n'est pas le toUserId → page consultable mais pas d'actions
  if (!user) {
    return (
      <div className="text-sm text-white/50 font-light bg-white/5 rounded-xl px-4 py-3">
        {t('invite_login_to_respond')}
      </div>
    );
  }
  if (user.uid === fromUserId) {
    return (
      <div className="text-sm text-white/50 font-light bg-white/5 rounded-xl px-4 py-3">
        {t('invite_waiting_response_from').replace('{name}', toUserName)}
      </div>
    );
  }
  if (user.uid !== toUserId) {
    return (
      <div className="text-sm text-white/40 font-light bg-white/5 rounded-xl px-4 py-3">
        {t('invite_not_for_you')}
      </div>
    );
  }

  const handleAccept = async () => {
    if (busy) return;
    setBusy('accept');
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ mode: 'invite-accept', inviteId }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string; detail?: string };

      if (response.ok && data.url) {
        // Redirect Stripe checkout
        window.location.href = data.url;
        return;
      }

      // Anti-régression : on n'affiche JAMAIS data.detail brut. Stripe peut
      // renvoyer des messages techniques (ex. "product_data[name] cannot be
      // empty") qui n'ont aucun sens côté UI invité (capture 1). Le détail
      // technique reste loggé pour debug ; l'utilisateur voit un message
      // générique i18n selon le status.
      console.error('[InviteActionsClient] accept failed', {
        status: response.status,
        error: data.error,
        detail: data.detail,
      });
      let userMessage = t('invite_accept_generic_error');
      if (response.status === 409) userMessage = t('invite_already_processed');
      else if (response.status === 410) userMessage = t('invite_has_expired');
      else if (response.status === 401) userMessage = t('invite_session_expired_reconnect');
      else if (response.status === 403) userMessage = t('invite_not_for_you');
      toast({ title: t('invite_accept_failed_title'), description: userMessage, variant: 'destructive' });
    } catch (err) {
      console.warn('[InviteActionsClient] accept fetch failed', err);
      toast({ title: t('invite_network_error_title'), description: t('invite_network_error_desc'), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy('decline');
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/invites/${inviteId}/decline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (response.ok) {
        toast({
          title: t('invite_refused_title'),
          description: t('invite_refused_desc'),
          className: 'bg-zinc-700 text-white',
        });
        // Re-render page (status passé à 'declined' côté server)
        router.refresh();
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      // Anti-régression : pas de data.detail brut dans le toast (cohérent
      // avec le handleAccept ci-dessus).
      console.error('[InviteActionsClient] decline failed', {
        status: response.status,
        error: data.error,
        detail: data.detail,
      });
      let userMessage = t('invite_decline_generic_error');
      if (response.status === 409) userMessage = t('invite_already_processed');
      else if (response.status === 401) userMessage = t('invite_session_expired_reconnect');
      toast({ title: t('invite_decline_failed_title'), description: userMessage, variant: 'destructive' });
    } catch (err) {
      console.warn('[InviteActionsClient] decline fetch failed', err);
      toast({ title: t('invite_network_error_title'), description: t('invite_network_error_desc'), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <Button
        onClick={handleAccept}
        disabled={busy !== null}
        className={cn(
          'flex-1 bg-accent text-white font-light hover:opacity-90',
          'h-12 rounded-xl text-sm',
        )}
      >
        {busy === 'accept' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('invite_redirecting_stripe')}
          </>
        ) : (
          <>
            <Check className="mr-2 h-4 w-4" />
            {t('invite_action_accept_pay')}
          </>
        )}
      </Button>
      <Button
        variant="outline"
        onClick={handleDecline}
        disabled={busy !== null}
        className="flex-1 border-zinc-800 text-white/70 hover:text-white hover:bg-white/5 h-12 rounded-xl text-sm"
      >
        {busy === 'decline' ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <>
            <X className="mr-2 h-4 w-4" />
            {t('invite_action_decline')}
          </>
        )}
      </Button>
    </div>
  );
}

// =====================================================================
// InviteRefundBanner — Fix audit Stripe refund visibility
// =====================================================================

export type InviteRefundStatusUI =
  | 'pending'
  | 'in-progress'
  | 'succeeded'
  | 'failed'
  | 'manual-review'
  | 'not-applicable'
  | null;

interface InviteRefundBannerProps {
  refundStatus: InviteRefundStatusUI;
  /** ISO date du remboursement (utilisé si succeeded). */
  refundedAtISO: string | null;
}

/**
 * Affiche un encart explicite du statut refund pour les invitations Split/Gift
 * declined/expired. Ne rend rien si refundStatus === 'not-applicable' ou null.
 */
export function InviteRefundBanner({ refundStatus, refundedAtISO }: InviteRefundBannerProps) {
  const { t } = useLanguage();

  if (!refundStatus || refundStatus === 'not-applicable') {
    return null;
  }

  if (refundStatus === 'succeeded') {
    const dateLabel = refundedAtISO
      ? new Date(refundedAtISO).toLocaleDateString(undefined, {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '';
    return (
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-green-600/30 bg-green-600/10 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-400" />
        <div className="text-sm font-light leading-relaxed text-green-200">
          {dateLabel
            ? t('invite_refund_status_succeeded_dated').replace('{date}', dateLabel)
            : t('invite_refund_status_succeeded')}
        </div>
      </div>
    );
  }

  if (refundStatus === 'pending' || refundStatus === 'in-progress') {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-orange-600/30 bg-orange-600/10 px-4 py-3">
        <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-orange-400" />
        <div className="text-sm font-light leading-relaxed text-orange-200">
          {t('invite_refund_status_in_progress')}
        </div>
      </div>
    );
  }

  if (refundStatus === 'failed') {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-orange-600/30 bg-orange-600/10 px-4 py-3">
        <Clock className="h-5 w-5 flex-shrink-0 text-orange-400" />
        <div className="text-sm font-light leading-relaxed text-orange-200">
          {t('invite_refund_status_failed_retry')}
        </div>
      </div>
    );
  }

  if (refundStatus === 'manual-review') {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-600/30 bg-red-600/10 px-4 py-3">
        <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
        <div className="text-sm font-light leading-relaxed text-red-200">
          {t('invite_refund_status_manual_review')}{' '}
          <a
            href="mailto:contact@spordateur.com"
            className="underline hover:text-white"
          >
            contact@spordateur.com
          </a>
        </div>
      </div>
    );
  }

  return null;
}
