/**
 * B2 hotfix — Tests purs `parseServiceAccountKeyDefensive`.
 *
 * Couverture (PSA1-PSA4) :
 *   PSA1 — JSON valide standard → parse réussi direct
 *   PSA2 — JSON avec real newlines dans une string (cas Vercel pull) → repair retry OK
 *   PSA3 — JSON avec CR/LF mixtes → repair retry OK
 *   PSA4 — JSON irréparable (chaîne aléatoire) → throw avec contexte des 2 erreurs
 *
 * Exécution : npx tsx tests/auth/parse-service-account.test.ts
 */

import { parseServiceAccountKeyDefensive } from '../../src/lib/auth/verifyAuth';

let passes = 0;
let failures = 0;

function ok(label: string) { passes++; console.log(`  ✓ ${label}`); }
function fail(label: string, info?: unknown) { failures++; console.error(`  ✗ ${label}`, info ?? ''); }
function section(t: string) { console.log(`\n--- ${t} ---`); }

async function run() {
  section('PSA1 — JSON valide standard → parse direct');
  {
    const raw = '{"type":"service_account","project_id":"foo","private_key":"-----BEGIN-----\\n-----END-----\\n"}';
    const r = parseServiceAccountKeyDefensive(raw);
    if (r.type === 'service_account' && r.project_id === 'foo' && typeof r.private_key === 'string') {
      ok('parse direct OK');
    } else {
      fail('unexpected', r);
    }
  }

  section('PSA2 — real newlines dans private_key → repair retry OK');
  {
    // Simule .env.local mal-formatté par vercel env pull : real newlines au lieu de \\n
    const raw = '{"type":"service_account","project_id":"foo","private_key":"-----BEGIN-----\nMIIE\n-----END-----\n"}';
    const r = parseServiceAccountKeyDefensive(raw);
    if (r.type === 'service_account' && typeof r.private_key === 'string' && (r.private_key as string).includes('-----BEGIN-----')) {
      ok('repair retry → real newlines escaped, parse OK');
      // Vérifier que la private_key résultante contient bien des real newlines (char 10)
      // pour que Firebase Admin cert() la consomme correctement.
      if ((r.private_key as string).includes('\n')) ok('private_key contains real newlines (char 10)');
      else fail('expected real newlines in private_key', (r.private_key as string).slice(0, 50));
    } else {
      fail('unexpected', r);
    }
  }

  section('PSA3 — CR/LF mixtes → repair retry OK');
  {
    const raw = '{"type":"service_account","key":"line1\r\nline2\n"}';
    const r = parseServiceAccountKeyDefensive(raw);
    if (r.type === 'service_account' && typeof r.key === 'string') ok('CR+LF repaired');
    else fail('unexpected', r);
  }

  section('PSA4 — JSON irréparable → throw avec contexte');
  {
    try {
      parseServiceAccountKeyDefensive('this is not json {{{');
      fail('expected throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('FIREBASE_SERVICE_ACCOUNT_KEY parse failed') && msg.includes('first:') && msg.includes('retry:')) {
        ok('throw with both error contexts');
      } else {
        fail('unexpected message', msg);
      }
    }
  }

  console.log(`\n====== Résumé parse-service-account ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
