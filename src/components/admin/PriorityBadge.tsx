/**
 * Phase 7 sub-chantier 4 commit 2/4 — <PriorityBadge>.
 *
 * Badge couleur priorité catégorie report (cohérent doctrine §D.2).
 * Mapping via REPORT_CATEGORY_PRIORITY (commit 1/4) :
 *  1 (urgent) → rouge — harassment_sexuel, substance_etat_problematique
 *  2 (haute) → orange — comportement_agressif
 *  3 (moyenne) → jaune — fake_profile, autre
 *  4 (basse) → vert — no_show
 *
 * Style admin (bg-gray-900 ambient — pas charte stricte user-facing).
 */

import { REPORT_CATEGORY_PRIORITY } from '@/lib/reports';
import type { ReportCategory } from '@/types/firestore';

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment_sexuel: 'Harcèlement sexuel',
  comportement_agressif: 'Comportement agressif',
  fake_profile: 'Faux profil',
  substance_etat_problematique: 'Substances',
  no_show: 'No-show',
  autre: 'Autre',
};

function priorityClasses(priority: number): string {
  switch (priority) {
    case 1:
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 2:
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 3:
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 4:
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    default:
      return 'bg-gray-700/40 text-gray-300 border-gray-600/30';
  }
}

export interface PriorityBadgeProps {
  category: ReportCategory;
  /** Override label (défaut auto via mapping FR). */
  label?: string;
  className?: string;
}

export function PriorityBadge({ category, label, className = '' }: PriorityBadgeProps) {
  const priority = REPORT_CATEGORY_PRIORITY[category] ?? 99;
  const classes = priorityClasses(priority);
  const text = label ?? CATEGORY_LABELS[category] ?? category;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${classes} ${className}`}
      title={`Priorité ${priority}`}
    >
      {text}
    </span>
  );
}
