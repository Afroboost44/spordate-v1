#!/usr/bin/env node
/**
 * Fix #203 — Anti-régression : scanner les call sites de getActivityThumbnail /
 * getActivityThumbnailChain pour interdire le cherry-pick d'objet littéral.
 *
 * RÈGLE (CLAUDE.md §9.ter) : on passe TOUJOURS l'activité COMPLÈTE au helper.
 *
 * Ce test FAIL si un fichier contient :
 *   getActivityThumbnail({ ... })       ← cherry-pick interdit
 *   getActivityThumbnailChain({ ... })  ← cherry-pick interdit
 *
 * Ce test PASS pour :
 *   getActivityThumbnail(activity)        ← variable / param
 *   getActivityThumbnail(a)
 *   getActivityThumbnailChain(activityDoc)
 *
 * Pourquoi : cherry-pick perd des champs (mediaItems, coverImage, scan
 * exhaustif…). Le helper scan EXHAUSTIVEMENT l'objet. Cherry-pick = bug
 * visuel récurrent (miniature qui disparaît dans modal alors qu'elle marche
 * partout ailleurs).
 *
 * Bug historique : ActivitySelectorModal cherry-pickait, miniatures rectangles
 * vides dans le modal "Choisir une activité" alors que l'activité avait bien
 * une image en base. Fix : passer `a` complet.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../../src');
const FORBIDDEN_PATTERN = /getActivityThumbnail(Chain)?\s*\(\s*\{/;

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

const offenders = [];
for (const file of walk(SRC_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip commentaires (// ou * dans un bloc /* */)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (FORBIDDEN_PATTERN.test(line)) {
      offenders.push({
        file: path.relative(path.resolve(__dirname, '../..'), file),
        line: i + 1,
        content: line.trim(),
      });
    }
  }
}

if (offenders.length > 0) {
  console.error('\n❌ Cherry-pick de getActivityThumbnail() / getActivityThumbnailChain() détecté.\n');
  console.error('   RÈGLE (CLAUDE.md §9.ter) : passer l\'activité COMPLÈTE, pas un objet littéral.\n');
  for (const o of offenders) {
    console.error(`   ${o.file}:${o.line}`);
    console.error(`     ${o.content}`);
  }
  console.error('\n   Fix : remplacer getActivityThumbnail({...}) par getActivityThumbnail(activity).\n');
  process.exit(1);
}

console.log('✅ Aucun cherry-pick getActivityThumbnail détecté.');
process.exit(0);
