import rigSpecJson from "@shared/rig-spec.json";

/**
 * Numbers the web viewer and the API's Blender renderer must agree on (shared/rig-spec.json):
 * body-shape bone factors, the skin detail-map reference, iris UV layout.
 */
export const RIG_SPEC = rigSpecJson;

export const BODY_MODEL_URL = RIG_SPEC.body.model;

/** Maps a 0..1 slider to a factor, with 0.5 always mapping to exactly 1 (the authored body). */
export function sliderToFactor(value: number, min: number, max: number): number {
  const v = Math.min(1, Math.max(0, value));
  return v < 0.5 ? min + (1 - min) * (v / 0.5) : 1 + (max - 1) * ((v - 0.5) / 0.5);
}

export function heightScale(value: number): number {
  return sliderToFactor(value, RIG_SPEC.body.height.minScale, RIG_SPEC.body.height.maxScale);
}

export function shoulderFactor(value: number): number {
  return sliderToFactor(value, RIG_SPEC.body.shoulderWidth.minFactor, RIG_SPEC.body.shoulderWidth.maxFactor);
}

export function legFactor(value: number): number {
  return sliderToFactor(value, RIG_SPEC.body.proportion.minFactor, RIG_SPEC.body.proportion.maxFactor);
}

/** Garment stacking order for an asset: its own override, else its slot's default. */
export function garmentLayer(slot: string, override?: number): number {
  if (override !== undefined) return override;
  const layers = RIG_SPEC.garmentLayers as Record<string, number | string>;
  const value = layers[slot];
  return typeof value === "number" ? value : 3;
}
