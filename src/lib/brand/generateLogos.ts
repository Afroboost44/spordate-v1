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
 * Convertit une image en monochrome blanc (silhouette pour Android adaptive icon).
 *
 * Fix #146 / #148 / #150 — Algorithme universel basé sur l'histogramme.
 *
 * Stratégie (3 phases) :
 *  1. Si une majorité significative de pixels est transparente (alpha<128) :
 *     mode TRANSPARENCE → silhouette = pixels alpha>128 → blanc, sinon
 *     transparent. (logo isolé sur fond transparent.)
 *
 *  2. Sinon (image globalement opaque) → mode HISTOGRAMME :
 *     - On quantifie chaque pixel sur 16 niveaux par canal (4096 buckets).
 *     - La couleur la plus fréquente = couleur de fond (par construction :
 *       un logo a beaucoup plus de pixels de fond que de logo).
 *     - On classe chaque pixel selon sa distance Euclidienne au fond.
 *       Distance > seuil → logo (blanc). Sinon → fond (transparent).
 *
 *  Pourquoi l'histogramme bat l'échantillonnage coins :
 *   - Indépendant de la composition (logo qui touche un coin, anti-aliasing,
 *     gradients de bord… : tout est neutralisé puisqu'on regarde la TOTALITÉ
 *     des pixels et qu'on prend le mode statistique).
 *   - Fonctionne sur fond noir, blanc, gris, coloré, et même semi-transparent
 *     opaque (cas où alpha n'est pas strictement 255 partout).
 *   - Pas de carré blanc plein : si tout est de la même couleur, le mode est
 *     unique → distance=0 → tout transparent → silhouette vide (correct).
 */
// Fix #154 — Filet de sécurité : seuil maximum de pixels "logo" acceptable.
// Un logo normal occupe 20-50% de la surface ; au-delà de 80%, l'algorithme
// s'est trompé sur la détection du fond (= carré quasi plein cassé).
const MAX_LOGO_RATIO = 0.8;

/**
 * Applique un mode donné (alpha ou distance) au data array. Retourne le
 * ratio de pixels devenus blancs (= % "logo") pour permettre au caller
 * de juger si le résultat est cohérent.
 */
function applyMonochromeMode(
  data: Uint8ClampedArray,
  totalPixels: number,
  mode: 'alpha' | 'distance',
  bg?: { r: number; g: number; b: number },
): number {
  const DIST_THRESHOLD_SQ = 60 * 60;
  let whitePixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    let isLogoPixel: boolean;
    if (mode === 'alpha') {
      isLogoPixel = data[i + 3] > 128;
    } else {
      const dr = data[i] - bg!.r;
      const dg = data[i + 1] - bg!.g;
      const db = data[i + 2] - bg!.b;
      isLogoPixel = data[i + 3] > 128 && (dr * dr + dg * dg + db * db) > DIST_THRESHOLD_SQ;
    }
    if (isLogoPixel) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
      whitePixels++;
    } else {
      data[i + 3] = 0;
    }
  }
  return whitePixels / totalPixels;
}

function makeMonochromeWhite(srcCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = srcCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const { width, height } = srcCanvas;
  const totalPixels = width * height;

  // On lit l'image originale une seule fois, et on garde une COPIE pour
  // pouvoir retenter avec un autre mode si le 1er résultat est cassé.
  const originalImageData = ctx.getImageData(0, 0, width, height);
  const originalData = new Uint8ClampedArray(originalImageData.data);

  // ── Phase 1 : décider du mode initial selon le ratio de transparence.
  let transparentCount = 0;
  for (let i = 3; i < originalData.length; i += 4) {
    if (originalData[i] < 128) transparentCount++;
  }
  const transparentRatio = transparentCount / totalPixels;
  const initialMode: 'alpha' | 'distance' = transparentRatio >= 0.05 ? 'alpha' : 'distance';

  // ── Phase 2 : si mode 'distance', calcule la couleur de fond via histogramme.
  let bgColor: { r: number; g: number; b: number } | undefined;
  if (initialMode === 'distance') {
    const histogram = new Map<number, number>();
    for (let i = 0; i < originalData.length; i += 4) {
      if (originalData[i + 3] < 128) continue;
      const qR = originalData[i] >> 4;
      const qG = originalData[i + 1] >> 4;
      const qB = originalData[i + 2] >> 4;
      const bucket = (qR << 8) | (qG << 4) | qB;
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    }
    let bestBucket = 0;
    let bestCount = -1;
    for (const [bucket, count] of histogram) {
      if (count > bestCount) { bestCount = count; bestBucket = bucket; }
    }
    bgColor = {
      r: ((bestBucket >> 8) & 0xf) * 16 + 8,
      g: ((bestBucket >> 4) & 0xf) * 16 + 8,
      b: (bestBucket & 0xf) * 16 + 8,
    };
  }

  // ── Phase 3 : appliquer le mode initial sur une COPIE.
  const workingData = new Uint8ClampedArray(originalData);
  let ratio = applyMonochromeMode(workingData, totalPixels, initialMode, bgColor);

  // ── Phase 4 : filet de sécurité. Si ratio > 80% = carré blanc plein détecté.
  // On retente avec l'AUTRE mode pour voir si ça donne un résultat plus
  // crédible. Si même le fallback échoue, on retourne un canvas vide
  // (silhouette vide, mieux que carré blanc cassé qui pollue le UI).
  if (ratio > MAX_LOGO_RATIO) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        `[makeMonochromeWhite] mode ${initialMode} a produit ${(ratio * 100).toFixed(0)}% de blanc — fallback`,
      );
    }
    // Réinitialise et essaye l'autre mode
    const fallbackData = new Uint8ClampedArray(originalData);
    const fallbackMode: 'alpha' | 'distance' = initialMode === 'alpha' ? 'distance' : 'alpha';
    // Si on bascule vers 'distance' sans avoir calculé bgColor, on le fait.
    if (fallbackMode === 'distance' && !bgColor) {
      const histogram = new Map<number, number>();
      for (let i = 0; i < originalData.length; i += 4) {
        if (originalData[i + 3] < 128) continue;
        const qR = originalData[i] >> 4;
        const qG = originalData[i + 1] >> 4;
        const qB = originalData[i + 2] >> 4;
        const bucket = (qR << 8) | (qG << 4) | qB;
        histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
      }
      let bestBucket = 0;
      let bestCount = -1;
      for (const [bucket, count] of histogram) {
        if (count > bestCount) { bestCount = count; bestBucket = bucket; }
      }
      bgColor = {
        r: ((bestBucket >> 8) & 0xf) * 16 + 8,
        g: ((bestBucket >> 4) & 0xf) * 16 + 8,
        b: (bestBucket & 0xf) * 16 + 8,
      };
    }
    const fallbackRatio = applyMonochromeMode(fallbackData, totalPixels, fallbackMode, bgColor);
    if (fallbackRatio <= MAX_LOGO_RATIO) {
      // Le fallback marche → on l'utilise.
      const finalImageData = new ImageData(fallbackData, width, height);
      ctx.putImageData(finalImageData, 0, 0);
      return srcCanvas;
    }
    // Les 2 modes ratent → on rend un canvas TOTALEMENT transparent (plutôt
    // qu'un carré blanc plein). L'admin verra un slot vide et saura qu'il
    // doit changer son logo source.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error(
        `[makeMonochromeWhite] FALLBACK alpha=${fallbackRatio.toFixed(2)} distance=${ratio.toFixed(2)} — silhouette vide (logo source incompatible)`,
      );
    }
    const emptyData = new Uint8ClampedArray(originalData.length);
    // emptyData est déjà rempli de 0 (= transparent partout). On le pousse tel quel.
    const emptyImageData = new ImageData(emptyData, width, height);
    ctx.putImageData(emptyImageData, 0, 0);
    return srcCanvas;
  }

  // Cas nominal : le mode initial a produit un résultat cohérent.
  const finalImageData = new ImageData(workingData, width, height);
  ctx.putImageData(finalImageData, 0, 0);
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
  // Fix #208 — RETOUR au fond NOIR baked-in pour TOUS les variants icônes.
  //
  // Contexte (post Fix #207) : Bassi a installé la PWA sur son écran d'accueil
  // mobile, l'icône apparaissait avec un FOND BLANC carré autour du logo rose.
  // Cause : Android (Chromium) et iOS ajoutent un fond BLANC par défaut aux
  // icônes "any" transparentes — même si le manifest a background_color
  // #000000, ce background n'est appliqué qu'au splash, PAS au tile d'icône
  // sur le home screen. Les icônes transparentes finissent toujours sur un
  // carré blanc OS-managed.
  //
  // Solution : on bake un fond NOIR opaque (#000000) DANS le PNG lui-même.
  // Comme ça l'OS n'a plus à compositer — il pose juste le PNG carré (noir
  // + logo rose centré) sur le home screen et ça donne le rendu attendu.
  //
  //   - icon16/32/192/512        → fond NOIR opaque, padding 12% (logo
  //                                 respiré sans toucher les bords).
  //   - maskable192/512          → fond NOIR opaque + padding safe-zone 20%
  //                                 (Material Design 3 spec : Android crop
  //                                 jusqu'à 20% sur les bords selon forme
  //                                 device, donc 80% safe-zone centrée).
  //   - appleTouch180            → fond NOIR opaque (iOS demande un fond
  //                                 opaque sinon ajoute du blanc au home).
  //   - monochrome512            → reste transparent (Android applique sa
  //                                 propre couleur dynamique dessus).
  //   - splash1024               → fond NOIR opaque, padding 20% (déjà OK
  //                                 depuis Fix #207).

  // Favicons 16/32 — fond NOIR pour cohérence onglet navigateur dark mode.
  const c16 = resizeToSquare(srcImg, 16, { bg: 'black' });
  const c32 = resizeToSquare(srcImg, 32, { bg: 'black' });

  // PWA standard 192/512 — fond NOIR baked-in (fix carré blanc home screen
  // Android/iOS). Padding 12% pour donner de l'air au logo.
  const c192 = resizeToSquare(srcImg, 192, { bg: 'black', padding: 0.12 });
  const c512 = resizeToSquare(srcImg, 512, { bg: 'black', padding: 0.12 });

  // Maskable 192/512 — fond NOIR + padding safe-zone 20% (Material Design 3
  // adaptive icon : Android crop arbitraire selon forme device, l'élément
  // important doit tenir dans le cercle de 80% centré).
  const cMaskable192 = resizeToSquare(srcImg, 192, { bg: 'black', padding: 0.2 });
  const cMaskable512 = resizeToSquare(srcImg, 512, { bg: 'black', padding: 0.2 });

  // Apple Touch 180×180 — fond NOIR baked-in. iOS PWA home screen ajoute
  // toujours un fond blanc aux PNG transparents → on bake le noir nous-mêmes.
  const cApple180 = resizeToSquare(srcImg, 180, { bg: 'black', padding: 0.12 });

  // Monochrome 512 — silhouette blanche, fond transparent (Android monochrome
  // adaptive icon : le système applique sa propre couleur de fond dynamique).
  const cMono512 = resizeToSquare(srcImg, 512);
  makeMonochromeWhite(cMono512);

  // Splash 1024×1024 — fond NOIR explicite (#000000), logo centré (padding
  // 20% pour donner plus d'air, le splash est un canvas dédié pas une icône).
  // Le fond doit être noir uni car iOS letterbox le splash sur les écrans
  // de format différent → la couleur du fond compte.
  const cSplash = resizeToSquare(srcImg, 1024, { bg: 'black', padding: 0.2 });

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
