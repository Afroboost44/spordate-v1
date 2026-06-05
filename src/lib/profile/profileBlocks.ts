/**
 * Réorganisation des médias profil — modèle d'ordre des blocs (additif).
 *
 * Un "bloc" = une photo, l'accroche audio, ou l'accroche vidéo. L'utilisateur
 * peut réordonner librement ces blocs (drag-and-drop). L'ordre est persisté
 * dans `User.profileBlocksOrder` et appliqué partout où le profil est affiché.
 *
 * ZÉRO RÉGRESSION : si `profileBlocksOrder` est absent (anciens users), le
 * fallback reproduit EXACTEMENT l'ordre historique :
 *   [photo1, photo2, …, audio, video]
 *
 * `buildProfileBlocks()` est pur (testé dans tests/profile/profileBlocks.test.ts).
 */

export type ProfileBlockType = 'photo' | 'audio' | 'video';

export interface ProfileBlock {
  type: ProfileBlockType;
  /** Photo → URL ; audio → 'audio' ; video → 'video'. */
  id: string;
}

export interface BuildProfileBlocksInput {
  /** Photos dans leur ordre `photos[]` actuel (déjà la source de vérité). */
  photos: string[];
  hasAudio: boolean;
  hasVideo: boolean;
  /** Ordre persisté (User.profileBlocksOrder). Absent → fallback historique. */
  order?: ReadonlyArray<{ type: ProfileBlockType; id: string }> | null;
}

/**
 * Construit la liste ordonnée des blocs médias à afficher.
 *
 * Règles :
 *  - order absent/vide → [..photos, audio?, video?] (ordre historique exact).
 *  - order présent → respecté, MAIS :
 *      · une photo de `order` absente de `photos[]` (supprimée) est ignorée,
 *      · une photo de `photos[]` absente de `order` (ajoutée après) est
 *        ajoutée à la fin (ordre photos[]),
 *      · audio/video absents (non enregistrés) sont ignorés,
 *      · audio/video présents mais manquants dans `order` sont ajoutés à la fin,
 *      · pas de doublon.
 */
export function buildProfileBlocks(input: BuildProfileBlocksInput): ProfileBlock[] {
  const { photos, hasAudio, hasVideo, order } = input;
  const photoList = photos.filter((p) => typeof p === 'string' && p.length > 0);
  const photoSet = new Set(photoList);

  // Fallback historique exact.
  if (!Array.isArray(order) || order.length === 0) {
    const blocks: ProfileBlock[] = photoList.map((p) => ({ type: 'photo', id: p }));
    if (hasAudio) blocks.push({ type: 'audio', id: 'audio' });
    if (hasVideo) blocks.push({ type: 'video', id: 'video' });
    return blocks;
  }

  const blocks: ProfileBlock[] = [];
  const usedPhotos = new Set<string>();
  let usedAudio = false;
  let usedVideo = false;

  for (const b of order) {
    if (b.type === 'photo') {
      if (photoSet.has(b.id) && !usedPhotos.has(b.id)) {
        usedPhotos.add(b.id);
        blocks.push({ type: 'photo', id: b.id });
      }
    } else if (b.type === 'audio') {
      if (hasAudio && !usedAudio) {
        usedAudio = true;
        blocks.push({ type: 'audio', id: 'audio' });
      }
    } else if (b.type === 'video') {
      if (hasVideo && !usedVideo) {
        usedVideo = true;
        blocks.push({ type: 'video', id: 'video' });
      }
    }
  }

  // Photos ajoutées après la dernière sauvegarde d'ordre → à la fin.
  for (const p of photoList) {
    if (!usedPhotos.has(p)) {
      usedPhotos.add(p);
      blocks.push({ type: 'photo', id: p });
    }
  }
  // Médias présents mais absents de l'ordre → à la fin.
  if (hasAudio && !usedAudio) blocks.push({ type: 'audio', id: 'audio' });
  if (hasVideo && !usedVideo) blocks.push({ type: 'video', id: 'video' });

  return blocks;
}
