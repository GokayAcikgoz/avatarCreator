"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAvatarStore } from "@/features/avatar/state/avatarStore";
import { AnimationDock } from "@/features/avatar/ui/AnimationDock";
import { ViewerControls } from "@/features/avatar/ui/ViewerControls";
import { Logo } from "@/features/avatar/ui/EditorTopBar";
import { fetchPublicAvatar } from "@/features/avatar/services/publicAvatarApi";
import { draftRepository } from "@/features/avatar/services/avatarRepository";
import { Icon } from "@/components/ui/Icon";

const AvatarViewer = dynamic(() => import("@/features/avatar/viewer/AvatarViewer").then((m) => m.AvatarViewer), { ssr: false });

/** Read-only page for an avatar its owner made public — same viewer and animations as the editor. */
export function PublicAvatarView({ avatarId }: { avatarId: string }) {
  const hydrate = useAvatarStore((s) => s.hydrate);
  const [state, setState] = useState<"loading" | "ready" | "not-found">("loading");
  const [name, setName] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchPublicAvatar(avatarId).then((avatar) => {
      if (cancelled) return;
      if (!avatar) {
        setState("not-found");
        return;
      }
      hydrate(avatar.configuration, { avatarId: null, name: avatar.name, savedSnapshot: null });
      setName(avatar.name);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [avatarId, hydrate]);

  const remix = () => {
    // Start the editor from this look, as a new unsaved avatar of the visitor's own.
    const config = useAvatarStore.getState().config;
    draftRepository.save({ configuration: config, cloudAvatarId: null, name: `${name} remix` });
  };

  if (state === "not-found") {
    return (
      <div className="af-backdrop flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-neutral-400">
          <Icon name="lock" size={22} />
        </span>
        <h1 className="mb-2 text-xl font-semibold text-white">Avatar not available</h1>
        <p className="mb-6 max-w-sm text-sm text-neutral-400">This avatar doesn&apos;t exist, or its owner hasn&apos;t made it public.</p>
        <Link href="/create" className="rounded-full bg-gradient-to-r from-[#7c7cff] to-[#b56bff] px-6 py-2.5 text-sm font-semibold text-white">
          Create your own
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-[#07080c]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
        <Logo />
        <span className="h-5 w-px bg-white/10" />
        <span className="truncate text-sm font-medium text-neutral-200">{state === "ready" ? name : "Loading…"}</span>
        <Link
          href="/create"
          onClick={remix}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#7c7cff] to-[#b56bff] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20"
        >
          <Icon name="sparkles" size={15} /> Remix in the editor
        </Link>
      </header>
      <main className="af-backdrop relative min-h-0 flex-1">
        <div className="af-grid-floor pointer-events-none absolute inset-x-0 bottom-0 h-1/2" />
        {state === "ready" ? <AvatarViewer mode="viewer" /> : null}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
          <div className="pointer-events-auto">
            <ViewerControls />
          </div>
        </div>
        {state === "ready" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <div className="pointer-events-auto max-w-full">
              <AnimationDock />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
