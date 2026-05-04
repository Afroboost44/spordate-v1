/**
 * Tests Phase 7 sub-chantier 2 commit 2/4 — Blocks service layer.
 *
 * Exécution :
 *   npm run test:blocks
 *   (équivalent : firebase emulators:exec --only firestore "npx tsx tests/blocks/service.test.ts")
 *
 * Pattern : emulator-based via @firebase/rules-unit-testing (cohérent
 * tests/reviews/service.test.ts sub-chantier 1).
 *
 * - withSecurityRulesDisabled : setup direct + appels services (rules bypass)
 * - __setBlocksDbForTesting() injecte le Firestore du test env dans les services
 *
 * Couverture B1-B15 :
 *   blockUser : succès doc-id pattern, self-block rejected, idempotent, invalid-uid
 *   unblockUser : succès delete, block-not-found
 *   isBlocked : sens A→B, sens B→A (mutuel), false sans block
 *   getBlockedByMe / getBlockingMe : tri DESC, empty edge case
 *   getMutualBlockSet : combine émis + reçus, empty edge case
 *   Cycle complet : block → unblock → re-block
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  type Firestore,
} from 'firebase/firestore';

import {
  __setBlocksDbForTesting,
  blockUser,
  BlockError,
  getBlockedByMe,
  getBlockingMe,
  getMutualBlockSet,
  isBlocked,
  makeBlockId,
  unblockUser,
} from '../../src/lib/blocks';
import type { Block } from '../../src/types/firestore';

/** Cast helper rules-unit-testing v4 (cohérent fixtures.ts Phase 6 + reviews tests). */
function asFirestore(rulesFs: unknown): Firestore {
  return rulesFs as Firestore;
}

// =====================================================================
// Mini test runner (cohérent tests/reviews/service.test.ts)
// =====================================================================

let _passes = 0;
let _failures = 0;

function assertEq<T>(actual: T, expected: T, label: string): void {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson === eJson) {
    console.log(`PASS  ${label}`);
    _passes++;
  } else {
    console.log(`FAIL  ${label}`);
    console.log(`        actual  : ${aJson}`);
    console.log(`        expected: ${eJson}`);
    _failures++;
  }
}

async function assertThrows(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<BlockError | null> {
  try {
    await fn();
    console.log(`FAIL  ${label} (expected throw "${expectedCode}", got success)`);
    _failures++;
    return null;
  } catch (err) {
    if (err instanceof BlockError && err.code === expectedCode) {
      console.log(`PASS  ${label}`);
      _passes++;
      return err;
    }
    const code = err instanceof BlockError ? err.code : (err as Error).message;
    console.log(`FAIL  ${label} (expected "${expectedCode}", got "${code}")`);
    _failures++;
    return null;
  }
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================

async function main(): Promise<void> {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-spordate-blocks',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const fbDb = asFirestore(ctx.firestore());
    __setBlocksDbForTesting(fbDb);

    // Fixtures uids (pas besoin de docs users — block est orthogonal)
    const ALICE = 'user_alice';
    const BOB = 'user_bob';
    const CHARLIE = 'user_charlie';
    const DIANE = 'user_diane';
    const EVE = 'user_eve';

    // ===================================================================
    // SECTION A — blockUser
    // ===================================================================
    section('blockUser : create + idempotent + self-block + invalid-uid');

    // B1 : blockUser succeeds → doc créé avec id ${blocker}_${blocked} + champs corrects
    {
      const result = await blockUser({ blockerId: ALICE, blockedId: BOB });
      assertEq(result.blockId, `${ALICE}_${BOB}`, 'B1 blockId == makeBlockId(blockerId, blockedId)');
      assertEq(result.alreadyBlocked, false, 'B1 alreadyBlocked=false (nouveau create)');

      // Vérif doc Firestore
      const snap = await getDoc(doc(fbDb, 'blocks', `${ALICE}_${BOB}`));
      assertEq(snap.exists(), true, 'B1 doc Firestore existe');
      const data = snap.data() as Block;
      assertEq(data.blockerId, ALICE, 'B1 doc.blockerId == ALICE');
      assertEq(data.blockedId, BOB, 'B1 doc.blockedId == BOB');
      assertEq(data.blockId, `${ALICE}_${BOB}`, 'B1 doc.blockId == doc-id pattern');
      assertEq(typeof data.createdAt?.toMillis, 'function', 'B1 doc.createdAt est un Timestamp');
    }

    // B2 : self-block rejected
    await assertThrows(
      () => blockUser({ blockerId: ALICE, blockedId: ALICE }),
      'self-block',
      'B2 self-block (blockerId == blockedId) → throw self-block',
    );

    // B3 : block idempotent (2× même call)
    {
      // Premier block (déjà fait B1) puis 2nd call
      const result2 = await blockUser({ blockerId: ALICE, blockedId: BOB });
      assertEq(result2.blockId, `${ALICE}_${BOB}`, 'B3 2nd call → même blockId');
      assertEq(result2.alreadyBlocked, true, 'B3 2nd call → alreadyBlocked=true (idempotent)');

      // Vérifier qu'aucun doc dupliqué n'a été créé
      const blockedList = await getBlockedByMe(ALICE);
      const aliceBobBlocks = blockedList.filter((b) => b.blockedId === BOB);
      assertEq(aliceBobBlocks.length, 1, 'B3 toujours 1 seul doc (pas de dup)');
    }

    // B4 : invalid-uid (empty strings)
    await assertThrows(
      () => blockUser({ blockerId: '', blockedId: BOB }),
      'invalid-uid',
      'B4a blockerId vide → throw invalid-uid',
    );
    await assertThrows(
      () => blockUser({ blockerId: ALICE, blockedId: '' }),
      'invalid-uid',
      'B4b blockedId vide → throw invalid-uid',
    );

    // ===================================================================
    // SECTION B — unblockUser
    // ===================================================================
    section('unblockUser : delete + block-not-found');

    // B5 : unblockUser succeeds → doc removed
    {
      // Setup : alice block charlie
      await blockUser({ blockerId: ALICE, blockedId: CHARLIE });
      const beforeSnap = await getDoc(doc(fbDb, 'blocks', `${ALICE}_${CHARLIE}`));
      assertEq(beforeSnap.exists(), true, 'B5 setup : doc existe avant unblock');

      await unblockUser({ blockerId: ALICE, blockedId: CHARLIE });

      const afterSnap = await getDoc(doc(fbDb, 'blocks', `${ALICE}_${CHARLIE}`));
      assertEq(afterSnap.exists(), false, 'B5 doc supprimé après unblock');
    }

    // B6 : unblockUser block-not-found
    await assertThrows(
      () => unblockUser({ blockerId: DIANE, blockedId: EVE }),
      'block-not-found',
      'B6 unblock sans block existant → throw block-not-found',
    );

    // ===================================================================
    // SECTION C — isBlocked (mutuel)
    // ===================================================================
    section('isBlocked : sens A→B, sens B→A (mutuel), false sans block');

    // B7 : isBlocked détecte sens A→B (Alice block Bob déjà fait B1)
    {
      const blocked = await isBlocked(ALICE, BOB);
      assertEq(blocked, true, 'B7 isBlocked(ALICE, BOB)=true (Alice a bloqué Bob)');
    }

    // B8 : isBlocked détecte sens B→A (mutualité — interroge ALICE↔BOB depuis le sens BOB)
    {
      const blocked = await isBlocked(BOB, ALICE);
      assertEq(blocked, true, 'B8 isBlocked(BOB, ALICE)=true (mutuel — Alice a bloqué Bob)');
    }

    // B9 : isBlocked false sans block (Diane et Eve n'ont aucun block, B5 unblock fait, B6 jamais blocké)
    {
      const blocked = await isBlocked(DIANE, EVE);
      assertEq(blocked, false, 'B9 isBlocked(DIANE, EVE)=false (aucun block)');
    }

    // ===================================================================
    // SECTION D — getBlockedByMe + getBlockingMe (listing tri DESC)
    // ===================================================================
    section('getBlockedByMe / getBlockingMe : tri DESC + empty edge case');

    // Fixture : Diane bloque 3 users à 100ms d'intervalle pour tri DESC déterministe
    await blockUser({ blockerId: DIANE, blockedId: ALICE });
    await new Promise((r) => setTimeout(r, 50));
    await blockUser({ blockerId: DIANE, blockedId: BOB });
    await new Promise((r) => setTimeout(r, 50));
    await blockUser({ blockerId: DIANE, blockedId: CHARLIE });

    // B10 : getBlockedByMe(DIANE) returns 3 blocks tri DESC (charlie, bob, alice)
    {
      const blocked = await getBlockedByMe(DIANE);
      assertEq(blocked.length, 3, 'B10 getBlockedByMe(DIANE).length == 3');
      assertEq(
        blocked.map((b) => b.blockedId),
        [CHARLIE, BOB, ALICE],
        'B10 tri DESC sur createdAt (charlie le plus récent)',
      );
    }

    // B11 : getBlockedByMe empty for user without blocks
    {
      const blocked = await getBlockedByMe(EVE);
      assertEq(blocked.length, 0, 'B11 getBlockedByMe(EVE).length == 0 (pas de blocks)');
    }

    // B12 : getBlockingMe(ALICE) returns DIANE (qui bloque Alice via fixture B10)
    //       + d'autres users si on en ajoute. Setup : seul DIANE bloque ALICE ici.
    {
      const blocking = await getBlockingMe(ALICE);
      assertEq(blocking.length, 1, 'B12 getBlockingMe(ALICE).length == 1 (Diane bloque Alice)');
      assertEq(blocking[0].blockerId, DIANE, 'B12 blocker == DIANE');
      assertEq(blocking[0].blockedId, ALICE, 'B12 blocked == ALICE');
    }

    // ===================================================================
    // SECTION E — getMutualBlockSet (combine émis + reçus)
    // ===================================================================
    section('getMutualBlockSet : combine émis + reçus + empty edge case');

    // B13 : getMutualBlockSet(ALICE) inclut BOB (alice→bob émis B1) + DIANE (diane→alice reçu B10)
    {
      const mutualSet = await getMutualBlockSet(ALICE);
      assertEq(mutualSet.has(BOB), true, 'B13a mutualSet ALICE contient BOB (émis)');
      assertEq(mutualSet.has(DIANE), true, 'B13b mutualSet ALICE contient DIANE (reçu)');
      assertEq(mutualSet.size, 2, 'B13c mutualSet ALICE size == 2');
    }

    // B14 : getMutualBlockSet empty for user without blocks
    {
      const mutualSet = await getMutualBlockSet(EVE);
      assertEq(mutualSet.size, 0, 'B14 getMutualBlockSet(EVE).size == 0 (aucun block)');
    }

    // ===================================================================
    // SECTION F — cycle complet (block → unblock → re-block)
    // ===================================================================
    section('Cycle complet : block → unblock → re-block');

    // B15 : Eve bloque Charlie, débloque, re-bloque (toutes opérations OK)
    {
      // Initial : pas de block
      const before = await isBlocked(EVE, CHARLIE);
      assertEq(before, false, 'B15a état initial : pas de block EVE↔CHARLIE');

      // Block 1
      const r1 = await blockUser({ blockerId: EVE, blockedId: CHARLIE });
      assertEq(r1.alreadyBlocked, false, 'B15b 1er block alreadyBlocked=false');
      assertEq(await isBlocked(EVE, CHARLIE), true, 'B15c isBlocked(EVE, CHARLIE)=true après 1er block');

      // Unblock
      await unblockUser({ blockerId: EVE, blockedId: CHARLIE });
      assertEq(await isBlocked(EVE, CHARLIE), false, 'B15d isBlocked=false après unblock');

      // Re-block
      const r2 = await blockUser({ blockerId: EVE, blockedId: CHARLIE });
      assertEq(r2.alreadyBlocked, false, 'B15e re-block alreadyBlocked=false (le doc avait été supprimé)');
      assertEq(await isBlocked(EVE, CHARLIE), true, 'B15f isBlocked=true après re-block');

      // Vérif idempotent du re-block
      const r3 = await blockUser({ blockerId: EVE, blockedId: CHARLIE });
      assertEq(r3.alreadyBlocked, true, 'B15g 4ème call (re-re-block) → alreadyBlocked=true');
    }
  });

  // Cleanup
  __setBlocksDbForTesting(null);
  await env.cleanup();

  console.log('');
  console.log('====== Résumé Blocks service ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
