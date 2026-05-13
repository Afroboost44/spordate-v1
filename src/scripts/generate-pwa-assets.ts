/**
 * Phase 9.5 c46 — Génération assets PWA (icons + splash screens iOS).
 *
 * Source : public/logo-source.png (1500×1500 RGBA, logo neon Spordateur).
 *
 * Sorties :
 *   public/icons/icon-192.png            (192×192,   maskable any)
 *   public/icons/icon-512.png            (512×512,   maskable any)
 *   public/icons/apple-touch-icon.png    (180×180,   iOS home screen)
 *   public/icons/favicon-32.png          (32×32,     browser tab)
 *   public/icons/favicon-16.png          (16×16,     browser tab)
 *   public/splash/apple-splash-<W>-<H>.png × 9 (iOS PWA splash)
 *
 * Splash layout : background noir #000000, logo centré à 40% du min(W,H)
 * → cohérent avec le logo source déjà rond. Pas de border-radius nécessaire.
 *
 * Idempotent : peut être re-run pour regénérer (overwrite des fichiers).
 *
 * Usage : `npx tsx src/scripts/generate-pwa-assets.ts`
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
const { mkdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..', '..');
const SOURCE = resolve(REPO_ROOT, 'public', 'logo-source.png');
const ICONS_DIR = resolve(REPO_ROOT, 'public', 'icons');
const SPLASH_DIR = resolve(REPO_ROOT, 'public', 'splash');
const PUBLIC_DIR = resolve(REPO_ROOT, 'public');

// Tailles d'icônes PWA (manifest + iOS home + favicons)
const ICON_SIZES: Array<{ name: string; size: number }> = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-16.png', size: 16 },
];

// Phase 9.5 c49 — Root-level legacy paths que SW (v24) + PWA installées avant
// c46 référencent encore. DOIVENT être régénérées avec le NEW logo neon pour
// que les PWA already-installed récupèrent le bon icône au prochain SW activate
// + cache miss. Sans ce passage : iOS PWA pre-c46 reste bloquée sur ancien "S".
const ROOT_LEGACY: Array<{ name: string; size: number; maskable?: boolean }> = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];

// iOS PWA splash screens (9 tailles standard, cohérent device-pixel-ratio)
const SPLASH_SIZES: Array<{ w: number; h: number; label: string }> = [
  { w: 1125, h: 2436, label: 'iPhone X/XS/11 Pro' },
  { w: 750, h: 1334, label: 'iPhone 6/7/8' },
  { w: 828, h: 1792, label: 'iPhone XR/11' },
  { w: 1170, h: 2532, label: 'iPhone 12/13/14' },
  { w: 1242, h: 2208, label: 'iPhone 6+/7+/8+' },
  { w: 1242, h: 2688, label: 'iPhone XS Max/11 Pro Max' },
  { w: 1284, h: 2778, label: 'iPhone 12/13/14 Pro Max' },
  { w: 1536, h: 2048, label: 'iPad' },
  { w: 2048, h: 2732, label: 'iPad Pro 12.9"' },
];

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

async function generateIcon(targetSize: number, outputName: string): Promise<void> {
  const outputPath = resolve(ICONS_DIR, outputName);
  await sharp(SOURCE)
    .resize(targetSize, targetSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  console.log(`  ✓ icons/${outputName} (${targetSize}×${targetSize})`);
}

async function generateRootLegacy(targetSize: number, outputName: string, maskable = false): Promise<void> {
  const outputPath = resolve(PUBLIC_DIR, outputName);
  if (maskable) {
    // Maskable spec : 80% safe zone — render logo à 80% sur background opaque
    // (Android round/squircle masking peut couper 10-20% sur les bords).
    const innerSize = Math.round(targetSize * 0.8);
    const logoBuffer = await sharp(SOURCE)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: targetSize,
        height: targetSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: logoBuffer, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
  } else {
    await sharp(SOURCE)
      .resize(targetSize, targetSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
  }
  console.log(`  ✓ ${outputName} (${targetSize}×${targetSize}${maskable ? ' maskable' : ''}) — root legacy`);
}

async function generateSplash(w: number, h: number, label: string): Promise<void> {
  const outputName = `apple-splash-${w}-${h}.png`;
  const outputPath = resolve(SPLASH_DIR, outputName);
  // Logo centré à 40% du plus petit côté (équilibré écran portrait + landscape ratio)
  const logoSize = Math.round(Math.min(w, h) * 0.4);
  const logoBuffer = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: logoBuffer, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  console.log(`  ✓ splash/${outputName} (${w}×${h}, ${label})`);
}

async function main(): Promise<void> {
  if (!existsSync(SOURCE)) {
    console.error(`✗ Source not found: ${SOURCE}`);
    process.exit(1);
  }

  console.log(`Source: ${SOURCE}`);
  console.log(`Generating PWA assets...\n`);

  await ensureDir(ICONS_DIR);
  await ensureDir(SPLASH_DIR);

  console.log('Icons:');
  for (const { size, name } of ICON_SIZES) {
    await generateIcon(size, name);
  }

  console.log('\nRoot legacy (Phase 9.5 c49 — PWA installées pre-c46) :');
  for (const { size, name, maskable } of ROOT_LEGACY) {
    await generateRootLegacy(size, name, maskable);
  }

  console.log('\nSplash screens:');
  for (const { w, h, label } of SPLASH_SIZES) {
    await generateSplash(w, h, label);
  }

  console.log(`\n✓ Done — ${ICON_SIZES.length} icons + ${ROOT_LEGACY.length} root-legacy + ${SPLASH_SIZES.length} splash PNGs generated.`);
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
