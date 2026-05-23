/**
 * Migration mécanique : remplace les blocs inline getAdminDb() dupliqués
 * dans chaque endpoint par l'import du helper centralisé
 * `@/lib/firebase/admin` qui utilise parseServiceAccountKeyDefensive
 * (fix .env Vercel CLI corrompu en local).
 *
 * Stratégie :
 *  1. Scan tous les .ts/.tsx contenant JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
 *  2. Détecte le bloc inline standard `let _adminDb: any = null; async function getAdminDb() {...}`
 *  3. Supprime le bloc + ajoute import depuis @/lib/firebase/admin
 *  4. Skip fichiers avec pattern non-standard (admin auth, stripe helpers) — manual fix
 *  5. Skip src/lib/firebase/admin.ts (le helper lui-même)
 *  6. Skip src/lib/auth/verifyAuth.ts (parse défensif source)
 *
 * Run : npx tsx scripts/migrate-admin-init.ts
 *
 * @module
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SKIP_PATTERNS = [/admin\.ts$/, /verifyAuth\.ts$/, /\.test\.tsx?$/, /scripts\//];

// Bloc inline standard à remplacer (multiline regex avec lookahead-free pattern).
// Capture optionnellement un commentaire eslint-disable précédent.
const INLINE_BLOCK = /(?:\/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\n)?let _adminDb: any = null;\n+async function getAdminDb\(\) \{\n  if \(_adminDb\) return _adminDb;\n  const \{ initializeApp, getApps, cert \} = await import\('firebase-admin\/app'\);\n  const \{ getFirestore \} = await import\('firebase-admin\/firestore'\);\n  if \(!getApps\(\)\.length\) \{\n    if \(process\.env\.FIREBASE_SERVICE_ACCOUNT_KEY\) \{\n      initializeApp\(\{ credential: cert\(JSON\.parse\(process\.env\.FIREBASE_SERVICE_ACCOUNT_KEY\)\) \}\);\n    \} else \{\n      initializeApp\(\{\n        projectId:\n          process\.env\.NEXT_PUBLIC_FIREBASE_PROJECT_ID \|\|\n          process\.env\.GCLOUD_PROJECT \|\|\n          'spordateur-claude',\n      \}\);\n    \}\n  \}\n  _adminDb = getFirestore\(\);\n  return _adminDb;\n\}\n*/;

const HELPER_IMPORT = "import { getAdminDb } from '@/lib/firebase/admin';";

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(path));
}

function walkDir(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (shouldSkip(full)) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(full, out);
    } else if (stat.isFile() && (full.endsWith('.tsx') || full.endsWith('.ts'))) {
      out.push(full);
    }
  }
}

function migrateFile(path: string): 'migrated' | 'no-match' | 'no-pattern' {
  const original = readFileSync(path, 'utf8');
  if (!original.includes('JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY')) {
    return 'no-pattern';
  }
  if (!INLINE_BLOCK.test(original)) {
    return 'no-match';
  }
  // Remove inline block
  let updated = original.replace(INLINE_BLOCK, '');
  // Add import after the last existing import (heuristic : line starting with `import ` then a blank line)
  // Simpler heuristic : add right after the first `import` line if not already present.
  if (!updated.includes(HELPER_IMPORT)) {
    // Insert after the last consecutive import block
    const lines = updated.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ') || lines[i].startsWith('export ')) {
        lastImportIdx = i;
      } else if (lastImportIdx >= 0 && lines[i].trim() === '') {
        break;
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, HELPER_IMPORT);
      updated = lines.join('\n');
    } else {
      updated = HELPER_IMPORT + '\n' + updated;
    }
  }
  writeFileSync(path, updated, 'utf8');
  return 'migrated';
}

function main(): void {
  const files: string[] = [];
  walkDir('src', files);

  let migrated = 0;
  let noMatch = 0;
  const noMatchFiles: string[] = [];

  for (const file of files) {
    const result = migrateFile(file);
    if (result === 'migrated') {
      migrated++;
    } else if (result === 'no-match') {
      noMatch++;
      noMatchFiles.push(file);
    }
  }

  console.log(`\n====== Migration admin-init terminée ======`);
  console.log(`Fichiers migrés (pattern standard) : ${migrated}`);
  console.log(`Fichiers SKIP (pattern non-standard) : ${noMatch}`);
  if (noMatchFiles.length > 0) {
    console.log(`\nFichiers à migrer manuellement :`);
    noMatchFiles.forEach((f) => console.log(`  ${f}`));
  }
}

main();
