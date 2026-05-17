/**
 * BUG #12 — Validation pure d'un ajustement de crédits admin.
 *
 * Avant : adjustCredits dans /admin/manage/page.tsx faisait
 *   if (!db || !creditUserId) return;
 *   const amt = parseInt(creditAmount) || 1;  // 'abc' → 1 silencieux
 *   await updateDoc(...)                       // pas de try/catch
 *
 * Conséquences :
 *  - uid vide → silent return (Bassi clique "Ajouter", rien ne se passe)
 *  - amount string invalide → silently parsed à 1 (truc inattendu)
 *  - updateDoc throw (permission, network) → silent fail (toast jamais affiché)
 *
 * Ce helper centralise la validation pour qu'adjustCredits puisse afficher
 * un toast explicite pour chaque cas d'erreur au lieu de fail silencieusement.
 *
 * @module
 */

export interface CreditAdjustmentInput {
  userId: string | undefined;
  amountStr: string;
  add: boolean;
}

export type CreditAdjustmentError = 'missing-user' | 'invalid-amount';

export type CreditAdjustmentResult =
  | { ok: true; uid: string; delta: number }
  | { ok: false; error: CreditAdjustmentError };

/**
 * Valide les inputs admin et retourne soit un delta signé prêt à passer
 * à FieldValue.increment(), soit un code d'erreur typé pour toast destructive.
 *
 * Règles :
 *  - userId non-vide (après trim) sinon 'missing-user'
 *  - amountStr → parseInt > 0 sinon 'invalid-amount' (0 et négatifs rejetés
 *    car le signe vient de `add` boolean, pas de l'input)
 *  - delta = add ? +n : -n
 */
export function validateCreditAdjustment(input: CreditAdjustmentInput): CreditAdjustmentResult {
  const uid = (input.userId ?? '').trim();
  if (!uid) {
    return { ok: false, error: 'missing-user' };
  }
  const n = parseInt(input.amountStr, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'invalid-amount' };
  }
  return { ok: true, uid, delta: input.add ? n : -n };
}
