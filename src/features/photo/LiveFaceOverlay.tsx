"use client";

import { useCallback, useEffect } from "react";
import { Icon, Spinner } from "@/components/ui/Icon";
import { registerLivePreview, stopLiveFace, useLiveFace } from "./liveFace";

const LABEL: Record<string, string> = {
  starting: "Starting…",
  searching: "Looking for your face",
  tracking: "Live",
};

/**
 * The live-face camera preview (mirrored, like a selfie view) in a corner of the 3D view. Always
 * mounted so the tracker has its <video>; hidden while live face is off.
 */
export function LiveFaceOverlay() {
  const status = useLiveFace((s) => s.status);
  const message = useLiveFace((s) => s.message);
  const setStatus = useLiveFace((s) => s.setStatus);
  const videoRef = useCallback((element: HTMLVideoElement | null) => registerLivePreview(element), []);

  // Leaving the editor turns the camera off.
  useEffect(() => () => stopLiveFace(), []);

  return (
    <div className={status === "off" ? "hidden" : "pointer-events-auto absolute bottom-[76px] left-3 z-10 w-36 sm:bottom-24 sm:left-5 sm:w-44"} data-testid="live-face">
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl shadow-black/50">
        <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full -scale-x-100 object-cover" />
        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            status === "tracking" ? "bg-emerald-500/90 text-white" : status === "error" ? "bg-rose-500/90 text-white" : "bg-black/70 text-neutral-200"
          }`}
          data-testid="live-face-status"
        >
          {status === "tracking" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> : status === "starting" ? <Spinner size={10} /> : null}
          {status === "error" ? "Stopped" : LABEL[status]}
        </span>
        <button
          type="button"
          onClick={() => (status === "error" ? setStatus("off") : stopLiveFace())}
          aria-label="Turn live face off"
          className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white transition hover:bg-black/80"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {status === "error" && message && <p className="mt-1.5 rounded-xl bg-black/70 px-2.5 py-1.5 text-[11px] leading-snug text-rose-200">{message}</p>}
      {status !== "error" && <p className="mt-1.5 text-[10px] leading-snug text-neutral-400">Your camera stays on this device.</p>}
    </div>
  );
}
