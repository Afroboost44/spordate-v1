/**
 * Migration pass 2 — pour les 15 fichiers à pattern non-standard que
 * migrate-admin-init.ts n'a pas pu traiter (helper centralisé non-applicable :
 * getAdminAuth avec _adminApp, stripe libs avec init top-level, etc).
 *
 * Stratégie minimale : remplace just `JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)`
 * par `parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]`
 * et ajoute l'import si absent. Plus défensif, fix le bug parse en local
 * sans toucher la structure du fichier.
 *
 * Run : npx tsx scripts/migrate-admin-init-pass2.ts
 *
 * @module
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SKIP_PATTERNS = [/admin\.ts$/, /verifyAuth\.ts$/, /\.test\.tsx?$/, /scripts\//];
const HELPER_IMPORT = "import { parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';";

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

function migrateFile(path: string): boolean {
  const original = readFileSync(path, 'utf8');
  if (!original.includes('JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY')) {
    return false;
  }
  // Replace JSON.parse call with defensive parse + cert type assertion
  let updated = original.replace(
    /JSON\.parse\(process\.env\.FIREBASE_SERVICE_ACCOUNT_KEY\)/g,
    'parseServiceAccountKeyDefensive(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as Parameters<typeof cert>[0]',
  );
  // Add import if absent — insert after last existing import line (no multi-line trap this time)
  if (!updated.includes("from '@/lib/auth/verifyAuth'")) {
    const lines = updated.split('\n');
    let insertIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('import ') && line.includes('from ') && line.endsWith(';')) {
        insertIdx = i;
      }
    }
    if (insertIdx >= 0) {
      lines.splice(insertIdx + 1, 0, HELPER_IMPORT);
      updated = lines.join('\n');
    } else {
      updated = HELPER_IMPORT + '\n' + updated;
    }
  } else {
    // Already imports something from verifyAuth — append parseServiceAccountKeyDefensive
    updated = updated.replace(
      /import\s*\{\s*([^}]*?)\s*\}\s*from\s*'@\/lib\/auth\/verifyAuth';/,
      (match, captured) => {
        if (captured.includes('parseServiceAccountKeyDefensive')) return match;
        return `import { ${captured.trim()}, parseServiceAccountKeyDefensive } from '@/lib/auth/verifyAuth';`;
      },
    );
  }
  writeFileSync(path, updated, 'utf8');
  return true;
}

function main(): void {
  const files: string[] = [];
  walkDir('src', files);

  let migrated = 0;
  const migratedFiles: string[] = [];

  for (const file of files) {
    if (migrateFile(file)) {
      migrated++;
      migratedFiles.push(file);
    }
  }

  console.log(`\n====== Migration pass 2 terminée ======`);
  console.log(`Fichiers migrés : ${migrated}`);
  migratedFiles.forEach((f) => console.log(`  ${f}`));
}

main();
