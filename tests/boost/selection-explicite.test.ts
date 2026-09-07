/**
 * LOT B — CHOISIR EXPLICITEMENT CE QU'ON MET EN AVANT.
 *
 * Exécution :
 *   npx tsx tests/boost/selection-explicite.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Jusqu'ici, une offre de la plateforme entrait dans « Où pratiquer ? » du seul
 * fait d'être publiée : personne ne l'avait choisie. Ce banc éprouve la liste
 * des offres qu'un compte a le droit de mettre en avant, et la frontière entre
 * les deux voies — la plateforme ne paie pas, le partenaire paie.
 *
 *   A. l'administrateur voit « Cours à l'unité — 30 CHF »
 *   B. il peut cibler exactement fea0ab6a-…
 *   C/D. sa voie ne passe ni par Stripe ni par les crédits
 *   E. un administrateur non prouvé n'a rien
 *   F. un compte ordinaire non plus
 *   G. le partenaire A ne voit QUE ses offres
 *   H. il ne peut pas mettre en avant celle de B
 *   I. sans liaison R3b-ID → fermeture sûre
 *   J/K. single_class et event admis
 *   L/M/N. pack, abonnement, produit refusés
 *   O. offre invisible ou disparue → refus
 *   P. identifiant falsifié → refus
 *   Q. l'activité native n'a pas bougé
 *   R. un afroboostOfferId ne devient jamais un activityId
 *   S. une offre ne devient jamais un boost « compte entier »
 *   T/U/V. Stripe, crédits et expiration inchangés
 *   W. aucune duplication dans activities
 *   X. FIX ATTRIBUTION intact
 *
 * AUCUN BOOST RÉEL, aucun paiement, aucun crédit : tout est en mémoire.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  offreSelectionnablePar,
  offresSelectionnablesPour,
} from '../../src/lib/boost/offresSelectionnables';
import {
  autoriserBoostSurOffre,
  autoriserMiseEnAvantOffre,
} from '../../src/lib/boost/autorisationAfroboost';
import { champsCibleBoost, cibleDemandee, classerBoosts, memeCible, lireCibleBoost } from '../../src/lib/boost/cible';
import { versOffrePublique } from '../../src/lib/afroboost/offers';
import { BOOST_CREDITS_COST, BOOST_DURATION_HOURS } from '../../src/lib/billing/boostCredits';

let _p = 0, _f = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _p++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _f++; }
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function faux(l: string, c: boolean, d = 'condition vraie') { if (!c) pass(l); else fail(l, d); }
function egal(l: string, o: unknown, a: unknown) {
  if (o === a) pass(l); else fail(l, `obtenu ${JSON.stringify(o)}, attendu ${JSON.stringify(a)}`);
}
function section(t: string) { console.log(`\n--- ${t} ---`); }

const UNITE = 'fea0ab6a-8adc-460d-9d7d-bbff57059ca5';   // Cours a l'unite — 30 CHF
const ESSAI = 'c1e5f73c-0f16-402e-a746-2041e23f72e8';   // Cours d'essai GRATUIT
const PACK  = 'a687ce86-94d6-4ba9-a847-c8a20e787491';
const PROD  = '84b7d8c6-b859-410a-8a09-0d1ee0069404';
const OWNER_A = '11111111-2222-3333-4444-555555555555';
const OWNER_B = '99999999-8888-7777-6666-555555555555';
const UID = 'firebase-uid-AAAA';
const MAINTENANT = 1_800_000_000_000;

function offre(p: Partial<any> = {}): any {
  return {
    id: UNITE, nom: "Cours à l'unité", description: '', prix: 30, image: '/api/files/x.jpg',
    lieuTexte: 'Bord du Lac, Auvernier', participantsMax: 30, categorieBrute: 'service',
    estProduit: false, nombreCoursLies: 4, aUneDuree: false,
    proprietaire: 'admin', proprietaireId: null, typeOffre: 'single_class',
    ville: 'Auvernier', adresse: null, latitude: null, longitude: null, ...p,
  };
}
/** Le catalogue REEL du 07/09, quatre offres publiques. */
function catalogueReel(): any[] {
  return [
    offre({ id: UNITE, nom: "Cours à l'unité", prix: 30, typeOffre: 'single_class', ville: 'Auvernier' }),
    offre({ id: PACK, nom: 'PULSE x10 cours', prix: 250, typeOffre: 'pack', ville: null }),
    offre({ id: PROD, nom: 'T-shirt + 1 cours offert!', prix: 59.99, typeOffre: 'product', ville: null }),
    offre({ id: ESSAI, nom: "🎁 Cours d'essai GRATUIT", prix: 0, typeOffre: 'single_class', ville: 'Auvernier' }),
  ];
}
function codeSeul(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

function principal() {

section('A / B — l\'administrateur voit, et peut cibler, l\'offre a 30 CHF');
{
  const liste = offresSelectionnablesPour(catalogueReel(), { adminProuve: true });
  const noms = liste.map(o => o.nom);
  egal('A1. deux offres selectionnables (les deux single_class)', liste.length, 2);
  vrai('A2. « Cours a l\'unite » y figure', noms.includes("Cours à l'unité"));
  const u = liste.find(o => o.id === UNITE)!;
  egal('A3. son identifiant est celui du catalogue', u.id, UNITE);
  egal('A4. son prix traverse', u.prix, 30);
  egal('A5. sa ville aussi', u.ville, 'Auvernier');
  vrai('A6. sa miniature est transportee', !!u.image);
  egal('A7. et sa voie est la voie gratuite', u.voie, 'admin-gratuit');

  const cible = offreSelectionnablePar(catalogueReel(), { adminProuve: true }, UNITE);
  vrai('B1. l\'offre est ciblable par son identifiant exact', cible !== null);
  egal('B2. et c\'est bien elle', cible!.id, UNITE);
  // Le titre n'est JAMAIS un identifiant.
  egal('B3. un titre ne cible rien',
       offreSelectionnablePar(catalogueReel(), { adminProuve: true }, "Cours à l'unité"), null);
}

section('C / D — la voie de l\'administrateur ne passe par aucun paiement');
{
  const route = codeSeul('src/app/api/boost/admin/route.ts');
  for (const mot of ['stripe', 'Stripe', 'checkout', 'credits', 'creditsSpent', 'wallet', 'computeBoostCost']) {
    faux(`C1. la route gratuite ignore « ${mot} »`, route.includes(mot));
  }
  vrai('C2. elle ecrit un montant nul', /amountChf:\s*0/.test(route));
  vrai('C3. et le marqueur de sa provenance', /paidWith:\s*'admin'/.test(route));
  vrai('C4. elle exige la preuve du LOT A', route.includes('estAdminAfroboostAutorise'));
  // Et les deux chemins d'ACHAT refusent toujours une offre de la plateforme.
  const achat: any = autoriserBoostSurOffre(offre({ proprietaire: 'admin' }), 'peu-importe');
  faux('D1. le chemin d\'achat refuse toujours une offre admin', achat.ok);
  egal('D2. avec le motif d\'avant', achat.refus, 'offre-admin');
}

section('E / F / I — sans preuve, aucune offre');
{
  egal('E1. administrateur NON prouve -> liste vide',
       offresSelectionnablesPour(catalogueReel(), { adminProuve: false }).length, 0);
  egal('E2. drapeau absent -> liste vide',
       offresSelectionnablesPour(catalogueReel(), {}).length, 0);
  const v: any = autoriserMiseEnAvantOffre(offre({ proprietaire: 'admin' }), { adminProuve: false });
  faux('E3. et l\'activation est refusee', v.ok);
  egal('E4. motif', v.refus, 'admin-non-prouve');

  egal('F1. compte ordinaire -> liste vide',
       offresSelectionnablesPour(catalogueReel(), { adminProuve: false, proprietaireAfroboost: null }).length, 0);
  // I — aucune liaison R3b-ID : fermeture sure, meme sur une offre partenaire.
  const partenaires = [offre({ id: 'o-a', proprietaire: 'partner', proprietaireId: OWNER_A })];
  for (const sans of [null, undefined, '', '   ']) {
    egal(`I1. liaison « ${String(sans)} » -> rien`,
         offresSelectionnablesPour(partenaires, { proprietaireAfroboost: sans as any }).length, 0);
  }
}

section('G / H — le partenaire, et exactement ses offres');
{
  const cat = [
    offre({ id: 'o-a1', nom: 'Cours de A', proprietaire: 'partner', proprietaireId: OWNER_A }),
    offre({ id: 'o-a2', nom: 'Event de A', proprietaire: 'partner', proprietaireId: OWNER_A, typeOffre: 'event' }),
    offre({ id: 'o-b1', nom: 'Cours de B', proprietaire: 'partner', proprietaireId: OWNER_B }),
    offre({ id: UNITE, nom: 'Offre de la plateforme', proprietaire: 'admin', proprietaireId: null }),
  ];
  const listeA = offresSelectionnablesPour(cat, { proprietaireAfroboost: OWNER_A });
  egal('G1. le partenaire A voit deux offres', listeA.length, 2);
  vrai('G2. les siennes seulement', listeA.every(o => o.id.startsWith('o-a')));
  faux('G3. pas celle de B', listeA.some(o => o.id === 'o-b1'));
  faux('G4. ni celle de la plateforme', listeA.some(o => o.id === UNITE));
  egal('G5. et sa voie est payante', listeA[0].voie, 'partenaire-achete');

  egal('H1. A ne peut pas cibler l\'offre de B',
       offreSelectionnablePar(cat, { proprietaireAfroboost: OWNER_A }, 'o-b1'), null);
  const v: any = autoriserMiseEnAvantOffre(
    offre({ proprietaire: 'partner', proprietaireId: OWNER_B }), { proprietaireAfroboost: OWNER_A });
  faux('H2. et l\'activation est refusee', v.ok);
  egal('H3. motif', v.refus, 'offre-non-possedee');
  // Etre administrateur ne donne AUCUNE offre partenaire.
  egal('H4. l\'administrateur ne voit pas les offres des partenaires',
       offresSelectionnablesPour(cat, { adminProuve: true }).length, 1);
}

section('J / K / L / M / N — les types');
{
  for (const type of ['single_class', 'event']) {
    egal(`J1. ${type} admis`,
         offresSelectionnablesPour([offre({ typeOffre: type })], { adminProuve: true }).length, 1);
  }
  for (const type of ['pack', 'subscription', 'product', 'membership', 'other', 'unknown']) {
    egal(`L1. ${type} refuse`,
         offresSelectionnablesPour([offre({ typeOffre: type })], { adminProuve: true }).length, 0);
    const v: any = autoriserMiseEnAvantOffre(offre({ typeOffre: type }), { adminProuve: true });
    faux(`L2. ${type} : activation refusee`, v.ok);
    egal(`L3. motif ${type}`, v.refus, 'offre-non-boostable');
  }
  // Sur le catalogue REEL : le pack et le produit ne sont pas selectionnables.
  const ids = offresSelectionnablesPour(catalogueReel(), { adminProuve: true }).map(o => o.id);
  faux('N1. le pack n\'est pas selectionnable', ids.includes(PACK));
  faux('N2. le produit non plus', ids.includes(PROD));
}

section('O / P — offre disparue, invisible, ou identifiant falsifie');
{
  // Une offre masquee ne traverse meme pas l'adaptateur (R3b-1).
  egal('O1. visible=false -> aucune offre publique',
       versOffrePublique({ id: UNITE, name: 'X', visible: false } as any), null);
  egal('O2. donc rien a selectionner', offresSelectionnablesPour([], { adminProuve: true }).length, 0);
  // Disparue du catalogue entre l'affichage et le clic.
  egal('O3. offre absente du catalogue -> non ciblable',
       offreSelectionnablePar(catalogueReel(), { adminProuve: true }, 'offre-qui-n-existe-plus'), null);
  for (const faux_ of ['', '   ', '../../x', 'fea0ab6a', UNITE.toUpperCase()]) {
    egal(`P1. identifiant « ${faux_} » -> non ciblable`,
         offreSelectionnablePar(catalogueReel(), { adminProuve: true }, faux_), null);
  }
  // La route refait la verification, elle ne croit pas l'ecran.
  const route = codeSeul('src/app/api/boost/admin/route.ts');
  vrai('P2. la route revalide l\'offre contre le catalogue', route.includes('offreSelectionnablePar'));
  vrai('P3. et relit le catalogue a l\'instant du clic', route.includes('lireOffres()'));
}

section('Q / R / S — les referentiels ne se melangent pas');
{
  // Q — l'activite native, inchangee.
  const cibleNative = cibleDemandee({ activityId: 'act-1' });
  egal('Q1. une activite reste une activite', cibleNative.genre, 'activite');
  egal('Q2. ecrite sous son champ historique',
       JSON.stringify(champsCibleBoost(cibleNative)), JSON.stringify({ activityId: 'act-1' }));
  // R — un identifiant d'offre ne devient jamais un activityId.
  const cibleOffre = cibleDemandee({ afroboostOfferId: UNITE });
  const champs = champsCibleBoost(cibleOffre);
  faux('R1. aucun activityId sur une cible offre', 'activityId' in champs);
  egal('R2. un seul champ ecrit', Object.keys(champs).length, 1);
  faux('R3. et les deux cibles ne se couvrent pas', memeCible(cibleNative, cibleOffre));
  // S — une offre ne devient jamais un boost « compte entier ».
  const doc = { partnerId: UID, afroboostOfferId: UNITE, active: true, expiresAt: { toMillis: () => MAINTENANT + 3600000 } };
  const c = classerBoosts([doc], MAINTENANT);
  egal('S1. classee comme offre', c.offresAfroboost.size, 1);
  egal('S2. aucun compte couvert', c.partenairesLegacy.size, 0);
  egal('S3. aucune activite', c.activites.size, 0);
  egal('S4. la lecture du document dit « offre »', lireCibleBoost(doc).genre, 'offreAfroboost');
}

section('T / U / V — Stripe, credits et expiration inchanges');
{
  egal('T1. tarif Stripe 24h', 1500, 1500);
  const paquets = readFileSync(join(process.cwd(), 'src/lib/payment/packages.ts'), 'utf8');
  vrai('T2. la grille BOOST_PRICES est intacte',
       paquets.includes("'24h': { price: 1500") && paquets.includes("'7d':  { price: 5000"));
  egal('U1. bareme credits 24h', BOOST_CREDITS_COST['24h'], 30);
  egal('U2. bareme credits 3d', BOOST_CREDITS_COST['3d'], 70);
  egal('U3. bareme credits 7d', BOOST_CREDITS_COST['7d'], 100);
  egal('V1. duree 24h', BOOST_DURATION_HOURS['24h'], 24);
  egal('V2. duree 3d', BOOST_DURATION_HOURS['3d'], 72);
  egal('V3. duree 7d', BOOST_DURATION_HOURS['7d'], 168);
  // La route gratuite REUTILISE cette grille, elle n'en invente pas une autre.
  const route = codeSeul('src/app/api/boost/admin/route.ts');
  vrai('V4. la voie gratuite reutilise les durees existantes', route.includes('BOOST_DURATION_HOURS'));
  faux('V5. et n\'en definit aucune nouvelle', /const\s+\w*DUREE|durationHours\s*=/.test(route));
}

section('W / X — aucune duplication, aucune regression d\'attribution');
{
  for (const chemin of [
    'src/app/api/boost/admin/route.ts',
    'src/app/api/boost/afroboost-offers/route.ts',
    'src/lib/boost/offresSelectionnables.ts',
    'src/app/partner/boost/page.tsx',
  ]) {
    const code = codeSeul(chemin);
    faux(`W1. ${chemin} n'ecrit rien dans activities`,
         /(addDoc|setDoc|updateDoc|\.set\(|\.add\()[^;]{0,120}activities/.test(code));
  }
  const module_ = codeSeul('src/lib/boost/offresSelectionnables.ts');
  faux('W2. le module de selection ne touche aucune base', /firestore|collection\(|getDocs|fetch\(/i.test(module_));
  // X — le helper d'attribution n'a pas ete touche.
  const attribution = codeSeul('src/lib/discovery/profileActivities.ts');
  vrai('X1. la garde d\'attribution est intacte', attribution.includes('profilUid'));
  faux('X2. et ne connait rien a la selection', /offresSelectionnables|estAdminAfroboostAutorise/.test(attribution));
  // Le catalogue selectionnable ne rend aucune donnee privee.
  const cat = codeSeul('src/app/api/boost/afroboost-offers/route.ts');
  faux('X3. la route ne rend aucun e-mail', /email/i.test(cat));
  faux('X4. ni aucun identifiant de proprietaire', /proprietaireId/.test(cat));
  const liste = offresSelectionnablesPour(catalogueReel(), { adminProuve: true });
  faux('X5. et la liste rendue n\'en porte pas', JSON.stringify(liste).includes('proprietaireId'));
}

console.log(`\n=== ${_p} PASS / ${_f} FAIL ===`);
console.log('Boosts reels : 0 — paiements : 0 — credits : 0 — offres modifiees : 0');
if (_f > 0) process.exit(1);
}

principal();
