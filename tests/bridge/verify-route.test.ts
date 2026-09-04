/**
 * LOT U2b — banc de la ROUTE DU PONT elle-même (`/api/bridge/verify`).
 *
 * POURQUOI CE BANC EN PLUS DU PRÉCÉDENT : le module de liaison sait décider,
 * mais c'est LA ROUTE qui décide QUAND l'appeler. L'ordre des gardes —
 * signature, audience, expiration, anti-rejeu, puis SEULEMENT la liaison — ne
 * vit nulle part ailleurs. Le seul moyen de prouver qu'un jeton forgé n'écrit
 * rien, c'est d'appeler la vraie fonction `POST` exportée par la vraie route,
 * avec un Firestore et un Firebase Auth factices injectés.
 *
 * Ce que ce banc prouve :
 *   V1  membre valide -> session ouverte ET liaison persistée
 *   V2  deuxième passage (nouveau jeton, même membre) -> AUCUN doublon
 *   V3  signature invalide -> 401, ZÉRO écriture
 *   V4  jeton expiré -> 401, ZÉRO écriture
 *   V5  mauvaise audience / mauvais émetteur -> 401, ZÉRO écriture
 *   V6  jeton absent d'un membre non authentifié -> 400, ZÉRO écriture
 *   V7  rejeu du MÊME jti -> 409, aucune seconde liaison
 *   V8  conflit d'identité -> 200 (le pont prime), rien d'écrasé, conflit consigné
 *   V9  compte Firebase créé à la volée -> liaison quand même (c'est le cas normal
 *       d'un tout premier passage)
 *   V10 le pont reste intact : anti-rejeu, `via: afroboost`, réponse inchangée
 *   V11 Firestore en panne sur la liaison -> le pont MARCHE QUAND MÊME
 *
 * Exécution : npm run test:bridge:verify-route
 * Aucun réseau, aucun émulateur, aucun projet Firebase réel.
 */

export {}; // module scope (sinon globals collide tsc)

/* eslint-disable @typescript-eslint/no-explicit-any */

import crypto from 'node:crypto';

const SECRET = 'secret-de-banc-u2b-jamais-en-production';
process.env.AFRO_SPORDATE_SHARED_SECRET = SECRET;

import { creerFirestoreFactice } from './fakeFirestore';
import { __setAdminDbForTesting, __setAdminAuthForTesting } from '../../src/lib/firebase/admin';
import {
  COLLECTION_LIENS,
  COLLECTION_INDEX,
  COLLECTION_CONFLITS,
  cleIndexEmail,
} from '../../src/lib/bridge/identityLink';

const COLLECTION_JETONS = 'bridge_used_tokens';

let passes = 0;
let echecs = 0;

function ok(label: string): void {
  console.log(`  ✓ ${label}`);
  passes++;
}
function ko(label: string, detail: string): void {
  console.error(`  ✗ ${label}\n      ${detail}`);
  echecs++;
}
function egal(label: string, recu: unknown, attendu: unknown): void {
  if (JSON.stringify(recu) === JSON.stringify(attendu)) ok(label);
  else ko(label, `reçu ${JSON.stringify(recu)} — attendu ${JSON.stringify(attendu)}`);
}
function vrai(label: string, cond: boolean, detail = ''): void {
  if (cond) ok(label);
  else ko(label, detail || 'condition fausse');
}
function section(titre: string): void {
  console.log(`\n--- ${titre} ---`);
}

// ─── Fabrication de jetons, exactement comme afroboost les émet ────────────
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function forger(charge: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const entete = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const corps = b64url(JSON.stringify(charge));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${entete}.${corps}`).digest());
  return `${entete}.${corps}.${sig}`;
}

let compteurJti = 0;
function jetonValide(email: string, extra: Record<string, unknown> = {}): string {
  const maintenant = Math.floor(Date.now() / 1000);
  return forger({
    email,
    jti: `jti_${++compteurJti}`,
    aud: 'spordate',
    iss: 'afroboost',
    iat: maintenant,
    origine: 'compte',
    exp: maintenant + 900,
    ...extra,
  });
}

// ─── Firebase Auth factice ─────────────────────────────────────────────────
function creerAuthFactice(comptes: Record<string, string>) {
  const journal: string[] = [];
  let compteur = 0;
  return {
    journal,
    async getUserByEmail(email: string) {
      journal.push(`getUserByEmail:${email}`);
      const uid = comptes[email];
      if (!uid) throw new Error('auth/user-not-found');
      return { uid, email };
    },
    async createUser({ email }: { email: string }) {
      journal.push(`createUser:${email}`);
      const uid = `uid_cree_${++compteur}`;
      comptes[email] = uid;
      return { uid, email };
    },
    async createCustomToken(uid: string, claims: Record<string, unknown>) {
      journal.push(`createCustomToken:${uid}:${JSON.stringify(claims)}`);
      return `custom_${uid}`;
    },
  };
}

function requete(corps: unknown): any {
  return { json: async () => corps };
}

async function principal() {
  // Import APRÈS la pose de la variable d'environnement : la route la lit à
  // l'appel, mais un import plus tôt ne coûte rien de plus à écrire ainsi.
  const { POST } = await import('../../src/app/api/bridge/verify/route');

  const EMAIL = 'membre@afroboost.test';
  const UID = 'uid_existant_1';

  // ─── V1. Le parcours nominal ─────────────────────────────────────────────
  section('V1 — membre afroboost valide');

  let db = creerFirestoreFactice();
  let auth = creerAuthFactice({ [EMAIL]: UID });
  __setAdminDbForTesting(db);
  __setAdminAuthForTesting(auth);

  const rep1 = await POST(requete({ t: jetonValide(EMAIL) }));
  const corps1 = await rep1.json();
  egal('V1a. 200', rep1.status, 200);
  egal('V1b. un customToken est rendu', corps1.token, `custom_${UID}`);
  egal("V1c. l'e-mail est rendu", corps1.email, EMAIL);

  const cle = cleIndexEmail(EMAIL);
  const lien = db._lire(COLLECTION_LIENS, UID);
  vrai('V1d. LA LIAISON EST PERSISTÉE', Boolean(lien), 'aucun document de liaison');
  egal('V1e. elle porte le bon e-mail afroboost', lien?.afroboostEmail, EMAIL);
  egal('V1f. elle porte le bon uid Spordateur', lien?.spordateUid, UID);
  egal("V1g. elle retient la porte d'entrée afroboost", lien?.origine, 'compte');
  egal("V1h. l'index inverse pointe le même uid", db._lire(COLLECTION_INDEX, cle)?.spordateUid, UID);
  vrai('V1i. la liaison est datée', lien?.linkedAt instanceof Date);

  // ─── V10. Le pont lui-même n'a pas bougé ─────────────────────────────────
  section('V10 — le pont reste intact');
  vrai(
    "V10a. l'anti-rejeu a bien consommé le jti",
    db._taille(COLLECTION_JETONS) === 1,
    `${db._taille(COLLECTION_JETONS)} jeton(s) consommé(s)`,
  );
  vrai(
    "V10b. le customToken porte toujours via:afroboost",
    auth.journal.some((l) => l.startsWith('createCustomToken:') && l.includes('"via":"afroboost"')),
    auth.journal.join(' | '),
  );
  egal(
    "V10c. la réponse ne contient QUE token + email (rien de nouveau n'a fuité)",
    Object.keys(corps1).sort(),
    ['email', 'token'],
  );

  // ─── V2. Deuxième passage : pas de doublon ───────────────────────────────
  section('V2 — deuxième passage du même membre');

  const rep2 = await POST(requete({ t: jetonValide(EMAIL) }));
  egal('V2a. 200 de nouveau', rep2.status, 200);
  egal('V2b. TOUJOURS une seule liaison', db._taille(COLLECTION_LIENS), 1);
  egal('V2c. TOUJOURS un seul index', db._taille(COLLECTION_INDEX), 1);
  egal('V2d. aucun conflit', db._taille(COLLECTION_CONFLITS), 0);
  egal(
    "V2e. la date de liaison d'origine est intacte",
    db._lire(COLLECTION_LIENS, UID)?.linkedAt?.getTime?.(),
    lien?.linkedAt?.getTime?.(),
  );

  // ─── V7. Rejeu du MÊME jeton ─────────────────────────────────────────────
  section('V7 — rejeu du même jeton');

  const meme = jetonValide(EMAIL);
  const rejeu1 = await POST(requete({ t: meme }));
  const ecrituresAvant = db._ecritures().length;
  const rejeu2 = await POST(requete({ t: meme }));
  egal('V7a. premier usage : 200', rejeu1.status, 200);
  egal('V7b. second usage : 409 already_used', rejeu2.status, 409);
  egal(
    "V7c. le rejeu n'écrit RIEN de plus",
    db._ecritures().length,
    ecrituresAvant,
  );
  egal('V7d. toujours une seule liaison', db._taille(COLLECTION_LIENS), 1);

  // ─── V3/V4/V5/V6. Les jetons qui ne valent rien ──────────────────────────
  section('V3-V6 — jetons refusés : ZÉRO écriture');

  const cas: Array<[string, unknown, number]> = [
    ['V3. signature forgée avec un autre secret', { t: forger({ email: 'pirate@x.test', jti: 'j_p1', aud: 'spordate', iss: 'afroboost', exp: Math.floor(Date.now() / 1000) + 900 }, 'mauvais-secret') }, 401],
    ['V3bis. alg:none', { t: forger({ email: 'pirate@x.test', jti: 'j_p2', aud: 'spordate', iss: 'afroboost', exp: Math.floor(Date.now() / 1000) + 900 }, SECRET, 'none') }, 401],
    ['V4. jeton expiré', { t: jetonValide('pirate@x.test', { exp: Math.floor(Date.now() / 1000) - 10 }) }, 401],
    ['V5. mauvaise audience', { t: jetonValide('pirate@x.test', { aud: 'autre-service' }) }, 401],
    ['V5bis. mauvais émetteur', { t: jetonValide('pirate@x.test', { iss: 'quelquun' }) }, 401],
    ['V6. aucun jeton (identité ChatWidget non authentifiée : afroboost ne lui en donne pas)', {}, 400],
    ['V6bis. jeton sans e-mail', { t: jetonValide('', {}) }, 400],
  ];

  for (const [label, corps, attendu] of cas) {
    const dbCas = creerFirestoreFactice();
    __setAdminDbForTesting(dbCas);
    __setAdminAuthForTesting(creerAuthFactice({}));
    const rep = await POST(requete(corps));
    const zero = dbCas._ecritures().length === 0 || dbCas._taille(COLLECTION_LIENS) === 0;
    if (rep.status === attendu && dbCas._taille(COLLECTION_LIENS) === 0 && dbCas._taille(COLLECTION_INDEX) === 0 && zero) {
      ok(`${label} -> ${rep.status}, aucune liaison`);
    } else {
      ko(
        label,
        `statut ${rep.status} (attendu ${attendu}), liaisons=${dbCas._taille(COLLECTION_LIENS)}, écritures=${JSON.stringify(dbCas._ecritures())}`,
      );
    }
  }

  // ─── V9. Compte Firebase créé à la volée ─────────────────────────────────
  section('V9 — tout premier passage : le compte Firebase naît ici');

  const dbNeuf = creerFirestoreFactice();
  const authNeuf = creerAuthFactice({}); // aucun compte existant
  __setAdminDbForTesting(dbNeuf);
  __setAdminAuthForTesting(authNeuf);

  const NOUVEAU = 'nouvelle@afroboost.test';
  const repNeuf = await POST(requete({ t: jetonValide(NOUVEAU, { origine: 'code' }) }));
  egal('V9a. 200', repNeuf.status, 200);
  vrai(
    'V9b. le compte a bien été créé par Firebase',
    authNeuf.journal.includes(`createUser:${NOUVEAU}`),
    authNeuf.journal.join(' | '),
  );
  const lienNeuf = dbNeuf._tous(COLLECTION_LIENS)[0];
  vrai('V9c. la liaison est écrite pour ce nouvel uid', Boolean(lienNeuf));
  egal('V9d. avec le bon e-mail', lienNeuf?.afroboostEmail, NOUVEAU);
  egal("V9e. et la porte d'entrée « code »", lienNeuf?.origine, 'code');

  // ─── V8. Conflit d'identité ──────────────────────────────────────────────
  section("V8 — conflit : l'e-mail est déjà lié à un autre uid");

  const dbC = creerFirestoreFactice();
  __setAdminDbForTesting(dbC);
  __setAdminAuthForTesting(creerAuthFactice({ [EMAIL]: 'uid_A' }));
  await POST(requete({ t: jetonValide(EMAIL) })); // liaison initiale sur uid_A

  // Le même e-mail revient, mais Firebase répond un AUTRE uid (compte
  // dédoublé, migration, reprise manuelle — peu importe la cause).
  __setAdminAuthForTesting(creerAuthFactice({ [EMAIL]: 'uid_B' }));
  const repC = await POST(requete({ t: jetonValide(EMAIL) }));

  egal('V8a. le pont ouvre QUAND MÊME la session', repC.status, 200);
  egal('V8b. la liaison initiale est INTACTE', dbC._lire(COLLECTION_INDEX, cle)?.spordateUid, 'uid_A');
  egal("V8c. aucune liaison créée pour l'uid concurrent", dbC._lire(COLLECTION_LIENS, 'uid_B'), undefined);
  egal('V8d. le conflit est consigné', dbC._taille(COLLECTION_CONFLITS), 1);
  egal(
    'V8e. la trace nomme les deux uid',
    [dbC._tous(COLLECTION_CONFLITS)[0]?.spordateUidEnBase, dbC._tous(COLLECTION_CONFLITS)[0]?.spordateUidPresente],
    ['uid_A', 'uid_B'],
  );

  // ─── V11. Firestore en panne : le pont prime ─────────────────────────────
  section('V11 — la liaison échoue, le pont marche quand même');

  const dbCasse: any = creerFirestoreFactice();
  const runOk = dbCasse.runTransaction.bind(dbCasse);
  dbCasse.runTransaction = async () => {
    throw new Error('Firestore indisponible (simulation)');
  };
  __setAdminDbForTesting(dbCasse);
  __setAdminAuthForTesting(creerAuthFactice({ [EMAIL]: UID }));
  const repPanne = await POST(requete({ t: jetonValide(EMAIL) }));
  const corpsPanne = await repPanne.json();
  egal('V11a. 200 malgré la panne', repPanne.status, 200);
  egal('V11b. le membre reçoit bien sa session', corpsPanne.token, `custom_${UID}`);
  egal('V11c. aucune liaison écrite (normal)', dbCasse._taille(COLLECTION_LIENS), 0);
  void runOk;

  // ─── Nettoyage : ne jamais laisser une injection armée ────────────────────
  __setAdminDbForTesting(null);
  __setAdminAuthForTesting(null);

  console.log(`\n=== ${passes} PASS / ${echecs} FAIL ===`);
  if (echecs > 0) process.exit(1);
}

principal().catch((e) => {
  console.error('banc interrompu :', e);
  process.exit(1);
});
