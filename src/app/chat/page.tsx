"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Send, ArrowLeft, Lock, MessageCircle,
  Loader2, CreditCard, CheckCheck, Check, PartyPopper
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from '@/lib/utils';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { useToast } from "@/hooks/use-toast";
import {
  getUserMatches,
  sendMessage,
  subscribeToMessages,
  markMessagesRead,
  getUser,
  unlockChat,
} from '@/services/firestore';
import type { Match, ChatMessage, UserProfile } from '@/types/firestore';
import { Timestamp } from 'firebase/firestore';

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

        return (
          <button
            key={conv.match.matchId}
            onClick={() => onSelect(conv.match.matchId)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left",
              isSelected
                ? "bg-zinc-800/80 border-l-2 border-[#D91CD2]"
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
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white font-normal truncate">
                  {conv.otherUser.displayName}
                </span>
                {conv.lastMessageAt && (
                  <span className="text-xs text-gray-600 font-light ml-2 flex-shrink-0">
                    {formatTime(conv.lastMessageAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-gray-500 font-light truncate">
                  {isLocked
                    ? "Chat verrouillé"
                    : conv.lastMessage || `Match : ${conv.match.sport || 'Sport'}`}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="bg-[#D91CD2] text-white text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1.5 font-medium ml-2 flex-shrink-0">
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

// ——— Chat Window ———
function ChatWindow({
  match,
  otherUser,
  currentUserId,
  onBack,
}: {
  match: Match;
  otherUser: { uid: string; displayName: string; photoURL: string };
  currentUserId: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isLocked = !match.chatUnlocked;

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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending || isLocked) return;

    setSending(true);
    setInputValue('');

    try {
      await sendMessage(match.matchId, currentUserId, text);
    } catch (err) {
      console.error('[Chat] Erreur envoi:', err);
      setInputValue(text); // Restore on error
    } finally {
      setSending(false);
      inputRef.current?.focus();
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
        <Avatar className="h-9 w-9">
          <AvatarImage src={otherUser.photoURL} />
          <AvatarFallback className="bg-zinc-800 text-gray-400 text-sm">
            {getInitials(otherUser.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-normal truncate">{otherUser.displayName}</p>
          <p className="text-xs text-gray-500 font-light">
            {match.sport || 'Sport Date'}
          </p>
        </div>
      </div>

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
              className="bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white font-light hover:opacity-90"
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
              messages.map((msg) => {
                const isMe = msg.senderId === currentUserId;
                const isRead = msg.readBy?.includes(otherUser.uid);
                const time = msg.createdAt ? formatTime(msg.createdAt) : '';

                if (msg.type === 'system') {
                  return (
                    <div key={msg.messageId} className="flex justify-center my-2">
                      <span className="text-xs text-gray-600 font-light bg-zinc-900/50 px-3 py-1 rounded-full">
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.messageId}
                    className={cn(
                      "flex items-end gap-2",
                      isMe ? "justify-end" : "justify-start"
                    )}
                  >
                    {!isMe && (
                      <Avatar className="h-7 w-7 flex-shrink-0">
                        <AvatarImage src={otherUser.photoURL} />
                        <AvatarFallback className="bg-zinc-800 text-gray-500 text-xs">
                          {getInitials(otherUser.displayName)}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className={cn("max-w-[75%]")}>
                      <div
                        className={cn(
                          "rounded-2xl px-3.5 py-2.5",
                          isMe
                            ? "bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white rounded-br-md"
                            : "bg-zinc-800 text-gray-200 rounded-bl-md"
                        )}
                      >
                        <p className="text-sm font-light leading-relaxed">{msg.text}</p>
                      </div>
                      <div className={cn(
                        "flex items-center gap-1 mt-0.5 px-1",
                        isMe ? "justify-end" : "justify-start"
                      )}>
                        <span className="text-[11px] text-gray-600 font-light">{time}</span>
                        {isMe && (
                          isRead
                            ? <CheckCheck className="h-3 w-3 text-[#D91CD2]" />
                            : <Check className="h-3 w-3 text-gray-600" />
                        )}
                      </div>
                    </div>
                  </div>
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
              <Input
                ref={inputRef}
                placeholder="Votre message..."
                className="flex-1 bg-zinc-900 border-zinc-800 text-white placeholder:text-gray-600 font-light h-10 rounded-xl focus-visible:ring-[#D91CD2]/30"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={sending}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || sending}
                className="h-10 w-10 rounded-xl bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] text-white hover:opacity-90 disabled:opacity-30 flex-shrink-0"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
        </>
      )}
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
    if (paymentHandled) return;
    const paymentStatus = searchParams.get('payment');
    const matchIdParam = searchParams.get('match');

    if (paymentStatus === 'success' && matchIdParam) {
      setPaymentHandled(true);
      setSelectedMatchId(matchIdParam);
      setShowMobileChat(true);

      // Unlock chat from client side as a safety measure (webhook also does this)
      unlockChat(matchIdParam).catch((err) => {
        console.warn('[Chat] unlockChat client-side error (webhook may handle it):', err);
      });

      toast({
        title: "Paiement confirmé ! 🎉",
        description: "Le chat est débloqué, commencez à discuter !",
      });

      // Clean the URL
      router.replace('/chat');
    }
  }, [searchParams, paymentHandled]);

  // Load matches and build conversation list
  const loadConversations = useCallback(async () => {
    if (!currentUserId) return;

    try {
      const matches = await getUserMatches(currentUserId);
      // Only show accepted matches or matches with chat unlocked
      const relevantMatches = matches.filter(
        (m) => m.status === 'accepted' || m.chatUnlocked
      );

      // Fetch other user profiles
      const convos: ConversationItem[] = [];
      for (const match of relevantMatches) {
        const otherUid = match.userIds.find((id) => id !== currentUserId) || '';
        let profile = profileCache[otherUid];

        if (profile === undefined) {
          profile = await getUser(otherUid);
          setProfileCache((prev) => ({ ...prev, [otherUid]: profile }));
        }

        const otherUser = {
          uid: otherUid,
          displayName: profile?.displayName
            || (match.user1.uid === otherUid ? match.user1.displayName : match.user2.displayName)
            || 'Utilisateur',
          photoURL: profile?.photoURL
            || (match.user1.uid === otherUid ? match.user1.photoURL : match.user2.photoURL)
            || '',
        };

        convos.push({
          match,
          otherUser,
          lastMessage: '',
          lastMessageAt: match.createdAt ? (match.createdAt instanceof Timestamp ? match.createdAt.toDate() : null) : null,
          unreadCount: 0,
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
