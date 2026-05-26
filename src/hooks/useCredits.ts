import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/context/LanguageContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

const CREDIT_PACKS = {
  free: 0,
  populaire: 10,
  premium: 30,
} as const;

export type SubscriptionTier = keyof typeof CREDIT_PACKS;

export function useCredits() {
  const { user, userProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLanguage();

  // Real-time credits from Firestore (onSnapshot)
  const [liveCredits, setLiveCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.uid || !db) return;
    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setLiveCredits(snap.data()?.credits ?? 0);
      }
    }, (err) => {
      console.warn("[useCredits] onSnapshot error:", err);
    });
    return () => unsub();
  }, [user?.uid]);

  // Use live credits if available, fallback to profile
  const credits = liveCredits ?? userProfile?.credits ?? 0;
  const tier: SubscriptionTier = (userProfile as any)?.subscription ?? "free";
  const hasCredits = credits > 0;

  const useCredit = async (): Promise<boolean> => {
    if (!user || !hasCredits) {
      toast({
        title: `\u2764\uFE0F ${t('credits_insufficient')}`,
        description: t('credits_need_activity_reservation'),
        className: "bg-[#1A1A1A] border-[#D91CD2]/40 text-white",
      });
      router.push("/payment");
      return false;
    }

    // Hardening s\u00E9curit\u00E9 : le d\u00E9bit du solde passe d\u00E9sormais par
    // /api/credits/debit (Firebase Admin SDK + transaction Firestore).
    // Les Firestore rules bloquent toute \u00E9criture du champ `credits` depuis
    // le client (sauf admin), donc un updateDoc direct ici \u00E9chouerait.
    //
    // Optimistic UI : on baisse le compteur local pour un feedback imm\u00E9diat,
    // puis on attend la r\u00E9ponse serveur. Si l'API renvoie une erreur (solde
    // insuffisant 402, network, etc.), on revert via le state local + le
    // onSnapshot Firestore qui re-synchronisera dans la foul\u00E9e.
    const prevOptimistic = liveCredits;
    setLiveCredits((c) => (c == null ? c : Math.max(0, c - 1)));

    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/credits/debit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ amount: 1, reason: "like" }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Revert optimistic update.
        setLiveCredits(prevOptimistic);

        if (res.status === 402) {
          // Insufficient credits \u2014 push vers la page d'achat.
          toast({
            title: `\u2764\uFE0F ${t('credits_insufficient')}`,
            description: t('credits_need_activity_reservation'),
            className: "bg-[#1A1A1A] border-[#D91CD2]/40 text-white",
          });
          router.push("/payment");
          return false;
        }

        console.error("[useCredits] debit API error:", res.status, data);
        return false;
      }

      // Sync state with server response (onSnapshot will also catch up).
      if (typeof data?.newBalance === "number") {
        setLiveCredits(data.newBalance);
      }
      return true;
    } catch (err) {
      console.error("Credit decrement failed:", err);
      setLiveCredits(prevOptimistic);
      return false;
    }
  };

  const requireCreditsForChat = (): boolean => {
    if (!hasCredits) {
      toast({
        title: "\u26A1 Acces bloque",
        description: "Tu dois reserver une activite pour discuter.",
        className: "bg-[#1A1A1A] border-[#D91CD2]/40 text-white",
      });
      router.push("/payment");
      return false;
    }
    return true;
  };

  const canLike = hasCredits;
  const canSuperMatch = tier === "premium" && hasCredits;
  const canSkip = tier !== "free";

  return {
    credits,
    tier,
    hasCredits,
    useCredit,
    requireCreditsForChat,
    canLike,
    canSuperMatch,
    canSkip,
    CREDIT_PACKS,
  };
}
