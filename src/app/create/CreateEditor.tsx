"use client";

import dynamic from "next/dynamic";
import { AnimationDock } from "@/features/avatar/ui/AnimationDock";
import { CategoryRail, OptionsPanel } from "@/features/avatar/ui/OptionsPanel";
import { EditorTopBar } from "@/features/avatar/ui/EditorTopBar";
import { ViewerControls } from "@/features/avatar/ui/ViewerControls";
import { MyAvatarsDialog } from "@/features/avatar/ui/MyAvatarsDialog";
import { ShareDialog } from "@/features/avatar/ui/ShareDialog";
import { PhotoAvatarDialog } from "@/features/photo/PhotoAvatarDialog";
import { LiveFaceOverlay } from "@/features/photo/LiveFaceOverlay";
import { useEditorBootstrap, resumeAfterSignIn } from "@/features/avatar/hooks/useEditorBootstrap";
import { useCloudAvatar } from "@/features/avatar/hooks/useCloudAvatar";
import { useEditorUi } from "@/features/avatar/state/editorUi";
import { AuthDialog } from "@/features/auth/AuthDialog";
import { Toaster } from "@/components/ui/toast";

const AvatarViewer = dynamic(() => import("@/features/avatar/viewer/AvatarViewer").then((m) => m.AvatarViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <span className="text-xs font-medium tracking-wide text-neutral-500">Loading avatar…</span>
    </div>
  ),
});

function EditorDialogs() {
  const authOpen = useEditorUi((s) => s.authOpen);
  const authReason = useEditorUi((s) => s.authReason);
  const closeAuth = useEditorUi((s) => s.closeAuth);
  const { save } = useCloudAvatar();
  return (
    <>
      <AuthDialog open={authOpen} onClose={closeAuth} reason={authReason} onSignedIn={() => resumeAfterSignIn({ save })} />
      <MyAvatarsDialog />
      <ShareDialog />
      <PhotoAvatarDialog />
      <Toaster />
    </>
  );
}

export function CreateEditor() {
  useEditorBootstrap();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#07080c]">
      <EditorTopBar />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden w-[88px] shrink-0 overflow-y-auto border-r border-white/[0.06] bg-[#08090e] lg:block">
          <CategoryRail orientation="vertical" />
        </aside>

        <main className="af-backdrop relative h-[46dvh] shrink-0 overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
          <div className="af-grid-floor pointer-events-none absolute inset-x-0 bottom-0 h-1/2" />
          <AvatarViewer mode="editor" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3 sm:justify-start">
            <div className="pointer-events-auto">
              <ViewerControls />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-5">
            <div className="pointer-events-auto max-w-full">
              <AnimationDock />
            </div>
          </div>
          <LiveFaceOverlay />
        </main>

        <aside className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06] bg-[#0b0c12] lg:w-[380px] lg:flex-none lg:border-l lg:border-t-0">
          <div className="border-b border-white/[0.06] lg:hidden">
            <CategoryRail orientation="horizontal" />
          </div>
          <div className="min-h-0 flex-1">
            <OptionsPanel />
          </div>
        </aside>
      </div>

      <EditorDialogs />
    </div>
  );
}
