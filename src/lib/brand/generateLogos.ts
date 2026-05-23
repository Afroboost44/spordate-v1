/**
 * Fix #128 — Auto-génération côté navigateur des variants de logo.
 *
 * Prend une image source (File ou HTMLImageElement chargée), et génère via
 * Canvas API tous les variants nécessaires pour PWA + favicon + splash + iOS :
 *
 *   - icon16, icon32                       → favicon classique
 *   - icon192, icon512                     → PWA standard "any"
 *   - maskable192, maskable512             → PWA "maskable" (padding 20% safe-zone)
 *   - appleTouch180                        → iOS home screen
 *   - monochrome512                        → adaptive icon Android (silhouette blanche
 *                                            via alpha threshold)
 *   - splash1024                           → splash screen (logo centré sur fond noir)
 *
 * Tous les outputs sont des `Blob` PNG (qualité max). Le caller les uploade
 * sur Firebase Storage puis persiste les URLs dans settings/site.brand.
 *
 * Best-effort : si une étape échoue (canvas tainted CORS, navigateur non
 * supporté), l'erreur est propagée et le caller affiche un toast — pas de
 * fallback silencieux pour éviter d'enregistrer un set incomplet.
 *
 * @module
 */

export interface GeneratedLogoSet {
  icon16: Blob;
  icon32: Blob;
  icon192: Blob;
  icon512: Blob;
  maskable192: Blob;
  maskable512: Blob;
  appleTouch180: Blob;
  monochrome512: Blob;
  splash1024: Blob;
}

/**
 * Charge un File image dans un HTMLImageElement, en s'assurant que decode()
 * a réussi (sinon canvas.drawImage produit une image vide).
 */
export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible — format non supporté ou corrompue.'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Resize l'image source dans un carré de taille `size` × `size`.
 * - bg='transparent' : préserve la transparence (cas standard, maskable, apple)
 * - bg='black' : fond noir (cas splash screen)
 * - padding : pourcentage de marge intérieure (utile pour maskable safe-zone)
 *
 * L'image est centrée + scale "contain" (préserve aspect ratio sans crop).
 */
function resizeToSquare(
  img: HTMLImageElement,
  size: number,
  opts: { bg?: 'transparent' | 'black'; padding?: number } = {},
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Fond
  if (opts.bg === 'black') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }

  // Calcul dimensions destination (contain + padding)
  const pad = (opts.padding ?? 0) * size;
  const dstSize = size - 2 * pad;
  const srcRatio = img.width / img.height;
  let dstW: number;
  let dstH: number;
  if (srcRatio >= 1) {
    dstW = dstSize;
    dstH = dstSize / srcRatio;
  } else {
    dstH = dstSize;
    dstW = dstSize * srcRatio;
  }
  const dstX = (size - dstW) / 2;
  const dstY = (size - dstH) / 2;

  // High-quality scale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dstX, dstY, dstW, dstH);

  return canvas;
}

/**
 * Convertit une image en monochrome blanc (silhouette).
 * Pour chaque pixel : si alpha > 128 alors RGB=(255,255,255) alpha=255, sinon transparent.
 * Approximation : ne preserve pas les nuances. Si l'admin veut un vrai monochrome
 * propre, il peut le téléverser manuellement plus tard (override).
 */
function makeMonochromeWhite(srcCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = srcCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const { width, height } = srcCanvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 128) {
      data[i] = 255; // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = 255;
    } else {
      data[i + 3] = 0; // transparent
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return srcCanvas;
}

/**
 * Convertit un Canvas en Blob PNG (qualité max).
 */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob retourné null'))),
      'image/png',
      1.0,
    );
  });
}

/**
 * Génère TOUS les variants à partir d'un seul logo source.
 * Le caller charge le File via loadImageFromFile() puis appelle generateAll(img).
 */
export async function generateAllLogos(srcImg: HTMLImageElement): Promise<GeneratedLogoSet> {
  // Standard (any) — sans padding, transparent
  const c16 = resizeToSquare(srcImg, 16);
  const c32 = resizeToSquare(srcImg, 32);
  const c192 = resizeToSquare(srcImg, 192);
  const c512 = resizeToSquare(srcImg, 512);

  // Maskable — padding 20% pour safe-zone Android
  const cMaskable192 = resizeToSquare(srcImg, 192, { padding: 0.1 });
  const cMaskable512 = resizeToSquare(srcImg, 512, { padding: 0.1 });

  // Apple touch 180×180 — pas de padding (iOS appose son propre arrondi)
  const cApple180 = resizeToSquare(srcImg, 180);

  // Monochrome 512 — silhouette blanche
  const cMono512 = resizeToSquare(srcImg, 512);
  makeMonochromeWhite(cMono512);

  // Splash 1024×1024 — logo centré 50% sur fond noir
  const cSplash = resizeToSquare(srcImg, 1024, { bg: 'black', padding: 0.25 });

  const [icon16, icon32, icon192, icon512, maskable192, maskable512, appleTouch180, monochrome512, splash1024] =
    await Promise.all([
      canvasToPng(c16),
      canvasToPng(c32),
      canvasToPng(c192),
      canvasToPng(c512),
      canvasToPng(cMaskable192),
      canvasToPng(cMaskable512),
      canvasToPng(cApple180),
      canvasToPng(cMono512),
      canvasToPng(cSplash),
    ]);

  return {
    icon16,
    icon32,
    icon192,
    icon512,
    maskable192,
    maskable512,
    appleTouch180,
    monochrome512,
    splash1024,
  };
}

/**
 * Liste des slots persistés dans settings/site.brand après upload.
 * Référence partagée avec l'admin UI + manifest.ts + icon.tsx pour cohérence.
 */
export const BRAND_LOGO_SLOTS = [
  'sourceUrl',
  'icon16Url',
  'icon32Url',
  'icon192Url',
  'icon512Url',
  'maskable192Url',
  'maskable512Url',
  'appleTouch180Url',
  'monochrome512Url',
  'splash1024Url',
] as const;

export type BrandLogoSlot = (typeof BRAND_LOGO_SLOTS)[number];

/**
 * Shape du sous-objet stocké dans settings/site.brand après upload complet.
 */
export interface BrandLogos {
  /** URL du logo source uploadé par l'admin (référence pour re-générer). */
  sourceUrl?: string;
  /** Variants auto-générés (PWA / favicon / Apple / monochrome / splash). */
  icon16Url?: string;
  icon32Url?: string;
  icon192Url?: string;
  icon512Url?: string;
  maskable192Url?: string;
  maskable512Url?: string;
  appleTouch180Url?: string;
  monochrome512Url?: string;
  splash1024Url?: string;
  /** Bump à chaque save → utilisé comme query-string ?v=N pour bust le cache navigateur. */
  version?: number;
  /** Timestamp ISO de la dernière génération (display admin). */
  generatedAt?: string;
}
