/**
 * LOT D — « OÙ POURRAIT-ON SE RETROUVER ? » N'EST PAS « QUE POSSÈDE CE PROFIL ? ».
 *
 * Exécution :
 *   npx tsx tests/discovery/activites-de-rencontre.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Le modal « Réserver une séance » ne posait qu'une question : « quelles
 * activités possède la personne affichée ? ». Pour Davelove, qui n'organise
 * rien, la réponse est vide — et elle est JUSTE. Ce banc éprouve la SECONDE
 * question, ajoutée par ce lot, et surtout la frontière entre les deux : une
 * offre proposée comme lieu de rendez-vous ne doit JAMAIS avoir l'air
 * d'appartenir au profil qu'on regarde.
 *
 *   A. Davelove sans activité + offre mise en avant → l'offre est proposée
 *   B. et elle n'entre PAS dans les activités du profil
 *   C. Davelove n'est jamais présenté comme organisateur
 *   D. l'organisateur affiché est Afroboost
 *   E/F/G. l'invité et l'offre restent deux choses ; identifiant exact ; pas d'activityId
 *   H/I/J. sans mise en avant, expirée, désactivée → absente
 *   K/L/M. offre invisible, pack, produit → absents
 *   N/O. les activités natives d'un profil qui en possède : inchangées, et séparées
 *   P/Q. deux offres → deux options, jamais dédupliquées par titre
 *   R/S/T. le prix Afroboost ne devient jamais un prix Stripe ; rien n'est déclenché
 *   U/V. FIX ATTRIBUTION intact, aucun repli global
 *   W. R4 inchangé
 *
 * AUCUNE INVITATION, aucun paiement, aucune écriture : tout est en mémoire.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ORGANISATEUR_AFROBOOST,
  activitesDuProfilEnOptions,
  cleOption,
  estOptionAfroboost,
  offresDeRencontre,
} from '../../src/lib/discovery/activitesDeRencontre';
import { activitesDuProfil } from '../../src/lib/discovery/profileActivities';
import { classerBoosts } from '../../src/lib/boost/cible';
import { versOffrePublique } from '../../src/lib/afroboost/offers';

let _p = 0, _f = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _p++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _f++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie') { if (!c) pass(l); else fail(l, d); }
function egal(l: string, o: unknown, a: unknown) {
  if (o === a) pass(l); else fail(l, `obtenu ${JSON.stringify(o)}, attendu ${JSON.stringify(a)}`);
}
function section(t: string) { console.log(`\n--- ${t} ---`); }

const UNITE = 'fea0ab6a-8adc-460d-9d7d-bbff57059ca5';
const ESSAI = 'c1e5f73c-0f16-402e-a746-2041e23f72e8';
const UID_DAVELOVE = 'uid-davelove';
const UID_BASSI = 'BvvVC4Ac8q';
const MAINTENANT = 1_800_000_000_000;
const HEURE = 3_600_000;

function offre(p: Partial<any> = {}): any {
  return {
    id: UNITE, nom: "Cours à l'unité", description: '', prix: 30,
    image: '/api/files/x.jpg', lieuTexte: 'Bord du Lac, Auvernier',
    participantsMax: 30, categorieBrute: 'service', estProduit: false,
    nombreCoursLies: 4, aUneDuree: false, proprietaire: 'admin',
    proprietaireId: null, typeOffre: 'single_class', ville: 'Auvernier',
    adresse: null, latitude: null, longitude: null, ...p,
  };
}
function horodatage(ms: number) { return { toMillis: () => ms }; }
/** Le jeu des mises en avant, produit par la VRAIE fonction de R3b-2. */
function misesEnAvant(...docs: any[]) { return classerBoosts(docs, MAINTENANT).offresAfroboost; }
const boostVivant = (id: string) => ({ partnerId: UID_BASSI, afroboostOfferId: id, active: true, expiresAt: horodatage(MAINTENANT + HEURE) });
function codeSeul(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

function principal() {

section('A / B / C / D — le cas Davelove, exactement');
{
  // Davelove ne possede AUCUNE activite. C'est la verite, et elle est preservee.
  const duProfil = activitesDuProfil({
    profilUid: UID_DAVELOVE,
    activitesPossedees: [],
    activitesBoostees: [{ partnerId: UID_BASSI, activityId: 'act-de-bassi' } as any],
  });
  egal('B1. les activites du profil restent VIDES', duProfil.length, 0);

  const rencontres = offresDeRencontre([offre()], misesEnAvant(boostVivant(UNITE)));
  egal('A1. une option de rendez-vous est proposee', rencontres.length, 1);
  egal('A2. et c\'est le cours mis en avant', rencontres[0].titre, "Cours à l'unité");

  // B — LA FRONTIERE. L'offre n'est PAS dans la liste du profil.
  faux('B2. l\'offre n\'entre pas dans les activites du profil',
       JSON.stringify(duProfil).includes(UNITE));

  // C / D — l'organisateur.
  egal('D1. l\'organisateur affiche est Afroboost', rencontres[0].organisateur, ORGANISATEUR_AFROBOOST);
  faux('C1. ce n\'est jamais Davelove', rencontres[0].organisateur.toLowerCase().includes('davelove'));
  faux('C2. et son identifiant n\'apparait nulle part',
       JSON.stringify(rencontres).includes(UID_DAVELOVE));
}

section('E / F / G — l\'invite et le lieu ne se confondent pas');
{
  const [o] = offresDeRencontre([offre()], misesEnAvant(boostVivant(UNITE)));
  vrai('E1. l\'option ne porte AUCUNE identite d\'invite',
       !('inviteeUid' in (o as any)) && !('profilUid' in (o as any)));
  vrai('F1. l\'identifiant de l\'offre est exact', estOptionAfroboost(o) && o.afroboostOfferId === UNITE);
  faux('G1. et aucun activityId ne lui est attache', 'activityId' in (o as any));
  egal('G2. la cle nomme la source', cleOption(o), `afroboost:${UNITE}`);
}

section('H / I / J — sans mise en avant vivante, rien');
{
  egal('H1. aucune mise en avant -> aucune option',
       offresDeRencontre([offre()], misesEnAvant()).length, 0);
  const expire = { partnerId: UID_BASSI, afroboostOfferId: UNITE, active: true, expiresAt: horodatage(MAINTENANT - 1) };
  egal('I1. mise en avant expiree -> aucune option',
       offresDeRencontre([offre()], misesEnAvant(expire)).length, 0);
  const desactive = { partnerId: UID_BASSI, afroboostOfferId: UNITE, active: false, expiresAt: horodatage(MAINTENANT + HEURE) };
  egal('J1. mise en avant desactivee -> aucune option',
       offresDeRencontre([offre()], misesEnAvant(desactive)).length, 0);
  // Un boost « compte entier » ou d'activite n'ouvre rien non plus.
  egal('J2. boost « compte entier » -> aucune option',
       offresDeRencontre([offre()], misesEnAvant({ partnerId: UID_BASSI, active: true, expiresAt: horodatage(MAINTENANT + HEURE) })).length, 0);
  egal('J3. boost d\'activite -> aucune option',
       offresDeRencontre([offre()], misesEnAvant({ partnerId: UID_BASSI, activityId: UNITE, active: true, expiresAt: horodatage(MAINTENANT + HEURE) })).length, 0);
}

section('K / L / M — invisible, pack, produit');
{
  egal('K1. offre masquee -> aucune offre publique',
       versOffrePublique({ id: UNITE, name: 'X', visible: false } as any), null);
  for (const type of ['pack', 'product', 'subscription', 'membership', 'other', 'unknown']) {
    egal(`L1. ${type} MIS EN AVANT -> jamais propose`,
         offresDeRencontre([offre({ typeOffre: type })], misesEnAvant(boostVivant(UNITE))).length, 0);
  }
  egal('M1. sans ville structuree -> non propose',
       offresDeRencontre([offre({ ville: null })], misesEnAvant(boostVivant(UNITE))).length, 0);
}

section('N / O — un profil qui possede vraiment des activites');
{
  const siennes = [{ activityId: 'act-1', partnerId: UID_BASSI, name: 'Silent Afroboost', city: 'Neuchâtel', price: 25 }];
  const duProfil = activitesDuProfil({
    profilUid: UID_BASSI, activitesPossedees: siennes as any, activitesBoostees: [],
  });
  egal('N1. ses activites restent les siennes', duProfil.length, 1);
  const options = activitesDuProfilEnOptions(duProfil as any, 'Bassi');
  egal('N2. traduites sans rien relacher', options.length, 1);
  egal('N3. organisateur = la personne affichee', options[0].organisateur, 'Bassi');
  egal('N4. source native', options[0].source, 'spordate');
  vrai('N5. et elle porte un activityId', !estOptionAfroboost(options[0]));

  // O — les deux listes coexistent SANS se melanger.
  const rencontres = offresDeRencontre([offre()], misesEnAvant(boostVivant(UNITE)));
  const cles = new Set([...options, ...rencontres].map(cleOption));
  egal('O1. deux options distinctes', cles.size, 2);
  vrai('O2. l\'une native, l\'autre Afroboost',
       cles.has('spordate:act-1') && cles.has(`afroboost:${UNITE}`));
  faux('O3. aucune collision d\'identifiant', cleOption(options[0]) === cleOption(rencontres[0]));
}

section('P / Q — deux offres, et le titre n\'identifie rien');
{
  const deux = [
    offre({ id: UNITE, nom: "Cours d'essai" }),
    offre({ id: ESSAI, nom: "Cours d'essai" }),
  ];
  const r = offresDeRencontre(deux, misesEnAvant(boostVivant(UNITE), boostVivant(ESSAI)));
  egal('P1. deux mises en avant -> deux options', r.length, 2);
  egal('Q1. meme titre, deux options distinctes', new Set(r.map(cleOption)).size, 2);
  // Une seule choisie -> une seule proposee.
  egal('P2. une seule mise en avant -> une seule option',
       offresDeRencontre(deux, misesEnAvant(boostVivant(ESSAI))).length, 1);
}

section('R / S / T — aucun prix detourne, rien de declenche');
{
  const [o] = offresDeRencontre([offre({ prix: 30 })], misesEnAvant(boostVivant(UNITE)));
  egal('R1. le prix Afroboost est TRANSPORTE pour affichage', o.prix, 30);
  const module_ = codeSeul('src/lib/discovery/activitesDeRencontre.ts');
  for (const mot of ['stripe', 'checkout', 'session', 'booking', 'unlockChat', 'credits', 'amount']) {
    faux(`R2. le module ignore « ${mot} »`, new RegExp(mot, 'i').test(module_));
  }
  faux('S1. il n\'appelle rien', /fetch\(|axios|getDocs|collection\(/.test(module_));
  faux('T1. et n\'ecrit rien', /setDoc|addDoc|updateDoc|\.set\(|\.add\(/.test(module_));
  // Dans l'ecran, l'offre n'entre PAS dans le tunnel de paiement : elle n'est
  // jamais posee dans `selectedActivity`, et aucune session n'est resolue.
  const page = codeSeul('src/app/discovery/page.tsx');
  faux('T2. une option de rencontre n\'est jamais selectionnee pour le paiement',
       /optionsDeRencontre[\s\S]{0,200}(setSelectedActivity|selectActivityWithPreview)/.test(page));
  faux('T3. et aucune session n\'est resolue pour elle',
       /optionsDeRencontre[\s\S]{0,200}ensureSessionForActivity/.test(page));
}

section('U / V / W — les gardes anterieures');
{
  const page = codeSeul('src/app/discovery/page.tsx');
  const attribution = codeSeul('src/lib/discovery/profileActivities.ts');
  // U — FIX ATTRIBUTION intact.
  vrai('U1. la garde d\'attribution est toujours branchee', page.includes('activitesDuProfil'));
  vrai('U2. et son module est inchange dans son principe',
       attribution.includes('profilUid') && attribution.includes('partnerId'));
  faux('U3. il ne connait rien aux offres de rencontre',
       /offresDeRencontre|optionsDeRencontre|afroboostOfferId/.test(attribution));
  // V — aucun repli global reintroduit.
  faux('V1. aucun repli « sinon toutes les activites visibles »',
       /length\s*>\s*0\s*\?\s*\w+\s*:\s*visibleActivities/.test(page));
  faux('V2. les offres ne sont jamais versees dans partnerActivities',
       /partnerActivities\s*=\s*[^;]*optionsDeRencontre|activitesPossedees\s*:[^,\n]*optionsDeRencontre/.test(page));
  // W — R4 inchange : la destination est calculee par son helper, tel quel.
  vrai('W1. la reservation passe toujours par le helper R4',
       page.includes('destinationReservationOffre'));
  const r4 = codeSeul('src/lib/discovery/reservationAfroboost.ts');
  vrai('W2. et ce helper n\'a pas change de contrat',
       r4.includes('?offre=') && r4.includes('reserver=1'));
}

section('PRODUCTION — l\'etat reel du 07/09');
{
  // 4 offres publiques, une seule mise en avant : celle a 30 CHF.
  const reelles = [
    offre({ id: UNITE, nom: "Cours à l'unité", typeOffre: 'single_class', ville: 'Auvernier', prix: 30 }),
    offre({ id: 'a687ce86-94d6-4ba9-a847-c8a20e787491', nom: 'PULSE x10 cours', typeOffre: 'pack', ville: null }),
    offre({ id: '84b7d8c6-b859-410a-8a09-0d1ee0069404', nom: 'T-shirt', typeOffre: 'product', ville: null }),
    offre({ id: ESSAI, nom: "🎁 Cours d'essai GRATUIT", typeOffre: 'single_class', ville: 'Auvernier', prix: 0 }),
  ];
  const r = offresDeRencontre(reelles, misesEnAvant(boostVivant(UNITE)));
  egal('Z1. une seule option proposee a Davelove', r.length, 1);
  egal('Z2. « Cours a l\'unite »', r[0].titre, "Cours à l'unité");
  egal('Z3. 30 CHF', r[0].prix, 30);
  egal('Z4. Auvernier', r[0].ville, 'Auvernier');
  egal('Z5. organisee par Afroboost', r[0].organisateur, ORGANISATEUR_AFROBOOST);
  vrai('Z6. et referencee par son identifiant exact',
       estOptionAfroboost(r[0]) && r[0].afroboostOfferId === UNITE);
}

console.log(`\n=== ${_p} PASS / ${_f} FAIL ===`);
console.log('Invitations : 0 — paiements : 0 — sessions creees : 0 — ecritures : 0');
if (_f > 0) process.exit(1);
}

principal();
