/**
 * Phase 7 sub-chantier 3 commit 4/5 — <ReportUserDialog>.
 *
 * Modal Dialog confirmation pour signaler un user. Affiche :
 * - Warning bloc anonymat (doctrine §9.sexies D.1 — reported NE saura JAMAIS qui)
 * - RadioGroup 6 catégories avec code couleur priorité doctrine §D.2
 * - Textarea conditionnelle si category='autre' (≥10 chars obligatoire, FREETEXT_MIN)
 *
 * Submit → createReport service avec gestion erreurs typées :
 *  - self-report → toast "Tu ne peux pas te signaler"
 *  - no-shared-session → toast "Vous n'avez pas partagé de session"
 *  - rate-limit-exceeded → toast "Limite atteinte (3/jour)"
 *  - report-window-closed → toast "Délai dépassé (>30j)"
 *  - freetext-required → focus textarea + erreur inline
 *  - autres → toast générique
 *
 * Charte stricte : Dialog black bg, accent #D91CD2 sur CTA Envoyer + warning border,
 * white/70 secondaire. Code couleur priorité = badges colorés doctrine (cohérent admin queue).
 *
 * Note : aucune notification au reporté (anonymat doctrine D.1).
 */

'use client';

import { useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { createReport, FREETEXT_MIN_LENGTH, ReportError } from '@/lib/reports';
import type { ReportCategory } from '@/types/firestore';

const FREETEXT_MAX_LENGTH = 500;

interface CategoryOption {
  value: ReportCategory;
  label: string;
  /** Tailwind class for priority dot. Cohérent doctrine §D.2 :
   *  rouge=urgente / orange=haute / jaune=moyenne / vert=basse. */
  dotClass: string;
}

const CATEGORIES: CategoryOption[] = [
  { value: 'harassment_sexuel', label: 'Harcèlement sexuel', dotClass: 'bg-red-500' },
  { value: 'comportement_agressif', label: 'Comportement agressif / violent', dotClass: 'bg-orange-500' },
  { value: 'fake_profile', label: 'Faux profil / usurpation', dotClass: 'bg-yellow-500' },
  { value: 'substance_etat_problematique', label: 'Substances / état problématique', dotClass: 'bg-red-500' },
  { value: 'no_show', label: 'No-show / Absence', dotClass: 'bg-emerald-500' },
  { value: 'autre', label: 'Autre (préciser)', dotClass: 'bg-yellow-500' },
];

export interface ReportUserDialogProps {
  /** UID cible du report. */
  targetUid: string;
  /** Nom affiché dans le titre. */
  targetName: string;
  /** UID utilisateur courant — caller responsabilité de fournir l'auth context. */
  currentUserId: string;
  /** Contrôlé par parent. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback succès — passe reportId. */
  onReported?: (reportId: string) => void;
}

export function ReportUserDialog({
  targetUid,
  targetName,
  currentUserId,
  open,
  onOpenChange,
  onReported,
}: ReportUserDialogProps) {
  const { toast } = useToast();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const needsFreeText = category === 'autre';
  const freeTextValid =
    !needsFreeText ||
    (freeText.length >= FREETEXT_MIN_LENGTH && freeText.length <= FREETEXT_MAX_LENGTH);
  const canSubmit = category !== null && freeTextValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || category === null) return;
    setSubmitting(true);
    try {
      const result = await createReport({
        reporterId: currentUserId,
        reportedId: targetUid,
        category,
        freeTextReason: needsFreeText ? freeText : undefined,
      });

      const successDescription = result.autoSanctionTriggered
        ? 'Signalement enregistré. Une action automatique a été déclenchée.'
        : 'Signalement enregistré. Notre équipe modération va l\'examiner.';

      toast({
        title: 'Merci pour ton signalement',
        description: successDescription,
      });

      // Reset + close
      setCategory(null);
      setFreeText('');
      onOpenChange(false);
      onReported?.(result.reportId);
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Signalement non envoyé';

      if (err instanceof ReportError) {
        switch (err.code) {
          case 'self-report':
            title = 'Impossible';
            description = 'Tu ne peux pas te signaler toi-même.';
            break;
          case 'no-shared-session':
            title = 'Pas de session partagée';
            description = 'Vous n\'avez pas partagé de session ensemble.';
            break;
          case 'rate-limit-exceeded':
            title = 'Limite atteinte';
            description = 'Tu as atteint la limite de 3 signalements par jour.';
            break;
          case 'report-window-closed':
            title = 'Délai dépassé';
            description = 'Le délai pour signaler est dépassé (>30 jours après la session).';
            break;
          case 'freetext-required':
            title = 'Précision requise';
            description = `Précise le motif (minimum ${FREETEXT_MIN_LENGTH} caractères).`;
            break;
          case 'invalid-category':
            title = 'Catégorie invalide';
            description = 'Catégorie de signalement invalide.';
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white font-light text-xl">
            Signaler {targetName}
          </DialogTitle>
          <DialogDescription className="text-white/70 font-light leading-relaxed pt-2">
            Choisis le motif du signalement.
          </DialogDescription>
        </DialogHeader>

        <div className="border-l-2 border-[#D91CD2] pl-3 py-1 my-2 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-[#D91CD2] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-white/70 font-light leading-relaxed">
            Ton signalement est <span className="text-white">100% anonyme</span>. {targetName} ne saura
            jamais qui l&apos;a signalé. Les abus de signalement sont sanctionnés.
          </p>
        </div>

        <div className="flex flex-col gap-3 py-2">
          <RadioGroup
            value={category ?? ''}
            onValueChange={(v) => setCategory(v as ReportCategory)}
            disabled={submitting}
            className="flex flex-col gap-2"
          >
            {CATEGORIES.map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`report-cat-${opt.value}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  category === opt.value
                    ? 'border-[#D91CD2] bg-white/5'
                    : 'border-white/10 hover:bg-white/5'
                }`}
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`report-cat-${opt.value}`}
                  className="border-white/30 text-[#D91CD2]"
                />
                <span className={`h-2 w-2 rounded-full ${opt.dotClass}`} aria-hidden="true" />
                <span className="text-sm font-light text-white/90 flex-1">{opt.label}</span>
              </Label>
            ))}
          </RadioGroup>

          {needsFreeText && (
            <div className="flex flex-col gap-2 mt-2">
              <Label
                htmlFor="report-freetext"
                className="text-xs uppercase tracking-[0.18em] text-white/40 font-light"
              >
                Précise le motif
              </Label>
              <Textarea
                id="report-freetext"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Décris brièvement le motif du signalement…"
                maxLength={FREETEXT_MAX_LENGTH}
                disabled={submitting}
                rows={3}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#D91CD2]"
              />
              <div className="flex justify-between text-xs text-white/40 font-light tabular-nums">
                <span
                  className={
                    freeText.length > 0 && freeText.length < FREETEXT_MIN_LENGTH
                      ? 'text-[#D91CD2]'
                      : ''
                  }
                >
                  Minimum {FREETEXT_MIN_LENGTH} caractères
                </span>
                <span
                  className={freeText.length > FREETEXT_MAX_LENGTH * 0.9 ? 'text-[#D91CD2]' : ''}
                >
                  {freeText.length} / {FREETEXT_MAX_LENGTH}
                </span>
              </div>
            </div>
          )}
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
