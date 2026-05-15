/**
 * FEATURE QR — Tests purs des helpers du QRCodeButton.
 *
 * Couverture :
 *   QR1 — buildFilename: génère "spordateur-{slug}-{code}.png" normalisé
 *   QR2 — buildFilename: label avec accents/espaces → slug ASCII safe
 *   QR3 — buildFilename: label vide → fallback "ref"
 *   QR4 — generateQrDataUrl: retourne data:image/png;base64,...
 *   QR5 — generateQrDataUrl: url vide → throw
 *   QR6 — generateQrDataUrl: encode bien la même URL (round-trip via scan… non-trivial,
 *         on vérifie juste que le data URL change selon l'input)
 *
 * Exécution : npx tsx tests/components/qr-code-button.test.ts
 */

import { buildFilename, generateQrDataUrl } from '../../src/lib/share/qrCode';

let passes = 0;
let failures = 0;

function ok(label: string) {
  passes++;
  console.log(`  ✓ ${label}`);
}
function fail(label: string, info?: unknown) {
  failures++;
  console.error(`  ✗ ${label}`, info ?? '');
}
function section(t: string) {
  console.log(`\n--- ${t} ---`);
}

async function run() {
  // -----------------------------------------------------------------------
  section('QR1 — buildFilename: format "spordateur-{slug}-{code}.png"');
  {
    const f = buildFilename('Lien d\'invitation', 'ABC123');
    // Apostrophe → '-' (chars non [a-z0-9] remplacés) donc "d-invitation"
    if (f === 'spordateur-lien-d-invitation-ABC123.png') ok(`format OK: ${f}`);
    else fail('filename inattendu', f);
  }

  // -----------------------------------------------------------------------
  section('QR2 — buildFilename: slug ASCII safe + lowercase');
  {
    const f = buildFilename('Lien Créateur', 'XYZ-789');
    if (f === 'spordateur-lien-createur-XYZ-789.png') ok(`slug accents stripped: ${f}`);
    else fail('slug incorrect', f);
  }

  // -----------------------------------------------------------------------
  section('QR3 — buildFilename: label vide → fallback "ref"');
  {
    const f = buildFilename('', 'CODE1');
    if (f === 'spordateur-ref-CODE1.png') ok(`fallback ref: ${f}`);
    else fail('fallback inattendu', f);
  }

  // -----------------------------------------------------------------------
  section('QR3b — buildFilename: chars spéciaux strippés');
  {
    const f = buildFilename('Promo!! @2026', 'COD');
    if (f === 'spordateur-promo-2026-COD.png') ok(`chars spéciaux strippés: ${f}`);
    else fail('chars non strippés', f);
  }

  // -----------------------------------------------------------------------
  section('QR4 — generateQrDataUrl: retourne data:image/png;base64');
  {
    const url = await generateQrDataUrl('https://spordateur.com/signup?ref=ABC');
    if (url.startsWith('data:image/png;base64,')) ok(`data URL PNG OK (${url.length} chars)`);
    else fail('mauvais prefix', url.slice(0, 50));
  }

  // -----------------------------------------------------------------------
  section('QR5 — generateQrDataUrl: url vide → throw');
  {
    try {
      await generateQrDataUrl('');
      fail('aurait dû throw');
    } catch (e) {
      if (e instanceof Error && e.message.toLowerCase().includes('url')) {
        ok('throw avec message clair sur url vide');
      } else fail('mauvaise erreur', e);
    }
  }

  // -----------------------------------------------------------------------
  section('QR6 — generateQrDataUrl: data URL change selon input');
  {
    const a = await generateQrDataUrl('https://spordateur.com/signup?ref=AAA');
    const b = await generateQrDataUrl('https://spordateur.com/signup?ref=BBB');
    if (a !== b && a.length > 100 && b.length > 100) {
      ok('data URLs différents pour codes différents');
    } else fail('data URLs identiques ou trop courts', { aLen: a.length, bLen: b.length });
  }

  console.log(`\n====== Résumé qr-code-button helpers ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
