#!/usr/bin/env node
/**
 * Bug récurrent Bassi 28/05 (épisode 2) — détection automatique des composants
 * qui rendent une "card d'invitation" (= un composant qui contient à la fois
 * un bouton "Accepter" et un bouton "Refuser") et vérification qu'ils utilisent
 * bien le helper centralisé `getActivityThumbnail` pour résoudre la miniature
 * de l'activité.
 *
 * Pourquoi ce test :
 *  Le test précédent `invite-card-thumbnail.test.js` scanne uniquement les
 *  fichiers dont le path matche un pattern `*Invite*` ou `/invites/`. Mais un
 *  développeur peut créer un nouveau composant card invite avec un nom qui ne
 *  matche aucun pattern (`ChatInviteBubble`, `SuggestionCardInvite`, etc.) et
 *  ré-introduire le bug en rendant un placeholder rose plat opaque au lieu de
 *  passer par le helper.
 *
 *  Ce test est plus robuste : il scanne TOUT le src/components/chat/ et les
 *  pages chat pour trouver les composants qui matchent l'heuristique "card
 *  invitation" (bouton Accepter ET bouton Refuser dans le même fichier), puis
 *  vérifie qu'ils :
 *    1. Importent `getActivityThumbnail` OU `getActivityThumbnailChain` OU
 *       `getActivityThumbnailMedia` depuis `@/lib/activities/getActivityThumbnail`.
 *    2. Ne contiennent pas de placeholder rose plat opaque
 *       (`bg-gradient-to-br from-accent to-[#E91E63]` sans modifier d'opacité).
 *    3. Ne contiennent pas de cherry-pick `getActivityThumbnail({...})`.
 *
 * Si l'une de ces règles est violée → exit 1.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../../src');

// Heuristique "card invitation" : fichier qui contient (presque) côte-à-côte
// un texte "Accepter" et un texte "Refuser" (boutons d'une card invite).
// On accepte également les variants t('...accept...'), t('...decline...')
// car certains composants migrés i18n n'ont plus le mot FR direct.
const ACCEPT_PATTERN = /\bAccepter\b|\bAccept\b|t\(['"][^'"]*(accept|invite_accept)[^'"]*['"]/i;
const DECLINE_PATTERN = /\bRefuser\b|\bDecline\b|t\(['"][^'"]*(decline|refuse|invite_decline)[^'"]*['"]/i;

const HELPER_IMPORT_PATTERN =
  /from\s+['"]@\/lib\/activities\/getActivityThumbnail['"]/;
const HELPER_USAGE_PATTERN =
  /getActivityThumbnail(Chain|Media)?\s*\(/;

// Placeholder rose plat opaque interdit.
const FLAT_PINK_PATTERN =
  /bg-gradient-to-(br|r|b|tr)\s+from-accent\s+to-\[#E91E63\]|bg-gradient-to-(br|r|b|tr)\s+from-accent\b(?!\/)\s+to-/;

// Cherry-pick helper interdit (CLAUDE.md §9.ter).
const CHERRY_PICK_PATTERN = /getActivityThumbnail(Chain|Media)?\s*\(\s*\{/;

function walk(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else if (/\.tsx$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// On scan toute la zone chat + invites + pages chat (large filet).
const SCAN_DIRS = [
  path.join(SRC_DIR, 'components/chat'),
  path.join(SRC_DIR, 'components/invites'),
  path.join(SRC_DIR, 'components/activities'),
  path.join(SRC_DIR, 'app/chat'),
  path.join(SRC_DIR, 'app/invite'),
];

const offenders = [];
const candidateFiles = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const content = fs.readFileSync(file, 'utf8');
    // Heuristique "card invitation" : Accepter ET Refuser dans le même fichier.
    if (ACCEPT_PATTERN.test(content) && DECLINE_PATTERN.test(content)) {
      candidateFiles.push({ file, content });
    }
  }
}

const relPath = (p) => path.relative(path.resolve(__dirname, '../..'), p);

for (const { file, content } of candidateFiles) {
  // Skip si le fichier est un parent qui ne rend pas lui-même la card (il
  // délègue à un sous-composant). Heuristique : il importe et utilise
  // `<ActivityInviteMessage` ou similaire. On NE skip QUE si le fichier
  // NE rend pas de balise <img>, <video>, ou <div bg-gradient-...> avec une
  // miniature d'activité (donc juste un wrapper qui passe les props).
  const rendersOwnInviteCard =
    /<img\b/.test(content) || /<video\b/.test(content) || /thumb(Url|nail|Index)/i.test(content);
  if (!rendersOwnInviteCard) continue;

  const lines = content.split('\n');

  // Rule 1 : utilise le helper.
  const importsHelper = HELPER_IMPORT_PATTERN.test(content);
  const usesHelper = HELPER_USAGE_PATTERN.test(content);
  if (!importsHelper || !usesHelper) {
    offenders.push({
      file: relPath(file),
      line: 1,
      content: '(import ou usage de getActivityThumbnail manquant)',
      rule:
        "Composant card invitation (contient Accepter + Refuser + rend sa propre miniature) " +
        "DOIT importer ET utiliser getActivityThumbnail / Chain / Media depuis " +
        "@/lib/activities/getActivityThumbnail. Sinon = bug récurrent Bassi 28/05 (placeholder rose).",
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Rule 2 : pas de placeholder rose plat.
    if (FLAT_PINK_PATTERN.test(line)) {
      offenders.push({
        file: relPath(file),
        line: i + 1,
        content: trimmed,
        rule:
          "Placeholder rose plat opaque interdit dans card invitation. " +
          "Utiliser un dégradé subtle (from-accent/15 → zinc-900) + icône Sparkles " +
          "semi-transparent + titre activité en gros texte centré.",
      });
    }

    // Rule 3 : pas de cherry-pick helper.
    if (CHERRY_PICK_PATTERN.test(line)) {
      offenders.push({
        file: relPath(file),
        line: i + 1,
        content: trimmed,
        rule:
          "Cherry-pick getActivityThumbnail({...}) interdit (CLAUDE.md §9.ter). " +
          "Passer l'OBJET activité COMPLET.",
      });
    }
  }
}

if (offenders.length > 0) {
  console.error('\nMiniature card invitation chat : régression détectée.\n');
  console.error(
    '   RÈGLE (CLAUDE.md §9.ter) + Bug Bassi 28/05 (épisode 2).\n',
  );
  for (const o of offenders) {
    console.error(`   ${o.file}:${o.line}`);
    console.error(`     ${o.content}`);
    console.error(`     → ${o.rule}\n`);
  }
  process.exit(1);
}

console.log(
  `OK : ${candidateFiles.length} composant(s) card invitation détecté(s), tous utilisent getActivityThumbnail correctement.`,
);
process.exit(0);
