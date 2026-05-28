#!/usr/bin/env node
/**
 * Anti-régression (Bug récurrent Bassi 28/05) — Card d'invitation chat & pages
 * invite : la miniature de l'activité DOIT toujours passer par le helper
 * centralisé `getActivityThumbnail` / `getActivityThumbnailChain` /
 * `getActivityThumbnailMedia` (Fix #146/#194/#205).
 *
 * Historique du bug :
 *  - #146 → helper centralisé créé pour cards activity
 *  - #194 bug B → ActivityInviteMessage migré vers helper
 *  - #205 → modal "Choisir une activité" : ajout `getActivityThumbnailMedia`
 *           qui retombe sur la vidéo Storage upload quand aucune image
 *  - 28/05 Bassi → Card invite chat (Silent Afroboost) affichait toujours le
 *    placeholder rose : `getActivityThumbnailChain` retournait [] car le seul
 *    média était une vidéo Storage. Même cause que #205, autre call site.
 *
 * Ce test scanne les composants liés aux invitations et FAIL si :
 *
 *  1. Un composant invite fait un cherry-pick `getActivityThumbnail{,Chain,Media}({...})`
 *     (CLAUDE.md §9.ter — règle dure : on passe l'activité COMPLÈTE).
 *
 *  2. Un composant invite rend une `<img>` ou `<video>` avec un src `activity.X`
 *     direct (cherry-pick caché : accès direct au champ thumbnailUrl/imageUrl)
 *     sans passer par le helper.
 *
 *  3. Le composant chat principal `ActivityInviteMessage.tsx` n'importe pas
 *     `getActivityThumbnailMedia` (filet ultime vidéo Storage upload Silent
 *     Afroboost). Sans cet import, le bug du 28/05 ré-arrive.
 *
 * Le test PASS si tous les call sites passent par le helper avec l'objet
 * complet (`getActivityThumbnail(a)`, `getActivityThumbnailChain(activityDoc)`,
 * `getActivityThumbnailMedia(activity)`).
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../../src');

// Composants concernés par le rendu d'invitations. On scan exhaustivement :
//  - src/components/chat/*Invite* + ActivitySelectorModal (le picker amont)
//  - src/components/invites/*
//  - src/app/invite/**
//  - src/app/chat/page.tsx (parent qui inject le snapshot)
const INVITE_FILE_PATTERNS = [
  /\/components\/chat\/.*Invite.*\.tsx?$/,
  /\/components\/chat\/ActivitySelectorModal\.tsx?$/,
  /\/components\/invites\/.*\.tsx?$/,
  /\/app\/invite\/.*\.tsx?$/,
];

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function isInviteFile(filePath) {
  return INVITE_FILE_PATTERNS.some((rgx) => rgx.test(filePath));
}

const offenders = [];
const inviteFiles = walk(SRC_DIR).filter(isInviteFile);

// =====================================================================
// Check 1 — cherry-pick `getActivityThumbnail{,Chain,Media}({...})` interdit
// =====================================================================
const CHERRY_PICK_PATTERN = /getActivityThumbnail(Chain|Media)?\s*\(\s*\{/;

for (const file of inviteFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (CHERRY_PICK_PATTERN.test(line)) {
      offenders.push({
        file: path.relative(path.resolve(__dirname, '../..'), file),
        line: i + 1,
        content: line.trim(),
        rule: 'cherry-pick getActivityThumbnail({...}) interdit (CLAUDE.md §9.ter)',
      });
    }
  }
}

// =====================================================================
// Check 2 — `ActivityInviteMessage.tsx` DOIT importer
// `getActivityThumbnailMedia` (filet ultime vidéo Storage upload).
// Sans cet import, le bug Bassi 28/05 ré-arrive : Silent Afroboost (vidéo
// Storage seule, sans VideoThumbnailPicker) → chain image vide → placeholder
// rose.
// =====================================================================
const INVITE_MESSAGE_PATH = path.join(
  SRC_DIR,
  'components/chat/ActivityInviteMessage.tsx',
);
if (fs.existsSync(INVITE_MESSAGE_PATH)) {
  const content = fs.readFileSync(INVITE_MESSAGE_PATH, 'utf8');
  if (!/getActivityThumbnailMedia/.test(content)) {
    offenders.push({
      file: path.relative(path.resolve(__dirname, '../..'), INVITE_MESSAGE_PATH),
      line: 1,
      content: '(import getActivityThumbnailMedia manquant)',
      rule:
        'ActivityInviteMessage doit utiliser getActivityThumbnailMedia comme filet vidéo Storage (Bug Bassi 28/05 — Silent Afroboost). Sans ça, les activités avec UNIQUEMENT une vidéo Storage upload retombent sur le placeholder rose.',
    });
  }
}

// =====================================================================
// Check 3 — accès direct cherry-pick caché : `activity.thumbnailUrl` /
// `invite.activityThumbnail` etc. dans un attribut `src=`. On flag tout
// `src={...activity.thumbnailUrl...}` / `src={...invite.thumbnail...}` qui
// ne s'appuie pas sur le helper.
//
// Le helper résout 8+ champs (thumbnailUrl, images[], mediaItems image/video,
// mediaUrls legacy, imageUrl, thumbnailMedia poster/url, scan exhaustif hosts).
// Accès direct = perte = bug visuel (cas #146/#155/#186/#203/#205/28-05).
//
// On tolère le snapshot dénormalisé `invite.activityImageUrl` UNIQUEMENT s'il
// est combiné avec un fetch du doc complet + helper (pattern ActivityInviteMessage).
// On tolère aussi `imageUrl` (variable locale dérivée du helper).
// =====================================================================
const DIRECT_THUMB_FIELD = /\b(activity|invite|inv|a|doc|item)\.(thumbnailUrl|thumbnailMedia|posterUrl|coverImage)\b/;

for (const file of inviteFiles) {
  const content = fs.readFileSync(file, 'utf8');
  // Si le fichier importe le helper, on présume bon usage (déjà couvert
  // par check 1 — pas de cherry-pick). On veut juste flag les fichiers qui
  // accèdent direct SANS jamais importer le helper.
  const importsHelper = /getActivityThumbnail(Chain|Media)?\b/.test(content);
  if (importsHelper) continue;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (DIRECT_THUMB_FIELD.test(line)) {
      offenders.push({
        file: path.relative(path.resolve(__dirname, '../..'), file),
        line: i + 1,
        content: line.trim(),
        rule:
          'Accès direct à un champ miniature (thumbnailUrl/thumbnailMedia/...) dans un composant invite sans passer par getActivityThumbnail helper. Cherry-pick caché = bug récurrent.',
      });
    }
  }
}

// =====================================================================
// Check 4 — Placeholder rose PLAT interdit dans `ActivityInviteMessage.tsx`.
// Bug récurrent Bassi 28/05 (épisode 2) — quand aucune miniature résolvable
// (image + vidéo helper tous deux null), le composant tombait sur un
// `bg-gradient-to-br from-accent to-[#E91E63]` opaque qui ressemblait à un
// rectangle rose-bug. Le fallback DOIT être un dégradé subtle vers zinc-900
// (cohérent fond card chat) + nom de l'activité en gros texte, PAS un rose
// plat opaque qui crie "miniature cassée".
// =====================================================================
if (fs.existsSync(INVITE_MESSAGE_PATH)) {
  const content = fs.readFileSync(INVITE_MESSAGE_PATH, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // Détection du pattern rose plat opaque (accent → E91E63 sans opacity).
    // On tolère `from-accent/25` ou `from-accent/15` (variants subtle), seul
    // le `from-accent` ou `from-accent to-[#E91E63]` SANS modifier d'opacité
    // est interdit.
    if (
      /bg-gradient-to-(br|r|b|tr)\s+from-accent\s+to-\[#E91E63\]/.test(line) ||
      /bg-gradient-to-(br|r|b|tr)\s+from-accent\b(?!\/)\s+to-/.test(line)
    ) {
      offenders.push({
        file: path.relative(path.resolve(__dirname, '../..'), INVITE_MESSAGE_PATH),
        line: i + 1,
        content: line.trim(),
        rule:
          "Placeholder rose plat opaque interdit dans ActivityInviteMessage. " +
          "Quand aucune miniature résolvable, utiliser un dégradé subtle (from-accent/15 → zinc-900) " +
          "+ icône Sparkles semi-transparent + titre activité centré. Le rose plat ressemble à un bug visuel.",
      });
    }
  }
}

// =====================================================================
// Report
// =====================================================================
if (offenders.length > 0) {
  console.error('\nMiniature invite : régression détectée.\n');
  console.error(
    '   RÈGLE (CLAUDE.md §9.ter) + Bug Bassi 28/05 — Silent Afroboost.\n',
  );
  for (const o of offenders) {
    console.error(`   ${o.file}:${o.line}`);
    console.error(`     ${o.content}`);
    console.error(`     → ${o.rule}\n`);
  }
  console.error(
    '   Fix : importer getActivityThumbnail / getActivityThumbnailChain /\n' +
      '   getActivityThumbnailMedia depuis @/lib/activities/getActivityThumbnail\n' +
      '   et passer l\'OBJET activité COMPLET (pas un littéral, pas un champ).\n',
  );
  process.exit(1);
}

console.log(
  'OK : tous les composants invite utilisent le helper getActivityThumbnail correctement.',
);
process.exit(0);
