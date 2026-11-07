import { z } from "zod";

/**
 * Category ids are data, not an enum — new categories/slots must be addable via the shared
 * catalog (shared/asset-catalog.json) without a code change (CLAUDE.md section 5/18).
 */
export const AssetMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  slot: z.string(),
  /** Attachment point — currently equal to `slot`, kept separate so a future slot rename doesn't silently change attachment semantics. */
  attachment: z.string().optional(),
  model: z.string().optional(),
  thumbnail: z.string().optional(),
  compatibleWith: z.array(z.string()).default([]),
  incompatibleWith: z.array(z.string()).default([]),
  /** Why the incompatibility exists — shown to people, useful to asset authors. */
  compatibilityNote: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Style themes the randomizer uses to build coherent outfits (e.g. "smart", "street", "summer"). */
  styles: z.array(z.string()).default([]),
  /** Explicit color list; when absent, `palette` names a shared palette from the catalog. */
  colors: z.array(z.string()).optional(),
  palette: z.string().optional(),
  /** Garment stacking override (see rig-spec.json garmentLayers) — e.g. a tucked-in top sits under the trousers. */
  layer: z.number().optional(),
  /** Always rendered (eyes, teeth...) — never user-selectable. */
  alwaysOn: z.boolean().default(false),
  /** Bumped whenever the underlying GLB/texture is regenerated; a missing value means version 1. */
  assetVersion: z.number().int().optional(),
  /** CC0 for every third-party asset today (see docs/asset-pipeline.md); "Proprietary" for our own generated ones. */
  license: z.string().optional(),
  author: z.string().optional(),
  source: z.string().optional(),
  materials: z.array(z.string()).optional(),
});

export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

export const CategoryKindSchema = z.enum(["presets", "body", "face", "eyes", "slot", "facialHair", "accessories"]);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

export const AssetCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: CategoryKindSchema,
  /** Single asset slot this category edits (kind "slot"). */
  slot: z.string().optional(),
  /** Multiple slots grouped under one category (facial hair: beard + mustache; accessories: head + face). */
  slots: z.array(z.string()).optional(),
  /** Whether the slot can be emptied. Tops/bottoms/shoes are mandatory: removing them would expose an unclothed base mesh. */
  allowNone: z.boolean().default(true),
  icon: z.string().default("dot"),
});

export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const BodyTypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  shoulderWidth: z.number().min(0).max(1),
  proportion: z.number().min(0).max(1),
});

export type BodyType = z.infer<typeof BodyTypeSchema>;

export const AssetCatalogSchema = z.object({
  version: z.number().int(),
  categories: z.array(AssetCategorySchema),
  palettes: z.record(z.string(), z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/))),
  bodyTypes: z.array(BodyTypeSchema),
  assets: z.array(AssetMetadataSchema),
});

export type AssetCatalog = z.infer<typeof AssetCatalogSchema>;
