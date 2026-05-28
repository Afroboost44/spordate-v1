#!/usr/bin/env node
/**
 * Fix #205 + #206 — Anti-régression : interdire les références ET les fichiers
 * statiques au logo "S" historique dans le code applicatif ET dans /public/.
 *
 * CONTEXTE
 *   Bassi a demandé la suppression DÉFINITIVE ET TOTALE du logo "S" Spordateur :
 *   plus aucun fichier physique, plus aucune référence dans le code. Tout passe
 *   désormais par l'upload admin (settings/site.brand → Firestore). Tant qu'il
 *   n'y a pas de brand custom, on affiche un placeholder neutre rose accent
 *   (/public/icons/placeholder.png), JAMAIS l'ancien logo.
 *
 * RÈGLES (4 checks)
 *
 *   R0 (Fix #206). PAS DE FICHIER PHYSIQUE "S" dans /public/. On scanne au
 *       runtime et on FAIL si l'un de ces patterns réapparaît :
 *         - /public/spordateur-logo*.{png,svg}
 *         - /public/icons/icon-*.png, /icons/favicon-*.png, /icons/apple-touch-icon.png
 *         - /public/splash/apple-splash-*.png
 *         - /public/brand/*.png
 *         - /public/icon-*.png, /public/icon-maskable-*.png, /public/apple-touch-icon.png
 *         - /public/favicon.ico, /public/og-image.png, /public/logo-source.png
 *       Le SEUL PNG autorisé dans /public/icons/ est `placeholder.png` (carré
 *       neutre rose accent, créé par Fix #206 — voir docstring icon.tsx).
 *
 *   R1. PAS DE `<img src="/spordateur-logo.png">` (le PNG du logo S historique).
 *       Mauvais. Toujours passer par <SpordateurLogo /> qui suit useBrandLogos().
 *
 *   R2. PAS de référence à `/icons/icon-XXX.png`, `/icons/apple-touch-icon.png`,
 *       `/icons/favicon-XX.png`, `/splash/apple-splash-*.png` ou `/favicon.ico`
 *       NULLE PART (whitelist vidée — ces fichiers n'existent plus). Le seul
 *       chemin sous /icons/ accepté est `/icons/placeholder.png`.
 *
 *   R3. PAS de `/brand/icon-XXX.png` ni `/brand/logo*.png` (legacy
 *       SPORDATEUR_LOGO_FALLBACK côté media.ts) NULLE PART.
 *
 * WHITELIST (fichiers code autorisés à référencer un path placeholder neutre)
 *   Aucun. La whitelist R1/R2/R3 est désormais vide — /icons/placeholder.png
 *   ne matche aucun des patterns interdits, donc tous les fichiers du repo
 *   peuvent le référencer librement.
 *
 * EXÉCUTION
 *   node tests/admin/brand-no-static-fallback.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ─── Whitelist code (Fix #206 : vidée — tous les paths matchant les patterns
//      ci-dessous sont désormais 100% interdits, plus de fallback statique). ──
const ALLOWED_FILES = new Set([]);

// ─── R0 : fichiers physiques interdits dans /public/ ────────────────────────
// Liste blanche explicite : SEUL `icons/placeholder.png` est autorisé sous
// /public/icons/. Les autres répertoires (past-sessions, etc.) ne sont pas
// concernés par ce test, on cible uniquement les noms de fichiers logo.
//
// Pattern : tout PNG/SVG/ICO du logo "S" historique dans /public/.
const R0_FORBIDDEN_PATTERNS = [
  // PNG/SVG du logo historique à la racine de /public/
  /^spordateur-logo(?:-[\w]+)?\.(?:png|svg)$/,
  /^icon-(?:16|32|48|192|512|maskable-\d+)\.png$/,
  /^apple-touch-icon(?:-\w+)?\.png$/,
  /^favicon(?:-\d+)?\.(?:ico|png)$/,
  /^og-image\.png$/,
  /^logo-source\.png$/,
];

// Patterns appliqués aux fichiers sous /public/icons/ (placeholder.png OK)
const R0_ICONS_PATTERNS = [
  /^icon-\d+\.png$/,
  /^favicon-\d+\.png$/,
  /^apple-touch-icon\.png$/,
];

// /public/splash/* et /public/brand/* doivent être VIDES (ou inexistants).
const R0_SPLASH_PATTERN = /^apple-splash-[\d-]+\.png$/;
const R0_BRAND_PATTERN = /^(?:icon-\d+\.png|logo[\w-]*\.png|apple-touch-icon[\w-]*\.png)$/;

// ─── Patterns code interdits ────────────────────────────────────────────────
// R1 : référence directe au PNG/SVG historique du logo S
const R1_PATTERN = /["'`]\/spordateur-logo(?:-[\w]+)?\.(?:png|svg)["'`]/;

// R2 : référence directe aux fichiers statiques PWA / favicon "S"
// (matche `/icons/icon-192.png`, `/icons/apple-touch-icon.png`,
//  `/icons/favicon-XX.png`, `/splash/apple-splash-*.png`, `/favicon.ico`,
//  `/icon-XXX.png` ou `/icon-maskable-XXX.png` à la racine, `/apple-touch-icon.png`,
//  `/og-image.png`, `/logo-source.png`).
// `/icons/placeholder.png` est OK (ne matche aucun de ces sous-patterns).
const R2_PATTERN = new RegExp(
  '["\'`]\\/(?:' +
    [
      'icons\\/(?:icon|favicon|apple-touch)[\\w-]*\\.png',
      'splash\\/apple-splash[\\w-]*\\.png',
      'favicon\\.ico',
      'icon-(?:16|32|48|192|512|maskable-\\d+)\\.png',
      'apple-touch-icon\\.png',
      'og-image\\.png',
      'logo-source\\.png',
    ].join('|') +
    ')',
);

// R3 : référence directe au logo dans /brand/ (legacy chain miniature)
const R3_PATTERN = /["'`]\/brand\/(?:icon|logo|apple-touch)[\w-]*\.(?:png|svg)/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function stripComments(content) {
  // Strip /* … */ et // … pour éviter les faux positifs (mentions dans JSDoc).
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const offenders = { R0: [], R1: [], R2: [], R3: [] };

// ─── R0 : Scan /public/ pour fichiers physiques interdits ───────────────────
function scanPublicRootFiles() {
  if (!fs.existsSync(PUBLIC_DIR)) return;
  for (const entry of fs.readdirSync(PUBLIC_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (R0_FORBIDDEN_PATTERNS.some((p) => p.test(entry.name))) {
      offenders.R0.push({ file: path.join('public', entry.name), reason: 'Logo "S" historique à la racine de /public/' });
    }
  }
}

function scanPublicIcons() {
  const dir = path.join(PUBLIC_DIR, 'icons');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // Whitelist : seul placeholder.png est autorisé dans /public/icons/
    if (entry.name === 'placeholder.png') continue;
    if (R0_ICONS_PATTERNS.some((p) => p.test(entry.name))) {
      offenders.R0.push({ file: path.join('public/icons', entry.name), reason: 'Fichier "S" PWA dans /public/icons/' });
    }
  }
}

function scanPublicSplash() {
  const dir = path.join(PUBLIC_DIR, 'splash');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (R0_SPLASH_PATTERN.test(entry.name)) {
      offenders.R0.push({ file: path.join('public/splash', entry.name), reason: 'Splash "S" dans /public/splash/' });
    }
  }
}

function scanPublicBrand() {
  const dir = path.join(PUBLIC_DIR, 'brand');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (R0_BRAND_PATTERN.test(entry.name)) {
      offenders.R0.push({ file: path.join('public/brand', entry.name), reason: 'Logo "S" dans /public/brand/' });
    }
  }
}

scanPublicRootFiles();
scanPublicIcons();
scanPublicSplash();
scanPublicBrand();

// ─── R1/R2/R3 : Scan du code source ─────────────────────────────────────────
const files = walk(SRC_DIR);

for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  const content = stripComments(raw);

  const rel = path.relative(ROOT, file);

  // Scan ligne par ligne pour donner un numéro de ligne précis
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (R1_PATTERN.test(line)) {
      offenders.R1.push({ file: rel, line: i + 1, content: line.trim() });
    }
    if (R2_PATTERN.test(line)) {
      offenders.R2.push({ file: rel, line: i + 1, content: line.trim() });
    }
    if (R3_PATTERN.test(line)) {
      offenders.R3.push({ file: rel, line: i + 1, content: line.trim() });
    }
  }
}

let failed = false;

function reportRule(ruleKey, label, fixHint, formatter) {
  if (offenders[ruleKey].length === 0) return;
  failed = true;
  console.error(`\nERREUR ${ruleKey} — ${label} :\n`);
  for (const o of offenders[ruleKey]) {
    formatter(o);
  }
  console.error(`\n  ${fixHint}\n`);
}

reportRule(
  'R0',
  'fichier physique du logo "S" historique réapparu dans /public/',
  'Supprime le fichier (rm public/...). Le pipeline PWA est désormais 100%\n  dynamique via settings/site.brand. Seul /public/icons/placeholder.png est\n  autorisé en fallback neutre.',
  (o) => {
    console.error(`  ${o.file}`);
    console.error(`    ${o.reason}`);
  },
);

reportRule(
  'R1',
  'référence statique au logo "S" historique (/spordateur-logo*.png|.svg)',
  'Remplace `<img src="/spordateur-logo.png">` par `<SpordateurLogo />` (qui suit useBrandLogos).',
  (o) => {
    console.error(`  ${o.file}:${o.line}`);
    console.error(`    ${o.content}`);
  },
);

reportRule(
  'R2',
  'référence statique à un fichier PWA/favicon "S" supprimé (Fix #206 — plus aucune whitelist)',
  'Tous ces fichiers ont été supprimés du repo. Utilise `/icons/placeholder.png` comme fallback\n  neutre, ou idéalement `<SpordateurLogo />` qui suit l\'upload admin brand custom.',
  (o) => {
    console.error(`  ${o.file}:${o.line}`);
    console.error(`    ${o.content}`);
  },
);

reportRule(
  'R3',
  'référence statique au legacy logo dans /brand/*.png (Fix #206 — répertoire supprimé)',
  'Le répertoire public/brand/ a été supprimé. Utilise SPORDATEUR_LOGO_FALLBACK\n  depuis @/lib/activities/media (pointe vers /icons/placeholder.png).',
  (o) => {
    console.error(`  ${o.file}:${o.line}`);
    console.error(`    ${o.content}`);
  },
);

if (failed) {
  console.error(
    "\n  Si un nouveau cas légitime apparaît, repenser la conception :\n" +
      "  l'upload admin (settings/site.brand) doit couvrir le besoin.\n",
  );
  process.exit(1);
}

console.log('OK — Aucun fichier ni référence statique au logo "S" (R0/R1/R2/R3 verts).');
process.exit(0);
