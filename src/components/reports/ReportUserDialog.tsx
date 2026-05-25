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
import { useLanguage } from '@/context/LanguageContext';
import { createReport, FREETEXT_MIN_LENGTH, ReportError } from '@/lib/reports';
import type { ReportCategory } from '@/types/firestore';

const FREETEXT_MAX_LENGTH = 500;

interface CategoryOption {
  value: ReportCategory;
  /** i18n key for the label */
  labelKey: string;
  /** Tailwind class for priority dot. Cohérent doctrine §D.2 :
   *  rouge=urgente / orange=haute / jaune=moyenne / vert=basse. */
  dotClass: string;
}

const CATEGORIES: CategoryOption[] = [
  { value: 'harassment_sexuel', labelKey: 'report_user_cat_harassment', dotClass: 'bg-red-500' },
  { value: 'comportement_agressif', labelKey: 'report_user_cat_aggressive', dotClass: 'bg-orange-500' },
  { value: 'fake_profile', labelKey: 'report_user_cat_fake', dotClass: 'bg-yellow-500' },
  { value: 'substance_etat_problematique', labelKey: 'report_user_cat_substance', dotClass: 'bg-red-500' },
  { value: 'no_show', labelKey: 'report_user_cat_noshow', dotClass: 'bg-emerald-500' },
  { value: 'autre', labelKey: 'report_user_cat_other', dotClass: 'bg-yellow-500' },
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
  const { t } = useLanguage();
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
        ? t('report_user_success_auto_sanction')
        : t('report_user_success_pending');

      toast({
        title: t('report_user_success_title'),
        description: successDescription,
      });

      // Reset + close
      setCategory(null);
      setFreeText('');
      onOpenChange(false);
      onReported?.(result.reportId);
    } catch (err) {
      let title = t('report_user_error_title');
      let description = err instanceof Error ? err.message : t('report_user_error_default');

      if (err instanceof ReportError) {
        switch (err.code) {
          case 'self-report':
            title = t('report_user_error_self_title');
            description = t('report_user_error_self_desc');
            break;
          case 'no-shared-session':
            title = t('report_user_error_noshared_title');
            description = t('report_user_error_noshared_desc');
            break;
          case 'rate-limit-exceeded':
            title = t('report_user_error_ratelimit_title');
            description = t('report_user_error_ratelimit_desc');
            break;
          case 'report-window-closed':
            title = t('report_user_error_window_title');
            description = t('report_user_error_window_desc');
            break;
          case 'freetext-required':
            title = t('report_user_error_freetext_title');
            description = `${t('report_user_error_freetext_desc_prefix')} ${FREETEXT_MIN_LENGTH} ${t('report_user_error_freetext_desc_suffix')}`;
            break;
          case 'invalid-category':
            title = t('report_user_error_invcat_title');
            description = t('report_user_error_invcat_desc');
            break;
          default:
            description = `${t('report_user_error_code_prefix')} ${err.code}`;
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
            {t('report_user_dialog_title')} {targetName}
          </DialogTitle>
          <DialogDescription className="text-white/70 font-light leading-relaxed pt-2">
            {t('report_user_dialog_description')}
          </DialogDescription>
        </DialogHeader>

        <div className="border-l-2 border-accent pl-3 py-1 my-2 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-white/70 font-light leading-relaxed">
            {t('report_user_anon_prefix')} <span className="text-white">{t('report_user_anon_emph')}</span>. {targetName} {t('report_user_anon_suffix')}
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
                    ? 'border-accent bg-white/5'
                    : 'border-white/10 hover:bg-white/5'
                }`}
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`report-cat-${opt.value}`}
                  className="border-white/30 text-accent"
                />
                <span className={`h-2 w-2 rounded-full ${opt.dotClass}`} aria-hidden="true" />
                <span className="text-sm font-light text-white/90 flex-1">{t(opt.labelKey)}</span>
              </Label>
            ))}
          </RadioGroup>

          {needsFreeText && (
            <div className="flex flex-col gap-2 mt-2">
              <Label
                htmlFor="report-freetext"
                className="text-xs uppercase tracking-[0.18em] text-white/40 font-light"
              >
                {t('report_user_freetext_label')}
              </Label>
              <Textarea
                id="report-freetext"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder={t('report_user_freetext_placeholder')}
                maxLength={FREETEXT_MAX_LENGTH}
                disabled={submitting}
                rows={3}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent"
              />
              <div className="flex justify-between text-xs text-white/40 font-light tabular-nums">
                <span
                  className={
                    freeText.length > 0 && freeText.length < FREETEXT_MIN_LENGTH
                      ? 'text-accent'
                      : ''
                  }
                >
                  {t('report_user_freetext_minimum')} {FREETEXT_MIN_LENGTH} {t('report_user_freetext_chars')}
                </span>
                <span
                  className={freeText.length > FREETEXT_MAX_LENGTH * 0.9 ? 'text-accent' : ''}
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
            {t('report_user_cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 bg-accent text-black font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" aria-hidden="true" />
                {t('report_user_sending')}
              </>
            ) : (
              t('report_user_send')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
