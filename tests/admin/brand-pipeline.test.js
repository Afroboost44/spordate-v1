#!/usr/bin/env node
/**
 * Fix #205 — Test light du pipeline brand admin.
 *
 * Vérifie 4 invariants statiques (sans accès Firestore) :
 *
 *   C1. Le type BrandLogos (src/lib/brand/generateLogos.ts) déclare TOUS les
 *       slots attendus : icon16/32/192/512, maskable192/512, appleTouch180,
 *       monochrome512, splash1024, sourceUrl, version, generatedAt.
 *
 *   C2. Le helper server `getServerBrand()` retourne `Promise<BrandLogos | null>`
 *       (null si pas encore configuré).
 *
 *   C3. Le RootLayout (src/app/layout.tsx) ne déclare PLUS de `metadata.icons`
 *       statique avec /icons/icon-192.png — cette logique doit vivre exclusivement
 *       dans le <head> avec la condition `hasBrand`.
 *
 *   C4. Le BrandLogoManager (admin UI) incrémente `version = Date.now()` à
 *       chaque save → cache-bust query param `?v=N` change → navigateur refetch
 *       les variants au lieu de servir l'ancien depuis le cache HTTP.
 *
 * EXÉCUTION
 *   node tests/admin/brand-pipeline.test.js
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

// ─── C1 : BrandLogos type exhaustif ─────────────────────────────────────────
{
  const file = path.join(SRC, 'lib/brand/generateLogos.ts');
  const src = fs.readFileSync(file, 'utf8');
  const required = [
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
    'version',
    'generatedAt',
  ];
  const missing = required.filter((k) => !new RegExp(`\\b${k}\\??:`).test(src));
  if (missing.length > 0) {
    fail('C1 BrandLogos type complet', `Slots manquants : ${missing.join(', ')}`);
  } else {
    pass('C1 BrandLogos déclare tous les slots requis');
  }
}

// ─── C2 : getServerBrand return type ────────────────────────────────────────
{
  const file = path.join(SRC, 'lib/brand/server.ts');
  const src = fs.readFileSync(file, 'utf8');
  if (!/Promise<BrandLogos \| null>/.test(src)) {
    fail('C2 getServerBrand return type', `Signature attendue : Promise<BrandLogos | null>`);
  } else {
    pass('C2 getServerBrand() retourne Promise<BrandLogos | null>');
  }
  if (!/unstable_cache/.test(src)) {
    fail('C2 getServerBrand cache', `unstable_cache attendu pour éviter hammer Firestore`);
  } else {
    pass('C2 getServerBrand() utilise unstable_cache');
  }
}

// ─── C3 : RootLayout pas de metadata.icons statique ─────────────────────────
{
  const file = path.join(SRC, 'app/layout.tsx');
  const src = fs.readFileSync(file, 'utf8');
  // On vérifie qu'il n'y a plus de tableau `icon: [` dans metadata Next.
  // (Notez que le <link> à l'intérieur de <head> reste légitime, on cible
  //  bien la propriété `icons:` de l'objet Metadata.)
  // Heuristique : la signature exacte qui posait problème.
  if (/icons:\s*\{[\s\S]{0,800}icon:\s*\[/.test(src)) {
    fail(
      'C3 metadata.icons statique supprimé',
      'Le RootLayout ne doit PLUS déclarer metadata.icons.icon[] avec /icons/icon-XXX.png.',
    );
  } else {
    pass('C3 metadata.icons statique retiré du RootLayout');
  }
  // Et vérifier la présence du switch hasBrand
  if (!/hasBrand/.test(src)) {
    fail('C3 logique hasBrand', 'Le RootLayout doit utiliser un flag `hasBrand` pour switcher fallback ↔ custom.');
  } else {
    pass('C3 RootLayout utilise le flag hasBrand pour la logique stricte');
  }
}

// ─── C4 : BrandLogoManager incrémente version ───────────────────────────────
{
  const file = path.join(SRC, 'components/admin/BrandLogoManager.tsx');
  const src = fs.readFileSync(file, 'utf8');
  if (!/const version = Date\.now\(\)/.test(src)) {
    fail(
      'C4 cache-bust version',
      'BrandLogoManager doit poser `const version = Date.now()` à chaque save (cache-bust query param).',
    );
  } else {
    pass('C4 BrandLogoManager incrémente version = Date.now() à chaque save');
  }
  if (!/version,/.test(src) || !/generatedAt/.test(src)) {
    fail(
      'C4 persist version + generatedAt',
      'Le nouveau brand doit persister `version` ET `generatedAt` dans Firestore.',
    );
  } else {
    pass('C4 BrandLogoManager persist version + generatedAt dans Firestore');
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) en échec dans le pipeline brand admin.`);
  process.exit(1);
}

console.log('\nOK — Pipeline brand admin valide (4/4 checks).');
process.exit(0);
