/**
 * Phase 7 sub-chantier 2 commit 2/4 — blockUser.
 *
 * Crée un block d'un user vers un autre. Idempotent : si le block existe déjà,
 * retourne early sans erreur (alreadyBlocked=true). Anti-self-block enforcé service
 * + rule (defense-in-depth).
 *
 * Doc-id pattern : `${blockerId}_${blockedId}` — déduplication garantie au niveau
 * doc-id (cohérent firestore.rules section /blocks/).
 *
 * Pas de notification au bloqué (doctrine §9.sexies E "anti-confrontation").
 */

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { BlockError, getBlocksDb, makeBlockId } from './_internal';

export interface BlockUserInput {
  blockerId: string;
  blockedId: string;
}

export interface BlockUserResult {
  blockId: string;
  /** True si le block existait déjà (no-op idempotent). False si nouveau create. */
  alreadyBlocked: boolean;
}

export async function blockUser(input: BlockUserInput): Promise<BlockUserResult> {
  if (!input.blockerId || !input.blockedId) {
    throw new BlockError('invalid-uid', {
      blockerId: input.blockerId,
      blockedId: input.blockedId,
    });
  }
  if (input.blockerId === input.blockedId) {
    throw new BlockError('self-block', { uid: input.blockerId });
  }

  const blockId = makeBlockId(input.blockerId, input.blockedId);
  const fbDb = getBlocksDb();
  const ref = doc(fbDb, 'blocks', blockId);

  // Idempotent : check existence avant create (la rule update=false interdirait
  // un overwrite en prod, donc check local évite le throw permission-denied).
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { blockId, alreadyBlocked: true };
  }

  await setDoc(ref, {
    blockId,
    blockerId: input.blockerId,
    blockedId: input.blockedId,
    createdAt: serverTimestamp(),
  });

  return { blockId, alreadyBlocked: false };
}
