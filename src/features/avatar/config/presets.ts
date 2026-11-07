import presetsJson from "@shared/avatar-presets.json";
import { AvatarConfiguration, AvatarConfigurationSchema } from "./avatarConfig";

export interface AvatarPreset {
  id: string;
  name: string;
  description: string;
  configuration: AvatarConfiguration;
}

/** Validated against the same schema user-saved avatars go through — a broken preset fails the build, not the user. */
export const AVATAR_PRESETS: AvatarPreset[] = presetsJson.presets.map((p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  configuration: AvatarConfigurationSchema.parse(p.configuration),
}));
