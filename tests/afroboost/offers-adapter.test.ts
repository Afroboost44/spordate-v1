/**
 * LOT R2 — L'adaptateur d'offres Afroboost. AUCUN APPEL RÉSEAU RÉEL.
 *
 * Exécution :
 *   npm run test:afroboost:offers
 *
 * `fetch` est remplacé AVANT le premier appel : aucune requête ne sort, et
 * surtout aucune ne part vers `GET /api/offers` en production — cette route a
 * un effet de bord (elle insère 3 offres si la collection est vide), donc un
 * test qui l'appellerait pour de vrai pourrait ÉCRIRE dans une base neuve.
 *
 * CE QUE CE FICHIER PROUVE
 *   * A. une réponse valide devient un DTO normalisé ;
 *   * B. `coach_id` — qui EST un e-mail — ne sort JAMAIS ;
 *   * C. un champ privé inventé demain par Afroboost ne traverse pas ;
 *   * D. délai dépassé → repli, aucun plantage ;
 *   * E. HTTP 500 → repli ;   F. JSON invalide → repli ;
 *   * G. réponse vide / mal typée → repli ;
 *   * H. le cache évite les appels inutiles ;  I. il expire ;
 *   * J. aucune écriture, aucune UI, R1 intact.
 */
export {};

import * as fs from 'fs';
import * as path from 'path';
import {
  adapterOffres,
  versOffrePublique,
  CLES_PUBLIQUES,
  type OffreAfroboostBrute,
} from '../../src/lib/afroboost/offers';

let _passes = 0;
let _failures = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _passes++; }
function fail(l: string, d: string) { console.log(`FAIL  ${l} — ${d}`); _failures++; }
function egal(l: string, recu: unknown, attendu: unknown) {
  if (JSON.stringify(recu) === JSON.stringify(attendu)) pass(l);
  else fail(l, `reçu ${JSON.stringify(recu)}, attendu ${JSON.stringify(attendu)}`);
}
function vrai(l: string, c: boolean, d = 'condition fausse') { if (c) pass(l); else fail(l, d); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

// ── Le faux `fetch`. Posé AVANT tout import de la route. ──────────────
type Scenario =
  | { genre: 'ok'; corps: unknown; statut?: number }
  | { genre: 'statut'; statut: number }
  | { genre: 'json-invalide' }
  | { genre: 'timeout' }
  | { genre: 'reseau' };

let scenarioCourant: Scenario = { genre: 'ok', corps: [] };
let appelsSortants = 0;
const urlsAppelees: string[] = [];

(globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown, init?: { signal?: AbortSignal }) => {
  appelsSortants++;
  urlsAppelees.push(String(url));
  // On FIGE le scénario dans une constante locale : `scenario` est un `let` de
  // portée module, que TypeScript ne peut pas affiner à travers un `await`.
  const scenario = scenarioCourant;
  if (scenario.genre === 'timeout') {
    // On imite un abandon réel : la promesse rejette avec AbortError.
    return await new Promise((_r, rejet) => {
      const erreur = new Error('aborted');
      erreur.name = 'AbortError';
      if (init?.signal) init.signal.addEventListener('abort', () => rejet(erreur));
      setTimeout(() => rejet(erreur), 4000);
    });
  }
  if (scenario.genre === 'reseau') throw new Error('ECONNREFUSED');
  if (scenario.genre === 'statut') return { ok: false, status: scenario.statut, json: async () => ({}) };
  if (scenario.genre === 'json-invalide') {
    return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  }
  return { ok: true, status: scenario.statut ?? 200, json: async () => scenario.corps };
};

// Import APRÈS la pose du faux fetch.
const route = require('../../src/app/api/afroboost/offers/route');
const { lireOffres, _viderCache } = route as {
  lireOffres: (t?: number) => Promise<{ offres: unknown[]; etat: string; motif: string; cache: boolean }>;
  _viderCache: () => void;
};

// Une offre telle qu'Afroboost la renvoie VRAIMENT (champs mesurés en prod).
const OFFRE_REELLE: OffreAfroboostBrute = {
  id: 'off-1',
  name: 'Cours Afroboost — séance découverte',
  description: 'Cardio-danse afro, casques silencieux.',
  price: 25,
  thumbnail: 'https://res.cloudinary.com/x/img.jpg',
  images: ['https://res.cloudinary.com/x/img2.jpg'],
  visible: true,
  location: 'Salle du Pommier, Neuchâtel',
  max_participants: 20,
  category: 'service',
  isProduct: false,
  linked_course_ids: ['c1', 'c2'],
  duration_value: null,
  duration_unit: null,
  // 🔴 CE CHAMP EST UNE ADRESSE E-MAIL. Il ne doit jamais ressortir.
  coach_id: 'contact.artboost@gmail.com',
};

// =====================================================================
section('A — une réponse valide devient un DTO normalisé');
{
  const lu = adapterOffres([OFFRE_REELLE]);
  egal('A1. état ok', lu.etat, 'ok');
  egal('A2. une offre retenue', lu.offres.length, 1);
  const o = lu.offres[0];
  egal('A3. id', o.id, 'off-1');
  egal('A4. nom', o.nom, 'Cours Afroboost — séance découverte');
  egal('A5. prix', o.prix, 25);
  egal('A6. image = miniature', o.image, 'https://res.cloudinary.com/x/img.jpg');
  egal('A7. lieu transporté comme TEXTE (pas une ville structurée)', o.lieuTexte, 'Salle du Pommier, Neuchâtel');
  egal('A8. capacité déclarée', o.participantsMax, 20);
  egal('A9. catégorie brute, non interprétée', o.categorieBrute, 'service');
  egal('A10. nombre de cours liés (fait, pas type)', o.nombreCoursLies, 2);
  egal('A11. porte une durée = faux ici', o.aUneDuree, false);
  vrai('A12. sans miniature, on retombe sur la première image',
    versOffrePublique({ ...OFFRE_REELLE, thumbnail: '' })?.image === 'https://res.cloudinary.com/x/img2.jpg');
}

// =====================================================================
section('B — l’e-mail du coach ne sort JAMAIS');
{
  const o = versOffrePublique(OFFRE_REELLE);
  const plat = JSON.stringify(o);
  vrai('B1. `coach_id` absent du DTO', !('coach_id' in (o as object)));
  vrai('B2. aucune adresse e-mail dans la charge publique', !plat.includes('@'), plat);
  vrai('B3. le nom du champ lui-même n’apparaît pas', !plat.includes('coach'));
}

// =====================================================================
section('C — LISTE BLANCHE : un champ inventé demain ne traverse pas');
{
  const demain: OffreAfroboostBrute = {
    ...OFFRE_REELLE,
    phone: '+41 79 000 00 00',
    stripe_account: 'acct_123',
    internal_notes: 'ne jamais publier',
    owner_email: 'coach@exemple.test',
  };
  const o = versOffrePublique(demain)!;
  const cles = Object.keys(o).sort();
  egal('C1. exactement les clés publiques déclarées', cles, [...CLES_PUBLIQUES].sort());
  const plat = JSON.stringify(o);
  ['+41 79', 'acct_123', 'ne jamais publier', 'coach@exemple.test'].forEach((secret, i) => {
    vrai(`C2.${i + 1} « ${secret} » absent`, !plat.includes(secret));
  });
}

// =====================================================================
section('D — ce que l’adaptateur refuse');
{
  vrai('D1. sans id → rejetée', versOffrePublique({ name: 'x' }) === null);
  vrai('D2. sans nom → rejetée', versOffrePublique({ id: 'x' }) === null);
  vrai('D3. `visible: false` → rejetée (masquée chez Afroboost, masquée ici)',
    versOffrePublique({ ...OFFRE_REELLE, visible: false }) === null);
  vrai('D4. `visible` absent → conservée (défaut du modèle)',
    versOffrePublique({ id: 'a', name: 'b' }) !== null);
  vrai('D5. null / non-objet → rejetés',
    versOffrePublique(null) === null && versOffrePublique(undefined) === null);
  egal('D6. une charge qui n’est pas un tableau → repli', adapterOffres({}).etat, 'repli');
  egal('D7. null → repli', adapterOffres(null).etat, 'repli');
  egal('D8. une chaîne → repli', adapterOffres('<html>').etat, 'repli');
  egal('D9. un tableau vide reste un succès (zéro offre ≠ panne)', adapterOffres([]).etat, 'ok');
}

// =====================================================================
section('E — AUCUN TYPE NI PROPRIÉTAIRE DEVINÉ (R2c)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'afroboost', 'offers.ts'), 'utf-8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  ['offer_type', 'single_class', 'subscription', 'owner_type', 'isAdmin', 'estAdmin', 'abonnement']
    .forEach((mot, i) => vrai(`E${i + 1}. « ${mot} » absent du code`, !code.includes(mot)));
  const o = versOffrePublique({ ...OFFRE_REELLE, duration_value: 3, duration_unit: 'months' })!;
  vrai('E8. une durée est transportée comme un FAIT, pas comme « abonnement »',
    o.aUneDuree === true && !('type' in (o as object)) && !('owner' in (o as object)));
}

// =====================================================================
// LES SECTIONS SUIVANTES ATTENDENT DU RÉSEAU (feint). `tsx` compile ce banc en
// CommonJS, où `await` au niveau racine n'existe pas : on les enferme donc dans
// une fonction, appelée en fin de fichier.
async function principal(): Promise<void> {
section('F — délai, panne, JSON invalide : repli, jamais de plantage');
{
  const cas: Array<[string, Scenario, string]> = [
    ['F1. HTTP 500 → repli', { genre: 'statut', statut: 500 }, 'afroboost a repondu 500'],
    ['F2. HTTP 404 → repli', { genre: 'statut', statut: 404 }, 'afroboost a repondu 404'],
    ['F3. JSON invalide → repli', { genre: 'json-invalide' }, 'reponse illisible'],
    ['F4. réseau coupé → repli', { genre: 'reseau' }, 'afroboost injoignable'],
    ['F5. réponse `{}` → repli', { genre: 'ok', corps: {} }, 'reponse inattendue : un tableau etait attendu'],
  ];
  for (const [label, s, motif] of cas) {
    _viderCache(); scenarioCourant = s;
    const r = await lireOffres();
    vrai(label, r.etat === 'repli' && r.offres.length === 0 && r.motif === motif,
      `état ${r.etat}, motif « ${r.motif} »`);
  }
  _viderCache(); scenarioCourant = { genre: 'timeout' };
  const t0 = Date.now();
  const r = await lireOffres();
  const duree = Date.now() - t0;
  vrai('F6. délai dépassé → repli', r.etat === 'repli' && r.motif === 'delai depasse', r.motif);
  vrai('F7. et il coupe autour de 2,5 s, pas après 4 s', duree < 3400, `${duree} ms`);
}

section('G — le cache évite les appels inutiles, et il expire');
{
  _viderCache(); scenarioCourant = { genre: 'ok', corps: [OFFRE_REELLE] };
  appelsSortants = 0;
  const a = await lireOffres(1_000_000);
  const b = await lireOffres(1_000_000 + 60_000);   // +1 min
  const c = await lireOffres(1_000_000 + 240_000);  // +4 min
  egal('G1. trois lectures rapprochées → UN seul appel sortant', appelsSortants, 1);
  vrai('G2. la première n’est pas servie par le cache', a.cache === false);
  vrai('G3. les suivantes le sont', b.cache === true && c.cache === true);
  egal('G4. et elles rendent bien les offres', b.offres.length, 1);

  const d = await lireOffres(1_000_000 + 5 * 60 * 1000 + 1); // au-delà de 5 min
  egal('G5. passé 5 minutes → nouvel appel', appelsSortants, 2);
  vrai('G6. et il n’est pas marqué « cache »', d.cache === false);

  // Un repli ne doit pas être mis en cache : une panne d’une seconde ne doit
  // pas durer cinq minutes.
  _viderCache(); appelsSortants = 0; scenarioCourant = { genre: 'statut', statut: 500 };
  await lireOffres(2_000_000);
  await lireOffres(2_000_000 + 1000);
  egal('G7. un repli n’est PAS mis en cache (deux appels)', appelsSortants, 2);
}

section('H — l’appel sort bien vers Afroboost, et nulle part ailleurs');
{
  vrai('H1. toutes les URL appelées visent /api/offers',
    urlsAppelees.length > 0 && urlsAppelees.every((u) => u.endsWith('/api/offers')),
    urlsAppelees.slice(0, 3).join(' | '));
  vrai('H2. et le domaine est afroboost',
    urlsAppelees.every((u) => u.includes('afroboost')), urlsAppelees[0]);
}

section('I — aucune écriture, aucune UI, R1 intact');
{
  const srcRoute = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'app', 'api', 'afroboost', 'offers', 'route.ts'), 'utf-8');
  const srcAdapt = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'afroboost', 'offers.ts'), 'utf-8');
  // ON INSPECTE LE CODE, PAS LA PROSE — et la première version de cette garde
  // se trompait deux fois : elle lisait les commentaires (qui NOMMENT
  // `stripe_account` pour expliquer pourquoi il ne doit pas passer), et elle
  // cherchait « boost » dans un fichier dont chaque ligne parle d'AFROBOOST.
  // Un contrôle qui échoue sur le nom de marque du produit ne contrôle rien.
  const sansProse = (t: string) => t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const tout = sansProse(srcRoute) + sansProse(srcAdapt);
  ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction', 'collection(']
    .forEach((mot, i) => vrai(`I${i + 1}. aucune écriture Firestore : « ${mot} »`, !tout.includes(mot)));
  // `boosts` au pluriel = la collection Firestore ; « boost » seul serait
  // toujours vrai à cause du mot « Afroboost ».
  ['boosts', 'booking', 'payment', 'stripe', 'credit', 'wallet', 'commission']
    .forEach((mot, i) => vrai(`I8.${i + 1} rien de financier : « ${mot} »`, !tout.toLowerCase().includes(mot)));

  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'app', 'discovery', 'page.tsx'), 'utf-8');
  vrai('I9. discovery/page.tsx N’IMPORTE PAS ce module (aucune UI en R2)',
    !page.includes('afroboost/offers') && !page.includes('lireOffres'));
  vrai('I10. R1 est toujours branché dans la page',
    page.includes('resolveDiscoveryView') && page.includes('displayIndex'));
}

console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
if (_failures > 0) process.exit(1);
}

principal().catch((e) => {
  console.log(`FAIL  banc interrompu — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
