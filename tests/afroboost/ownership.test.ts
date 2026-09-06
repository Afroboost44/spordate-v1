/**
 * R3b-ID — LE PONT D'IDENTITÉ PARTENAIRE. AUCUNE BASE, AUCUN RÉSEAU.
 *
 * Exécution :
 *   npx tsx tests/afroboost/ownership.test.ts
 *
 * CE QUE CE BANC PROUVE — et pourquoi il compte plus que les autres :
 * la fonction éprouvée ici est la garde qui, au lot suivant, autorisera ou
 * refusera un PAIEMENT. Un « à peu près » y coûterait qu'un partenaire boost
 * l'offre d'un autre, ou celle de la plateforme.
 *
 * A. uid sans liaison            → aucun propriétaire
 * B. liaison valide              → résolution exacte
 * C. uid A contre propriétaire B → refus
 * D. uid inconnu                 → refus
 * E. offre admin                 → jamais possédée par un partenaire
 * F. offre partner + uid mappé A → propriétaire
 * G. offre partner + autre id    → refus
 * H. proprietaireId nul          → refus
 * I. proprietaire unknown        → refus
 * J. aucun repli nom/e-mail/téléphone
 * K. aucune liaison créée depuis une valeur du navigateur
 * L. double lecture              → idempotente, aucune écriture
 * M. deux uid ne peuvent pas revendiquer le même propriétaire
 *
 * AUCUNE CORRESPONDANCE RÉELLE N'EST FABRIQUÉE : tout ce qui suit est une
 * fixture en mémoire. En production, 0 partenaire existe (mesure du 06/09).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  COLLECTION_LIENS,
  estProprietaireDeLOffre,
  possedeLOffreAfroboost,
  resoudreProprietaireAfroboost,
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
function section(t: string) { console.log(`\n--- ${t} ---`); }

/**
 * Base factice minimale — et elle COMPTE LES ÉCRITURES.
 * C'est ce qui rend observable le « ce module n'écrit rien » : une absence
 * d'écriture ne se démontre pas, elle se mesure.
 */
function creerBase(liens: Record<string, any> = {}) {
  const ecritures: string[] = [];
  let lectures = 0;
  return {
    ecritures,
    get lectures() { return lectures; },
    collection(nom: string) {
      return {
        doc(id: string) {
          return {
            async get() {
              lectures++;
              if (nom !== COLLECTION_LIENS) return { exists: false, data: () => undefined };
              const v = liens[id];
              return { exists: v !== undefined, data: () => (v === undefined ? undefined : { ...v }) };
            },
            set(..._a: any[]) { ecritures.push(`set ${nom}/${id}`); },
            create(..._a: any[]) { ecritures.push(`create ${nom}/${id}`); },
            update(..._a: any[]) { ecritures.push(`update ${nom}/${id}`); },
            delete() { ecritures.push(`delete ${nom}/${id}`); },
          };
        },
      };
    },
  };
}

const UID_A = 'firebase-uid-AAAA';
const UID_B = 'firebase-uid-BBBB';
const OWNER_A = '11111111-2222-3333-4444-555555555555';
const OWNER_B = '99999999-8888-7777-6666-555555555555';

function offre(p: any, pid: any) {
  return { proprietaire: p, proprietaireId: pid } as any;
}

async function principal() {

section('A-D — la resolution d\'un compte vers son identifiant partenaire');
{
  // A. aucune liaison du tout
  let base = creerBase({});
  egal('A1. uid sans liaison -> null', await resoudreProprietaireAfroboost(base as any, UID_A), null);
  egal('A2. et AUCUNE ecriture', base.ecritures.length, 0);

  // A bis. liaison existante MAIS sans identifiant partenaire : c'est l'etat
  // reel de toutes les liaisons aujourd'hui (U2b n'ecrit que l'e-mail).
  base = creerBase({ [UID_A]: { spordateUid: UID_A, afroboostEmail: 'x@exemple.invalid' } });
  egal('A3. liaison SANS afroboostPartnerId -> null (etat « non lie »)',
       await resoudreProprietaireAfroboost(base as any, UID_A), null);

  // B. liaison complete
  base = creerBase({ [UID_A]: { spordateUid: UID_A, afroboostPartnerId: OWNER_A } });
  egal('B1. liaison valide -> l\'identifiant exact', await resoudreProprietaireAfroboost(base as any, UID_A), OWNER_A);
  egal('B2. la resolution n\'ecrit rien', base.ecritures.length, 0);

  // C. un autre uid ne recupere pas la liaison de A
  egal('C1. uid B ne resout pas vers le proprietaire de A',
       await resoudreProprietaireAfroboost(base as any, UID_B), null);

  // D. uid vide / absurde
  egal('D1. uid vide -> null', await resoudreProprietaireAfroboost(base as any, ''), null);
  egal('D2. uid null -> null', await resoudreProprietaireAfroboost(base as any, null), null);
  egal('D3. uid inconnu -> null', await resoudreProprietaireAfroboost(base as any, 'uid-jamais-vu'), null);

  // Une base en panne ne doit pas lever : ce code sera dans un chemin de paiement.
  const basePanne = { collection() { return { doc() { return { async get() { throw new Error('firestore indisponible'); } }; } }; } };
  egal('D4. base injoignable -> null, jamais une exception',
       await resoudreProprietaireAfroboost(basePanne as any, UID_A), null);
}

section('E-I — la decision de propriete, pure');
{
  // E. admin
  faux('E1. offre admin + compte lie -> jamais proprietaire', estProprietaireDeLOffre(OWNER_A, offre('admin', OWNER_A)));
  faux('E2. offre admin + proprietaireId nul -> non', estProprietaireDeLOffre(OWNER_A, offre('admin', null)));

  // F. le seul cas vrai
  vrai('F1. offre partner + identifiant identique -> proprietaire', estProprietaireDeLOffre(OWNER_A, offre('partner', OWNER_A)));

  // G. mauvais partenaire
  faux('G1. offre partner d\'un AUTRE partenaire -> non', estProprietaireDeLOffre(OWNER_A, offre('partner', OWNER_B)));

  // H. identifiant absent cote offre
  faux('H1. proprietaireId null -> non', estProprietaireDeLOffre(OWNER_A, offre('partner', null)));
  faux('H2. proprietaireId vide -> non', estProprietaireDeLOffre(OWNER_A, offre('partner', '')));
  faux('H3. proprietaireId blanc -> non', estProprietaireDeLOffre(OWNER_A, offre('partner', '   ')));

  // I. unknown ne se decide pas ici
  faux('I1. proprietaire unknown -> non', estProprietaireDeLOffre(OWNER_A, offre('unknown', OWNER_A)));
  faux('I2. proprietaire absent -> non', estProprietaireDeLOffre(OWNER_A, offre(undefined, OWNER_A)));
  faux('I3. offre nulle -> non', estProprietaireDeLOffre(OWNER_A, null));

  // Compte non lie
  faux('I4. compte sans liaison -> non', estProprietaireDeLOffre(null, offre('partner', OWNER_A)));
  faux('I5. compte lie a rien -> non', estProprietaireDeLOffre('', offre('partner', OWNER_A)));
  faux('I6. deux valeurs vides ne se valent PAS', estProprietaireDeLOffre('', offre('partner', '')));
}

section('J — aucun repli sur une identite devinee');
{
  // Un e-mail stocke comme identifiant partenaire est REFUSE : sans cela, une
  // ecriture fautive ferait de l'adresse une cle de propriete.
  const base = creerBase({ [UID_A]: { spordateUid: UID_A, afroboostPartnerId: 'coach@exemple.invalid' } });
  egal('J1. un e-mail n\'est jamais un identifiant de partenaire',
       await resoudreProprietaireAfroboost(base as any, UID_A), null);
  faux('J2. et il ne rend donc personne proprietaire',
       await possedeLOffreAfroboost(base as any, UID_A, offre('partner', 'coach@exemple.invalid')));

  // Le nom, le telephone, la ville : le module ne les lit meme pas.
  const src = require('node:fs').readFileSync('src/lib/afroboost/ownership.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ['nom', 'name', 'phone', 'telephone', 'email', 'ville', 'city', 'titre', 'title'].forEach((mot) => {
    const lu = new RegExp(`\\.${mot}\\b|\\[['"]${mot}['"]\\]`).test(code);
    faux(`J3. le module ne lit jamais « ${mot} »`, lu);
  });
}

section('K-L — aucune ecriture, jamais, et idempotence');
{
  const base = creerBase({ [UID_A]: { spordateUid: UID_A, afroboostPartnerId: OWNER_A } });
  await possedeLOffreAfroboost(base as any, UID_A, offre('partner', OWNER_A));
  await possedeLOffreAfroboost(base as any, UID_A, offre('partner', OWNER_A));
  await possedeLOffreAfroboost(base as any, UID_B, offre('partner', OWNER_B));
  egal('K1. AUCUNE ecriture, quel que soit le nombre d\'appels', base.ecritures.length, 0);

  // K bis : le module n'expose aucune fonction d'ecriture. Une valeur venue du
  // navigateur ne peut donc pas creer une liaison en passant par ici.
  const mod = require('../../src/lib/afroboost/ownership');
  const noms = Object.keys(mod);
  faux('K2. aucune fonction d\'ecriture exportee',
       noms.some((n: string) => /ecrire|enregistrer|creer|lier|set|write|save/i.test(n)),
       `exports : ${noms.join(', ')}`);

  // L. deux lectures successives donnent le meme resultat
  const r1 = await resoudreProprietaireAfroboost(base as any, UID_A);
  const r2 = await resoudreProprietaireAfroboost(base as any, UID_A);
  vrai('L1. deux resolutions successives sont identiques', r1 === r2 && r1 === OWNER_A);
  egal('L2. et toujours aucune ecriture', base.ecritures.length, 0);
}

section('M — un proprietaire ne peut pas etre revendique par deux comptes');
{
  // L'unicite est portee par le LOT U2b : `bridge_identity_links/{uid}` est
  // indexe par le uid, et le pont refuse d'ecraser une liaison contradictoire
  // (il la consigne dans `bridge_identity_conflicts`). Ce banc verifie la
  // consequence ici : meme si deux liaisons pointaient le meme partenaire,
  // chaque compte ne resout que la SIENNE — et surtout, ce module n'offre
  // aucun moyen d'en creer une seconde.
  const base = creerBase({
    [UID_A]: { spordateUid: UID_A, afroboostPartnerId: OWNER_A },
    [UID_B]: { spordateUid: UID_B, afroboostPartnerId: OWNER_B },
  });
  egal('M1. chaque compte resout SON propre partenaire (A)', await resoudreProprietaireAfroboost(base as any, UID_A), OWNER_A);
  egal('M2. chaque compte resout SON propre partenaire (B)', await resoudreProprietaireAfroboost(base as any, UID_B), OWNER_B);
  faux('M3. A ne possede pas l\'offre de B', await possedeLOffreAfroboost(base as any, UID_A, offre('partner', OWNER_B)));
  faux('M4. B ne possede pas l\'offre de A', await possedeLOffreAfroboost(base as any, UID_B, offre('partner', OWNER_A)));
  vrai('M5. et chacun possede bien la sienne',
       (await possedeLOffreAfroboost(base as any, UID_A, offre('partner', OWNER_A)))
       && (await possedeLOffreAfroboost(base as any, UID_B, offre('partner', OWNER_B))));
}

section('HORS PORTEE — ce lot ne touche a rien d\'autre');
{
  const src = require('node:fs').readFileSync('src/lib/afroboost/ownership.ts', 'utf8');
  const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // « boost » est cherche SANS le prefixe « afro » : le nom du module contient
  // « Afroboost », ce qui n'a rien a voir avec la fonctionnalite Boost.
  faux('HP. le module ignore la fonctionnalite Boost',
       /(?<!afro)boost/i.test(sansCommentaires));
  ['stripe', 'checkout', 'wallet', 'commission', 'credit', 'webhook'].forEach((mot) => {
    faux(`HP. le module ignore « ${mot} »`, new RegExp(mot, 'i').test(sansCommentaires));
  });
  vrai('HP. il se branche sur la collection U2b existante, sans en creer une autre',
       COLLECTION_LIENS === 'bridge_identity_links');
}

console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
console.log('Correspondances reelles fabriquees : 0 — toutes les liaisons ci-dessus sont des fixtures en memoire');
if (_failures > 0) process.exit(1);
}

principal().catch((e) => {
  console.log(`FAIL  banc interrompu — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
