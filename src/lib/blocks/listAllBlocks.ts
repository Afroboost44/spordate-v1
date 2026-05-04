/**
 * Phase 7 sub-chantier 4 commit 1/4 — listAllBlocks (admin audit).
 *
 * Liste paginée tous les blocks (admin only via UI gating).
 * Utilisé pour audit T&S — visualiser la liste complète des blocks actifs.
 *
 * Index requis : blockerId+createdAt OR blockedId+createdAt déjà déclaré.
 * Pour Phase 7 MVP : query simple ordered by createdAt DESC, limit configurable.
 *
 * ⚠️ Caller responsibility : vérifier rôle admin avant d'appeler.
 *    La rule firestore /blocks/ permet read uniquement pour blocker/blocked,
 *    PAS admin (cohérent doctrine §E "anti-confrontation"). Cette fonction
 *    nécessitera donc un endpoint Admin SDK Phase 8 OU rule extension.
 *    Phase 7 : utilisable uniquement en context test (security disabled) ou
 *    via firebase-admin SDK côté serveur (admin dashboard endpoint Phase 8).
 */

import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
} from 'firebase/firestore';
import type { Block } from '@/types/firestore';
import { getBlocksDb } from './_internal';

export interface ListAllBlocksOptions {
  /** Max docs retournés. Défaut 50. */
  limit?: number;
}

export async function listAllBlocks(opts: ListAllBlocksOptions = {}): Promise<Block[]> {
  const fbDb = getBlocksDb();
  const lim = opts.limit ?? 50;

  try {
    const snap = await getDocs(
      query(collection(fbDb, 'blocks'), orderBy('createdAt', 'desc'), fbLimit(lim)),
    );
    return snap.docs.map((d) => d.data() as Block);
  } catch (err) {
    console.warn('[listAllBlocks] orderBy failed, fallback unsorted:', err);
    const snap = await getDocs(query(collection(fbDb, 'blocks'), fbLimit(lim)));
    return snap.docs.map((d) => d.data() as Block);
  }
}
