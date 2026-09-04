/**
 * Tests — destination après le pont afroboost → Spordateur.
 *
 * Exécution :
 *   npm run test:components:bridge-destination
 *
 * Pattern : pure unit (no DOM, no emulator), comme les autres tests de ce
 * dossier.
 *
 * CE QUI EST EN JEU. Avant ce lot, le pont ouvrait la session et n'allait
 * NULLE PART : le membre restait sur la landing, cliquait « Rejoindre »,
 * traversait /activities, et trouvait enfin les Rencontres. Quatre écrans pour
 * une promesse d'un clic. Ces tests fixent la nouvelle destination ET la
 * réversibilité : drapeau fermé, on ne bouge pas — exactement comme avant.
 */

export {}; // module scope (sinon globals collide tsc)

import {
  destinationApresPont,
  drapeauActif,
  CHEMIN_DISCOVERY,
} from '../../src/lib/bridge/destination';

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, detail: string): void {
  console.log(`FAIL  ${label} — ${detail}`);
  _failures++;
}

function egal(label: string, recu: unknown, attendu: unknown): void {
  if (recu === attendu) pass(label);
  else fail(label, `reçu ${JSON.stringify(recu)}, attendu ${JSON.stringify(attendu)}`);
}

// ─── D1. Le drapeau fermé ne change RIEN ──────────────────────────────────
egal(
  'D1. drapeau absent -> aucune redirection',
  destinationApresPont({ directDiscovery: false, basePath: '/rencontre' }),
  null,
);
egal(
  'D1b. drapeau fermé, même hors mode intégré -> aucune redirection',
  destinationApresPont({ directDiscovery: false, basePath: '' }),
  null,
);

// ─── D2. Le drapeau ouvert mène aux Rencontres ────────────────────────────
egal(
  'D2. mode intégré -> /rencontre/discovery',
  destinationApresPont({ directDiscovery: true, basePath: '/rencontre' }),
  '/rencontre/discovery',
);
egal(
  'D2b. domaine propre (sans basePath) -> /discovery',
  destinationApresPont({ directDiscovery: true, basePath: '' }),
  '/discovery',
);
egal(
  'D2c. basePath absent (undefined) -> /discovery',
  destinationApresPont({ directDiscovery: true }),
  '/discovery',
);

// ─── D3. Le basePath est préfixé proprement ───────────────────────────────
// `window.location` ne connaît pas le routeur Next : sans ce préfixe, le
// membre partirait sur afroboost.com/discovery, qui n'existe pas.
egal(
  'D3. une barre finale en trop ne produit pas de double barre',
  destinationApresPont({ directDiscovery: true, basePath: '/rencontre/' }),
  '/rencontre/discovery',
);
egal(
  'D3b. plusieurs barres finales sont normalisées',
  destinationApresPont({ directDiscovery: true, basePath: '/rencontre///' }),
  '/rencontre/discovery',
);

// ─── D4. La destination n'est JAMAIS la landing ni /activities ────────────
const cible = destinationApresPont({ directDiscovery: true, basePath: '/rencontre' });
if (cible && !cible.endsWith(CHEMIN_DISCOVERY)) {
  fail('D4. la destination est la page de rencontres', `reçu ${cible}`);
} else if (cible === '/rencontre' || cible === '/rencontre/activities') {
  fail('D4. la destination est la page de rencontres', `reçu ${cible}`);
} else {
  pass('D4. la destination est la page de rencontres, jamais la landing ni /activities');
}

// ─── D5. Lecture du drapeau : « true » seul vaut vrai ─────────────────────
egal('D5. "true" -> actif', drapeauActif('true'), true);
egal('D5b. "TRUE" -> actif (casse ignorée)', drapeauActif('TRUE'), true);
egal('D5c. " true " -> actif (espaces ignorés)', drapeauActif(' true '), true);
egal('D5d. "false" -> inactif', drapeauActif('false'), false);
egal('D5e. "1" -> inactif (on n\'invente pas de synonyme)', drapeauActif('1'), false);
egal('D5f. "yes" -> inactif', drapeauActif('yes'), false);
egal('D5g. undefined -> inactif', drapeauActif(undefined), false);
egal('D5h. chaîne vide -> inactif', drapeauActif(''), false);

// ─── D6. Le mode intégré : ce qu'on AFFICHE, jamais ce qu'on supprime ─────
// Le mode se décide sur le `basePath`, jamais sur un nom de domaine : un test
// sur « afroboost.com » serait faux en recette et muet en local.
import { estModeIntegre } from '../../src/lib/bridge/destination';

egal('D6. basePath « /rencontre » -> mode intégré', estModeIntegre('/rencontre'), true);
egal('D6b. basePath vide -> mode autonome', estModeIntegre(''), false);
egal('D6c. basePath absent -> mode autonome', estModeIntegre(undefined), false);
egal('D6d. basePath fait d\'espaces -> mode autonome', estModeIntegre('   '), false);
egal('D6e. un autre préfixe compte aussi', estModeIntegre('/spordate-v1'), true);

console.log(`\n${_passes} passés, ${_failures} échoués`);
if (_failures > 0) process.exit(1);
