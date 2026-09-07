/**
 * R3c — LES OFFRES AFROBOOST DANS « OÙ PRATIQUER ? ».
 *
 * Exécution :
 *   npx tsx tests/discovery/offres-afroboost-ou-pratiquer.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Deux portes mènent à ce modal, et une seule est payante. L'admin entre
 * gratuitement ; un partenaire n'entre que muni d'un boost R3b-2 visant
 * précisément son offre. Entre les deux, six types métier n'entrent jamais,
 * même boostés. Se tromper ici, c'est afficher l'offre d'un inconnu sous le
 * nom d'un autre, ou faire payer une visibilité déjà due.
 *
 *   A/B. admin single_class / event      → visible gratuitement
 *   C-E. admin pack / product / abo      → absentes
 *   F.   partenaire + boost actif        → visible
 *   G.   partenaire sans boost           → absente
 *   H.   partenaire + boost expiré       → absente
 *   I.   boost de l'offre B              → l'offre A reste absente
 *   J.   deux partenaires                → aucune contamination
 *   K.   partenaire sans identifiant     → absente (aucun boost n'a pu naître)
 *   L.   offre invisible                 → absente (filtrée en amont)
 *   M.   type / propriété inconnus       → absentes
 *   N/O. activités natives               → comportement inchangé
 *   P.   boost « compte entier »         → n'active JAMAIS une offre
 *   Q.   aucune écriture dans activities
 *   R.   plusieurs villes                → bon regroupement
 *   S.   ville manquante                 → aucune ville inventée
 *   T.   même titre, ids différents      → deux entrées
 *   U.   même source + même id           → une seule entrée
 *   V.   FIX ATTRIBUTION                 → aucun fallback réintroduit
 *   W/X. /partner/boost                  → cible nommée, repli explicite
 *
 * AUCUNE DONNÉE RÉELLE N'EST FABRIQUÉE : tout est en mémoire. En production,
 * les 3 offres publiques sont `admin` — la porte partenaire n'a donc encore
 * jamais servi, et ce banc est le seul endroit où elle est éprouvée.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ORIGINE_AFROBOOST,
  SOURCE_AFROBOOST,
  absolutiserMedia,
  cleDeduplication,
  elementsAfroboostAPratiquer,
  fusionnerSansDoublon,
  versElementAPratiquer,
  verdictAffichageOffre,
} from '../../src/lib/discovery/offresAfroboostAPratiquer';
import { groupBoostedActivitiesByCity } from '../../src/lib/discovery/whereToPractice';
import { classerBoosts, libelleCibleBoost } from '../../src/lib/boost/cible';
import { versOffrePublique } from '../../src/lib/afroboost/offers';

let _passes = 0;
let _failures = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _passes++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _failures++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie alors qu\'elle devait etre fausse') { if (!c) pass(l); else fail(l, d); }
function egal(l: string, obtenu: unknown, attendu: unknown) {
  if (obtenu === attendu) pass(l);
  else fail(l, `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);
}
function section(t: string) { console.log(`\n--- ${t} ---`); }

const OWNER_A = '11111111-2222-3333-4444-555555555555';
const OWNER_B = '99999999-8888-7777-6666-555555555555';
const UID_A = 'firebase-uid-AAAA';
const OFFRE_A = 'offre-afro-AAAA-1111';
const OFFRE_B = 'offre-afro-BBBB-2222';
const MAINTENANT = 1_800_000_000_000;
const HEURE = 60 * 60 * 1000;

/** Une offre publique complète, telle que l'adaptateur R3b-1 la rend. */
function offre(p: Partial<any> = {}): any {
  return {
    id: OFFRE_A, nom: 'Cours test', description: '', prix: 25, image: null,
    lieuTexte: 'Bord du Lac, Auvernier', participantsMax: null, categorieBrute: null,
    estProduit: false, nombreCoursLies: 0, aUneDuree: false,
    proprietaire: 'admin', proprietaireId: null, typeOffre: 'single_class',
    ville: 'Auvernier', adresse: null, latitude: null, longitude: null,
    ...p,
  };
}
/** Une activité native Spordate, telle que Firestore la rend. */
function native(p: Partial<any> = {}): any {
  return { id: 'act-1', activityId: 'act-1', partnerId: UID_A, city: 'Genève', isActive: true, name: 'Yoga', ...p };
}
function jeu(...ids: string[]) { return new Set<string>(ids); }
function horodatage(ms: number) { return { toMillis: () => ms }; }

function codeSeul(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}
/** Les titres rendus par le modal, ville par ville. */
function titresParVille(groupes: Array<{ city: string; activities: any[] }>) {
  return groupes.map((g) => `${g.city}: ${g.activities.map((a) => a.title || a.name).join(', ')}`);
}

function principal() {

section('A / B — LOT C : l\'admin n\'entre PLUS automatiquement');
{
  // C'ETAIT LA REGLE D'AVANT : publiee + pratiquable = affichee, sans que
  // personne ne l'ait choisie. Elle est retiree.
  for (const type of ['single_class', 'event']) {
    const o = offre({ typeOffre: type });
    const v: any = verdictAffichageOffre(o, jeu());
    faux(`A1. admin ${type} SANS mise en avant -> exclue`, v.affichee);
    egal(`A2. motif ${type}`, v.motif, 'sans-mise-en-avant');
    // Et avec une mise en avant vivante, elle entre.
    vrai(`A3. admin ${type} AVEC mise en avant -> affichee`,
         verdictAffichageOffre(o, jeu(OFFRE_A)).affichee);
  }
  const elems = elementsAfroboostAPratiquer([offre({ typeOffre: 'event' })], jeu(OFFRE_A));
  egal('B1. une offre retenue', elems.length, 1);
  egal('B2. marquee comme venant du catalogue', elems[0].source, SOURCE_AFROBOOST);
  egal('B3. son droit d\'entree est deja tranche', elems[0].estDejaEligible, true);
  egal('B4. active pour le regroupement', elems[0].isActive, true);
  egal('B5. rattachee a AUCUN partenaire Spordate', elems[0].partnerId, '');
}

section('C / D / E / M — les types qui n\'entrent jamais');
{
  for (const type of ['pack', 'product', 'subscription', 'membership', 'other', 'unknown']) {
    const v = verdictAffichageOffre(offre({ typeOffre: type }), jeu());
    faux(`C1. admin ${type} -> absente`, v.affichee);
    egal(`C2. motif ${type}`, (v as any).motif, 'type-non-pratiquable');
    // Et un boost ne les rachete PAS : le boost debloque un type deja permis.
    const avecBoost = verdictAffichageOffre(
      offre({ typeOffre: type, proprietaire: 'partner', proprietaireId: OWNER_A }), jeu(OFFRE_A));
    faux(`C3. ${type} BOOSTE reste absente`, avecBoost.affichee);
    egal(`C4. et pour la meme raison (${type})`, (avecBoost as any).motif, 'type-non-pratiquable');
  }
  const inconnue = verdictAffichageOffre(offre({ proprietaire: 'unknown', proprietaireId: OWNER_A }), jeu(OFFRE_A));
  faux('M1. propriete « unknown » -> absente', inconnue.affichee);
  egal('M2. motif', (inconnue as any).motif, 'proprietaire-inconnu');
  faux('M3. offre nulle -> absente', verdictAffichageOffre(null, jeu(OFFRE_A)).affichee);
}

section('F / G / H — le partenaire n\'entre que boosté, et que vivant');
{
  const o = offre({ proprietaire: 'partner', proprietaireId: OWNER_A });
  vrai('F1. partenaire + boost visant CETTE offre -> affichee',
       verdictAffichageOffre(o, jeu(OFFRE_A)).affichee);

  const sans = verdictAffichageOffre(o, jeu());
  faux('G1. meme offre, aucun boost -> absente', sans.affichee);
  egal('G2. motif', (sans as any).motif, 'sans-mise-en-avant');

  // H — l'expiration est tranchee par classerBoosts (R3b-2), pas ici : on
  // fait donc passer un vrai document de boost perime par la vraie fonction.
  const perime = classerBoosts(
    [{ partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT - 1) }],
    MAINTENANT,
  );
  egal('H1. un boost expire ne produit aucun identifiant', perime.offresAfroboost.size, 0);
  faux('H2. donc l\'offre disparait', verdictAffichageOffre(o, perime.offresAfroboost).affichee);

  const vivant = classerBoosts(
    [{ partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) }],
    MAINTENANT,
  );
  vrai('H3. le meme boost, encore vivant, la fait revenir',
       verdictAffichageOffre(o, vivant.offresAfroboost).affichee);
}

section('I / J / K — aucune contamination');
{
  const a = offre({ id: OFFRE_A, proprietaire: 'partner', proprietaireId: OWNER_A, nom: 'Offre A' });
  const b = offre({ id: OFFRE_B, proprietaire: 'partner', proprietaireId: OWNER_B, nom: 'Offre B', ville: 'Lausanne' });

  faux('I1. le boost de B n\'affiche pas A', verdictAffichageOffre(a, jeu(OFFRE_B)).affichee);
  vrai('I2. il affiche B', verdictAffichageOffre(b, jeu(OFFRE_B)).affichee);

  const rendus = elementsAfroboostAPratiquer([a, b], jeu(OFFRE_B)).map((e) => e.offreId);
  egal('J1. une seule offre rendue', rendus.length, 1);
  egal('J2. et c\'est celle du partenaire qui a paye', rendus[0], OFFRE_B);

  // K — un partenaire sans identifiant ne peut PAS avoir de boost valide :
  // `estProprietaireDeLOffre` l'aurait refuse. Le trouver « booste » serait
  // une donnee corrompue, et le doute se ferme.
  const sansId = verdictAffichageOffre(
    offre({ proprietaire: 'partner', proprietaireId: null }), jeu(OFFRE_A));
  faux('K1. partenaire sans identifiant -> absente meme « boostee »', sansId.affichee);
  egal('K2. motif', (sansId as any).motif, 'partenaire-sans-identifiant');
  faux('K3. identifiant vide de blancs -> absente',
       verdictAffichageOffre(offre({ proprietaire: 'partner', proprietaireId: '   ' }), jeu(OFFRE_A)).affichee);
}

section('L — une offre masquee n\'atteint meme pas ce module');
{
  // R3b-1 : `visible === false` fait disparaitre l'offre a l'adaptation. Le
  // filtre est en amont, et c'est le bon endroit — rien d'invisible ne doit
  // traverser la frontiere, meme pour etre refuse plus loin.
  egal('L1. visible=false -> aucune offre publique',
       versOffrePublique({ id: OFFRE_A, name: 'Cachee', visible: false } as any), null);
  egal('L2. visible absent -> visible (defaut du modele)',
       versOffrePublique({ id: OFFRE_A, name: 'Ouverte' } as any)?.id, OFFRE_A);
  egal('L3. et rien d\'invisible ne peut donc etre retenu',
       elementsAfroboostAPratiquer([versOffrePublique({ id: OFFRE_A, name: 'C', visible: false } as any)!].filter(Boolean) as any, jeu()).length, 0);
}

section('N / O / P — les activités natives, inchangées');
{
  const acts = [native({ id: 'act-1', activityId: 'act-1', city: 'Genève' })];
  // N. non boostee -> absente, exactement comme avant.
  egal('N1. activite native non boostee -> absente',
       groupBoostedActivitiesByCity(acts, new Set(), { boostedActivityIds: new Set() }).length, 0);
  // O. boostee par son id -> presente.
  const parId = groupBoostedActivitiesByCity(acts, new Set(), { boostedActivityIds: jeu('act-1') });
  egal('O1. activite boostee par son id -> presente', parId.length, 1);
  egal('O2. dans sa ville', parId[0].city, 'Genève');
  // P. boost « compte entier » -> couvre les natives du compte...
  const legacy = groupBoostedActivitiesByCity(acts, jeu(UID_A), {});
  egal('P1. le boost historique couvre encore les natives', legacy.length, 1);
  // ... mais JAMAIS une offre Afroboost : elle n'est jugee que par son jeu.
  const o = offre({ proprietaire: 'partner', proprietaireId: OWNER_A });
  faux('P2. le boost « compte entier » n\'affiche AUCUNE offre Afroboost',
       verdictAffichageOffre(o, jeu()).affichee);
  const classement = classerBoosts(
    [{ partnerId: UID_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) }], MAINTENANT);
  egal('P3. et un boost historique ne produit aucun identifiant d\'offre',
       classement.offresAfroboost.size, 0);
  egal('P4. il ne remplit que le jeu des comptes couverts', classement.partenairesLegacy.size, 1);
}

section('Q — rien n\'est ecrit, nulle part');
{
  const chemins = [
    'src/lib/discovery/offresAfroboostAPratiquer.ts',
    'src/lib/discovery/whereToPractice.ts',
    'src/app/discovery/page.tsx',
  ];
  for (const chemin of chemins) {
    const code = codeSeul(chemin);
    const ecrit =
      /collection\((?:db|fbDb)?,?\s*'activities'\)[^;]{0,200}\b(setDoc|addDoc|updateDoc|deleteDoc)\b/.test(code) ||
      /\b(addDoc|setDoc)\s*\(\s*collection\([^)]*'activities'/.test(code);
    faux(`Q1. ${chemin} n'ecrit rien dans activities`, ecrit);
  }
  const module_ = codeSeul('src/lib/discovery/offresAfroboostAPratiquer.ts');
  for (const mot of ['firestore', 'firebase', 'addDoc', 'setDoc', 'collection(']) {
    faux(`Q2. le module de normalisation ignore « ${mot} »`, module_.includes(mot));
  }
  // Le module de normalisation ne fait AUCUN appel reseau non plus.
  faux('Q3. et il n\'appelle rien', /\bfetch\s*\(/.test(module_));
}

section('R / S — les villes');
{
  const offres = [
    offre({ id: 'o-1', nom: 'Cours Auvernier', ville: 'Auvernier' }),
    offre({ id: 'o-2', nom: 'Cours Lausanne', ville: 'Lausanne' }),
    offre({ id: 'o-3', nom: 'Cours auvernier bis', ville: ' auvernier ' }),
  ];
  const groupes = groupBoostedActivitiesByCity(
    elementsAfroboostAPratiquer(offres, jeu('o-1', 'o-2', 'o-3')) as any, new Set(), {});
  egal('R1. deux villes distinctes', groupes.length, 2);
  // Casse d'affichage : le PREMIER rencontre gagne, comportement historique.
  egal('R2. regroupement insensible a la casse et aux blancs',
       titresParVille(groupes).join(' | '),
       'Auvernier: Cours Auvernier, Cours auvernier bis | Lausanne: Cours Lausanne');

  // S — pas de ville structuree : on n'en fabrique aucune, meme si `lieuTexte`
  // contient « Auvernier ». Deviner une ville dans une phrase creerait un
  // groupe que personne n'a declare.
  const sansVille = offre({ ville: null, lieuTexte: 'Bord du Lac, Auvernier, Neuchâtel' });
  const v = verdictAffichageOffre(sansVille, jeu(OFFRE_A));
  faux('S1. offre sans ville structuree -> absente', v.affichee);
  egal('S2. motif', (v as any).motif, 'sans-ville');
  egal('S3. aucune ville inventee depuis le texte du lieu',
       elementsAfroboostAPratiquer([sansVille], jeu(OFFRE_A)).length, 0);
  faux('S4. ville faite de blancs -> absente',
       verdictAffichageOffre(offre({ ville: '   ' }), jeu(OFFRE_A)).affichee);
}

section('T / U — la deduplication, sur des identifiants, jamais sur un titre');
{
  const memeTitre = [
    offre({ id: 'o-1', nom: 'Cours d\'essai' }),
    offre({ id: 'o-2', nom: 'Cours d\'essai' }),
  ];
  const elems = elementsAfroboostAPratiquer(memeTitre, jeu('o-1', 'o-2'));
  egal('T1. deux offres de meme titre restent deux offres',
       fusionnerSansDoublon([], elems as any).length, 2);
  const nat = native({ id: 'act-1', name: 'Cours d\'essai' });
  egal('T2. une native et une offre de meme titre ne fusionnent pas',
       fusionnerSansDoublon([nat], elems as any).length, 3);

  egal('U1. meme source + meme id -> une seule fois',
       fusionnerSansDoublon([], [...elems, ...elems] as any).length, 2);
  egal('U2. la cle nomme la source', cleDeduplication(elems[0] as any), `${SOURCE_AFROBOOST}:o-1`);
  egal('U3. une native est dans l\'autre espace de noms', cleDeduplication(nat), 'spordate:act-1');
  // Un identifiant identique de part et d'autre ne se confond donc pas.
  const collision = versElementAPratiquer(offre({ id: 'act-1' }));
  egal('U4. meme id, sources differentes -> deux entrees',
       fusionnerSansDoublon([nat], [collision as any]).length, 2);
  // Et l'ordre est preserve : les natives d'abord.
  egal('U5. les natives passent devant', fusionnerSansDoublon([nat], elems as any)[0].id, 'act-1');
}

section('V — le FIX ATTRIBUTION n\'est pas rouvert');
{
  const page = codeSeul('src/app/discovery/page.tsx');
  // Aucun repli « profil sans activite -> tout ce qui est visible ».
  faux('V1. aucun repli « sinon toutes les activites visibles »',
       /length\s*>\s*0\s*\?\s*\w+\s*:\s*visibleActivities/.test(page));
  vrai('V2. l\'attribution passe toujours par le helper dedie',
       page.includes('activitesPossedees') && page.includes('activitesBoostees'));
  // Une offre Afroboost n'est jamais versee dans l'attribution d'un profil.
  faux('V3. aucune offre Afroboost dans les activites d\'un profil',
       /activitesPossedees\s*:\s*[^,]*[Aa]froboost/.test(page));
  faux('V4. ni dans les activites boostees d\'un profil',
       /activitesBoostees\s*:\s*[^,]*[Aa]froboost/.test(page));
  // Le prechargement des seances ignore les offres (aucune n'en a).
  vrai('V5. le prechargement des seances ecarte les offres',
       page.includes('SOURCE_AFROBOOST') && /source\s*!==\s*SOURCE_AFROBOOST/.test(page));
}

section('W / X — /partner/boost nomme enfin sa cible');
{
  const repli = {
    repliActiviteAbsente: 'Activité supprimée',
    repliOffreAbsente: 'Offre Afroboost indisponible',
    repliToutLeCompte: 'Toutes les activités (boost ancien format)',
  };
  const resolution = {
    activite: (id: string) => (id === 'act-1' ? 'Yoga du matin' : null),
    offreAfroboost: (id: string) => (id === OFFRE_A ? 'Cours d\'essai GRATUIT' : null),
    ...repli,
  };
  egal('W1. cible = offre Afroboost -> son nom',
       libelleCibleBoost({ afroboostOfferId: OFFRE_A }, resolution), 'Cours d\'essai GRATUIT');
  faux('W2. et surtout PAS « activite supprimee »',
       libelleCibleBoost({ afroboostOfferId: OFFRE_A }, resolution) === repli.repliActiviteAbsente);
  egal('X1. offre absente du catalogue -> repli explicite',
       libelleCibleBoost({ afroboostOfferId: 'inconnue' }, resolution), 'Offre Afroboost indisponible');
  faux('X2. le repli ne parle pas d\'activite supprimee',
       libelleCibleBoost({ afroboostOfferId: 'inconnue' }, resolution).includes('supprimée'));
  // Le comportement historique est preserve, mot pour mot.
  egal('X3. activite connue -> son nom', libelleCibleBoost({ activityId: 'act-1' }, resolution), 'Yoga du matin');
  egal('X4. activite effacee -> libelle historique',
       libelleCibleBoost({ activityId: 'act-9' }, resolution), 'Activité supprimée');
  egal('X5. boost historique -> libelle historique',
       libelleCibleBoost({ partnerId: UID_A }, resolution), 'Toutes les activités (boost ancien format)');
  egal('X6. document ambigu -> jamais un nom devine',
       libelleCibleBoost({ activityId: 'act-1', afroboostOfferId: OFFRE_A }, resolution),
       'Toutes les activités (boost ancien format)');
}

section('MEDIAS — un chemin relatif ne suit pas le domaine qui affiche');
{
  egal('Y1. chemin relatif absolutise', absolutiserMedia('/api/files/x.jpg'), `${ORIGINE_AFROBOOST}/api/files/x.jpg`);
  egal('Y2. url absolue intacte', absolutiserMedia('https://cdn.test/x.jpg'), 'https://cdn.test/x.jpg');
  egal('Y3. vide -> null', absolutiserMedia('  '), null);
  const img = versElementAPratiquer(offre({ image: '/api/files/x.jpg' }));
  egal('Y4. une image devient la miniature', (img as any).thumbnailUrl, `${ORIGINE_AFROBOOST}/api/files/x.jpg`);
  const vid = versElementAPratiquer(offre({ image: '/api/files/x.mp4' }));
  egal('Y5. une video passe par la chaine media existante', (vid as any).mediaItems?.[0]?.type, 'video');
  egal('Y6. et son url est absolue', (vid as any).mediaItems?.[0]?.url, `${ORIGINE_AFROBOOST}/api/files/x.mp4`);
  // La seconde ligne de la carte porte le lieu, pas une marque.
  egal('Y7. la carte affiche le lieu', versElementAPratiquer(offre()).partnerName, 'Bord du Lac, Auvernier');
  egal('Y8. le prix traverse', versElementAPratiquer(offre({ prix: 0 })).price, 0);
}

section('LOT C — la mise en avant est la SEULE porte, pour tout le monde');
{
  const admin = offre({ id: OFFRE_A, proprietaire: 'admin', proprietaireId: null });
  const part  = offre({ id: OFFRE_B, proprietaire: 'partner', proprietaireId: OWNER_A, ville: 'Lausanne' });

  // C / I — avec une mise en avant vivante, les deux entrent.
  vrai('LC1. admin + mise en avant exacte -> affichee', verdictAffichageOffre(admin, jeu(OFFRE_A)).affichee);
  vrai('LC2. partenaire + mise en avant exacte -> affichee', verdictAffichageOffre(part, jeu(OFFRE_B)).affichee);

  // A / B / J — sans elle, aucun des deux.
  for (const [qui, o] of [['admin', admin], ['partenaire', part]] as Array<[string, any]>) {
    const v: any = verdictAffichageOffre(o, jeu());
    faux(`LC3. ${qui} sans mise en avant -> exclue`, v.affichee);
    egal(`LC4. motif ${qui}`, v.motif, 'sans-mise-en-avant');
  }

  // D / K — la mise en avant de A ne fait jamais entrer B.
  faux('LC5. mise en avant de B -> A reste exclue', verdictAffichageOffre(admin, jeu(OFFRE_B)).affichee);
  faux('LC6. mise en avant de A -> B reste exclue', verdictAffichageOffre(part, jeu(OFFRE_A)).affichee);
  egal('LC7. deux offres, une seule choisie -> une seule affichee',
       elementsAfroboostAPratiquer([admin, part], jeu(OFFRE_A)).length, 1);

  // E / F / V — expiree, ou desactivee : la porte se referme d'elle-meme.
  const expire = classerBoosts(
    [{ partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT - 1) }],
    MAINTENANT).offresAfroboost;
  faux('LC8. mise en avant expiree -> exclue', verdictAffichageOffre(admin, expire).affichee);
  const desactive = classerBoosts(
    [{ partnerId: UID_A, afroboostOfferId: OFFRE_A, active: false, expiresAt: horodatage(MAINTENANT + HEURE) }],
    MAINTENANT).offresAfroboost;
  faux('LC9. mise en avant desactivee -> exclue', verdictAffichageOffre(admin, desactive).affichee);

  // L / M / N / O — un type interdit ne s'achete pas une place.
  for (const type of ['pack', 'subscription', 'membership', 'product', 'other', 'unknown']) {
    const v: any = verdictAffichageOffre(offre({ id: OFFRE_A, typeOffre: type }), jeu(OFFRE_A));
    faux(`LC10. ${type} MIS EN AVANT -> reste exclu`, v.affichee);
    egal(`LC11. motif ${type}`, v.motif, 'type-non-pratiquable');
  }

  // R / S — un boost « compte entier » ou d'activite n'ouvre aucune offre.
  const legacy = classerBoosts(
    [{ partnerId: UID_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) }], MAINTENANT);
  egal('LC12. boost « compte entier » -> aucune offre', legacy.offresAfroboost.size, 0);
  faux('LC13. et l\'offre du meme compte reste exclue',
       verdictAffichageOffre(admin, legacy.offresAfroboost).affichee);
  const parActivite = classerBoosts(
    [{ partnerId: UID_A, activityId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) }], MAINTENANT);
  egal('LC14. un boost d\'activite ne remplit pas le jeu des offres', parActivite.offresAfroboost.size, 0);
  faux('LC15. meme si l\'identifiant se ressemble',
       verdictAffichageOffre(admin, parActivite.offresAfroboost).affichee);

  // P — une offre invisible n'atteint pas ce module, meme mise en avant.
  egal('LC16. visible=false -> aucune offre publique',
       versOffrePublique({ id: OFFRE_A, name: 'Cachee', visible: false } as any), null);

  // Q — la ville : comportement R3c preserve, verifie APRES la mise en avant.
  const sansVille: any = verdictAffichageOffre(
    offre({ id: OFFRE_A, ville: null }), jeu(OFFRE_A));
  faux('LC17. choisie mais sans ville -> exclue', sansVille.affichee);
  egal('LC18. et le motif reste celui de la ville', sansVille.motif, 'sans-ville');

  // Plusieurs offres choisies -> plusieurs affichees. Aucune limite arbitraire.
  egal('LC19. deux mises en avant -> deux offres',
       elementsAfroboostAPratiquer([admin, part], jeu(OFFRE_A, OFFRE_B)).length, 2);
}

section('PRODUCTION — le catalogue reel du 07/09, juge par la regle du LOT C');
{
  // Les QUATRE offres publiques mesurees en production apres que Bassi a rendu
  // visible « Cours a l'unite », et la SEULE mise en avant vivante : celle
  // qu'il a creee lui-meme depuis l'ecran du LOT B.
  const UNITE = 'fea0ab6a-8adc-460d-9d7d-bbff57059ca5';
  const ESSAI = 'c1e5f73c-0f16-402e-a746-2041e23f72e8';
  const reelles = [
    offre({ id: UNITE, nom: "Cours à l'unité", typeOffre: 'single_class', ville: 'Auvernier', prix: 30 }),
    offre({ id: 'a687ce86-94d6-4ba9-a847-c8a20e787491', nom: 'PULSE x10 cours', typeOffre: 'pack', ville: null, prix: 250 }),
    offre({ id: '84b7d8c6-b859-410a-8a09-0d1ee0069404', nom: 'T-shirt + 1 cours offert!', typeOffre: 'product', ville: null, prix: 59.99, estProduit: true }),
    offre({ id: ESSAI, nom: "🎁 Cours d'essai GRATUIT", typeOffre: 'single_class', ville: 'Auvernier', prix: 0 }),
  ];

  // La mise en avant reelle, telle qu'elle existe en base : un document
  // `boosts` visant l'offre a 30 CHF, actif, non expire.
  const misesEnAvant = classerBoosts(
    [{ partnerId: 'BvvVC4Ac8q', afroboostOfferId: UNITE, active: true, expiresAt: horodatage(MAINTENANT + HEURE) }],
    MAINTENANT,
  ).offresAfroboost;

  const retenues = elementsAfroboostAPratiquer(reelles, misesEnAvant);
  egal('Z1. exactement UNE offre affichee', retenues.length, 1);
  egal('Z2. et c\'est celle que Bassi a choisie', retenues[0].title, "Cours à l'unité");
  egal('Z3. a son prix reel', retenues[0].prix, 30);

  // LE CHANGEMENT DU LOT C, EN UNE ASSERTION : le cours d'essai est toujours
  // publie, toujours du bon type, toujours a Auvernier — mais personne ne l'a
  // choisi, donc il n'apparait plus.
  const essai: any = verdictAffichageOffre(reelles[3], misesEnAvant);
  faux('Z4. le cours d\'essai gratuit n\'est plus affiche', essai.affichee);
  egal('Z5. et le motif le dit', essai.motif, 'sans-mise-en-avant');
  vrai('Z6. il reste pourtant visible et pratiquable',
       reelles[3].typeOffre === 'single_class' && reelles[3].ville === 'Auvernier');

  egal('Z7. le pack reste ecarte par son type',
       (verdictAffichageOffre(reelles[1], misesEnAvant) as any).motif, 'type-non-pratiquable');
  egal('Z8. le produit aussi',
       (verdictAffichageOffre(reelles[2], misesEnAvant) as any).motif, 'type-non-pratiquable');

  const groupes = groupBoostedActivitiesByCity(retenues as any, new Set(), {});
  egal('Z9. une seule ville', groupes.length, 1);
  egal('Z10. Auvernier', groupes[0].city, 'Auvernier');
  egal('Z11. une seule carte', groupes[0].activities.length, 1);

  // Quand la mise en avant expirera, l'offre sortira d'elle-meme — sans que
  // rien ne soit modifie au catalogue.
  const apresExpiration = classerBoosts(
    [{ partnerId: 'BvvVC4Ac8q', afroboostOfferId: UNITE, active: true, expiresAt: horodatage(MAINTENANT - 1) }],
    MAINTENANT,
  ).offresAfroboost;
  egal('Z12. mise en avant expiree -> plus aucune offre',
       elementsAfroboostAPratiquer(reelles, apresExpiration).length, 0);
  egal('Z13. et l\'offre est intacte dans le catalogue', reelles[0].prix, 30);
}

console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
console.log('Offres copiees dans Firestore : 0 — boosts crees : 0 — paiements : 0');
if (_failures > 0) process.exit(1);
}

principal();
