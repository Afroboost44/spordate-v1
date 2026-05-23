/**
 * BUG #107 — Configuration partagée de l'accroche vocale Spordateur.
 *
 * Pattern Hinge "Voice Prompt" : l'utilisateur choisit une amorce parmi
 * une liste prédéfinie puis enregistre sa réponse vocalement (max 20 sec).
 * L'enregistrement est affiché à côté de sa photo principale sur son profil
 * public et incite les visiteurs à découvrir sa personnalité.
 *
 * Décisions :
 *  - 3 prompts proposés par défaut (validé par Bassi 2026-05-22).
 *  - Max 20 secondes — assez pour une vraie phrase, trop court pour être
 *    soporifique (Hinge utilise 30s mais on est plus stricts en sport).
 *  - Stockage Firebase Storage : `users/{uid}/voice-prompt.webm`.
 *  - Firestore : `users/{uid}.voicePromptUrl` + `voicePromptQuestion`
 *    + `voicePromptDuration` (durée en secondes pour affichage du lecteur).
 *
 * Anti-régression : le path users/{uid}/ est déjà couvert par les storage
 * rules existantes (image/.*). Le BUG #107 a étendu cette rule à audio/.*
 * pour autoriser l'écriture de webm.
 */

export const VOICE_PROMPT_MAX_SECONDS = 20;

/**
 * 3 prompts par défaut, fun et orientés sport/dating.
 * L'utilisateur en choisit UN au moment de l'enregistrement. Une option
 * "Autre" permet de saisir un prompt custom (sinon top-3 only).
 */
export const VOICE_PROMPT_OPTIONS: readonly string[] = [
  'Présente ton sport préféré comme si tu vendais un produit à la TV.',
  'Raconte ton plus gros fail sportif en 15 secondes.',
  'Imite le son que tu fais en plein effort intense.',
] as const;

/** Choisit le mimeType supporté par le browser. Aligné ChatAudioRecorder. */
export function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/** Format mm:ss pour le timer recorder + lecteur. */
export function formatVoiceTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
