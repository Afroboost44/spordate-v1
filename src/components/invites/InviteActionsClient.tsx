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
 */

import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
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
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }

  // Pas auth ou viewer n'est pas le toUserId → page consultable mais pas d'actions
  if (!user) {
    return (
      <div className="text-sm text-white/50 font-light bg-white/5 rounded-xl px-4 py-3">
        Connecte-toi pour accepter ou refuser cette invitation.
      </div>
    );
  }
  if (user.uid === fromUserId) {
    return (
      <div className="text-sm text-white/50 font-light bg-white/5 rounded-xl px-4 py-3">
        En attente de la réponse de {toUserName}.
      </div>
    );
  }
  if (user.uid !== toUserId) {
    return (
      <div className="text-sm text-white/40 font-light bg-white/5 rounded-xl px-4 py-3">
        Cette invitation ne t’est pas adressée.
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

      let userMessage = data.detail || 'Impossible d’accepter pour le moment.';
      if (response.status === 409) userMessage = 'Cette invitation a déjà été traitée.';
      else if (response.status === 410) userMessage = 'Cette invitation a expiré.';
      else if (response.status === 401) userMessage = 'Session expirée — reconnecte-toi.';
      toast({ title: 'Acceptation impossible', description: userMessage, variant: 'destructive' });
    } catch (err) {
      console.warn('[InviteActionsClient] accept fetch failed', err);
      toast({ title: 'Erreur réseau', description: 'Réessaye dans un instant.', variant: 'destructive' });
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
          title: 'Invitation refusée',
          description: 'Tu as décliné cette invitation.',
          className: 'bg-zinc-700 text-white',
        });
        // Re-render page (status passé à 'declined' côté server)
        router.refresh();
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      let userMessage = data.detail || 'Impossible de refuser pour le moment.';
      if (response.status === 409) userMessage = 'Cette invitation a déjà été traitée.';
      else if (response.status === 401) userMessage = 'Session expirée — reconnecte-toi.';
      toast({ title: 'Refus impossible', description: userMessage, variant: 'destructive' });
    } catch (err) {
      console.warn('[InviteActionsClient] decline fetch failed', err);
      toast({ title: 'Erreur réseau', description: 'Réessaye dans un instant.', variant: 'destructive' });
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
          'flex-1 bg-[#D91CD2] text-white font-light hover:opacity-90',
          'h-12 rounded-xl text-sm',
        )}
      >
        {busy === 'accept' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Redirection Stripe…
          </>
        ) : (
          <>
            <Check className="mr-2 h-4 w-4" />
            Accepter et payer
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
            Refuser
          </>
        )}
      </Button>
    </div>
  );
}
