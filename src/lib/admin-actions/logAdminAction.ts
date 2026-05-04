/**
 * Phase 7 sub-chantier 5 commit 2/3 — logAdminAction.
 *
 * Write best-effort dans collection `/adminActions/{actionId}` pour audit traçabilité.
 * Doctrine §9.sexies H : conservation 24 mois.
 *
 * Pattern best-effort try/catch (cohérent sendEmail wires) :
 *  - L'action principale (moderateReview, dismissReport, etc.) ne fail JAMAIS si log fail.
 *  - Q5 décision : await synchrone + fail silencieux (log warn).
 *  - Phase 9 polish : observability + alerting si log volume drop unexpected.
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler. Le service
 * lui-même ne fait pas le check (rules + admin UI le font, et les services admin
 * appelants ont déjà fait isAdminRole check).
 */

import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { AdminActionTargetType, AdminActionType } from '@/types/firestore';
import {
  ADMIN_ACTION_TARGET_TYPES,
  ADMIN_ACTION_TYPES,
  AdminActionError,
  getAdminActionsDb,
} from './_internal';

export interface LogAdminActionInput {
  adminId: string;
  actionType: AdminActionType;
  targetType: AdminActionTargetType;
  targetId: string;
  /** Décision note motivée (optionnelle). */
  reason?: string;
  /** Champs spécifiques à l'action (ex: level pour sanction_manual_create). */
  metadata?: Record<string, unknown>;
}

export interface LogAdminActionResult {
  /** True si write réussi. False si fail silencieux. */
  ok: boolean;
  /** ID du doc créé si ok=true. */
  actionId?: string;
}

/**
 * Log best-effort. Throws AdminActionError uniquement si input invalide
 * (programmer error). Si write Firestore fail → log warn + return ok=false
 * (l'action principale ne doit pas fail à cause de l'audit).
 */
export async function logAdminAction(
  input: LogAdminActionInput,
): Promise<LogAdminActionResult> {
  // Validation inputs (programmer error, throw)
  if (!input.adminId || !input.actionType || !input.targetType || !input.targetId) {
    throw new AdminActionError('invalid-input', {
      adminId: input.adminId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
    });
  }
  if (!ADMIN_ACTION_TYPES.includes(input.actionType)) {
    throw new AdminActionError('invalid-input', {
      reason: 'unknown actionType',
      actionType: input.actionType,
    });
  }
  if (!ADMIN_ACTION_TARGET_TYPES.includes(input.targetType)) {
    throw new AdminActionError('invalid-input', {
      reason: 'unknown targetType',
      targetType: input.targetType,
    });
  }

  // Best-effort write (silent fail)
  try {
    const fbDb = getAdminActionsDb();
    const ref = doc(collection(fbDb, 'adminActions'));
    const actionId = ref.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      actionId,
      adminId: input.adminId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      createdAt: serverTimestamp(),
    };
    if (input.reason) payload.reason = input.reason;
    if (input.metadata) payload.metadata = input.metadata;

    await setDoc(ref, payload);
    return { ok: true, actionId };
  } catch (err) {
    console.warn('[logAdminAction] write failed (silent — action principale tjrs OK)', {
      adminId: input.adminId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false };
  }
}
