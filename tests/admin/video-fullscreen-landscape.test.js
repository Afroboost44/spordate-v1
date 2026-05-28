#!/usr/bin/env node
/**
 * Bug fix Bassi 28/05 — Anti-régression : la vidéo 16:9 (landscape) en mobile
 * DOIT déclencher requestFullscreen() + screen.orientation.lock('landscape'),
 * et la vidéo 9:16 (portrait) NE DOIT JAMAIS appeler requestFullscreen()
 * (sinon Android force la rotation auto et retourne la vidéo verticale).
 *
 * Le composant AdaptiveFullscreenVideo gère 3 cas mobile :
 *   - ratio === 'portrait' (9:16) : no-op, juste overlay fixed inset-0.
 *   - ratio === 'landscape' (16:9) : requestFullscreen() puis orient.lock.
 *   - ratio === 'square' (1:1)    : pas de lock orientation, object-contain.
 *
 * Invariants vérifiés :
 *   1. Le fichier contient bien `requestFullscreen` (ajouté pour le 16:9).
 *   2. Le branch `ratio === 'portrait'` NE CONTIENT PAS requestFullscreen.
 *   3. Le cleanup contient `exitFullscreen` (sortir du fullscreen au unmount).
 *   4. Le cleanup contient `screen.orientation` + `unlock` (déverrouille).
 *
 * Bug historique : sur Android Chrome, screen.orientation.lock('landscape')
 * échouait silencieusement car le <video> n'était pas en fullscreen natif.
 * La vidéo 16:9 restait en portrait avec d'énormes bandes noires. Fix :
 * enchaîner requestFullscreen() → lock(). Mais on ne peut PAS l'appliquer
 * au portrait sinon Android tourne la vidéo verticale en landscape (bug
 * inverse).
 */

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(
  __dirname,
  '../../src/components/media/AdaptiveFullscreenVideo.tsx',
);

if (!fs.existsSync(FILE)) {
  console.error(`Fichier introuvable: ${FILE}`);
  process.exit(1);
}

const content = fs.readFileSync(FILE, 'utf8');

const failures = [];

// ---------------------------------------------------------------------------
// Invariant 1 : `requestFullscreen` est présent dans le fichier.
// ---------------------------------------------------------------------------
if (!/requestFullscreen/.test(content)) {
  failures.push(
    "Invariant 1 KO : `requestFullscreen` absent du fichier. Le branch 16:9 doit appeler v.requestFullscreen() avant orient.lock('landscape').",
  );
}

// ---------------------------------------------------------------------------
// Invariant 2 : le branch `ratio === 'portrait'` NE CONTIENT PAS
// `requestFullscreen`. On extrait le bloc entre `if (ratio === 'portrait')`
// et la prochaine accolade fermante au même niveau ; on cherche
// requestFullscreen dedans (code, pas commentaire).
// ---------------------------------------------------------------------------
const portraitMatch = content.match(
  /if\s*\(\s*ratio\s*===\s*['"]portrait['"]\s*\)\s*\{([\s\S]*?)\n\s{4}\}/,
);
if (!portraitMatch) {
  failures.push(
    "Invariant 2 KO : impossible de localiser le branch `if (ratio === 'portrait')`.",
  );
} else {
  const portraitBlock = portraitMatch[1];
  // On scanne ligne par ligne en ignorant les commentaires.
  const codeLines = portraitBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  const hasReqFs = codeLines.some((l) => /requestFullscreen/.test(l));
  if (hasReqFs) {
    failures.push(
      "Invariant 2 KO : `requestFullscreen` détecté dans le branch portrait. INTERDIT — sur Android, ça force la rotation auto et retourne la vidéo 9:16.",
    );
  }
}

// ---------------------------------------------------------------------------
// Invariant 3 : le cleanup contient `exitFullscreen`.
// ---------------------------------------------------------------------------
if (!/exitFullscreen/.test(content)) {
  failures.push(
    'Invariant 3 KO : `exitFullscreen` absent. Le cleanup unmount doit sortir du fullscreen natif si on y est entré.',
  );
}

// ---------------------------------------------------------------------------
// Invariant 4 : le cleanup contient `screen.orientation` + `unlock`.
// ---------------------------------------------------------------------------
const hasUnlock = /screen[^\n]*orientation[\s\S]{0,80}unlock/.test(content)
  || /orientation[\s\S]{0,80}unlock/.test(content);
if (!hasUnlock) {
  failures.push(
    'Invariant 4 KO : `screen.orientation.unlock` absent du cleanup. Le composant doit déverrouiller au unmount.',
  );
}

// ---------------------------------------------------------------------------
// Rapport.
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('\n❌ AdaptiveFullscreenVideo — anti-régression video-fullscreen-landscape KO :\n');
  for (const f of failures) {
    console.error(`   - ${f}`);
  }
  console.error('\n   Fichier : ' + path.relative(path.resolve(__dirname, '../..'), FILE));
  console.error('   Référence : CLAUDE.md + Bassi 28/05 (vidéo 16:9 doit basculer auto en landscape mobile).\n');
  process.exit(1);
}

console.log('✅ AdaptiveFullscreenVideo : requestFullscreen présent (landscape only), exitFullscreen + unlock OK dans le cleanup.');
process.exit(0);
