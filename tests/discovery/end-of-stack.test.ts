/**
 * LOT R1 — Fin de pile /discovery : le dernier profil reste, l'écran noir part.
 *
 * Exécution :
 *   npm run test:discovery:end-of-stack
 *
 * Pattern : script `npx tsx` autonome (comme where-to-practice.test.ts et
 * bridge-destination.test.ts) — pas de Vitest, pas d'émulateur, pas de DOM.
 *
 * CE QUI EST EN JEU. Avant ce lot, `profiles[currentIndex]` valait `undefined`
 * dès que la pile était épuisée : la carte disparaissait et laissait une grande
 * page noire avec « Revoir les profils passés » — un bouton qui SUPPRIME des
 * documents `passes` en base. L'utilisateur perdait la photo, le nom, la
 * compatibilité, la bio et « Réserver » d'un seul coup.
 *
 * Deux familles de tests :
 *   - A/B/C/D/E/H/I  → assertions PURES sur src/lib/discovery/endOfStack.ts
 *   - F/G/I/J + retrait du bouton → assertions sur le SOURCE de page.tsx
 *     (même approche que tests/components/*.test.ts : ces éléments sont du
 *     JSX, on vérifie qu'ils sont bien branchés et bien câblés).
 */

export {}; // module scope (sinon globals collide tsc)

import * as fs from 'fs';
import * as path from 'path';
import {
  resolveDiscoveryView,
  rankSwipesByRecency,
  pickLastSwipedUid,
  swipeCreatedAtMillis,
} from '../../src/lib/discovery/endOfStack';

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
  if (JSON.stringify(recu) === JSON.stringify(attendu)) pass(label);
  else fail(label, `reçu ${JSON.stringify(recu)}, attendu ${JSON.stringify(attendu)}`);
}
function vrai(label: string, condition: boolean, detail = 'condition fausse'): void {
  if (condition) pass(label);
  else fail(label, detail);
}
function section(titre: string): void {
  console.log(`\n--- ${titre} ---`);
}

const SOURCE_PAGE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', 'discovery', 'page.tsx'),
  'utf-8',
);
const SOURCE_I18N = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'context', 'LanguageContext.tsx'),
  'utf-8',
);

// =====================================================================
// A — 1 profil restant → action → aucun nouveau → même profil + bandeau
// =====================================================================
section('A — dernière carte consommée : elle RESTE, avec le bandeau');
{
  // Un seul profil dans la pile, l'utilisateur clique Pass/Like → index passe à 1.
  const vue = resolveDiscoveryView({ profilesLength: 1, currentIndex: 1 });
  egal('A1. mode = last-seen', vue.mode, 'last-seen');
  egal('A2. index affiché = dernière carte (0), pas undefined', vue.displayIndex, 0);
  vrai('A3. bandeau affiché', vue.showEndBanner);
  vrai('A4. pas de profil fabriqué (on lit la pile)', vue.useFallbackProfile === false);

  // Même chose avec une pile plus longue et plusieurs swipes d'affilée.
  const vue3 = resolveDiscoveryView({ profilesLength: 3, currentIndex: 3 });
  egal('A5. pile de 3 épuisée → dernière carte = index 2', vue3.displayIndex, 2);
  egal('A6. mode last-seen', vue3.mode, 'last-seen');

  // Index qui déborde largement (double clic, course de state) : toujours borné.
  const vueLoin = resolveDiscoveryView({ profilesLength: 3, currentIndex: 99 });
  egal('A7. index très au-delà → toujours borné à la dernière carte', vueLoin.displayIndex, 2);

  // Index aberrant : jamais de null/undefined en sortie.
  const vueNeg = resolveDiscoveryView({ profilesLength: 3, currentIndex: -5 });
  egal('A8. index négatif → première carte, mode actif', vueNeg.displayIndex, 0);
  egal('A9. index négatif → mode actif', vueNeg.mode, 'active');
  const vueNaN = resolveDiscoveryView({ profilesLength: 3, currentIndex: NaN });
  egal('A10. index NaN → première carte', vueNaN.displayIndex, 0);
}

// =====================================================================
// B — après refresh, le MÊME dernier profil revient
// C — fermer / revenir plus tard : même résultat (même chemin de résolution)
// =====================================================================
section('B/C — après rechargement : la pile est vide, le repli prend le relais');
{
  // Au rechargement, les profils déjà swipés sont filtrés à la source (BUG #25) :
  // profilesLength === 0. Sans repli → écran vide. Avec repli → la carte revient.
  const sansRepli = resolveDiscoveryView({ profilesLength: 0, currentIndex: 0 });
  egal('B1. pile vide + aucun historique → empty', sansRepli.mode, 'empty');

  const avecRepli = resolveDiscoveryView({
    profilesLength: 0,
    currentIndex: 0,
    hasLastSeenFallback: true,
  });
  egal('B2. pile vide + repli → last-seen', avecRepli.mode, 'last-seen');
  vrai('B3. le repli est bien utilisé', avecRepli.useFallbackProfile);
  egal('B4. aucun index de pile à lire', avecRepli.displayIndex, null);
  vrai('B5. bandeau affiché après rechargement', avecRepli.showEndBanner);
  vrai('B6. actions verrouillées après rechargement', avecRepli.actionsDisabled);

  // Le repli ne prend JAMAIS le pas sur une pile non vide.
  const pilePleine = resolveDiscoveryView({
    profilesLength: 2,
    currentIndex: 0,
    hasLastSeenFallback: true,
  });
  egal('B7. pile non vide → la pile fait foi, pas le repli', pilePleine.mode, 'active');
  vrai('B8. repli ignoré quand la pile a des cartes', pilePleine.useFallbackProfile === false);
}

section('B/C — QUEL profil : le dernier like/pass, par createdAt (aucun champ ajouté)');
{
  const likes = [
    { toUid: 'ancien-like', createdAt: { seconds: 1_700_000_000 } },
    { toUid: 'recent-like', createdAt: { seconds: 1_800_000_500 } },
  ];
  const passes = [
    { toUid: 'pass-milieu', createdAt: { seconds: 1_750_000_000 } },
    { toUid: 'dernier-vu', createdAt: { seconds: 1_800_001_000 } },
  ];

  egal('C1. le plus récent des deux collections gagne', pickLastSwipedUid(likes, passes), 'dernier-vu');

  const classe = rankSwipesByRecency(likes, passes);
  egal(
    'C2. classement complet du plus récent au plus ancien',
    classe.map((c) => c.toUid),
    ['dernier-vu', 'recent-like', 'pass-milieu', 'ancien-like'],
  );

  // Un même uid liké PUIS passé ne doit apparaître qu'une fois, au rang le plus récent.
  const doublon = rankSwipesByRecency(
    [{ toUid: 'u1', createdAt: { seconds: 100 } }],
    [{ toUid: 'u1', createdAt: { seconds: 900 } }, { toUid: 'u2', createdAt: { seconds: 500 } }],
  );
  egal('C3. dédoublonnage au rang le plus récent', doublon.map((c) => c.toUid), ['u1', 'u2']);

  // Documents inexploitables : jamais de crash, jamais de faux profil.
  const sale = rankSwipesByRecency(
    [{ toUid: '', createdAt: { seconds: 1 } }, { toUid: '   ', createdAt: { seconds: 2 } }],
    [{ createdAt: { seconds: 3 } }, { toUid: 42 as unknown as string, createdAt: { seconds: 4 } }],
    null,
    undefined,
  );
  egal('C4. uid vides / absents / non-string ignorés', sale, []);
  egal('C5. aucun historique exploitable → null (pas de profil inventé)', pickLastSwipedUid([], []), null);

  // Horodatage `serverTimestamp()` encore en vol : le doc n'est pas jeté, il
  // passe en queue — mieux qu'un écran noir, et il se résoudra au prochain load.
  const enVol = rankSwipesByRecency(
    [{ toUid: 'sans-date' }],
    [{ toUid: 'date-connue', createdAt: { seconds: 10 } }],
  );
  egal('C6. doc sans createdAt relégué après les datés', enVol.map((c) => c.toUid), ['date-connue', 'sans-date']);
  egal('C7. le doc sans date porte at=null', enVol[1].at, null);

  // Formes d'horodatage rencontrées selon le SDK.
  egal('C8. Timestamp.toMillis()', swipeCreatedAtMillis({ toMillis: () => 1234 }), 1234);
  egal('C9. { seconds }', swipeCreatedAtMillis({ seconds: 2 }), 2000);
  egal('C10. { _seconds } (Admin SDK sérialisé)', swipeCreatedAtMillis({ _seconds: 3 }), 3000);
  egal('C11. Date', swipeCreatedAtMillis(new Date(5000)), 5000);
  egal('C12. ISO string', swipeCreatedAtMillis('2026-01-01T00:00:00.000Z'), Date.parse('2026-01-01T00:00:00.000Z'));
  egal('C13. epoch ms', swipeCreatedAtMillis(1_800_000_000_000), 1_800_000_000_000);
  egal('C14. epoch s', swipeCreatedAtMillis(1_800_000_000), 1_800_000_000_000);
  egal('C15. null → null', swipeCreatedAtMillis(null), null);
  egal('C16. valeur inexploitable → null', swipeCreatedAtMillis({ nope: true }), null);
}

// =====================================================================
// D/E — pass et like déjà consommés : non réexécutables
// =====================================================================
section('D/E — les actions consommées sont verrouillées');
{
  const finEnSession = resolveDiscoveryView({ profilesLength: 2, currentIndex: 2 });
  vrai('D1. après un pass sur la dernière carte, actions verrouillées', finEnSession.actionsDisabled);

  const finApresRefresh = resolveDiscoveryView({
    profilesLength: 0,
    currentIndex: 0,
    hasLastSeenFallback: true,
  });
  vrai('E1. après rechargement, actions toujours verrouillées', finApresRefresh.actionsDisabled);

  const active = resolveDiscoveryView({ profilesLength: 2, currentIndex: 0 });
  vrai('D2. carte active → actions ouvertes', active.actionsDisabled === false);

  // Câblage réel des 3 boutons de matching.
  vrai(
    'D3. bouton Pass désactivé en fin de pile',
    /data-testid="discovery-action-pass"/.test(SOURCE_PAGE) &&
      /onClick=\{handlePass\}\s*\n\s*disabled=\{actionsConsommees\}/.test(SOURCE_PAGE),
  );
  vrai(
    'E2. bouton Like désactivé en fin de pile',
    /onClick=\{handleLike\}\s*\n\s*disabled=\{actionsConsommees\}/.test(SOURCE_PAGE),
  );
  vrai(
    'E3. bouton Chat direct désactivé en fin de pile',
    /onClick=\{handleDirectChat\}\s*\n\s*disabled=\{actionsConsommees\}/.test(SOURCE_PAGE),
  );
  // Ceinture : même appelés par un autre chemin, les handlers refusent d'écrire.
  vrai(
    'D4. handlePass refuse d\'écrire quand l\'action est consommée',
    /const handlePass = async \(\) => \{[\s\S]{0,320}?if \(actionsConsommees\) return;/.test(SOURCE_PAGE),
  );
  vrai(
    'E4. handleLike refuse d\'écrire quand l\'action est consommée',
    /const handleLike = async \(\) => \{[\s\S]{0,320}?if \(actionsConsommees\) return;/.test(SOURCE_PAGE),
  );
  vrai(
    'E5. handleDirectChat refuse de débiter quand l\'action est consommée',
    /const handleDirectChat = async \(\) => \{[\s\S]{0,320}?if \(actionsConsommees\) return;/.test(SOURCE_PAGE),
  );
}

// =====================================================================
// F — « Où pratiquer ? » survit    G — « Réserver » survit
// =====================================================================
section('F/G — « Où pratiquer ? » et « Réserver » restent branchés');
{
  vrai(
    'F1. bouton principal « Où pratiquer ? » hors de la branche carte',
    SOURCE_PAGE.indexOf("onClick={() => setShowWherePracticeModal(true)}") <
      SOURCE_PAGE.indexOf('{currentProfile ? ('),
  );
  vrai(
    'F2. modale « Où pratiquer ? » toujours présente',
    SOURCE_PAGE.includes('showWherePracticeModal') && SOURCE_PAGE.includes('wherePracticeGroups'),
  );
  vrai(
    'F3. source de données « Où pratiquer ? » inchangée (groupBoostedActivitiesByCity)',
    SOURCE_PAGE.includes('groupBoostedActivitiesByCity('),
  );
  vrai('G1. « Réserver » toujours câblé sur handleBookSession', SOURCE_PAGE.includes('onClick={handleBookSession}'));
  vrai(
    'G2. « Réserver » NON désactivé par la fin de pile',
    !/onClick=\{handleBookSession\}[\s\S]{0,200}?disabled=\{actionsConsommees\}/.test(SOURCE_PAGE),
  );
  vrai(
    'G3. source des activités inchangée (partnerOwnedActivities / visibleActivities)',
    SOURCE_PAGE.includes('partnerOwnedActivities') && SOURCE_PAGE.includes('visibleActivities'),
  );
  // LE PIÈGE : l'effet qui alimente partnerOwnedActivities ne doit PAS relire
  // profiles[currentIndex] en direct, sinon « Réserver » propose les activités
  // d'un autre profil que celui affiché.
  vrai(
    'G4. l\'effet partnerOwnedActivities partage la MÊME décision (plus de profiles[currentIndex] brut)',
    !SOURCE_PAGE.includes('const profile = profiles[currentIndex] as any;') &&
      (SOURCE_PAGE.match(/resolveDiscoveryView\(\{/g) || []).length >= 2,
  );
}

// =====================================================================
// H — un nouveau profil éligible reprend la main automatiquement
// =====================================================================
section('H — nouveau profil éligible : reprise automatique');
{
  // Au chargement suivant, loadFirestoreProfiles fait setProfiles(...) +
  // setCurrentIndex(0) : la décision repasse en 'active' toute seule.
  const reprise = resolveDiscoveryView({
    profilesLength: 1,
    currentIndex: 0,
    hasLastSeenFallback: true,
  });
  egal('H1. nouveau profil → mode actif', reprise.mode, 'active');
  egal('H2. carte = le nouveau profil', reprise.displayIndex, 0);
  vrai('H3. bandeau disparu', reprise.showEndBanner === false);
  vrai('H4. actions réactivées', reprise.actionsDisabled === false);
  vrai('H5. aucun reset manuel requis (setCurrentIndex(0) au chargement)', SOURCE_PAGE.includes('setCurrentIndex(0);'));
}

// =====================================================================
// I — utilisateur qui n'a JAMAIS eu de profil éligible
// =====================================================================
section('I — jamais aucun profil : état vide propre et compact');
{
  const vide = resolveDiscoveryView({ profilesLength: 0, currentIndex: 0, hasLastSeenFallback: false });
  egal('I1. mode empty', vide.mode, 'empty');
  egal('I2. rien à afficher depuis la pile', vide.displayIndex, null);
  vrai('I3. pas de repli', vide.useFallbackProfile === false);
  vrai('I4. pas de bandeau de fin de pile (il n\'y a pas de carte)', vide.showEndBanner === false);

  vrai('I5. état vide présent et identifiable', SOURCE_PAGE.includes('data-testid="discovery-aucun-profil"'));
  vrai(
    'I6. état vide compact : plus de min-h-[60vh] plein écran noir',
    !SOURCE_PAGE.includes('min-h-[60vh] text-center px-4'),
  );
  vrai('I7. textes présents dans les TROIS langues', (SOURCE_I18N.match(/discovery_empty_title:/g) || []).length === 3);
  vrai(
    'I8. textes du bandeau présents dans les TROIS langues',
    (SOURCE_I18N.match(/discovery_end_banner_title:/g) || []).length === 3 &&
      (SOURCE_I18N.match(/discovery_end_banner_text:/g) || []).length === 3,
  );
  vrai(
    'I9. « aucun profil » n\'est PAS annoncé tant que le repli n\'est pas résolu',
    SOURCE_PAGE.includes('data-testid="discovery-chargement"') &&
      /\) : loadingProfiles \|\| repliEnCours \? \(/.test(SOURCE_PAGE),
  );
}

// =====================================================================
// Bouton « Revoir les profils passés » retiré du parcours,
// resetProfiles() et son AlertDialog CONSERVÉS
// =====================================================================
section('Parcours — « Revoir les profils passés » retiré, resetProfiles() intact');
{
  vrai(
    'R1. bouton retiré de l\'écran discovery',
    !SOURCE_PAGE.includes('data-testid="discovery-revoir-passes"'),
  );
  vrai('R2. resetProfiles() TOUJOURS présent dans le code', SOURCE_PAGE.includes('const resetProfiles = async () => {'));
  vrai(
    'R3. AlertDialog de confirmation TOUJOURS présent',
    SOURCE_PAGE.includes('data-testid="discovery-revoir-confirmer"') &&
      SOURCE_PAGE.includes('void resetProfiles();'),
  );
  vrai(
    'R4. aucune suppression de données déclenchée par le nouvel écran',
    !/discovery-aucun-profil[\s\S]{0,900}resetProfiles/.test(SOURCE_PAGE),
  );
}

// =====================================================================
// J — mobile : photo dominante, message compact, aucun débordement
// =====================================================================
section('J — mobile : bandeau compact, aucun débordement horizontal');
{
  const bandeau = SOURCE_PAGE.match(
    /data-testid="discovery-fin-de-pile-bandeau"[\s\S]{0,900}?<\/div>\s*<\/div>\s*\)\}/,
  );
  vrai('J1. bandeau présent dans le JSX', bandeau !== null);
  const bloc = bandeau ? bandeau[0] : '';
  const ancrage = SOURCE_PAGE.match(/className="[^"]*"\s*\n\s*data-testid="discovery-fin-de-pile-bandeau"/);
  const classesAncrage = ancrage ? ancrage[0] : '';
  vrai(
    'J2. largeur fluide (left/right), jamais une largeur fixe en pixels',
    classesAncrage.includes('left-3') && classesAncrage.includes('right-3') && !/w-\[\d+px\]/.test(classesAncrage),
  );
  vrai('J3. bandeau borné en largeur (max-w-sm) → pas d\'étirement desktop', bloc.includes('max-w-sm'));
  vrai('J4. non bloquant : pointer-events-none', classesAncrage.includes('pointer-events-none'));
  vrai(
    'J5. posé sur le BAS de la photo (pas sur le visage, pas en plein écran)',
    classesAncrage.includes('bottom-28') && classesAncrage.includes('absolute'),
  );
  vrai('J6. texte compact (13px) et coupé proprement', bloc.includes('text-[13px]') && bloc.includes('break-words'));
  vrai(
    'J7. la carte n\'est PAS remplacée par un fond noir plein écran',
    !/finDePile\s*\?\s*\(/.test(SOURCE_PAGE),
  );
  vrai(
    'J8. le bandeau vit DANS la zone photo (donc la photo reste dominante)',
    SOURCE_PAGE.indexOf('data-testid="discovery-fin-de-pile-bandeau"') >
      SOURCE_PAGE.indexOf('=== PHOTO ZONE ===') &&
      SOURCE_PAGE.indexOf('data-testid="discovery-fin-de-pile-bandeau"') <
        SOURCE_PAGE.indexOf('=== INFO ZONE ==='),
  );
}

// =====================================================================
// Honnêteté du texte (exigence 10) — aucune promesse de notification
// =====================================================================
section('Texte — aucune promesse mensongère de notification');
{
  const interdits = [
    'on te préviendra',
    'nous te préviendrons',
    'tu seras notifié',
    'tu recevras une notification',
    "we'll notify you",
    'you will be notified',
    'wir benachrichtigen dich',
  ];
  const extrait = SOURCE_I18N.match(/discovery_end_banner_[\s\S]{0,400}?discovery_empty_subtitle:[^\n]*/g) || [];
  const texte = extrait.join('\n').toLowerCase();
  const fautif = interdits.find((mot) => texte.includes(mot));
  vrai(
    'N1. aucun texte ne promet une notification (aucune n\'existe)',
    fautif === undefined,
    `promesse trouvée : « ${fautif} »`,
  );
  vrai('N2. le texte reste factuel « apparaîtront ici »', texte.includes('apparaîtront ici'));
}

// =====================================================================
console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
if (_failures > 0) process.exit(1);
