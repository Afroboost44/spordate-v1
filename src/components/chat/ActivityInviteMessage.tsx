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

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { Calendar, Check, X, Loader2, MapPin, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { db } from '@/lib/firebase';
import { getActivityThumbnailChain } from '@/lib/activities/getActivityThumbnail';
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
  // BUG #36 C4 — Mode Duo : confirm modal avant accept (le sponsor a payé,
  // l'user doit confirmer qu'il vient bien à la séance).
  const [duoAcceptConfirmOpen, setDuoAcceptConfirmOpen] = useState(false);

  const view = resolveInviteCardView(msg, currentUserId);
  const invite = msg.invite;

  // Fix #194 bug B — la card invite affichait un rectangle rose vide quand
  // `invite.activityImageUrl` (snapshot dénormalisé créé au moment de l'envoi)
  // était absent ou cassé. Solution : on fetch l'activité fraîche depuis
  // Firestore via `invite.activityId` et on utilise le helper centralisé
  // getActivityThumbnailChain (#146) pour résoudre toutes les sources possibles
  // (thumbnailUrl, mediaItems, imageUrl legacy, etc.). Le snapshot reste utilisé
  // comme premier candidat — ça évite le flash placeholder pendant le fetch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activityDoc, setActivityDoc] = useState<Record<string, any> | null>(null);
  const [thumbIndex, setThumbIndex] = useState(0);
  const activityId = invite?.activityId;
  useEffect(() => {
    if (!activityId || !db) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db!, 'activities', activityId));
        if (cancelled || !snap.exists()) return;
        setActivityDoc(snap.data() as Record<string, unknown>);
      } catch (err) {
        console.warn('[ActivityInviteMessage] failed to fetch activity for thumbnail', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  if (!invite) return null;

  // Construction chaîne de fallback :
  //   1. snapshot dénormalisé (activityImageUrl) — instantané, pas de flash
  //   2. chaîne complète du helper appliquée au doc Firestore fraîchement
  //      fetché (thumbnailUrl → mediaItems image → mediaItems video thumb →
  //      imageUrl legacy → scan champs string).
  // Le `<img onError>` walk vers thumbIndex+1 quand une URL renvoie 404.
  const thumbCandidates: string[] = [];
  if (invite.activityImageUrl) thumbCandidates.push(invite.activityImageUrl);
  if (activityDoc) {
    for (const url of getActivityThumbnailChain(activityDoc)) {
      if (!thumbCandidates.includes(url)) thumbCandidates.push(url);
    }
  }
  const thumbUrl = thumbCandidates[thumbIndex] ?? null;

  const sessionLabel = formatNextSessionLabel(invite.nextSessionAt ?? null);
  const isDuoSponsored = invite.inviteMode === 'duo' && !!msg.sponsorPaidAt;

  const doAccept = async () => {
    if (busy) return;
    setBusy('accept');
    try {
      await acceptActivityInvite({ matchId, messageId: msg.messageId });
      // Mode Duo : 2e booking déjà créé par webhook (réuse fix #c47).
      // Pas de redirect vers /activities/[id] — la place est déjà confirmée,
      // on reste dans le chat avec la carte qui affiche "Acceptée ✓".
      if (isDuoSponsored) {
        toast({
          title: 'Invitation acceptée ✓',
          description: `Ta place pour ${invite.activityTitle} est confirmée.`,
          className: 'bg-zinc-900 border-accent/40 text-white',
        });
        return;
      }
      // Mode individual : redirect vers la page activité pour paiement
      toast({
        title: 'Invitation acceptée 🎉',
        description: 'Redirection vers la page de réservation...',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
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

  const handleAccept = () => {
    if (busy) return;
    // Mode Duo : confirmation modale obligatoire (engagement à venir)
    if (isDuoSponsored) {
      setDuoAcceptConfirmOpen(true);
      return;
    }
    doAccept();
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
      {/* Header : image (Fix #194 bug B — chaîne fallback complète via helper #146) */}
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveMediaImageSrc(thumbUrl)}
          alt=""
          className="w-full h-28 object-cover"
          onError={() => {
            if (thumbIndex < thumbCandidates.length - 1) {
              setThumbIndex(thumbIndex + 1);
            }
          }}
        />
      ) : (
        <div className="w-full h-28 bg-gradient-to-br from-accent to-[#E91E63] flex items-center justify-center">
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
        {/* BUG #36 C4 — Badge spécial Duo (sponsor a payé) */}
        {isDuoSponsored && (
          <div className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gradient-to-r from-accent/15 to-[#E91E63]/15 border border-accent/40 text-accent">
            <Sparkles className="h-2.5 w-2.5" />
            {view.isReceiver ? 'Ton ami a payé pour toi 💝' : 'Tu paies pour les 2 ✓'}
          </div>
        )}
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
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-accent hover:bg-accent/90 text-white text-xs font-medium transition disabled:opacity-50"
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

      {/* BUG #36 C4 — Confirm modal mode Duo : engagement à la séance */}
      <AlertDialog open={duoAcceptConfirmOpen} onOpenChange={setDuoAcceptConfirmOpen}>
        <AlertDialogContent className="bg-[#0A0A0A] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" />
              Accepter l&apos;invitation Duo ?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Ton sponsor a déjà payé ta place pour <span className="text-accent font-medium">{invite.activityTitle}</span>.
              En acceptant, tu confirmes ta participation à la séance{' '}
              {sessionLabel !== 'Date à venir' && <span className="text-white">{sessionLabel}</span>}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 text-white/70 hover:bg-white/5">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDuoAcceptConfirmOpen(false);
                doAccept();
              }}
              className="bg-accent hover:bg-accent/90 text-white"
            >
              Confirmer ma place ✓
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
