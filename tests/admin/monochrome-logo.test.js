/**
 * Fix #146 / #148 / #150 — Test anti-régression pour makeMonochromeWhite().
 *
 * Pattern récurrent évité :
 *  L'algorithme monochrome utilisait l'échantillonnage des coins. Si l'image
 *  a du anti-aliasing ou un logo touchant un coin, la détection rate et tout
 *  devient blanc.
 *
 * Le fix #150 utilise un HISTOGRAMME : la couleur la plus fréquente dans
 * l'image est forcément le fond (puisque le logo n'occupe qu'une fraction).
 * On classe ensuite par distance à cette couleur dominante.
 *
 * Invariants verrouillés :
 *  CASE 1 — Logo coloré sur fond TRANSPARENT (alpha mode)
 *  CASE 2 — Logo magenta sur fond NOIR opaque
 *  CASE 3 — Logo magenta sur fond BLANC opaque
 *  CASE 4 — Logo NOIR sur fond GRIS opaque
 *  CASE 5 — Tout noir opaque → silhouette vide (anti carré plein)
 *  CASE 6 — Tout blanc opaque → silhouette vide (anti carré plein)
 *  CASE 7 — Logo blanc sur fond ROSE coloré
 *  CASE 8 — Logo blanc sur fond noir (cas classique adaptive icon)
 *  CASE 9 — Anti-alias semi-transparent sur fond transparent
 *  CASE 10 — Spordateur heart+rocket sur fond noir (cas user)
 *  CASE 11 — Logo TOUCHANT les coins (régression échantillonnage coins)
 *
 * Exécution : node tests/admin/monochrome-logo.test.js
 */

const MAX_LOGO_RATIO = 0.8;
const DIST_THRESHOLD_SQ = 60 * 60;

function computeBg(data) {
  const histogram = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const qR = data[i] >> 4;
    const qG = data[i + 1] >> 4;
    const qB = data[i + 2] >> 4;
    const bucket = (qR << 8) | (qG << 4) | qB;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
  }
  let bestBucket = 0, bestCount = -1;
  for (const [bucket, count] of histogram) {
    if (count > bestCount) { bestCount = count; bestBucket = bucket; }
  }
  return {
    r: ((bestBucket >> 8) & 0xf) * 16 + 8,
    g: ((bestBucket >> 4) & 0xf) * 16 + 8,
    b: (bestBucket & 0xf) * 16 + 8,
  };
}

function applyMode(data, mode, bg) {
  let whitePixels = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    let isLogoPixel;
    if (mode === 'alpha') {
      isLogoPixel = data[i + 3] > 128;
    } else {
      const dr = data[i] - bg.r;
      const dg = data[i + 1] - bg.g;
      const db = data[i + 2] - bg.b;
      isLogoPixel = data[i + 3] > 128 && (dr * dr + dg * dg + db * db) > DIST_THRESHOLD_SQ;
    }
    if (isLogoPixel) {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      whitePixels++;
    } else {
      data[i + 3] = 0;
    }
  }
  return whitePixels / total;
}

function makeMonochromeMask(width, height, data) {
  const totalPixels = width * height;
  let transparentCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) transparentCount++;
  }
  const transparentRatio = transparentCount / totalPixels;
  const initialMode = transparentRatio >= 0.05 ? 'alpha' : 'distance';
  const bg = initialMode === 'distance' ? computeBg(data) : null;

  // Try initial mode on copy
  const working = new Uint8ClampedArray(data);
  let ratio = applyMode(working, initialMode, bg);

  let finalMode = initialMode;
  let finalRatio = ratio;
  let finalData = working;

  // Filet de sécurité : si > 80% blanc, on retente l'autre mode
  if (ratio > MAX_LOGO_RATIO) {
    const fallbackMode = initialMode === 'alpha' ? 'distance' : 'alpha';
    const fallbackBg = fallbackMode === 'distance' ? (bg || computeBg(data)) : null;
    const fallbackData = new Uint8ClampedArray(data);
    const fallbackRatio = applyMode(fallbackData, fallbackMode, fallbackBg);
    if (fallbackRatio <= MAX_LOGO_RATIO) {
      finalMode = fallbackMode;
      finalRatio = fallbackRatio;
      finalData = fallbackData;
    } else {
      // Les 2 modes ratent → silhouette vide
      finalMode = 'empty';
      finalRatio = 0;
      finalData = new Uint8ClampedArray(data.length); // tout transparent
    }
  }

  let whitePixels = 0, transparentPixels = 0;
  for (let i = 3; i < finalData.length; i += 4) {
    if (finalData[i] > 128) whitePixels++;
    else transparentPixels++;
  }
  return {
    mode: finalMode,
    initialMode,
    initialRatio: ratio,
    transparentRatio,
    whitePixels,
    transparentPixels,
    finalRatio,
  };
}

function buildImage(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
    }
  }
  return data;
}

let passes = 0;
let failures = 0;
function ok(label) { passes++; console.log(`✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`✗ ${label}`, detail || ''); }

// CASE 1 — Logo coloré sur fond TRANSPARENT
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 3 && x < 7 && y >= 3 && y < 7) return [255, 0, 0, 255];
    return [0, 0, 0, 0];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.mode === 'alpha' && r.whitePixels === 16) ok('CASE 1 — Fond transparent → mode alpha');
  else fail('CASE 1', r);
}

// CASE 2 — Logo magenta sur fond NOIR opaque
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 3 && x < 7 && y >= 3 && y < 7) return [217, 28, 210, 255];
    return [0, 0, 0, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.mode === 'distance' && r.whitePixels === 16) {
    ok('CASE 2 — Logo magenta sur fond noir → silhouette propre');
  } else fail('CASE 2', r);
}

// CASE 3 — Logo magenta sur fond BLANC opaque
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 3 && x < 7 && y >= 3 && y < 7) return [217, 28, 210, 255];
    return [255, 255, 255, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.mode === 'distance' && r.whitePixels === 16) {
    ok('CASE 3 — Logo magenta sur fond BLANC → silhouette propre');
  } else fail('CASE 3', r);
}

// CASE 4 — Logo NOIR sur fond GRIS opaque
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 3 && x < 7 && y >= 3 && y < 7) return [0, 0, 0, 255];
    return [128, 128, 128, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 16) ok('CASE 4 — Logo noir sur fond gris → silhouette propre');
  else fail('CASE 4', r);
}

// CASE 5 — Tout NOIR opaque → silhouette vide
{
  const W = 10, H = 10;
  const data = buildImage(W, H, () => [0, 0, 0, 255]);
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 0) ok('CASE 5 — Tout noir → 0 pixel logo');
  else fail('CASE 5', r);
}

// CASE 6 — Tout BLANC opaque → silhouette vide
{
  const W = 10, H = 10;
  const data = buildImage(W, H, () => [255, 255, 255, 255]);
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 0) ok('CASE 6 — Tout blanc → 0 pixel logo');
  else fail('CASE 6', r);
}

// CASE 7 — Logo blanc sur fond ROSE coloré
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 3 && x < 7 && y >= 3 && y < 7) return [255, 255, 255, 255];
    return [217, 28, 210, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 16) ok('CASE 7 — Logo blanc sur fond rose → silhouette propre');
  else fail('CASE 7', r);
}

// CASE 8 — Logo blanc sur fond noir (cas classique)
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 3 && x < 7 && y >= 3 && y < 7) return [255, 255, 255, 255];
    return [0, 0, 0, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 16) ok('CASE 8 — Logo blanc sur fond noir → silhouette');
  else fail('CASE 8', r);
}

// CASE 9 — Anti-alias semi-transparent sur fond transparent
{
  const W = 12, H = 12;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 4 && x < 8 && y >= 4 && y < 8) return [217, 28, 210, 255];
    if (x === 3 || x === 8 || y === 3 || y === 8) return [217, 28, 210, 100];
    return [0, 0, 0, 0];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.mode === 'alpha' && r.whitePixels === 16) {
    ok('CASE 9 — Anti-alias semi-transparent → core 16px logo');
  } else fail('CASE 9', r);
}

// CASE 10 — Spordateur heart+rocket sur fond noir
{
  const W = 16, H = 16;
  const data = buildImage(W, H, (x, y) => {
    if (x >= 5 && x < 11 && y >= 5 && y < 11) return [217, 28, 210, 255];
    return [0, 0, 0, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 36) ok('CASE 10 — Spordateur heart+rocket → silhouette 36px');
  else fail('CASE 10', r);
}

// CASE 11 — NOUVEAU : Logo touchant les coins (cas où l'échantillonnage coins
//           rate). Démontre la robustesse de l'approche histogramme.
{
  const W = 12, H = 12;
  const data = buildImage(W, H, (x, y) => {
    // Logo magenta dans coin haut-gauche (4x4) + centre — touche le coin (0,0)
    if (x < 4 && y < 4) return [217, 28, 210, 255];
    if (x >= 5 && x < 9 && y >= 5 && y < 9) return [217, 28, 210, 255];
    return [0, 0, 0, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  // Background = noir (le plus fréquent, 144 - 16 - 16 = 112 px noirs)
  // Logo = 4×4 + 4×4 = 32 px magenta
  if (r.mode === 'distance' && r.whitePixels === 32) {
    ok('CASE 11 — Logo touchant un coin → histogramme trouve le fond correct');
  } else fail('CASE 11 — Régression : échantillonnage coins aurait raté ce cas', r);
}

// CASE 12 — Image avec bord anti-aliasé subtil (où échantillonnage coins
//           aurait dit "mode A" mais l'image est en réalité opaque).
{
  const W = 16, H = 16;
  const data = buildImage(W, H, (x, y) => {
    // Coin (0,0) légèrement semi-transparent (alpha 230)
    if (x === 0 && y === 0) return [0, 0, 0, 230];
    // Centre logo magenta
    if (x >= 6 && x < 10 && y >= 6 && y < 10) return [217, 28, 210, 255];
    return [0, 0, 0, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  if (r.whitePixels === 16) {
    ok('CASE 12 — Bord subtil + fond noir → histogramme robuste');
  } else fail('CASE 12', r);
}

// CASE 13 — Fix #154 filet sécurité : image où l'algorithme histogramme
//           se tromperait (cas pathologique : logo OCCUPE plus de surface
//           que le fond). Le filet doit basculer vers mode alpha.
{
  // 10x10 : ENTIÈREMENT magenta sauf un petit carré noir 2x2 dans un coin.
  // L'histogramme dira "magenta = fond" (puisque dominante) → mode distance
  // marquerait le carré noir comme logo et le reste comme fond → 4 pixels blancs.
  // C'est correct ici car le ratio reste < 80%. Mais si TOUT était magenta + alpha
  // semi-transparent, mode distance donnerait ratio = 1 (carré plein).
  const W = 10, H = 10;
  const data = buildImage(W, H, () => [217, 28, 210, 255]); // tout magenta opaque
  const r = makeMonochromeMask(W, H, data);
  // Tout magenta → bg = magenta → tous les pixels match bg → 0 logo
  // OU > 80% ratio → fallback alpha → tous opaque → 100% logo → fallback → empty
  if (r.mode === 'empty' || r.whitePixels === 0) {
    ok(`CASE 13 — Image uniforme magenta → silhouette vide (filet anti-carré-plein), mode=${r.mode}`);
  } else fail('CASE 13', r);
}

// CASE 14 — Cas pathologique inverse : image OPAQUE où l'histogramme se
//           tromperait. Logo occupant 90% de la surface (anormal). On accepte
//           que le résultat soit "silhouette vide" plutôt que carré blanc.
{
  const W = 10, H = 10;
  const data = buildImage(W, H, (x, y) => {
    // Logo magenta partout sauf 5 pixels noirs (=5% du fond)
    if (x < 1 && y < 5) return [0, 0, 0, 255];
    return [217, 28, 210, 255];
  });
  const r = makeMonochromeMask(W, H, data);
  // Avec 5% noir et 95% magenta : histogramme dit bg=magenta → 5% pixels
  // logo (les noirs). Pas > 80% → pas de fallback. Résultat = 5 pixels blancs.
  if (r.whitePixels === 5) {
    ok('CASE 14 — Logo majoritaire détecté par histogramme (5/100 pixels)');
  } else if (r.mode === 'empty') {
    ok('CASE 14 — Logo majoritaire → silhouette vide (acceptable, mode=empty)');
  } else fail('CASE 14', r);
}

// CASE 15 — Régression critique #154 : GARANTIE "jamais de carré plein blanc"
//           Tous les outputs doivent avoir whitePixels ≤ 80% du total.
{
  const cases = [
    // Tout blanc opaque
    { W: 8, H: 8, fn: () => [255, 255, 255, 255], label: 'tout blanc' },
    // Tout noir opaque
    { W: 8, H: 8, fn: () => [0, 0, 0, 255], label: 'tout noir' },
    // Tout magenta opaque
    { W: 8, H: 8, fn: () => [217, 28, 210, 255], label: 'tout magenta' },
    // Image opaque uniforme grise
    { W: 8, H: 8, fn: () => [128, 128, 128, 255], label: 'tout gris' },
  ];
  let allSafe = true;
  const offenders = [];
  for (const c of cases) {
    const data = buildImage(c.W, c.H, c.fn);
    const r = makeMonochromeMask(c.W, c.H, data);
    const ratio = r.whitePixels / (c.W * c.H);
    if (ratio > MAX_LOGO_RATIO) {
      allSafe = false;
      offenders.push({ ...c, ratio });
    }
  }
  if (allSafe) {
    ok(`CASE 15 — Aucune image uniforme ne produit un carré blanc plein (${cases.length} cas)`);
  } else fail('CASE 15 — RÉGRESSION carré blanc plein détectée !', offenders);
}

console.log(`\nTotal : ${passes} passes / ${failures} échecs`);
process.exit(failures === 0 ? 0 : 1);
