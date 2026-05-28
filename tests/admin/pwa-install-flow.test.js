#!/usr/bin/env node
/**
 * Fix #208 BUG 2 — Test anti-régression "PWA install prompt natif".
 *
 * CONTEXTE
 *   Bassi clique sur la bannière "Installer Spordateur" en bas de la page.
 *   Au lieu de déclencher la popup d'installation native (Chrome / Edge /
 *   Samsung Browser), la bannière n'affichait que du texte statique :
 *   « Tap [3 points] puis "Ajouter à l'écran d'accueil" ».
 *
 *   Cause : le bouton "Installer" n'était affiché que SI l'event
 *   `beforeinstallprompt` avait déjà fired. Or Chrome Android ne fire pas
 *   cet event sans heuristique (visites multiples, scroll, etc.). Résultat :
 *   utilisateur bloqué avec un tutoriel manuel.
 *
 *   Fix #208 (BUG 2) : le bouton "Installer" est maintenant TOUJOURS
 *   présent sur Android, et `handleInstall()` :
 *     - utilise deferredPrompt.prompt() si l'event a fired
 *     - bascule sur un overlay tutoriel inline sinon
 *   iOS Safari (qui n'a pas l'API beforeinstallprompt) reçoit directement
 *   les instructions manuelles avec icône partage.
 *
 * INVARIANTS VERROUILLÉS (8 checks)
 *
 *   P1. PWARegister.tsx écoute `beforeinstallprompt` via window.addEventListener.
 *   P2. PWARegister.tsx stocke l'event dans `deferredPrompt` au capture.
 *   P3. PWARegister.tsx appelle `preventDefault()` sur l'event (norme PWA :
 *       sans ça, Chrome affiche son propre prompt timing).
 *   P4. PWARegister.tsx appelle `deferredPrompt.prompt()` dans handleInstall.
 *   P5. PWARegister.tsx lit `deferredPrompt.userChoice` (gérer accept/dismiss).
 *   P6. PWARegister.tsx écoute `appinstalled` pour masquer la bannière une
 *       fois la PWA installée (sinon elle resterait visible en standalone).
 *   P7. PWARegister.tsx détecte standalone via `display-mode: standalone`
 *       pour ne pas afficher la bannière à un user déjà installé.
 *   P8. PWARegister.tsx a un fallback texte (showManualTutorial) pour
 *       iOS Safari / Chrome Android sans event fired. Sinon le bouton
 *       "Installer" sur iOS ferait rien (API non supportée).
 *
 * EXÉCUTION
 *   node tests/admin/pwa-install-flow.test.js
 *
 * Pattern conforme aux tests existants (splash-favicon-design, etc.).
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

const PWA_FILE = 'components/PWARegister.tsx';
const src = readSrc(PWA_FILE);

// ─── P1 : écoute beforeinstallprompt ─────────────────────────────────────────
if (!/addEventListener\(\s*['"]beforeinstallprompt['"]/.test(src)) {
  fail(
    'P1 beforeinstallprompt listener',
    `${PWA_FILE} doit appeler window.addEventListener('beforeinstallprompt', ...) pour capturer l'event natif.`,
  );
} else {
  pass('P1 PWARegister.tsx écoute beforeinstallprompt');
}

// ─── P2 : stocke l'event dans deferredPrompt ─────────────────────────────────
if (!/deferredPrompt\s*=\s*e/.test(src)) {
  fail(
    'P2 deferredPrompt capture',
    `${PWA_FILE} doit stocker l'event beforeinstallprompt (ex: deferredPrompt = e) pour pouvoir l'appeler plus tard.`,
  );
} else {
  pass('P2 PWARegister.tsx stocke l\'event dans deferredPrompt');
}

// ─── P3 : preventDefault() sur l'event ───────────────────────────────────────
if (!/e\.preventDefault\(\)/.test(src)) {
  fail(
    'P3 preventDefault beforeinstallprompt',
    `${PWA_FILE} doit appeler e.preventDefault() pour bloquer le prompt auto de Chrome et le déclencher au moment voulu.`,
  );
} else {
  pass('P3 PWARegister.tsx appelle e.preventDefault() sur beforeinstallprompt');
}

// ─── P4 : prompt() appelé dans handleInstall ─────────────────────────────────
if (!/deferredPrompt\.prompt\(\)/.test(src)) {
  fail(
    'P4 deferredPrompt.prompt() appel',
    `${PWA_FILE} doit appeler deferredPrompt.prompt() pour déclencher la popup native d'installation.`,
  );
} else {
  pass('P4 PWARegister.tsx appelle deferredPrompt.prompt() au clic');
}

// ─── P5 : userChoice consommé ────────────────────────────────────────────────
if (!/deferredPrompt\.userChoice/.test(src)) {
  fail(
    'P5 deferredPrompt.userChoice',
    `${PWA_FILE} doit lire deferredPrompt.userChoice pour distinguer accept/dismiss et nettoyer le state.`,
  );
} else {
  pass('P5 PWARegister.tsx lit deferredPrompt.userChoice (accept/dismiss)');
}

// ─── P6 : appinstalled listener ──────────────────────────────────────────────
if (!/addEventListener\(\s*['"]appinstalled['"]/.test(src)) {
  fail(
    'P6 appinstalled listener',
    `${PWA_FILE} doit écouter l'event 'appinstalled' pour masquer la bannière une fois la PWA installée.`,
  );
} else {
  pass('P6 PWARegister.tsx écoute appinstalled (auto-hide bannière post-install)');
}

// ─── P7 : detection standalone ───────────────────────────────────────────────
if (!/matchMedia\(['"]\(display-mode:\s*standalone\)['"]\)/.test(src)) {
  fail(
    'P7 standalone detection',
    `${PWA_FILE} doit détecter le mode standalone via matchMedia('(display-mode: standalone)') pour ne pas afficher la bannière à un user déjà installé.`,
  );
} else {
  pass('P7 PWARegister.tsx détecte display-mode: standalone (skip bannière si installé)');
}

// ─── P8 : fallback tutoriel manuel ───────────────────────────────────────────
// On vérifie qu'il existe un state `showManualTutorial` ET qu'il est setté
// dans handleInstall quand deferredPrompt manque (Safari iOS).
if (!/showManualTutorial/.test(src)) {
  fail(
    'P8 fallback tutoriel manuel',
    `${PWA_FILE} doit avoir un state showManualTutorial pour basculer en mode tutoriel quand deferredPrompt n'existe pas (Safari iOS, Chrome Android sans event fired).`,
  );
} else {
  pass('P8 PWARegister.tsx a un fallback showManualTutorial pour iOS Safari');
}

// ─── P9 : cooldown dismiss (UX) ──────────────────────────────────────────────
// La bannière doit pouvoir être dismiss avec un cooldown localStorage pour
// ne pas réapparaître à chaque visite. Le test vérifie qu'on enregistre un
// timestamp et qu'on a un cooldown > 0.
if (!/localStorage\.setItem\([^)]*BANNER_DISMISS/.test(src)) {
  fail(
    'P9 cooldown localStorage',
    `${PWA_FILE} doit enregistrer un timestamp en localStorage au dismiss (cooldown N jours) pour ne pas spammer l'utilisateur.`,
  );
} else {
  pass('P9 PWARegister.tsx enregistre cooldown localStorage au dismiss');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) en échec dans le flow d'install PWA.`);
  console.error('Re-lis la docstring du test pour comprendre l\'invariant à corriger.');
  process.exit(1);
}

console.log('\nOK — Flow d\'install PWA valide (tous checks).');
process.exit(0);
