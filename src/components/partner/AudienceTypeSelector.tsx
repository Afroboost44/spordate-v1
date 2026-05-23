/**
 * Phase 9 sub-chantier 6 commit 1/4 — <AudienceTypeSelector>.
 *
 * RadioGroup partner pour choisir audienceType d'une activity (Phase 9 UI activation
 * cohérent doctrine §9.sexies G + ligne 898).
 *
 * 4 options (Q1=A enum existing) :
 *  - 'all' (défaut) : tous publics
 *  - 'mixed-priority-women' (recommandé) : mixte avec priorité visibilité femmes Phase 10
 *  - 'women-only' : femmes uniquement (hard enforcement booking SC6 c2)
 *  - 'men-only' : hommes uniquement (hard enforcement booking SC6 c2)
 *
 * Helper text LCD Art. 3 + nLPD recommendations.
 *
 * Charte stricte (cohérent SC0 c2 admin / SC4 patterns) : black/#D91CD2/white.
 */

'use client';

import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Info, Users, Star, User } from 'lucide-react';
import type { AudienceType } from '@/lib/audience';
import type { LucideIcon } from 'lucide-react';

interface AudienceOption {
  value: AudienceType;
  label: string;
  description: string;
  recommended?: boolean;
  icon: LucideIcon;
}

// BUG #59 — micro-icônes visuelles à côté de chaque option audience (Users
// pour mixte, Star pour priorité femmes, User pour single gender).
const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    value: 'all',
    label: 'Tous publics',
    description: 'Aucune restriction — défaut.',
    icon: Users,
  },
  {
    value: 'mixed-priority-women',
    label: 'Mixte priorité femmes',
    description: 'Mixte mais visibilité boostée pour les femmes (Phase 10).',
    recommended: true,
    icon: Star,
  },
  {
    value: 'women-only',
    label: 'Femmes uniquement',
    description: 'Réservé aux participantes (booking strict).',
    icon: User,
  },
  {
    value: 'men-only',
    label: 'Hommes uniquement',
    description: 'Réservé aux participants (booking strict).',
    icon: User,
  },
];

export interface AudienceTypeSelectorProps {
  value: AudienceType | undefined;
  onChange: (value: AudienceType) => void;
  disabled?: boolean;
}

export function AudienceTypeSelector({
  value,
  onChange,
  disabled,
}: AudienceTypeSelectorProps) {
  const effective = value ?? 'all';

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs uppercase tracking-wider text-white/60">
        Audience cible
      </Label>

      <RadioGroup
        value={effective}
        onValueChange={(v) => onChange(v as AudienceType)}
        disabled={disabled}
        className="flex flex-col gap-2"
      >
        {AUDIENCE_OPTIONS.map((opt) => {
          const id = `audience-${opt.value}`;
          const Icon = opt.icon;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className="flex items-start gap-3 rounded-md border border-white/10 bg-zinc-900/40 p-3 hover:border-accent/40 cursor-pointer transition-colors"
            >
              <RadioGroupItem
                value={opt.value}
                id={id}
                className="mt-1 border-white/30 text-accent"
              />
              {/* BUG #59 — micro-icône représentative de l'audience */}
              <Icon className="h-5 w-5 text-accent/80 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-sm font-medium text-white flex items-center gap-2">
                  {opt.label}
                  {opt.recommended && (
                    <span className="inline-flex items-center rounded border border-accent/40 bg-accent/15 px-1.5 py-0 text-[9px] uppercase tracking-wider text-accent">
                      Recommandé
                    </span>
                  )}
                </span>
                <span className="text-xs text-white/50">{opt.description}</span>
              </div>
            </label>
          );
        })}
      </RadioGroup>

      <p className="flex items-start gap-2 text-[11px] text-white/40 leading-relaxed">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          LCD Art. 3 + nLPD : restrictions par genre justifiées
          (sécurité utilisatrices). « Mixte priorité femmes » est l&apos;option la
          plus inclusive et la moins risquée légalement.
        </span>
      </p>
    </div>
  );
}
