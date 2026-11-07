"use client";

import { CameraFocus, useAvatarStore } from "../state/avatarStore";
import { Icon } from "@/components/ui/Icon";

const VIEWS: { id: CameraFocus; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "face", label: "Face" },
  { id: "upper", label: "Upper" },
  { id: "feet", label: "Feet" },
];

/** Camera shortcuts over the viewer: jump to a framing, or reset after orbiting/panning away. */
export function ViewerControls() {
  const focus = useAvatarStore((s) => s.cameraFocus);
  const focusCamera = useAvatarStore((s) => s.focusCamera);
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#0e1017]/70 p-1 backdrop-blur-xl">
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => focusCamera(view.id)}
          aria-pressed={focus === view.id}
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${focus === view.id ? "bg-white/15 text-white" : "text-neutral-400 hover:text-white"}`}
        >
          {view.label}
        </button>
      ))}
      <button type="button" onClick={() => focusCamera(focus)} aria-label="Reset view" title="Reset view" className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white">
        <Icon name="focus" size={14} />
      </button>
    </div>
  );
}
