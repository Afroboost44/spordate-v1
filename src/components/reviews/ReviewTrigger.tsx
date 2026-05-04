/**
 * Spordateur — Phase 7 sub-chantier 1 commit 4/6
 * <ReviewTrigger> — Client component qui orchestre le flow review sur les pages
 * activity/profile.
 *
 * Logique :
 * 1. Au mount → isEligibleToReview(currentUser, activityId, revieweeId)
 * 2. Loading (eligible=null) : rien affiché (skeleton optionnel Phase 9 polish)
 * 3. Eligible : bouton "Laisser un avis" + ReviewForm modal state
 * 4. Not eligible : message discret selon reason :
 *    - 'self-review' / 'no-shared-session' → hidden (silent, pas de noise UX)
 *    - 'already-reviewed' → "Tu as déjà laissé un avis pour cette activité."
 *    - 'cooling-off-active' → "Tu pourras laisser un avis dans Xh." (countdown depuis cooldownEndsAt)
 *    - 'window-closed' → "La fenêtre pour laisser un avis est fermée."
 * 5. onSuccess → toast + router.refresh() (revalide la page pour montrer la review fresh)
 *
 * Charte stricte : bouton CTA #D91CD2 fond + text-black, message discret text-white/50 italic.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { isEligibleToReview, type EligibilityReason } from '@/lib/reviews';
import { ReviewForm } from './ReviewForm';

export interface ReviewTriggerProps {
  activityId: string;
  revieweeId: string;
  /** Nom du reviewé pour le titre du dialog (ex: "Marie"). Optionnel. */
  revieweeName?: string;
  className?: string;
}

function formatHoursLeft(cooldownEndsAtMs: number): string {
  const diffMs = cooldownEndsAtMs - Date.now();
  const h = Math.ceil(diffMs / (1000 * 60 * 60));
  if (h <= 0) return 'quelques minutes';
  if (h === 1) return '1h';
  return `${h}h`;
}

export function ReviewTrigger({
  activityId,
  revieweeId,
  revieweeName,
  className = '',
}: ReviewTriggerProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [reason, setReason] = useState<EligibilityReason | undefined>();
  const [cooldownEndsAtMs, setCooldownEndsAtMs] = useState<number | undefined>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      setEligible(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await isEligibleToReview({
          userId: user.uid,
          activityId,
          revieweeId,
        });
        if (cancelled) return;
        setEligible(result.eligible);
        setReason(result.reason);
        setCooldownEndsAtMs(result.cooldownEndsAt?.toMillis());
      } catch (err) {
        if (cancelled) return;
        console.error('[ReviewTrigger] eligibility check failed', err);
        setEligible(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, activityId, revieweeId]);

  // 1. Loading state — pas de flash UI
  if (eligible === null) return null;

  // 2. User non authentifié — hidden (pas de prompt login depuis ReviewTrigger Phase 7)
  if (!user) return null;

  // 3. Reasons silent (pas de noise UX) : self-review ou no-shared-session
  if (!eligible && (reason === 'self-review' || reason === 'no-shared-session')) {
    return null;
  }

  // 4. Reasons avec message discret
  if (!eligible && reason === 'already-reviewed') {
    return (
      <p className={`text-xs text-white/50 font-light italic ${className}`}>
        Tu as déjà laissé un avis pour cette activité.
      </p>
    );
  }
  if (!eligible && reason === 'cooling-off-active') {
    const wait = cooldownEndsAtMs ? formatHoursLeft(cooldownEndsAtMs) : '24h';
    return (
      <p className={`text-xs text-white/50 font-light italic ${className}`}>
        Tu pourras laisser un avis dans {wait} (cooling-off de 24h après la session).
      </p>
    );
  }
  if (!eligible && reason === 'window-closed') {
    return (
      <p className={`text-xs text-white/50 font-light italic ${className}`}>
        La fenêtre pour laisser un avis sur cette activité est fermée (&gt;7 jours).
      </p>
    );
  }

  // 5. Eligible — bouton + modal
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className={`bg-[#D91CD2] text-black font-medium hover:bg-[#D91CD2]/90 ${className}`}
      >
        <Star className="h-4 w-4 mr-2" aria-hidden="true" />
        Laisser un avis
      </Button>
      <ReviewForm
        activityId={activityId}
        reviewerId={user.uid}
        revieweeId={revieweeId}
        revieweeName={revieweeName}
        open={open}
        onOpenChange={setOpen}
        onSuccess={() => {
          toast({
            title: 'Avis envoyé',
            description: 'Merci pour ton retour !',
          });
          router.refresh();
        }}
      />
    </>
  );
}
