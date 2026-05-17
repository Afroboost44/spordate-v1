/**
 * BUG #18 — Helpers purs pour la card Discovery (image + lien profil).
 *
 *  - resolveDiscoveryCardImage : décide quel rendu utiliser dans la card photo.
 *    Avant : fallback chain photoURL → PlaceHolderImages → initial. Conséquence :
 *    pour Veldaes (real user) avec photoURL='' en Firestore, la card affichait
 *    l'image moon (placeholder mock) → trompeur. Désormais : si firestoreUid
 *    est présent (= real user Firestore), on saute le placeholder et on rend
 *    direct l'initial avatar. Placeholder réservé aux demo profiles (sans
 *    firestoreUid).
 *
 *  - buildProfileHref : construit la route /profile/{uid} si firestoreUid présent.
 *    Permet de wrap image + nom dans <Link href={...}> sans erreur si profile
 *    démo (no uid).
 *
 * @module
 */

export type DiscoveryCardImage =
  | { kind: 'photo'; src: string }
  | { kind: 'placeholder'; src: string }
  | { kind: 'initial' };

export interface ResolveCardImageInput {
  photoURL?: string | null;
  firestoreUid?: string | null;
  /** PlaceHolderImages.imageUrl si dispo (cycle discovery-1/2/3). */
  placeholderUrl?: string | null;
}

/**
 * Resolve discriminated union pour le rendu image de la card profil.
 *
 *  1. photoURL trim non-vide → 'photo' (always wins)
 *  2. firestoreUid présent (real user) → 'initial' (skip placeholder pour pas
 *     montrer une fausse photo)
 *  3. pas de uid mais placeholder dispo → 'placeholder' (demo profile)
 *  4. fallback ultime → 'initial'
 */
export function resolveDiscoveryCardImage(input: ResolveCardImageInput): DiscoveryCardImage {
  const photo = (input.photoURL ?? '').trim();
  if (photo) return { kind: 'photo', src: photo };

  if (input.firestoreUid) return { kind: 'initial' };

  const placeholder = (input.placeholderUrl ?? '').trim();
  if (placeholder) return { kind: 'placeholder', src: placeholder };

  return { kind: 'initial' };
}

/**
 * Construit la route profil pour un firestoreUid donné.
 * Retourne null si uid absent / vide / whitespace → callers évitent
 * d'envelopper dans un Link inutile.
 */
export function buildProfileHref(firestoreUid: string | null | undefined): string | null {
  const uid = (firestoreUid ?? '').trim();
  if (!uid) return null;
  return `/profile/${uid}`;
}
