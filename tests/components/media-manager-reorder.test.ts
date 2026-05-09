/**
 * Tests Phase 9.5 c8 BUG 3 — MediaManager stable ids + reorder semantics.
 *
 * Exécution :
 *   npm run test:components:media-manager-reorder
 *
 * Pattern : pure unit (no emulator, no DOM). Tests focus on la logique pure
 * de derivation des ids stables ET le comportement arrayMove qui doit conserver
 * les refs items après reorder.
 *
 * Couverture (3 cas MR1-MR3) :
 *   MR1. computeItemIds : ids stables tied à item.url+source (pas à index)
 *        → reorder array → ids restent identiques per item, juste réordonnés
 *   MR2. arrayMove preserve les refs items (utilisé par dnd-kit pour identité)
 *   MR3. Duplicate URL+source → suffix #2, #3 dédup
 */

import { arrayMove } from '@dnd-kit/sortable';
import type { MediaItem } from '../../src/types/firestore';

let _passes = 0;
let _failures = 0;

function pass(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function fail(label: string, info?: unknown): void {
  console.log(`FAIL  ${label}`, info ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// Réplique exactement le useMemo dans MediaManager.tsx (Phase 9.5 c8 BUG 3 fix).
// Si la logique change side-by-side, les tests doivent refléter (et faillir).
function computeItemIds(value: MediaItem[]): string[] {
  const seen = new Map<string, number>();
  return value.map((item) => {
    const base = `${item.source}__${item.url}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
}

function main(): void {
  // ===================================================================
  // MR1 — ids stables après reorder
  // ===================================================================
  section('MR1 stable ids tied to url+source (pas index) → survive reorder');
  {
    const a: MediaItem = { url: 'https://a.jpg', type: 'image', source: 'url' };
    const b: MediaItem = { url: 'https://b.jpg', type: 'image', source: 'url' };
    const c: MediaItem = { url: 'https://c.jpg', type: 'image', source: 'upload' };
    const items = [a, b, c];

    const idsBefore = computeItemIds(items);
    const idA = idsBefore[0];
    const idB = idsBefore[1];
    const idC = idsBefore[2];

    // Reorder : déplace a (idx 0) → idx 2 → résultat [b, c, a]
    const reordered = arrayMove(items, 0, 2);
    const idsAfter = computeItemIds(reordered);

    if (idsAfter[0] === idB && idsAfter[1] === idC && idsAfter[2] === idA) {
      pass('MR1 ids per item conservés après arrayMove (juste réordonnés)');
    } else {
      fail('MR1', { idsBefore, idsAfter });
    }
  }

  // ===================================================================
  // MR2 — arrayMove preserve item refs
  // ===================================================================
  section('MR2 arrayMove preserve item references (dnd-kit identity contract)');
  {
    const a: MediaItem = { url: 'https://a.jpg', type: 'image', source: 'url' };
    const b: MediaItem = { url: 'https://b.jpg', type: 'image', source: 'url' };
    const items = [a, b];
    const reordered = arrayMove(items, 0, 1);

    if (reordered[0] === b && reordered[1] === a) {
      pass('MR2 reordered[0]===b && reordered[1]===a (refs préservées)');
    } else {
      fail('MR2 refs not preserved', { reordered });
    }
  }

  // ===================================================================
  // MR3 — duplicate dédup via suffix #N
  // ===================================================================
  section('MR3 dédup duplicate URL+source via #2, #3');
  {
    const a1: MediaItem = { url: 'https://dup.jpg', type: 'image', source: 'url' };
    const a2: MediaItem = { url: 'https://dup.jpg', type: 'image', source: 'url' };
    const a3: MediaItem = { url: 'https://dup.jpg', type: 'image', source: 'url' };
    const ids = computeItemIds([a1, a2, a3]);

    const expected = [
      'url__https://dup.jpg',
      'url__https://dup.jpg#2',
      'url__https://dup.jpg#3',
    ];
    if (
      ids[0] === expected[0] &&
      ids[1] === expected[1] &&
      ids[2] === expected[2]
    ) {
      pass('MR3.a 3× duplicate URLs → ids uniques avec suffix #2, #3');
    } else {
      fail('MR3.a', { ids, expected });
    }

    // Différents source = ids différents même URL
    const sameUrlDiffSource: MediaItem[] = [
      { url: 'https://x.jpg', type: 'image', source: 'url' },
      { url: 'https://x.jpg', type: 'image', source: 'upload' },
    ];
    const ids2 = computeItemIds(sameUrlDiffSource);
    if (ids2[0] !== ids2[1] && ids2[0].startsWith('url__') && ids2[1].startsWith('upload__')) {
      pass('MR3.b même URL mais source différent → ids distincts (no collision)');
    } else {
      fail('MR3.b', ids2);
    }
  }

  console.log('');
  console.log('====== Résumé MediaManager Reorder (MR1-MR3) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main();
