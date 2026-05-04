/**
 * Spordateur — Phase 7 sub-chantier 1 commit 3/6
 * <ReviewForm> — modal Dialog pour saisir une review (note + commentaire).
 *
 * Workflow :
 * 1. User pick rating 1-5 (StarRatingInput) + saisit commentaire
 * 2. Disclaimer affiché si rating sélectionné ≤ 2 :
 *    "Les notes 1-2★ sont publiées anonymement après modération."
 * 3. Submit → createReview service. Loading state.
 * 4. Errors typées (ReviewError) → toast adapté :
 *    - cooling-off-not-elapsed → "Tu pourras laisser un avis dans Xh" (countdown depuis err.cause)
 *    - review-window-closed → "La fenêtre est fermée (>7j)"
 *    - review-already-exists → "Tu as déjà laissé un avis"
 *    - reviewer-equals-reviewee → "Impossible de te reviewer toi-même"
 *    - no-shared-session → "Tu n'as pas partagé de session avec cette personne"
 *    - autres → toast générique
 * 5. Success → toast + onSuccess callback
 *
 * Charte stricte : Dialog black bg, accent #D91CD2 sur CTA, text white/70 secondaire.
 *
 * Cohérent doctrine §9.sexies C.1 (anonymisation graduée mentionnée explicitement
 * pour transparence user au moment de l'écriture).
 */

'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { createReview, ReviewError } from '@/lib/reviews';
import type { ReviewRating } from '@/types/firestore';
import { StarRatingInput } from './StarRatingInput';

const COMMENT_MIN = 10;
const COMMENT_MAX = 500;

export interface ReviewFormProps {
  activityId: string;
  /** UID du reviewer (current user) — caller responsabilité de fournir l'auth context. */
  reviewerId: string;
  revieweeId: string;
  /** Nom du reviewé pour le titre du dialog (ex: "Reviewer Marie"). */
  revieweeName?: string;
  /** Contrôlé par parent. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback succès — passe reviewId + status pour permettre redirect ou refresh. */
  onSuccess?: (reviewId: string, status: 'published' | 'pending') => void;
}

function formatHoursLeft(coolingOffEndMs: number): string {
  const ms = coolingOffEndMs - Date.now();
  const h = Math.ceil(ms / (1000 * 60 * 60));
  if (h <= 0) return 'quelques minutes';
  if (h === 1) return '1h';
  return `${h}h`;
}

export function ReviewForm({
  activityId,
  reviewerId,
  revieweeId,
  revieweeName,
  open,
  onOpenChange,
  onSuccess,
}: ReviewFormProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const commentLength = comment.length;
  const commentValid = commentLength >= COMMENT_MIN && commentLength <= COMMENT_MAX;
  const ratingValid = rating !== null && rating >= 1 && rating <= 5;
  const canSubmit = ratingValid && commentValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || rating === null) return;

    setSubmitting(true);
    try {
      const result = await createReview({
        activityId,
        reviewerId,
        revieweeId,
        rating: rating as ReviewRating,
        comment,
      });

      const successMsg =
        result.status === 'published'
          ? 'Avis publié — merci ! +5 crédits chat ajoutés.'
          : 'Avis envoyé — il sera publié après modération.';
      toast({
        title: 'Avis envoyé',
        description: successMsg,
      });

      // Reset form
      setRating(null);
      setComment('');
      onOpenChange(false);
      onSuccess?.(result.reviewId, result.status);
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Avis non envoyé';

      if (err instanceof ReviewError) {
        switch (err.code) {
          case 'cooling-off-not-elapsed': {
            const coolingOffEndMs = err.details?.coolingOffEndMs as number | undefined;
            const wait = coolingOffEndMs ? formatHoursLeft(coolingOffEndMs) : '24h';
            title = 'Trop tôt pour laisser un avis';
            description = `Tu pourras laisser un avis dans ${wait} (cooling-off de 24h après la session).`;
            break;
          }
          case 'review-window-closed':
            title = 'Fenêtre fermée';
            description = 'La fenêtre pour laisser un avis sur cette session est fermée (>7 jours).';
            break;
          case 'review-already-exists':
            title = 'Avis déjà existant';
            description = 'Tu as déjà laissé un avis pour cette activité.';
            break;
          case 'reviewer-equals-reviewee':
            title = 'Impossible';
            description = 'Tu ne peux pas te reviewer toi-même.';
            break;
          case 'no-shared-session':
            title = 'Pas de session partagée';
            description = 'Tu n\'as pas encore participé à une session avec cette personne.';
            break;
          case 'comment-too-short':
            title = 'Commentaire trop court';
            description = `Minimum ${COMMENT_MIN} caractères.`;
            break;
          case 'comment-too-long':
            title = 'Commentaire trop long';
            description = `Maximum ${COMMENT_MAX} caractères.`;
            break;
          case 'rating-out-of-range':
            title = 'Note invalide';
            description = 'La note doit être entre 1 et 5 étoiles.';
            break;
          default:
            description = `Code : ${err.code}`;
        }
      }

      toast({
        title,
        description,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Disclaimer si rating ≤ 2 sélectionné
  const showLowRatingDisclaimer = rating !== null && rating <= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white font-light text-xl">
            Comment s&apos;est passée ta session ?
          </DialogTitle>
          <DialogDescription className="text-white/70 font-light">
            {revieweeName ? `Avis sur ${revieweeName}.` : 'Partage ton ressenti.'} 30 secondes
            suffisent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-4">
          {/* Star input */}
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.18em] text-white/40 font-light">
              Note
            </label>
            <StarRatingInput value={rating} onChange={setRating} size="lg" disabled={submitting} />
          </div>

          {/* Disclaimer 1-2★ */}
          {showLowRatingDisclaimer && (
            <p className="text-xs text-white/70 font-light leading-relaxed border-l-2 border-[#D91CD2] pl-3">
              Les notes 1-2★ sont publiées anonymement après modération de notre équipe (sous 72h).
              Cf. CGU section 7.ter.
            </p>
          )}

          {/* Comment textarea */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="review-comment"
              className="text-xs uppercase tracking-[0.18em] text-white/40 font-light"
            >
              Commentaire
            </label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Décris ton expérience en quelques mots…"
              maxLength={COMMENT_MAX}
              disabled={submitting}
              rows={4}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#D91CD2]"
            />
            <div className="flex justify-between text-xs text-white/40 font-light tabular-nums">
              <span
                className={
                  commentLength > 0 && commentLength < COMMENT_MIN
                    ? 'text-[#D91CD2]'
                    : ''
                }
              >
                Minimum {COMMENT_MIN} caractères
              </span>
              <span
                className={commentLength > COMMENT_MAX * 0.9 ? 'text-[#D91CD2]' : ''}
              >
                {commentLength} / {COMMENT_MAX}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="flex-1 border-white/10 text-white hover:bg-white/5"
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 bg-[#D91CD2] text-black font-medium hover:bg-[#D91CD2]/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" aria-hidden="true" />
                Envoi…
              </>
            ) : (
              'Envoyer'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
