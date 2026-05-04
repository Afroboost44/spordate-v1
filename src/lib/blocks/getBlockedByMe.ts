/**
 * Phase 7 sub-chantier 2 commit 2/4 — getBlockedByMe.
 *
 * Liste les blocks émis par un user (ses bloqués). Utilisé par l'écran
 * /profile/blocks pour afficher la liste avec bouton "Débloquer".
 *
 * Tri DESC sur createdAt (plus récents d'abord). Index composite
 * `blockerId+createdAt DESC` requis (déclaré firestore.indexes.json commit 1/4).
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

export async function getBlockedByMe(uid: string): Promise<Block[]> {
  if (!uid) return [];
  const fbDb = getBlocksDb();
  try {
    const q = query(
      collection(fbDb, 'blocks'),
      where('blockerId', '==', uid),
      orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Block);
  } catch (err) {
    console.warn('[getBlockedByMe] Index not ready, fallback without orderBy:', err);
    const q = query(collection(fbDb, 'blocks'), where('blockerId', '==', uid));
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
