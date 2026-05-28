#!/usr/bin/env node
/**
 * Fix #207bis — Test anti-régression "splash screen + favicon premium".
 *
 * CONTEXTE
 *   Bassi a uploadé son vrai logo SVG transparent via /admin/manage > Site >
 *   Brand. Sur Android (PWA installée), le splash affichait :
 *     - Fond BLANC au lieu de noir.
 *     - Boîte noire opaque autour du logo (le splash 1024 lui-même posé sur
 *       un fond blanc système).
 *   Et le favicon onglet Chrome affichait le carré rose placeholder
 *   #D91CD2 au lieu du logo uploadé.
 *
 *   Le pipeline a été réécrit (Fix #207) pour :
 *     1. manifest.ts background_color/theme_color = #000000 (cohérent dark app).
 *     2. generateLogos.ts produit les icons standards (favicon, PWA "any",
 *        apple-touch) en TRANSPARENT — composés par le système sur le fond
 *        noir du manifest, plus de "boîte noire embarquée".
 *     3. generateLogos.ts produit le splash 1024 sur fond NOIR explicite
 *        (Android utilise l'icône maskable/any sur le background_color du
 *        manifest, mais le splash1024Url reste utile pour iOS PWA spec
 *        future + branding cohérent).
 *     4. icon.tsx (favicon dynamique Next.js) prend BRAND CUSTOM en
 *        priorité avant le fallback placeholder rose neutre.
 *
 *   Ce test verrouille TOUS ces invariants pour éviter une régression
 *   future où quelqu'un repasserait le splash sur fond blanc, recommencerait
 *   à injecter le placeholder rose dans icon.tsx alors qu'un brand custom
 *   existe, ou réintroduirait un metadata.icons statique cassé.
 *
 * INVARIANTS VERROUILLÉS (8 checks)
 *
 *   D1. manifest.ts a `background_color: '#000000'` (anti-bug splash blanc).
 *   D2. manifest.ts a `theme_color: '#000000'` (cohérent status bar noire).
 *   D3. generateLogos.ts : splash1024 utilise explicitement `bg: 'black'`
 *       (anti-régression fond blanc/coloré qui réintroduirait la boîte noire
 *       posée sur splash blanc côté device).
 *   D4. generateLogos.ts : icon16/32/192/512 + appleTouch180 sont générés
 *       SANS bg explicite ou avec `bg: 'transparent'` (= clearRect, alpha
 *       préservé). Pas de `bg: 'black'` ou `bg: 'white'` qui forcerait une
 *       boîte opaque indésirable dans l'onglet/PWA tile.
 *   D5. icon.tsx appelle `getServerBrand()` AVANT de retourner le placeholder.
 *       Si l'admin a uploadé un brand custom (icon32Url|icon192Url|icon512Url),
 *       le favicon doit être streamé depuis Firebase Storage, jamais le carré
 *       rose neutre.
 *   D6. icon.tsx contient un fetch (response.ok → Response stream) pour le
 *       PNG custom — sans ce flow, le brand custom serait ignoré.
 *   D7. layout.tsx contient la logique `hasBrand` pour switcher entre
 *       <link rel="icon"> custom et placeholder fallback. Plus jamais les
 *       deux côte-à-côte (= ancienne origine de réapparition du logo "S").
 *   D8. layout.tsx N'INJECTE PAS de <link rel="apple-touch-startup-image">
 *       pointant vers splash1024Url (Fix #207 — iOS letterboxait le splash
 *       carré sur fond blanc quand résolution device ≠ 1024×1024). Le
 *       splash iOS doit être laissé au comportement par défaut (apple-touch-
 *       icon sur background_color manifest).
 *
 * EXÉCUTION
 *   node tests/admin/splash-favicon-design.test.js
 *
 * Pattern conforme aux tests existants (brand-pipeline, brand-no-static-
 * fallback, monochrome-logo) : exit 0 si tous verts, exit 1 + erreurs si fail.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

let failures = 0;
function fail(label, detail) {
  console.error(`FAIL — ${label}`);
  if (detail) console.error(`        ${detail}`);
  failures++;
}
function pass(label) {
  console.log(`OK   — ${label}`);
}

function readSrc(rel) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) {
    fail(`Fichier manquant : ${rel}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * Strip JS/TS et JSX comments — utile pour les checks où une mention en
 * commentaire (ex : docstring "BUG résolu : avant, on déclarait des
 * <link rel='apple-touch-startup-image'>") ferait un faux positif.
 *
 * Couvre : `/* ... *​/`, `// ...` et `{/* ... *​/}` JSX.
 */
function stripComments(src) {
  return src
    // JSX block comments {/* ... */}
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    // C-style block comments /* ... */
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments // ...
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

// ─── D1 + D2 : manifest.ts background_color / theme_color = noir ────────────
{
  const src = readSrc('app/manifest.ts');
  if (!/background_color:\s*['"]#000000['"]/.test(src)) {
    fail(
      'D1 manifest background_color',
      'manifest.ts doit avoir `background_color: \'#000000\'` (anti-splash blanc PWA Android).',
    );
  } else {
    pass('D1 manifest.ts background_color = #000000 (splash noir cohérent dark app)');
  }
  if (!/theme_color:\s*['"]#000000['"]/.test(src)) {
    fail(
      'D2 manifest theme_color',
      'manifest.ts doit avoir `theme_color: \'#000000\'` (status bar noire cohérente).',
    );
  } else {
    pass('D2 manifest.ts theme_color = #000000');
  }
}

// ─── D3 : generateLogos.ts splash1024 fond noir explicite ────────────────────
{
  const src = readSrc('lib/brand/generateLogos.ts');
  // On cherche la ligne qui génère cSplash → doit contenir `bg: 'black'`.
  const splashMatch = src.match(/const\s+cSplash\s*=\s*resizeToSquare\([^)]+\)/);
  if (!splashMatch) {
    fail(
      'D3 splash1024 generation',
      'Aucun `const cSplash = resizeToSquare(...)` trouvé dans generateLogos.ts.',
    );
  } else if (!/bg:\s*['"]black['"]/.test(splashMatch[0])) {
    fail(
      'D3 splash1024 fond noir',
      `Le splash doit être généré avec \`bg: 'black'\`. Ligne actuelle :\n        ${splashMatch[0]}`,
    );
  } else {
    pass('D3 generateLogos.ts splash1024 → bg: \'black\' (fond noir cohérent)');
  }
}

// ─── D4 : icons standards transparents (pas de bg opaque) ────────────────────
{
  const src = readSrc('lib/brand/generateLogos.ts');
  // Pour chaque slot transparent attendu, on récupère la déclaration et on
  // vérifie qu'aucune option bg:'black'/bg:'white' n'apparaît dans l'appel.
  const slots = [
    { name: 'c16', pattern: /const\s+c16\s*=\s*resizeToSquare\([^)]+\)/ },
    { name: 'c32', pattern: /const\s+c32\s*=\s*resizeToSquare\([^)]+\)/ },
    { name: 'c192', pattern: /const\s+c192\s*=\s*resizeToSquare\([^)]+\)/ },
    { name: 'c512', pattern: /const\s+c512\s*=\s*resizeToSquare\([^)]+\)/ },
    { name: 'cApple180', pattern: /const\s+cApple180\s*=\s*resizeToSquare\([^)]+\)/ },
  ];
  let d4ok = true;
  for (const slot of slots) {
    const m = src.match(slot.pattern);
    if (!m) {
      fail(
        `D4 slot ${slot.name} manquant`,
        `Déclaration \`const ${slot.name} = resizeToSquare(...)\` introuvable dans generateLogos.ts.`,
      );
      d4ok = false;
      continue;
    }
    if (/bg:\s*['"](black|white|#[0-9a-fA-F]{3,8})['"]/.test(m[0])) {
      fail(
        `D4 slot ${slot.name} doit être transparent`,
        `Le slot ${slot.name} doit être généré sans bg opaque (transparent natif).\n        Ligne actuelle : ${m[0]}`,
      );
      d4ok = false;
    }
  }
  if (d4ok) {
    pass('D4 generateLogos.ts icons standards transparents (16/32/192/512 + appleTouch180)');
  }
}

// ─── D5 + D6 : icon.tsx brand custom prioritaire ─────────────────────────────
{
  const src = readSrc('app/icon.tsx');
  if (!/getServerBrand\(\)/.test(src)) {
    fail(
      'D5 icon.tsx getServerBrand',
      'icon.tsx doit appeler `getServerBrand()` pour récupérer le brand custom uploadé.',
    );
  } else {
    pass('D5 icon.tsx appelle getServerBrand() avant le fallback placeholder');
  }
  // On veut voir la prio : brand.icon32Url || brand.icon192Url || brand.icon512Url
  if (!/brand[?.]?\.icon(?:32|192|512)Url/.test(src)) {
    fail(
      'D5 icon.tsx prio brand custom',
      'icon.tsx doit lire brand.icon32Url (ou 192/512) pour utiliser le logo uploadé.',
    );
  } else {
    pass('D5 icon.tsx lit brand.iconNNNUrl pour servir le favicon custom');
  }
  // Et un fetch + Response pour stream le PNG (sinon : fallback placeholder
  // sert toujours, bug favicon rose).
  if (!/await\s+fetch\(/.test(src) || !/new\s+Response\(/.test(src)) {
    fail(
      'D6 icon.tsx fetch + Response',
      'icon.tsx doit fetch le PNG custom et le streamer via `new Response(buf, ...)` pour préserver transparence.',
    );
  } else {
    pass('D6 icon.tsx fetch le PNG custom et stream Response (transparence préservée)');
  }
}

// ─── D7 : layout.tsx logique hasBrand ────────────────────────────────────────
{
  const src = readSrc('app/layout.tsx');
  if (!/hasBrand/.test(src)) {
    fail(
      'D7 layout hasBrand flag',
      'layout.tsx doit utiliser un flag `hasBrand` pour switcher entre <link> custom et placeholder.',
    );
  } else {
    pass('D7 layout.tsx utilise hasBrand pour switch strict custom ↔ placeholder');
  }
  // Vérifie aussi que les <link rel="icon"> custom utilisent brand.iconNNNUrl
  if (!/brand\?\.icon32Url/.test(src) || !/brand\?\.icon192Url/.test(src)) {
    fail(
      'D7 layout link brand custom',
      'layout.tsx doit injecter <link rel="icon"> avec `brand?.icon32Url` et `brand?.icon192Url` quand hasBrand est true.',
    );
  } else {
    pass('D7 layout.tsx injecte <link rel="icon"> avec brand.icon32Url / icon192Url quand hasBrand');
  }
}

// ─── D8 : layout.tsx pas d'apple-touch-startup-image splash carré ────────────
{
  // On strip les commentaires : la docstring Fix #207 du layout EXPLIQUE
  // pourquoi on n'injecte plus apple-touch-startup-image — c'est attendu.
  // Le test doit scanner uniquement le code exécutable.
  const src = stripComments(readSrc('app/layout.tsx'));
  // L'ancienne implémentation injectait 9 <link rel="apple-touch-startup-image">
  // pointant vers le même splash1024Url → iOS letterboxait sur fond blanc.
  // Si quelqu'un réintroduit ce pattern, on casse.
  if (/apple-touch-startup-image[\s\S]{0,500}splash1024Url/.test(src)) {
    fail(
      'D8 apple-touch-startup-image splash1024',
      'layout.tsx ne doit PAS injecter <link rel="apple-touch-startup-image"> pointant vers splash1024Url.\n        iOS letterboxe le splash carré sur fond blanc quand la résolution device diffère.\n        Laisser iOS fallback sur apple-touch-icon + background_color manifest (fond noir).',
    );
  } else {
    pass('D8 layout.tsx n\'injecte pas d\'apple-touch-startup-image (anti-letterbox blanc iOS)');
  }
}

// ─── D9 (Bassi 28/05 — flash blanc PWA) : layout.tsx force fond noir inline ──
// Sur le démarrage PWA Android/iOS, un flash BLANC apparaissait avant que le
// splash noir du manifest prenne le relais. Cause : le user-agent affiche
// son fond default (blanc) tant que la CSS app n'est pas chargée. Fix : on
// inline le `background-color: #000000` directement sur <html> et <body>
// dans le rendered HTML, plus un <style> inline en première position du
// <head> qui set la même règle, AVANT toute autre CSS.
{
  const src = readSrc('app/layout.tsx');
  // D9a : <html> doit avoir style avec backgroundColor #000000 (ou black).
  if (!/<html[^>]*style=\{\{[^}]*backgroundColor:\s*['"](?:#000000|black)['"]/.test(src)) {
    fail(
      'D9a layout html background inline',
      "<html> doit avoir style={{ backgroundColor: '#000000' }} pour éliminer le flash blanc PWA avant que la CSS soit chargée.",
    );
  } else {
    pass("D9a layout.tsx <html style={{backgroundColor: '#000000'}}> (anti-flash blanc PWA)");
  }
  // D9b : <body> doit avoir style avec backgroundColor #000000 ou black.
  if (!/<body[^>]*style=\{\{[^}]*backgroundColor:\s*['"](?:#000000|black)['"]/.test(src)) {
    fail(
      'D9b layout body background inline',
      "<body> doit avoir style={{ backgroundColor: '#000000' }} pour garantir le fond noir avant chargement CSS.",
    );
  } else {
    pass("D9b layout.tsx <body style={{backgroundColor: '#000000'}}>");
  }
  // D9c : un <style> inline en <head> avec html/body background #000000.
  // On match les <style ... dangerouslySetInnerHTML={{__html: '...'}}> qui
  // contiennent une règle html,body background-color #000000.
  const inlineStyleMatch = src.match(
    /<style[\s\S]{0,200}?dangerouslySetInnerHTML[\s\S]{0,400}?html[\s\S]{0,40}?body[\s\S]{0,80}?background-color:\s*#000000/i,
  );
  if (!inlineStyleMatch) {
    fail(
      'D9c layout <style> inline fond noir',
      "Un <style> inline en <head> doit set `html,body { background-color: #000000 !important; }` AVANT toute autre CSS pour éviter le flash blanc.",
    );
  } else {
    pass('D9c layout.tsx <style> inline html,body background-color: #000000 (anti-FOUC)');
  }
}

// ─── D10 (Bassi 28/05 — flash blanc PWA) : globals.css fond noir AVANT tailwind ──
{
  const cssPath = path.join(SRC, 'app/globals.css');
  const cssRaw = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  // On strip les /* ... */ commentaires pour éviter qu'un `@tailwind base`
  // cité en docstring soit pris pour le vrai import.
  const cssNoComments = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  // On veut une règle html,body background-color #000000 AVANT @tailwind base.
  const tailwindBaseIdx = cssNoComments.indexOf('@tailwind base');
  if (tailwindBaseIdx < 0) {
    fail(
      'D10 globals.css @tailwind base',
      'globals.css doit contenir `@tailwind base` (sinon Tailwind ne fonctionne pas).',
    );
  } else {
    const beforeTailwind = cssNoComments.slice(0, tailwindBaseIdx);
    // Match `html,body { ... background-color: #000000 ... }` (avec retour ligne autorisé).
    const earlyBgRule =
      /html\s*,\s*body\s*\{[^}]*background-color:\s*#000000[^}]*\}/i.test(beforeTailwind);
    if (!earlyBgRule) {
      fail(
        'D10 globals.css fond noir avant @tailwind',
        'globals.css doit avoir une règle `html,body { background-color: #000000 !important; }` AVANT `@tailwind base`. Sans ça, Tailwind base reset peut introduire un flash blanc bref sur certains user-agents PWA.',
      );
    } else {
      pass('D10 globals.css règle html,body fond noir AVANT @tailwind base (anti-flash blanc)');
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) en échec dans le pipeline splash + favicon.`);
  console.error('Re-lis la docstring du test pour comprendre l\'invariant à corriger.');
  process.exit(1);
}

console.log('\nOK — Pipeline splash + favicon premium valide (tous checks).');
process.exit(0);
