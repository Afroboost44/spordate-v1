/**
 * BUG #57 — <ActivityVenueDetails> bloc public "Cadre & Ambiance".
 *
 * Affiché sur /activities/[id] uniquement si activity.venueDetails contient
 * au moins un sous-champ renseigné (bonus / spaceTypes / musicStyle).
 *
 * Layout : section semantic + heading h2 + grille 1col mobile, 3col desktop
 * d'éléments icône+label. Charte stricte black/#D91CD2/white, aligné Description.
 */

'use client';

import { Wine, Cookie, Crown, Sun, Lock, Waves, Building2, Music, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  VENUE_BONUS_LABELS,
  VENUE_SPACE_LABELS,
  VENUE_MUSIC_LABELS,
  type VenueBonus,
  type VenueSpaceType,
  type VenueMusicStyle,
} from '@/components/partner/VenueDetailsSection';

interface VenueDetailsData {
  bonus?: VenueBonus;
  spaceTypes?: VenueSpaceType[];
  musicStyle?: VenueMusicStyle;
}

export interface ActivityVenueDetailsProps {
  details: VenueDetailsData | undefined | null;
}

// Mapping icônes (réutilisé du composant partner pour cohérence visuelle).
const BONUS_ICONS: Record<VenueBonus, LucideIcon> = {
  none: Sparkles,
  drink: Wine,
  snack: Cookie,
  vip: Crown,
};

const SPACE_ICONS: Record<VenueSpaceType, LucideIcon> = {
  outdoor_terrace: Sun,
  indoor_private: Lock,
  beach_lakeside: Waves,
  rooftop: Building2,
};

export function ActivityVenueDetails({ details }: ActivityVenueDetailsProps) {
  if (!details) return null;
  const hasBonus = details.bonus && details.bonus !== 'none';
  const hasSpaces = details.spaceTypes && details.spaceTypes.length > 0;
  const hasMusic = !!details.musicStyle;
  if (!hasBonus && !hasSpaces && !hasMusic) return null;

  return (
    <section
      aria-labelledby="venue-details-heading"
      className="flex flex-col gap-4 rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.08] to-transparent p-4 sm:p-5"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2
          id="venue-details-heading"
          className="text-lg sm:text-xl text-white font-light"
        >
          Cadre &amp; Ambiance
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Bonus inclus */}
        {hasBonus && details.bonus && (
          <VenueDetailCard
            Icon={BONUS_ICONS[details.bonus]}
            label="Inclus avec l'activité"
            value={VENUE_BONUS_LABELS[details.bonus]}
          />
        )}

        {/* Espaces disponibles : un card par espace (multi-select) */}
        {hasSpaces &&
          details.spaceTypes!.map((space) => (
            <VenueDetailCard
              key={space}
              Icon={SPACE_ICONS[space]}
              label="Espace"
              value={VENUE_SPACE_LABELS[space]}
            />
          ))}

        {/* Style musical */}
        {hasMusic && details.musicStyle && (
          <VenueDetailCard
            Icon={Music}
            label="Style musical"
            value={VENUE_MUSIC_LABELS[details.musicStyle]}
          />
        )}
      </div>
    </section>
  );
}

function VenueDetailCard({
  Icon,
  label,
  value,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-zinc-950/50 p-3">
      <div className="rounded-full bg-accent/15 border border-accent/30 p-2 shrink-0">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="text-sm text-white font-medium leading-snug">
          {value}
        </span>
      </div>
    </div>
  );
}
