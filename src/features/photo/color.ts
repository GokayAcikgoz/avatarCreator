/** Color math for photo analysis: sRGB ↔ linear ↔ CIELAB, perceptual distance, palette snapping. */

export type RGB = [number, number, number];

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function hexToRgb(hex: string): RGB {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as RGB;
}

export function rgbToHex([r, g, b]: RGB): string {
  const to = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** sRGB (0..1) → CIELAB (D65). */
export function rgbToLab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB (D65) → sRGB (0..1, clamped). */
export function labToRgb([L, a, b]: RGB): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const lr = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const lg = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const lb = 0.0557 * x - 0.204 * y + 1.057 * z;
  return [lr, lg, lb].map((c) => Math.min(1, Math.max(0, linearToSrgb(Math.max(0, c))))) as RGB;
}

export const deltaE =(a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Nearest palette entry by CIELAB distance; `lightnessWeight` > 1 favors matching lightness. */
export function nearestInPalette(color: RGB, palette: readonly string[], lightnessWeight = 1): { hex: string; distance: number } {
  const lab = rgbToLab(color);
  let best = { hex: palette[0], distance: Infinity };
  for (const hex of palette) {
    const p = rgbToLab(hexToRgb(hex));
    const d = Math.hypot((lab[0] - p[0]) * lightnessWeight, lab[1] - p[1], lab[2] - p[2]);
    if (d < best.distance) best = { hex, distance: d };
  }
  return best;
}

/**
 * Nearest palette entry by hue and saturation, ignoring exposure: the measured color is rescaled to
 * each candidate's luminance before comparing. For small, shadowed features such as irises.
 */
export function nearestByChromaticity(color: RGB, palette: readonly string[]): { hex: string; distance: number } {
  const lin = color.map(srgbToLinear);
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let best = { hex: palette[0], distance: Infinity };
  for (const hex of palette) {
    const target = hexToRgb(hex).map(srgbToLinear);
    const k = lum(target) / Math.max(1e-4, lum(lin));
    const scaled = lin.map((c) => linearToSrgb(Math.min(1, c * k))) as RGB;
    const d = deltaE(rgbToLab(scaled), rgbToLab(hexToRgb(hex)));
    if (d < best.distance) best = { hex, distance: d };
  }
  return best;
}

/** Robust mean of colors: drops the darkest/brightest `trim` fraction (shadows, speculars), averages in linear light. */
export function robustMean(samples: RGB[], trim = 0.15): RGB | null {
  if (samples.length === 0) return null;
  const withLum = samples.map((c) => ({ c, l: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] })).sort((a, b) => a.l - b.l);
  const cut = Math.floor(withLum.length * trim);
  const kept = withLum.slice(cut, Math.max(cut + 1, withLum.length - cut));
  const sum = [0, 0, 0];
  for (const { c } of kept) for (let i = 0; i < 3; i++) sum[i] += srgbToLinear(c[i]);
  return sum.map((s) => linearToSrgb(s / kept.length)) as RGB;
}
