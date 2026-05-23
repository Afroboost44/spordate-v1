"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Send, ArrowLeft, Lock, MessageCircle,
  Loader2, CreditCard, CheckCheck, Check, PartyPopper, User, ChevronRight,
  Coins, ShieldCheck, Calendar
} from "lucide-react";
import Link from 'next/link';
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from '@/lib/utils';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import BackButton from '@/components/BackButton';
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { SuggestionMessage } from "@/components/chat/SuggestionMessage";
import { ChatProfileHint } from "@/components/chat/ChatProfileHint";
import { ChatAudioRecorder } from "@/components/chat/ChatAudioRecorder";
import { ChatAudioMessage } from "@/components/chat/ChatAudioMessage";
import { uploadChatAudio } from "@/lib/storage/uploadChatAudio";
import { DEFAULT_CHAT_PRICING } from "@/lib/pricing/chatPricing";
import {
  getUserMatches,
  sendMessage,
  sendAudioMessage,
  subscribeToMessages,
  markMessagesRead,
  getUser,
  unlockChat,
  triggerSuggestionsIfEligible,
  getNextFutureSessionForActivity,
} from '@/services/firestore';
import { getMutualBlockSet } from '@/lib/blocks';
import { resolveChatUrlAction } from '@/lib/chat/urlParams';
import { buildOtherUser } from '@/lib/chat/buildOtherUser';
import { ActivitySelectorModal, type ActivitySelectorPick } from '@/components/chat/ActivitySelectorModal';
import { InviteModeModal } from '@/components/chat/InviteModeModal';
import { ActivityInviteMessage } from '@/components/chat/ActivityInviteMessage';
import { sendActivityInvite } from '@/services/activityInvite';
import { getBookingPriceCHF } from '@/lib/booking/price';
import type { ActivityInviteMode } from '@/types/firestore';
import { ReportButton } from '@/components/reports/ReportButton';
import type { Match, ChatMessage, UserProfile } from '@/types/firestore';
import { Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ——— Types ———
interface ConversationItem {
  match: Match;
  otherUser: {
    uid: string;
    displayName: string;
    photoURL: string;
  };
  lastMessage: string;
  lastMessageAt: Date | null;
  unreadCount: number;
}

// ——— Helpers ———
function formatTime(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '';
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}j`;
  return date.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function formatDateSeparator(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '';
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDay.getTime() === today.getTime()) return "Aujourd'hui";
  if (msgDay.getTime() === yesterday.getTime()) return 'Hier';
  return date.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatMessageTime(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '';
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  return date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
}

function getDateKey(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '';
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ——— Conversation List ———
function ConversationList({
  conversations,
  selectedId,
  onSelect,
  loading,
}: {
  conversations: ConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 text-gray-500 animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <MessageCircle className="h-12 w-12 text-gray-700 mb-4" />
        <p className="text-gray-400 font-light">Pas encore de conversations</p>
        <p className="text-sm text-gray-600 font-light mt-1">
          Faites un match pour commencer à discuter
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      {conversations.map((conv) => {
        const isSelected = selectedId === conv.match.matchId;
        const isLocked = !conv.match.chatUnlocked;
        // Fix #120 — Mise en avant visuelle des conversations avec messages
        // non lus : fond légèrement accent + nom et dernier message en blanc bold
        // (cohérent UX Tinder/Bumble/Hinge).
        const hasUnread = conv.unreadCount > 0;

        return (
          <button
            key={conv.match.matchId}
            onClick={() => onSelect(conv.match.matchId)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left",
              isSelected
                ? "bg-zinc-800/80 border-l-2 border-accent"
                : hasUnread
                  ? "bg-accent/10 hover:bg-accent/15 border-l-2 border-accent"
                  : "hover:bg-zinc-900/50 border-l-2 border-transparent"
            )}
          >
            <div className="relative">
              <Avatar className="h-11 w-11">
                <AvatarImage src={conv.otherUser.photoURL} />
                <AvatarFallback className="bg-zinc-800 text-gray-400 text-sm">
                  {getInitials(conv.otherUser.displayName)}
                </AvatarFallback>
              </Avatar>
              {isLocked && (
                <div className="absolute -bottom-0.5 -right-0.5 bg-zinc-700 rounded-full p-0.5">
                  <Lock className="h-3 w-3 text-gray-400" />
                </div>
              )}
              {/* Fix #120 — Petit point accent en haut à droite de l'avatar pour
                  signaler les non-lus de manière encore plus visible (style Instagram). */}
              {hasUnread && (
                <div className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent border-2 border-black" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-sm truncate",
                  hasUnread ? "text-white font-semibold" : "text-white font-normal"
                )}>
                  {conv.otherUser.displayName}
                </span>
                {conv.lastMessageAt && (
                  <span className={cn(
                    "text-xs font-light ml-2 flex-shrink-0",
                    hasUnread ? "text-accent" : "text-gray-600"
                  )}>
                    {formatTime(conv.lastMessageAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className={cn(
                  "text-xs font-light truncate",
                  hasUnread ? "text-white font-medium" : "text-gray-500"
                )}>
                  {isLocked
                    ? "Chat verrouillé"
                    : conv.lastMessage || `Match : ${conv.match.sport || 'Sport'}`}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="bg-accent text-white text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1.5 font-medium ml-2 flex-shrink-0">
                    {conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Phase 8 SC2 commit 4/6 — "Ce flag est faux" mailto generator (Q8=A KISS).
 * Pré-remplit subject + body avec contexte technique pour faciliter le tri admin.
 */
function generateFalseFlagMailto(args: {
  chatId: string;
  messageId: string;
  escalationLevel: 'L2' | 'L3' | 'L4';
}): string {
  const subject = `Faux flag chat — ${args.escalationLevel}`;
  const body = [
    'Bonjour,',
    '',
    'Je pense que mon message a été flaggé incorrectement par le système de modération automatique anti-leak.',
    '',
    `Chat ID : ${args.chatId}`,
    `Message ID : ${args.messageId}`,
    `Date : ${new Date().toISOString()}`,
    `Niveau escalation : ${args.escalationLevel}`,
    '',
    'Détails (optionnel) :',
    '',
    'Merci',
  ].join('\n');
  return `mailto:contact@spordateur.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ——— Chat Window ———
/** Phase 8 SC1 commit 4/5 — localStorage flag pour onboarding-bubble (1 fois par user). */
const ONBOARDING_FLAG_KEY = 'spordateur_chat_onboarded_v1';

function ChatWindow({
  match,
  otherUser,
  currentUserId,
  credits,
  onBack,
}: {
  match: Match;
  otherUser: { uid: string; displayName: string; photoURL: string };
  currentUserId: string;
  /** Phase 8 SC1 — solde crédits live (cf. useCredits) — 1 crédit/message texte. */
  credits: number;
  onBack: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth(); // BUG #36 C3 — pour getIdToken Mode Duo
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  // Phase 8 SC1 commit 4/5 — onboarding-bubble doctrine §B.Q1 (1 fois par user)
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Phase 8 SC2 commit 4/6 — L3 modal rétroactif (Q2=B post-send, doctrine §B.Q2 laisse-faire)
  const [showL3Dialog, setShowL3Dialog] = useState(false);
  const [l3Context, setL3Context] = useState<{ messageId: string } | null>(null);
  // BUG #36 COMMIT 2 — modals activity_invite (sélection activité + mode)
  const [activitySelectorOpen, setActivitySelectorOpen] = useState(false);
  const [inviteModeOpen, setInviteModeOpen] = useState(false);
  const [pendingInviteActivity, setPendingInviteActivity] = useState<{ activityId: string; activityTitle: string; activityCity?: string; activitySport?: string; activityImageUrl?: string } | null>(null);
  // BUG #38 — résolu après pick d'une activité, gate le bouton Duo dans InviteModeModal
  const [pendingHasFutureSession, setPendingHasFutureSession] = useState<boolean>(true);
  // Fix UX — prix effectif d'une place (via getBookingPriceCHF) pour affichage
  // dans les sous-textes des boutons mode dans InviteModeModal.
  const [pendingPricePerSeatCHF, setPendingPricePerSeatCHF] = useState<number | undefined>(undefined);
  const [sendingInvite, setSendingInvite] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isLocked = !match.chatUnlocked;
  // Phase 8 SC1 — defense UX : input désactivé si crédits insuffisants (rule re-rejette aussi)
  const insufficientCredits = credits < 1;
  // BUG #74 — Coût d'un audio (par défaut 2 crédits, configurable admin via
  // settings/pricing.chatAudioCost). Le composant ChatAudioRecorder bloque déjà
  // le clic si solde < coût, et l'API server (sendAudioMessage) re-vérifie.
  const audioCost = DEFAULT_CHAT_PRICING.chatAudioCost;
  const lowCredits = credits < 5 && credits >= 1;

  // Phase 8 SC1 commit 4/5 — show onboarding 1 fois (localStorage flag)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isLocked) return;
    try {
      const onboarded = window.localStorage.getItem(ONBOARDING_FLAG_KEY);
      if (!onboarded) setShowOnboarding(true);
    } catch {
      // localStorage indisponible (mode navigation privée etc.) — skip silencieusement
    }
  }, [isLocked]);

  const handleOnboardingDismiss = () => {
    setShowOnboarding(false);
    try {
      window.localStorage.setItem(ONBOARDING_FLAG_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  // BUG #36 COMMIT 2 — Handlers activity_invite (chain modals + send service)
  const handleOpenActivitySelector = () => {
    setActivitySelectorOpen(true);
  };
  const handleActivityPicked = async (pick: ActivitySelectorPick) => {
    setPendingInviteActivity(pick);
    setActivitySelectorOpen(false);
    setPendingPricePerSeatCHF(undefined);
    // BUG #38 — Détecte la disponibilité d'une session future AVANT d'ouvrir
    // InviteModeModal. Si null → bouton Duo grisé (le Stripe Checkout est
    // adossé à une session, impossible sans). Fix UX : capture aussi le prix
    // effectif pour l'afficher dans les sous-textes des boutons mode.
    try {
      const next = await getNextFutureSessionForActivity(pick.activityId);
      setPendingHasFutureSession(next !== null);
      const effective = getBookingPriceCHF({
        session: next,
        // pas d'Activity object ici — fallback impossible côté chat. Si pas de
        // session, on laisse undefined (l'UI affichera le texte générique).
        activity: null,
        now: new Date(),
        isDuo: false,
      });
      setPendingPricePerSeatCHF(next ? effective : undefined);
    } catch {
      setPendingHasFutureSession(false);
      setPendingPricePerSeatCHF(undefined);
    }
    setInviteModeOpen(true);
  };
  const handleInviteModePicked = async (mode: ActivityInviteMode) => {
    if (!pendingInviteActivity || !currentUserId || sendingInvite) return;
    setSendingInvite(true);
    try {
      // BUG #36 C3 — Mode Duo : flow Stripe Checkout AVANT de créer la carte.
      // Si paiement annulé/échoué → carte n'est PAS envoyée (décision Q-D).
      // Webhook handleSessionPayment crée le message activity_invite avec
      // sponsorPaidAt+mode=duo après confirmation paiement.
      if (mode === 'duo') {
        if (!user) throw new Error('Non authentifié');
        const idToken = await user.getIdToken();
        const res = await fetch('/api/chat/send-duo-invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            matchId: match.matchId,
            senderUid: currentUserId,
            receiverUid: otherUser.uid,
            activityId: pendingInviteActivity.activityId,
            activityTitle: pendingInviteActivity.activityTitle,
            activityCity: pendingInviteActivity.activityCity,
            activitySport: pendingInviteActivity.activitySport,
            activityImageUrl: pendingInviteActivity.activityImageUrl,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        // BUG #36 C4 — vrai Stripe Checkout : redirect immédiat vers
        // session.url. Le webhook handleSessionPayment crée le message
        // activity_invite + bookings après confirmation paiement. Si annulé
        // → cancel_url callback → toast "Paiement annulé" (gestion ci-dessous).
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        throw new Error('Pas de URL Stripe retournée');
      }

      // Mode individual : flow direct (gratuit, pas de paiement)
      const result = await sendActivityInvite({
        matchId: match.matchId,
        senderId: currentUserId,
        receiverUid: otherUser.uid,
        senderName: undefined, // displayName du sender — caller (chat page) n'a pas userProfile direct
        activityId: pendingInviteActivity.activityId,
        activityTitle: pendingInviteActivity.activityTitle,
        activityCity: pendingInviteActivity.activityCity,
        activitySport: pendingInviteActivity.activitySport,
        activityImageUrl: pendingInviteActivity.activityImageUrl,
        inviteMode: mode,
      });
      toast({
        title: result.replaced ? 'Invitation déjà envoyée ✓' : 'Invitation envoyée 🎉',
        description: result.replaced
          ? `Tu as déjà invité ${otherUser.displayName} à cette activité. L'invitation originale reste visible dans le chat.`
          : `${otherUser.displayName} la verra dans le chat.`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      if (result.rateLimitMessage) {
        // Soft warning : 2e toast info au-dessus du success
        toast({
          title: 'Limite quotidienne dépassée',
          description: result.rateLimitMessage,
        });
      }
      setInviteModeOpen(false);
      setPendingInviteActivity(null);
    } catch (err) {
      console.warn('[ChatWindow] sendActivityInvite failed', err);
      // BUG #36 post-hotfix : toast spécifique selon code d'erreur.
      // 'no-future-session' = activité sans session programmée (cas edge race
      // condition après le pré-filtre du modal — défensif).
      const msg = err instanceof Error ? err.message : String(err);
      let title = 'Erreur';
      let description = "Impossible d'envoyer l'invitation. Réessaie.";
      if (msg === 'no-future-session') {
        title = 'Pas de session future';
        description =
          "Cette activité n'a plus de session prévue. Demande au partenaire d'en programmer une nouvelle.";
      } else if (msg === 'session-not-bookable') {
        title = 'Session non réservable';
        description =
          "La prochaine session est complète ou annulée. Choisis une autre activité.";
      } else if (msg === 'session-no-pricing') {
        title = 'Tarification manquante';
        description = "Cette activité n'a pas de tarification configurée.";
      }
      toast({
        title,
        description,
        variant: 'destructive',
      });
    } finally {
      setSendingInvite(false);
    }
  };

  // Subscribe to real-time messages
  useEffect(() => {
    if (isLocked) {
      setLoadingMessages(false);
      return;
    }

    setLoadingMessages(true);
    const unsubscribe = subscribeToMessages(match.matchId, (msgs) => {
      setMessages(msgs);
      setLoadingMessages(false);
    });

    // Mark messages as read
    markMessagesRead(match.matchId, currentUserId).catch(() => {});

    return () => unsubscribe();
  }, [match.matchId, currentUserId, isLocked]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark read when window is focused
  useEffect(() => {
    if (isLocked) return;
    const handleFocus = () => {
      markMessagesRead(match.matchId, currentUserId).catch(() => {});
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [match.matchId, currentUserId, isLocked]);

  // Phase 8 SC3 commit 4/6 — trigger IA suggestions au mount du chat (doctrine §D.Q1
  // default-on). Le serveur /api/suggest-activities enforce 72h cooldown + opt-out
  // consensus + min 3 catalog → idempotent, peut être appelé à chaque mount sans risque
  // spam. Best-effort silent (Q5=A) : suggestions = nice-to-have, jamais blocking UX.
  useEffect(() => {
    if (isLocked) return;
    triggerSuggestionsIfEligible(match.matchId, currentUserId).catch(() => {});
  }, [match.matchId, currentUserId, isLocked]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending || isLocked) return;

    // Phase 8 SC1 — defense UX (rule re-rejette si bypass)
    if (insufficientCredits) {
      toast({
        title: 'Crédits épuisés',
        description: 'Top-up nécessaire pour continuer la conversation.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    setInputValue('');

    try {
      // Phase 8 SC2 commit 4/6 — capture escalationLevel + messageId pour handler UI
      const result = await sendMessage(match.matchId, currentUserId, text);
      handleEscalation(result.escalationLevel, result.messageId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Chat] Erreur envoi:', err);
      setInputValue(text); // Restore on error
      // Phase 8 SC1 — handle insufficient-credits explicit + autres erreurs
      if (message.includes('insufficient-credits')) {
        toast({
          title: 'Crédits épuisés',
          description: 'Top-up nécessaire pour continuer la conversation.',
          variant: 'destructive',
        });
      } else if (message.toLowerCase().includes('permission')) {
        toast({
          title: 'Envoi refusé',
          description: 'La session est annulée — chat en lecture seule.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Échec envoi message',
          description: 'Réessayez dans un instant.',
          variant: 'destructive',
        });
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // BUG #74 — Handler pour les messages audio. Étapes :
  //  1. Upload du Blob audio vers Firebase Storage via uploadChatAudio
  //  2. Appel sendAudioMessage qui debit les crédits et écrit le message
  // Toute erreur affiche un toast et est remontée au composant Recorder.
  const handleSendAudio = async (blob: Blob, durationSec: number) => {
    if (insufficientCredits || credits < audioCost) {
      toast({
        title: 'Crédits insuffisants',
        description: `Il te faut ${audioCost} crédits pour envoyer un audio.`,
        variant: 'destructive',
      });
      throw new Error('insufficient-credits');
    }
    try {
      const { url, contentType } = await uploadChatAudio(blob, match.matchId, currentUserId);
      await sendAudioMessage(match.matchId, currentUserId, url, durationSec, contentType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Chat audio] échec', err);
      if (msg.includes('insufficient-credits')) {
        toast({
          title: 'Crédits insuffisants',
          description: `Il te faut ${audioCost} crédits pour envoyer un audio.`,
          variant: 'destructive',
        });
      } else if (msg.includes('file-too-large')) {
        toast({
          title: 'Audio trop volumineux',
          description: 'Le fichier dépasse la taille max (5 MB).',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Envoi impossible',
          description: 'Réessaie dans un instant.',
          variant: 'destructive',
        });
      }
      throw err;
    }
  };

  // Phase 8 SC2 commit 4/6 — handler escalation post-send (doctrine §B L1-L4) :
  //   L0 silent / L2 toast soft (Q11=A doctrine literal) /
  //   L3 modal rétroactif (Q2=B post-send laisse-faire) /
  //   L4 silent (admin email + flag account commit 5/6)
  const handleEscalation = (
    level: 'L0' | 'L2' | 'L3' | 'L4',
    messageId: string,
  ) => {
    if (level === 'L0' || level === 'L4') {
      // L0 silent doctrine §B ligne 567. L4 admin escalation manuelle (commit 5/6).
      return;
    }

    if (level === 'L2') {
      // Toast soft non-bloquant — wording doctrine literal Q11=A line 568
      toast({
        title: '💬 Astuce',
        description:
          'Le chat reste ouvert jusqu’à ta prochaine session — pas besoin de partager ton Insta.',
        action: (
          <ToastAction
            altText="Ce flag est faux"
            asChild
          >
            <a
              href={generateFalseFlagMailto({
                chatId: match.matchId,
                messageId,
                escalationLevel: 'L2',
              })}
              className="text-xs"
            >
              Ce flag est faux
            </a>
          </ToastAction>
        ),
        duration: 8000,
      });
      return;
    }

    if (level === 'L3') {
      // Modal AlertDialog rétroactif post-send (doctrine §B.Q2 laisse-faire)
      setL3Context({ messageId });
      setShowL3Dialog(true);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-black/90 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-white md:hidden"
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <button
          onClick={() => router.push(`/profile/${otherUser.uid}`)}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src={otherUser.photoURL} />
            <AvatarFallback className="bg-zinc-800 text-gray-400 text-sm">
              {getInitials(otherUser.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm text-white font-normal truncate">{otherUser.displayName}</p>
            <p className="text-xs text-gray-500 font-light">
              {match.sport || 'Sport Date'}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
        </button>
        {/* Phase 8 SC1 commit 4/5 — compteur crédits live (1 crédit/message texte) */}
        {!isLocked && (
          <Link
            href="/payment"
            title="1 crédit consommé par message texte. Top-up via /payment."
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-light flex-shrink-0 transition-colors',
              insufficientCredits
                ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                : lowCredits
                  ? 'border-orange-500/40 text-orange-400 hover:bg-orange-500/10'
                  : 'border-zinc-800 text-gray-400 hover:text-white hover:border-zinc-700',
            )}
          >
            <Coins className="h-3.5 w-3.5" />
            <span>{credits}</span>
          </Link>
        )}
        {/* Phase 7 sub-chantier 3 commit 4/5 : entry point report (variant 'chat') */}
        <ReportButton
          variant="chat"
          targetUid={otherUser.uid}
          targetName={otherUser.displayName || 'cet utilisateur'}
          currentUserId={currentUserId}
        />
      </div>

      {/* BUG #73 — Hint onboarding "clique sur nom/photo pour voir le profil".
          S'affiche une fois (localStorage flag), dismissible. Place juste sous le
          header pour pointer visuellement vers la zone cliquable. */}
      <ChatProfileHint />

      {/* Phase 8 SC1 commit 4/5 — onboarding-bubble 1ère entrée chat post-session
          (doctrine §B.Q1 obligatoire : transparence modération chat) */}
      <Dialog open={showOnboarding} onOpenChange={(open) => { if (!open) handleOnboardingDismiss(); }}>
        <DialogContent className="bg-black border border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white font-light text-lg flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-accent" />
              Bienvenue dans le chat post-session
            </DialogTitle>
            <DialogDescription className="text-gray-400 font-light text-sm leading-relaxed pt-2 space-y-3">
              <span className="block">
                Tu disposes de <span className="text-white font-medium">{credits} crédits</span> pour échanger
                avec {otherUser.displayName} (1 crédit par message texte). Top-up disponible à tout moment via{' '}
                <Link href="/payment" className="text-accent hover:underline">/payment</Link>.
              </span>
              <span className="block flex items-start gap-2 pt-1">
                <ShieldCheck className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-xs text-white/50">
                  Les messages sont scannés automatiquement (motifs anti-leak — partage de coordonnées).
                  Cette modération est obligatoire — voir{' '}
                  <Link href="/terms" className="text-white/70 hover:underline">CGU §7.quater</Link>.
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={handleOnboardingDismiss}
              className="bg-accent text-white font-light hover:opacity-90 w-full"
            >
              Compris
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 8 SC2 commit 4/6 — L3 modal rétroactif (Q2=B post-send, doctrine §B.Q2 laisse-faire)
          Le message a été envoyé avant ce dialog (post-send). User informé que les futurs hits
          escaladeront vers admin (L4). Action "Ce flag est faux" ouvre mailto. */}
      <AlertDialog open={showL3Dialog} onOpenChange={setShowL3Dialog}>
        <AlertDialogContent className="bg-black border border-zinc-800 text-white max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-light text-lg">
              Message flaggé
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400 font-light text-sm leading-relaxed pt-2">
              Ton message a été flaggé comme tentative de partage de coordonnées
              hors-plateforme. Il a été envoyé, mais{' '}
              <span className="text-white">les futurs messages dans cette conversation
              seront flaggés plus strictement</span> et pourront être escaladés vers la
              modération admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            {l3Context && (
              <a
                href={generateFalseFlagMailto({
                  chatId: match.matchId,
                  messageId: l3Context.messageId,
                  escalationLevel: 'L3',
                })}
                className="text-xs text-white/50 hover:text-white/70 underline self-center mr-auto"
              >
                Ce flag est faux ?
              </a>
            )}
            <AlertDialogAction
              onClick={() => setShowL3Dialog(false)}
              className="bg-accent text-white font-light hover:opacity-90"
            >
              Compris
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Locked State */}
      {isLocked ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mx-auto mb-5">
              <Lock className="h-7 w-7 text-gray-600" />
            </div>
            <h3 className="text-lg text-white font-light mb-2">Chat verrouillé</h3>
            <p className="text-sm text-gray-500 font-light mb-6">
              Réservez une activité avec {otherUser.displayName} pour débloquer la conversation.
            </p>
            <Button
              className="bg-accent text-white font-light hover:opacity-90"
              onClick={() => router.push('/payment')}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Acheter des crédits
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {loadingMessages ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 text-gray-600 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-600 font-light">
                  Envoyez le premier message !
                </p>
              </div>
            ) : (
              messages.map((msg, index) => {
                const isMe = msg.senderId === currentUserId;
                const isRead = msg.readBy?.includes(otherUser.uid);
                const time = msg.createdAt ? formatMessageTime(msg.createdAt) : '';

                // Date separator: show if first message or different day from previous
                const currentDateKey = getDateKey(msg.createdAt);
                const prevDateKey = index > 0 ? getDateKey(messages[index - 1].createdAt) : '';
                const showDateSeparator = index === 0 || currentDateKey !== prevDateKey;

                return (
                  <React.Fragment key={msg.messageId}>
                    {showDateSeparator && msg.createdAt && (
                      <div className="flex items-center justify-center my-4">
                        <div className="h-px bg-zinc-800 flex-1" />
                        <span className="text-[11px] text-gray-500 font-light px-3 whitespace-nowrap">
                          {formatDateSeparator(msg.createdAt)}
                        </span>
                        <div className="h-px bg-zinc-800 flex-1" />
                      </div>
                    )}

                    {msg.type === 'system' ? (
                      <div className="flex justify-center my-2">
                        <span className="text-xs text-gray-600 font-light bg-zinc-900/50 px-3 py-1 rounded-full">
                          {msg.text}
                        </span>
                      </div>
                    ) : msg.type === 'ai_suggestion' ? (
                      // Phase 8 SC3 commit 5/6 + Phase 9 SC1 c2/5 — bot card + InviteButton
                      <SuggestionMessage
                        message={msg}
                        viewerUid={currentUserId}
                        otherUserId={otherUser.uid}
                        otherUserName={otherUser.displayName}
                      />
                    ) : msg.type === 'activity_invite' ? (
                      // BUG #36 COMMIT 2 — Card invite activité (Accepter/Refuser)
                      <ActivityInviteMessage
                        msg={msg}
                        matchId={match.matchId}
                        currentUserId={currentUserId}
                      />
                    ) : (
                      <div
                        className={cn(
                          "flex items-end gap-2",
                          isMe ? "justify-end" : "justify-start"
                        )}
                      >
                        {!isMe && (
                          <button
                            onClick={() => router.push(`/profile/${otherUser.uid}`)}
                            className="flex-shrink-0 hover:opacity-80 transition-opacity"
                          >
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={otherUser.photoURL} />
                              <AvatarFallback className="bg-zinc-800 text-gray-500 text-xs">
                                {getInitials(otherUser.displayName)}
                              </AvatarFallback>
                            </Avatar>
                          </button>
                        )}
                        <div className={cn("max-w-[75%]")}>
                          {/* BUG #74 + #75 — Message audio = composant custom
                              ChatAudioMessage (bulle accent + waveform + speed).
                              Pour le texte on garde la bulle simple existante. */}
                          {msg.type === 'audio' && msg.audioUrl ? (
                            <ChatAudioMessage
                              audioUrl={msg.audioUrl}
                              durationSec={msg.audioDurationSec}
                              isMe={isMe}
                            />
                          ) : (
                            <div
                              className={cn(
                                "rounded-2xl px-3.5 py-2.5",
                                isMe
                                  ? "bg-accent text-white rounded-br-md"
                                  : "bg-zinc-800 text-gray-200 rounded-bl-md"
                              )}
                            >
                              <p className="text-sm font-light leading-relaxed">{msg.text}</p>
                            </div>
                          )}
                          <div className={cn(
                            "flex items-center gap-1 mt-0.5 px-1",
                            isMe ? "justify-end" : "justify-start"
                          )}>
                            <span className="text-[11px] text-gray-600 font-light">{time}</span>
                            {isMe && (
                              isRead
                                ? <CheckCheck className="h-3 w-3 text-accent" />
                                : <Check className="h-3 w-3 text-gray-600" />
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSend}
            className="px-4 py-3 border-t border-zinc-800 bg-black/90 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2">
              {/* BUG #36 COMMIT 2 — Bouton "Inviter à une activité" */}
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={handleOpenActivitySelector}
                disabled={sending || sendingInvite}
                aria-label="Inviter à une activité"
                className="h-10 w-10 rounded-xl bg-zinc-900 border-zinc-800 text-accent hover:bg-accent/10 hover:border-accent/40 disabled:opacity-50 flex-shrink-0"
              >
                <Calendar className="h-4 w-4" />
              </Button>
              <Input
                ref={inputRef}
                placeholder={insufficientCredits ? 'Crédits épuisés — top-up requis' : 'Votre message...'}
                className="flex-1 bg-zinc-900 border-zinc-800 text-white placeholder:text-gray-600 font-light h-10 rounded-xl focus-visible:ring-accent/30"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={sending || insufficientCredits}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || sending || insufficientCredits}
                className="h-10 w-10 rounded-xl bg-accent text-white hover:opacity-90 disabled:opacity-30 flex-shrink-0"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
              {/* BUG #74 — Bouton enregistrement audio à droite du send. Icone
                  AudioLines (waveform) cohérente maquette Bassi. Coût audioCost
                  affiché sur le bouton send du preview. */}
              <ChatAudioRecorder
                costCredits={audioCost}
                availableCredits={credits}
                onRecorded={handleSendAudio}
                disabled={sending || isLocked}
              />
            </div>
            {/* Phase 8 SC1 commit 4/5 — visual hint subtle 1 crédit/message + CTA top-up */}
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-[11px] text-white/30 font-light">
                {insufficientCredits ? '0 crédit · envoi désactivé' : '1 crédit consommé par message'}
              </span>
              {insufficientCredits && (
                <Link
                  href="/payment"
                  className="text-[11px] text-accent hover:underline font-light"
                >
                  Top-up →
                </Link>
              )}
            </div>
          </form>
        </>
      )}

      {/* BUG #36 COMMIT 2 — Modals activity_invite */}
      <ActivitySelectorModal
        open={activitySelectorOpen}
        onOpenChange={setActivitySelectorOpen}
        onSelect={handleActivityPicked}
      />
      <InviteModeModal
        open={inviteModeOpen}
        onOpenChange={(o) => {
          if (!o) {
            setPendingInviteActivity(null);
            setPendingHasFutureSession(true);
            setPendingPricePerSeatCHF(undefined);
          }
          setInviteModeOpen(o);
        }}
        activityTitle={pendingInviteActivity?.activityTitle ?? ''}
        hasFutureSession={pendingHasFutureSession}
        pricePerSeatCHF={pendingPricePerSeatCHF}
        onSelectMode={handleInviteModePicked}
      />
    </div>
  );
}

// ——— Empty State (no conversation selected) ———
function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-5">
        <MessageCircle className="h-7 w-7 text-gray-700" />
      </div>
      <p className="text-gray-400 font-light">Sélectionnez une conversation</p>
      <p className="text-sm text-gray-600 font-light mt-1">
        Choisissez un match pour commencer à discuter
      </p>
    </div>
  );
}

// ——— Main Chat Page ———
function ChatPageContent() {
  const { user } = useAuth();
  const { hasCredits, requireCreditsForChat, credits: creditCount } = useCredits();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileCache, setProfileCache] = useState<Record<string, UserProfile | null>>({});
  const [paymentHandled, setPaymentHandled] = useState(false);
  // Mobile: show list or chat
  const [showMobileChat, setShowMobileChat] = useState(false);

  const currentUserId = user?.uid || '';

  // Handle post-payment redirect: auto-select the match and unlock chat
  useEffect(() => {
    if (!requireCreditsForChat()) return;
  }, []);

  useEffect(() => {
    if (paymentHandled) return;
    // BUG #14 — Avant ce fix la condition était hardcoded
    // `paymentStatus === 'success' && matchIdParam` → le flow direct-paid
    // (discovery → /api/chat/unlock-direct → redirect `/chat?match=ID` sans
    // payment param) ne sélectionnait jamais la conv → user voyait le
    // placeholder vide après avoir débité 5 crédits. Désormais centralisé
    // dans resolveChatUrlAction qui select dès qu'un match param est présent,
    // et n'ajoute unlock+toast que pour le legacy payment=success.
    const action = resolveChatUrlAction(
      searchParams.get('match'),
      searchParams.get('payment'),
    );

    if (!action.shouldSelect || !action.matchId) return;

    setPaymentHandled(true);
    setSelectedMatchId(action.matchId);
    setShowMobileChat(true);

    if (action.shouldUnlock) {
      // Legacy post-payment Stripe : webhook devrait avoir set chatUnlocked,
      // mais on garantit côté client en defense-in-depth.
      unlockChat(action.matchId).catch((err) => {
        console.warn('[Chat] unlockChat client-side error (webhook may handle it):', err);
      });
    }

    if (action.shouldShowPaymentToast) {
      toast({
        title: "Paiement confirmé ! 🎉",
        description: "Le chat est débloqué, commencez à discuter !",
      });
    }

    // BUG #36 C4 — Mode Duo callbacks Stripe Checkout success/cancel
    const duoSuccess = searchParams.get('duoInviteSuccess');
    const duoCancelled = searchParams.get('duoInviteCancelled');
    if (duoSuccess === 'true') {
      toast({
        title: 'Invitation Duo envoyée 💝',
        description: '2 places réservées. Ton ami n\'a plus qu\'à accepter.',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } else if (duoCancelled === 'true') {
      toast({
        title: 'Paiement annulé',
        description: "Aucune invitation envoyée. Tu peux réessayer.",
        variant: 'destructive',
      });
    }

    // Clean the URL (préserve ?match=X pour que conv reste sélectionnée)
    router.replace(`/chat${action.matchId ? `?match=${action.matchId}` : ''}`);
  }, [searchParams, paymentHandled]);

  // Load matches and build conversation list
  const loadConversations = useCallback(async () => {
    if (!currentUserId) return;

    try {
      const matches = await getUserMatches(currentUserId);

      // Phase 7 sub-chantier 2 commit 4/4 : filter mutual blocks (doctrine §9.sexies E)
      const blockSet = await getMutualBlockSet(currentUserId).catch((err) => {
        console.warn('[Chat] getMutualBlockSet failed (non-blocking, defaulting empty)', err);
        return new Set<string>();
      });

      // Only show accepted matches or matches with chat unlocked, and exclude mutual blocks
      const relevantMatches = matches.filter((m) => {
        if (!(m.status === 'accepted' || m.chatUnlocked)) return false;
        const otherUid = m.userIds.find((id) => id !== currentUserId);
        if (otherUid && blockSet.has(otherUid)) return false;
        return true;
      });

      // Fetch other user profiles + chat docs (pour unreadCount + lastMessage)
      // Fix #120 — Avant : unreadCount: 0 hardcodé, badge jamais affiché.
      // Maintenant : lit chats/{matchId}.unreadCount[currentUserId] +
      // lastMessage + lastMessageAt pour cohérent avec ce qu'écrit sendMessage
      // dans firestore.ts (post-batch updateDoc chat.lastMessage/unreadCount).
      const convos: ConversationItem[] = [];
      for (const match of relevantMatches) {
        const otherUid = match.userIds.find((id) => id !== currentUserId) || '';
        let profile = profileCache[otherUid];

        if (profile === undefined) {
          profile = await getUser(otherUid);
          setProfileCache((prev) => ({ ...prev, [otherUid]: profile }));
        }

        // BUG #24 — defensive via buildOtherUser helper. Avant : accès direct
        // `match.user1.uid` throw si user1 absent (cas direct-paid match créé par
        // /api/chat/unlock-direct fix #14). Le throw était swallowé par outer
        // catch → conversations=[] → "0 conversations actives" alors que 5
        // crédits débités. Le helper utilise ?. partout pour ne plus throw.
        const otherUser = buildOtherUser(profile, match, otherUid);

        // Fix #120 — Lecture chat doc pour unreadCount + lastMessage.
        // Best-effort : si le doc chat n'existe pas (legacy avant Phase 9.5),
        // fallback sur unreadCount:0 + lastMessage:''.
        let unreadCount = 0;
        let lastMessage = '';
        let lastMessageAt: Date | null = match.createdAt
          ? match.createdAt instanceof Timestamp ? match.createdAt.toDate() : null
          : null;
        try {
          if (!db) throw new Error('db not initialized');
          const chatSnap = await getDoc(doc(db, 'chats', match.matchId));
          if (chatSnap.exists()) {
            const chatData = chatSnap.data();
            const unreadMap = chatData.unreadCount as Record<string, number> | undefined;
            unreadCount = unreadMap?.[currentUserId] ?? 0;
            lastMessage = (chatData.lastMessage as string | undefined) ?? '';
            const lastTs = chatData.lastMessageAt;
            if (lastTs instanceof Timestamp) {
              lastMessageAt = lastTs.toDate();
            }
          }
        } catch (err) {
          console.warn('[Chat] read chat doc failed (non-bloquant)', { matchId: match.matchId, err });
        }

        convos.push({
          match,
          otherUser,
          lastMessage,
          lastMessageAt,
          unreadCount,
        });
      }

      // Sort: unlocked first, then by date
      convos.sort((a, b) => {
        if (a.match.chatUnlocked !== b.match.chatUnlocked) {
          return a.match.chatUnlocked ? -1 : 1;
        }
        const dateA = a.lastMessageAt?.getTime() || 0;
        const dateB = b.lastMessageAt?.getTime() || 0;
        return dateB - dateA;
      });

      setConversations(convos);
    } catch (err) {
      console.error('[Chat] Erreur chargement conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, profileCache]);

  useEffect(() => {
    loadConversations();
  }, [currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedConvo = conversations.find((c) => c.match.matchId === selectedMatchId);

  const handleSelectConversation = (matchId: string) => {
    setSelectedMatchId(matchId);
    setShowMobileChat(true);
  };

  const handleBack = () => {
    setShowMobileChat(false);
    setSelectedMatchId(null);
    // Refresh conversations to update unread counts
    loadConversations();
  };

  return (
    <div className="h-[calc(100vh-4rem)] bg-black flex">
      {/* Sidebar - Conversation List */}
      <div
        className={cn(
          "w-full md:w-80 lg:w-96 border-r border-zinc-800 flex flex-col",
          showMobileChat ? "hidden md:flex" : "flex"
        )}
      >
        <div className="px-4 py-4 border-b border-zinc-800">
          <h1 className="text-lg text-white font-light">Messages</h1>
          <p className="text-xs text-gray-600 font-light mt-0.5">
            {conversations.filter((c) => c.match.chatUnlocked).length} conversation{conversations.filter((c) => c.match.chatUnlocked).length !== 1 ? 's' : ''} active{conversations.filter((c) => c.match.chatUnlocked).length !== 1 ? 's' : ''}
          </p>
        </div>
        <ConversationList
          conversations={conversations}
          selectedId={selectedMatchId}
          onSelect={handleSelectConversation}
          loading={loading}
        />
      </div>

      {/* Main Chat Area */}
      <div
        className={cn(
          "flex-1 flex flex-col",
          !showMobileChat ? "hidden md:flex" : "flex"
        )}
      >
        {selectedConvo ? (
          <ChatWindow
            match={selectedConvo.match}
            otherUser={selectedConvo.otherUser}
            currentUserId={currentUserId}
            credits={creditCount}
            onBack={handleBack}
          />
        ) : (
          <EmptyChat />
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <AuthGuard>
      <ChatPageContent />
    </AuthGuard>
  );
}
