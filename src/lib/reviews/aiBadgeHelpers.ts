/**
 * Phase 9 sub-chantier 4 commit 3/6 — Helpers UI pour badge IA admin queue + prefill reason.
 *
 * Pures fonctions extraites pour permettre tests Q8=A verify content sans RTL.
 *
 * - `aiBadgeProps(aiSuggestion)` : calcule label + classes Tailwind + tooltip + testId
 *   selon recommendation (publish/reject/borderline) ou null si pas d'aiSuggestion.
 * - `prefilledReason(aiSuggestion, action)` : retourne reason auto-fill string si admin
 *   choix === aiSuggestion.recommendation (pour préremplir Textarea note du dialog).
 * - `mismatchWarning(aiSuggestion, action)` : retourne warning string si admin diverge
 *   de l'IA (Q3=A admin keep final decision — affiche juste l'info).
 *
 * @module
 */

import type { Review } from '@/types/firestore';

export type ReviewModerationAction = 'publish' | 'reject';

export type AiRecommendation = 'publish' | 'reject' | 'borderline';

export interface AiBadgeProps {
  /** Texte du badge — ex: "IA: publish 0.92" */
  label: string;
  /** Classes Tailwind charte stricte (bg + text + border). */
  className: string;
  /** Tooltip motive complet + scores + modelVersion. */
  tooltip: string;
  /** data-testid pour tests pure helpers. */
  testId: string;
  /** Recommendation effective (re-export pour caller). */
  recommendation: AiRecommendation;
}

const BADGE_CLASSES: Record<AiRecommendation, string> = {
  publish: 'bg-green-500/20 text-green-300 border-green-500/40',
  reject: 'bg-red-500/20 text-red-300 border-red-500/40',
  borderline: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

/** Confidence affichée = max(civility, factuality) — score le plus saillant. */
function maxScore(civility: number, factuality: number): number {
  return Math.max(civility, factuality);
}

/**
 * Calcule props badge IA pour rendering dans <TandSReviewsPanel>. Retourne null si
 * review.aiSuggestion absent (review pré-Phase 9 SC4 c2/6 — graceful degradation).
 */
export function aiBadgeProps(
  aiSuggestion: Review['aiSuggestion'] | null | undefined,
): AiBadgeProps | null {
  if (!aiSuggestion) return null;
  const rec = aiSuggestion.recommendation;
  const score = maxScore(aiSuggestion.civility, aiSuggestion.factuality);
  const scoreFmt = score.toFixed(2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredAtMs = (aiSuggestion.scoredAt as any)?.toMillis?.() ?? 0;
  const scoredAtRelative = scoredAtMs > 0 ? formatRelative(scoredAtMs) : '';
  const tooltip = [
    `IA recommendation: ${rec}`,
    `Civility: ${aiSuggestion.civility.toFixed(2)} · Factuality: ${aiSuggestion.factuality.toFixed(2)}`,
    `Motive: ${aiSuggestion.motive}`,
    `Modèle: ${aiSuggestion.modelVersion}`,
    scoredAtRelative ? `Scoré ${scoredAtRelative}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    label: `IA: ${rec} ${scoreFmt}`,
    className: BADGE_CLASSES[rec],
    tooltip,
    testId: `ai-badge-${rec}`,
    recommendation: rec,
  };
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "à l'instant";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `il y a ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

/**
 * Retourne reason auto-prefilled si admin choix === IA recommendation.
 * Returns empty string sinon (admin saisit librement, Q3=A admin keep final decision).
 *
 * Aligned cases:
 *  - admin click 'publish' AND aiSuggestion.recommendation==='publish' → "(IA suggestion: motive)"
 *  - admin click 'reject' AND aiSuggestion.recommendation==='reject' → "(IA suggestion: motive)"
 *
 * Borderline ne préfille jamais (admin doit toujours saisir sa propre justification).
 * Mismatch (admin diverge IA) ne préfille pas non plus.
 */
export function prefilledReason(
  aiSuggestion: Review['aiSuggestion'] | null | undefined,
  action: ReviewModerationAction,
): string {
  if (!aiSuggestion) return '';
  if (aiSuggestion.recommendation === 'borderline') return '';
  if (aiSuggestion.recommendation !== action) return '';
  return `(IA suggestion: ${aiSuggestion.motive})`;
}

/**
 * Retourne warning string si admin diverge IA (Q3=A admin keep final decision —
 * juste informatif, pas bloquant).
 *
 * Mismatch cases:
 *  - admin click 'publish' BUT aiSuggestion.recommendation==='reject'
 *  - admin click 'reject' BUT aiSuggestion.recommendation==='publish'
 *
 * Returns empty string si pas de mismatch ou pas d'aiSuggestion.
 */
export function mismatchWarning(
  aiSuggestion: Review['aiSuggestion'] | null | undefined,
  action: ReviewModerationAction,
): string {
  if (!aiSuggestion) return '';
  if (aiSuggestion.recommendation === 'borderline') return '';
  if (aiSuggestion.recommendation === action) return '';
  return `L'IA suggérait : ${aiSuggestion.recommendation}`;
}
