import { AvatarConfiguration, parseConfiguration } from "../config/avatarConfig";

const DRAFT_KEY = "avatarforge.draft.v2";
const LEGACY_KEY = "avatarforge.avatar.v1";

/** What the editor restores on reload: the configuration plus which cloud avatar (if any) it's editing. */
export interface EditorDraft {
  configuration: AvatarConfiguration;
  cloudAvatarId: string | null;
  name: string;
  savedAt: string;
}

/**
 * Per-browser draft storage. The canonical copy of a saved avatar lives in the API (see avatarApi);
 * this only keeps work-in-progress across reloads — and is the whole save story for visitors who
 * haven't signed in. Every access is guarded: storage can be unavailable (private mode, blocked
 * site data), and the editor must still work without it.
 */
export const draftRepository = {
  load(): EditorDraft | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<EditorDraft>;
        const configuration = parseConfiguration(parsed.configuration);
        if (configuration) {
          return {
            configuration,
            cloudAvatarId: typeof parsed.cloudAvatarId === "string" ? parsed.cloudAvatarId : null,
            name: typeof parsed.name === "string" ? parsed.name : "My Avatar",
            savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
          };
        }
      }
      // One-time migration of the Phase 1-8 "Save" slot.
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      const configuration = legacy ? parseConfiguration(JSON.parse(legacy)) : null;
      return configuration ? { configuration, cloudAvatarId: null, name: "My Avatar", savedAt: new Date().toISOString() } : null;
    } catch {
      return null;
    }
  },

  save(draft: Omit<EditorDraft, "savedAt">): boolean {
    if (typeof window === "undefined") return false;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
      return true;
    } catch {
      return false;
    }
  },

  clear(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  },
};
