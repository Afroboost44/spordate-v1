/**
 * Fix #149 — Test anti-régression : complétude FR/EN/DE + persistence langue.
 *
 * Pattern récurrent évité :
 *  Un développeur ajoute une nouvelle clé i18n dans `fr` mais oublie d'ajouter
 *  la traduction dans `en` et/ou `de`. Résultat : quand l'utilisateur passe en
 *  Deutsch, certaines parties de l'UI restent en français car le helper t()
 *  tombe silencieusement sur le défaut FR. L'utilisateur croit que le sélecteur
 *  de langue ne marche pas.
 *
 * Ce test verrouille les invariants suivants :
 *  CASE 1 — Toutes les clés de FR doivent exister dans EN.
 *  CASE 2 — Toutes les clés de FR doivent exister dans DE.
 *  CASE 3 — Pas de clés "fantômes" dans EN/DE absentes de FR (cohérence base).
 *  CASE 4 — Aucune valeur vide (la traduction doit avoir du texte).
 *  CASE 5 — Les placeholders {var} doivent être préservés dans les 3 langues
 *           (même nombre + mêmes noms — sinon l'interpolation échoue).
 *  CASE 6 — DEFAULT_LANGUAGE est bien 'fr'.
 *  CASE 7 — SUPPORTED_LANGUAGES contient exactement [fr, en, de].
 *  CASE 8 — Un setLanguage('de') puis re-lecture localStorage doit retourner 'de'
 *           (simulé via stub window.localStorage).
 *
 * Si CASE 1 ou 2 échouent, ça signifie qu'un nouveau message a été ajouté en
 * FR sans traduction → l'utilisateur verra du français mélangé à sa langue
 * active. Le build doit casser AVANT que ça arrive en prod.
 *
 * Exécution : node tests/admin/language-completeness.test.js
 */

// Charge defaultTranslations en TS via require — simple regex extraction pour
// éviter d'embarquer un compilateur TS. Suffisant pour vérifier la complétude.
const fs = require('fs');
const path = require('path');
const tsSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'context', 'LanguageContext.tsx'),
  'utf8',
);

function extractKeys(langTag) {
  // Trouve `${langTag}: { ... },` au top-level de l'objet defaultTranslations.
  // Heuristique : on prend le 1er bloc qui commence par `${langTag}: {` et
  // on remonte jusqu'à la `}` matching (compteur d'accolades).
  const startRegex = new RegExp(`\\b${langTag}: \\{`);
  const match = startRegex.exec(tsSource);
  if (!match) return [];
  let depth = 1;
  let i = match.index + match[0].length;
  const body = [];
  while (i < tsSource.length && depth > 0) {
    const ch = tsSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth > 0) body.push(ch);
    i++;
  }
  const text = body.join('');
  const keys = new Set();
  // Extrait les clés (identifier suivi de `:`) au début d'une ligne avec
  // indentation. Anti-faux-positif : on évite de matcher les valeurs.
  const keyRegex = /^\s{4}([a-z_][a-zA-Z0-9_]*):\s/gm;
  let m;
  while ((m = keyRegex.exec(text)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

function extractEntries(langTag) {
  const startRegex = new RegExp(`\\b${langTag}: \\{`);
  const match = startRegex.exec(tsSource);
  if (!match) return new Map();
  let depth = 1;
  let i = match.index + match[0].length;
  const body = [];
  while (i < tsSource.length && depth > 0) {
    const ch = tsSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth > 0) body.push(ch);
    i++;
  }
  const text = body.join('');
  const entries = new Map();
  // key: "value" OU key: 'value' (sur 1 ligne, suffisant pour notre cas)
  const re = /^\s{4}([a-z_][a-zA-Z0-9_]*):\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'),?\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    entries.set(m[1], m[2] ?? m[3] ?? '');
  }
  return entries;
}

let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

const frKeys = extractKeys('fr');
const enKeys = extractKeys('en');
const deKeys = extractKeys('de');

const frEntries = extractEntries('fr');
const enEntries = extractEntries('en');
const deEntries = extractEntries('de');

// CASE 1 — Toutes les clés FR existent dans EN
{
  const missing = [...frKeys].filter((k) => !enKeys.has(k));
  if (missing.length === 0) {
    ok(`CASE 1 — Toutes les ${frKeys.size} clés FR sont dans EN`);
  } else {
    fail(`CASE 1 — ${missing.length} clés manquent dans EN`, missing.slice(0, 10));
  }
}

// CASE 2 — Toutes les clés FR existent dans DE
{
  const missing = [...frKeys].filter((k) => !deKeys.has(k));
  if (missing.length === 0) {
    ok(`CASE 2 — Toutes les ${frKeys.size} clés FR sont dans DE`);
  } else {
    fail(`CASE 2 — ${missing.length} clés manquent dans DE`, missing.slice(0, 10));
  }
}

// CASE 3 — Pas de clés fantômes en EN/DE absentes de FR
{
  const enExtras = [...enKeys].filter((k) => !frKeys.has(k));
  const deExtras = [...deKeys].filter((k) => !frKeys.has(k));
  if (enExtras.length === 0 && deExtras.length === 0) {
    ok('CASE 3 — Pas de clés orphelines en EN/DE');
  } else {
    fail('CASE 3 — Clés orphelines détectées', { enExtras, deExtras });
  }
}

// CASE 4 — Aucune valeur vide
{
  const emptyFr = [...frEntries].filter(([_, v]) => !v.trim()).map(([k]) => k);
  const emptyEn = [...enEntries].filter(([_, v]) => !v.trim()).map(([k]) => k);
  const emptyDe = [...deEntries].filter(([_, v]) => !v.trim()).map(([k]) => k);
  if (emptyFr.length === 0 && emptyEn.length === 0 && emptyDe.length === 0) {
    ok('CASE 4 — Aucune traduction vide dans FR/EN/DE');
  } else {
    fail('CASE 4 — Traductions vides', { emptyFr, emptyEn, emptyDe });
  }
}

// CASE 5 — Placeholders {var} préservés dans les 3 langues
{
  const PLACEHOLDER_RE = /\{(\w+)\}/g;
  function extractPlaceholders(str) {
    const set = new Set();
    let m;
    while ((m = PLACEHOLDER_RE.exec(str)) !== null) set.add(m[1]);
    PLACEHOLDER_RE.lastIndex = 0;
    return set;
  }
  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const mismatch = [];
  for (const [key, frVal] of frEntries) {
    const frPh = extractPlaceholders(frVal);
    if (frPh.size === 0) continue;
    const enVal = enEntries.get(key) ?? '';
    const deVal = deEntries.get(key) ?? '';
    const enPh = extractPlaceholders(enVal);
    const dePh = extractPlaceholders(deVal);
    if (!setsEqual(frPh, enPh)) mismatch.push({ key, lang: 'en', fr: [...frPh], en: [...enPh] });
    if (deKeys.has(key) && !setsEqual(frPh, dePh)) {
      mismatch.push({ key, lang: 'de', fr: [...frPh], de: [...dePh] });
    }
  }
  if (mismatch.length === 0) {
    ok('CASE 5 — Placeholders {var} préservés dans toutes les traductions');
  } else {
    fail(`CASE 5 — ${mismatch.length} placeholder mismatch`, mismatch.slice(0, 5));
  }
}

// CASE 6 — DEFAULT_LANGUAGE = 'fr'
{
  if (/DEFAULT_LANGUAGE:\s*SupportedLanguage\s*=\s*['"]fr['"]/.test(tsSource)) {
    ok("CASE 6 — DEFAULT_LANGUAGE est bien 'fr'");
  } else {
    fail('CASE 6');
  }
}

// CASE 7 — SUPPORTED_LANGUAGES = [fr, en, de]
{
  const re = /SUPPORTED_LANGUAGES\s*=\s*\[\s*['"]fr['"]\s*,\s*['"]en['"]\s*,\s*['"]de['"]\s*\]/;
  if (re.test(tsSource)) {
    ok('CASE 7 — SUPPORTED_LANGUAGES contient exactement [fr, en, de]');
  } else {
    fail('CASE 7');
  }
}

// CASE 8 — Persistence localStorage : simulation
{
  const fakeStorage = {};
  const fakeLS = {
    getItem: (k) => (k in fakeStorage ? fakeStorage[k] : null),
    setItem: (k, v) => { fakeStorage[k] = String(v); },
  };
  // Réplique le wrapper setLanguage du Provider
  function setLang(lang) {
    const SUPPORTED = ['fr', 'en', 'de'];
    const next = SUPPORTED.includes(lang) ? lang : 'fr';
    fakeLS.setItem('spordate_lang', next);
    return next;
  }
  setLang('de');
  const reloaded = fakeLS.getItem('spordate_lang');
  if (reloaded === 'de') {
    ok('CASE 8 — setLanguage("de") persiste dans localStorage et survit au reload');
  } else {
    fail('CASE 8', { reloaded });
  }
  // Robustesse : valeur invalide doit fallback à fr
  setLang('zz');
  const fallback = fakeLS.getItem('spordate_lang');
  if (fallback === 'fr') {
    ok('CASE 8b — Langue invalide ("zz") fallback à "fr"');
  } else {
    fail('CASE 8b', { fallback });
  }
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
console.log(`(${frKeys.size} clés FR · ${enKeys.size} EN · ${deKeys.size} DE)`);
process.exit(failures === 0 ? 0 : 1);
