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
