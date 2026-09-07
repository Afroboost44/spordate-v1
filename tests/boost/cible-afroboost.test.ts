/**
 * R3b-2 — BRANCHER UN BOOST SUR UNE OFFRE AFROBOOST, SANS LA DUPLIQUER.
 *
 * Exécution :
 *   npx tsx tests/boost/cible-afroboost.test.ts
 *
 * CE QUE CE BANC PROUVE, ET POURQUOI IL COMPTE
 * Le lot suivant fera PAYER. Ce qui est éprouvé ici décide, avant l'argent,
 * ce qu'un boost rend visible et à qui il appartient. Un « à peu près » y
 * coûterait qu'un partenaire boost l'offre d'un autre, ou qu'un boost payé
 * pour une offre Afroboost rende gratuitement visibles toutes les activités
 * Spordate du même compte.
 *
 *   A. boost natif `activityId`        → comportement historique inchangé
 *   B. boost sur offre partenaire      → référence conservée, offre non copiée
 *   C. offre du partenaire A, compte B → refus
 *   D. propriété non prouvée           → fermeture sûre
 *   E. offre admin                     → aucun boost payant
 *   F. pack/produit/abonnement/…       → jamais éligible par ce chemin
 *   G. boost actif non expiré          → actif pour CETTE offre
 *   H. boost expiré                    → inactif, même si `active` traîne
 *   I. boost sur l'offre A             → n'active jamais l'offre B
 *   J. plusieurs partenaires           → aucune contamination croisée
 *   K. boost historique                → toujours lisible et fonctionnel
 *   L. aucune duplication d'offre dans `activities`
 *   M. R3b-ID sans correspondance      → aucune identité inventée
 *
 * AUCUNE CORRESPONDANCE RÉELLE N'EST FABRIQUÉE : tout ici est en mémoire.
 * En production, 0 partenaire Afroboost est lié (mesure du 06/09), donc la
 * porte du cas B est FERMÉE pour tout le monde — et ce banc le prouve aussi.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHAMP_ACTIVITE,
  CHAMP_OFFRE_AFROBOOST,
  boostEstActif,
  champsCibleBoost,
  cibleDemandee,
  classerBoosts,
  instantExpiration,
  lireCibleBoost,
  memeCible,
} from '../../src/lib/boost/cible';
import {
  TYPES_OFFRE_BOOSTABLES,
  autoriserBoostSurOffre,
  estTypeBoostable,
  statutHttpDuRefus,
} from '../../src/lib/boost/autorisationAfroboost';
import {
  estProprietaireDeLOffre,
  possedeLOffreAfroboost,
} from '../../src/lib/afroboost/ownership';

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
function memeJeu(l: string, obtenu: Set<string>, attendu: string[]) {
  const a = Array.from(obtenu).sort();
  const b = [...attendu].sort();
  if (a.length === b.length && a.every((v, i) => v === b[i])) pass(l);
  else fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`);
}
function section(t: string) { console.log(`\n--- ${t} ---`); }

const UID_A = 'firebase-uid-AAAA';
const UID_B = 'firebase-uid-BBBB';
const OWNER_A = '11111111-2222-3333-4444-555555555555';
const OWNER_B = '99999999-8888-7777-6666-555555555555';
const OFFRE_A = 'offre-afro-AAAA-1111';
const OFFRE_B = 'offre-afro-BBBB-2222';
const ACTIVITE_1 = 'activity-doc-id-111';
const ACTIVITE_2 = 'activity-doc-id-222';

const MAINTENANT = 1_800_000_000_000;
const HEURE = 60 * 60 * 1000;

/** Une offre telle que l'adaptateur R3b-1 la rend. */
function offre(proprietaire: string, proprietaireId: string | null, typeOffre: string): any {
  return { proprietaire, proprietaireId, typeOffre };
}

/** Un `Timestamp` Firestore, réduit à ce que le code en lit. */
function horodatage(ms: number) {
  return { toMillis: () => ms };
}

/** Base factice qui COMPTE LES ÉCRITURES : « n'écrit rien » se mesure. */
function creerBase(liens: Record<string, any> = {}) {
  const ecritures: string[] = [];
  return {
    ecritures,
    collection(nom: string) {
      return {
        doc(id: string) {
          return {
            async get() {
              if (nom !== 'bridge_identity_links') return { exists: false, data: () => undefined };
              const v = liens[id];
              return { exists: v !== undefined, data: () => (v === undefined ? undefined : { ...v }) };
            },
            set(..._a: any[]) { ecritures.push(`set ${nom}/${id}`); },
            update(..._a: any[]) { ecritures.push(`update ${nom}/${id}`); },
            delete() { ecritures.push(`delete ${nom}/${id}`); },
          };
        },
        add(..._a: any[]) { ecritures.push(`add ${nom}`); },
      };
    },
  };
}

function source(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8');
}
/** Le code, débarrassé de ses commentaires : on juge ce qui s'exécute. */
function codeSeul(chemin: string): string {
  return source(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

async function principal() {

section('A — le boost natif Spordate : rien ne bouge');
{
  const doc = { partnerId: UID_A, activityId: ACTIVITE_1, active: true, expiresAt: horodatage(MAINTENANT + HEURE) };
  const cible = lireCibleBoost(doc);
  egal('A1. un doc avec activityId vise une activite', cible.genre, 'activite');
  egal('A2. et c\'est bien CETTE activite', (cible as any).id, ACTIVITE_1);
  const c = classerBoosts([doc], MAINTENANT);
  memeJeu('A3. classe parmi les activites boostees', c.activites, [ACTIVITE_1]);
  memeJeu('A4. et NULLE PART ailleurs — pas de compte couvert', c.partenairesLegacy, []);
  memeJeu('A5. ni la moindre offre Afroboost', c.offresAfroboost, []);
  // L'idempotence d'achat, telle qu'elle etait : meme activite -> deja boostee.
  vrai('A6. un 2e achat sur la MEME activite est couvert',
       memeCible(lireCibleBoost(doc), cibleDemandee({ activityId: ACTIVITE_1 })));
  faux('A7. mais une AUTRE activite reste achetable',
       memeCible(lireCibleBoost(doc), cibleDemandee({ activityId: ACTIVITE_2 })));
  egal('A8. ecrit sous le champ historique, inchange',
       JSON.stringify(champsCibleBoost(cible)), JSON.stringify({ [CHAMP_ACTIVITE]: ACTIVITE_1 }));
}

section('B — le boost sur une offre Afroboost correctement attribuee');
{
  const cible = cibleDemandee({ afroboostOfferId: OFFRE_A });
  egal('B1. la cible demandee est une offre Afroboost', cible.genre, 'offreAfroboost');
  egal('B2. l\'identifiant traverse tel quel', (cible as any).id, OFFRE_A);
  const champs = champsCibleBoost(cible);
  egal('B3. ecrit sous SON champ, distinct de activityId',
       JSON.stringify(champs), JSON.stringify({ [CHAMP_OFFRE_AFROBOOST]: OFFRE_A }));
  faux('B4. et n\'ecrit AUCUN activityId', CHAMP_ACTIVITE in champs);
  // La reference, et RIEN d'autre : ni prix, ni titre, ni lieu, ni proprietaire.
  egal('B5. le document ne porte QUE la reference', Object.keys(champs).length, 1);

  const v = autoriserBoostSurOffre(offre('partner', OWNER_A, 'single_class'), OWNER_A);
  vrai('B6. proprietaire prouve + type boostable -> autorise', v.ok === true);
  const doc = { partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) };
  const c = classerBoosts([doc], MAINTENANT);
  memeJeu('B7. la reference est conservee jusqu\'au classement', c.offresAfroboost, [OFFRE_A]);
  memeJeu('B8. AUCUNE activite Spordate rendue visible au passage', c.activites, []);
  memeJeu('B9. et surtout : le compte n\'est PAS couvert en entier', c.partenairesLegacy, []);
  vrai('B10. un evenement est boostable aussi',
       autoriserBoostSurOffre(offre('partner', OWNER_A, 'event'), OWNER_A).ok === true);
}

section('C — l\'offre du partenaire A, achetee par le compte B');
{
  const v = autoriserBoostSurOffre(offre('partner', OWNER_A, 'single_class'), OWNER_B);
  faux('C1. refuse', v.ok);
  egal('C2. et le motif est la propriete, pas autre chose', (v as any).refus, 'offre-non-possedee');
  egal('C3. repondu en 403', statutHttpDuRefus('offre-non-possedee'), 403);
  faux('C4. la decision pure dit la meme chose',
       estProprietaireDeLOffre(OWNER_B, offre('partner', OWNER_A, 'single_class')));
}

section('D — propriete non prouvee : fermeture sure');
{
  const o = offre('partner', OWNER_A, 'single_class');
  for (const compte of [null, undefined, '', '   ', 'contact@exemple.invalid']) {
    const v = autoriserBoostSurOffre(o, compte as any);
    faux(`D1. compte « ${String(compte)} » -> refuse`, v.ok);
    egal(`D2. motif pour « ${String(compte)} »`, (v as any).refus, 'offre-non-possedee');
  }
  const sansProprietaire = autoriserBoostSurOffre(offre('partner', null, 'single_class'), OWNER_A);
  faux('D3. offre partner SANS proprietaireId -> refuse', sansProprietaire.ok);
  const inconnue = autoriserBoostSurOffre(offre('unknown', OWNER_A, 'single_class'), OWNER_A);
  faux('D4. offre de propriete « unknown » -> refuse', inconnue.ok);
  const absente = autoriserBoostSurOffre(null, OWNER_A);
  faux('D5. offre introuvable au catalogue -> refuse', absente.ok);
  egal('D6. et c\'est un 404, pas un 403', statutHttpDuRefus('offre-introuvable'), 404);
}

section('E — l\'offre admin ne paie jamais de boost');
{
  for (const type of ['single_class', 'event']) {
    const v = autoriserBoostSurOffre(offre('admin', 'admin-1', type), 'admin-1');
    faux(`E1. offre admin (${type}) -> aucun boost`, v.ok);
    egal(`E2. et le motif le DIT (${type})`, (v as any).refus, 'offre-admin');
  }
  // Le motif « admin » passe avant le type : on ne fait pas croire a un
  // probleme de type quand le vrai message est « tu n'as rien a payer ».
  const v = autoriserBoostSurOffre(offre('admin', 'admin-1', 'pack'), 'admin-1');
  egal('E3. admin l\'emporte sur le type', (v as any).refus, 'offre-admin');
  faux('E4. une offre admin n\'est possedee par aucun partenaire',
       estProprietaireDeLOffre(OWNER_A, offre('admin', OWNER_A, 'single_class')));
}

section('F — les types qui ne sont pas des lieux de pratique');
{
  for (const type of ['subscription', 'pack', 'membership', 'product', 'other', 'unknown']) {
    const v = autoriserBoostSurOffre(offre('partner', OWNER_A, type), OWNER_A);
    faux(`F1. ${type} -> refuse malgre une propriete prouvee`, v.ok);
    egal(`F2. motif pour ${type}`, (v as any).refus, 'offre-non-boostable');
    faux(`F3. ${type} n'est pas un type boostable`, estTypeBoostable(offre('partner', OWNER_A, type)));
  }
  egal('F4. exactement deux types boostables', TYPES_OFFRE_BOOSTABLES.size, 2);
  vrai('F5. et ce sont le cours a l\'unite et l\'evenement',
       TYPES_OFFRE_BOOSTABLES.has('single_class') && TYPES_OFFRE_BOOSTABLES.has('event'));
}

section('G / H — actif, puis expire');
{
  const actif = { partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) };
  vrai('G1. boost non expire -> actif', boostEstActif(actif, MAINTENANT));
  memeJeu('G2. et l\'offre est resolue comme boostee', classerBoosts([actif], MAINTENANT).offresAfroboost, [OFFRE_A]);

  const expire = { partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT - 1) };
  faux('H1. date depassee -> inactif MEME si active===true (le cron peut avoir du retard)',
       boostEstActif(expire, MAINTENANT));
  memeJeu('H2. l\'offre n\'est plus boostee', classerBoosts([expire], MAINTENANT).offresAfroboost, []);
  memeJeu('H3. et l\'expiration ne bascule rien vers le compte entier',
          classerBoosts([expire], MAINTENANT).partenairesLegacy, []);

  const desactive = { partnerId: UID_A, afroboostOfferId: OFFRE_A, active: false, expiresAt: horodatage(MAINTENANT + HEURE) };
  faux('H4. active===false -> inactif meme si la date est loin', boostEstActif(desactive, MAINTENANT));

  // Le cron d'expiration ne lit QUE `active` + `expiresAt` : les deux sortes
  // de boost lui sont donc identiques, aucune adaptation n'a ete necessaire.
  const cron = codeSeul('src/app/api/cron/expire-boosts/route.ts');
  faux('H5. le cron ignore la nature de la cible', /activityId|afroboostOfferId/.test(cron));
  vrai('H6. il continue de balayer sur active + expiresAt',
       cron.includes("'active', '==', true") && cron.includes("'expiresAt', '<='"));

  egal('H7. une date illisible vaut « expire »', instantExpiration({ n: 1 } as any), 0);
  egal('H8. une Date est lue', instantExpiration(new Date(MAINTENANT)), MAINTENANT);
}

section('I — le boost de l\'offre A n\'active jamais l\'offre B');
{
  const doc = { partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) };
  const c = classerBoosts([doc], MAINTENANT);
  vrai('I1. l\'offre A est boostee', c.offresAfroboost.has(OFFRE_A));
  faux('I2. l\'offre B ne l\'est pas', c.offresAfroboost.has(OFFRE_B));
  faux('I3. et un achat sur l\'offre B n\'est pas considere couvert',
       memeCible(lireCibleBoost(doc), cibleDemandee({ afroboostOfferId: OFFRE_B })));
  faux('I4. un boost d\'activite ne couvre pas une offre',
       memeCible(lireCibleBoost({ activityId: ACTIVITE_1 }), cibleDemandee({ afroboostOfferId: OFFRE_A })));
  faux('I5. ni une offre une activite',
       memeCible(lireCibleBoost({ afroboostOfferId: OFFRE_A }), cibleDemandee({ activityId: ACTIVITE_1 })));
}

section('J — plusieurs partenaires, aucune contamination croisee');
{
  const docs = [
    { partnerId: UID_A, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) },
    { partnerId: UID_B, activityId: ACTIVITE_2, active: true, expiresAt: horodatage(MAINTENANT + HEURE) },
    { partnerId: UID_B, afroboostOfferId: OFFRE_B, active: true, expiresAt: horodatage(MAINTENANT - HEURE) },
  ];
  const c = classerBoosts(docs, MAINTENANT);
  memeJeu('J1. seule l\'offre du partenaire A est boostee', c.offresAfroboost, [OFFRE_A]);
  memeJeu('J2. seule l\'activite du partenaire B l\'est', c.activites, [ACTIVITE_2]);
  memeJeu('J3. aucun compte n\'est couvert en entier', c.partenairesLegacy, []);
  // Le piege du lot : sans lecture explicite, le boost « offre » de A (sans
  // activityId) aurait verse UID_A dans les comptes couverts — et rendu
  // visibles, gratuitement, toutes les activites Spordate de A.
  faux('J4. le boost « offre » de A ne couvre PAS le compte de A', c.partenairesLegacy.has(UID_A));

  // Un document malforme (les deux champs) ne vaut rien, nulle part.
  const ambigu = classerBoosts(
    [{ partnerId: UID_A, activityId: ACTIVITE_1, afroboostOfferId: OFFRE_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) }],
    MAINTENANT,
  );
  memeJeu('J5. doc ambigu : aucune activite', ambigu.activites, []);
  memeJeu('J6. doc ambigu : aucune offre', ambigu.offresAfroboost, []);
  memeJeu('J7. doc ambigu : aucun compte', ambigu.partenairesLegacy, []);
}

section('K — le boost historique reste lisible et fonctionnel');
{
  const legacy = { partnerId: UID_A, active: true, expiresAt: horodatage(MAINTENANT + HEURE) };
  egal('K1. sans cible = boost historique', lireCibleBoost(legacy).genre, 'partenaireLegacy');
  const c = classerBoosts([legacy], MAINTENANT);
  memeJeu('K2. il couvre TOUT le compte, comme avant', c.partenairesLegacy, [UID_A]);
  memeJeu('K3. sans inventer d\'activite', c.activites, []);
  memeJeu('K4. ni d\'offre', c.offresAfroboost, []);
  vrai('K5. et il bloque encore un nouvel achat sur une activite',
       memeCible(lireCibleBoost(legacy), cibleDemandee({ activityId: ACTIVITE_1 })));
  vrai('K6. comme sur une offre Afroboost',
       memeCible(lireCibleBoost(legacy), cibleDemandee({ afroboostOfferId: OFFRE_A })));
  egal('K7. un boost historique ne se REECRIT pas',
       JSON.stringify(champsCibleBoost({ genre: 'partenaireLegacy' })), '{}');
  const sansPartenaire = classerBoosts([{ active: true, expiresAt: horodatage(MAINTENANT + HEURE) }], MAINTENANT);
  memeJeu('K8. un historique sans partnerId ne couvre rien', sansPartenaire.partenairesLegacy, []);
}

section('L — aucune duplication de l\'offre Afroboost dans `activities`');
{
  const chemins = [
    'src/app/api/boost-checkout/route.ts',
    'src/app/api/boost-credits/route.ts',
    'src/app/api/webhooks/stripe/handler.ts',
    'src/lib/boost/cible.ts',
    'src/lib/boost/autorisationAfroboost.ts',
  ];
  for (const chemin of chemins) {
    const code = codeSeul(chemin);
    const ecritureActivites =
      /collection\((?:adminDb|db|fbDb)?,?\s*'activities'\)[^;]*\.(set|add|update|delete)\s*\(/.test(code) ||
      /collection\('activities'\)\.(add|doc\([^)]*\)\.(set|update|delete))/.test(code) ||
      /activities'\)\.add\(/.test(code);
    faux(`L1. ${chemin} n'ecrit rien dans activities`, ecritureActivites);
  }
  // Et surtout : aucun champ de l'offre n'est recopie sur le boost.
  const champs = champsCibleBoost({ genre: 'offreAfroboost', id: OFFRE_A });
  memeJeu('L2. le boost ne stocke que l\'identifiant de l\'offre', new Set(Object.keys(champs)), [CHAMP_OFFRE_AFROBOOST]);
  for (const interdit of ['nom', 'prix', 'image', 'lieuTexte', 'proprietaireId', 'ville']) {
    faux(`L3. « ${interdit} » n'est pas recopie sur le boost`, interdit in champs);
  }
  // Le module de cible ignore tout du contenu d'une offre.
  const cibleCode = codeSeul('src/lib/boost/cible.ts');
  for (const mot of ['prix', 'price', 'image', 'proprietaire', 'titre', 'nom']) {
    faux(`L4. le module de cible ignore « ${mot} »`, new RegExp(mot, 'i').test(cibleCode));
  }
}

section('M — R3b-ID : sans correspondance reelle, aucune identite inventee');
{
  const o = offre('partner', OWNER_A, 'single_class');
  // Etat REEL de la production : aucune liaison ne porte d'identifiant partenaire.
  let base = creerBase({ [UID_A]: { spordateUid: UID_A, afroboostEmail: 'x@exemple.invalid' } });
  egal('M1. liaison sans identifiant partenaire -> non possede',
       await possedeLOffreAfroboost(base as any, UID_A, o), false);
  egal('M2. et RIEN n\'a ete ecrit pour « faire marcher » le cas', base.ecritures.length, 0);

  base = creerBase({});
  egal('M3. aucune liaison du tout -> non possede',
       await possedeLOffreAfroboost(base as any, UID_A, o), false);
  egal('M4. toujours aucune ecriture', base.ecritures.length, 0);

  // Une adresse e-mail n'est jamais un identifiant de proprietaire.
  base = creerBase({ [UID_A]: { afroboostPartnerId: 'coach@exemple.invalid' } });
  egal('M5. un e-mail dans la liaison ne donne AUCUNE propriete',
       await possedeLOffreAfroboost(base as any, UID_A, o), false);

  // Le seul cas ou la porte s'ouvre : une liaison portant l'identifiant exact.
  base = creerBase({ [UID_A]: { afroboostPartnerId: OWNER_A } });
  egal('M6. liaison exacte -> possede', await possedeLOffreAfroboost(base as any, UID_A, o), true);
  egal('M7. le compte B ne possede toujours pas l\'offre de A',
       await possedeLOffreAfroboost(base as any, UID_B, o), false);
  egal('M8. et ouvrir la porte n\'a rien ecrit non plus', base.ecritures.length, 0);

  // Les deux chemins d'achat resolvent la propriete cote SERVEUR, jamais
  // depuis le corps de la requete.
  for (const chemin of ['src/app/api/boost-checkout/route.ts', 'src/app/api/boost-credits/route.ts']) {
    const code = codeSeul(chemin);
    vrai(`M9. ${chemin} resout la propriete par R3b-ID`, code.includes('resoudreProprietaireAfroboost'));
    vrai(`M10. ${chemin} passe par la decision partagee`, code.includes('autoriserBoostSurOffre'));
    faux(`M11. ${chemin} ne lit aucun proprietaire dans le corps de requete`,
         /body\?\.(owner|proprietaire|afroboostPartnerId)|\bowner_id\b/.test(code));
    faux(`M12. ${chemin} n'accepte aucun partnerId venu du client`,
         /partnerId\s*=\s*(body|req)/.test(code));
  }
}

section('HP — hors perimetre : ce que ce lot n\'a PAS touche');
{
  const cibleCode = codeSeul('src/lib/boost/cible.ts');
  for (const mot of ['stripe', 'checkout', 'wallet', 'commission', 'firestore', 'fetch']) {
    faux(`HP1. le module de cible ignore « ${mot} »`, new RegExp(mot, 'i').test(cibleCode));
  }
  const autorisation = codeSeul('src/lib/boost/autorisationAfroboost.ts');
  for (const mot of ['stripe', 'credit', 'prix', 'montant', 'reservation']) {
    faux(`HP2. la decision d'autorisation ignore « ${mot} »`, new RegExp(mot, 'i').test(autorisation));
  }
  // Les prix des boosts n'ont pas bouge.
  const paquets = source('src/lib/payment/packages.ts');
  vrai('HP3. la grille BOOST_PRICES existe toujours', paquets.includes('BOOST_PRICES'));
  const credits = source('src/lib/billing/boostCredits.ts');
  vrai('HP4. le bareme en credits est intact',
       credits.includes('BOOST_CREDITS_COST') && credits.includes('CHF_PER_CREDIT'));
  // Aucun appel a une offre Afroboost n'ecrit quoi que ce soit.
  const routeOffres = codeSeul('src/app/api/afroboost/offers/route.ts');
  faux('HP5. la porte d\'entree des offres reste en lecture seule',
       /\.(set|add|update|delete)\s*\(/.test(routeOffres));
}

console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
console.log('Boosts reels crees : 0 — paiements : 0 — credits depenses : 0 — correspondances fabriquees : 0');
if (_failures > 0) process.exit(1);
}

principal().catch((e) => {
  console.log(`FAIL  banc interrompu — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
