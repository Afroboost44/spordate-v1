/**
 * BUG #14 — Helper pur pour la décision URL params côté /chat page.
 *
 * Centralise la logique du useEffect qui consomme `?match=ID&payment=success`
 * pour sélectionner automatiquement une conversation. Avant ce helper, le
 * useEffect demandait `paymentStatus === 'success' && matchIdParam` — donc
 * le flow direct-paid (/api/chat/unlock-direct → redirect `/chat?match=ID`
 * sans payment param) ne sélectionnait jamais la conv → user voit le
 * placeholder vide après avoir débité 5 crédits.
 *
 * Sémantique :
 *  - `match` seul (direct-paid)        : select + showMobile (server a déjà
 *    mis chatUnlocked:true sur le match doc dans la TX atomic).
 *  - `match` + `payment=success`       : select + unlock client-side
 *    (defense-in-depth si webhook n'a pas encore tourné) + toast paiement.
 *  - `match` absent                    : noop.
 *  - `payment=success` sans `match`    : noop (rien à sélectionner).
 *
 * @module
 */

export interface ChatUrlAction {
  /** Sélectionner cette conversation et show mobile. */
  shouldSelect: boolean;
  /** Match ID à sélectionner (null si shouldSelect=false). */
  matchId: string | null;
  /** Appeler unlockChat client-side (legacy post-payment uniquement). */
  shouldUnlock: boolean;
  /** Afficher le toast "Paiement confirmé 🎉" (legacy post-payment uniquement). */
  shouldShowPaymentToast: boolean;
}

const NOOP: ChatUrlAction = {
  shouldSelect: false,
  matchId: null,
  shouldUnlock: false,
  shouldShowPaymentToast: false,
};

/**
 * Décide l'action à prendre côté chat page à partir des searchParams URL.
 *
 * @param matchParam   `searchParams.get('match')` (peut être null/'')
 * @param paymentParam `searchParams.get('payment')` (peut être null/autre)
 */
export function resolveChatUrlAction(
  matchParam: string | null | undefined,
  paymentParam: string | null | undefined,
): ChatUrlAction {
  if (!matchParam) return NOOP;
  const isPaymentSuccess = paymentParam === 'success';
  return {
    shouldSelect: true,
    matchId: matchParam,
    shouldUnlock: isPaymentSuccess,
    shouldShowPaymentToast: isPaymentSuccess,
  };
}

// =====================================================================
// LOT D2 — L'INTENTION « PROPOSER CETTE OFFRE », PORTÉE PAR L'URL
// =====================================================================

/**
 * L'utilisateur choisit une offre depuis Discovery, puis doit peut-être passer
 * par le déverrouillage du chat avant de pouvoir écrire. Son intention doit
 * survivre à ce détour.
 *
 * ELLE VOYAGE DANS L'URL, pas dans un stockage parallèle : le parcours existant
 * revient DÉJÀ sur `/chat?match=<id>` après un déverrouillage réussi. Ajouter
 * un paramètre à cette adresse réutilise un chemin éprouvé au lieu d'en inventer
 * un second qui divergerait au premier incident.
 *
 * CE PARAMÈTRE NE FAIT AUTORITÉ SUR RIEN. Il dit seulement « la personne
 * voulait proposer cette offre ». Avant la moindre écriture, l'offre est
 * revalidée contre le catalogue et ses mises en avant (règle du LOT C), et
 * l'envoi demande une action explicite. Un identifiant fabriqué à la main dans
 * la barre d'adresse ne peut donc rien produire.
 */
export const PARAM_PROPOSER_OFFRE = 'proposer';

/** La forme d'un identifiant d'offre. Même garde que R4 : rien d'autre ne passe. */
const FORME_IDENTIFIANT_OFFRE = /^[A-Za-z0-9._~-]{1,128}$/;

/**
 * L'offre que l'utilisateur voulait proposer, ou `null`.
 *
 * PURE. `null` couvre tous les cas d'incertitude — absent, vide, forme
 * invalide — et un appelant ne peut donc pas confondre « rien demandé » et
 * « demande illisible » : les deux ne proposent rien.
 */
export function lireOffreAProposer(param: string | null | undefined): string | null {
  const valeur = String(param || '').trim();
  if (!valeur || !FORME_IDENTIFIANT_OFFRE.test(valeur)) return null;
  return valeur;
}

/** L'adresse du chat portant l'intention. Les deux valeurs sont encodées. */
export function urlChatAvecOffre(matchId: string, offreId: string): string {
  return `/chat?match=${encodeURIComponent(matchId)}&${PARAM_PROPOSER_OFFRE}=${encodeURIComponent(offreId)}`;
}
