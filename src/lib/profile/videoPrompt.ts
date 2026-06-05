/**
 * Accroche vidéo Spordateur — configuration partagée (additif à voicePrompt.ts).
 *
 * Vidéo portrait 9:16, max 30 secondes, en complément de l'accroche vocale
 * existante (l'audio reste 100% intact, la vidéo s'ajoute à côté).
 *
 * Décisions :
 *  - Max 30 secondes (auto-stop à l'enregistrement, reject à l'upload).
 *  - Encodage : video/webm;codecs=vp9,opus préféré, fallback video/mp4 (Safari),
 *    videoBitsPerSecond 2.5 Mbps, audioBitsPerSecond 128k (cohérent fix audio).
 *  - Stockage Firebase Storage : users/{uid}/profile/video-prompt-{ts}.{ext}
 *  - Firestore : users/{uid}.videoPromptUrl (champ optionnel additif).
 *
 * Storage rules : le path users/{uid} est étendu à video/.* (cf. storage.rules).
 */

export const VIDEO_PROMPT_MAX_SECONDS = 30;

/** Cap upload (100 Mo) — confortable pour un upload brut 1080p de téléphone.
 *  Le cap image/audio (10 Mo) reste inchangé côté storage.rules. */
export const VIDEO_PROMPT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Choisit le mimeType vidéo supporté par le browser (vp9/opus → mp4 Safari). */
export function pickVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/** Extension de fichier dérivée du mimeType (pour le path Storage). */
export function videoExtFromMime(mime: string): string {
  if (/mp4/i.test(mime)) return 'mp4';
  if (/webm/i.test(mime)) return 'webm';
  if (/quicktime/i.test(mime)) return 'mov';
  return 'mp4';
}

/** Format m:ss pour le timer recorder + lecteur. */
export function formatVideoTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
