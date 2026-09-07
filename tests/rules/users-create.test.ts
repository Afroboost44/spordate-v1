/**
 * P0 — LA CREATION D'UN users/{uid} NE DOIT PAS OCTROYER DE PRIVILEGE.
 *
 * Exécution :
 *   npm run test:users:create-rules
 *   (= firebase emulators:exec --only firestore "npx tsx tests/rules/users-create.test.ts")
 *
 * CE QUE CE BANC PROUVE, ET POURQUOI IL EXISTE
 * La règle était `allow create: if isOwner(userId)`, sans la moindre contrainte
 * de champ — alors que le document d'inscription est écrit par le NAVIGATEUR.
 * La protection posée sur l'UPDATE ne servait donc à rien : il suffisait de ne
 * jamais passer par un update. Un compte neuf pouvait se créer `role: 'admin'`,
 * et une vingtaine de gardes du projet lisent exactement ce champ.
 *
 *   A. inscription normale (payload réel de `createUser`)   → AUTORISÉE
 *   B. role:'admin' à la création                           → REFUSÉE
 *   C. rôles privilégiés ou inventés                        → REFUSÉS
 *   D. crédits arbitraires                                  → REFUSÉS
 *   E. isPremium / isCreator                                → REFUSÉS
 *   F. commission (part financière)                         → REFUSÉE
 *   G. sanctions, modération, notes, purge                  → REFUSÉES
 *   H. A crée le document de B                              → REFUSÉ
 *   I. non authentifié                                      → REFUSÉ
 *   J. update d'un champ protégé                            → toujours REFUSÉ
 *   K. update d'un champ ordinaire                          → toujours AUTORISÉ
 *   L. les chemins d'inscription RÉELS du projet            → tous AUTORISÉS
 *
 * AUCUN COMPTE RÉEL N'EST TOUCHÉ : tout se passe dans l'émulateur, sur un
 * projet factice.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

let _passes = 0;
let _failures = 0;
function pass(l: string) { console.log(`PASS  ${l}`); _passes++; }
function fail(l: string, e?: unknown) { console.log(`FAIL  ${l}`, e ?? ''); _failures++; }
function section(t: string) { console.log(`\n--- ${t} ---`); }

async function doitPasser(label: string, p: Promise<unknown>) {
  try { await assertSucceeds(p); pass(label); } catch (e) { fail(label, e); }
}
async function doitEchouer(label: string, p: Promise<unknown>) {
  try { await assertFails(p); pass(label); } catch (e) { fail(label, e); }
}

const ALICE = 'user_alice_p0';
const BOB = 'user_bob_p0';

/** Le payload REEL de `createUser` (src/services/firestore.ts). */
function inscriptionReelle(uid: string, extra: Record<string, unknown> = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: 'Alice',
    photoURL: '',
    bio: '',
    gender: 'other',
    city: '',
    canton: '',
    sports: [],
    credits: 0,
    referralCode: 'ABC123',
    referredBy: '',
    isCreator: false,
    role: 'user',
    isPremium: false,
    fcmToken: '',
    language: 'fr',
    onboardingComplete: false,
    lastActive: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...extra,
  };
}

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-users-create-p0',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  const alice = () => asFirestore(env.authenticatedContext(ALICE).firestore());
  const anonyme = () => asFirestore(env.unauthenticatedContext().firestore());
  /** Chaque cas part d'une base vide : une creation ne se teste qu'une fois. */
  const neuf = async () => { await env.clearFirestore(); };

  section('A — l\'inscription normale passe, telle qu\'elle est ecrite dans le code');
  await neuf();
  await doitPasser('A1. payload reel de createUser',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE)));

  section('B / C — aucun role privilegie ne s\'obtient a la creation');
  for (const role of ['admin', 'creator', 'superadmin', 'ADMIN', 'moderator']) {
    await neuf();
    await doitEchouer(`B1. role='${role}' -> refuse`,
      setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { role })));
  }
  // Et le cas nu, sans rien d'autre : c'est la forme la plus simple de l'attaque.
  await neuf();
  await doitEchouer('B2. document minimal { role: admin } -> refuse',
    setDoc(doc(alice(), 'users', ALICE), { uid: ALICE, role: 'admin' }));

  section('C bis — les deux roles legitimes restent possibles');
  await neuf();
  await doitPasser('C1. role=user',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { role: 'user' })));
  await neuf();
  await doitPasser('C2. role=partner (inscription partenaire existante)',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { role: 'partner' })));
  await neuf();
  await doitPasser('C3. aucun role du tout (src/lib/db.ts)',
    setDoc(doc(alice(), 'users', ALICE), { uid: ALICE, email: 'a@example.com', sports: [], referralCode: 'X' }));

  section('D — aucun credit ne se donne a la creation');
  for (const credits of [1, 50, 999999, -5, 0.5]) {
    await neuf();
    await doitEchouer(`D1. credits=${credits} -> refuse`,
      setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { credits })));
  }
  await neuf();
  await doitPasser('D2. credits=0 -> autorise (valeur de l\'inscription)',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { credits: 0 })));

  section('E — ni statut payant, ni statut createur');
  await neuf();
  await doitEchouer('E1. isPremium=true -> refuse',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { isPremium: true })));
  await neuf();
  await doitEchouer('E2. isCreator=true -> refuse',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { isCreator: true })));

  section('F / G — la part financiere, les sanctions et la moderation sont hors de portee');
  const interdits: Array<[string, unknown]> = [
    ['commission', { creator: 50, invite: 50 }],
    ['lastPaymentId', 'pi_123'],
    ['lastPaymentAt', Timestamp.now()],
    ['activeSanctionId', 'sanction_1'],
    ['activeSanctionLevel', 'warning'],
    ['activeSanctionEndsAt', Timestamp.now()],
    ['bioModeration', { score: 0 }],
    ['leakFlagged', false],
    ['averageRatingAsReviewee', 5],
    ['reviewCountAsReviewee', 42],
    ['anonymizedAt', Timestamp.now()],
    ['softDeleteScheduledPurgeAt', Timestamp.now()],
  ];
  for (const [champ, valeur] of interdits) {
    await neuf();
    await doitEchouer(`F1. « ${champ} » a la creation -> refuse`,
      setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { [champ]: valeur })));
  }
  await neuf();
  await doitEchouer('G1. referralCount fabrique -> refuse',
    setDoc(doc(alice(), 'users', ALICE), inscriptionReelle(ALICE, { referralCount: 100 })));

  section('H / I — le document d\'un autre, et l\'anonyme');
  await neuf();
  await doitEchouer('H1. Alice cree le document de Bob -> refuse',
    setDoc(doc(alice(), 'users', BOB), inscriptionReelle(BOB)));
  await neuf();
  await doitEchouer('H2. meme avec un payload parfaitement normal',
    setDoc(doc(alice(), 'users', BOB), inscriptionReelle(BOB, { role: 'user', credits: 0 })));
  await neuf();
  await doitEchouer('I1. non authentifie -> refuse',
    setDoc(doc(anonyme(), 'users', ALICE), inscriptionReelle(ALICE)));

  section('J / K — l\'UPDATE n\'a pas change');
  await neuf();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(asFirestore(ctx.firestore()), 'users', ALICE), inscriptionReelle(ALICE));
  });
  await doitEchouer('J1. update role -> toujours refuse',
    updateDoc(doc(alice(), 'users', ALICE), { role: 'admin' }));
  await doitEchouer('J2. update credits -> toujours refuse',
    updateDoc(doc(alice(), 'users', ALICE), { credits: 500 }));
  await doitEchouer('J3. update isPremium -> toujours refuse',
    updateDoc(doc(alice(), 'users', ALICE), { isPremium: true }));
  await doitPasser('K1. update bio -> toujours autorise',
    updateDoc(doc(alice(), 'users', ALICE), { bio: 'Salut' }));
  await doitPasser('K2. update city + sports -> toujours autorise',
    updateDoc(doc(alice(), 'users', ALICE), { city: 'Neuchatel', sports: ['afroboost'] }));

  section('L — les quatre chemins d\'inscription REELS du projet');
  // /partner/login (~l.98 et ~l.203) et /setup-partner (~l.169)
  await neuf();
  await doitPasser('L1. /partner/login — role partner, credits 0',
    setDoc(doc(alice(), 'users', ALICE), {
      uid: ALICE, displayName: '', email: 'a@example.com',
      role: 'partner', city: '', isPremium: false, credits: 0,
      createdAt: Timestamp.now(),
    }, { merge: true }));
  await neuf();
  await doitPasser('L2. /setup-partner — meme forme',
    setDoc(doc(alice(), 'users', ALICE), {
      uid: ALICE, displayName: 'Studio', email: 'a@example.com',
      role: 'partner', city: 'Geneve', isPremium: false, credits: 0,
    }, { merge: true }));
  // /onboard/prompts et /profile/verify-selfie creent le doc s'il manque.
  await neuf();
  await doitPasser('L3. /onboard/prompts — creation par merge, aucun champ sensible',
    setDoc(doc(alice(), 'users', ALICE), {
      profilePrompts: [{ id: 'p1', reponse: 'x' }], updatedAt: Timestamp.now(),
    }, { merge: true }));
  await neuf();
  await doitPasser('L4. /profile/verify-selfie — creation par merge',
    setDoc(doc(alice(), 'users', ALICE), {
      selfieVerificationStatus: 'pending', selfieVerificationUrl: 'https://x/y.jpg',
      selfieVerificationSubmittedAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }, { merge: true }));

  section('M — l\'Admin SDK n\'est pas concerne par ces regles');
  await neuf();
  await env.withSecurityRulesDisabled(async (ctx) => {
    // Contexte privilegie = ce que fait l'Admin SDK cote serveur.
    await setDoc(doc(asFirestore(ctx.firestore()), 'users', ALICE),
      inscriptionReelle(ALICE, { role: 'admin', credits: 1000 }));
  });
  pass('M1. le serveur privilegie ecrit encore role=admin et des credits');

  await env.cleanup();

  console.log(`\n=== ${_passes} PASS / ${_failures} FAIL ===`);
  console.log('Comptes reels touches : 0 — credits reels : 0 — donnees production : 0');
  if (_failures > 0) process.exit(1);
}

main().catch((e) => {
  console.log('FAIL  banc interrompu —', e);
  process.exit(1);
});
