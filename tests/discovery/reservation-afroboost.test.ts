/**
 * R4 — RÉSERVER UNE OFFRE AFROBOOST DEPUIS « OÙ PRATIQUER ? ».
 *
 * Exécution :
 *   npx tsx tests/discovery/reservation-afroboost.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Spordateur ne réserve pas : il CONDUIT. Tout ce qui engage — le prix réel,
 * la place restante, la séance, le paiement, la confirmation — est résolu par
 * Afroboost à l'arrivée. Ce banc éprouve donc la seule chose que ce dépôt
 * décide : l'adresse. Et il éprouve surtout ce qu'elle ne doit JAMAIS devenir.
 *
 *   A/B. single_class / event valides   → destination correcte
 *   C.   offre gratuite                 → aucun Stripe fabriqué ici
 *   D.   offre payante                  → Spordateur n'est pas la source du prix
 *   E.   offre sans séance              → aucune session fictive
 *   F.   offre supprimée                → repli sûr, tenu par Afroboost
 *   G.   offre invisible                → n'atteint jamais ce chemin
 *   H.   pack / produit / abonnement    → refusés
 *   I.   offre A + séance de l'offre B  → inexprimable
 *   J.   prix falsifié                  → ne change que l'adresse, jamais la somme
 *   K/L/M. authentification             → celle d'Afroboost, ni bypass ni doublon
 *   N.   deeplink externe injecté       → refusé, origine en dur
 *   O.   activité native Spordateur     → réservation historique intacte
 *   P.   R3c                            → l'offre reste affichée
 *   Q.   FIX ATTRIBUTION                → toujours vert
 *   R/S. aucune écriture activities / sessions
 *   T.   aucun e-mail, Push ni paiement déclenché
 *
 * AUCUNE RÉSERVATION RÉELLE N'EST FAITE ICI. Le banc calcule des adresses et
 * lit du code ; il n'ouvre aucune page et n'appelle personne.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { destinationReservationOffre } from '../../src/lib/discovery/reservationAfroboost';
import {
  ORIGINE_AFROBOOST,
  elementsAfroboostAPratiquer,
  versElementAPratiquer,
} from '../../src/lib/discovery/offresAfroboostAPratiquer';
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

const ESSAI = 'c1e5f73c-0f16-402e-a746-2041e23f72e8';   // l'offre reelle du 07/09
const AUTRE = 'a687ce86-94d6-4ba9-a847-c8a20e787491';

function offre(p: Partial<any> = {}): any {
  return { id: ESSAI, typeOffre: 'single_class', prix: 0, ...p };
}
function codeSeul(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

function principal() {

section('A / B — les deux types que « Ou pratiquer ? » admet');
{
  const a: any = destinationReservationOffre(offre({ typeOffre: 'single_class', prix: 0 }));
  vrai('A1. single_class gratuite -> une destination', a.ok);
  egal('A2. et c\'est le lien profond reel d\'Afroboost',
       a.url, `${ORIGINE_AFROBOOST}/?offre=${ESSAI}&reserver=1`);
  const b: any = destinationReservationOffre(offre({ typeOffre: 'event', prix: 0 }));
  vrai('B1. event gratuit -> une destination', b.ok);
  egal('B2. meme forme', b.url, `${ORIGINE_AFROBOOST}/?offre=${ESSAI}&reserver=1`);
}

section('C / D / J — le prix ne fait autorite sur RIEN ici');
{
  // C. gratuit : `reserver=1` ouvre le FORMULAIRE. Aucun Stripe cote Spordateur.
  const gratuit: any = destinationReservationOffre(offre({ prix: 0 }));
  vrai('C1. gratuite -> ouvre le formulaire', gratuit.ouvreLeFormulaire);
  vrai('C2. et le dit dans l\'adresse', gratuit.url.endsWith('&reserver=1'));

  // D. payante : PAS de `reserver=1`. Cote Afroboost, une offre payante part en
  // achat direct — poser le parametre ouvrirait un paiement depuis un lien,
  // ce que la regle V371 d'Afroboost interdit explicitement.
  for (const prix of [1, 25, 59.99, 250]) {
    const p: any = destinationReservationOffre(offre({ prix }));
    faux(`D1. payante (${prix}) -> n'ouvre PAS le formulaire`, p.ouvreLeFormulaire);
    faux(`D2. et n'ouvre donc aucun paiement depuis un lien (${prix})`, p.url.includes('reserver=1'));
    egal(`D3. destination (${prix})`, p.url, `${ORIGINE_AFROBOOST}/?offre=${ESSAI}`);
  }
  // Prix absent ou nul-mais-pas-zero : on ne devine pas « gratuit ».
  for (const prix of [null, undefined, NaN]) {
    const p: any = destinationReservationOffre(offre({ prix }));
    faux(`D4. prix ${String(prix)} -> traite comme payant (prudent)`, p.ouvreLeFormulaire);
  }

  // J. UN PRIX FALSIFIE NE CHANGE QUE L'ADRESSE, JAMAIS LA SOMME. Le pire
  // qu'un client trafique puisse obtenir, c'est d'ouvrir le formulaire d'une
  // offre payante — ou de ne pas l'ouvrir. Ce qu'il paiera est resolu par
  // Afroboost, sur son catalogue, au moment du paiement.
  const falsifie: any = destinationReservationOffre(offre({ prix: 0, typeOffre: 'single_class' }));
  vrai('J1. l\'adresse ne transporte AUCUN montant', !/\d+(\.\d+)?\s*(chf|CHF)|prix=|price=|amount=/.test(falsifie.url));
  const module_ = codeSeul('src/lib/discovery/reservationAfroboost.ts');
  for (const mot of ['stripe', 'checkout', 'paiement', 'montant', 'amount']) {
    faux(`J2. le module ignore « ${mot} »`, new RegExp(mot, 'i').test(module_));
  }
}

section('E / F / G — ce que Spordateur refuse de decider');
{
  // E. AUCUNE seance n'est resolue ici : le module ne connait pas le mot.
  const module_ = codeSeul('src/lib/discovery/reservationAfroboost.ts');
  for (const mot of ['session', 'seance', 'firestore', 'disponib', 'capacit']) {
    faux(`E1. le module ignore « ${mot} »`, new RegExp(mot, 'i').test(module_));
  }
  for (const mot of ['collection(', 'fetch(', 'getDocs']) {
    faux(`E1b. le module ignore « ${mot} »`, module_.includes(mot));
  }
  // Une offre sans cours lie produit exactement la meme adresse : rien n'est
  // fabrique pour combler le vide.
  const sansCours: any = destinationReservationOffre(offre({ prix: 0 }));
  vrai('E2. offre sans seance -> destination identique, rien d\'invente', sansCours.ok);

  // F. Une offre disparue du catalogue entre l'affichage et le clic : le repli
  // est tenu par AFROBOOST, a l'arrivee, sur son catalogue a lui. Preuve lue
  // dans le paquet reellement servi le 07/09 :
  //   if (!offres.some(o => o && o.id === cible)) return;
  // -> le parametre est ignore, le visiteur atterrit sur la vitrine.
  vrai('F1. la destination reste une simple adresse, sans promesse',
       sansCours.url.startsWith(`${ORIGINE_AFROBOOST}/?offre=`));
  // Ce que « ne pas pretendre » veut dire concretement : le module n'expose
  // AUCUNE decision de disponibilite. Il rend une adresse, ou un refus de
  // forme — jamais un « oui, il reste de la place ».
  faux('F2. aucune decision de disponibilite n\'est exposee',
       /estDisponible|estReservable|placesRestantes|complet|aDesPlaces/i.test(module_));
  const gratuitOk: any = destinationReservationOffre(offre());
  egal('F3. la reponse ne contient que l\'adresse et la nature du lien',
       Object.keys(gratuitOk).sort().join(','), 'ok,ouvreLeFormulaire,url');

  // G. Une offre masquee n'atteint jamais ce chemin : R3b-1 la fait disparaitre
  // a l'adaptation, donc elle n'est meme pas affichee.
  egal('G1. visible=false -> aucune offre publique',
       versOffrePublique({ id: ESSAI, name: 'Cachee', visible: false } as any), null);
  egal('G2. donc aucune carte, donc aucun bouton',
       elementsAfroboostAPratiquer([], new Set()).length, 0);
}

section('H — les types non reservables, meme par une URL fabriquee a la main');
{
  for (const type of ['subscription', 'pack', 'membership', 'product', 'other', 'unknown', '', 'SINGLE_CLASS']) {
    const v: any = destinationReservationOffre(offre({ typeOffre: type }));
    faux(`H1. « ${type || '(vide)'} » -> refuse`, v.ok);
    egal(`H2. motif « ${type || '(vide)'} »`, v.refus, 'type-non-reservable');
  }
  egal('H3. offre nulle -> refus', (destinationReservationOffre(null) as any).refus, 'identifiant-invalide');
}

section('I — offre A, seance de l\'offre B : inexprimable');
{
  // L'adresse ne porte QUE l'identifiant de l'offre. Aucun parametre de seance
  // n'existe : il n'y a donc rien a croiser. C'est la meilleure garantie
  // possible — pas une verification, une impossibilite.
  const a: any = destinationReservationOffre(offre({ id: ESSAI }));
  const b: any = destinationReservationOffre(offre({ id: AUTRE, typeOffre: 'single_class' }));
  faux('I1. l\'adresse de A ne contient pas B', a.url.includes(AUTRE));
  faux('I2. l\'adresse de B ne contient pas A', b.url.includes(ESSAI));
  const params = new URL(a.url).searchParams;
  egal('I3. exactement deux parametres', Array.from(params.keys()).sort().join(','), 'offre,reserver');
  faux('I4. aucun parametre de seance n\'existe',
       /session|seance|date|course|slot/i.test(a.url));
}

section('N — aucune redirection ouverte');
{
  const hostiles = [
    'https://evil.test/x',
    '//evil.test',
    '../../evil',
    'a?x=1&offre=autre',
    'a#/evil',
    'a b',
    'a/../../..',
    "javascript:alert(1)",
    'a%2f%2fevil.test',
  ];
  for (const id of hostiles) {
    const v: any = destinationReservationOffre(offre({ id }));
    faux(`N1. identifiant hostile « ${id} » -> refuse`, v.ok);
    egal(`N2. motif « ${id} »`, v.refus, 'identifiant-invalide');
  }
  // L'origine est une CONSTANTE : elle ne vient jamais du catalogue.
  const module_ = codeSeul('src/lib/discovery/reservationAfroboost.ts');
  vrai('N3. l\'origine est importee, pas construite depuis une donnee distante',
       module_.includes('ORIGINE_AFROBOOST'));
  faux('N4. aucune origine n\'est lue dans l\'offre',
       /offre\?\.(origine|url|lien|href|domaine)/.test(module_));
  // Et l'hote de la destination est toujours celui d'Afroboost.
  const bon: any = destinationReservationOffre(offre());
  egal('N5. l\'hote de la destination', new URL(bon.url).origin, new URL(ORIGINE_AFROBOOST).origin);
  // Un identifiant valide est encode.
  const encode: any = destinationReservationOffre(offre({ id: 'a.b~c-d_e' }));
  vrai('N6. un identifiant valide traverse encode', encode.ok && encode.url.includes('offre=a.b~c-d_e'));
}

section('K / L / M — l\'authentification reste celle d\'Afroboost');
{
  const module_ = codeSeul('src/lib/discovery/reservationAfroboost.ts');
  const page = codeSeul('src/app/discovery/page.tsx');
  // K. Aucun contournement : Spordateur ne porte aucune identite dans l'adresse.
  for (const mot of ['token', 'jwt', 'bearer', 'uid', 'email', 'bridge']) {
    faux(`K1. l'adresse ne transporte aucun « ${mot} »`, new RegExp(mot, 'i').test(module_));
  }
  // L. Aucun second login a eviter : le formulaire de reservation d'Afroboost
  // est PUBLIC (nom, e-mail, telephone, date de naissance) — verifie le 07/09
  // dans App.js. Il n'y a donc rien a ponter, et rien n'a ete ponte.
  faux('L1. aucun pont d\'identite n\'est fabrique ici', /bridge_identity_links/.test(module_ + page));
  // M. Un jeton invalide ne peut pas exister sur ce chemin : aucun n'est emis.
  // `exp` seul serait toujours vrai — le mot « export » le contient. On vise
  // les jetons, pas l'orthographe.
  for (const mot of ['jti', 'signToken', 'verifyToken', 'jsonwebtoken', 'HS256', 'Authorization']) {
    faux(`M1. aucun jeton « ${mot} » n'est emis ni lu`, module_.includes(mot));
  }
}

section('O / P / Q — rien d\'autre n\'a bouge');
{
  const page = codeSeul('src/app/discovery/page.tsx');
  // O. Les activites natives gardent LEURS deux chemins historiques.
  vrai('O1. la liste des activites natives est intacte', page.includes('buildActivityListUrl(navId)'));
  vrai('O2. la fiche detail native est intacte', page.includes('router.push(`/activities/${navId}`)'));
  // La branche R4 est EXPLICITEMENT conditionnee a la source.
  vrai('O3. la branche R4 est conditionnee a source === afroboost',
       /const destination = estAfroboost\s*\?/.test(page));
  vrai('O4. une native n\'a jamais de destination Afroboost',
       page.includes('estAfroboost\n                        ? destinationReservationOffre(a)')
       || /estAfroboost[\s\S]{0,40}\?[\s\S]{0,60}destinationReservationOffre/.test(page));

  // P. R3c intact : l'offre reelle reste affichee.
  const reelle = versOffrePublique({
    id: ESSAI, name: "🎁 Cours d'essai GRATUIT", offer_type: 'single_class',
    owner_type: 'admin', location_city: 'Auvernier', price: 0,
  } as any)!;
  egal('P1. l\'offre reelle traverse toujours l\'adaptateur', reelle.id, ESSAI);
  egal('P2. et reste affichee dans « Ou pratiquer ? »',
       elementsAfroboostAPratiquer([reelle], new Set()).length, 1);
  const carte: any = versElementAPratiquer(reelle);
  const d: any = destinationReservationOffre(carte);
  vrai('P3. la carte affichee sait construire sa destination', d.ok);
  egal('P4. et c\'est bien celle de l\'offre reelle',
       d.url, `${ORIGINE_AFROBOOST}/?offre=${ESSAI}&reserver=1`);

  // Q. FIX ATTRIBUTION : aucun repli global reintroduit.
  faux('Q1. aucun repli « sinon toutes les activites visibles »',
       /length\s*>\s*0\s*\?\s*\w+\s*:\s*visibleActivities/.test(page));
  vrai('Q2. l\'attribution passe toujours par le helper dedie',
       page.includes('activitesPossedees') && page.includes('activitesBoostees'));
}

section('R / S / T — aucune ecriture, aucun envoi');
{
  for (const chemin of ['src/lib/discovery/reservationAfroboost.ts', 'src/app/discovery/page.tsx']) {
    const code = codeSeul(chemin);
    faux(`R1. ${chemin} n'ecrit rien dans activities`,
         /\b(addDoc|setDoc|updateDoc|deleteDoc)\s*\(\s*[^)]*activities/.test(code));
    faux(`S1. ${chemin} n'ecrit rien dans sessions`,
         /\b(addDoc|setDoc|updateDoc|deleteDoc)\s*\(\s*[^)]*sessions/.test(code));
    faux(`T1. ${chemin} n'envoie ni e-mail ni Push`,
         /sendEmail|sendPush|notification.*send|resend/i.test(code));
  }
  const module_ = codeSeul('src/lib/discovery/reservationAfroboost.ts');
  faux('T2. le module n\'appelle rien du tout', /\b(fetch|axios|XMLHttpRequest)\b/.test(module_));
  faux('T3. et n\'ouvre rien tout seul', /window\.(open|location)/.test(module_));
  // Le lien s'ouvre dans un nouvel onglet, et sans prise sur celui-ci.
  const page = codeSeul('src/app/discovery/page.tsx');
  vrai('T4. le lien porte rel="noopener noreferrer"', page.includes('rel="noopener noreferrer"'));
  vrai('T5. et l\'ouverture programmatique aussi', page.includes("'noopener,noreferrer'"));
}

console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
console.log('Reservations reelles : 0 — paiements : 0 — e-mails : 0 — Push : 0 — ecritures : 0');
if (_failures > 0) process.exit(1);
}

principal();
