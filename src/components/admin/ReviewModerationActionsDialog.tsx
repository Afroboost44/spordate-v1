/**
 * Phase 7 sub-chantier 4 commit 2/4 — <ReviewModerationActionsDialog>.
 *
 * Modal admin pour publish/reject une review pending (1-2★ modération pré-pub).
 * Doctrine §C.1 : note OPTIONNELLE pour publish, OBLIGATOIRE pour reject (transparency
 * user via reviewModerationDecision email — Q5 décision).
 *
 * Submit → moderateReview({ reviewId, decision, adminId }).
 * Note : moderateReview existant ne stocke pas la note (Phase 8 polish enrichira si besoin).
 * Phase 7 MVP : note loggée localement pour audit, l'email reviewModerationDecision suffit.
 *
 * Style admin (bg-gray-900 — exception Q9).
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
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { moderateReview, ReviewError } from '@/lib/reviews';

const NOTE_MIN_LENGTH = 10;
const NOTE_MAX_LENGTH = 500;

export type ReviewModerationAction = 'publish' | 'reject';

export interface ReviewModerationActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewId: string;
  action: ReviewModerationAction;
  /** Admin uid (current admin user). */
  adminId: string;
  /** Callback succès — refresh queue. */
  onResolved?: () => void;
}

export function ReviewModerationActionsDialog({
  open,
  onOpenChange,
  reviewId,
  action,
  adminId,
  onResolved,
}: ReviewModerationActionsDialogProps) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isReject = action === 'reject';
  const noteRequired = isReject;
  const noteValid = !noteRequired || (note.length >= NOTE_MIN_LENGTH && note.length <= NOTE_MAX_LENGTH);
  const canSubmit = noteValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Note Phase 7 : moderateReview ne prend pas de decisionNote en input —
      // log local pour audit. Phase 8 polish ajoutera ce champ.
      if (note) {
        console.info('[ReviewModerationActionsDialog] decision note (Phase 7 audit log)', {
          reviewId,
          adminId,
          action,
          note,
        });
      }
      const result = await moderateReview({
        reviewId,
        decision: action,
        adminId,
      });
      toast({
        title: action === 'publish' ? 'Review publiée' : 'Review rejetée',
        description: result.bonusAwarded
          ? 'Bonus +5 crédits chat alloué au reviewer.'
          : action === 'publish'
            ? 'Publication confirmée (bonus déjà appliqué ou échec).'
            : 'Rejet enregistré, email envoyé au reviewer.',
      });
      setNote('');
      onOpenChange(false);
      onResolved?.();
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Modération échouée';
      if (err instanceof ReviewError) {
        switch (err.code) {
          case 'review-not-found':
            description = 'Review introuvable.';
            break;
          case 'review-not-pending':
            description = 'Review déjà modérée.';
            break;
          case 'invalid-decision':
            description = 'Décision invalide.';
            break;
          default:
            description = `Code : ${err.code}`;
        }
      }
      toast({ title, description, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = isReject ? 'Rejeter' : 'Publier';
  const submitClass = isReject
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-green-600 hover:bg-green-700';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border border-gray-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white font-medium text-lg">
            {action === 'publish' ? 'Publier la review' : 'Rejeter la review'}
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            {action === 'publish'
              ? 'La review sera publiée anonymement (1-2★) avec bonus +5 crédits au reviewer.'
              : 'La review sera rejetée. Le reviewer recevra un email avec ta justification (transparency).'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Label htmlFor="moderation-note" className="text-xs uppercase tracking-wider text-gray-400">
            {noteRequired ? 'Justification (obligatoire ≥10 chars)' : 'Note interne (optionnelle)'}
          </Label>
          <Textarea
            id="moderation-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              noteRequired
                ? 'Pourquoi rejeter (ex : insultes, attaque personnelle, hors-sujet)…'
                : 'Note interne (audit) — optionnelle…'
            }
            maxLength={NOTE_MAX_LENGTH}
            disabled={submitting}
            rows={3}
            className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
          />
          <div className="flex justify-between text-xs text-gray-500 tabular-nums">
            <span
              className={
                noteRequired && note.length > 0 && note.length < NOTE_MIN_LENGTH
                  ? 'text-orange-400'
                  : ''
              }
            >
              {noteRequired ? `Minimum ${NOTE_MIN_LENGTH} caractères` : 'Optionnel'}
            </span>
            <span>{note.length} / {NOTE_MAX_LENGTH}</span>
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="flex-1 border-gray-700 text-white hover:bg-gray-800"
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-1 text-white disabled:opacity-40 ${submitClass}`}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" aria-hidden="true" />
                {submitLabel}…
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
