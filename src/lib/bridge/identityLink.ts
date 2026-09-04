/**
 * LOT U2b — LIAISON D'IDENTITÉ PERSISTANTE afroboost ↔ Spordateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME QUE CE MODULE RÉSOUT
 * ─────────────────────────────────────────────────────────────────────────
 * Le pont fonctionne : un membre afroboost arrive ici connecté. Mais LA
 * CORRESPONDANCE entre les deux identités n'était nulle part. La clé du pont
 * est l'e-mail, transporté dans un jeton de 15 minutes ; le `uid` Firebase est
 * DÉRIVÉ de cet e-mail à l'arrivée (`getUserByEmail`, sinon `createUser`) et
 * n'était jamais conservé. Une fois la session ouverte, plus rien ne disait
 * qu'un compte venait d'afroboost — ni ici, ni là-bas.
 *
 * Sans cette correspondance, aucune fusion de profil ultérieure n'est
 * implémentable de façon fiable. Ce lot NE FUSIONNE RIEN : il écrit la
 * correspondance, et s'arrête là.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LA LIAISON VIT ICI, ET PAS CÔTÉ afroboost
 * ─────────────────────────────────────────────────────────────────────────
 * Le `uid` NAÎT ici. Pour qu'afroboost le connaisse, il faudrait que Spordate
 * le lui renvoie — donc une nouvelle route d'écriture côté afroboost, un
 * secret de plus à protéger, et un appel réseau DANS LE CHEMIN CRITIQUE du
 * pont (dont la panne dégraderait une connexion qui marche aujourd'hui).
 * Trois surfaces d'attaque ajoutées pour une donnée qui est déjà, tout
 * entière, disponible ici : le `uid` vient d'être résolu, l'e-mail vient d'un
 * jeton dont la signature est vérifiée.
 *
 * On garde donc tout du même côté. Le jour où afroboost aura besoin de lire
 * cette correspondance, ce sera une route de LECTURE authentifiée, écrite
 * exprès — pas une écriture ouverte posée d'avance « au cas où ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST STOCKÉ — ET RIEN D'AUTRE
 * ─────────────────────────────────────────────────────────────────────────
 * L'identité afroboost EST l'e-mail : c'est le seul identifiant que le pont
 * transporte, et c'est la clé d'identité des deux côtés. Il n'existe pas
 * d'autre « id afroboost » à recopier.
 *
 * NE SONT COPIÉS : ni bio, ni photos, ni vidéos, ni sports, ni danses, ni
 * préférences, ni parrainage, ni Premium, ni crédits. Le mot « crédits »
 * désigne d'ailleurs deux choses opposées de part et d'autre (outil coach
 * afroboost / monnaie Sport Date) : les rapprocher serait une faute.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX DOCUMENTS, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 * Firestore ne connaît pas les contraintes d'unicité. Détecter « cet e-mail
 * est déjà lié à un AUTRE uid » exigerait donc une requête, et une requête
 * suivie d'une écriture n'est pas atomique. On tient l'unicité par le seul
 * moyen que Firestore offre vraiment : L'IDENTIFIANT DE DOCUMENT.
 *   - `bridge_identity_links/{uid}`        — la liaison, indexée par le uid
 *   - `bridge_identity_index/{emailKey}`   — l'index inverse, par l'e-mail
 * Les deux sont lus puis écrits dans UNE transaction : tout ou rien.
 *
 * L'`emailKey` est un SHA-256 de l'e-mail normalisé, pas l'e-mail lui-même.
 * Deux raisons, chacune suffisante : un e-mail peut contenir des caractères
 * interdits dans un identifiant Firestore (`/` est légal en partie locale), et
 * une donnée personnelle n'a rien à faire dans un chemin de document, que les
 * journaux et les traces d'erreur recopient sans y penser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN CONFLIT N'EST PAS UNE ERREUR — C'EST UNE INFORMATION
 * ─────────────────────────────────────────────────────────────────────────
 * Même e-mail, autre uid. Même uid, autre e-mail. Dans les deux cas : ON
 * N'ÉCRASE RIEN, on consigne dans `bridge_identity_conflicts` et on repart.
 * Écraser silencieusement reviendrait à décider tout seul laquelle des deux
 * identités est la bonne — précisément la question qu'un humain doit trancher.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACCÈS CLIENT : AUCUN
 * ─────────────────────────────────────────────────────────────────────────
 * Ces trois collections n'apparaissent pas dans `firestore.rules`, qui n'a
 * aucune règle attrape-tout : elles sont donc en refus par défaut pour tout
 * navigateur. Seul l'Admin SDK, côté serveur, y écrit — comme
 * `bridge_used_tokens`, l'anti-rejeu du pont, qui suit exactement ce modèle.
 */
import crypto from 'node:crypto';

export const COLLECTION_LIENS = 'bridge_identity_links';
export const COLLECTION_INDEX = 'bridge_identity_index';
export const COLLECTION_CONFLITS = 'bridge_identity_conflicts';

/** Par quelle porte afroboost a reconnu le membre. Descriptif, jamais un droit. */
export type OrigineLiaison = 'compte' | 'jeton_abonne' | 'code' | 'inconnu';

const ORIGINES_CONNUES: readonly string[] = ['compte', 'jeton_abonne', 'code'];

/**
 * Normalise l'origine reçue dans le jeton.
 *
 * Tout ce qui n'est pas une porte connue devient « inconnu » — y compris
 * l'absence de champ (jeton émis avant que la porte ne soit transmise). On
 * n'enregistre JAMAIS une valeur arbitraire venue du réseau telle quelle.
 */
export function normaliserOrigine(brut?: string | null): OrigineLiaison {
  const v = String(brut || '').trim().toLowerCase();
  return (ORIGINES_CONNUES.includes(v) ? v : 'inconnu') as OrigineLiaison;
}

/**
 * L'identifiant de document de l'index inverse : SHA-256 de l'e-mail normalisé.
 *
 * Déterministe (le même e-mail donne toujours la même clé, donc l'unicité
 * tient) et opaque (l'e-mail ne se retrouve pas dans un chemin de document).
 */
export function cleIndexEmail(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** Ce que porte le document de liaison. Le minimum, et rien de plus. */
export type Liaison = {
  /** Le `uid` Firebase — identité Spordateur. Aussi l'id du document. */
  spordateUid: string;
  /** L'identité afroboost : son e-mail normalisé (il n'y en a pas d'autre). */
  afroboostEmail: string;
  /** SHA-256 de `afroboostEmail` — la jointure avec l'index inverse. */
  emailKey: string;
  /** Par quelle porte afroboost avait reconnu le membre, ce jour-là. */
  origine: OrigineLiaison;
  /** Date de la liaison. Écrite UNE fois, jamais réécrite. */
  linkedAt: Date;
};

/** Ce que porte l'index inverse. Volontairement sans e-mail : il est déjà ailleurs. */
export type EntreeIndex = { spordateUid: string; linkedAt: Date };

export type ActionLiaison = 'creer' | 'inchangee' | 'conflit';

export type Decision = {
  action: ActionLiaison;
  /** Motif lisible — consigné tel quel en cas de conflit. */
  motif: string;
  /** Faut-il écrire le document de liaison ? Faux si conflit, ou s'il existe déjà. */
  ecrireLien: boolean;
  /** Faut-il écrire l'index inverse ? Idem. */
  ecrireIndex: boolean;
};

export type EtatLu = {
  /** `bridge_identity_links/{uid}` tel qu'il est en base, ou null. */
  lien: Pick<Liaison, 'afroboostEmail'> | null;
  /** `bridge_identity_index/{emailKey}` tel qu'il est en base, ou null. */
  index: Pick<EntreeIndex, 'spordateUid'> | null;
};

/**
 * LA DÉCISION, PURE. Aucune base, aucun réseau, aucune horloge.
 *
 * Elle est isolée parce que c'est la seule chose difficile de ce lot : les
 * quatre cas (créer / rien / deux conflits) doivent être éprouvables sans
 * émulateur, et lisibles d'un coup d'œil.
 *
 * L'ORDRE COMPTE : les conflits sont examinés AVANT toute écriture, et une
 * seule d'entre elles suffit à tout arrêter. On ne « répare » jamais à moitié
 * une liaison contradictoire.
 */
export function deciderLiaison(etat: EtatLu, cible: { uid: string; email: string }): Decision {
  const rien = { ecrireLien: false, ecrireIndex: false };

  // Ce uid est déjà lié à un AUTRE compte afroboost.
  if (etat.lien && etat.lien.afroboostEmail !== cible.email) {
    return { action: 'conflit', motif: 'uid_deja_lie_a_un_autre_email', ...rien };
  }

  // Cet e-mail afroboost est déjà lié à un AUTRE uid Spordateur.
  if (etat.index && etat.index.spordateUid !== cible.uid) {
    return { action: 'conflit', motif: 'email_deja_lie_a_un_autre_uid', ...rien };
  }

  // Les deux documents existent et concordent : le membre repasse simplement
  // par le pont. Aucune écriture — c'est ce qui rend l'opération idempotente,
  // et ce qui préserve la date de liaison d'origine.
  const ecrireLien = !etat.lien;
  const ecrireIndex = !etat.index;
  if (!ecrireLien && !ecrireIndex) {
    return { action: 'inchangee', motif: 'liaison_deja_presente', ...rien };
  }

  // Cas normal (première venue), et cas d'une liaison à moitié écrite qu'un
  // incident aurait laissée telle quelle : on complète ce qui manque, sans
  // toucher à ce qui existe déjà et concorde.
  return {
    action: 'creer',
    motif: etat.lien || etat.index ? 'liaison_completee' : 'liaison_nouvelle',
    ecrireLien,
    ecrireIndex,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ResultatLiaison = Decision & { uid: string; emailKey: string };

/**
 * Écrit (ou n'écrit pas) la liaison, dans UNE transaction Firestore.
 *
 * POURQUOI UNE TRANSACTION plutôt que le `create()` atomique qu'emploie
 * l'anti-rejeu du pont : `create()` protège UN document. Ici l'invariant porte
 * sur DEUX (la liaison et son index inverse), et il faut les avoir LUS pour
 * décider. La transaction verrouille les deux lectures et n'applique les
 * écritures que si rien n'a bougé entre-temps ; Firestore rejoue tout seul en
 * cas de course. Un `create()` par document laisserait au contraire la porte
 * ouverte à une liaison écrite et un index perdu.
 *
 * Toutes les lectures AVANT toutes les écritures : Firestore l'exige.
 *
 * CETTE FONCTION NE DOIT JAMAIS FAIRE ÉCHOUER LE PONT. Elle peut lever — le
 * point d'appel, lui, doit attraper : une correspondance non écrite est un
 * désagrément, une session refusée serait une panne.
 */
export async function enregistrerLiaison(
  db: any,
  params: { uid: string; email: string; origine?: string | null; maintenant?: Date },
): Promise<ResultatLiaison> {
  const uid = String(params.uid || '').trim();
  const email = String(params.email || '').trim().toLowerCase();

  // Garde de dernier recours. Le point d'appel a déjà vérifié bien davantage
  // (signature, `aud`, `iss`, expiration, anti-rejeu, uid résolu par Firebase) ;
  // ceci empêche seulement qu'un appel futur, moins prudent, n'écrive une
  // liaison creuse. Une identité inventée n'a aucun chemin jusqu'ici.
  if (!uid || !email) {
    return {
      action: 'conflit',
      motif: 'identite_incomplete',
      ecrireLien: false,
      ecrireIndex: false,
      uid,
      emailKey: '',
    };
  }

  const emailKey = cleIndexEmail(email);
  const origine = normaliserOrigine(params.origine);
  const maintenant = params.maintenant || new Date();

  const refLien = db.collection(COLLECTION_LIENS).doc(uid);
  const refIndex = db.collection(COLLECTION_INDEX).doc(emailKey);

  const decision: Decision = await db.runTransaction(async (tx: any) => {
    const [snapLien, snapIndex] = await Promise.all([tx.get(refLien), tx.get(refIndex)]);

    const d = deciderLiaison(
      {
        lien: snapLien.exists ? (snapLien.data() as Liaison) : null,
        index: snapIndex.exists ? (snapIndex.data() as EntreeIndex) : null,
      },
      { uid, email },
    );

    if (d.action === 'conflit') {
      // On consigne, et RIEN d'autre. Aucune liaison existante n'est modifiée,
      // aucune n'est supprimée : la trace s'ajoute, elle ne remplace pas.
      const refConflit = db.collection(COLLECTION_CONFLITS).doc();
      tx.set(refConflit, {
        motif: d.motif,
        spordateUidPresente: uid,
        afroboostEmailPresente: email,
        emailKey,
        spordateUidEnBase: snapIndex.exists ? (snapIndex.data() as EntreeIndex).spordateUid : null,
        afroboostEmailEnBase: snapLien.exists ? (snapLien.data() as Liaison).afroboostEmail : null,
        detectedAt: maintenant,
      });
      return d;
    }

    // `set` et non `create` : à l'intérieur d'une transaction, la lecture qui
    // précède fait foi — Firestore rejoue si le document a bougé. Et l'on
    // n'écrit QUE ce qui manque, pour ne pas réécrire une date de liaison.
    if (d.ecrireLien) {
      const liaison: Liaison = {
        spordateUid: uid,
        afroboostEmail: email,
        emailKey,
        origine,
        linkedAt: maintenant,
      };
      tx.set(refLien, liaison);
    }
    if (d.ecrireIndex) {
      const entree: EntreeIndex = { spordateUid: uid, linkedAt: maintenant };
      tx.set(refIndex, entree);
    }
    return d;
  });

  return { ...decision, uid, emailKey };
}
