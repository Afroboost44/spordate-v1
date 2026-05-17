/**
 * BUG #25 — Pure helper pour combiner N doc arrays (likes, passes du user
 * courant) en un Set des toUid à exclure de la stack /discovery.
 *
 * Avant ce fix : la query loadFirestoreProfiles ne filtrait QUE blocks
 * (mutual blocks) et l'opt-in partner. Les likes/passes du user n'étaient
 * pas pris en compte → les profils déjà swipés ré-apparaissaient en boucle
 * (casse la mécanique Tinder). De plus, les passes (X click) n'étaient
 * persistés nulle part — uniquement avancement local de currentIndex.
 *
 * Sémantique :
 *  - Accepte N arrays variadiques (typiquement [likesDocs, passesDocs])
 *  - Skip docs avec toUid manquant / non-string / vide / whitespace-only
 *  - Trim final pour normaliser
 *  - Set garantit dedup naturel
 *
 * @module
 */

export interface SwipedDoc {
  toUid?: string | number | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export function extractSwipedUids(
  ...sources: ReadonlyArray<readonly SwipedDoc[]>
): Set<string> {
  const set = new Set<string>();
  for (const docs of sources) {
    if (!docs) continue;
    for (const d of docs) {
      const raw = d?.toUid;
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      set.add(trimmed);
    }
  }
  return set;
}
