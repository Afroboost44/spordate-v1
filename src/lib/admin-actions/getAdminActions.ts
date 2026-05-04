/**
 * Phase 7 sub-chantier 5 commit 2/3 — getAdminActions.
 *
 * Query options Phase 7 (Q6) :
 *  - Par adminId : history admin (audit perso)
 *  - Par targetType+targetId : audit per resource (qui a touché ce report/sanction/review)
 *  - Par actionType : queue par type d'action (ex: tous les reviews_publish récents)
 *
 * Index requis (déclaré commit 2/3) :
 *  - adminId+createdAt DESC
 *  - targetType+targetId+createdAt DESC
 *  - actionType+createdAt DESC
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler (rule firestore
 * /adminActions/ read est admin-only via isAdmin()).
 */

import {
  Timestamp,
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type { AdminAction, AdminActionTargetType, AdminActionType } from '@/types/firestore';
import { getAdminActionsDb } from './_internal';

export interface GetAdminActionsOptions {
  /** Filter par admin uid. */
  adminId?: string;
  /** Filter par target (review/report/sanction) — requiert targetId aussi. */
  targetType?: AdminActionTargetType;
  /** Filter par target ID — requiert targetType aussi. */
  targetId?: string;
  /** Filter par action type. */
  actionType?: AdminActionType;
  /** Window rolling jours. Défaut undefined = full history. */
  rollingDays?: number;
  /** Max docs retournés. Défaut 100. */
  limit?: number;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export async function getAdminActions(
  opts: GetAdminActionsOptions = {},
): Promise<AdminAction[]> {
  const fbDb = getAdminActionsDb();
  const lim = opts.limit ?? 100;
  const now = opts.now ?? new Date();

  const constraints: Parameters<typeof query>[1][] = [];

  if (opts.adminId) {
    constraints.push(where('adminId', '==', opts.adminId));
  }
  if (opts.targetType && opts.targetId) {
    constraints.push(where('targetType', '==', opts.targetType));
    constraints.push(where('targetId', '==', opts.targetId));
  }
  if (opts.actionType) {
    constraints.push(where('actionType', '==', opts.actionType));
  }
  if (opts.rollingDays !== undefined) {
    const cutoff = Timestamp.fromMillis(now.getTime() - opts.rollingDays * 24 * 60 * 60 * 1000);
    constraints.push(where('createdAt', '>=', cutoff));
  }

  try {
    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(fbLimit(lim));
    const snap = await getDocs(query(collection(fbDb, 'adminActions'), ...constraints));
    return snap.docs.map((d) => d.data() as AdminAction);
  } catch (err) {
    console.warn('[getAdminActions] Index not ready, fallback unsorted:', err);
    // Drop orderBy + limit, refilter client-side
    const fallbackConstraints = constraints.filter(
      (c) => !(c as { type?: string }).type || (c as { type?: string }).type === 'where',
    );
    const snap = await getDocs(
      query(collection(fbDb, 'adminActions'), ...fallbackConstraints, fbLimit(lim)),
    );
    const results = snap.docs.map((d) => d.data() as AdminAction);
    results.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });
    return results;
  }
}
