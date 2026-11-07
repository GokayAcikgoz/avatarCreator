import catalogJson from "@shared/asset-catalog.json";
import { AssetCatalogSchema, AssetMetadata } from "./assetMetadata";

/**
 * The asset catalog, validated once at module load from shared/asset-catalog.json — the same file
 * the API seeds its Assets table from and the Blender renderer resolves models through. A schema
 * violation here is a build-time data bug, so it throws loudly instead of limping along.
 *
 * ASSET_MANIFEST is a mutable array on purpose: loadRemoteAssetsIfEnabled() (remoteAssets.ts) can
 * replace its contents in place with the API's catalog, and every consumer below picks that up.
 */
export const CATALOG = AssetCatalogSchema.parse(catalogJson);

export const ASSET_MANIFEST: AssetMetadata[] = [...CATALOG.assets];
export const CATEGORIES = CATALOG.categories;
export const PALETTES = CATALOG.palettes;
export const BODY_TYPES = CATALOG.bodyTypes;

export function alwaysOnAssets(): AssetMetadata[] {
  return ASSET_MANIFEST.filter((a) => a.alwaysOn);
}

export function getAsset(id: string | null | undefined): AssetMetadata | undefined {
  if (!id) return undefined;
  return ASSET_MANIFEST.find((a) => a.id === id);
}

export function getAssetsBySlot(slot: string): AssetMetadata[] {
  return ASSET_MANIFEST.filter((a) => a.slot === slot && !a.alwaysOn);
}

/** The swatches offered for an asset: its own `colors`, else its named palette, else none (not tintable). */
export function getAssetColors(asset: AssetMetadata | undefined): string[] {
  if (!asset) return [];
  if (asset.colors && asset.colors.length > 0) return asset.colors;
  if (asset.palette) return PALETTES[asset.palette] ?? [];
  return [];
}

/** True if `candidateId` is blocked by anything currently selected (either direction). */
export function isIncompatible(candidateId: string, selectedIds: (string | null | undefined)[]): boolean {
  return incompatibleWithSelection(candidateId, selectedIds).length > 0;
}

/** The selected ids that block `candidateId` — used to explain *why* an option is disabled. */
export function incompatibleWithSelection(candidateId: string, selectedIds: (string | null | undefined)[]): string[] {
  const candidate = getAsset(candidateId);
  if (!candidate) return [];
  const blockers: string[] = [];
  for (const selectedId of selectedIds) {
    if (!selectedId || selectedId === candidateId) continue;
    const selected = getAsset(selectedId);
    if (!selected) continue;
    // Items sharing a slot replace each other rather than conflict (one hat, one pair of glasses).
    if (selected.slot === candidate.slot) continue;
    if (candidate.incompatibleWith.includes(selectedId) || selected.incompatibleWith.includes(candidateId)) {
      blockers.push(selectedId);
    }
  }
  return blockers;
}
