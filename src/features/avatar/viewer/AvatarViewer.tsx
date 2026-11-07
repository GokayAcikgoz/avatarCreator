"use client";

import { Component, ReactNode, Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import * as THREE from "three";
import { AvatarModel } from "./AvatarModel";
import { AvatarStage } from "./AvatarStage";
import { PlaceholderAvatar } from "./PlaceholderAvatar";

/** If the body itself can't load, show the procedural stand-in avatar instead of a broken canvas (CLAUDE.md §37). */
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[AvatarViewer] avatar model failed to load, showing fallback", error);
  }
  render() {
    return this.state.failed ? <PlaceholderAvatar /> : this.props.children;
  }
}

class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[AvatarViewer] WebGL canvas failed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-white">3D preview unavailable</p>
        <p className="max-w-xs text-xs text-neutral-400">
          Your browser couldn&apos;t start WebGL. Your avatar is still editable and saves normally — try another browser to see it in 3D.
        </p>
      </div>
    );
  }
}

/**
 * The first load covers the stage with a progress card. After the avatar has been on screen once,
 * later downloads (a new hairstyle, a garment) only show a small chip in the corner — the previous
 * asset stays visible meanwhile, so nothing flashes over the character.
 */
function LoadingOverlay() {
  const { active, progress } = useProgress();
  const [appeared, setAppeared] = useState(false);
  if (!appeared && !active && progress >= 100) setAppeared(true);
  if (!active) return null;
  if (appeared) {
    return (
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-[#0e1017]/80 px-3 py-1.5 text-[11px] font-medium text-neutral-300 backdrop-blur-md">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-indigo-300" />
        Loading…
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#0e1017]/80 px-6 py-4 backdrop-blur-md">
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-[width] duration-300" style={{ width: `${Math.max(6, progress)}%` }} />
        </div>
        <span className="text-xs font-medium tracking-wide text-neutral-300">Loading avatar… {Math.round(progress)}%</span>
      </div>
    </div>
  );
}

interface AvatarViewerProps {
  /** Editor registers export handles; viewer is read-only; studio (thumbnail rendering) snaps the camera and disables blinking. */
  mode?: "editor" | "viewer" | "studio";
}

export function AvatarViewer({ mode = "editor" }: AvatarViewerProps) {
  return (
    <div className="relative h-full w-full touch-none select-none">
      <CanvasBoundary>
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: mode === "studio" }}
          camera={{ position: [0, 1.02, 4.7], fov: 30, near: 0.05, far: 30 }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1.0;
          }}
        >
          <AvatarStage interactive snap={mode === "studio"} />
          <Suspense fallback={<PlaceholderAvatar />}>
            <ModelBoundary>
              <AvatarModel exportable={mode !== "viewer"} blink={mode !== "studio"} />
            </ModelBoundary>
          </Suspense>
        </Canvas>
      </CanvasBoundary>
      <LoadingOverlay />
    </div>
  );
}
