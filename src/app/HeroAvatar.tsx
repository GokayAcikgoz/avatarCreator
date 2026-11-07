"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useAvatarStore } from "@/features/avatar/state/avatarStore";
import { AVATAR_PRESETS } from "@/features/avatar/config/presets";

const AvatarViewer = dynamic(() => import("@/features/avatar/viewer/AvatarViewer").then((m) => m.AvatarViewer), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-[2rem] bg-white/[0.02]" />,
});

const SHOWREEL: [string, string, number][] = [
  // preset, animation, seconds
  ["studio", "wave", 3.2],
  ["sunny", "dance", 4.8],
  ["urban", "thumbsUp", 3.2],
  ["cozy", "clap", 3.2],
  ["holiday", "celebrate", 3.2],
  ["weekend", "idle", 3.5],
];

/** The landing page's live avatar: cycles through presets and animations with the real viewer. */
export function HeroAvatar() {
  useEffect(() => {
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      const [presetId, animation, seconds] = SHOWREEL[index % SHOWREEL.length];
      const preset = AVATAR_PRESETS.find((p) => p.id === presetId);
      const store = useAvatarStore.getState();
      if (preset) store.hydrate(structuredClone(preset.configuration));
      store.playAnimation(animation);
      index += 1;
      timer = setTimeout(show, seconds * 1000);
    };
    show();
    return () => clearTimeout(timer);
  }, []);

  return <AvatarViewer mode="viewer" />;
}
