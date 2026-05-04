/**
 * Phase 7 sub-chantier 4 commit 2/4 — <SanctionPickerDialog>.
 *
 * Modal admin pour sustain un report avec sanction manuelle.
 * Doctrine §F : 4 niveaux warning / suspension_7d / suspension_30d / ban_permanent.
 *
 * Submit → sustainReport({ reportId, adminId, decisionNote, manualSanctionLevel }).
 * Note OBLIGATOIRE ≥10 chars (cohérent doctrine "décision motivée fair process").
 *
 * Style admin (bg-gray-900 — pas charte stricte user-facing, exception §Q9).
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ReportError, sustainReport } from '@/lib/reports';
import type { SanctionLevel } from '@/types/firestore';

const NOTE_MIN_LENGTH = 10;
const NOTE_MAX_LENGTH = 500;

interface LevelOption {
  value: SanctionLevel;
  label: string;
  description: string;
}

const LEVELS: LevelOption[] = [
  { value: 'warning', label: 'Avertissement', description: 'Flag interne, pas de restriction. Pas appealable.' },
  { value: 'suspension_7d', label: 'Suspension 7 jours', description: 'Compte gelé 7j. Appealable 1×.' },
  { value: 'suspension_30d', label: 'Suspension 30 jours', description: 'Compte gelé 30j + interdiction re-création même email.' },
  { value: 'ban_permanent', label: 'Ban permanent', description: 'Bannissement définitif. Revue annuelle automatique.' },
];

export interface SanctionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  /** Admin uid (current admin user). */
  adminId: string;
  /** Callback succès — passe sanctionId créé pour refresh local. */
  onSustained?: (sanctionId: string | undefined) => void;
}

export function SanctionPickerDialog({
  open,
  onOpenChange,
  reportId,
  adminId,
  onSustained,
}: SanctionPickerDialogProps) {
  const { toast } = useToast();
  const [level, setLevel] = useState<SanctionLevel | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const noteValid = note.length >= NOTE_MIN_LENGTH && note.length <= NOTE_MAX_LENGTH;
  const canSubmit = level !== null && noteValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || level === null) return;
    setSubmitting(true);
    try {
      const result = await sustainReport({
        reportId,
        adminId,
        decisionNote: note,
        manualSanctionLevel: level,
      });
      toast({
        title: 'Report soutenu',
        description: `Sanction "${level}" appliquée. SanctionId : ${result.manualSanctionId ?? '—'}`,
      });
      setLevel(null);
      setNote('');
      onOpenChange(false);
      onSustained?.(result.manualSanctionId);
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Sustain échoué';
      if (err instanceof ReportError) {
        switch (err.code) {
          case 'not-admin':
            title = 'Non autorisé';
            description = 'Seul un admin peut sustain un report.';
            break;
          case 'report-not-found':
            description = 'Report introuvable.';
            break;
          case 'report-not-pending':
            description = 'Report déjà résolu.';
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border border-gray-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white font-medium text-lg">
            Sustain report — sanction manuelle
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            Choisis le niveau de sanction et motive la décision (audit + transparency user).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <RadioGroup
            value={level ?? ''}
            onValueChange={(v) => setLevel(v as SanctionLevel)}
            disabled={submitting}
            className="flex flex-col gap-2"
          >
            {LEVELS.map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`sanction-${opt.value}`}
                className={`flex items-start gap-3 px-3 py-2.5 rounded border cursor-pointer transition-colors ${
                  level === opt.value
                    ? 'border-[#D91CD2] bg-gray-800'
                    : 'border-gray-700 hover:bg-gray-800/60'
                }`}
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`sanction-${opt.value}`}
                  className="border-gray-500 mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-white font-medium">{opt.label}</span>
                  <span className="text-xs text-gray-400 font-light">{opt.description}</span>
                </div>
              </Label>
            ))}
          </RadioGroup>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sustain-note" className="text-xs uppercase tracking-wider text-gray-400">
              Justification motivée (obligatoire)
            </Label>
            <Textarea
              id="sustain-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Motive la décision (audit + transparency user)…"
              maxLength={NOTE_MAX_LENGTH}
              disabled={submitting}
              rows={3}
              className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
            />
            <div className="flex justify-between text-xs text-gray-500 tabular-nums">
              <span className={note.length > 0 && note.length < NOTE_MIN_LENGTH ? 'text-orange-400' : ''}>
                Minimum {NOTE_MIN_LENGTH} caractères
              </span>
              <span>{note.length} / {NOTE_MAX_LENGTH}</span>
            </div>
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
            className="flex-1 bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" aria-hidden="true" />
                Application…
              </>
            ) : (
              'Sustain + sanctionner'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
