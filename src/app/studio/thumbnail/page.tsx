import { notFound } from "next/navigation";
import { StudioThumbnail } from "./StudioThumbnail";

/**
 * Internal asset-pipeline page (tools/asset-pipeline/render_thumbnails.mjs drives it with a headless
 * browser to render catalog thumbnails with the real viewer). Not part of the product: it 404s in
 * production builds unless AVATARFORGE_STUDIO=1.
 */
export default function StudioThumbnailPage() {
  if (process.env.NODE_ENV === "production" && process.env.AVATARFORGE_STUDIO !== "1") notFound();
  return <StudioThumbnail />;
}
