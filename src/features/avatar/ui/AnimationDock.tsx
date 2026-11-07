"use client";

import { Suspense, use, useSyncExternalStore } from "react";
import { useAvatarStore } from "../state/avatarStore";
import { loadClipLibrary } from "../animation/clipLibrary";
import { Icon } from "@/components/ui/Icon";
import { toggleLiveFace, useLiveFace } from "@/features/photo/liveFace";

const libraryPromise = typeof window === "undefined" ? null : loadClipLibrary();

/**
 * Every clip in shared/animation-clips.json, in library order. Switching cross-fades on the
 * avatar (see AvatarModel) — never a snap between poses.
 */
function DockButtons() {
  const library = use(libraryPromise!);
  const animation = useAvatarStore((s) => s.animation);
  const playAnimation = useAvatarStore((s) => s.playAnimation);
  return (
    <>
      {library.clips.map((clip) => {
        const active = animation === clip.id;
        return (
          <button
            key={clip.id}
            type="button"
            onClick={() => playAnimation(clip.id)}
            aria-pressed={active}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              active ? "bg-white text-[#0b0d12] shadow" : "text-neutral-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {clip.name}
          </button>
        );
      })}
    </>
  );
}

/** Camera face tracking: the avatar mirrors your expressions and head. */
function LiveFaceButton() {
  const status = useLiveFace((s) => s.status);
  const on = status !== "off" && status !== "error";
  return (
    <button
      type="button"
      onClick={() => {
        if (!on) {
          const store = useAvatarStore.getState();
          store.playAnimation("idle");
          store.focusCamera("face");
        }
        toggleLiveFace();
      }}
      aria-pressed={on}
      title="Live face — the avatar mirrors your expressions (camera stays on this device)"
      data-testid="live-face-toggle"
      className={`ml-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
        on ? "bg-emerald-400 text-[#0b0d12] shadow" : "bg-gradient-to-r from-indigo-500/25 to-fuchsia-500/25 text-white hover:from-indigo-500/40 hover:to-fuchsia-500/40"
      }`}
    >
      <Icon name="camera" size={14} /> Live face
    </button>
  );
}

function DockSkeleton() {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className="h-7 w-14 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
      ))}
    </>
  );
}

export function AnimationDock() {
  // The clip library is a client-only lazy chunk; render it after mount so SSR and hydration agree.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  return (
    <div className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-[#0e1017]/75 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <span className="hidden shrink-0 pl-2.5 pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 sm:block">Animate</span>
      {mounted && libraryPromise ? (
        <Suspense fallback={<DockSkeleton />}>
          <DockButtons />
          <LiveFaceButton />
        </Suspense>
      ) : (
        <DockSkeleton />
      )}
    </div>
  );
}
