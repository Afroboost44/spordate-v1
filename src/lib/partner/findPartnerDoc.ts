/**
 * Fix #144 — Helper partagé pour résoudre un Partner doc Firestore.
 *
 * Résout un partnerId vers le doc partners/{docId} en suivant 3 conventions :
 *   1. Direct : partners/{partnerId} (legacy ou Activity.partnerId == Partner.docId)
 *   2. Prefix : partners/partner-{partnerId} (convention post-c33, Activity.partnerId == user.uid)
 *   3. Email fallback : users/{partnerId}.email → partners where email == X
 *
 * Retourne le `docId` (string) si trouvé, sinon `null`. Le caller peut ensuite
 * faire `db.collection('partners').doc(docId).update(...)` pour modifier le doc.
 *
 * Cohérent avec :
 *  - connectHelpers.ts findPartnerDoc (private, snap-returning version)
 *  - scripts/reset-partner-stripe.js inline version
 *
 * Réutilisé par :
 *  - webhook stripe handler.ts (in-house wallet crédit partner.balance)
 *  - autres API routes qui ont un partnerId et besoin du docId
 *
 * @module
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findPartnerDoc(db: any, partnerId: string): Promise<string | null> {
  if (!partnerId) return null;

  // 1. Direct
  const direct = await db.collection('partners').doc(partnerId).get();
  if (direct.exists) return partnerId;

  // 2. Prefix `partner-`
  const prefixedId = `partner-${partnerId}`;
  const prefixed = await db.collection('partners').doc(prefixedId).get();
  if (prefixed.exists) return prefixedId;

  // 3. Email fallback
  const userSnap = await db.collection('users').doc(partnerId).get();
  const userEmail = userSnap.exists ? (userSnap.data()?.email as string | undefined) : undefined;
  if (userEmail) {
    const q = await db
      .collection('partners')
      .where('email', '==', userEmail)
      .limit(1)
      .get();
    if (!q.empty) return q.docs[0].id as string;
  }

  return null;
}
