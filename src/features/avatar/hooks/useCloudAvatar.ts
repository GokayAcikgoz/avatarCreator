"use client";

import { useCallback } from "react";
import { ApiError, describeApiError } from "@/lib/apiClient";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/sessionStore";
import { AvatarVisibility, CloudAvatar, avatarApi } from "../services/avatarApi";
import { configSnapshot, useAvatarStore } from "../state/avatarStore";
import { useEditorUi } from "../state/editorUi";

/** Keeps the address bar pointing at the avatar being edited, so a reload (or a shared tab) reopens it. */
export function syncUrl(avatarId: string | null) {
  const url = new URL(window.location.href);
  if (avatarId) url.searchParams.set("avatarId", avatarId);
  else url.searchParams.delete("avatarId");
  window.history.replaceState(null, "", url);
}

function linkFrom(avatar: CloudAvatar) {
  return {
    avatarId: avatar.id,
    name: avatar.name,
    visibility: avatar.visibility,
    thumbnailUrl: avatar.thumbnailUrl,
    savedSnapshot: configSnapshot(avatar.configuration),
  };
}

/**
 * Save / open / share against the Avatar API. The web creator is just another API client: it
 * calls the same /api/v1/avatars endpoints an external app would, authenticated by the signed-in
 * account's session instead of an API key.
 */
export function useCloudAvatar() {
  const user = useSession((s) => s.user);
  const requireAuth = useEditorUi((s) => s.requireAuth);
  const setSaving = useEditorUi((s) => s.setSaving);

  const save = useCallback(
    async (options: { asNew?: boolean } = {}): Promise<CloudAvatar | null> => {
      if (!useSession.getState().user) {
        requireAuth("Sign in to save this avatar to your account and use it through the API. It's kept on this device until then.", "save");
        return null;
      }
      const { config, cloud, viewerHandle, setCloud } = useAvatarStore.getState();
      const name = cloud.name.trim() || "My Avatar";
      setSaving(true);
      try {
        let avatar: CloudAvatar;
        if (cloud.avatarId && !options.asNew) {
          try {
            avatar = await avatarApi.update(cloud.avatarId, { name, configuration: config });
          } catch (err) {
            // Deleted elsewhere, or it belongs to a different account now signed in: keep the work as a new avatar.
            if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
              avatar = await avatarApi.create(name, config, cloud.visibility);
            } else throw err;
          }
        } else {
          avatar = await avatarApi.create(options.asNew && cloud.avatarId ? `${name} (copy)` : name, config, cloud.visibility);
        }

        // Portrait thumbnail for galleries — best effort, a failed upload never fails the save.
        if (viewerHandle) {
          try {
            const png = await viewerHandle.capturePNG({ size: 384, transparent: true, framing: "portrait" });
            avatar = await avatarApi.uploadThumbnail(avatar.id, png);
          } catch (err) {
            console.warn("[save] thumbnail upload failed", err);
          }
        }

        // The snapshot is what we *sent*: edits made while the request was in flight stay "unsaved".
        setCloud({ ...linkFrom(avatar), savedSnapshot: configSnapshot(config) });
        syncUrl(avatar.id);
        toast.success(options.asNew ? "Saved as a new avatar" : "Saved to your account");
        return avatar;
      } catch (err) {
        toast.error(describeApiError(err, "Couldn't save your avatar."));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [requireAuth, setSaving]
  );

  const open = useCallback(async (id: string) => {
    try {
      const avatar = await avatarApi.get(id);
      useAvatarStore.getState().loadConfig(avatar.configuration, linkFrom(avatar));
      syncUrl(avatar.id);
      return avatar;
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't open that avatar."));
      return null;
    }
  }, []);

  const setVisibility = useCallback(async (visibility: AvatarVisibility) => {
    const { cloud, setCloud } = useAvatarStore.getState();
    if (!cloud.avatarId) return null;
    try {
      const avatar = await avatarApi.update(cloud.avatarId, { visibility });
      setCloud({ visibility: avatar.visibility });
      return avatar;
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't change sharing."));
      return null;
    }
  }, []);

  return { user, save, open, setVisibility };
}
