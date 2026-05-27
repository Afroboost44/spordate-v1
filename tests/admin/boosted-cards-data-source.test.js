#!/usr/bin/env node
/**
 * Fix #204 — Anti-régression : verrouille la source unique des activités
 * boostées et empêche les régressions sur les modals "Où pratiquer ?" et
 * "Choisir une activité".
 *
 * RÈGLES (3 checks indépendants) :
 *
 *   R1. SOURCE UNIQUE — Toute requête Firestore vers la collection `boosts`
 *       (avec un filtre `active` / `isActive` / `expiresAt`) doit vivre dans
 *       `src/lib/activities/getBoostedActivities.ts`. Tout autre fichier qui
 *       fait sa propre query custom = duplicate de logique → divergences
 *       inévitables (bug "incohérence" #3). Exception unique : la page
 *       partner/boost qui gère les boosts du partner lui-même (CRUD,
 *       pas une UI de découverte).
 *
 *   R2. PAS DE QUERY ACTIVITIES "BRUTE" DANS LES MODALS BOOST — Si un fichier
 *       contient `discovery_where_to_practice` ou `activity_selector_title`
 *       (les 2 modals concernés), il ne doit PAS contenir de query directe
 *       `collection(... 'activities')` SANS passer par getBoostedActivities().
 *
 *   R3. THUMBNAIL — Tout composant qui rend une carte d'activité (heuristique :
 *       importe `getActivityThumbnail`) doit le faire SANS cherry-pick (déjà
 *       couvert par `activity-thumbnail-call-sites.test.js`, ce test rappelle
 *       juste la règle pour les fichiers de cette feature).
 *
 * Pourquoi : Bassi a vu 1 activité dans "Où pratiquer" et 2 dans "Choisir une
 * activité" pour les mêmes données. Cause : 2 queries Firestore différentes,
 * 2 filtres différents. Fix : 1 service unique consommé par les 2 modals.
 *
 * Le test FAIL si :
 *  - un fichier hors whitelist fait une query `boosts` (R1)
 *  - un fichier des 2 modals importe encore une query `activities` brute (R2)
 *
 * Exécution : node tests/admin/boosted-cards-data-source.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');

const ALLOWED_BOOSTS_QUERY_FILES = new Set([
  // SOURCE UNIQUE — seule autorisée à filtrer la collection boosts pour une UI.
  path.join(SRC_DIR, 'lib/activities/getBoostedActivities.ts'),
  // Page partner : gère les boosts du partner lui-même (CRUD, pas découverte).
  path.join(SRC_DIR, 'app/partner/boost/page.tsx'),
]);

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
  // Retire les commentaires // et /* */ pour éviter les faux positifs sur des
  // patterns mentionnés dans un docstring (ex: dans CLAUDE.md ou JSDoc).
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const allFiles = walk(SRC_DIR);
const r1Offenders = []; // query boosts en dehors de la whitelist
const r2Offenders = []; // modal boost qui fait une query activities directe

// Pattern R1 : `collection(...'boosts')` (avec quotes simples ou doubles).
const BOOSTS_COLLECTION_RE = /collection\s*\(\s*[^)]+,\s*['"]boosts['"]\s*\)/;

// Pattern R2 : un fichier qui contient une key i18n des 2 modals boost.
const BOOST_MODAL_MARKERS = [
  'discovery_where_to_practice',
  'activity_selector_title',
];
const ACTIVITIES_COLLECTION_RE = /collection\s*\(\s*[^)]+,\s*['"]activities['"]\s*\)/;
const USES_BOOSTED_SERVICE_RE = /getBoostedActivities\s*\(/;

for (const file of allFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  const content = stripComments(raw);

  // R1 — query boosts hors whitelist
  if (BOOSTS_COLLECTION_RE.test(content) && !ALLOWED_BOOSTS_QUERY_FILES.has(file)) {
    r1Offenders.push(path.relative(ROOT, file));
  }

  // R2 — modal de boost qui fait une query activities brute SANS passer par le service
  const isBoostModal = BOOST_MODAL_MARKERS.some((m) => raw.includes(m));
  if (isBoostModal) {
    const hasActivitiesQuery = ACTIVITIES_COLLECTION_RE.test(content);
    const usesService = USES_BOOSTED_SERVICE_RE.test(content);
    if (hasActivitiesQuery && !usesService) {
      r2Offenders.push(path.relative(ROOT, file));
    }
  }
}

let failed = false;

if (r1Offenders.length > 0) {
  failed = true;
  console.error(
    '\nERREUR R1 — query Firestore vers `boosts` hors du service unifié :\n',
  );
  for (const f of r1Offenders) {
    console.error(`  ${f}`);
  }
  console.error(
    "\n  Fix : remplacer la query custom par `import { getBoostedActivities } from '@/lib/activities/getBoostedActivities'`",
  );
  console.error(
    '  puis appeler `await getBoostedActivities({ ... })` au lieu de construire la query à la main.',
  );
  console.error(
    "  (Si c'est un nouveau cas légitime, ajouter le fichier à ALLOWED_BOOSTS_QUERY_FILES dans ce test avec justification.)\n",
  );
}

if (r2Offenders.length > 0) {
  failed = true;
  console.error(
    '\nERREUR R2 — modal "Où pratiquer ?" / "Choisir une activité" avec query `activities` brute :\n',
  );
  for (const f of r2Offenders) {
    console.error(`  ${f}`);
  }
  console.error(
    '\n  Fix : utiliser `getBoostedActivities()` à la place. Les modals dédiés aux activités',
  );
  console.error(
    "  boostées NE doivent JAMAIS afficher d'activité non-boostée → la query brute viole cette règle.\n",
  );
}

if (failed) {
  process.exit(1);
}

console.log('OK — Source unique des activités boostées respectée (R1 + R2).');
process.exit(0);
