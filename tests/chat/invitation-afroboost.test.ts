/**
 * LOT D2 — PROPOSER UNE OFFRE AFROBOOST DANS LA CONVERSATION.
 *
 * Exécution :
 *   npx tsx tests/chat/invitation-afroboost.test.ts
 *
 * CE QUE CE BANC PROUVE
 * Une invitation est un MESSAGE : elle dit « ça te dit ? », elle n'achète rien.
 * Ce banc verrouille les trois choses qui pourraient déraper — qu'une offre
 * Afroboost se mette à ressembler à une activité Spordate, qu'accepter
 * déclenche un paiement, ou que le prix d'Afroboost devienne un montant
 * Spordateur.
 *
 *   A. chat ouvert + offre mise en avant → invitation possible
 *   B/C/D. la cible porte l'offre, jamais un activityId, jamais une session
 *   E/F. l'invité reste l'invité, l'organisateur reste Afroboost
 *   G/H/I/J. expirée, non mise en avant, invisible, mauvais type → refus
 *   K/L/M/N. aucune session, aucun checkout, aucun prix détourné
 *   O. l'intention survit au détour par le déverrouillage
 *   P. rien ne part sans action explicite
 *   Q/R/S. accepter n'achète rien
 *   T. le CTA final passe par R4
 *   U/V. l'activité native et son invitation n'ont pas bougé
 *   W/X. FIX ATTRIBUTION intact, aucun repli global
 *
 * AUCUNE INVITATION RÉELLE : tout est en mémoire.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildActivityInvitePayload,
  buildInvitationAfroboostPayload,
  cibleEstAfroboost,
  cleCibleInvitation,
} from '../../src/lib/chat/activityInvite';
import { lireOffreAProposer, urlChatAvecOffre, PARAM_PROPOSER_OFFRE } from '../../src/lib/chat/urlParams';
import { offresDeRencontre } from '../../src/lib/discovery/activitesDeRencontre';
import { destinationReservationOffre } from '../../src/lib/discovery/reservationAfroboost';
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
const AUTRE = 'c1e5f73c-0f16-402e-a746-2041e23f72e8';
const SENDER = 'uid-bassi';
const DAVELOVE = 'uid-davelove';
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
const horodatage = (ms: number) => ({ toMillis: () => ms });
const misesEnAvant = (...docs: any[]) => classerBoosts(docs, MAINTENANT).offresAfroboost;
const boostVivant = (id: string) => ({ partnerId: SENDER, afroboostOfferId: id, active: true, expiresAt: horodatage(MAINTENANT + HEURE) });
function codeSeul(chemin: string): string {
  return readFileSync(join(process.cwd(), chemin), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}
/** La charge utile telle qu'elle serait ecrite dans le chat. */
function chargeUtile(o: any) {
  return buildInvitationAfroboostPayload({
    senderId: SENDER, afroboostOfferId: o.afroboostOfferId, titre: o.titre,
    inviteMode: 'individual', ville: o.ville ?? undefined,
    lieu: o.lieu ?? undefined, imageUrl: o.image ?? undefined, prix: o.prix,
  });
}

function principal() {

section('A / B / C / D — la cible de l\'invitation');
{
  const [o] = offresDeRencontre([offre()], misesEnAvant(boostVivant(UNITE)));
  vrai('A1. une offre mise en avant est proposable', !!o);
  const p = chargeUtile(o);
  egal('A2. c\'est un message d\'invitation', p.type, 'activity_invite');
  egal('A3. en attente', p.inviteStatus, 'pending');
  egal('A4. envoye par l\'utilisateur courant', p.senderId, SENDER);

  const inv: any = p.invite;
  egal('B1. la source est nommee', inv.source, 'afroboost');
  egal('B2. l\'identifiant de l\'offre est exact', inv.afroboostOfferId, UNITE);
  faux('C1. AUCUN activityId', 'activityId' in inv);
  faux('D1. AUCUN sessionId', 'nextSessionId' in inv);
  faux('D2. ni date de session', 'nextSessionAt' in inv);
  egal('D3. la cle nomme la source',
       cleCibleInvitation({ source: 'afroboost', afroboostOfferId: UNITE }), `afroboost:${UNITE}`);
  vrai('D4. la garde de type reconnait la cible',
       cibleEstAfroboost({ source: 'afroboost', afroboostOfferId: UNITE }));
  faux('D5. et ne confond pas une cible native',
       cibleEstAfroboost({ activityId: 'act-1' } as any));
}

section('E / F — l\'invite reste l\'invite, l\'organisateur reste Afroboost');
{
  const [o] = offresDeRencontre([offre()], misesEnAvant(boostVivant(UNITE)));
  const inv: any = chargeUtile(o).invite;
  faux('E1. l\'invitation ne porte AUCUNE identite d\'invite dans sa cible',
       JSON.stringify(inv).includes(DAVELOVE));
  faux('E2. et aucun champ de propriete', 'proprietaireId' in inv || 'owner' in inv);
  egal('F1. l\'organisateur reste Afroboost dans la liste', o.organisateur, 'Afroboost');
  // La carte l'affiche en dur : l'offre n'est ni au sender ni au receiver.
  const carte = codeSeul('src/components/chat/ActivityInviteMessage.tsx');
  vrai('F2. la carte nomme l\'organisateur', carte.includes('proposé par Afroboost'));
  vrai('F3. et distingue la source', carte.includes("invite?.source === 'afroboost'"));
}

section('G / H / I / J — ce qui n\'est pas proposable');
{
  egal('G1. mise en avant expiree -> rien',
       offresDeRencontre([offre()], misesEnAvant({ partnerId: SENDER, afroboostOfferId: UNITE, active: true, expiresAt: horodatage(MAINTENANT - 1) })).length, 0);
  egal('H1. aucune mise en avant -> rien', offresDeRencontre([offre()], misesEnAvant()).length, 0);
  egal('H2. mise en avant desactivee -> rien',
       offresDeRencontre([offre()], misesEnAvant({ partnerId: SENDER, afroboostOfferId: UNITE, active: false, expiresAt: horodatage(MAINTENANT + HEURE) })).length, 0);
  egal('I1. offre masquee -> aucune offre publique',
       versOffrePublique({ id: UNITE, name: 'X', visible: false } as any), null);
  for (const type of ['pack', 'product', 'subscription', 'membership', 'other', 'unknown']) {
    egal(`J1. ${type} mis en avant -> non proposable`,
         offresDeRencontre([offre({ typeOffre: type })], misesEnAvant(boostVivant(UNITE))).length, 0);
  }
  // La mise en avant d'une AUTRE offre n'ouvre pas celle-ci.
  egal('J2. mise en avant d\'une autre offre -> rien',
       offresDeRencontre([offre()], misesEnAvant(boostVivant(AUTRE))).length, 0);
}

section('K / L / M / N — aucune session, aucun paiement, aucun prix detourne');
{
  const service = codeSeul('src/services/activityInvite.ts');
  const bloc = service.slice(service.indexOf('sendInvitationAfroboost'));
  for (const mot of ['ensureSessionForActivity', 'ensure-from-activity', 'sessions', 'checkout', 'stripe', 'booking']) {
    faux(`K1. l'envoi Afroboost ignore « ${mot} »`, new RegExp(mot, 'i').test(bloc));
  }
  const page = codeSeul('src/app/chat/page.tsx');
  faux('L1. le chat ne resout aucune session pour une offre',
       /offreAProposer[\s\S]{0,300}(ensureSessionForActivity|mode:\s*'session')/.test(page));
  // N — le prix est INFORMATIF, et il est marque comme tel dans le modele.
  const [o] = offresDeRencontre([offre({ prix: 30 })], misesEnAvant(boostVivant(UNITE)));
  const inv: any = chargeUtile(o).invite;
  egal('N1. le prix est transporte pour affichage', inv.offrePrix, 30);
  const modele = readFileSync(join(process.cwd(), 'src/types/firestore.ts'), 'utf8');
  vrai('N2. et le modele dit qu\'il ne fait autorite sur rien',
       /offrePrix[\s\S]{0,200}INFORMATIF|INFORMATIF[\s\S]{0,200}offrePrix/.test(modele)
       || modele.includes('Ne fait autorité sur rien'));
  faux('N3. aucun montant ne part vers Stripe depuis ce chemin',
       /offreAProposer[\s\S]{0,300}(amount|unit_amount|price_data)/.test(page));
}

section('O / P — l\'intention, et l\'action explicite');
{
  // O — elle voyage par l'URL, le chemin que le deverrouillage emprunte deja.
  egal('O1. l\'adresse porte le match et l\'offre',
       urlChatAvecOffre('m-1', UNITE), `/chat?match=m-1&${PARAM_PROPOSER_OFFRE}=${UNITE}`);
  egal('O2. relue telle quelle', lireOffreAProposer(UNITE), UNITE);
  for (const mauvais of ['', '   ', '../../x', 'a b', 'javascript:alert(1)', '//evil']) {
    egal(`O3. « ${mauvais} » -> ignore`, lireOffreAProposer(mauvais), null);
  }
  egal('O4. absent -> ignore', lireOffreAProposer(null), null);

  // P — RIEN ne part tout seul : le bouton de Discovery n'ecrit pas.
  const discovery = codeSeul('src/app/discovery/page.tsx');
  faux('P1. Discovery n\'envoie aucune invitation',
       discovery.includes('sendInvitationAfroboost'));
  vrai('P2. il se contente de conduire au chat',
       /handleProposerOffre[\s\S]{0,400}urlChatAvecOffre/.test(discovery));
  const page = codeSeul('src/app/chat/page.tsx');
  vrai('P3. et l\'envoi depend d\'un clic explicite',
       /onClick=\{proposerOffre\}/.test(page));
  faux('P4. jamais d\'envoi automatique au chargement',
       /useEffect\([\s\S]{0,400}proposerOffre\(\)/.test(page));
}

section('Q / R / S / T — accepter n\'achete rien, et R4 reste la porte');
{
  const carte = codeSeul('src/components/chat/ActivityInviteMessage.tsx');
  const accept = carte.slice(carte.indexOf('const doAccept'), carte.indexOf('const handleAccept'));
  vrai('Q1. accepter une offre Afroboost sort avant toute reservation',
       /estInvitationAfroboost[\s\S]{0,300}return;/.test(accept));
  faux('R1. et ne redirige pas vers une page d\'activite Spordate',
       /estInvitationAfroboost[\s\S]{0,200}router\.push\(`\/activities/.test(accept));
  for (const mot of ['checkout', 'stripe', 'ensureSession', 'booking']) {
    faux(`S1. l'acceptation ignore « ${mot} »`, new RegExp(mot, 'i').test(accept));
  }
  // T — la reservation reelle passe par R4, inchange.
  vrai('T1. la carte propose la reservation chez Afroboost',
       carte.includes('destinationReservationOffre') && carte.includes('Réserver chez Afroboost'));
  const d: any = destinationReservationOffre({ id: UNITE, typeOffre: 'single_class', prix: 30 } as never);
  vrai('T2. et la destination est celle de R4', d.ok && d.url.includes(`?offre=${UNITE}`));
  faux('T3. une offre payante n\'ouvre pas un paiement toute seule', d.ouvreLeFormulaire);
}

section('U / V — le chemin natif n\'a pas bouge');
{
  const natif = buildActivityInvitePayload({
    senderId: SENDER, activityId: 'act-1', activityTitle: 'Silent Afroboost',
    inviteMode: 'individual', nextSessionId: 'sess-1', activityCity: 'Neuchâtel',
  });
  const inv: any = natif.invite;
  egal('U1. l\'invitation native porte toujours son activityId', inv.activityId, 'act-1');
  egal('U2. et sa session', inv.nextSessionId, 'sess-1');
  faux('U3. aucune source imposee (retro-compat des documents d\'hier)', 'source' in inv);
  faux('U4. et aucun champ Afroboost', 'afroboostOfferId' in inv);
  egal('V1. meme type de message', natif.type, 'activity_invite');
  egal('V2. meme statut initial', natif.inviteStatus, 'pending');
  // Le service natif est intact.
  const service = codeSeul('src/services/activityInvite.ts');
  vrai('V3. sendActivityInvite existe toujours', service.includes('export async function sendActivityInvite'));
  vrai('V4. et interroge toujours invite.activityId',
       service.includes("where('invite.activityId', '==', input.activityId)"));
}

section('W / X — les gardes anterieures');
{
  const page = codeSeul('src/app/discovery/page.tsx');
  const attribution = codeSeul('src/lib/discovery/profileActivities.ts');
  vrai('W1. la garde d\'attribution est toujours branchee', page.includes('activitesDuProfil'));
  faux('W2. et ne connait rien aux invitations Afroboost',
       /sendInvitationAfroboost|afroboostOfferId/.test(attribution));
  faux('X1. aucun repli « sinon toutes les activites visibles »',
       /length\s*>\s*0\s*\?\s*\w+\s*:\s*visibleActivities/.test(page));
  faux('X2. les offres ne sont jamais versees dans partnerActivities',
       /partnerActivities\s*=\s*[^;]*optionsDeRencontre/.test(page));
}

console.log(`\n=== ${_p} PASS / ${_f} FAIL ===`);
console.log('Invitations reelles : 0 — messages : 0 — paiements : 0 — sessions : 0 — credits : 0');
if (_f > 0) process.exit(1);
}

principal();
