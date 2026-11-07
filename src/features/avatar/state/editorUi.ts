"use client";

import { create } from "zustand";

type PendingAction = "save" | "myAvatars" | "share" | "serverRender" | null;

interface EditorUiState {
  authOpen: boolean;
  authReason: string | undefined;
  /** What to resume once the person has signed in (e.g. the save they just attempted). */
  pendingAction: PendingAction;
  myAvatarsOpen: boolean;
  shareOpen: boolean;
  /** "Create from a photo" dialog. */
  photoOpen: boolean;
  saving: boolean;
  requireAuth: (reason: string, then: PendingAction) => void;
  closeAuth: () => void;
  takePendingAction: () => PendingAction;
  setMyAvatarsOpen: (open: boolean) => void;
  setShareOpen: (open: boolean) => void;
  setPhotoOpen: (open: boolean) => void;
  setSaving: (saving: boolean) => void;
}

export const useEditorUi = create<EditorUiState>((set, get) => ({
  authOpen: false,
  authReason: undefined,
  pendingAction: null,
  myAvatarsOpen: false,
  shareOpen: false,
  photoOpen: false,
  saving: false,
  requireAuth: (reason, then) => set({ authOpen: true, authReason: reason, pendingAction: then }),
  closeAuth: () => set({ authOpen: false }),
  takePendingAction: () => {
    const action = get().pendingAction;
    set({ pendingAction: null });
    return action;
  },
  setMyAvatarsOpen: (open) => set({ myAvatarsOpen: open }),
  setShareOpen: (open) => set({ shareOpen: open }),
  setPhotoOpen: (open) => set({ photoOpen: open }),
  setSaving: (saving) => set({ saving }),
}));
