/**
 * Phase 7 sub-chantier 2 commit 2/4 — isBlocked.
 *
 * Vérifie l'existence d'un block dans l'un OU l'autre sens (mutuel) entre 2 users.
 * Doctrine §9.sexies E : invisibilité mutuelle — A bloque B implique B ne voit pas A
 * non plus. Donc le check filter UI doit considérer les 2 sens.
 *
 * Optimisation : 2 getDoc en parallèle, pas de query.
 */

import { doc, getDoc } from 'firebase/firestore';
import { getBlocksDb, makeBlockId } from './_internal';

export async function isBlocked(uidA: string, uidB: string): Promise<boolean> {
  if (!uidA || !uidB) return false;
  if (uidA === uidB) return false;

  const fbDb = getBlocksDb();
  const refAB = doc(fbDb, 'blocks', makeBlockId(uidA, uidB));
  const refBA = doc(fbDb, 'blocks', makeBlockId(uidB, uidA));
  const [snapAB, snapBA] = await Promise.all([getDoc(refAB), getDoc(refBA)]);
  return snapAB.exists() || snapBA.exists();
}
