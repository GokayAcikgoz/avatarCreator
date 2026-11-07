export interface FaceMorphDef {
  label: string;
  /** Underlying shape-key name(s) this slider drives — bilateral traits drive both L+R as one. */
  targets: string[];
  min: number;
  max: number;
}

/**
 * Ranges are not all 0–1 — some targets look distorted well before reaching 1.0 (verified
 * visually in-browser, see docs/asset-pipeline.md "Face system" test notes). Capping the slider
 * range is cheaper and more honest than letting the UI promise a result it can't deliver cleanly.
 *
 * Negative values run a target backwards (narrower face, smaller eyes…): verified clean down to
 * -0.6 (tools/asset-pipeline/qa_look_sheet.mjs face-sliders). 0 is always the base face.
 */
export const FACE_MORPHS: FaceMorphDef[] = [
  { label: "Face Width", targets: ["head-scale-horiz-incr"], min: -0.5, max: 1 },
  { label: "Jaw Width", targets: ["chin-width-incr"], min: -0.6, max: 1 },
  { label: "Cheeks", targets: ["l-cheek-volume-incr", "r-cheek-volume-incr"], min: 0, max: 1 },
  { label: "Eye Size", targets: ["l-eye-scale-incr", "r-eye-scale-incr"], min: -0.6, max: 0.85 },
  { label: "Eye Spacing", targets: ["l-eye-trans-out", "r-eye-trans-out"], min: -0.6, max: 0.7 },
  { label: "Nose Width", targets: ["nose-scale-horiz-incr"], min: -0.6, max: 1 },
  { label: "Nose Length", targets: ["nose-scale-vert-incr"], min: -0.6, max: 0.8 },
  { label: "Mouth Width", targets: ["mouth-scale-horiz-incr"], min: -0.6, max: 0.85 },
  { label: "Lips", targets: ["mouth-upperlip-volume-incr", "mouth-lowerlip-volume-incr"], min: -0.6, max: 1 },
];
