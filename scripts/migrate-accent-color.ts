/**
 * Accent feature — Migration script automatique de #D91CD2 hardcoded vers
 * les CSS variables / Tailwind tokens dynamiques.
 *
 * Patterns migrés :
 *   bg-[#D91CD2]/N    → bg-accent/N
 *   text-[#D91CD2]/N  → text-accent/N
 *   border-[#D91CD2]/N → border-accent/N
 *   from/to/via-[#D91CD2]/N → from/to/via-accent/N
 *   ring/fill/stroke/outline/caret/decoration/divide/shadow-[#D91CD2]/N → -accent/N
 *   '#D91CD2' (string) → 'var(--accent-color)'
 *   "#D91CD2"          → "var(--accent-color)"
 *   rgba(217, 28, 210, X) → rgb(var(--accent-color-rgb) / X)
 *
 * Scope :
 *   - src/app, src/components, src/lib, src/services (récursif)
 *   - Extensions : .tsx, .ts
 * Exclusions :
 *   - tests/** (les hex restent literals dans les tests)
 *   - tests adjacent (*.test.ts, *.test.tsx)
 *   - node_modules, .next
 *
 * Run : npx tsx scripts/migrate-accent-color.ts
 *
 * @module
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface Replacement {
  pattern: RegExp;
  replacement: string;
}

const REPLACEMENTS: Replacement[] = [
  { pattern: /\bbg-\[#D91CD2\](\/\d+)?/g, replacement: 'bg-accent$1' },
  { pattern: /\btext-\[#D91CD2\](\/\d+)?/g, replacement: 'text-accent$1' },
  { pattern: /\bborder-\[#D91CD2\](\/\d+)?/g, replacement: 'border-accent$1' },
  { pattern: /\bfrom-\[#D91CD2\](\/\d+)?/g, replacement: 'from-accent$1' },
  { pattern: /\bto-\[#D91CD2\](\/\d+)?/g, replacement: 'to-accent$1' },
  { pattern: /\bvia-\[#D91CD2\](\/\d+)?/g, replacement: 'via-accent$1' },
  { pattern: /\bring-\[#D91CD2\](\/\d+)?/g, replacement: 'ring-accent$1' },
  { pattern: /\bfill-\[#D91CD2\](\/\d+)?/g, replacement: 'fill-accent$1' },
  { pattern: /\bstroke-\[#D91CD2\](\/\d+)?/g, replacement: 'stroke-accent$1' },
  { pattern: /\boutline-\[#D91CD2\](\/\d+)?/g, replacement: 'outline-accent$1' },
  { pattern: /\bcaret-\[#D91CD2\](\/\d+)?/g, replacement: 'caret-accent$1' },
  { pattern: /\baccent-\[#D91CD2\](\/\d+)?/g, replacement: 'accent-accent$1' },
  { pattern: /\bdecoration-\[#D91CD2\](\/\d+)?/g, replacement: 'decoration-accent$1' },
  { pattern: /\bdivide-\[#D91CD2\](\/\d+)?/g, replacement: 'divide-accent$1' },
  { pattern: /\bshadow-\[#D91CD2\](\/\d+)?/g, replacement: 'shadow-accent$1' },
  { pattern: /'#D91CD2'/g, replacement: "'var(--accent-color)'" },
  { pattern: /"#D91CD2"/g, replacement: '"var(--accent-color)"' },
  { pattern: /rgba\(217,\s*28,\s*210,\s*([\d.]+)\)/g, replacement: 'rgb(var(--accent-color-rgb) / $1)' },
];

const SCOPE_DIRS = ['src/app', 'src/components', 'src/lib', 'src/services'];
const EXCLUDED_PATTERNS = [/\.test\.tsx?$/, /__tests__/, /node_modules/, /\.next/];

function shouldSkip(path: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => p.test(path));
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

function migrateFile(path: string): number {
  const content = readFileSync(path, 'utf8');
  let updated = content;
  let total = 0;
  for (const { pattern, replacement } of REPLACEMENTS) {
    const matches = updated.match(pattern);
    if (matches) {
      total += matches.length;
      updated = updated.replace(pattern, replacement);
    }
  }
  if (updated !== content) {
    writeFileSync(path, updated, 'utf8');
  }
  return total;
}

function main(): void {
  const files: string[] = [];
  for (const dir of SCOPE_DIRS) {
    walkDir(dir, files);
  }

  let totalFiles = 0;
  let totalReplacements = 0;
  const changedFiles: Array<{ file: string; count: number }> = [];

  for (const file of files) {
    const count = migrateFile(file);
    if (count > 0) {
      totalFiles++;
      totalReplacements += count;
      changedFiles.push({ file, count });
    }
  }

  console.log(`\n====== Migration accent-color terminée ======`);
  console.log(`Fichiers scannés : ${files.length}`);
  console.log(`Fichiers modifiés : ${totalFiles}`);
  console.log(`Replacements totaux : ${totalReplacements}`);
  console.log(`\nTop 20 fichiers par nombre de replacements :`);
  changedFiles
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .forEach((f) => console.log(`  ${f.count.toString().padStart(4)} ${f.file}`));
}

main();
