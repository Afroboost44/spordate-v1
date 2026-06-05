/**
 * Anti-régression — buildProfileBlocks (réorganisation médias profil).
 *
 * Exécution : npx tsx tests/profile/profileBlocks.test.ts
 *
 * Garantit notamment le ZÉRO RÉGRESSION : un profil SANS profileBlocksOrder
 * rend les blocs dans l'ordre historique exact [photos…, audio, video].
 */

import { buildProfileBlocks } from '../../src/lib/profile/profileBlocks';

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
const ids = (b: { type: string; id: string }[]) => b.map((x) => `${x.type}:${x.id}`).join(',');

// ── T1 — fallback exact (pas d'ordre) = comportement historique ──
{
  const b = buildProfileBlocks({
    photos: ['p1', 'p2', 'p3'],
    hasAudio: true,
    hasVideo: true,
    order: undefined,
  });
  assert(
    ids(b) === 'photo:p1,photo:p2,photo:p3,audio:audio,video:video',
    'T1 — sans order → [photos…, audio, video] (zéro régression)',
    ids(b),
  );
}

// ── T2 — fallback sans audio/vidéo (uniquement photos) ──
{
  const b = buildProfileBlocks({ photos: ['p1', 'p2'], hasAudio: false, hasVideo: false });
  assert(ids(b) === 'photo:p1,photo:p2', 'T2 — sans audio/vidéo → photos seules', ids(b));
}

// ── T3 — ordre custom respecté (audio inséré entre 2 photos) ──
{
  const b = buildProfileBlocks({
    photos: ['p1', 'p2', 'p3'],
    hasAudio: true,
    hasVideo: true,
    order: [
      { type: 'photo', id: 'p1' },
      { type: 'audio', id: 'audio' },
      { type: 'photo', id: 'p2' },
      { type: 'video', id: 'video' },
      { type: 'photo', id: 'p3' },
    ],
  });
  assert(
    ids(b) === 'photo:p1,audio:audio,photo:p2,video:video,photo:p3',
    'T3 — ordre custom respecté',
    ids(b),
  );
}

// ── T4 — photo supprimée (présente dans order, absente de photos[]) ignorée ──
{
  const b = buildProfileBlocks({
    photos: ['p1', 'p3'],
    hasAudio: false,
    hasVideo: false,
    order: [
      { type: 'photo', id: 'p1' },
      { type: 'photo', id: 'p2' },
      { type: 'photo', id: 'p3' },
    ],
  });
  assert(ids(b) === 'photo:p1,photo:p3', 'T4 — photo supprimée filtrée', ids(b));
}

// ── T5 — photo ajoutée après (absente d'order) → à la fin ──
{
  const b = buildProfileBlocks({
    photos: ['p1', 'p2', 'p4'],
    hasAudio: false,
    hasVideo: false,
    order: [
      { type: 'photo', id: 'p2' },
      { type: 'photo', id: 'p1' },
    ],
  });
  assert(ids(b) === 'photo:p2,photo:p1,photo:p4', 'T5 — nouvelle photo ajoutée à la fin', ids(b));
}

// ── T6 — audio référencé dans order mais non enregistré → ignoré ──
{
  const b = buildProfileBlocks({
    photos: ['p1'],
    hasAudio: false,
    hasVideo: true,
    order: [
      { type: 'audio', id: 'audio' },
      { type: 'photo', id: 'p1' },
      { type: 'video', id: 'video' },
    ],
  });
  assert(ids(b) === 'photo:p1,video:video', 'T6 — audio absent filtré', ids(b));
}

// ── T7 — vidéo présente mais manquante dans order → ajoutée à la fin ──
{
  const b = buildProfileBlocks({
    photos: ['p1'],
    hasAudio: true,
    hasVideo: true,
    order: [
      { type: 'photo', id: 'p1' },
      { type: 'audio', id: 'audio' },
    ],
  });
  assert(ids(b) === 'photo:p1,audio:audio,video:video', 'T7 — vidéo manquante ajoutée à la fin', ids(b));
}

// ── T8 — pas de doublon si order contient un id en double ──
{
  const b = buildProfileBlocks({
    photos: ['p1', 'p2'],
    hasAudio: false,
    hasVideo: false,
    order: [
      { type: 'photo', id: 'p1' },
      { type: 'photo', id: 'p1' },
      { type: 'photo', id: 'p2' },
    ],
  });
  assert(ids(b) === 'photo:p1,photo:p2', 'T8 — déduplication', ids(b));
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
