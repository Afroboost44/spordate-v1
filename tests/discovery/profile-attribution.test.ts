/**
 * FIX ATTRIBUTION DISCOVERY — une activité n'apparaît que sous SON propriétaire.
 *
 * Exécution :
 *   npm run test:discovery:attribution
 *
 * Pattern : script `npx tsx` autonome (comme end-of-stack.test.ts) — pas de
 * Vitest, pas d'émulateur, pas de DOM.
 *
 * CE QUI EST EN JEU. `src/app/discovery/page.tsx` fermait la sélection des
 * activités d'un profil par `return visibleActivities` — TOUTES les activités
 * boostées du système. Un utilisateur ordinaire, propriétaire de rien, voyait
 * donc sous sa carte les activités payantes d'autres partenaires, et le bouton
 * « Réserver » présélectionnait `partnerActivities[0]` : l'activité de
 * quelqu'un d'autre, juste avant un paiement.
 *
 * Deux familles de tests :
 *   - A..H  → assertions PURES sur src/lib/discovery/profileActivities.ts
 *   - I..K  → assertions sur le SOURCE de page.tsx (le repli est-il vraiment
 *     parti, « Où pratiquer ? » est-il resté à l'écart, R1 est-il intact)
 */

export {}; // module scope (sinon globals collide tsc)

import * as fs from 'fs';
import * as path from 'path';
import { activitesDuProfil } from '../../src/lib/discovery/profileActivities';

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

// Jeu de données commun : deux partenaires réels, une activité chacun.
const UID_A = 'uid-partenaire-A';
const UID_B = 'uid-partenaire-B';
const UID_SIMPLE = 'uid-utilisateur-ordinaire';

const ACT_A = { id: 'act-A', activityId: 'act-A', partnerId: UID_A, isActive: true };
const ACT_A2 = { id: 'act-A2', activityId: 'act-A2', partnerId: UID_A, isActive: true };
const ACT_B = { id: 'act-B', activityId: 'act-B', partnerId: UID_B, isActive: true };

// =====================================================================
// A — partenaire A + activité A → activité A visible
// =====================================================================
section('A — le partenaire voit ses propres activités');
{
  egal(
    'A1. activité ACTIVE du partenaire A rendue',
    activitesDuProfil({ profilUid: UID_A, activitesPossedees: [ACT_A], activitesBoostees: [] }),
    [ACT_A],
  );
  egal(
    'A2. plusieurs activités du même partenaire : toutes rendues',
    activitesDuProfil({
      profilUid: UID_A,
      activitesPossedees: [ACT_A, ACT_A2],
      activitesBoostees: [],
    }).map((a) => a.id),
    ['act-A', 'act-A2'],
  );
  // Fix #207 conservé : les ACTIVES priment, boostées ou non.
  egal(
    'A3. Fix #207 conservé — les activités ACTIVES priment sur les boostées',
    activitesDuProfil({
      profilUid: UID_A,
      activitesPossedees: [ACT_A2],
      activitesBoostees: [ACT_A],
    }).map((a) => a.id),
    ['act-A2'],
  );
}

// =====================================================================
// B — partenaire A + activité appartenant à B → absente
// =====================================================================
section('B — l\'activité d\'un autre partenaire n\'apparaît jamais');
{
  egal(
    'B1. activité de B écartée sous le profil de A (liste possédées)',
    activitesDuProfil({ profilUid: UID_A, activitesPossedees: [ACT_B], activitesBoostees: [] }),
    [],
  );
  egal(
    'B2. activité de B écartée sous le profil de A (liste boostées)',
    activitesDuProfil({ profilUid: UID_A, activitesPossedees: [], activitesBoostees: [ACT_B] }),
    [],
  );
  egal(
    'B3. liste mêlée → seules celles de A survivent',
    activitesDuProfil({
      profilUid: UID_A,
      activitesPossedees: [ACT_B, ACT_A, ACT_B],
      activitesBoostees: [],
    }).map((a) => a.id),
    ['act-A'],
  );
  // La course réelle : l'effet asynchrone ne VIDE pas la liste au swipe, donc
  // `activitesPossedees` contient encore le profil PRÉCÉDENT pendant le rendu.
  egal(
    'B4. course de chargement — la liste du profil précédent ne fuit pas',
    activitesDuProfil({ profilUid: UID_B, activitesPossedees: [ACT_A], activitesBoostees: [] }),
    [],
  );
}

// =====================================================================
// C — profil non-partenaire + activités boostées ailleurs → rien d'hérité
// =====================================================================
section('C — un utilisateur ordinaire n\'hérite d\'aucune activité boostée');
{
  egal(
    'C1. aucune activité héritée sous un profil sans possession',
    activitesDuProfil({
      profilUid: UID_SIMPLE,
      activitesPossedees: [],
      activitesBoostees: [ACT_A, ACT_B],
    }),
    [],
  );
  egal(
    'C2. même avec beaucoup de boosts actifs dans le système',
    activitesDuProfil({
      profilUid: UID_SIMPLE,
      activitesPossedees: [],
      activitesBoostees: [ACT_A, ACT_A2, ACT_B],
    }),
    [],
  );
}

// =====================================================================
// D — profil sans partnerId fiable → []
// =====================================================================
section('D — sans identifiant de profil, aucune activité');
{
  const boostees = [ACT_A, ACT_B];
  egal('D1. uid undefined', activitesDuProfil({ profilUid: undefined, activitesBoostees: boostees }), []);
  egal('D2. uid null', activitesDuProfil({ profilUid: null, activitesBoostees: boostees }), []);
  egal('D3. uid vide', activitesDuProfil({ profilUid: '', activitesBoostees: boostees }), []);
  egal('D4. uid = blancs (pas une identité)', activitesDuProfil({ profilUid: '   ', activitesBoostees: boostees }), []);
  // Symétrie : une activité SANS partnerId ne s'attache à personne.
  egal(
    'D5. activité sans partnerId → attachée à personne',
    activitesDuProfil({
      profilUid: UID_A,
      activitesPossedees: [{ id: 'orpheline', partnerId: undefined } as any],
      activitesBoostees: [],
    }),
    [],
  );
  egal(
    'D6. partnerId vide ne matche pas un uid vide (deux inconnus ≠ égalité)',
    activitesDuProfil({
      profilUid: '',
      activitesPossedees: [{ id: 'orpheline', partnerId: '' } as any],
      activitesBoostees: [],
    }),
    [],
  );
}

// =====================================================================
// E — aucune activité correspondante → []
// =====================================================================
section('E — aucune correspondance : liste vide, jamais un repli');
{
  egal('E1. les deux listes vides', activitesDuProfil({ profilUid: UID_A, activitesPossedees: [], activitesBoostees: [] }), []);
  egal('E2. les deux listes absentes', activitesDuProfil({ profilUid: UID_A }), []);
  egal(
    'E3. listes non-tableaux (défensif)',
    activitesDuProfil({
      profilUid: UID_A,
      activitesPossedees: null as any,
      activitesBoostees: undefined as any,
    }),
    [],
  );
}

// =====================================================================
// F — activité boostée expirée → absente (logique existante en amont)
// =====================================================================
section('F — un boost expiré n\'entre jamais dans la liste');
{
  // Le filtre boost vit dans page.tsx (`visibleActivities`), pas ici : une
  // activité expirée n'est tout simplement PAS passée au module.
  egal(
    'F1. activité expirée absente de l\'entrée → absente de la sortie',
    activitesDuProfil({ profilUid: UID_A, activitesPossedees: [], activitesBoostees: [] }),
    [],
  );
  vrai(
    'F2. le filtre boost reste en amont, inchangé (boostedActivityIds / boostedPartnerIds)',
    /const visibleActivities = realActivities\.filter\([\s\S]{0,200}boostedActivityIds\.has\(act\.id\)[\s\S]{0,120}boostedPartnerIds\.has\(act\.partnerId\)/.test(
      SOURCE_PAGE,
    ),
  );
  vrai(
    'F3. l\'expiration du boost est toujours évaluée (expiresAt)',
    SOURCE_PAGE.includes('expiresAt'),
  );
}

// =====================================================================
// G — activité boostée valide du BON partenaire → toujours visible
// =====================================================================
section('G — le repli boosté légitime survit');
{
  egal(
    'G1. boostée du bon partenaire rendue quand aucune ACTIVE n\'est chargée',
    activitesDuProfil({ profilUid: UID_A, activitesPossedees: [], activitesBoostees: [ACT_A] }),
    [ACT_A],
  );
  egal(
    'G2. le repli boosté est lui aussi filtré sur le propriétaire',
    activitesDuProfil({
      profilUid: UID_A,
      activitesPossedees: [],
      activitesBoostees: [ACT_B, ACT_A, ACT_A2],
    }).map((a) => a.id),
    ['act-A', 'act-A2'],
  );
}

// =====================================================================
// H — plusieurs partenaires → aucune contamination croisée
// =====================================================================
section('H — aucune contamination croisée entre partenaires');
{
  const monde = [ACT_A, ACT_A2, ACT_B];
  const vuA = activitesDuProfil({ profilUid: UID_A, activitesPossedees: monde, activitesBoostees: monde });
  const vuB = activitesDuProfil({ profilUid: UID_B, activitesPossedees: monde, activitesBoostees: monde });
  const vuSimple = activitesDuProfil({ profilUid: UID_SIMPLE, activitesPossedees: monde, activitesBoostees: monde });
  egal('H1. A ne voit que ses deux activités', vuA.map((a) => a.id), ['act-A', 'act-A2']);
  egal('H2. B ne voit que la sienne', vuB.map((a) => a.id), ['act-B']);
  egal('H3. l\'utilisateur ordinaire ne voit rien', vuSimple, []);
  vrai(
    'H4. les trois vues sont disjointes (aucun id partagé)',
    vuA.every((a) => !vuB.some((b) => b.id === a.id)) && vuSimple.length === 0,
  );
  // Aucune mutation des entrées : le module ne réordonne ni ne vide rien.
  egal('H5. la liste d\'entrée n\'est pas mutée', monde.map((a) => a.id), ['act-A', 'act-A2', 'act-B']);
}

// =====================================================================
// I — aucun repli vers visibleActivities global
// =====================================================================
section('I — le repli global a bien disparu du source');
{
  vrai(
    'I1. plus aucun `return visibleActivities` dans page.tsx',
    !/return\s+visibleActivities\s*;/.test(SOURCE_PAGE),
    'le repli « toutes les activités boostées » est encore là',
  );
  vrai(
    'I2. partnerActivities passe par la fonction pure attribuée',
    /const partnerActivities = activitesDuProfil\(\{/.test(SOURCE_PAGE),
  );
  vrai(
    'I3. le module pur est bien importé',
    SOURCE_PAGE.includes("from '@/lib/discovery/profileActivities'"),
  );
  vrai(
    'I4. les deux points d\'appel savent afficher le vide (wizard + toast)',
    SOURCE_PAGE.includes("{partnerActivities.length === 0 ? (") &&
      /if \(!activity && partnerActivities\.length === 0\) \{[\s\S]{0,200}toast\(/.test(SOURCE_PAGE),
  );
  vrai(
    'I5. « Réserver » ne présélectionne plus jamais l\'activité d\'un autre',
    /const pick = activity \?\? partnerActivities\[0\] \?\? null;/.test(SOURCE_PAGE) &&
      !/visibleActivities\[0\]/.test(SOURCE_PAGE),
  );
}

// =====================================================================
// J — « Où pratiquer ? » inchangé
// =====================================================================
section('J — « Où pratiquer ? » n\'a jamais eu ce repli, et n\'y touche pas');
{
  vrai(
    'J1. wherePracticeGroups vient toujours de groupBoostedActivitiesByCity',
    /const wherePracticeGroups = useMemo\(\(\) => \{[\s\S]{0,400}groupBoostedActivitiesByCity\(/.test(
      SOURCE_PAGE,
    ),
  );
  // R3c — la liste passee au regroupement est desormais une FUSION
  // (activites natives + offres Afroboost eligibles). Ce qui compte n'a pas
  // change d'un iota : elle part de `realActivities` et des jeux de boost, et
  // jamais des activites du profil affiche — c'est precisement le melange qui
  // faisait vendre a un inconnu les activites d'un autre.
  vrai(
    'J2. il lit realActivities + les sets de boost',
    /groupBoostedActivitiesByCity\(\s*(?:fusionnerSansDoublon\(\s*)?realActivities[\s\S]{0,120}boostedPartnerIds,/.test(
      SOURCE_PAGE,
    ),
  );
  const blocMemo = SOURCE_PAGE.match(/const wherePracticeGroups = useMemo\(\(\) => \{[\s\S]{0,900}?\}, \[[^\]]*\]\);/);
  vrai(
    'J2b. et JAMAIS les activites du profil affiche',
    blocMemo !== null
      && !blocMemo[0].includes('partnerActivities')
      && !blocMemo[0].includes('partnerOwnedActivities')
      && !blocMemo[0].includes('visibleActivities'),
  );
  const blocOu = SOURCE_PAGE.match(/const wherePracticeGroups = useMemo\(\(\) => \{[\s\S]{0,600}?\}, \[/);
  vrai(
    'J3. la logique d\'attribution n\'a PAS été déplacée dans « Où pratiquer ? »',
    blocOu !== null && !blocOu[0].includes('activitesDuProfil'),
  );
}

// =====================================================================
// K — R1 / discovery existant : aucune régression
// =====================================================================
section('K — R1 et le reste de discovery restent en place');
{
  vrai(
    'K1. R1 — resolveDiscoveryView toujours la décision unique de la carte',
    (SOURCE_PAGE.match(/resolveDiscoveryView\(/g) || []).length >= 2,
  );
  vrai(
    'K2. l\'effet de chargement des activités du partenaire est intact',
    /where\('partnerId', '==', uid\)/.test(SOURCE_PAGE),
  );
  vrai(
    'K3. le pont U2b / R3b-ID n\'est pas touché ici',
    !/bridge_identity_links/.test(SOURCE_PAGE),
  );
  // R3c — les offres Afroboost SONT branchees maintenant, mais uniquement dans
  // « Ou pratiquer ? ». Elles ne doivent jamais atteindre l'attribution d'un
  // profil : une carte swipee ne vend que ce qui appartient a la personne
  // qu'elle montre.
  vrai(
    'K4. les offres Afroboost ne touchent PAS l\'attribution du profil',
    !/activitesPossedees\s*:[^,\n]*(offresAfroboost|elementsAfroboost)/.test(SOURCE_PAGE)
      && !/activitesBoostees\s*:[^,\n]*(offresAfroboost|elementsAfroboost)/.test(SOURCE_PAGE),
  );
  vrai(
    'K5. elles ne servent QUE le regroupement par ville',
    (SOURCE_PAGE.match(/elementsAfroboost/g) || []).length > 0
      && /groupBoostedActivitiesByCity\([\s\S]{0,200}elementsAfroboost/.test(SOURCE_PAGE),
  );
}

// =====================================================================
console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
if (_failures > 0) process.exit(1);
