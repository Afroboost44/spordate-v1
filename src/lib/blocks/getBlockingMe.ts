/**
 * Phase 7 sub-chantier 2 commit 2/4 — getBlockingMe.
 *
 * Liste les blocks reçus par un user (les users qui l'ont bloqué). Utilisé
 * par getMutualBlockSet pour appliquer côté client la doctrine §9.sexies E
 * "invisibilité mutuelle" sans notifier le bloqué.
 *
 * Tri DESC sur createdAt. Index composite `blockedId+createdAt DESC` requis
 * (déclaré firestore.indexes.json commit 1/4).
 */

import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type { Block } from '@/types/firestore';
import { getBlocksDb } from './_internal';

export async function getBlockingMe(uid: string): Promise<Block[]> {
  if (!uid) return [];
  const fbDb = getBlocksDb();
  try {
    const q = query(
      collection(fbDb, 'blocks'),
      where('blockedId', '==', uid),
      orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Block);
  } catch (err) {
    console.warn('[getBlockingMe] Index not ready, fallback without orderBy:', err);
    const q = query(collection(fbDb, 'blocks'), where('blockedId', '==', uid));
    const snap = await getDocs(q);
    const results = snap.docs.map((d) => d.data() as Block);
    results.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });
    return results;
  }
}
