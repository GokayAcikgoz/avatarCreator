import { AvatarConfiguration, AvatarConfigurationSchema } from "../config/avatarConfig";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportConfigJSON(config: AvatarConfiguration) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  download(blob, "avatarforge-config.json");
}

/** Throws with a readable message if the file isn't a valid AvatarConfiguration. */
export async function importConfigJSON(file: File): Promise<AvatarConfiguration> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const result = AvatarConfigurationSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Not a valid AvatarForge configuration: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}

export function downloadBlob(blob: Blob, filename: string) {
  download(blob, filename);
}
