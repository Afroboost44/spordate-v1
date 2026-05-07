"use client";

/**
 * Phase 8 sub-chantier 4 commit 5/6 — InviteButton component.
 *
 * Doctrine §E.Q1 mode Individuel Phase 8 : User A invite User B à activity+session.
 * Modal dédié avec textarea optional message (Q1=A, max 200 chars).
 *
 * On submit : getIdToken() → fetch POST /api/invites Bearer auth + body {toUserId,
 * activityId, sessionId, message?}. Toast feedback success / error mapping
 * (409 doublon → "Tu as déjà invité {toUserName}").
 *
 * Variant primary/secondary cohérent charte stricte (Q11=A inline).
 */

import * as React from 'react';
import { useState } from 'react';
import { Send, Loader2, UserPlus } from 'lucide-react';
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
import { cn } from '@/lib/utils';

const MAX_MESSAGE_LEN = 200; // cohérent service helper SC4 c2/6 INVITE_MESSAGE_MAX_LEN

interface InviteButtonProps {
  activityId: string;
  sessionId: string;
  toUserId: string;
  toUserName: string;
  /** Variant visuel : primary CTA gradient ou secondary ghost. Default 'secondary'. */
  variant?: 'primary' | 'secondary';
  /** Label custom (ex: "Inviter Marie"). Default "Inviter {toUserName}". */
  label?: string;
  /** Classes additionnelles pour le bouton trigger. */
  className?: string;
}

export function InviteButton({
  activityId,
  sessionId,
  toUserId,
  toUserName,
  variant = 'secondary',
  label,
  className,
}: InviteButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const triggerLabel = label || `Inviter ${toUserName}`;
  const isAuth = !!user;

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
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          toUserId,
          activityId,
          sessionId,
          message: message.trim() || undefined,
        }),
      });

      if (response.ok) {
        toast({
          title: 'Invitation envoyée',
          description: `${toUserName} a reçu ton invitation par email.`,
          className: 'bg-green-600 text-white',
        });
        setOpen(false);
        setMessage('');
        return;
      }

      // Error mapping HTTP → user-facing
      const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      const errorCode = data.error || `http-${response.status}`;
      let userMessage = data.detail || 'Une erreur est survenue.';

      if (response.status === 409 || errorCode === 'invalid-status') {
        // Doublon : doc-id pattern collision (déjà invité ce couple/session)
        userMessage = `Tu as déjà invité ${toUserName} pour cette session.`;
      } else if (errorCode === 'session-too-soon') {
        userMessage = 'Cette session démarre dans moins d’1h, invitation impossible.';
      } else if (errorCode === 'self-invite-forbidden') {
        userMessage = 'Tu ne peux pas t’inviter toi-même.';
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
              {toUserName} recevra un email + une notification pour accepter ou refuser l’invitation.
              Chacun paye sa part en cas d’acceptation (mode Individuel Phase 8).
            </DialogDescription>
          </DialogHeader>

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
              rows={3}
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
              className="bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white font-light hover:opacity-90"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Envoi…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Envoyer l’invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
