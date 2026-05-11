/**
 * Phase 9.5 c39 — Dedupe matches/ legacy (auto-id) → deterministic ID.
 *
 * Contexte (audit Bug C) : avant c39, /api/chat/unlock-direct créait un doc
 * matches/ avec auto-id. Sur re-click, l'idempotence query trouvait l'existing
 * mais pouvait rater + créer un nouveau doc → doublons. Bassi a vu "8x la
 * même conversation Artboost Association" sur /chat.
 *
 * c39 a switché à des deterministic IDs (`${sortedUids[0]}_${sortedUids[1]}`)
 * → plus jamais de doublons possibles. Mais les docs LEGACY auto-id existent
 * encore en prod et doivent être nettoyés.
 *
 * Stratégie :
 *  1. Read all matches/
 *  2. Grouper par canonical pair key = sorted(userIds).join('_')
 *  3. Pour chaque groupe :
 *     - Si 1 seul doc → skip (déjà unique)
 *     - Sinon : choisir le doc "à garder" :
 *       a. PRIORITÉ : doc dont id === canonicalPairKey (déterministe c39)
 *       b. Sinon : doc avec chatUnlocked === true le plus récent
 *       c. Sinon : doc le plus récent (createdAt desc)
 *     - Si le doc gardé n'a PAS l'ID déterministe → copier ses data vers
 *       matches/{deterministicId} + delete l'original
 *     - Delete tous les autres docs du groupe
 *
 * Limitation : les messages subcollection sous les docs supprimés deviennent
 * orphelins (Firestore ne cascade pas). Acceptable car flow direct-paid était
 * cassé donc aucun message réel n'a pu être envoyé (banner verrouillé).
 */

export interface DedupeResult {
  dryRun: boolean;
  totalScanned: number;
  totalGroups: number;
  totalKept: number;
  totalDeleted: number;
  totalMigrated: number; // count of docs copied to deterministic ID
  errors: Array<{ matchId: string; reason: string }>;
}

// Type minimal pour ne pas dépendre du SDK admin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminFirestore = any;

export async function dedupeMatches(
  adminDb: AdminFirestore,
  options: { dryRun: boolean } = { dryRun: true },
): Promise<DedupeResult> {
  const result: DedupeResult = {
    dryRun: options.dryRun,
    totalScanned: 0,
    totalGroups: 0,
    totalKept: 0,
    totalDeleted: 0,
    totalMigrated: 0,
    errors: [],
  };

  const snap = await adminDb.collection('matches').get();
  result.totalScanned = snap.size;

  // Group by canonical pair key.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = new Map<string, any[]>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const userIds = data?.userIds as string[] | undefined;
    if (!userIds || userIds.length !== 2) {
      result.errors.push({
        matchId: doc.id,
        reason: `userIds invalide (${JSON.stringify(userIds)})`,
      });
      continue;
    }
    const canonical = [...userIds].sort().join('_');
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical)!.push(doc);
  }
  result.totalGroups = groups.size;

  for (const [canonical, docs] of groups.entries()) {
    if (docs.length === 1) {
      // Singleton — check if it has the deterministic ID format. If not,
      // migrate it. Sinon, skip.
      const doc = docs[0];
      if (doc.id === canonical) {
        result.totalKept++;
        continue;
      }
      // Singleton mais ID non-canonique → migrer.
      if (!options.dryRun) {
        const data = doc.data();
        await adminDb.collection('matches').doc(canonical).set({ ...data, matchId: canonical });
        await doc.ref.delete();
      }
      result.totalKept++;
      result.totalMigrated++;
      result.totalDeleted++;
      continue;
    }

    // Multiple docs same pair → dedupe.
    // 1. Préférer celui avec ID déterministe s'il existe
    // 2. Sinon préférer chatUnlocked === true + plus récent createdAt
    // 3. Sinon le plus récent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedDocs = [...docs].sort((a: any, b: any) => {
      const aIsDeterministic = a.id === canonical ? 1 : 0;
      const bIsDeterministic = b.id === canonical ? 1 : 0;
      if (aIsDeterministic !== bIsDeterministic) return bIsDeterministic - aIsDeterministic;
      const aUnlocked = a.data().chatUnlocked ? 1 : 0;
      const bUnlocked = b.data().chatUnlocked ? 1 : 0;
      if (aUnlocked !== bUnlocked) return bUnlocked - aUnlocked;
      const aTs = a.data().createdAt?.toMillis?.() ?? 0;
      const bTs = b.data().createdAt?.toMillis?.() ?? 0;
      return bTs - aTs; // most recent first
    });

    const winner = sortedDocs[0];
    const losers = sortedDocs.slice(1);

    if (!options.dryRun) {
      // Si winner n'a pas l'ID déterministe, migrer vers matches/{canonical}.
      if (winner.id !== canonical) {
        const data = winner.data();
        await adminDb.collection('matches').doc(canonical).set({
          ...data,
          matchId: canonical,
          chatUnlocked: true, // force au passage
        });
        await winner.ref.delete();
        result.totalMigrated++;
      } else if (!winner.data().chatUnlocked) {
        await winner.ref.update({ chatUnlocked: true });
      }
      // Delete tous les losers.
      for (const loser of losers) {
        await loser.ref.delete();
      }
    }
    result.totalKept++;
    result.totalDeleted += losers.length + (winner.id !== canonical ? 1 : 0);
  }

  return result;
}
