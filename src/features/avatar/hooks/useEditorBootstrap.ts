"use client";

import { useEffect } from "react";
import { loadRemoteAssetsIfEnabled } from "../config/remoteAssets";
import { draftRepository } from "../services/avatarRepository";
import { avatarApi } from "../services/avatarApi";
import { configSnapshot, hasUnsavedChanges, useAvatarStore } from "../state/avatarStore";
import { useEditorUi } from "../state/editorUi";
import { useSession } from "@/features/auth/sessionStore";
import { toast } from "@/components/ui/toast";
import { syncUrl, useCloudAvatar } from "./useCloudAvatar";

/**
 * Everything the editor does once on load and keeps doing in the background:
 *  - resolves the session, then opens `?avatarId=` (deep link / reload) or restores the local draft
 *  - autosaves a draft to this browser on every change (so a reload never loses work)
 *  - keyboard shortcuts: Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z / Ctrl+Y redo, Ctrl/⌘+S save
 *  - warns before leaving with changes that aren't in the account yet
 *  - resumes whatever the person was doing when we asked them to sign in
 */
export function useEditorBootstrap() {
  const { save, open } = useCloudAvatar();

  useEffect(() => {
    loadRemoteAssetsIfEnabled();
    let cancelled = false;

    (async () => {
      const store = useAvatarStore.getState();
      store.playAnimation("idle"); // don't inherit the landing page's showreel animation
      store.focusCamera("full");
      const draft = draftRepository.load();
      if (draft) store.hydrate(draft.configuration, { avatarId: draft.cloudAvatarId, name: draft.name, savedSnapshot: null });

      const user = await useSession.getState().refresh();
      if (cancelled) return;

      // /create?photo=1 (the landing page's "Start from a selfie") opens the photo dialog.
      if (new URLSearchParams(window.location.search).get("photo") === "1") useEditorUi.getState().setPhotoOpen(true);

      const linkId = new URLSearchParams(window.location.search).get("avatarId");
      if (linkId && linkId !== draft?.cloudAvatarId) {
        if (user) await open(linkId);
        else toast.info("Sign in to open that saved avatar.", { label: "Sign in", onClick: () => useEditorUi.getState().requireAuth("Sign in to open your saved avatar.", null) });
        return;
      }

      const linkedId = draft?.cloudAvatarId ?? null;
      if (linkedId && user) {
        // Restored draft is attached to a saved avatar: compare with the server copy for the "unsaved" badge.
        try {
          const remote = await avatarApi.get(linkedId);
          useAvatarStore.getState().setCloud({ visibility: remote.visibility, thumbnailUrl: remote.thumbnailUrl, savedSnapshot: configSnapshot(remote.configuration) });
          syncUrl(linkedId);
        } catch {
          useAvatarStore.getState().setCloud({ avatarId: null, savedSnapshot: null });
          syncUrl(null);
        }
      }
    })();

    // Debounced local draft autosave.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useAvatarStore.subscribe((state, prev) => {
      if (state.config === prev.config && state.cloud.avatarId === prev.cloud.avatarId && state.cloud.name === prev.cloud.name) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useAvatarStore.getState();
        draftRepository.save({ configuration: s.config, cloudAvatarId: s.cloud.avatarId, name: s.cloud.name });
      }, 400);
    });

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" && (target as HTMLInputElement).type !== "range";
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        save();
      } else if (!typing && key === "z") {
        e.preventDefault();
        if (e.shiftKey) useAvatarStore.getState().redo();
        else useAvatarStore.getState().undo();
      } else if (!typing && key === "y") {
        e.preventDefault();
        useAvatarStore.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useAvatarStore.getState();
      // Anonymous work lives in the local draft; only warn when an account copy is out of date.
      if (useSession.getState().user && s.cloud.avatarId && hasUnsavedChanges(s)) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save, open]);
}

/** Runs the action that was interrupted by the sign-in prompt. */
export function resumeAfterSignIn(actions: { save: () => unknown }) {
  const pending = useEditorUi.getState().takePendingAction();
  if (pending === "save") actions.save();
  else if (pending === "myAvatars") useEditorUi.getState().setMyAvatarsOpen(true);
  else if (pending === "share") useEditorUi.getState().setShareOpen(true);
}
