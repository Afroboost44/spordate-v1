import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { doc, updateDoc, increment } from "firebase/firestore";
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

  const credits = userProfile?.credits ?? 0;
  const tier: SubscriptionTier = (userProfile as any)?.subscription ?? "free";
  const hasCredits = credits > 0;

  const useCredit = async (): Promise<boolean> => {
    if (!user || !hasCredits) {
      toast({
        variant: "destructive",
        title: "Pas de credits",
        description: "Reserve une activite pour pouvoir liker.",
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
        variant: "destructive",
        title: "Acces bloque",
        description: "Tu dois reserver une activite pour discuter.",
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
