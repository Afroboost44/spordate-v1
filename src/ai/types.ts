/**
 * Phase 8 sub-chantier 0 commit 3/3 — Types partagés Genkit flows.
 *
 * Interfaces input/output pour les 2 flows Phase 8 à implémenter dans les
 * sub-chantiers 2 (anti-leak L2-L4) et 3 (suggestions next-activity).
 *
 * Doctrine §9.quinquies §C + §D :
 * - Anti-leak Layer 2 (Genkit Gemini Flash) : analyse contextuelle des messages
 *   ambigus (regex L1 a passé, doute persistant). Output déterministe pour rule
 *   serveur. Score ∈ [0,1] = probabilité de tentative de partage de coordonnées.
 * - Suggestions Layer (Genkit Gemini Flash) : 1-3 activités suggérées dans le
 *   chat post-event (cadence max 1/72h doctrine §D). Output activityIds pour
 *   quick-book hook.
 *
 * Rate limiting per-user 10 calls/min appliqué via wrapAiCall (cf. genkit.ts).
 * Cf. CGU §7.quater + §7.quinquies + Privacy §5 (commit 1/3 d54c7a9).
 */

import type { Timestamp } from 'firebase/firestore';

// ===================== ANTI-LEAK (Layer 2 Genkit) =====================

/** Input du flow anti-leak-classifier (sub-chantier 2 à venir). */
export interface AntiLeakInput {
  /** Contenu textuel du message à analyser (FR uniquement Phase 8). */
  messageContent: string;
  /** Doc-id du chat parent (pour contexte récent ; lecture par le flow). */
  chatId: string;
  /** Auth uid de l'expéditeur (pour rate limit + logs hashés). */
  userId: string;
}

/** Output du flow anti-leak-classifier — déterministe pour décision serveur. */
export interface AntiLeakOutput {
  /** Score de risque de tentative de partage de coordonnées ∈ [0,1]. */
  riskScore: number;
  /** Décision finale : true = bloquer / escalader L3. Seuil tuné côté serveur. */
  flagged: boolean;
  /** Raison lisible (FR), affichée à l'utilisateur si flagged. Optionnel. */
  reason?: string;
  /** Motif technique non-public (ex. 'phone-pattern-implicit'), pour logs. */
  technicalMotive?: string;
}

// ===================== SUGGESTIONS NEXT-ACTIVITY (Layer Genkit) =====================

/** Input du flow next-activity-suggester (sub-chantier 3 à venir). */
export interface SuggestionInput {
  /** Doc-id du chat (lecture des 30 derniers messages côté flow). */
  chatId: string;
  /** Auth uids des participants — agrégat profile sportif + villes pour ranking. */
  participantUids: string[];
  /** Timestamp dernière activity bookée par le groupe (anti-doublon suggestion). */
  lastActivityAt?: Timestamp;
}

/** Output du flow next-activity-suggester — 1 à 3 activités. */
export interface SuggestionOutput {
  suggestions: Array<{
    /** Doc-id de l'activity proposée (validation existence côté serveur). */
    activityId: string;
    /** Titre dénormalisé pour rendu rapide (snapshot moment génération). */
    title: string;
    /** Justification courte (FR) affichée dans la card bot du chat. */
    reason: string;
  }>;
}
