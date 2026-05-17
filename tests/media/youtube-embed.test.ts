/**
 * BUG #30 Étape 1 — Tests purs buildYoutubeDetailEmbedUrl.
 *
 * Le helper construit l'URL iframe YouTube pour la page DÉTAIL avec params
 * qui minimisent le branding YouTube et empêchent les redirections externes :
 *  - controls=1  : user controls (play/pause/timeline/volume) — DÉTAIL vs LISTE
 *  - modestbranding=1 : pas de gros logo YouTube
 *  - rel=0       : pas de vidéos suggérées à la fin
 *  - iv_load_policy=3 : pas d'annotations (cartes / écrans de fin)
 *  - disablekb=1 : pas de raccourcis clavier qui peuvent ouvrir YT UI
 *  - fs=1        : autorise fullscreen
 *  - playsinline=1 : iOS Safari respecte autoplay/inline (pas de hard fullscreen)
 *
 * Note : le mini-logo YouTube bottom-right est obligatoire par YT ToS,
 * impossible à retirer.
 *
 * Couverture (YT1-YT8) :
 *   YT1 — videoId vide / null → null
 *   YT2 — videoId valide → URL débute par youtube.com/embed/{id}
 *   YT3 — URL contient controls=1
 *   YT4 — URL contient modestbranding=1
 *   YT5 — URL contient rel=0
 *   YT6 — URL contient iv_load_policy=3
 *   YT7 — URL contient disablekb=1 + fs=1 + playsinline=1
 *   YT8 — videoId whitespace → null
 *
 * Exécution : npx tsx tests/media/youtube-embed.test.ts
 */

import { buildYoutubeDetailEmbedUrl } from '../../src/lib/media/youtubeEmbed';

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
  section('YT1 — videoId vide / null → null');
  {
    if (buildYoutubeDetailEmbedUrl('') === null && buildYoutubeDetailEmbedUrl(null) === null && buildYoutubeDetailEmbedUrl(undefined) === null) ok('defensive nulls');
    else fail('unexpected');
  }

  section('YT2 — URL débute par youtube.com/embed/{id}');
  {
    const url = buildYoutubeDetailEmbedUrl('dQw4w9WgXcQ');
    if (url?.startsWith('https://www.youtube.com/embed/dQw4w9WgXcQ?')) ok('embed path OK');
    else fail('unexpected', url);
  }

  // Helper extract params for testing
  const params = (() => {
    const u = buildYoutubeDetailEmbedUrl('dQw4w9WgXcQ');
    if (!u) return new URLSearchParams();
    return new URL(u).searchParams;
  })();

  section('YT3 — controls=1 (user controls DÉTAIL)');
  if (params.get('controls') === '1') ok('controls=1'); else fail('unexpected', params.get('controls'));

  section('YT4 — modestbranding=1');
  if (params.get('modestbranding') === '1') ok('modestbranding=1'); else fail('unexpected', params.get('modestbranding'));

  section('YT5 — rel=0 (pas de related videos)');
  if (params.get('rel') === '0') ok('rel=0'); else fail('unexpected', params.get('rel'));

  section('YT6 — iv_load_policy=3 (pas d\'annotations)');
  if (params.get('iv_load_policy') === '3') ok('iv_load_policy=3'); else fail('unexpected', params.get('iv_load_policy'));

  section('YT7 — disablekb=1 + fs=1 + playsinline=1');
  if (
    params.get('disablekb') === '1'
    && params.get('fs') === '1'
    && params.get('playsinline') === '1'
  ) ok('disablekb + fs + playsinline = 1');
  else fail('unexpected', { disablekb: params.get('disablekb'), fs: params.get('fs'), playsinline: params.get('playsinline') });

  section('YT8 — videoId whitespace → null');
  {
    if (buildYoutubeDetailEmbedUrl('   ') === null) ok('whitespace → null');
    else fail('unexpected');
  }

  console.log(`\n====== Résumé youtube-embed ======`);
  console.log(`PASS : ${passes}`);
  console.log(`FAIL : ${failures}`);
  console.log(`Total: ${passes + failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
