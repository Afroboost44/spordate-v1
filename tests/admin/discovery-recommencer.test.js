/**
 * Fix #179 — Test anti-régression : bouton "Recommencer" sur Discovery doit
 * vraiment recharger les profils, pas juste vider le state.
 *
 * Historique du bug :
 *  - V1 : resetProfiles = setProfiles(fallbackProfiles=[]) → user bloqué
 *  - V2 (#176) : ajout refreshTick → re-fetch Firestore mais filter BUG #25
 *    excluait quand même les profils déjà swipés → re-affichait "vide"
 *  - V3 (#179) : ajout bypassSwipeFilter activé par Recommencer, skip filter
 *    passes pour 1 load, likes restent filtrés
 *
 * Le test verrouille la présence des 3 mécanismes :
 *  CASE 1 — State refreshTick existe
 *  CASE 2 — State bypassSwipeFilter existe
 *  CASE 3 — resetProfiles bump refreshTick ET set bypassSwipeFilter=true
 *  CASE 4 — useEffect a refreshTick dans deps
 *  CASE 5 — Le filter passes est conditionné par !bypassSwipeFilter
 *  CASE 6 — Le bypass est reset à false dans le finally
 *
 * Exécution : node tests/admin/discovery-recommencer.test.js
 */

const fs = require('fs');
const path = require('path');

const discoveryPath = path.resolve(__dirname, '..', '..', 'src/app/discovery/page.tsx');
const src = fs.readFileSync(discoveryPath, 'utf8');

let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

// Strip comments avant les regex
const stripped = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '');

// CASE 1 — State refreshTick existe
{
  const ok1 = /\[refreshTick,\s*setRefreshTick\]\s*=\s*useState\(0\)/.test(stripped);
  if (ok1) ok('CASE 1 — State refreshTick déclaré');
  else fail('CASE 1 — refreshTick manquant');
}

// CASE 2 — State bypassSwipeFilter existe
{
  const ok2 = /\[bypassSwipeFilter,\s*setBypassSwipeFilter\]\s*=\s*useState\(false\)/.test(stripped);
  if (ok2) ok('CASE 2 — State bypassSwipeFilter déclaré');
  else fail('CASE 2 — bypassSwipeFilter manquant — Recommencer va re-filtrer les passes !');
}

// CASE 3 — resetProfiles bump refreshTick + set bypassSwipeFilter + delete passes
// (#182 — hard-delete = approche Tinder, fix robuste contre la race condition
// précédente).
{
  const resetBody = stripped.match(/const\s+resetProfiles\s*=\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]*?setRefreshTick[^\n]+\n\s{2}\}/);
  if (!resetBody) {
    fail('CASE 3 — resetProfiles async introuvable');
  } else {
    const body = resetBody[0];
    const bumpsTick = /setRefreshTick\(/.test(body);
    const setsBypass = /setBypassSwipeFilter\(true\)/.test(body);
    const deletesPasses = /deleteDoc\(.*\.ref\)|deleteDoc\(/.test(body)
      && /collection\(db,\s*['"]passes['"]\)/.test(body);
    if (bumpsTick && setsBypass && deletesPasses) {
      ok('CASE 3 — resetProfiles : bump tick + bypass + DELETE passes Firestore');
    } else {
      fail('CASE 3 — resetProfiles incomplet', { bumpsTick, setsBypass, deletesPasses });
    }
  }
}

// CASE 3b — resetProfiles est bien câblé sur l'onClick du bouton Recommencer
{
  const hasOnClick = /onClick=\{resetProfiles\}/.test(stripped);
  if (hasOnClick) ok('CASE 3b — Bouton Recommencer câblé à onClick={resetProfiles}');
  else fail('CASE 3b — Aucun bouton onClick={resetProfiles} trouvé');
}

// CASE 4 — useEffect a refreshTick dans deps
{
  const hasDep = /\}, \[user, userProfile, refreshTick\]\)/.test(stripped);
  if (hasDep) ok('CASE 4 — useEffect loadFirestoreProfiles dépend de refreshTick');
  else fail('CASE 4 — refreshTick absent des deps useEffect');
}

// CASE 5 — Le filter passes est conditionné par !bypassSwipeFilter
{
  const hasGuard = /if\s*\(\s*!bypassSwipeFilter\s*\)\s*\{/.test(stripped);
  if (hasGuard) ok('CASE 5 — Filter passes wrappé dans if (!bypassSwipeFilter)');
  else fail('CASE 5 — filter passes pas conditionné, Recommencer va exclure tout le monde');
}

// CASE 6 — Le bypass est reset à false dans le finally
{
  const hasReset = /if\s*\(bypassSwipeFilter\)\s*setBypassSwipeFilter\(false\)/.test(stripped);
  if (hasReset) ok('CASE 6 — bypassSwipeFilter reset à false après le load');
  else fail('CASE 6 — bypass jamais reset → swipes suivants ré-affichent les passes');
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
