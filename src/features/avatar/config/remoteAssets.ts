import { AssetMetadata } from "./assetMetadata";
import { ASSET_MANIFEST } from "./assetManifest";

/**
 * CLAUDE.md Phase 7 section 22 — feature-flagged remote asset catalog, off by default.
 * `NEXT_PUBLIC_USE_REMOTE_ASSETS=true` + `NEXT_PUBLIC_AVATARFORGE_API_URL` +
 * `NEXT_PUBLIC_AVATARFORGE_API_KEY` switch the editor to fetch its manifest from the
 * ASP.NET Core API instead of the local bundled manifest.
 *
 * The API key being readable in client-side JS here is a known, accepted limitation for this
 * dev-testing flag — never point it at a production key. A real product would proxy this through
 * a backend-for-frontend so the raw key never reaches the browser; that's explicitly out of scope
 * for "test the asset catalog API from the existing web app" (this phase's actual goal).
 *
 * On success, ASSET_MANIFEST's contents are replaced in place (spliced, not reassigned) so every
 * existing consumer (getAsset, getAssetsBySlot, isIncompatible, and every component that already
 * does `import { ASSET_MANIFEST }`) picks up the remote data with no changes elsewhere — matching
 * CLAUDE.md section 37: asset loading failures must never crash the app, so any fetch error just
 * leaves the local manifest in place.
 */
export async function loadRemoteAssetsIfEnabled(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_USE_REMOTE_ASSETS !== "true") return false;

  const apiUrl = process.env.NEXT_PUBLIC_AVATARFORGE_API_URL;
  const apiKey = process.env.NEXT_PUBLIC_AVATARFORGE_API_KEY;
  if (!apiUrl || !apiKey) {
    console.warn("[remoteAssets] USE_REMOTE_ASSETS is true but API URL/key are not configured — staying on the local manifest.");
    return false;
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/assets?pageSize=100`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!response.ok) throw new Error(`Asset catalog API returned ${response.status}`);

    const body: { items: RemoteAssetDto[] } = await response.json();
    const mapped = body.items.map(toAssetMetadata);

    ASSET_MANIFEST.length = 0;
    ASSET_MANIFEST.push(...mapped);
    console.info(`[remoteAssets] Loaded ${mapped.length} assets from the remote catalog.`);
    return true;
  } catch (err) {
    console.warn("[remoteAssets] Failed to load remote asset catalog, staying on the local manifest.", err);
    return false;
  }
}

interface RemoteAssetDto {
  id: string;
  name: string;
  category: string;
  slot: string;
  version: number;
  thumbnailUrl?: string | null;
  modelUrl?: string | null;
  compatibleWith: string[];
  incompatibleWith: string[];
  metadata: {
    tags?: string[];
    styles?: string[];
    alwaysOn?: boolean;
    colors?: string[] | null;
    license?: string | null;
    author?: string | null;
    source?: string | null;
    materials?: string[] | null;
    attachment?: string | null;
  };
}

function toAssetMetadata(dto: RemoteAssetDto): AssetMetadata {
  return {
    id: dto.id,
    name: dto.name,
    category: dto.category,
    slot: dto.slot,
    attachment: dto.metadata.attachment ?? undefined,
    model: dto.modelUrl ?? undefined,
    thumbnail: dto.thumbnailUrl ?? undefined,
    compatibleWith: dto.compatibleWith,
    incompatibleWith: dto.incompatibleWith,
    tags: dto.metadata.tags ?? [],
    styles: dto.metadata.styles ?? [],
    alwaysOn: dto.metadata.alwaysOn ?? false,
    colors: dto.metadata.colors ?? undefined,
    assetVersion: dto.version,
    license: dto.metadata.license ?? undefined,
    author: dto.metadata.author ?? undefined,
    source: dto.metadata.source ?? undefined,
    materials: dto.metadata.materials ?? undefined,
  };
}
