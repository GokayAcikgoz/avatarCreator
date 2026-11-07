/**
 * FaceAnalysis → avatar configuration suggestions, and applying the ones the person accepts.
 *
 * Everything is data-driven: hair and facial-hair styles are chosen by catalog tags (length,
 * "bangs", "stubble", "boxed", "full", "goatee", "classic"), colors snap to the catalog palettes,
 * and face sliders use shared/face-calibration.json (how each measured proportion moves when a
 * slider moves, measured on our own avatar with the same landmark model).
 */
import calibrationJson from "@shared/face-calibration.json";
import { AvatarConfiguration } from "../avatar/config/avatarConfig";
import { PALETTES, getAsset, getAssetsBySlot, isIncompatible } from "../avatar/config/assetManifest";
import { FACE_MORPHS } from "../avatar/config/faceMorphs";
import { FaceAnalysis, HairLength } from "./analyzeFace";
import { RGB, hexToRgb, labToRgb, nearestByChromaticity, nearestInPalette, rgbToHex, rgbToLab } from "./color";
import { FaceMetrics, MetricId } from "./faceMetrics";

interface Calibration {
  version: number;
  /** Average human proportions (MediaPipe's canonical face) — maps to the avatar's base face. */
  reference: Partial<FaceMetrics>;
  sliders: { label: string; metric: MetricId; perUnit: number }[];
}
const CALIBRATION = calibrationJson as Calibration;

export type TraitKey = "skin" | "eyes" | "hair" | "facialHair" | "face";

export interface PhotoSuggestion {
  skinTone: string;
  eyeColor: string | null;
  /** null = leave the hair as it is (e.g. no segmentation in this browser). */
  hair: { style: string | null; color: string; label: string } | null;
  facialHair: { beardStyle: string | null; mustacheStyle: string | null; color: string; label: string };
  /** Morph target → value, for the sliders the photo could measure. */
  morphs: Record<string, number>;
  /** Slider label → value, for display. */
  sliders: { label: string; value: number; max: number }[];
}

/** Keep a measured skin color inside the range of real skin (hue, chroma, lightness in CIELAB). */
function plausibleSkin(color: RGB): RGB {
  const [L, a, b] = rgbToLab(color);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);
  const h = Math.min((75 * Math.PI) / 180, Math.max((28 * Math.PI) / 180, hue));
  const c = Math.min(38, Math.max(9, chroma));
  return labToRgb([Math.min(88, Math.max(22, L)), c * Math.cos(h), c * Math.sin(h)]);
}

const lengthLabel: Record<HairLength, string> = { none: "No hair", short: "Short", medium: "Medium", long: "Long" };

function pickHairStyle(length: HairLength, bangs: boolean, config: AvatarConfiguration): string | null {
  if (length === "none") return null;
  const blocking = [...config.accessories];
  const fits = (id: string) => !isIncompatible(id, blocking);
  const current = getAsset(config.hair.style);
  // The person's own pick wins when it already has the right length.
  if (current && current.tags.includes(length) && current.tags.includes("bangs") === bangs && fits(current.id)) return current.id;
  const candidates = getAssetsBySlot("hair").filter((a) => a.tags.includes(length) && fits(a.id));
  const withBangs = candidates.filter((a) => a.tags.includes("bangs") === bangs);
  return (withBangs[0] ?? candidates[0])?.id ?? config.hair.style;
}

function facialHairByTag(slot: "beard" | "mustache", tag: string): string | null {
  return getAssetsBySlot(slot).find((a) => a.tags.includes(tag))?.id ?? null;
}

export function suggestFromAnalysis(analysis: FaceAnalysis, config: AvatarConfiguration): PhotoSuggestion {
  const skinTone = rgbToHex(plausibleSkin(analysis.skinTone));
  const eyeColor = analysis.eyeColor ? nearestByChromaticity(analysis.eyeColor, PALETTES.eyes ?? []).hex : null;

  let hair: PhotoSuggestion["hair"] = null;
  if (analysis.hair.analyzed) {
    const style = pickHairStyle(analysis.hair.length, analysis.hair.bangs, config);
    const color = analysis.hair.color ? nearestInPalette(analysis.hair.color, PALETTES.hair ?? [], 1.2).hex : config.hair.color;
    const name = style ? getAsset(style)?.name ?? style : "Bald";
    hair = { style, color, label: `${lengthLabel[analysis.hair.length]}${analysis.hair.bangs ? " with bangs" : ""} · ${name}` };
  }

  const fh = analysis.facialHair;
  const beardTag = { none: null, stubble: "stubble", short: "boxed", full: "full", goatee: "goatee" }[fh.beard];
  const beardStyle = beardTag ? facialHairByTag("beard", beardTag) : null;
  const mustacheStyle = fh.mustache ? facialHairByTag("mustache", "classic") : null;
  const fhColor = fh.color ? nearestInPalette(fh.color, PALETTES.hair ?? [], 1.2).hex : hair?.color ?? config.facialHair.color;
  const fhNames = [beardStyle, mustacheStyle].map((id) => getAsset(id)?.name).filter(Boolean);
  const facialHair = { beardStyle, mustacheStyle, color: fhColor, label: fhNames.length ? fhNames.join(" + ") : "Clean-shaven" };

  const morphs: Record<string, number> = {};
  const sliders: PhotoSuggestion["sliders"] = [];
  for (const slider of CALIBRATION.sliders) {
    const def = FACE_MORPHS.find((m) => m.label === slider.label);
    const reference = CALIBRATION.reference[slider.metric];
    if (!def || reference === undefined || !slider.perUnit || analysis.unreliable.includes(slider.metric)) continue;
    // A face like the average human keeps the avatar's base shape; bigger or smaller features move
    // the slider either way. One slider unit = the slider's own geometric effect, but a full range
    // always needs at least a 10 % difference in proportion — some sliders move landmarks less than
    // people naturally vary (and less than photo noise).
    const perUnit = Math.max(slider.perUnit, (0.1 * reference) / def.max);
    let value = ((analysis.metrics[slider.metric] - reference) / perUnit) * 0.9;
    value = Math.min(def.max, Math.max(def.min, value));
    if (Math.abs(value) < 0.05) value = 0;
    value = Math.round(value * 100) / 100;
    for (const target of def.targets) morphs[target] = value;
    sliders.push({ label: def.label, value, max: def.max });
  }

  return { skinTone, eyeColor, hair, facialHair, morphs, sliders };
}

/** A new configuration with the accepted traits applied (the rest of the avatar is untouched). */
export function applySuggestion(config: AvatarConfiguration, s: PhotoSuggestion, include: Record<TraitKey, boolean>): AvatarConfiguration {
  const next: AvatarConfiguration = structuredClone(config);
  if (include.skin) next.face.skinTone = s.skinTone;
  if (include.eyes && s.eyeColor) next.face.eyeColor = s.eyeColor;
  if (include.hair && s.hair) next.hair = { style: s.hair.style, color: s.hair.color };
  if (include.facialHair) next.facialHair = { beardStyle: s.facialHair.beardStyle, mustacheStyle: s.facialHair.mustacheStyle, color: s.facialHair.color };
  if (include.face) next.face.morphs = { ...next.face.morphs, ...s.morphs };
  return next;
}

/** Swatch helper for the UI. */
export const isLight = (hex: string) => rgbToLab(hexToRgb(hex))[0] > 70;
