/**
 * BUG #71 — Stats horizontales scrollables (style Hinge "About" pill row).
 *
 * Affiche les stats lifestyle + démographiques sous forme de pills horizontales
 * avec icône + label court. Scrollable horizontalement sur mobile (overflow-x-auto).
 *
 * Champs sourcés depuis UserProfile :
 *   - age (calc depuis birthDate) → ex: "32 ans"
 *   - gender → ex: "Femme"
 *   - profileExtras.height → ex: "164 cm"
 *   - city → ex: "Klybeck"
 *   - profileExtras.openToChildren → ex: "Ouvert aux enfants"
 *   - profileExtras.alcohol → ex: "Parfois"
 *   - profileExtras.smoking → ex: "Non"
 *   - profileExtras.cannabis → ex: "Non"
 *   - profileExtras.drugs → ex: "Non"
 *
 * Si tous les champs sont absents → renvoie null (pas de section vide).
 *
 * Charte stricte noir / accent / white.
 */

'use client';

import {
  Cake,
  User,
  Ruler,
  MapPin,
  Baby,
  Wine,
  Cigarette,
  Leaf,
  Pill,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserProfile } from '@/types/firestore';
import {
  FREQUENCY_LABELS,
  CHILDREN_LABELS,
  GENDER_LABELS,
  computeAge,
} from '@/lib/profile/extras';

export interface ProfileStatsRowProps {
  profile: Pick<UserProfile, 'birthDate' | 'gender' | 'city' | 'profileExtras'>;
  className?: string;
}

interface Stat {
  key: string;
  Icon: LucideIcon;
  value: string;
}

export function ProfileStatsRow({ profile, className = '' }: ProfileStatsRowProps) {
  const stats: Stat[] = [];

  // Âge
  const age = computeAge(profile.birthDate);
  if (typeof age === 'number') {
    stats.push({ key: 'age', Icon: Cake, value: `${age} ans` });
  }

  // Genre
  if (profile.gender && GENDER_LABELS[profile.gender]) {
    stats.push({ key: 'gender', Icon: User, value: GENDER_LABELS[profile.gender] });
  }

  const extras = profile.profileExtras;

  // Taille
  if (extras?.height && extras.height > 0) {
    stats.push({ key: 'height', Icon: Ruler, value: `${extras.height} cm` });
  }

  // Ville
  if (profile.city && profile.city.trim().length > 0) {
    stats.push({ key: 'city', Icon: MapPin, value: profile.city });
  }

  // Enfants
  if (extras?.openToChildren) {
    stats.push({
      key: 'children',
      Icon: Baby,
      value: CHILDREN_LABELS[extras.openToChildren],
    });
  }

  // Alcool
  if (extras?.alcohol) {
    stats.push({ key: 'alcohol', Icon: Wine, value: FREQUENCY_LABELS[extras.alcohol] });
  }

  // Tabac
  if (extras?.smoking) {
    stats.push({ key: 'smoking', Icon: Cigarette, value: FREQUENCY_LABELS[extras.smoking] });
  }

  // Cannabis
  if (extras?.cannabis) {
    stats.push({ key: 'cannabis', Icon: Leaf, value: FREQUENCY_LABELS[extras.cannabis] });
  }

  // Autres drogues
  if (extras?.drugs) {
    stats.push({ key: 'drugs', Icon: Pill, value: FREQUENCY_LABELS[extras.drugs] });
  }

  if (stats.length === 0) return null;

  return (
    <div
      className={`flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap ${className}`}
      role="list"
      aria-label="Caractéristiques du profil"
    >
      {stats.map((s) => {
        const Icon = s.Icon;
        return (
          <div
            key={s.key}
            role="listitem"
            className="shrink-0 inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-2 text-xs text-white/80 font-light whitespace-nowrap"
          >
            <Icon className="h-3.5 w-3.5 text-accent/80 shrink-0" aria-hidden="true" />
            <span>{s.value}</span>
          </div>
        );
      })}
    </div>
  );
}
