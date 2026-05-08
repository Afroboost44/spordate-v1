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
//
// Phase 8 SC3 commit 2/6 — flow next-activity-suggester pré-requis :
// L'API route /api/suggest-activities (commit 3/6) hydrate ces types depuis
// Firestore (chat history last 30 + activities catalog filtered city+future)
// avant d'invoquer suggestActivitiesL3().

/** Message minimaliste pour contexte du flow (last 30 messages chat). */
export interface SuggestionChatMessage {
  senderId: string;
  text: string;
  createdAt: Timestamp;
}

/** Activity candidate pré-filtrée server-side (city + future + isActive). */
export interface SuggestionCatalogEntry {
  activityId: string;
  title: string;
  sport: string;
  city: string;
  partnerId: string;
  /** Prochaine session schedulée (filtrage doctrine §D "future"). */
  nextSessionAt?: Timestamp;
  /** Phase 9 SC1 c2/5 — sessionId résolu (collection sessions/) pour wire InviteButton. */
  nextSessionId?: string;
}

/** Input du flow next-activity-suggester (Phase 8 SC3 commit 2/6).
 *  Note : chatHistory + activitiesCatalog sont pré-fetchés par /api/suggest-activities
 *  serveur-side ; le flow ne lit PAS Firestore directement (isolation SC2 hotfix). */
export interface SuggestionInput {
  /** Last 30 messages du chat (FR uniquement Phase 8 doctrine §D.Q3). */
  chatHistory: SuggestionChatMessage[];
  /** Auth uids des 2 participants (1+ accepté ; identité pour rate limit). */
  participantUids: string[];
  /** Activities pré-filtrées city + future + isActive (doctrine §D filter). */
  activitiesCatalog: SuggestionCatalogEntry[];
  /** Auth uid utilisé pour rate limiter wrapAiCall (typically participantUids[0]). */
  rateLimitUserId: string;
}

/** Output du flow next-activity-suggester — 0 à 3 activités sélectionnées par IA.
 *  Note : title/sport/city sont hydratés server-side par l'API route (commit 3/6)
 *  avant persistence ChatMessage.suggestions[] (cf. types/firestore.ts SuggestionCard). */
export interface SuggestionOutput {
  suggestions: Array<{
    /** Doc-id de l'activity proposée (issue du catalog input). */
    activityId: string;
    /** Justification courte FR ≤ 80 chars (affichée dans card bot). */
    reason: string;
  }>;
}

// ===================== MODERATE REVIEW (Phase 9 SC4 c2/6 Genkit) =====================
//
// IA-assistée modération reviews 1-2★ (architecture.md ligne 893). Doctrine SC4 Q3=A
// confirmé : admin keep final decision, IA = suggestion uniquement (pas d'auto-action
// Phase 9). Le résultat est persisté dans Review.aiSuggestion (cf. types/firestore.ts)
// et affiché en badge dans <TandSReviewsPanel> (commit 3/6).

/** Input du flow review-moderator. FR uniquement Phase 9. */
export interface ModerateReviewInput {
  /** Note 1 ou 2 (les seules ratings qui passent en queue admin pré-pub). */
  rating: 1 | 2;
  /** Commentaire utilisateur (10-500 chars validés upstream par createReview). */
  comment: string;
  /** Titre activité (contexte optionnel pour calibrage Gemini). */
  activityTitle?: string;
  /** Hash anonyme du reviewerId (audit trail sans PII, cohérent §C.Q2 anti-leak). */
  reviewerHashId: string;
}

/** Output du flow review-moderator — admin tranche, IA suggère. */
export interface ModerateReviewOutput {
  /** Score civilité ∈ [0,1] : 1.0 = parfaitement civil, 0.0 = insulte/slur/harassment. */
  civility: number;
  /** Score factualité ∈ [0,1] : 1.0 = critique factuelle vérifiable, 0.0 = opinion infondée/diffamation. */
  factuality: number;
  /** Recommendation IA — admin garde la décision finale (Q3=A). */
  recommendation: 'publish' | 'reject' | 'borderline';
  /** Motif court FR ≤ 100 chars (affiché en tooltip badge admin queue). */
  motive: string;
  /** Version modèle pour audit/rollback (ex: 'gemini-2.5-flash-2026-05'). */
  modelVersion: string;
}

// ===================== MODERATE PROFILE BIO (Phase 9 SC4 c5/6 Genkit) =====================
//
// IA-assistée modération bios profil (architecture.md ligne 1403 polish Phase 9). Doctrine
// SC4 Q3=A admin keep final decision + Q4=B fire-and-forget client-side post-updateUser
// + Q7=A flag silent + admin queue (bio reste visible — no UX disruption Phase 9).

/** Input du flow profile-bio-moderator. FR uniquement Phase 9. */
export interface ModerateProfileBioInput {
  /** Bio user (≤ 500 chars validés upstream par updateUser). */
  bio: string;
  /** Hash anonyme du userId (audit trail sans PII, cohérent §C.Q2). */
  userHashId: string;
}

/** Output du flow profile-bio-moderator — admin tranche, IA suggère. */
export interface ModerateProfileBioOutput {
  /** Score toxicité ∈ [0,1] : 0.0 = bio civile, 1.0 = insulte/slur/harassment. */
  toxicity: number;
  /** Score profanity (vulgarité non-haineuse) ∈ [0,1]. */
  profanity: number;
  /** Score contactLeak ∈ [0,1] : 0.0 = aucune coordonnée, 1.0 = email/phone/handle évident. */
  contactLeak: number;
  /** Recommendation IA — admin garde la décision finale (Q3=A). */
  recommendation: 'approve' | 'flag';
  /** Motif court FR ≤ 100 chars. */
  motive: string;
  /** Version modèle. */
  modelVersion: string;
}
