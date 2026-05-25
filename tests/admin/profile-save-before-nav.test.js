/**
 * Fix #163 — Test anti-régression : profile DOIT sauver les modifs en
 * cours AVANT de naviguer vers /onboard/prompts.
 *
 * Pattern récurrent évité :
 *  Un Link href="/onboard/prompts" dans /profile fait une nav immédiate qui
 *  démonte le composant → state local (bio, city, photos, sports, gender…)
 *  perdu sans avoir été persisté en Firestore. L'utilisateur revient sur
 *  /profile et croit avoir tout perdu.
 *
 * Le fix #163 :
 *  - Bouton onClick={handleEditPrompts} au lieu de <Link>
 *  - handleEditPrompts appelle await handleSave() PUIS router.push(...)
 *
 * Le test verrouille :
 *  CASE 1 — Plus aucun <Link href="/onboard/prompts"> dans profile/page.tsx
 *  CASE 2 — Existence du handler handleEditPrompts avec await handleSave()
 *  CASE 3 — Le bouton "Modifier mes réponses" pointe sur handleEditPrompts
 *  CASE 4 — useRouter() est instancié pour la navigation programmatique
 *
 * Exécution : node tests/admin/profile-save-before-nav.test.js
 */

const fs = require('fs');
const path = require('path');

const profilePath = path.resolve(__dirname, '..', '..', 'src/app/profile/page.tsx');
const src = fs.readFileSync(profilePath, 'utf8');

let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

// CASE 1 — Plus aucun Link vers /onboard/prompts (hors commentaires)
{
  // Strip line comments + block comments avant la recherche
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
  const linkRe = /<Link\s+href="\/onboard\/prompts"/g;
  const matches = stripped.match(linkRe) || [];
  if (matches.length === 0) {
    ok('CASE 1 — Aucun <Link href="/onboard/prompts"> direct (preuve fix #163)');
  } else {
    fail(`CASE 1 — ${matches.length} Link direct(s) trouvé(s) → modifs profil perdues à la nav !`);
  }
}

// CASE 2 — handleEditPrompts existe avec await sur un save (handleSave OU
// saveProfileSilent — fix #169 a remplacé handleSave par saveProfileSilent
// pour ne plus skipper le save quand profil incomplet).
{
  const hasHandler = /const\s+handleEditPrompts\s*=\s*async\s*\(\s*\)\s*=>/.test(src);
  const callsSave = /await\s+(handleSave|saveProfileSilent)\s*\(\s*\)/.test(src);
  if (hasHandler && callsSave) {
    ok('CASE 2 — handleEditPrompts existe et appelle await save (handleSave|saveProfileSilent)');
  } else {
    fail('CASE 2 — handleEditPrompts manquant ou ne sauve pas', { hasHandler, callsSave });
  }
}

// CASE 3 — Les boutons d'édition prompts utilisent onClick={handleEditPrompts}
{
  const onClickRe = /onClick=\{handleEditPrompts\}/g;
  const matches = src.match(onClickRe) || [];
  if (matches.length >= 2) {
    ok(`CASE 3 — ${matches.length} bouton(s) utilisent handleEditPrompts (les 2 entry points "Modifier" + "Compléter")`);
  } else {
    fail(`CASE 3 — Attendu ≥2 boutons handleEditPrompts, trouvé ${matches.length}`);
  }
}

// CASE 4 — useRouter() instancié pour navigation programmatique
{
  const hasUseRouter = /const\s+router\s*=\s*useRouter\(\s*\)/.test(src);
  const callsPush = /router\.push\(['"]\/onboard\/prompts['"]\)/.test(src);
  if (hasUseRouter && callsPush) {
    ok('CASE 4 — router.push("/onboard/prompts") utilisé après save');
  } else {
    fail('CASE 4 — useRouter ou push manquant', { hasUseRouter, callsPush });
  }
}

// CASE 5 — Le flag navigatingToPrompts évite le double-clic
{
  const hasFlag = /\[navigatingToPrompts,\s*setNavigatingToPrompts\]/.test(src);
  if (hasFlag) {
    ok('CASE 5 — flag navigatingToPrompts existe (évite double-clic + UX loader)');
  } else {
    fail('CASE 5 — flag navigatingToPrompts absent');
  }
}

// CASE 6 — Fix #169 : saveProfileSilent existe (save SANS validation pour
// préserver les modifs même profil incomplet).
{
  const hasFunc = /const\s+saveProfileSilent\s*=\s*async\s*\(\s*\)\s*=>/.test(src);
  if (hasFunc) {
    ok('CASE 6 — saveProfileSilent existe (preuve fix #169 : save sans validation)');
  } else {
    fail('CASE 6 — saveProfileSilent manquant — modifs perdues si profil incomplet !');
  }
}

// CASE 7 — Fix #169 : handleEditPrompts appelle saveProfileSilent SANS garde
// restrictive (pas de `if (displayName.trim() && city)` qui sautait le save).
{
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
  const editPromptsBody = stripped.match(/const\s+handleEditPrompts\s*=\s*async[\s\S]*?\n\s{2}\}/);
  if (!editPromptsBody) {
    fail('CASE 7 — handleEditPrompts introuvable');
  } else {
    const body = editPromptsBody[0];
    const callsSilent = /await\s+saveProfileSilent\s*\(\s*\)/.test(body);
    const hasGuard = /if\s*\(\s*displayName\.trim\(\)\s*&&\s*city\s*\)/.test(body);
    if (callsSilent && !hasGuard) {
      ok('CASE 7 — handleEditPrompts appelle saveProfileSilent() sans garde restrictive');
    } else {
      fail('CASE 7 — handleEditPrompts incorrect', { callsSilent, hasGuard });
    }
  }
}

// CASE 8 — Fix #169 : useEffect cleanup déclenche un save silent au démontage
// (ceinture de sécurité pour toutes les nav non-prévues : back button, swipe,
// changement d'onglet bottom-nav, fermeture PWA…).
{
  const hasRef = /saveSilentRef\.current\s*=\s*saveProfileSilent/.test(src);
  const cleanupFires = /void\s+saveSilentRef\.current\(\s*\)/.test(src);
  if (hasRef && cleanupFires) {
    ok('CASE 8 — useEffect cleanup fire-and-forget saveSilentRef.current() au unmount');
  } else {
    fail('CASE 8 — autosave cleanup manquant', { hasRef, cleanupFires });
  }
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
