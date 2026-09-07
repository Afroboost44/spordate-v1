/**
 * LOT A — « CE COMPTE EST-IL L'ADMINISTRATEUR AFROBOOST ? » — PREUVE SERVEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE QUESTION MÉRITE SON PROPRE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 * Le lot suivant donnera à l'administrateur le droit de mettre une offre
 * Afroboost en avant SANS RIEN PAYER. C'est un pouvoir : il doit reposer sur
 * une preuve que le navigateur ne peut pas fabriquer.
 *
 * Ce module ne remplace RIEN. Il n'est PAS le chemin des partenaires : ceux-là
 * continuent de passer par R3b-ID (`bridge_identity_links`, `afroboostPartnerId`).
 * Deux pouvoirs différents, deux preuves différentes, deux fichiers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'AUTORITÉ EXISTE DÉJÀ — ET ELLE A UNE RACINE, ET UNE DÉRIVÉE
 * ─────────────────────────────────────────────────────────────────────────
 * Aujourd'hui, une vingtaine d'endroits demandent « es-tu admin ? » en lisant
 * `users/{uid}.role === 'admin'`. Mais ce drapeau n'est pas la racine : il est
 * POSÉ par `/api/auth/admin-self-promote`, qui ne l'accorde qu'après avoir
 * confronté l'adresse du compte à `ADMIN_EMAILS` (`lib/sports.ts`) — une liste
 * centralisée, versionnée, lue côté serveur.
 *
 * LA DÉRIVÉE SEULE NE SUFFIT PAS, ET CE N'EST PAS UNE VUE DE L'ESPRIT.
 * `firestore.rules` protège `role` en MODIFICATION (il est dans
 * `onlyMutatesNonProtectedUserFields`) mais la règle de CRÉATION est
 * `allow create: if isOwner(userId)` — sans aucune contrainte de champ. Or
 * `createUser` s'exécute dans le NAVIGATEUR (`src/services/firestore.ts`).
 * Un compte dont le document `users/{uid}` n'existe pas encore peut donc le
 * créer lui-même avec `role: 'admin'`. Le même raisonnement vaut pour `email`,
 * qui est écrit là au même moment : lire l'adresse dans Firestore reviendrait
 * à demander à l'attaquant de se présenter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PREUVE RETENUE : DEUX CONDITIONS, ET AUCUNE N'EST FACULTATIVE
 * ─────────────────────────────────────────────────────────────────────────
 *   1. L'adresse du compte, lue dans **Firebase Authentication** — pas dans
 *      Firestore. C'est l'annuaire d'identité lui-même : un client ne peut ni
 *      l'écrire, ni la contourner par un document qu'il fabriquerait. On la
 *      confronte à `ADMIN_EMAILS`, la racine d'autorité déjà en place.
 *   2. `users/{uid}.role === 'admin'`, l'interrupteur OPÉRATIONNEL. Le garder
 *      permet de retirer le pouvoir en une écriture, sans redéploiement, et
 *      garde ce module cohérent avec les vingt autres gardes du projet.
 *
 * La première ferme le trou de création ; la seconde garde la révocation
 * immédiate. Aucune des deux ne se déduit de l'autre.
 *
 * L'ADRESSE N'EST PAS UN IDENTIFIANT MÉTIER ICI. Elle ne quitte jamais le
 * serveur, n'apparaît dans aucune réponse, ne désigne le propriétaire
 * d'aucune offre et ne sert à rapprocher personne de personne. Elle sert à
 * une seule chose : consulter une liste d'autorisation. C'est exactement
 * l'usage qu'en fait déjà `/api/auth/admin-self-promote`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 * Il n'écrit rien. Il ne promeut personne. Il n'ouvre aucun chemin d'achat.
 * Il ne connaît ni offre, ni mise en avant, ni argent. Il répond à une seule
 * question, par oui ou par non, et ferme la porte à la moindre incertitude.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { isAdminEmail } from '@/lib/sports';

/**
 * LA DÉCISION, PURE. Aucune base, aucun réseau.
 *
 * Isolée parce qu'elle garde un pouvoir : elle doit se lire d'un coup d'œil
 * et s'éprouver sans émulateur, y compris sur les cas hostiles.
 *
 * `emailAuthentifie` DOIT venir de Firebase Authentication. Lui passer une
 * valeur issue d'un document Firestore, ou pire du corps d'une requête,
 * viderait la garde de son sens — d'où le nom, choisi pour qu'un futur
 * appelant ne puisse pas se tromper sans le voir.
 */
export function estAdminProuve(entree: {
  emailAuthentifie?: string | null;
  roleFirestore?: string | null;
}): boolean {
  if (!isAdminEmail(entree?.emailAuthentifie)) return false;
  return String(entree?.roleFirestore || '').trim() === 'admin';
}

/**
 * La question posée à la vraie infrastructure, à partir d'un `uid` que
 * l'appelant a DÉJÀ authentifié (`verifyAuth`).
 *
 * NE LÈVE JAMAIS. Cette fonction gardera un pouvoir : une exception non
 * attrapée y vaudrait bien pire qu'un refus. Base injoignable, annuaire muet,
 * document absent, adresse vide : tout rend `false`.
 */
export async function estAdminAfroboostAutorise(uid: string | null | undefined): Promise<boolean> {
  const identifiant = String(uid || '').trim();
  if (!identifiant) return false;
  try {
    const { getAdminAuth, getAdminDb } = await import('@/lib/firebase/admin');

    // 1. L'adresse telle que l'annuaire d'identité la connaît.
    const auth = await getAdminAuth();
    const compte = await auth.getUser(identifiant);
    if (!isAdminEmail(compte?.email)) return false;

    // 2. L'interrupteur opérationnel, révocable en une écriture.
    const db = await getAdminDb();
    const snap = await db.collection('users').doc(identifiant).get();
    if (!snap || !snap.exists) return false;

    return estAdminProuve({
      emailAuthentifie: compte?.email,
      roleFirestore: (snap.data() || {}).role,
    });
  } catch {
    return false;
  }
}
