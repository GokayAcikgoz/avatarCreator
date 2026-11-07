import { API_URL } from "@/lib/apiClient";
import { AvatarConfiguration, parseConfiguration } from "../config/avatarConfig";

export interface PublicAvatar {
  id: string;
  name: string;
  configuration: AvatarConfiguration;
  thumbnailUrl: string | null;
}

/** Unauthenticated; only avatars explicitly marked Public. Returns null on any failure (missing, private, unreachable) so the page can render a clean "not available" state. */
export async function fetchPublicAvatar(id: string): Promise<PublicAvatar | null> {
  try {
    const response = await fetch(`${API_URL}/api/v1/avatars/public/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    const body = await response.json();
    const configuration = parseConfiguration(body.configuration);
    return configuration ? { id: body.id, name: body.name, configuration, thumbnailUrl: body.thumbnailUrl ?? null } : null;
  } catch {
    return null;
  }
}
