"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/controls";
import { Icon, Spinner } from "@/components/ui/Icon";
import { toast } from "@/components/ui/toast";
import { absoluteApiUrl, describeApiError } from "@/lib/apiClient";
import { CloudAvatar, avatarApi } from "../services/avatarApi";
import { hasUnsavedChanges, useAvatarStore } from "../state/avatarStore";
import { useEditorUi } from "../state/editorUi";
import { syncUrl, useCloudAvatar } from "../hooks/useCloudAvatar";

function timeAgo(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Infinity, "year"],
  ];
  let value = seconds;
  for (const [size, unit] of units) {
    if (value < size) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.round(value), unit);
    value /= size;
  }
  return "";
}

export function MyAvatarsDialog() {
  const open = useEditorUi((s) => s.myAvatarsOpen);
  const setOpen = useEditorUi((s) => s.setMyAvatarsOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <Dialog open={open} onClose={close} title="My avatars" description="Saved to your account — available anywhere you sign in, and through the API." width="lg">
      {/* Mounted only while open, so every opening starts from a fresh fetch. */}
      {open ? <MyAvatarsContent close={close} /> : null}
    </Dialog>
  );
}

function MyAvatarsContent({ close }: { close: () => void }) {
  const currentId = useAvatarStore((s) => s.cloud.avatarId);
  const { open: openAvatar } = useCloudAvatar();
  const [items, setItems] = useState<CloudAvatar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    let cancelled = false;
    avatarApi
      .list(1, 100)
      .then((page) => !cancelled && setItems(page.items))
      .catch((err) => {
        if (cancelled) return;
        setError(describeApiError(err, "Couldn't load your avatars."));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpen = async (avatar: CloudAvatar) => {
    const state = useAvatarStore.getState();
    if (state.cloud.avatarId !== avatar.id && state.cloud.avatarId && hasUnsavedChanges(state)) {
      if (!window.confirm("Open this avatar? Unsaved changes to the current one will be replaced (you can undo).")) return;
    }
    if (await openAvatar(avatar.id)) {
      toast.success(`Opened “${avatar.name}”`);
      close();
    }
  };

  const handleRename = async (avatar: CloudAvatar) => {
    const name = draftName.trim();
    setRenaming(null);
    if (!name || name === avatar.name) return;
    try {
      const updated = await avatarApi.update(avatar.id, { name });
      setItems((prev) => prev?.map((a) => (a.id === avatar.id ? updated : a)) ?? null);
      if (useAvatarStore.getState().cloud.avatarId === avatar.id) useAvatarStore.getState().setCloud({ name: updated.name });
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't rename."));
    }
  };

  const handleDelete = async (avatar: CloudAvatar) => {
    if (!window.confirm(`Delete “${avatar.name}”? This can't be undone.`)) return;
    try {
      await avatarApi.remove(avatar.id);
      setItems((prev) => prev?.filter((a) => a.id !== avatar.id) ?? null);
      if (useAvatarStore.getState().cloud.avatarId === avatar.id) {
        useAvatarStore.getState().startNew();
        syncUrl(null);
      }
      toast.success("Avatar deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't delete."));
    }
  };

  const startNew = () => {
    const store = useAvatarStore.getState();
    store.startNew();
    store.reset();
    store.selectCategory("presets");
    syncUrl(null);
    close();
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={startNew}>
          <Icon name="plus" size={14} /> New avatar
        </Button>
      </div>
      {error && <p className="mb-4 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {items === null ? (
        <div className="flex justify-center py-14 text-neutral-400">
          <Spinner size={22} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 py-14 text-center">
          <Icon name="folder" size={26} className="text-neutral-500" />
          <p className="text-sm font-medium text-white">No saved avatars yet</p>
          <p className="max-w-xs text-xs text-neutral-400">Hit Save in the editor and your avatar will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((avatar) => {
            const thumb = absoluteApiUrl(avatar.thumbnailUrl);
            const current = avatar.id === currentId;
            return (
              <div key={avatar.id} className={`group overflow-hidden rounded-2xl border bg-white/[0.02] transition ${current ? "border-indigo-400/60" : "border-white/[0.07] hover:border-white/20"}`}>
                <button type="button" onClick={() => handleOpen(avatar)} className="relative block aspect-square w-full bg-[radial-gradient(circle_at_50%_30%,rgba(124,124,255,0.18),transparent_70%)]">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- API-hosted thumbnail on another origin
                    <img src={thumb} alt={`${avatar.name} thumbnail`} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-neutral-600">
                      <Icon name="user" size={36} />
                    </span>
                  )}
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-neutral-200 backdrop-blur">
                    <Icon name={avatar.visibility === "Public" ? "globe" : "lock"} size={11} /> {avatar.visibility === "Public" ? "Public" : "Private"}
                  </span>
                  {current && <span className="absolute right-2 top-2 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-semibold text-white">Editing</span>}
                </button>
                <div className="flex items-center gap-1 px-3 py-2.5">
                  {renaming === avatar.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      maxLength={80}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => handleRename(avatar)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(avatar);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="h-7 min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 text-xs text-white outline-none focus:border-indigo-400"
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">{avatar.name}</p>
                      <p className="text-[10px] text-neutral-500">Edited {timeAgo(avatar.updatedAt)}</p>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Rename ${avatar.name}`}
                    onClick={() => {
                      setRenaming(avatar.id);
                      setDraftName(avatar.name);
                    }}
                    className="rounded-md p-1.5 text-neutral-500 opacity-70 hover:bg-white/5 hover:text-white group-hover:opacity-100"
                  >
                    <Icon name="pencil" size={14} />
                  </button>
                  <button type="button" aria-label={`Delete ${avatar.name}`} onClick={() => handleDelete(avatar)} className="rounded-md p-1.5 text-neutral-500 opacity-70 hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
