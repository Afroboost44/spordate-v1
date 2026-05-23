/**
 * BUG #71 — Liste verticale infos perso style Hinge.
 *
 * Affiche les infos perso sous forme de lignes icône+texte (pattern type Hinge
 * "About me" : Briefcase Profession / Book Religion / Home Hometown / etc.).
 *
 * Champs sourcés depuis UserProfile.profileExtras :
 *   - profession (texte libre)
 *   - religion (label)
 *   - hometown (texte libre)
 *   - studies (label)
 *   - ethnicity (texte libre)
 *   - relationshipGoals (label)
 *   - relationshipStyle (label)
 *
 * Renvoie null si aucun champ renseigné.
 */

'use client';

import {
  Briefcase,
  BookOpen,
  Home,
  GraduationCap,
  Globe2,
  Search,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserProfile } from '@/types/firestore';
import {
  RELIGION_LABELS,
  STUDIES_LABELS,
  RELATIONSHIP_GOALS_LABELS,
  RELATIONSHIP_STYLE_LABELS,
} from '@/lib/profile/extras';

export interface ProfileInfoListProps {
  profile: Pick<UserProfile, 'profileExtras'>;
  className?: string;
}

interface InfoRow {
  key: string;
  Icon: LucideIcon;
  value: string;
}

export function ProfileInfoList({ profile, className = '' }: ProfileInfoListProps) {
  const extras = profile.profileExtras;
  if (!extras) return null;
  const rows: InfoRow[] = [];

  if (extras.profession && extras.profession.trim().length > 0) {
    rows.push({ key: 'profession', Icon: Briefcase, value: extras.profession });
  }
  if (extras.religion) {
    rows.push({ key: 'religion', Icon: BookOpen, value: RELIGION_LABELS[extras.religion] });
  }
  if (extras.hometown && extras.hometown.trim().length > 0) {
    rows.push({ key: 'hometown', Icon: Home, value: extras.hometown });
  }
  if (extras.studies) {
    rows.push({ key: 'studies', Icon: GraduationCap, value: STUDIES_LABELS[extras.studies] });
  }
  if (extras.ethnicity && extras.ethnicity.trim().length > 0) {
    rows.push({ key: 'ethnicity', Icon: Globe2, value: extras.ethnicity });
  }
  if (extras.relationshipGoals) {
    rows.push({
      key: 'relationship_goals',
      Icon: Search,
      value: RELATIONSHIP_GOALS_LABELS[extras.relationshipGoals],
    });
  }
  if (extras.relationshipStyle) {
    rows.push({
      key: 'relationship_style',
      Icon: Users,
      value: RELATIONSHIP_STYLE_LABELS[extras.relationshipStyle],
    });
  }

  if (rows.length === 0) return null;

  return (
    <ul
      className={`flex flex-col rounded-2xl border border-white/10 bg-zinc-900/40 divide-y divide-white/5 ${className}`}
      aria-label="Informations personnelles"
    >
      {rows.map((row) => {
        const Icon = row.Icon;
        return (
          <li
            key={row.key}
            className="flex items-center gap-3 px-4 py-3.5"
          >
            <Icon className="h-5 w-5 text-white/60 shrink-0" aria-hidden="true" />
            <span className="text-sm sm:text-base text-white/85 font-light leading-snug">
              {row.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
