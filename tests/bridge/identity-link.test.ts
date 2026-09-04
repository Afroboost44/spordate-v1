/**
 * LOT U2b — banc de la LIAISON D'IDENTITÉ, côté module.
 *
 * Ce que ce banc prouve :
 *   L1  la décision pure, cas par cas (créer / rien / les deux conflits)
 *   L2  première venue -> une liaison ET son index inverse, en une transaction
 *   L3  deuxième venue -> AUCUNE écriture, date de liaison intacte (idempotence)
 *   L4  même e-mail, autre uid -> conflit consigné, rien d'écrasé
 *   L5  même uid, autre e-mail -> conflit consigné, rien d'écrasé
 *   L6  l'origine venue du jeton est normalisée, jamais recopiée telle quelle
 *   L7  l'e-mail n'apparaît pas dans l'identifiant de document (index haché)
 *   L8  identité incomplète -> aucune écriture
 *   L9  ce qui est stocké est EXACTEMENT le minimum annoncé — rien de plus
 *
 * Exécution : npm run test:bridge:identity-link
 * Pattern : unitaire pur + Firestore factice. Aucun réseau, aucun émulateur.
 */

export {}; // module scope (sinon globals collide tsc)

import {
  deciderLiaison,
  enregistrerLiaison,
  cleIndexEmail,
  normaliserOrigine,
  COLLECTION_LIENS,
  COLLECTION_INDEX,
  COLLECTION_CONFLITS,
} from '../../src/lib/bridge/identityLink';
import { creerFirestoreFactice } from './fakeFirestore';

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

const EMAIL = 'membre@afroboost.test';
const UID = 'uid_spordate_1';

async function principal() {
  // ─── L1. La décision, pure ───────────────────────────────────────────────
  section('L1 — décision pure');

  egal(
    'L1a. rien en base -> créer les deux documents',
    deciderLiaison({ lien: null, index: null }, { uid: UID, email: EMAIL }),
    { action: 'creer', motif: 'liaison_nouvelle', ecrireLien: true, ecrireIndex: true },
  );

  egal(
    'L1b. tout en base et concordant -> aucune écriture',
    deciderLiaison(
      { lien: { afroboostEmail: EMAIL }, index: { spordateUid: UID } },
      { uid: UID, email: EMAIL },
    ),
    { action: 'inchangee', motif: 'liaison_deja_presente', ecrireLien: false, ecrireIndex: false },
  );

  egal(
    'L1c. uid déjà lié à un AUTRE e-mail -> conflit, zéro écriture',
    deciderLiaison(
      { lien: { afroboostEmail: 'quelquun.dautre@afroboost.test' }, index: null },
      { uid: UID, email: EMAIL },
    ),
    {
      action: 'conflit',
      motif: 'uid_deja_lie_a_un_autre_email',
      ecrireLien: false,
      ecrireIndex: false,
    },
  );

  egal(
    'L1d. e-mail déjà lié à un AUTRE uid -> conflit, zéro écriture',
    deciderLiaison(
      { lien: null, index: { spordateUid: 'uid_spordate_2' } },
      { uid: UID, email: EMAIL },
    ),
    {
      action: 'conflit',
      motif: 'email_deja_lie_a_un_autre_uid',
      ecrireLien: false,
      ecrireIndex: false,
    },
  );

  egal(
    "L1e. liaison à moitié écrite (index perdu) -> on complète, on ne réécrit pas",
    deciderLiaison({ lien: { afroboostEmail: EMAIL }, index: null }, { uid: UID, email: EMAIL }),
    { action: 'creer', motif: 'liaison_completee', ecrireLien: false, ecrireIndex: true },
  );

  // ─── L2. Première venue ──────────────────────────────────────────────────
  section('L2 — première venue par le pont');

  const db = creerFirestoreFactice();
  const t0 = new Date('2026-09-04T10:00:00.000Z');
  const r1 = await enregistrerLiaison(db, {
    uid: UID,
    email: EMAIL,
    origine: 'compte',
    maintenant: t0,
  });

  egal('L2a. action = creer', r1.action, 'creer');
  const cle = cleIndexEmail(EMAIL);
  const lien = db._lire(COLLECTION_LIENS, UID);
  const index = db._lire(COLLECTION_INDEX, cle);
  vrai('L2b. le document de liaison existe', Boolean(lien));
  vrai("L2c. l'index inverse existe", Boolean(index));
  egal('L2d. la liaison pointe le bon uid', lien?.spordateUid, UID);
  egal("L2e. la liaison porte l'e-mail normalisé", lien?.afroboostEmail, EMAIL);
  egal("L2f. l'index inverse pointe le bon uid", index?.spordateUid, UID);
  egal('L2g. date de liaison enregistrée', lien?.linkedAt?.toISOString?.(), t0.toISOString());
  egal('L2h. exactement 2 écritures', db._ecritures().length, 2);
  egal('L2i. aucun conflit consigné', db._taille(COLLECTION_CONFLITS), 0);

  // ─── L9. Le minimum, et rien de plus ─────────────────────────────────────
  section('L9 — champs stockés : le minimum strict');
  egal(
    'L9a. la liaison porte EXACTEMENT les 5 champs annoncés',
    Object.keys(lien || {}).sort(),
    ['afroboostEmail', 'emailKey', 'linkedAt', 'origine', 'spordateUid'],
  );
  egal(
    "L9b. l'index inverse ne porte que uid + date (pas d'e-mail en clair)",
    Object.keys(index || {}).sort(),
    ['linkedAt', 'spordateUid'],
  );

  // ─── L3. Deuxième venue : idempotence ────────────────────────────────────
  section('L3 — deuxième passage par le pont');

  const t1 = new Date('2026-09-05T18:30:00.000Z');
  const r2 = await enregistrerLiaison(db, {
    uid: UID,
    email: EMAIL,
    origine: 'jeton_abonne',
    maintenant: t1,
  });
  egal('L3a. action = inchangee', r2.action, 'inchangee');
  egal('L3b. toujours 2 écritures au total (aucune de plus)', db._ecritures().length, 2);
  egal('L3c. une seule liaison', db._taille(COLLECTION_LIENS), 1);
  egal('L3d. un seul index', db._taille(COLLECTION_INDEX), 1);
  egal(
    "L3e. la date de liaison d'origine est PRÉSERVÉE",
    db._lire(COLLECTION_LIENS, UID)?.linkedAt?.toISOString?.(),
    t0.toISOString(),
  );
  egal(
    "L3f. l'origine du premier jour n'est pas réécrite",
    db._lire(COLLECTION_LIENS, UID)?.origine,
    'compte',
  );

  // Un e-mail écrit en majuscules, ou entouré d'espaces, est le MÊME membre.
  const r2bis = await enregistrerLiaison(db, {
    uid: UID,
    email: '  MEMBRE@Afroboost.TEST  ',
    maintenant: t1,
  });
  egal("L3g. e-mail en majuscules -> même liaison, pas un doublon", r2bis.action, 'inchangee');
  egal('L3h. toujours une seule liaison', db._taille(COLLECTION_LIENS), 1);

  // ─── L4. Même e-mail, autre uid ──────────────────────────────────────────
  section('L4 — conflit : même e-mail, autre uid');

  const r3 = await enregistrerLiaison(db, {
    uid: 'uid_spordate_AUTRE',
    email: EMAIL,
    maintenant: t1,
  });
  egal('L4a. action = conflit', r3.action, 'conflit');
  egal('L4b. motif', r3.motif, 'email_deja_lie_a_un_autre_uid');
  egal("L4c. l'index inverse n'a PAS été détourné", db._lire(COLLECTION_INDEX, cle)?.spordateUid, UID);
  egal('L4d. aucune liaison créée pour le nouvel uid', db._lire(COLLECTION_LIENS, 'uid_spordate_AUTRE'), undefined);
  egal('L4e. le conflit est consigné', db._taille(COLLECTION_CONFLITS), 1);
  egal(
    "L4f. la trace du conflit garde les DEUX côtés",
    db._tous(COLLECTION_CONFLITS)[0]?.spordateUidEnBase,
    UID,
  );

  // ─── L5. Même uid, autre e-mail ──────────────────────────────────────────
  section('L5 — conflit : même uid, autre compte afroboost');

  const r4 = await enregistrerLiaison(db, {
    uid: UID,
    email: 'quelquun.dautre@afroboost.test',
    maintenant: t1,
  });
  egal('L5a. action = conflit', r4.action, 'conflit');
  egal('L5b. motif', r4.motif, 'uid_deja_lie_a_un_autre_email');
  egal(
    "L5c. la liaison d'origine est INTACTE",
    db._lire(COLLECTION_LIENS, UID)?.afroboostEmail,
    EMAIL,
  );
  egal('L5d. deux conflits consignés', db._taille(COLLECTION_CONFLITS), 2);
  egal(
    "L5e. rien n'a été créé pour l'autre e-mail",
    db._lire(COLLECTION_INDEX, cleIndexEmail('quelquun.dautre@afroboost.test')),
    undefined,
  );

  // ─── L6. Origine : normalisée, jamais recopiée ───────────────────────────
  section("L6 — origine : normalisée, jamais recopiée telle quelle");

  egal('L6a. compte', normaliserOrigine('compte'), 'compte');
  egal('L6b. jeton_abonne', normaliserOrigine('jeton_abonne'), 'jeton_abonne');
  egal('L6c. code', normaliserOrigine('code'), 'code');
  egal('L6d. absente -> inconnu', normaliserOrigine(undefined), 'inconnu');
  egal('L6e. valeur inventée -> inconnu', normaliserOrigine('super_admin'), 'inconnu');
  egal('L6f. casse et espaces tolérés', normaliserOrigine('  CODE '), 'code');

  const db2 = creerFirestoreFactice();
  await enregistrerLiaison(db2, { uid: 'u2', email: 'a@b.test', origine: 'root' });
  egal(
    "L6g. une origine inventée n'entre PAS en base telle quelle",
    db2._lire(COLLECTION_LIENS, 'u2')?.origine,
    'inconnu',
  );

  // ─── L7. L'e-mail ne sert jamais d'identifiant de document ───────────────
  section("L7 — l'e-mail n'entre pas dans un chemin de document");

  const cleBizarre = cleIndexEmail('a/b/c@afroboost.test');
  vrai('L7a. la clé est un SHA-256 hexadécimal', /^[0-9a-f]{64}$/.test(cleBizarre), cleBizarre);
  vrai(
    "L7b. la clé ne contient rien de l'e-mail",
    !cleBizarre.includes('afroboost') && !cleBizarre.includes('/'),
  );
  egal(
    'L7c. déterministe (même e-mail -> même clé)',
    cleIndexEmail('  Membre@Afroboost.TEST '),
    cleIndexEmail('membre@afroboost.test'),
  );
  vrai(
    'L7d. deux e-mails différents -> deux clés différentes',
    cleIndexEmail('a@x.test') !== cleIndexEmail('b@x.test'),
  );

  // ─── L8. Identité incomplète ─────────────────────────────────────────────
  section('L8 — identité incomplète : on n’écrit rien');

  const db3 = creerFirestoreFactice();
  const sansUid = await enregistrerLiaison(db3, { uid: '', email: EMAIL });
  egal('L8a. uid vide -> pas de liaison', sansUid.action, 'conflit');
  const sansEmail = await enregistrerLiaison(db3, { uid: UID, email: '   ' });
  egal('L8b. e-mail vide -> pas de liaison', sansEmail.action, 'conflit');
  egal('L8c. AUCUNE écriture, pas même un conflit', db3._ecritures().length, 0);

  // ─── Bilan ───────────────────────────────────────────────────────────────
  console.log(`\n=== ${passes} PASS / ${echecs} FAIL ===`);
  if (echecs > 0) process.exit(1);
}

principal().catch((e) => {
  console.error('banc interrompu :', e);
  process.exit(1);
});
