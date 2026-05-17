/**
 * BUG #26 bis + #28 — Helpers Drive thumbnail/viewer.
 *
 * Root cause : Google Drive refuse le framing iframe via header CSP
 * `frame-ancestors`. Sur mobile, l'iframe résultant tombe en état
 * `chrome-error://chromewebdata/` qui intercepte les touch events natifs
 * AVANT que embla puisse les capturer → swipe horizontal bloqué + vidéo
 * non lisible.
 *
 * Fix : remplacer l'iframe Drive par une thumbnail cliquable qui ouvre le
 * Drive viewer dans une nouvelle tab. Évite TOTALEMENT le problème CSP
 * + iframe touch absorption.
 *
 * @module
 */

/**
 * Extract le fileId Google Drive d'une URL share/embed.
 *
 * Patterns reconnus :
 *  - https://drive.google.com/file/d/FILE_ID/view
 *  - https://drive.google.com/file/d/FILE_ID/preview
 *  - https://drive.google.com/open?id=FILE_ID
 *
 * @returns fileId string ou null si URL invalide / non-Drive
 */
export function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  const openMatch = trimmed.match(/drive\.google\.com\/open\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];

  return null;
}

/**
 * Build l'URL thumbnail Drive non-officielle.
 * Format : `https://drive.google.com/thumbnail?id={fileId}&sz=w{size}`
 *
 * @param fileId fileId Drive (extrait via extractDriveFileId)
 * @param size pixel width hint (défaut 800, suffisant pour la card)
 */
export function buildDriveThumbnailUrl(fileId: string, size = 800): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

/**
 * Build l'URL Drive viewer (page complète avec controls vidéo natifs).
 * Format : `https://drive.google.com/file/d/{fileId}/view`
 *
 * Utiliser avec `window.open(url, '_blank')` pour ouvrir en nouvelle tab.
 */
export function buildDriveViewerUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
