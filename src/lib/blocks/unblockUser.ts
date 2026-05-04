/**
 * Phase 7 sub-chantier 2 commit 2/4 — unblockUser.
 *
 * Supprime un block. Throw si le block n'existe pas. Le delete est restreint
 * au blocker via la rule firestore (defense-in-depth) ; le service ajoute un
 * check supplémentaire 'not-blocker' pour clarté des erreurs côté UI.
 *
 * Réversibilité totale (doctrine §9.sexies E).
 */

import { deleteDoc, doc, getDoc } from 'firebase/firestore';
import type { Block } from '@/types/firestore';
import { BlockError, getBlocksDb, makeBlockId } from './_internal';

export interface UnblockUserInput {
  blockerId: string;
  blockedId: string;
}

export async function unblockUser(input: UnblockUserInput): Promise<void> {
  if (!input.blockerId || !input.blockedId) {
    throw new BlockError('invalid-uid', {
      blockerId: input.blockerId,
      blockedId: input.blockedId,
    });
  }

  const blockId = makeBlockId(input.blockerId, input.blockedId);
  const fbDb = getBlocksDb();
  const ref = doc(fbDb, 'blocks', blockId);

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new BlockError('block-not-found', { blockId });
  }
  const block = snap.data() as Block;

  // Defense supplémentaire : doc tampered (blockerId ne matche pas le doc-id).
  // Avec doc-id pattern enforcé au create, ce cas ne devrait jamais arriver
  // sauf corruption manuelle Admin SDK / écriture pré-rules. Garde claire.
  if (block.blockerId !== input.blockerId) {
    throw new BlockError('not-blocker', {
      blockId,
      expectedBlockerId: input.blockerId,
      gotBlockerId: block.blockerId,
    });
  }

  await deleteDoc(ref);
}
