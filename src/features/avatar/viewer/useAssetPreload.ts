import { useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { AssetMetadata } from "../config/assetMetadata";

/**
 * Preloads the *other* options in a category once the user opens it — not on initial app load
 * (see docs/asset-pipeline.md "Lazy loading"). Selecting one already loads it via useGLTF's own
 * Suspense path; this just warms the cache for the ones the user hasn't clicked yet, so switching
 * between them feels instant instead of re-triggering a network fetch + Suspense fallback.
 */
export function useAssetPreload(assets: AssetMetadata[]) {
  useEffect(() => {
    for (const asset of assets) {
      if (asset.model) useGLTF.preload(asset.model);
    }
  }, [assets]);
}
