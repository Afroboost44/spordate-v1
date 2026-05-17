/**
 * BUG #36 COMMIT 2 — Card invite activité rendue dans la conversation chat.
 *
 * Détecte msg.type='activity_invite' upstream (caller filtre dans le loop
 * messages). Render :
 *  - Image activité + titre + ville + date prochaine session
 *  - Badge status (En attente / Acceptée / Refusée / Expirée)
 *  - Si receiver+pending : 2 boutons Accepter (→ redirect /activities/[id]
 *    pour paiement) / Refuser (→ declineActivityInvite)
 *  - Si sender : pas de boutons, juste status
 *
 * @module
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Check, X, Loader2, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { resolveMediaImageSrc } from '@/lib/activities/media';
import { formatNextSessionLabel, resolveInviteCardView } from '@/lib/chat/inviteView';
import { acceptActivityInvite, declineActivityInvite } from '@/services/activityInvite';
import type { ChatMessage } from '@/types/firestore';

interface ActivityInviteMessageProps {
  msg: ChatMessage;
  matchId: string;
  currentUserId: string;
}

export function ActivityInviteMessage({ msg, matchId, currentUserId }: ActivityInviteMessageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  const view = resolveInviteCardView(msg, currentUserId);
  const invite = msg.invite;
  if (!invite) return null;

  const sessionLabel = formatNextSessionLabel(invite.nextSessionAt ?? null);

  const handleAccept = async () => {
    if (busy) return;
    setBusy('accept');
    try {
      await acceptActivityInvite({ matchId, messageId: msg.messageId });
      toast({
        title: 'Invitation acceptée 🎉',
        description: 'Redirection vers la page de réservation...',
        className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      });
      // Redirect vers la page activité avec un flag inviteId (les helpers de page
      // détail peuvent réagir à ce param pour ouvrir auto le modal de réservation).
      const params = new URLSearchParams();
      params.set('inviteId', msg.messageId);
      router.push(`/activities/${invite.activityId}?${params.toString()}`);
    } catch (err) {
      console.warn('[ActivityInviteMessage] accept failed', err);
      toast({
        title: 'Erreur',
        description: "Impossible d'accepter l'invitation. Réessaie.",
        variant: 'destructive',
      });
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy('decline');
    try {
      await declineActivityInvite({ matchId, messageId: msg.messageId });
      toast({
        title: 'Invitation refusée',
        className: 'bg-zinc-900 border-white/20 text-white',
      });
    } catch (err) {
      console.warn('[ActivityInviteMessage] decline failed', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de refuser. Réessaie.',
        variant: 'destructive',
      });
      setBusy(null);
    }
  };

  return (
    <div
      className={`max-w-sm w-full ${view.isSender ? 'ml-auto' : 'mr-auto'} bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden`}
    >
      {/* Header : image */}
      {invite.activityImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveMediaImageSrc(invite.activityImageUrl)}
          alt=""
          className="w-full h-28 object-cover"
        />
      ) : (
        <div className="w-full h-28 bg-gradient-to-br from-[#D91CD2] to-[#E91E63] flex items-center justify-center">
          <Calendar className="h-10 w-10 text-white/30" />
        </div>
      )}

      {/* Body : titre + meta + status */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-white font-medium leading-tight">{invite.activityTitle}</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 ${view.statusBadgeClass}`}>
            {view.statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/40 flex-wrap">
          {invite.activitySport && <span className="capitalize">{invite.activitySport}</span>}
          {invite.activityCity && (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-2.5 w-2.5" />
              {invite.activityCity}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Calendar className="h-2.5 w-2.5" />
            {sessionLabel}
          </span>
        </div>

        {/* Boutons Accepter/Refuser (receiver + pending uniquement) */}
        {(view.showAcceptButton || view.showDeclineButton) && (
          <div className="flex gap-2 pt-1">
            {view.showAcceptButton && (
              <button
                type="button"
                onClick={handleAccept}
                disabled={!!busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-[#D91CD2] hover:bg-[#D91CD2]/90 text-white text-xs font-medium transition disabled:opacity-50"
              >
                {busy === 'accept' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Accepter
              </button>
            )}
            {view.showDeclineButton && (
              <button
                type="button"
                onClick={handleDecline}
                disabled={!!busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 text-white/70 text-xs font-medium transition disabled:opacity-50"
              >
                {busy === 'decline' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Refuser
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
