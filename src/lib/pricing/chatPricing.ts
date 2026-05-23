/**
 * BUG #74 — Prix des messages chat (texte + audio).
 *
 * Source de vérité : Firestore `settings/pricing` (doc unique éditable par
 * admin via /admin/dashboard). Fallback constants si le doc n'existe pas
 * encore (ex: fresh DB ou avant migration).
 *
 * Pattern : read côté server uniquement (lib appelée par API routes).
 * Côté client, l'UI affiche les prix via une lecture client de
 * settings/pricing OU les constants par défaut.
 */

import type { Firestore } from 'firebase-admin/firestore';

// =====================================================================
// Defaults (fallback si doc absent ou champ manquant)
// =====================================================================

export const DEFAULT_CHAT_PRICING = {
  /** Coût en crédits d'un message texte envoyé. */
  chatMessageCost: 1,
  /** Coût en crédits d'un message audio envoyé (BUG #74). */
  chatAudioCost: 2,
} as const;

export interface ChatPricing {
  chatMessageCost: number;
  chatAudioCost: number;
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Lit le doc settings/pricing avec fallback defaults.
 * Côté Admin SDK uniquement (server-only).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getChatPricing(db: any): Promise<ChatPricing> {
  try {
    const snap = await db.collection('settings').doc('pricing').get();
    if (!snap.exists) {
      return { ...DEFAULT_CHAT_PRICING };
    }
    const data = snap.data() || {};
    return {
      chatMessageCost:
        typeof data.chatMessageCost === 'number' && data.chatMessageCost >= 0
          ? data.chatMessageCost
          : DEFAULT_CHAT_PRICING.chatMessageCost,
      chatAudioCost:
        typeof data.chatAudioCost === 'number' && data.chatAudioCost >= 0
          ? data.chatAudioCost
          : DEFAULT_CHAT_PRICING.chatAudioCost,
    };
  } catch (err) {
    console.warn('[chatPricing] read failed, using defaults', err);
    return { ...DEFAULT_CHAT_PRICING };
  }
}

/**
 * Durée max d'un message audio en secondes.
 * BUG #74 décision UX (Hinge/WhatsApp standard) : 60s.
 */
export const CHAT_AUDIO_MAX_SECONDS = 60;

/**
 * Taille max d'un fichier audio uploadé (5 MB).
 * À 60s en WebM Opus 48kbps ≈ 360 kB, donc 5 MB couvre largement les
 * variations de qualité/codec et des messages courts en WAV non compressé.
 */
export const CHAT_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
