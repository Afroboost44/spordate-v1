/**
 * Accent feature — Helpers purs de conversion hex → HSL / RGB pour le
 * système de couleur d'accent dynamique (admin /admin/manage → "Couleur
 * principale").
 *
 * Le ThemeProvider lit `settings/site.primaryColor` (hex) en realtime puis
 * injecte plusieurs CSS variables dans document.documentElement :
 *  - --accent-color (hex direct, usage inline style + var())
 *  - --accent-color-rgb (triplet RGB, usage rgb(... / X) neon-glow)
 *  - --primary / --accent / --sidebar-primary (HSL stripped, usage tokens
 *    shadcn via Tailwind theme)
 *
 * Formats retournés (compatibles CSS) :
 *  - hexToHsl('#D91CD2') → '302 77% 48%' (stripped pour usage dans hsl(var(--X)))
 *  - hexToRgb('#D91CD2') → '217 28 210' (stripped pour usage dans rgb(var(--X) / 0.3))
 *
 * @module
 */

/** Test hex valide : '#' + 3 ou 6 chars hexadécimaux. */
export function isValidHexColor(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** Normalise un hex 3-digit en 6-digit (#FFF → #FFFFFF). */
function normalizeHex(hex: string): string {
  if (!isValidHexColor(hex)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  if (hex.length === 4) {
    return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex;
}

/** Extrait les composantes RGB (0..255) d'un hex valide. */
function hexToRgbTriplet(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

/**
 * Retourne le triplet RGB sous forme "R G B" (séparateur espace, pas de virgule)
 * pour usage dans `rgb(var(--X) / 0.3)` (CSS modern syntax).
 */
export function hexToRgb(hex: string): string {
  const { r, g, b } = hexToRgbTriplet(hex);
  return `${r} ${g} ${b}`;
}

/**
 * Conversion HSL stripped (sans `hsl(...)` wrapping), au format
 * `H S% L%` (utilisable directement dans `hsl(var(--X))` shadcn pattern).
 *
 * Algo standard RGB→HSL : https://www.w3.org/TR/css-color-3/#hsl-color
 */
export function hexToHsl(hex: string): string {
  const { r, g, b } = hexToRgbTriplet(hex);
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2;
    } else {
      h = (rNorm - gNorm) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
