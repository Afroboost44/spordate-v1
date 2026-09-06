/**
 * R3b-ID — « CE COMPTE EST-IL LE PROPRIÉTAIRE DE CETTE OFFRE ? »
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA QUESTION, ET POURQUOI ELLE N'AVAIT PAS DE RÉPONSE
 * ─────────────────────────────────────────────────────────────────────────
 * R3b-1 fait traverser `proprietaire` et `proprietaireId`. Mais
 * `proprietaireId` est le `coaches.id` d'afroboost — un UUID opaque — alors
 * qu'ici une identité est un `uid` Firebase. Les deux ne se ressemblent en
 * rien, et AUCUN rapprochement par nom, e-mail, téléphone, titre d'offre ou
 * ville n'est acceptable : ce serait deviner qui possède quoi, juste avant le
 * lot qui fait payer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ON NE CRÉE PAS UN SECOND SYSTÈME DE CORRESPONDANCE
 * ─────────────────────────────────────────────────────────────────────────
 * Le LOT U2b a déjà posé la liaison persistante `bridge_identity_links/{uid}`,
 * écrite UNIQUEMENT côté serveur, à l'intérieur du pont, après vérification de
 * la signature HS256 du jeton d'afroboost, avec anti-rejeu et unicité tenue par
 * l'identifiant de document. C'est le seul canal par lequel une identité
 * afroboost est PROUVÉE ici. On s'y branche ; on n'ouvre pas une deuxième
 * porte, qui divergerait de la première au premier incident.
 *
 * Le champ lu est `afroboostPartnerId` : le `coaches.id` du partenaire, tel
 * que déclaré par afroboost dans le jeton signé. Il est aujourd'hui ABSENT de
 * toutes les liaisons — voir plus bas — et son absence signifie « non lié ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ÉTAT RÉEL MESURÉ EN PRODUCTION LE 06/09/2026 — À LIRE AVANT DE TOUCHER
 * ─────────────────────────────────────────────────────────────────────────
 *   • `coaches` côté afroboost : 1 document, et il ne porte AUCUN champ `id`
 *     (c'est la fiche de marque de l'administrateur, pas un partenaire).
 *   • `coach_auth`, `coach_subscriptions`, `partners` : 0 document.
 *   • Offres : 9, toutes `owner_type = admin`. **0 offre `partner`.**
 *   • Pont Spordate : 58 passages, mais 2 adresses distinctes seulement.
 *   • Correspondances réellement prouvables : **0**.
 *
 * Il n'existe donc AUCUN partenaire à lier. Aucune correspondance n'est
 * fabriquée ici, et il ne faut pas en fabriquer : un mapping inventé donnerait
 * à quelqu'un la propriété d'une offre qui n'est pas la sienne.
 *
 * CONSÉQUENCE ASSUMÉE : tant qu'aucun jeton ne porte de `partner_id`,
 * `resoudreProprietaireAfroboost` rend `null` et `estProprietaireDeLOffre`
 * rend `false` pour tout le monde. C'est l'état « non lié », et c'est le bon
 * défaut : fermé. Le jour où afroboost ajoutera la revendication `partner_id`
 * à son jeton, ce module la lira sans changer d'une ligne.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 * Il n'ÉCRIT rien. Il ne crée aucune collection. Il ne lit jamais le corps
 * d'une requête ni aucune valeur venue du navigateur : le seul argument
 * d'identité accepté est un `uid` que l'appelant a déjà authentifié.
 * Il ne touche à aucun Boost, aucun paiement, aucune offre.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { OffrePublique } from './offers';

/** La collection du LOT U2b. On la nomme, on ne la recrée pas. */
export const COLLECTION_LIENS = 'bridge_identity_links';

/**
 * Le `coaches.id` afroboost lié à ce compte Firebase, ou `null`.
 *
 * `null` COUVRE TOUS LES CAS D'INCERTITUDE, et c'est voulu : aucune liaison,
 * liaison sans identifiant partenaire, base injoignable, document malformé.
 * Un appelant ne peut donc pas confondre « pas lié » et « lié à rien » — les
 * deux ferment la porte de la même façon.
 *
 * NE LÈVE JAMAIS. Cette fonction sera appelée depuis un chemin de paiement :
 * une exception non attrapée y vaudrait bien pire qu'un refus.
 */
export async function resoudreProprietaireAfroboost(
  db: any,
  uid: string | null | undefined,
): Promise<string | null> {
  const identifiant = String(uid || '').trim();
  if (!identifiant) return null;
  try {
    const snap = await db.collection(COLLECTION_LIENS).doc(identifiant).get();
    if (!snap || !snap.exists) return null;
    const donnees = snap.data() || {};
    const partenaire = String(donnees.afroboostPartnerId || '').trim();
    if (!partenaire) return null;
    // Une adresse e-mail n'est PAS un identifiant de partenaire. Si une
    // liaison en portait une — écriture fautive, migration bâclée — on refuse
    // de la traiter comme un `coaches.id` plutôt que de laisser l'e-mail
    // devenir une clé de propriété par accident.
    if (partenaire.includes('@')) return null;
    return partenaire;
  } catch {
    return null;
  }
}

/**
 * LA DÉCISION, PURE. Aucune base, aucun réseau, aucune horloge.
 *
 * Isolée parce que c'est la garde qui protégera de l'argent : elle doit être
 * lisible d'un coup d'œil et éprouvable sans émulateur.
 *
 * TROIS CONDITIONS, TOUTES OBLIGATOIRES :
 *   1. l'offre se déclare `partner` — `admin` n'appartient à personne d'autre
 *      que la plateforme, `unknown` ne se décide pas ici ;
 *   2. l'offre porte un `proprietaireId` non vide ;
 *   3. cet identifiant est EXACTEMENT celui lié au compte.
 *
 * La comparaison est stricte, sur des chaînes coupées de leurs espaces. Pas de
 * casse ignorée : un UUID afroboost est recopié tel quel des deux côtés, et
 * relâcher la comparaison ne ferait qu'élargir la porte.
 */
export function estProprietaireDeLOffre(
  proprietaireAfroboost: string | null | undefined,
  offre: Pick<OffrePublique, 'proprietaire' | 'proprietaireId'> | null | undefined,
): boolean {
  if (!offre) return false;
  if (offre.proprietaire !== 'partner') return false;
  const idOffre = String(offre.proprietaireId || '').trim();
  if (!idOffre) return false;
  const idCompte = String(proprietaireAfroboost || '').trim();
  if (!idCompte) return false;
  return idCompte === idOffre;
}

/**
 * Le raccourci que les lots suivants appelleront : « ce compte possède-t-il
 * cette offre ? », résolution comprise.
 *
 * Deux fonctions plutôt qu'une seule, parce que la décision doit rester
 * testable sans base — et parce qu'un appelant qui traite plusieurs offres ne
 * doit pas relire la liaison à chaque fois.
 */
export async function possedeLOffreAfroboost(
  db: any,
  uid: string | null | undefined,
  offre: Pick<OffrePublique, 'proprietaire' | 'proprietaireId'> | null | undefined,
): Promise<boolean> {
  const proprietaire = await resoudreProprietaireAfroboost(db, uid);
  return estProprietaireDeLOffre(proprietaire, offre);
}
