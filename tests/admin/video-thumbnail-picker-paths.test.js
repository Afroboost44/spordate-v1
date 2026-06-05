#!/usr/bin/env node
/**
 * Fix #122 (refonte UX Instagram) — Anti-régression : scanner statique du
 * VideoThumbnailPicker pour garantir que les 3 sources de miniature restent
 * câblées et convergent toutes vers uploadThumbnailBlob + onThumbnailSaved.
 *
 * Exécution :
 *   node tests/admin/video-thumbnail-picker-paths.test.js
 *
 * Pourquoi ce test : sans jsdom dans le repo, on ne peut pas render le
 * composant et simuler des clics. Ce scanner verrouille la structure pour
 * qu'une refonte future ne supprime pas accidentellement un des 3 chemins :
 *   (a) rangée de 5 frames suggérées → handleSelectFrame
 *   (b) capture via scrubber          → handleCaptureFrame
 *   (c) upload depuis l'ordinateur     → handleComputerSelect (image jpg/png)
 *
 * + garde-fou charte couleur (CLAUDE.md §0) : aucune couleur d'accent interdite.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(
  __dirname,
  '../../src/components/partner/VideoThumbnailPicker.tsx',
);

let passes = 0;
let failures = 0;
function ok(label) {
  passes++;
  console.log(`✓ ${label}`);
}
function fail(label, detail) {
  failures++;
  console.error(`✗ ${label}`, detail || '');
}
function assert(cond, label, detail) {
  if (cond) ok(label);
  else fail(label, detail);
}

const src = fs.readFileSync(FILE, 'utf8');

// ── Le helper d'upload partagé est importé + utilisé ──
assert(
  /import\s*\{[^}]*uploadThumbnailBlob[^}]*\}\s*from\s*['"]@\/lib\/storage\/uploadThumbnail['"]/.test(
    src,
  ),
  'importe uploadThumbnailBlob depuis @/lib/storage/uploadThumbnail',
);

// ── saveBlob = point de convergence unique : helper + onThumbnailSaved ──
const saveBlobBody = (src.match(/const saveBlob[\s\S]*?\}\s*,\s*\[/) || [''])[0];
assert(
  /uploadThumbnailBlob\s*\(/.test(saveBlobBody),
  'saveBlob appelle uploadThumbnailBlob',
);
assert(
  /onThumbnailSaved\s*\(\s*url\s*\)/.test(saveBlobBody),
  'saveBlob appelle onThumbnailSaved(url)',
);

// ── (a) Rangée de 5 frames suggérées ──
assert(
  /FRAME_FRACTIONS\s*=\s*\[\s*0\s*,\s*0\.25\s*,\s*0\.5\s*,\s*0\.75\s*,\s*0\.98\s*\]/.test(
    src,
  ),
  '(a) 5 fractions de frames (0/25/50/75/98 %)',
);
assert(
  /handleSelectFrame[\s\S]*?onThumbnailSaved|handleSelectFrame/.test(src) &&
    /onClick=\{\(\)\s*=>\s*handleSelectFrame\(frame\)\}/.test(src),
  '(a) clic sur une frame → handleSelectFrame(frame)',
);
// Le clic mini repasse par le pipeline de capture (handleCaptureFrame) — pas
// d'upload divergent dans handleSelectFrame.
const selectFrameBody = (src.match(/const handleSelectFrame[\s\S]*?\n  \};/) || [
  '',
])[0];
assert(
  !/uploadThumbnailBlob/.test(selectFrameBody),
  '(a) handleSelectFrame ne fait que seek (pas d\'upload divergent)',
);

// ── (b) Capture via scrubber ──
assert(
  /const handleCaptureFrame\s*=\s*async/.test(src),
  '(b) handleCaptureFrame présent',
);
assert(
  /c\.toBlob\(/.test(src) && /'image\/jpeg',\s*\n?\s*0\.85/.test(src),
  '(b) capture canvas → toBlob image/jpeg 0.85 (comportement inchangé)',
);
assert(
  /handleCaptureFrame[\s\S]*?saveBlob\(/.test(
    (src.match(/const handleCaptureFrame[\s\S]*?\n  \};/) || [''])[0] ||
      src,
  ) || /await saveBlob\(blob,/.test(src),
  '(b) handleCaptureFrame → saveBlob(blob, …)',
);

// ── (c) Upload depuis l'ordinateur (image jpg/png) ──
assert(
  /const handleComputerSelect\s*=/.test(src),
  '(c) handleComputerSelect présent',
);
assert(
  /accept="image\/jpeg,image\/png"/.test(src),
  '(c) file input accepte image/jpeg,image/png',
);
const saveUploadBody = (src.match(/const handleSaveUpload[\s\S]*?\n  \};/) || [
  '',
])[0];
assert(
  /saveBlob\(uploadFile,/.test(saveUploadBody),
  '(c) handleSaveUpload → saveBlob(uploadFile, …)',
);

// ── Proxy CORS conservé ──
assert(
  /\/api\/proxy-video\?url=\$\{encodeURIComponent\(videoUrl\)\}/.test(src),
  'proxy /api/proxy-video conservé pour CORS',
);

// ── Highlight de la source active (bordure accent + check) ──
assert(
  /border-accent/.test(src) && /<Check\b/.test(src),
  'highlight source active : bordure accent + icône Check',
);

// ── Charte couleur (CLAUDE.md §0) : aucune couleur d'accent interdite ──
const FORBIDDEN = ['#EC4899', '#C026D3', '#7E22CE', '#A21CAF'];
for (const hex of FORBIDDEN) {
  assert(
    !new RegExp(hex, 'i').test(src),
    `charte : aucune couleur interdite ${hex}`,
  );
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
