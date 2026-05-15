/**
 * FEATURE QR — Helpers purs pour le composant QRCodeButton.
 *
 *  - buildFilename(label, code) : "spordateur-{slug(label)}-{code}.png"
 *    ASCII-safe, lowercase label, code conservé tel quel (peut avoir
 *    majuscules / tirets).
 *  - generateQrDataUrl(url, opts) : wrap qrcode.toDataURL avec defaults
 *    1024×1024, margin 2, noir/blanc → data URL PNG haute déf pour print.
 *
 * Pourquoi un module séparé : pure JS testable sans React, isolé du composant.
 *
 * @module
 */

import QRCode from 'qrcode';

/**
 * Convertit un label en slug ASCII-safe lowercase. Vide → "ref".
 *  - Strip diacritics (NFD + combining marks)
 *  - Remplace tout non [a-z0-9] par "-"
 *  - Collapse "-+" → "-"
 *  - Trim "-" en début/fin
 */
function slugify(label: string): string {
  const ascii = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || 'ref';
}

/**
 * Construit le nom de fichier de téléchargement.
 * Format : "spordateur-{slug(label)}-{code}.png"
 *
 * @example
 *   buildFilename("Lien d'invitation", "ABC123")
 *   // → "spordateur-lien-invitation-ABC123.png"
 */
export function buildFilename(label: string, code: string): string {
  const slug = slugify(label);
  const safeCode = (code || 'unknown').trim() || 'unknown';
  return `spordateur-${slug}-${safeCode}.png`;
}

export interface GenerateQrOptions {
  /** Pixel size (carré). Défaut 1024 — haute déf pour print + écrans Retina. */
  width?: number;
  /** Marge en modules QR (defaut 2 = standard imprimable). */
  margin?: number;
  /** Couleur "dark" hex. Défaut #000000. */
  dark?: string;
  /** Couleur "light" hex (fond). Défaut #FFFFFF. */
  light?: string;
}

/**
 * Génère le data URL PNG d'un QR code pour l'URL fournie.
 * @throws Error si url vide / null / whitespace.
 */
export async function generateQrDataUrl(
  url: string,
  opts: GenerateQrOptions = {},
): Promise<string> {
  if (!url || !url.trim()) {
    throw new Error('generateQrDataUrl: url requise (non vide)');
  }
  return QRCode.toDataURL(url, {
    width: opts.width ?? 1024,
    margin: opts.margin ?? 2,
    color: {
      dark: opts.dark ?? '#000000',
      light: opts.light ?? '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  });
}
