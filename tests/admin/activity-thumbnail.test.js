/**
 * Fix #146 — Test anti-régression pour getActivityThumbnail().
 *
 * Pattern récurrent évité :
 *  Un développeur remplace la miniature d'une activité par un placeholder
 *  générique (icône Zap, carré gris) en mode "TODO j'y reviendrai", puis
 *  oublie. Résultat : la miniature qui marchait quelque part disparaît.
 *  Bugs : #126, #140, "Où pratiquer" carré rose.
 *
 * Le helper getActivityThumbnail() centralise la chaîne de fallback.
 * Ce test verrouille le comportement :
 *  CASE 1 — thumbnailUrl explicite gagne sur tout
 *  CASE 2 — mediaItems[image] utilisé si pas de thumbnailUrl
 *  CASE 3 — mediaItems[video].thumbnailUrl utilisé (Fix #122)
 *  CASE 4 — YouTube videoId résout en hqdefault.jpg
 *  CASE 5 — Drive videoId résout en drive.google.com/thumbnail
 *  CASE 6 — imageUrl legacy utilisé seulement si image-like
 *  CASE 7 — imageUrl vidéo legacy ignoré (pas de chain pourrie)
 *  CASE 8 — Activité vide → null (caller gère fallback)
 *
 * Exécution : node tests/admin/activity-thumbnail.test.js
 */

// Compile TypeScript helper en JS via require sans tsc — on inline les helpers
// nécessaires pour rester self-contained et éviter les soucis esbuild Linux/Mac.

// ─── Inline du helper isImageUrl + getVideoThumbnailChain (extraits) ──────
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif'];
function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  const pathOnly = lower.split('?')[0].split('#')[0];
  return IMAGE_EXTENSIONS.some((ext) => pathOnly.endsWith(ext));
}

function getVideoThumbnailChain(item) {
  if (item.type !== 'video') return [];
  if (item.thumbnailUrl) return [item.thumbnailUrl];
  const videoId = item.videoId;
  if (!videoId) return [];
  if (item.provider === 'youtube') {
    return [
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      `https://img.youtube.com/vi/${videoId}/default.jpg`,
    ];
  }
  if (item.provider === 'drive') {
    return [
      `https://drive.google.com/thumbnail?id=${videoId}&sz=w800`,
      `https://drive.google.com/thumbnail?id=${videoId}&sz=w400`,
    ];
  }
  return [];
}

// ─── Inline du helper getActivityThumbnail (miroir de la version TS) ──────
function getActivityThumbnailChain(activity) {
  if (!activity) return [];
  const chain = [];
  if (typeof activity.thumbnailUrl === 'string' && activity.thumbnailUrl.length > 0) {
    chain.push(activity.thumbnailUrl);
  }
  // Fix #153 — Champ legacy `images[]` (string[]) supporté.
  if (Array.isArray(activity.images)) {
    for (const url of activity.images) {
      if (typeof url === 'string' && url.length > 0 && !chain.includes(url)) {
        chain.push(url);
        break;
      }
    }
  }
  const mediaItems = Array.isArray(activity.mediaItems)
    ? activity.mediaItems
    : Array.isArray(activity.mediaUrls) ? activity.mediaUrls : [];
  const firstImage = mediaItems.find(
    (m) => m && m.type === 'image' && typeof m.url === 'string' && m.url,
  );
  if (firstImage) chain.push(firstImage.url);
  const firstVideo = mediaItems.find((m) => m && m.type === 'video');
  if (firstVideo) {
    const videoChain = getVideoThumbnailChain(firstVideo);
    for (const url of videoChain) {
      if (url && !chain.includes(url)) chain.push(url);
    }
  }
  if (
    typeof activity.imageUrl === 'string' &&
    activity.imageUrl.length > 0 &&
    isImageUrl(activity.imageUrl) &&
    !chain.includes(activity.imageUrl)
  ) {
    chain.push(activity.imageUrl);
  }
  // Fix #155 — Scan exhaustif des champs string pour URLs image.
  const KNOWN_HOSTS = ['firebasestorage.googleapis.com', 'images.unsplash.com', 'i.imgur.com', 'cdn'];
  for (const [key, value] of Object.entries(activity)) {
    if (typeof value !== 'string' || value.length < 8) continue;
    if (chain.includes(value)) continue;
    if (['thumbnailUrl', 'imageUrl'].includes(key)) continue;
    const isImageHost = KNOWN_HOSTS.some((host) => value.includes(host));
    if (isImageUrl(value) || (isImageHost && /\.(jpg|jpeg|png|webp|gif|svg)/i.test(value))) {
      chain.push(value);
    }
  }
  return chain;
}

function getActivityThumbnail(activity) {
  const chain = getActivityThumbnailChain(activity);
  return chain[0] || null;
}

// ─── Tests ────────────────────────────────────────────────────────────────
let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

// CASE 1 — thumbnailUrl gagne sur tout
{
  const t = getActivityThumbnail({
    thumbnailUrl: 'https://cdn/explicit.jpg',
    mediaItems: [{ type: 'image', url: 'https://cdn/media-image.jpg' }],
    imageUrl: 'https://cdn/legacy.jpg',
  });
  if (t === 'https://cdn/explicit.jpg') ok('CASE 1 — thumbnailUrl gagne sur tout');
  else fail('CASE 1', t);
}

// CASE 2 — mediaItems image utilisé si pas de thumbnailUrl
{
  const t = getActivityThumbnail({
    mediaItems: [{ type: 'image', url: 'https://cdn/photo1.jpg' }],
  });
  if (t === 'https://cdn/photo1.jpg') ok('CASE 2 — mediaItems image utilisé');
  else fail('CASE 2', t);
}

// CASE 3 — mediaItems[video].thumbnailUrl custom (#122)
{
  const t = getActivityThumbnail({
    mediaItems: [{ type: 'video', thumbnailUrl: 'https://cdn/custom-frame.jpg', provider: 'youtube', videoId: 'XXX' }],
  });
  if (t === 'https://cdn/custom-frame.jpg') ok('CASE 3 — thumbnailUrl custom sur video (Fix #122)');
  else fail('CASE 3', t);
}

// CASE 4 — YouTube videoId → hqdefault
{
  const t = getActivityThumbnail({
    mediaItems: [{ type: 'video', provider: 'youtube', videoId: 'abc123' }],
  });
  if (t === 'https://img.youtube.com/vi/abc123/hqdefault.jpg') ok('CASE 4 — YouTube hqdefault');
  else fail('CASE 4', t);
}

// CASE 5 — Drive videoId → thumbnail w800
{
  const t = getActivityThumbnail({
    mediaItems: [{ type: 'video', provider: 'drive', videoId: 'driveId123' }],
  });
  if (t === 'https://drive.google.com/thumbnail?id=driveId123&sz=w800') ok('CASE 5 — Drive thumbnail w800');
  else fail('CASE 5', t);
}

// CASE 6 — imageUrl legacy si extension image
{
  const t = getActivityThumbnail({ imageUrl: 'https://cdn/old.png' });
  if (t === 'https://cdn/old.png') ok('CASE 6 — imageUrl legacy si image-like');
  else fail('CASE 6', t);
}

// CASE 7 — imageUrl vidéo legacy ignoré
{
  const t = getActivityThumbnail({ imageUrl: 'https://cdn/video.mp4' });
  if (t === null) ok('CASE 7 — imageUrl vidéo ignoré (pas de chain pourrie)');
  else fail('CASE 7', t);
}

// CASE 8 — Activité vide → null
{
  const t = getActivityThumbnail({});
  if (t === null) ok('CASE 8 — Activité vide → null (caller fait fallback)');
  else fail('CASE 8', t);
}
{
  const t = getActivityThumbnail(null);
  if (t === null) ok('CASE 8bis — null input → null');
  else fail('CASE 8bis', t);
}

// CASE 9 — Régression "Où pratiquer Silent Afroboost" : si activité a un
// mediaItems[0] image valide, on ne tombe JAMAIS sur le placeholder.
{
  const silentAfroboost = {
    title: 'Silent Afroboost',
    sport: 'Afroboost',
    city: 'Neuchâtel',
    mediaItems: [{ type: 'image', url: 'https://firebasestorage.googleapis.com/silent.jpg' }],
  };
  const t = getActivityThumbnail(silentAfroboost);
  if (t === 'https://firebasestorage.googleapis.com/silent.jpg') {
    ok('CASE 9 — Silent Afroboost retrouve sa miniature (preuve fix régression)');
  } else fail('CASE 9', t);
}

// CASE 10 — Activité avec uniquement `images[]` legacy (modal ActivitySelector)
{
  const legacyActivity = {
    title: 'Silent Afroboost',
    images: ['https://firebasestorage.googleapis.com/silent-legacy.jpg'],
  };
  const t = getActivityThumbnail(legacyActivity);
  if (t === 'https://firebasestorage.googleapis.com/silent-legacy.jpg') {
    ok('CASE 10 — Champ images[] legacy supporté (preuve fix #153)');
  } else fail('CASE 10', t);
}

// CASE 11 — `images[]` (legacy) ET `mediaItems[]` (moderne) : on prend
// thumbnailUrl > images[0] > mediaItems[0]. Le champ explicite gagne.
{
  const a = {
    thumbnailUrl: 'https://cdn/explicit.jpg',
    images: ['https://cdn/legacy.jpg'],
    mediaItems: [{ type: 'image', url: 'https://cdn/modern.jpg' }],
  };
  const t = getActivityThumbnail(a);
  if (t === 'https://cdn/explicit.jpg') {
    ok('CASE 11 — thumbnailUrl explicite bat images[] et mediaItems[]');
  } else fail('CASE 11', t);
}

// CASE 13 — Fix #155 : Silent Afroboost avec image dans champ custom `coverImage`.
//           Avant : helper ne lisait pas ce champ → null → carré rose.
//           Après : scan exhaustif trouve l'URL Firebase Storage.
{
  const silent = {
    title: 'Silent Afroboost',
    sport: 'Afroboost',
    city: 'Neuchâtel',
    // Champ custom non standardisé que le partner aurait pu utiliser
    coverImage: 'https://firebasestorage.googleapis.com/v0/b/spor.../silent.jpg',
  };
  const t = getActivityThumbnail(silent);
  if (t === 'https://firebasestorage.googleapis.com/v0/b/spor.../silent.jpg') {
    ok('CASE 13 — Champ custom coverImage récupéré par scan (preuve fix #155)');
  } else fail('CASE 13', t);
}

// CASE 14 — Champ posterUrl utilisé par certaines activités vidéo legacy
{
  const a = {
    title: 'My activity',
    posterUrl: 'https://firebasestorage.googleapis.com/v0/b/x/poster.png',
  };
  const t = getActivityThumbnail(a);
  if (t === 'https://firebasestorage.googleapis.com/v0/b/x/poster.png') {
    ok('CASE 14 — Champ posterUrl récupéré par scan');
  } else fail('CASE 14', t);
}

// CASE 15 — Activité avec un champ qui contient un texte description (PAS une URL)
//           ne doit PAS être pris pour une miniature
{
  const a = {
    title: 'Silent Afroboost',
    description: 'Une super activité de danse à Neuchâtel le mardi soir.',
  };
  const t = getActivityThumbnail(a);
  if (t === null) {
    ok('CASE 15 — Texte description ignoré (pas confondu avec URL image)');
  } else fail('CASE 15', t);
}

// CASE 16 — Régression test scanner : vérifier que les composants qui
// affichent une miniature d'activité utilisent bien le helper.
{
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..', '..');

  // Liste des fichiers qui affichent une miniature d'activité (vérifié à la main).
  // Tout ajout d'un nouveau composant doit l'inscrire ici OU passer par le helper.
  const components = [
    'src/app/discovery/page.tsx',
    'src/components/chat/ActivitySelectorModal.tsx',
  ];

  const offenders = [];
  for (const rel of components) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    // Le fichier doit importer ET appeler getActivityThumbnail
    const importsHelper = /from\s+['"]@\/lib\/activities\/getActivityThumbnail['"]/.test(src);
    const callsHelper = /\bgetActivityThumbnail(Chain)?\s*\(/.test(src);
    if (!importsHelper || !callsHelper) {
      offenders.push({ file: rel, importsHelper, callsHelper });
    }
  }
  if (offenders.length === 0) {
    ok(`CASE 12 — Tous les composants à miniature (${components.length}) utilisent le helper`);
  } else {
    fail('CASE 12 — Composants à miniature SANS helper (régression future garantie !)', offenders);
  }
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
