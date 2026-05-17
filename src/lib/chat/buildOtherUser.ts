/**
 * BUG #24 — Helper pur defensif pour résoudre les infos du "other user" dans
 * la conversation list de /chat.
 *
 * Root cause originale : loadConversations (src/app/chat/page.tsx) accédait
 * `match.user1.uid` / `match.user2` directement. Les matches direct-paid
 * (créés par /api/chat/unlock-direct, fix #14) ne contiennent QUE userIds[]
 * — pas de user1/user2 embedded (legacy field pour matches mutual). En aval,
 * dès que `profile?.photoURL` était falsy (cas Veldaes : photoURL='' suite
 * BUG #18), le `||` évaluait `match.user1.uid` → TypeError → outer catch
 * swallow → conversations stays [] → "0 conversations actives" → user a
 * débité 5 crédits dans le vide (régression financière critique).
 *
 * Le helper résout l'other user dans cet ordre, avec `?.` defensive partout :
 *   1. profile fetché via getUser() (priorité)
 *   2. match.userN embedded (legacy mutual matches) — optional, ne throw plus
 *   3. defaults 'Utilisateur' + ''
 *
 * @module
 */

export interface OtherUser {
  uid: string;
  displayName: string;
  photoURL: string;
}

interface ProfileLike {
  displayName?: string | null;
  photoURL?: string | null;
}

interface MatchUserLike {
  uid: string;
  displayName?: string | null;
  photoURL?: string | null;
}

interface MatchLike {
  user1?: MatchUserLike | null;
  user2?: MatchUserLike | null;
}

export function buildOtherUser(
  profile: ProfileLike | null | undefined,
  match: MatchLike,
  otherUid: string,
): OtherUser {
  // Priority 1 — profile fetched fresh from users/
  const profileDisplay = profile?.displayName ?? '';
  const profilePhoto = profile?.photoURL ?? '';

  // Priority 2 — embedded user1/user2 cached on the match (legacy mutual matches).
  // Defensive `?.` — match.userN absent (direct-paid match) → undefined chain → no throw.
  const embeddedDisplay = match.user1?.uid === otherUid
    ? match.user1?.displayName ?? ''
    : match.user2?.displayName ?? '';
  const embeddedPhoto = match.user1?.uid === otherUid
    ? match.user1?.photoURL ?? ''
    : match.user2?.photoURL ?? '';

  return {
    uid: otherUid,
    displayName: profileDisplay || embeddedDisplay || 'Utilisateur',
    photoURL: profilePhoto || embeddedPhoto || '',
  };
}
