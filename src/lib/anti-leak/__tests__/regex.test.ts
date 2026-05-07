/**
 * Tests Phase 8 sub-chantier 1 commit 2/5 — Anti-leak L1 regex (pure unit).
 *
 * Exécution :
 *   npm run test:anti-leak:regex
 *   (équivalent : npx tsx src/lib/anti-leak/__tests__/regex.test.ts)
 *
 * Pure unit tests — pas d'emulator. Pattern mini test runner cohérent
 * src/ai/__tests__/genkit.test.ts.
 *
 * Couverture (30 cas RGX1-RGX30) :
 *
 * TP (true positives) RGX1-RGX15 — patterns doctrine §C détectés correctement
 * TN (true negatives) RGX16-RGX25 — messages bénins, doctrine §B.Q4 cible 92-95%
 * FP edge cases    RGX26-RGX30 — boundary tests + case-insensitive
 *
 * Cible globale : zéro régression FP / FN sur ce baseline. Tuning prompt SC2 IA
 * peut affiner le score sur les cas ambigus (Layer 2 doctrine §C).
 */

import { scanMessageL1, type L1ScanMotive } from '../regex';

// =====================================================================
// Mini test runner
// =====================================================================

let _passes = 0;
let _failures = 0;

function passManually(label: string): void {
  console.log(`PASS  ${label}`);
  _passes++;
}

function failManually(label: string, err?: unknown): void {
  console.log(`FAIL  ${label}`, err ?? '');
  _failures++;
}

function section(title: string): void {
  console.log('');
  console.log(`--- ${title} ---`);
}

// =====================================================================
// Helpers
// =====================================================================

interface TestCase {
  id: string;
  message: string;
  expectedFlagged: boolean;
  expectedMotive?: L1ScanMotive;
  expectedScore?: number;
  description: string;
}

function runCase(tc: TestCase): void {
  const result = scanMessageL1(tc.message);
  const errors: string[] = [];

  if (result.flagged !== tc.expectedFlagged) {
    errors.push(`flagged: expected ${tc.expectedFlagged}, got ${result.flagged}`);
  }
  if (tc.expectedMotive !== undefined && result.motive !== tc.expectedMotive) {
    errors.push(`motive: expected '${tc.expectedMotive}', got '${result.motive}'`);
  }
  if (tc.expectedScore !== undefined && Math.abs(result.score - tc.expectedScore) > 0.01) {
    errors.push(`score: expected ${tc.expectedScore}, got ${result.score}`);
  }

  if (errors.length === 0) {
    passManually(`${tc.id} ${tc.description}`);
  } else {
    failManually(`${tc.id} ${tc.description} — ${errors.join(' | ')}`, { result });
  }
}

// =====================================================================
// Test cases
// =====================================================================

const TP_CASES: TestCase[] = [
  // RGX1-RGX2 phone-ch
  { id: 'RGX1', message: 'appelle-moi 079 123 45 67', expectedFlagged: true, expectedMotive: 'phone-ch', expectedScore: 0.5, description: 'phone CH avec espaces' },
  { id: 'RGX2', message: '0791234567', expectedFlagged: true, expectedMotive: 'phone-ch', expectedScore: 0.5, description: 'phone CH sans espaces' },

  // RGX3-RGX4 email
  { id: 'RGX3', message: 'test@example.com', expectedFlagged: true, expectedMotive: 'email', expectedScore: 0.5, description: 'email simple (domain dedup intra-email)' },
  { id: 'RGX4', message: 'user@sub.domain.ch', expectedFlagged: true, expectedMotive: 'email', expectedScore: 0.5, description: 'email avec subdomain' },

  // RGX5-RGX7 social-handle (proximity activée par insta|snap|tiktok)
  { id: 'RGX5', message: 'mon insta @samuel_p', expectedFlagged: true, expectedMotive: 'handle', expectedScore: 0.8, description: 'handle insta proximity (handle + keyword 2 cats)' },
  { id: 'RGX6', message: '@bassi_pro sur snap', expectedFlagged: true, expectedMotive: 'handle', expectedScore: 0.8, description: 'handle snap proximity (handle + keyword 2 cats)' },
  { id: 'RGX7', message: 'tiktok @marie.dance', expectedFlagged: true, expectedMotive: 'handle', expectedScore: 0.8, description: 'handle tiktok proximity (handle + keyword 2 cats)' },

  // RGX8-RGX9 domain
  { id: 'RGX8', message: 'regarde sur monsite.ch', expectedFlagged: true, expectedMotive: 'domain', expectedScore: 0.5, description: 'domain .ch' },
  { id: 'RGX9', message: 'fitness-app.com', expectedFlagged: true, expectedMotive: 'domain', expectedScore: 0.5, description: 'domain composé .com' },

  // RGX10-RGX12, RGX14-RGX15 platform keyword
  { id: 'RGX10', message: 'écris-moi sur WhatsApp', expectedFlagged: true, expectedMotive: 'keyword', expectedScore: 0.5, description: 'keyword WhatsApp' },
  { id: 'RGX11', message: "Telegram c'est plus simple", expectedFlagged: true, expectedMotive: 'keyword', expectedScore: 0.5, description: 'keyword Telegram' },
  { id: 'RGX12', message: 'DM moi sur insta', expectedFlagged: true, expectedMotive: 'keyword', expectedScore: 0.6, description: 'multi-occurrence keyword (DM moi + insta = +0.1)' },
  { id: 'RGX13', message: '079 123 45 67 ou test@mail.com', expectedFlagged: true, expectedMotive: 'phone-ch', expectedScore: 0.8, description: 'multi-cat phone+email score 0.8 (priority phone-ch)' },
  { id: 'RGX14', message: 'envoie sur Signal', expectedFlagged: true, expectedMotive: 'keyword', expectedScore: 0.6, description: 'multi-occurrence keyword (envoie sur + Signal = +0.1)' },
  { id: 'RGX15', message: 'MP moi', expectedFlagged: true, expectedMotive: 'keyword', expectedScore: 0.5, description: 'keyword MP' },
];

const TN_CASES: TestCase[] = [
  // RGX16-RGX25 messages bénins, attendu flagged=false
  { id: 'RGX16', message: 'salut, on se voit jeudi ?', expectedFlagged: false, expectedMotive: 'clean', expectedScore: 0, description: 'message neutre' },
  { id: 'RGX17', message: "j'ai mangé 555 calories", expectedFlagged: false, expectedMotive: 'clean', description: 'chiffres calories (pas format phone CH 0XX)' },
  { id: 'RGX18', message: 'merci@toi', expectedFlagged: false, expectedMotive: 'clean', description: 'mention bénigne (regex email strict TLD requis)' },
  { id: 'RGX19', message: '@samedi je suis libre', expectedFlagged: false, expectedMotive: 'clean', description: 'jour de semaine (pas de proximity keyword)' },
  { id: 'RGX20', message: 'ça coûte 50.- chf', expectedFlagged: false, expectedMotive: 'clean', description: 'prix (chf pas TLD reconnue isolée)' },
  { id: 'RGX21', message: "j'adore ce cours 🔥💪", expectedFlagged: false, expectedMotive: 'clean', description: 'émojis sans pattern' },
  { id: 'RGX22', message: 'ok... à bientôt!', expectedFlagged: false, expectedMotive: 'clean', description: 'ponctuation' },
  { id: 'RGX23', message: 'session #1234', expectedFlagged: false, expectedMotive: 'clean', description: 'numéros activité (pas format phone)' },
  { id: 'RGX24', message: 'depuis 2020 je fais yoga', expectedFlagged: false, expectedMotive: 'clean', description: 'année (4 digits sans pattern)' },
  { id: 'RGX25', message: "Salut, super cours hier, j'ai bien transpiré, à la prochaine !", expectedFlagged: false, expectedMotive: 'clean', description: 'message long bénin' },
];

const FP_EDGE_CASES: TestCase[] = [
  // RGX26-RGX30 boundary edge tests
  { id: 'RGX26', message: 'code postal 12345 67', expectedFlagged: false, expectedMotive: 'clean', description: '8 digits non-format CH (pas leading 0)' },
  { id: 'RGX27', message: 'github.io/repo', expectedFlagged: true, expectedMotive: 'domain', expectedScore: 0.5, description: 'github.io domain (acceptable noise documenté)' },
  { id: 'RGX28', message: '🤔@home', expectedFlagged: false, expectedMotive: 'clean', description: 'pseudo-email sans TLD + handle sans proximity' },
  { id: 'RGX29', message: 'telegraph est un journal', expectedFlagged: false, expectedMotive: 'clean', description: 'word boundary strict (telegraph ≠ telegram)' },
  { id: 'RGX30', message: 'WHATSAPP en majuscules', expectedFlagged: true, expectedMotive: 'keyword', expectedScore: 0.5, description: 'case-insensitive keyword' },
];

// =====================================================================

async function main(): Promise<void> {
  section('TP (true positives) — RGX1-RGX15');
  for (const tc of TP_CASES) runCase(tc);

  section('TN (true negatives) — RGX16-RGX25');
  for (const tc of TN_CASES) runCase(tc);

  section('FP edge cases — RGX26-RGX30');
  for (const tc of FP_EDGE_CASES) runCase(tc);

  console.log('');
  console.log('====== Résumé Anti-leak L1 regex (RGX1-RGX30) ======');
  console.log(`PASS : ${_passes}`);
  console.log(`FAIL : ${_failures}`);
  console.log(`Total: ${_passes + _failures}`);
  process.exit(_failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
