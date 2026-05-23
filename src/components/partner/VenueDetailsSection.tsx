/**
 * BUG #57 — <VenueDetailsSection> pour partners bar/club/restaurant.
 *
 * Trois champs optionnels (cf. spec utilisateur 2026-05-21) :
 *  1. "Inclus avec l'activité" (select unique) — bonus post-effort
 *  2. "Type d'espace mis à disposition" (multi-checkbox) — cadre physique
 *  3. "Style musical" (select unique) — Silent Party context
 *
 * Rendu uniquement quand Partner.type ∈ {bar, club, restaurant} (gate côté form).
 * Pattern visuel aligné <AudienceTypeSelector> : charte stricte black / #D91CD2 / white,
 * sections labellées en uppercase tracking-wider, hover sur les options sélectables.
 */

'use client';

import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Wine, Cookie, Crown, Sparkles, Sun, Lock, Waves, Building2, Music } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// =====================================================================
// Types & constantes
// =====================================================================

export type VenueBonus = 'none' | 'drink' | 'snack' | 'vip';
export type VenueSpaceType = 'outdoor_terrace' | 'indoor_private' | 'beach_lakeside' | 'rooftop';
export type VenueMusicStyle = 'afrobeat_amapiano' | 'latin' | 'general_clubbing' | 'chill_lounge';

export interface VenueDetailsValue {
  bonus?: VenueBonus;
  spaceTypes?: VenueSpaceType[];
  musicStyle?: VenueMusicStyle;
}

interface BonusOption {
  value: VenueBonus;
  label: string;
  icon: LucideIcon;
}

const BONUS_OPTIONS: BonusOption[] = [
  { value: 'none', label: 'Aucun bonus', icon: Sparkles },
  { value: 'drink', label: '1 boisson offerte', icon: Wine },
  { value: 'snack', label: 'Collation ou snack inclus', icon: Cookie },
  { value: 'vip', label: 'Accès VIP', icon: Crown },
];

interface SpaceOption {
  value: VenueSpaceType;
  label: string;
  icon: LucideIcon;
  description: string;
}

const SPACE_OPTIONS: SpaceOption[] = [
  {
    value: 'outdoor_terrace',
    label: 'Terrasse extérieure',
    description: 'Patio ou cour en plein air.',
    icon: Sun,
  },
  {
    value: 'indoor_private',
    label: 'Espace intérieur privatisé',
    description: 'Salle ou espace réservé en intérieur.',
    icon: Lock,
  },
  {
    value: 'beach_lakeside',
    label: 'Plage privée ou bord du lac',
    description: 'Plage, ponton ou rive aménagée.',
    icon: Waves,
  },
  {
    value: 'rooftop',
    label: 'Rooftop',
    description: 'Toit-terrasse avec vue.',
    icon: Building2,
  },
];

interface MusicOption {
  value: VenueMusicStyle;
  label: string;
}

const MUSIC_OPTIONS: MusicOption[] = [
  { value: 'afrobeat_amapiano', label: 'Afrobeat & Amapiano' },
  { value: 'latin', label: 'Latino, Salsa & Bachata' },
  { value: 'general_clubbing', label: 'Généraliste & Clubbing' },
  { value: 'chill_lounge', label: 'Chill, Lounge & Deep House' },
];

// Labels publics réutilisables (page detail) — exportés pour le rendu public.
export const VENUE_BONUS_LABELS: Record<VenueBonus, string> = {
  none: 'Aucun bonus',
  drink: '1 boisson offerte',
  snack: 'Collation ou snack inclus',
  vip: 'Accès VIP',
};

export const VENUE_SPACE_LABELS: Record<VenueSpaceType, string> = {
  outdoor_terrace: 'Terrasse extérieure',
  indoor_private: 'Espace intérieur privatisé',
  beach_lakeside: 'Plage privée ou bord du lac',
  rooftop: 'Rooftop',
};

export const VENUE_MUSIC_LABELS: Record<VenueMusicStyle, string> = {
  afrobeat_amapiano: 'Afrobeat & Amapiano',
  latin: 'Latino, Salsa & Bachata',
  general_clubbing: 'Généraliste & Clubbing',
  chill_lounge: 'Chill, Lounge & Deep House',
};

// =====================================================================
// Composant
// =====================================================================

export interface VenueDetailsSectionProps {
  value: VenueDetailsValue | undefined;
  onChange: (next: VenueDetailsValue) => void;
  disabled?: boolean;
}

export function VenueDetailsSection({
  value,
  onChange,
  disabled,
}: VenueDetailsSectionProps) {
  const current: VenueDetailsValue = value ?? {};
  const selectedSpaces = current.spaceTypes ?? [];

  const setBonus = (v: VenueBonus) => {
    // 'none' = on retire le champ (storage propre — pas de bonus = pas de clé)
    if (v === 'none') {
      const { bonus: _drop, ...rest } = current;
      void _drop;
      onChange(rest);
      return;
    }
    onChange({ ...current, bonus: v });
  };

  const toggleSpace = (space: VenueSpaceType) => {
    const next = selectedSpaces.includes(space)
      ? selectedSpaces.filter((s) => s !== space)
      : [...selectedSpaces, space];
    if (next.length === 0) {
      const { spaceTypes: _drop, ...rest } = current;
      void _drop;
      onChange(rest);
      return;
    }
    onChange({ ...current, spaceTypes: next });
  };

  const setMusic = (v: string) => {
    // "_unset" = on retire le champ (UX "Aucune précision")
    if (v === '_unset') {
      const { musicStyle: _drop, ...rest } = current;
      void _drop;
      onChange(rest);
      return;
    }
    onChange({ ...current, musicStyle: v as VenueMusicStyle });
  };

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-accent/20 bg-accent/[0.03] p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-accent mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <Label className="text-xs uppercase tracking-wider text-accent font-medium">
            Cadre & Ambiance
          </Label>
          <p className="text-[11px] text-white/50 leading-relaxed">
            Détails Bar/Club/Restaurant — affichés sur la page publique pour valoriser l&apos;événement.
          </p>
        </div>
      </div>

      {/* 1. Inclus avec l'activité */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="venue-bonus" className="text-[11px] uppercase tracking-wider text-white/60">
          Inclus avec l&apos;activité (optionnel)
        </Label>
        <Select
          value={current.bonus ?? 'none'}
          onValueChange={(v) => setBonus(v as VenueBonus)}
          disabled={disabled}
        >
          <SelectTrigger
            id="venue-bonus"
            className="bg-zinc-900/60 border-white/10 text-white"
          >
            <SelectValue placeholder="Aucun bonus" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-950 border border-white/10 text-white">
            {BONUS_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-accent/80" aria-hidden="true" />
                    {opt.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* 2. Type d'espace */}
      <div className="flex flex-col gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-white/60">
          Type d&apos;espace mis à disposition (optionnel, plusieurs choix possibles)
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SPACE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const checked = selectedSpaces.includes(opt.value);
            const id = `venue-space-${opt.value}`;
            return (
              <label
                key={opt.value}
                htmlFor={id}
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  checked
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-white/10 bg-zinc-900/40 hover:border-accent/40'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={() => toggleSpace(opt.value)}
                  disabled={disabled}
                  className="mt-0.5 border-white/30 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                />
                <Icon className="h-5 w-5 text-accent/80 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-sm font-medium text-white">{opt.label}</span>
                  <span className="text-[11px] text-white/50">{opt.description}</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* 3. Style musical */}
      <div className="flex flex-col gap-2">
        <Label
          htmlFor="venue-music"
          className="text-[11px] uppercase tracking-wider text-white/60 flex items-center gap-2"
        >
          <Music className="h-3.5 w-3.5 text-accent/80" aria-hidden="true" />
          Style musical (concept Silent — optionnel)
        </Label>
        <Select
          value={current.musicStyle ?? '_unset'}
          onValueChange={setMusic}
          disabled={disabled}
        >
          <SelectTrigger
            id="venue-music"
            className="bg-zinc-900/60 border-white/10 text-white"
          >
            <SelectValue placeholder="Aucune précision" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-950 border border-white/10 text-white">
            <SelectItem value="_unset">Aucune précision</SelectItem>
            {MUSIC_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
