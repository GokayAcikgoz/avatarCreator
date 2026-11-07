"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useProgress } from "@react-three/drei";
import { CameraFocus, CaptureView, useAvatarStore } from "@/features/avatar/state/avatarStore";
import { parseConfiguration } from "@/features/avatar/config/avatarConfig";
import { analyzePhoto } from "@/features/photo/photoAnalysis";
import { suggestFromAnalysis } from "@/features/photo/faceToConfig";
import { faceMetrics, Point3 } from "@/features/photo/faceMetrics";

const AvatarViewer = dynamic(() => import("@/features/avatar/viewer/AvatarViewer").then((m) => m.AvatarViewer), { ssr: false });

declare global {
  interface Window {
    __afStudio?: {
      /** Loads a configuration + framing; resolves once every asset has finished loading. */
      show: (configuration: unknown, focus: CameraFocus) => Promise<void>;
      /** Captures the current framing, or an explicit camera. */
      capture: (size: number, view?: CaptureView) => Promise<string>;
      /** Freezes on one frame of a clip (null resumes). Resolves after the pose has rendered. */
      pose: (animation: string | null, time?: number) => Promise<void>;
    };
    /** Photo-analysis QA: runs the production pipeline on an image (e.g. a capture of the avatar). */
    __afPhoto?: {
      analyze: (dataUrl: string, background?: string) => Promise<unknown>;
      metricsOf: (points: Point3[]) => unknown;
    };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = url;
  });
}

function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    let calm = 0;
    const tick = () => {
      const { active } = useProgress.getState();
      const ready = Boolean(useAvatarStore.getState().viewerHandle);
      calm = !active && ready ? calm + 1 : 0;
      if (calm > 20) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });
}

export function StudioThumbnail() {
  useEffect(() => {
    window.__afStudio = {
      show: async (configuration, focus) => {
        const parsed = parseConfiguration(configuration);
        if (!parsed) throw new Error("Invalid configuration");
        const store = useAvatarStore.getState();
        store.hydrate(parsed);
        store.playAnimation("idle");
        store.focusCamera(focus);
        await waitForIdle();
      },
      capture: async (size, view) => {
        const handle = useAvatarStore.getState().viewerHandle;
        if (!handle) throw new Error("Viewer not ready");
        const blob = await handle.capturePNG({ size, transparent: true, framing: view ?? "current" });
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      },
      pose: async (animation, time = 0) => {
        const store = useAvatarStore.getState();
        if (animation) store.playAnimation(animation); // props such as the stool follow the store
        await nextFrames(3);
        const handle = useAvatarStore.getState().viewerHandle;
        if (!handle) throw new Error("Viewer not ready");
        handle.freezeAt(animation, time);
        await nextFrames(2);
      },
    };
    window.__afPhoto = {
      analyze: async (dataUrl, background = "#6f7480") => {
        const img = await loadImage(dataUrl);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.fillStyle = background; // captures are transparent; a photo never is
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const { analysis, landmarks, otherFaces, hairMask } = await analyzePhoto(canvas);
        // Debug overlay: hair mask in magenta, landmarks in cyan.
        if (hairMask) {
          const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const m = hairMask.data[Math.floor((y / canvas.height) * hairMask.height) * hairMask.width + Math.floor((x / canvas.width) * hairMask.width)];
              const o = (y * canvas.width + x) * 4;
              overlay.data[o] = overlay.data[o] * (1 - m * 0.6) + 255 * m * 0.6;
              overlay.data[o + 2] = overlay.data[o + 2] * (1 - m * 0.6) + 255 * m * 0.6;
            }
          }
          ctx.putImageData(overlay, 0, 0);
        }
        ctx.fillStyle = "#00e5ff";
        for (const p of landmarks) ctx.fillRect(p.x * canvas.width - 0.5, p.y * canvas.height - 0.5, 1.5, 1.5);
        return { analysis, landmarks, otherFaces, debugUrl: canvas.toDataURL("image/png"), suggestion: suggestFromAnalysis(analysis, useAvatarStore.getState().config) };
      },
      metricsOf: (points) => faceMetrics(points),
    };
    return () => {
      delete window.__afStudio;
      delete window.__afPhoto;
    };
  }, []);

  return (
    <div className="h-dvh w-dvh" style={{ width: 640, height: 640 }}>
      <AvatarViewer mode="studio" />
    </div>
  );
}
