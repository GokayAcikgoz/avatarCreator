/**
 * Photo → facial traits. Pure and deterministic: given the photo's pixels, MediaPipe's face
 * landmarks/blendshapes and the hair segmentation mask, it measures what an avatar can express —
 * skin tone, eye color, hair color / length / bangs, facial hair, and face proportions.
 *
 * Deliberately NOT inferred: gender, age, ethnicity or anything else about who the person is. The
 * avatar body is the same for everyone; only visible, editable traits are suggested, and every
 * suggestion is shown to the person before it is applied.
 */
import { RGB, deltaE, linearToSrgb, rgbToLab, robustMean, srgbToLinear } from "./color";
import { FaceMetrics, LM, Point3, faceMetrics, headPose, toPixels } from "./faceMetrics";

export interface PhotoInput {
  width: number;
  height: number;
  /** RGBA, row-major, top-down (ImageData.data). */
  pixels: Uint8ClampedArray;
  /** One face's normalized landmarks (x, y in 0..1 of the image). */
  landmarks: Point3[];
  blendshapes: Record<string, number>;
  /** Hair confidence 0..1 per pixel (maskWidth × maskHeight), or null when segmentation is unavailable. */
  hairMask: Float32Array | null;
  maskWidth?: number;
  maskHeight?: number;
}

export type HairLength = "none" | "short" | "medium" | "long";
export type BeardKind = "none" | "stubble" | "short" | "full" | "goatee";

export interface FaceAnalysis {
  skinTone: RGB;
  eyeColor: RGB | null;
  hair: { analyzed: boolean; present: boolean; color: RGB | null; length: HairLength; bangs: boolean };
  facialHair: { beard: BeardKind; mustache: boolean; color: RGB | null; darkening: Record<"chin" | "jaw" | "cheeks" | "upperLip", number> };
  metrics: FaceMetrics;
  /** Metrics that are unreliable in this photo (e.g. mouth width while smiling). */
  unreliable: (keyof FaceMetrics)[];
  pose: { yaw: number; pitch: number };
  faceHeightPx: number;
  warnings: string[];
}

// Landmark groups (subject's right/left). Skin: cheeks + forehead; avoiding nose (shine) and lips.
const SKIN_POINTS = [50, 280, 101, 330, 151, 108, 337, 117, 346];
const CHIN_POINTS = [152, 148, 377, 175, 199, 200];
const JAW_POINTS = [172, 136, 150, 397, 365, 379];
const LOW_CHEEK_POINTS = [205, 425, 207, 427, 216, 436];
/** Upper-lip skin: 45 % of the way from points on the lip border to points under the nose. */
const UPPER_LIP_PAIRS: [number, number][] = [
  [0, 164],
  [37, 165],
  [267, 391],
  [39, 167],
  [269, 393],
];

export function analyzeFace(input: PhotoInput): FaceAnalysis {
  const { width, height, pixels } = input;
  const pts = toPixels(input.landmarks, width, height);
  const p = (i: number) => pts[i];
  const faceH = Math.hypot(p(LM.foreheadTop).x - p(LM.chin).x, p(LM.foreheadTop).y - p(LM.chin).y);
  const center = { x: (p(LM.faceRight).x + p(LM.faceLeft).x) / 2, y: (p(LM.foreheadTop).y + p(LM.chin).y) / 2 };
  const warnings: string[] = [];

  const maskW = input.maskWidth ?? width;
  const maskH = input.maskHeight ?? height;
  const hairAt = (x: number, y: number) => {
    if (!input.hairMask) return 0;
    const mx = Math.min(maskW - 1, Math.max(0, Math.round((x / width) * maskW)));
    const my = Math.min(maskH - 1, Math.max(0, Math.round((y / height) * maskH)));
    return input.hairMask[my * maskW + mx];
  };
  const rgbAt = (x: number, y: number): RGB | null => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
    const o = (iy * width + ix) * 4;
    return [pixels[o] / 255, pixels[o + 1] / 255, pixels[o + 2] / 255];
  };
  /** Pixels in a disc, optionally pulled toward the face center (keeps jaw samples off the background). */
  const patch = (at: { x: number; y: number }, radius: number, { inward = 0, skipHair = false } = {}): RGB[] => {
    const cx = at.x + (center.x - at.x) * inward;
    const cy = at.y + (center.y - at.y) * inward;
    const out: RGB[] = [];
    const r = Math.max(1, Math.round(radius));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (skipHair && hairAt(cx + dx, cy + dy) > 0.5) continue;
        const c = rgbAt(cx + dx, cy + dy);
        if (c) out.push(c);
      }
    }
    return out;
  };
  const sampleGroup = (indices: number[], radius: number, opts?: { inward?: number; skipHair?: boolean }) => indices.flatMap((i) => patch(p(i), radius, opts));

  // ── White balance from the sclera (eye whites), applied at half strength and within ±15 %.
  const scleraSamples = [
    patch({ x: (p(LM.eyeRightOuter).x + p(LM.irisRight).x) / 2, y: (p(LM.eyeRightOuter).y + p(LM.irisRight).y) / 2 }, faceH * 0.008),
    patch({ x: (p(LM.eyeLeftOuter).x + p(LM.irisLeft).x) / 2, y: (p(LM.eyeLeftOuter).y + p(LM.irisLeft).y) / 2 }, faceH * 0.008),
  ].flat();
  let gains: RGB = [1, 1, 1];
  const sclera = robustMean(scleraSamples, 0.25);
  if (sclera && rgbToLab(sclera)[0] > 55) {
    const lin = sclera.map(srgbToLinear);
    const lum = (lin[0] + lin[1] + lin[2]) / 3;
    // Healthy sclera is a slightly warm white; correct toward that, gently.
    const target = [1.02, 1.0, 0.96];
    gains = lin.map((c, i) => Math.min(1.15, Math.max(0.85, 1 + (((lum * target[i]) / Math.max(c, 1e-4)) - 1) * 0.5))) as RGB;
  }
  const balance = (c: RGB | null): RGB | null => (c ? (c.map((v, i) => linearToSrgb(Math.min(1, srgbToLinear(v) * gains[i]))) as RGB) : null);

  // ── Skin.
  const skin = balance(robustMean(sampleGroup(SKIN_POINTS, faceH * 0.025, { skipHair: true }), 0.2)) ?? [0.78, 0.53, 0.39];
  const skinLab = rgbToLab(skin);
  if (skinLab[0] < 22) warnings.push("The photo is quite dark — skin tone may come out darker than it is.");
  if (skinLab[0] > 92) warnings.push("The photo is very bright — skin tone may come out lighter than it is.");

  // ── Eyes: iris ring between pupil and limbus, inside the eyelids, no reflections.
  const eyesClosed = Math.max(input.blendshapes.eyeBlinkLeft ?? 0, input.blendshapes.eyeBlinkRight ?? 0) > 0.55;
  let eyeColor: RGB | null = null;
  if (!eyesClosed) {
    const irisSamples: RGB[] = [];
    for (const [c, edge, top, bottom] of [
      [LM.irisRight, LM.irisRight + 1, LM.eyeRightTop, LM.eyeRightBottom],
      [LM.irisLeft, LM.irisLeft + 1, LM.eyeLeftTop, LM.eyeLeftBottom],
    ]) {
      if (!p(c) || !p(edge)) continue;
      const r = Math.hypot(p(edge).x - p(c).x, p(edge).y - p(c).y);
      const yMin = Math.min(p(top).y, p(bottom).y);
      const yMax = Math.max(p(top).y, p(bottom).y);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const d = Math.hypot(dx, dy) / Math.max(r, 1e-3);
          const y = p(c).y + dy;
          if (d < 0.38 || d > 0.85 || y < yMin + 1 || y > yMax - 1) continue;
          const px = rgbAt(p(c).x + dx, y);
          if (px) irisSamples.push(px);
        }
      }
    }
    eyeColor = irisSamples.length >= 12 ? balance(robustMean(irisSamples, 0.25)) : null;
  }

  // ── Hair: the segmentation mask when it sees hair; otherwise a color model (some stylized or
  // unusual hair is missed by the segmenter): hair is the color just above the forehead that is
  // neither skin nor background.
  const faceW = Math.hypot(p(LM.faceRight).x - p(LM.faceLeft).x, p(LM.faceRight).y - p(LM.faceLeft).y);
  const top = p(LM.foreheadTop);
  const chin = p(LM.chin);
  const step = Math.max(1, Math.round(faceH / 90));
  const fraction = (test: (x: number, y: number) => boolean, x0: number, x1: number, y0: number, y1: number) => {
    let hit = 0;
    let all = 0;
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y += step) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x += step) {
        all++;
        if (test(x, y)) hit++;
      }
    }
    return all ? hit / all : 0;
  };
  const crownBox = [center.x - faceW * 0.6, center.x + faceW * 0.6, top.y - faceH * 0.45, top.y + faceH * 0.05] as const;
  const maskSaysHair = (x: number, y: number) => hairAt(x, y) > 0.5;

  let hairLike: ((x: number, y: number) => boolean) | null = null;
  let hairSource: "mask" | "color" | null = null;
  if (input.hairMask && fraction(maskSaysHair, ...crownBox) > 0.12) {
    hairLike = maskSaysHair;
    hairSource = "mask";
  } else {
    const candidate = robustMean(
      [
        ...patch({ x: center.x, y: top.y - faceH * 0.1 }, faceH * 0.04),
        ...patch({ x: center.x - faceW * 0.3, y: top.y - faceH * 0.02 }, faceH * 0.03),
        ...patch({ x: center.x + faceW * 0.3, y: top.y - faceH * 0.02 }, faceH * 0.03),
      ],
      0.2
    );
    const background = robustMean([...patch({ x: width * 0.04, y: height * 0.04 }, 6), ...patch({ x: width * 0.96, y: height * 0.04 }, 6)], 0.2);
    const bgLab = background ? rgbToLab(background) : null;
    if (candidate) {
      const hairLab = rgbToLab(candidate);
      if (deltaE(hairLab, skinLab) > 14 && (!bgLab || deltaE(hairLab, bgLab) > 14)) {
        hairLike = (x, y) => {
          const c = rgbAt(x, y);
          if (!c) return false;
          const lab = rgbToLab(c);
          return deltaE(lab, hairLab) < 18 && deltaE(lab, skinLab) > 12 && (!bgLab || deltaE(lab, bgLab) > 12);
        };
        hairSource = "color";
      }
    }
  }

  let hair: FaceAnalysis["hair"] = { analyzed: Boolean(input.hairMask) || hairSource !== null, present: false, color: null, length: "none", bangs: false };
  if (hairLike && fraction(hairLike, ...crownBox) > 0.12) {
    const like = hairLike;
    // Length: the lowest row where either side of the head still has hair.
    let bottom = -Infinity;
    for (let y = chin.y - faceH * 0.6; y < height; y += step) {
      const left = fraction(like, p(LM.faceLeft).x - faceW * 0.05, p(LM.faceLeft).x + faceW * 0.45, y, y + step);
      const right = fraction(like, p(LM.faceRight).x - faceW * 0.45, p(LM.faceRight).x + faceW * 0.05, y, y + step);
      if (Math.max(left, right) > 0.2) bottom = y;
    }
    const reachesEdge = bottom >= height - step * 2;
    const below = (bottom - chin.y) / faceH;
    const length: HairLength = reachesEdge || below > 0.35 ? "long" : below > -0.3 ? "medium" : "short";
    const bangs = fraction(like, p(LM.eyeRightInner).x - faceW * 0.1, p(LM.eyeLeftInner).x + faceW * 0.1, top.y + faceH * 0.04, top.y + faceH * 0.2) > 0.35;
    const hairSamples: RGB[] = [];
    for (let y = Math.max(0, top.y - faceH * 0.5); y < Math.min(height, chin.y + faceH * 0.8); y += step) {
      for (let x = Math.max(0, center.x - faceW * 1.1); x < Math.min(width, center.x + faceW * 1.1); x += step) {
        if (hairSource === "mask" ? hairAt(x, y) > 0.85 : like(x, y)) {
          const c = rgbAt(x, y);
          if (c) hairSamples.push(c);
        }
      }
    }
    hair = { analyzed: true, present: true, color: balance(robustMean(hairSamples, 0.2)), length, bangs };
  }
  if (!hair.analyzed) warnings.push("Hair couldn't be analyzed in this photo — hair was left unchanged.");

  // ── Facial hair: the hair segmenter also marks beards and mustaches (strong evidence); failing
  // that, how much darker than the cheeks/forehead the beard areas are (CIELAB lightness). The jaw
  // line is only reported (shadows and long hair make it unreliable).
  const r = faceH * 0.022;
  const regionL = (samples: RGB[]) => {
    const c = balance(robustMean(samples, 0.2));
    return c ? rgbToLab(c)[0] : skinLab[0];
  };
  const between = (a: number, b: number, t: number) => ({ x: p(a).x + (p(b).x - p(a).x) * t, y: p(a).y + (p(b).y - p(a).y) * t });
  const lipPoints = UPPER_LIP_PAIRS.map(([a, b]) => between(a, b, 0.45));
  const lipSamples = lipPoints.flatMap((pt) => patch(pt, r * 0.8));
  const darkening = {
    chin: skinLab[0] - regionL(sampleGroup(CHIN_POINTS, r, { inward: 0.12 })),
    jaw: skinLab[0] - regionL(sampleGroup(JAW_POINTS, r, { inward: 0.15 })),
    cheeks: skinLab[0] - regionL(sampleGroup(LOW_CHEEK_POINTS, r)),
    upperLip: skinLab[0] - regionL(lipSamples),
  };
  const maskAt = (pts: { x: number; y: number }[]) => pts.reduce((sum, pt) => sum + hairAt(pt.x, pt.y), 0) / pts.length;
  const maskChin = maskAt(CHIN_POINTS.map(p));
  const maskCheeks = maskAt(LOW_CHEEK_POINTS.map(p));
  const maskLip = maskAt(lipPoints);
  let beard: BeardKind = "none";
  if (maskChin > 0.45 && maskCheeks > 0.45) beard = maskCheeks > 0.6 || darkening.cheeks > 30 ? "full" : "short";
  // A goatee is a strong chin against clean cheeks; stubble darkens both, the chin a bit more.
  else if (maskChin > 0.45 && darkening.chin > 25) beard = "goatee";
  else if (darkening.chin > 30 && darkening.cheeks > 30) beard = "full";
  else if (darkening.chin > 22 && darkening.cheeks > 16) beard = "short";
  else if (darkening.chin > 16 && darkening.chin - darkening.cheeks > 18) beard = "goatee";
  else if (darkening.chin > 7 && darkening.cheeks > 4) beard = "stubble";
  const mustache = beard !== "stubble" && (maskLip > 0.45 || darkening.upperLip > 14);
  let facialHairColor: RGB | null = null;
  if (beard !== "none" || mustache) {
    // The darker half of the beard samples is the hair itself; the rest is skin showing through.
    const samples = beard === "none" ? lipSamples : [...sampleGroup(CHIN_POINTS, r, { inward: 0.1 }), ...lipSamples];
    const sorted = samples.map((c) => ({ c, l: rgbToLab(c)[0] })).sort((a, b) => a.l - b.l);
    facialHairColor = balance(robustMean(sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2))).map((s) => s.c), 0.1));
    // Stubble is mostly skin: take the hair color when we have one.
    if (beard === "stubble" && hair.color) facialHairColor = hair.color;
  }

  // ── Proportions.
  const metrics = faceMetrics(pts);
  const unreliable: (keyof FaceMetrics)[] = [];
  const smile = Math.max(input.blendshapes.mouthSmileLeft ?? 0, input.blendshapes.mouthSmileRight ?? 0);
  if (smile > 0.45 || (input.blendshapes.jawOpen ?? 0) > 0.25) unreliable.push("mouthWidth", "lipThickness");
  const pose = headPose(pts);
  if (Math.abs(pose.yaw) > 0.3) {
    warnings.push("Your head is turned — face proportions are less accurate. A straight-on photo works best.");
    unreliable.push("faceWidth", "jawWidth", "eyeSpacing");
  }
  if (faceH < 140) warnings.push("The face is small in this photo — move closer for more accurate results.");
  if (eyesClosed) warnings.push("Eyes look closed — eye color was left unchanged.");

  return {
    skinTone: skin,
    eyeColor,
    hair,
    facialHair: { beard, mustache, color: facialHairColor, darkening },
    metrics,
    unreliable,
    pose,
    faceHeightPx: faceH,
    warnings,
  };
}
