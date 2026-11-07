import { apiRequest } from "@/lib/apiClient";
import { AvatarConfiguration, parseConfiguration } from "../config/avatarConfig";

export type AvatarVisibility = "Private" | "Public";

export interface CloudAvatar {
  id: string;
  name: string;
  visibility: AvatarVisibility;
  configuration: AvatarConfiguration;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAvatarPage {
  items: CloudAvatar[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RenderResult {
  status: "completed";
  url: string;
  format: string;
}

export interface RenderRequest {
  width?: number;
  height?: number;
  background?: "transparent" | string;
  camera?: "full" | "front" | "portrait" | "threeQuarter";
  animation?: string | null;
  time?: number;
}

/** Validates what the server sends back — a stored configuration from an older client must not crash the editor. */
function normalize(avatar: CloudAvatar): CloudAvatar {
  const configuration = parseConfiguration(avatar.configuration);
  if (!configuration) throw new Error(`Avatar "${avatar.name}" has a configuration this version of the editor can't read.`);
  return { ...avatar, configuration };
}

/**
 * The web creator's side of the Avatar API — the same /api/v1/avatars endpoints external apps call
 * with an API key, authenticated here by the signed-in account's session cookie.
 */
export const avatarApi = {
  list: async (page = 1, pageSize = 48) => {
    const result = await apiRequest<CloudAvatarPage>(`/api/v1/avatars?page=${page}&pageSize=${pageSize}`);
    return { ...result, items: result.items.flatMap((a) => { try { return [normalize(a)]; } catch { return []; } }) };
  },

  get: async (id: string) => normalize(await apiRequest<CloudAvatar>(`/api/v1/avatars/${id}`)),

  create: async (name: string, configuration: AvatarConfiguration, visibility: AvatarVisibility = "Private") =>
    normalize(await apiRequest<CloudAvatar>("/api/v1/avatars", { method: "POST", body: JSON.stringify({ name, configuration, visibility }) })),

  update: async (id: string, patch: { name?: string; configuration?: AvatarConfiguration; visibility?: AvatarVisibility }) =>
    normalize(await apiRequest<CloudAvatar>(`/api/v1/avatars/${id}`, { method: "PUT", body: JSON.stringify(patch) })),

  remove: (id: string) => apiRequest<void>(`/api/v1/avatars/${id}`, { method: "DELETE" }),

  uploadThumbnail: async (id: string, image: Blob) =>
    normalize(await apiRequest<CloudAvatar>(`/api/v1/avatars/${id}/thumbnail`, { method: "PUT", body: image, headers: { "Content-Type": image.type || "image/png" } })),

  render: (id: string, request: RenderRequest) =>
    apiRequest<RenderResult>(`/api/v1/avatars/${id}/render`, { method: "POST", body: JSON.stringify({ format: "png", ...request }) }),

  exportGlb: (id: string, includeAnimations = true) =>
    apiRequest<RenderResult>(`/api/v1/avatars/${id}/export`, { method: "POST", body: JSON.stringify({ format: "glb", includeAnimations }) }),
};
