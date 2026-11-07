import { z } from "zod";
import { EXPRESSION_IDS } from "./expressions";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unit = z.number().min(0).max(1);

/**
 * The canonical, persistable representation of an avatar (CLAUDE.md section 22). The 3D scene is
 * always rebuilt from this, never the other way around; the API stores exactly this JSON and the
 * Blender renderer reads it. `morphs` is an open record because slider parameters are
 * rig-defined (see faceMorphs.ts), not fixed at the schema level. Asset ids (hair.style,
 * facialHair.*, clothing.*, accessories) reference shared/asset-catalog.json.
 *
 * Mirrored field-for-field by AvatarForge.Domain.Configuration.AvatarConfigurationDto and
 * validated server-side by AvatarConfigurationValidator — keep all three in sync.
 */
export const AvatarConfigurationSchema = z.object({
  version: z.literal(1),
  body: z.object({
    type: z.string().max(32),
    height: unit,
    shoulderWidth: unit,
    proportion: unit,
    /** Body shape from feminine (0) to masculine (1); 0.5 is the authored in-between body. Older saves lack it. */
    gender: unit.default(0.5),
  }),
  face: z.object({
    shape: z.string().max(32),
    skinTone: hexColor,
    eyeShape: z.string().max(32),
    eyeColor: hexColor,
    eyebrows: z.string().max(32),
    nose: z.string().max(32),
    mouth: z.string().max(32),
    earShape: z.string().max(32),
    morphs: z.record(z.string(), z.number().min(-1).max(1)).default({}),
    expression: z.enum(EXPRESSION_IDS).default("neutral"),
  }),
  hair: z.object({
    style: z.string().nullable(),
    color: hexColor,
  }),
  facialHair: z.object({
    beardStyle: z.string().nullable(),
    mustacheStyle: z.string().nullable(),
    color: hexColor,
  }),
  clothing: z.object({
    top: z.string().nullable(),
    topColor: hexColor,
    bottom: z.string().nullable(),
    bottomColor: hexColor,
    shoes: z.string().nullable(),
    shoesColor: hexColor,
  }),
  accessories: z.array(z.string()).max(8).default([]),
  accessoryColors: z.record(z.string(), hexColor).default({}),
});

export type AvatarConfiguration = z.infer<typeof AvatarConfigurationSchema>;

export const DEFAULT_AVATAR_CONFIGURATION: AvatarConfiguration = {
  version: 1,
  body: { type: "average", height: 0.5, shoulderWidth: 0.5, proportion: 0.5, gender: 0.5 },
  face: {
    shape: "oval",
    skinTone: "#C68863",
    eyeShape: "almond",
    eyeColor: "#3B2415",
    eyebrows: "natural",
    nose: "straight",
    mouth: "neutral",
    earShape: "standard",
    morphs: {},
    expression: "neutral",
  },
  hair: { style: "hair_crop", color: "#3B2415" },
  facialHair: { beardStyle: null, mustacheStyle: null, color: "#3B2415" },
  clothing: {
    top: "top_crew_tee",
    topColor: "#1F3A5F",
    bottom: "bottom_wool_pants",
    bottomColor: "#495057",
    shoes: "shoes_cloth",
    shoesColor: "#F5F5F5",
  },
  accessories: [],
  accessoryColors: {},
};

/** Parses unknown input (API response, imported file, local draft) into a valid configuration or null. */
export function parseConfiguration(input: unknown): AvatarConfiguration | null {
  const result = AvatarConfigurationSchema.safeParse(input);
  return result.success ? result.data : null;
}
