/**
 * Fix #207 — Anti-régression : une vidéo uploadée avec une miniature custom
 * (frame capturée via VideoThumbnailPicker → `thumbnailUrl` sur l'item media)
 * doit être résolue par getActivityThumbnail, qu'elle soit rangée dans
 * `mediaUrls[]` OU `mediaItems[]` (les deux noms restent supportés).
 *
 * Exécution :
 *   npx tsx tests/activities/getActivityThumbnail-custom-thumb.test.ts
 *
 * Pure unit test — pas d'emulator (le helper n'a aucune dépendance runtime
 * hors ./mediaParser, lui-même sans import).
 *
 * Contexte du bug : la miniature s'affichait dans le chat invitation (qui passe
 * par le helper) mais PAS sur /activities ni /partner/offers (qui rendaient la
 * vidéo direct sans regarder thumbnailUrl). Le helper, lui, était déjà correct —
 * ce test verrouille ce contrat pour qu'il le reste.
 */

import {
  getActivityThumbnail,
  getActivityThumbnailChain,
} from '../../src/lib/activities/getActivityThumbnail';

let passes = 0;
let failures = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`✓ ${label}`);
  } else {
    failures++;
    console.error(`✗ ${label}`, detail ?? '');
  }
}

const CUSTOM_THUMB =
  'https://firebasestorage.googleapis.com/v0/b/spordate-prod.appspot.com/o/partners%2Fp1%2Factivities%2Fthumbnails%2Fthumb-123.jpg?alt=media&token=abc';
const VIDEO_URL =
  'https://firebasestorage.googleapis.com/v0/b/spordate-prod.appspot.com/o/partners%2Fp1%2Factivities%2F1700-clip.mp4?alt=media&token=xyz';

// ── T1 — custom thumbnailUrl dans mediaUrls[0] (cas réel du bug) ──
{
  const activity = {
    name: 'Silent Afroboost',
    partnerId: 'p1',
    isActive: true,
    mediaUrls: [
      { type: 'video', source: 'upload', url: VIDEO_URL, thumbnailUrl: CUSTOM_THUMB },
    ],
  };
  assert(
    getActivityThumbnail(activity) === CUSTOM_THUMB,
    'T1 — getActivityThumbnail retourne la custom thumbnailUrl (mediaUrls[0])',
    getActivityThumbnail(activity),
  );
  assert(
    getActivityThumbnailChain(activity)[0] === CUSTOM_THUMB,
    'T1 — chain[0] = custom thumbnailUrl (mediaUrls[0])',
  );
}

// ── T2 — même chose mais rangé dans mediaItems[] (l'autre nom doit marcher) ──
{
  const activity = {
    name: 'Silent Afroboost',
    partnerId: 'p1',
    mediaItems: [
      { type: 'video', source: 'upload', url: VIDEO_URL, thumbnailUrl: CUSTOM_THUMB },
    ],
  };
  assert(
    getActivityThumbnail(activity) === CUSTOM_THUMB,
    'T2 — getActivityThumbnail retourne la custom thumbnailUrl (mediaItems[0])',
    getActivityThumbnail(activity),
  );
}

// ── T3 — sans custom thumb, vidéo upload Storage seule → null (inchangé) ──
//    (le helper getActivityThumbnailMedia gère le rendu video ailleurs ; ici on
//    vérifie juste qu'on ne fabrique pas une fausse image).
{
  const activity = {
    name: 'No cover',
    partnerId: 'p1',
    mediaUrls: [{ type: 'video', source: 'upload', url: VIDEO_URL }],
  };
  assert(
    getActivityThumbnail(activity) === null,
    'T3 — vidéo upload sans thumbnailUrl → null (pas de régression)',
    getActivityThumbnail(activity),
  );
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
