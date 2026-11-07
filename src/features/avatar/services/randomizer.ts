import { ASSET_MANIFEST, BODY_TYPES, PALETTES, getAssetsBySlot, isIncompatible } from "../config/assetManifest";
import { AssetMetadata } from "../config/assetMetadata";
import { AvatarConfiguration } from "../config/avatarConfig";
import { FACE_MORPHS } from "../config/faceMorphs";

/** Style themes and how often each is picked. "festive" is fun but shouldn't dominate. */
const THEMES: [string, number][] = [
  ["casual", 3],
  ["smart", 2],
  ["street", 2],
  ["cozy", 2],
  ["summer", 2],
  ["sport", 1],
  ["festive", 0.4],
];

type Rng = () => number;

/** Small deterministic PRNG so tests (and "shareable seeds" later) get reproducible avatars. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: Rng, items: T[]): T | undefined => (items.length ? items[Math.floor(rng() * items.length)] : undefined);

function weighted<T>(rng: Rng, entries: [T, number][]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

/** Prefer assets tagged with the theme; fall back to the whole slot so a sparse theme never yields nothing. */
function themed(assets: AssetMetadata[], theme: string): AssetMetadata[] {
  const matching = assets.filter((a) => a.styles.includes(theme));
  return matching.length > 0 ? matching : assets;
}

function pickCompatible(rng: Rng, candidates: AssetMetadata[], selected: (string | null)[]): AssetMetadata | undefined {
  const usable = candidates.filter((a) => !isIncompatible(a.id, selected));
  return pick(rng, usable);
}

/**
 * CLAUDE.md §9: a random avatar should still look intentional. Everything is drawn from one style
 * theme (a "smart" look never mixes a tailored trouser with a novelty hat), catalog incompatibility
 * rules are respected, colors come from curated palettes, and face/body sliders stay in a moderate
 * range so results look like people, not slider-stress-tests.
 */
export function randomAvatar(base: AvatarConfiguration, rng: Rng = Math.random): AvatarConfiguration {
  const theme = weighted(rng, THEMES);
  const selected: (string | null)[] = [];
  // Mostly clearly feminine or masculine bodies, sometimes in between.
  const genderRoll = rng();
  const gender = Math.round((genderRoll < 0.45 ? 0.04 + rng() * 0.14 : genderRoll < 0.9 ? 0.82 + rng() * 0.14 : 0.35 + rng() * 0.3) * 100) / 100;
  const facialHairChance = gender > 0.6 ? 0.55 : gender > 0.4 ? 0.15 : 0;

  const hair = rng() < 0.05 ? undefined : pickCompatible(rng, themed(getAssetsBySlot("hair"), theme), selected);
  selected.push(hair?.id ?? null);
  const top = pickCompatible(rng, themed(getAssetsBySlot("top"), theme), selected);
  selected.push(top?.id ?? null);
  const bottom = pickCompatible(rng, themed(getAssetsBySlot("bottom"), theme), selected);
  selected.push(bottom?.id ?? null);
  const shoes = pickCompatible(rng, themed(getAssetsBySlot("shoes"), theme), selected);
  selected.push(shoes?.id ?? null);

  const beard = rng() < facialHairChance ? pickCompatible(rng, themed(getAssetsBySlot("beard"), theme), selected) : undefined;
  selected.push(beard?.id ?? null);
  const mustache = rng() < (beard ? 0.45 : facialHairChance * 0.2) ? pickCompatible(rng, themed(getAssetsBySlot("mustache"), theme), selected) : undefined;
  selected.push(mustache?.id ?? null);

  const accessories: string[] = [];
  for (const [slot, chance] of [["face", 0.35], ["head", theme === "festive" ? 0.8 : 0.22]] as [string, number][]) {
    if (rng() > chance) continue;
    const slotAssets = ASSET_MANIFEST.filter((a) => a.category === "accessory" && a.slot === slot);
    const choice = pickCompatible(rng, themed(slotAssets, theme), [...selected, ...accessories]);
    if (choice) accessories.push(choice.id);
  }

  const hairPalette = PALETTES.hair ?? [base.hair.color];
  const naturalHair = hairPalette.slice(0, 9);
  const hairColor = rng() < 0.88 ? pick(rng, naturalHair)! : pick(rng, hairPalette.slice(9))!;
  // Gray/white hair usually comes with a matching beard; otherwise facial hair follows the hair color.
  const facialHairColor = hairColor;

  const tops = PALETTES.tops ?? [base.clothing.topColor];
  const bottoms = PALETTES.bottoms ?? [base.clothing.bottomColor];
  const topColor = pick(rng, tops)!;
  const bottomColor = pick(rng, bottoms.filter((c) => c.toLowerCase() !== topColor.toLowerCase()))!;
  const shoesColor = pick(rng, PALETTES.shoes ?? [base.clothing.shoesColor])!;

  const accessoryColors: Record<string, string> = {};
  for (const id of accessories) {
    const asset = ASSET_MANIFEST.find((a) => a.id === id);
    const palette = asset?.colors ?? (asset?.palette ? PALETTES[asset.palette] : undefined);
    if (palette?.length) accessoryColors[id] = pick(rng, palette)!;
  }

  const bodyType = pick(rng, BODY_TYPES)!;
  const jitter = (v: number, amount: number) => Math.min(1, Math.max(0, v + (rng() * 2 - 1) * amount));

  const morphs: Record<string, number> = {};
  for (const { targets, min, max } of FACE_MORPHS) {
    // Around the base face, in both directions, never to the extremes.
    const t = rng() * 2 - 1;
    const value = rng() < 0.3 ? 0 : t >= 0 ? t * max * 0.6 : t * -min * 0.6;
    for (const target of targets) morphs[target] = Math.round(value * 100) / 100;
  }

  return {
    ...base,
    body: {
      type: bodyType.id,
      height: Math.round(jitter(0.5, 0.3) * 100) / 100,
      shoulderWidth: Math.round(jitter(bodyType.shoulderWidth, 0.06) * 100) / 100,
      proportion: Math.round(jitter(bodyType.proportion, 0.05) * 100) / 100,
      gender,
    },
    face: {
      ...base.face,
      skinTone: pick(rng, PALETTES.skin ?? [base.face.skinTone])!,
      eyeColor: pick(rng, PALETTES.eyes ?? [base.face.eyeColor])!,
      morphs,
      expression: rng() < 0.5 ? "smile" : "neutral",
    },
    hair: { style: hair?.id ?? null, color: hairColor },
    facialHair: { beardStyle: beard?.id ?? null, mustacheStyle: mustache?.id ?? null, color: facialHairColor },
    clothing: {
      top: top?.id ?? base.clothing.top,
      topColor,
      bottom: bottom?.id ?? base.clothing.bottom,
      bottomColor,
      shoes: shoes?.id ?? base.clothing.shoes,
      shoesColor,
    },
    accessories,
    accessoryColors,
  };
}
