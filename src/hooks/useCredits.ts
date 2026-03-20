import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { doc, updateDoc, increment, onSnapshot } from "firebase/firestore";
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
        title: "\u2764\uFE0F Pas de credits",
        description: "Reserve une activite pour pouvoir liker.",
        className: "bg-[#1A1A1A] border-[#D91CD2]/40 text-white",
      });
      router.push("/payment");
      return false;
    }
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { credits: increment(-1) });
      return true;
    } catch (err) {
      console.error("Credit decrement failed:", err);
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
