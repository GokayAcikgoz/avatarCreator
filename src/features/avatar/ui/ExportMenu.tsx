"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useAvatarStore, hasUnsavedChanges } from "../state/avatarStore";
import { exportConfigJSON, importConfigJSON, downloadBlob } from "../services/configExport";
import { avatarApi } from "../services/avatarApi";
import { loadClipLibrary, ClipLibrary } from "../animation/clipLibrary";
import { useCloudAvatar } from "../hooks/useCloudAvatar";
import { absoluteApiUrl, describeApiError } from "@/lib/apiClient";
import { Button, Chip } from "@/components/ui/controls";
import { Icon, Spinner } from "@/components/ui/Icon";
import { toast } from "@/components/ui/toast";

const PNG_SIZES = [512, 1024, 2048];
const FRAMINGS = [
  { id: "full", label: "Full body" },
  { id: "portrait", label: "Portrait" },
  { id: "current", label: "Current view" },
] as const;
const CAMERAS = [
  { id: "full", label: "Full body" },
  { id: "portrait", label: "Portrait" },
  { id: "threeQuarter", label: "¾ view" },
] as const;

function slug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "avatar";
}

async function downloadFromApi(url: string, filename: string) {
  const absolute = absoluteApiUrl(url)!;
  try {
    const response = await fetch(absolute, { credentials: "include" });
    if (!response.ok) throw new Error(String(response.status));
    downloadBlob(await response.blob(), filename);
  } catch {
    window.open(absolute, "_blank", "noopener");
  }
}

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pngSize, setPngSize] = useState(1024);
  const [transparent, setTransparent] = useState(true);
  const [framing, setFraming] = useState<"full" | "portrait" | "current">("full");
  const [withAnimations, setWithAnimations] = useState(true);
  const [serverCamera, setServerCamera] = useState<"full" | "portrait" | "threeQuarter">("full");
  const [library, setLibrary] = useState<ClipLibrary | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = useAvatarStore((s) => s.config);
  const cloud = useAvatarStore((s) => s.cloud);
  const animation = useAvatarStore((s) => s.animation);
  const loadConfig = useAvatarStore((s) => s.loadConfig);
  const viewerHandle = useAvatarStore((s) => s.viewerHandle);
  const dirty = useAvatarStore((s) => hasUnsavedChanges(s));
  const { save } = useCloudAvatar();

  useEffect(() => {
    if (!open) return;
    loadClipLibrary().then(setLibrary).catch(() => setLibrary(null));
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      toast.error(describeApiError(err, "Export failed."));
    } finally {
      setBusy(null);
    }
  };

  const name = slug(cloud.name);

  const exportPNG = () =>
    run("png", async () => {
      if (!viewerHandle) throw new Error("The 3D view is still loading.");
      // Phones can run out of GPU memory on big offscreen targets.
      const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      const size = mobile ? Math.min(pngSize, 1024) : pngSize;
      const blob = await viewerHandle.capturePNG({ size, transparent, framing });
      downloadBlob(blob, `${name}-${size}.png`);
      toast.success(size !== pngSize ? `Image downloaded at ${size}px (mobile limit)` : "Image downloaded");
    });

  const exportGLB = () =>
    run("glb", async () => {
      if (!viewerHandle) throw new Error("The 3D view is still loading.");
      const buffer = await viewerHandle.exportGLB({ animations: withAnimations });
      downloadBlob(new Blob([buffer], { type: "model/gltf-binary" }), `${name}.glb`);
      toast.success(withAnimations ? "GLB downloaded with all animations" : "GLB downloaded");
    });

  const ensureSaved = async () => {
    if (cloud.avatarId && !dirty) return cloud.avatarId;
    const saved = await save();
    return saved?.id ?? null;
  };

  const serverRender = () =>
    run("serverPng", async () => {
      const id = await ensureSaved();
      if (!id) return;
      const time = library?.clips.find((c) => c.id === animation)?.duration ?? 0;
      const result = await avatarApi.render(id, {
        width: 1024,
        height: 1024,
        background: transparent ? "transparent" : "#0B0D12",
        camera: serverCamera,
        animation,
        time: time * 0.3,
      });
      await downloadFromApi(result.url, `${name}-render.png`);
      toast.success("Server render ready");
    });

  const serverGlb = () =>
    run("serverGlb", async () => {
      const id = await ensureSaved();
      if (!id) return;
      const result = await avatarApi.exportGlb(id, withAnimations);
      await downloadFromApi(result.url, `${name}-api.glb`);
      toast.success("Server GLB ready");
    });

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      loadConfig(await importConfigJSON(file));
      toast.success("Configuration imported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog">
        <Icon name="download" size={16} />
        <span className="hidden sm:inline">Export</span>
      </Button>

      {open && (
        <div className="af-fade-up absolute right-0 top-11 z-40 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-white/10 bg-[#10121a]/98 shadow-2xl shadow-black/60 backdrop-blur-xl" role="dialog" aria-label="Export">
          <div className="max-h-[75dvh] overflow-y-auto">
            <section className="border-b border-white/[0.06] p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="image" size={16} className="text-indigo-300" /> Image
              </h3>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {FRAMINGS.map((f) => (
                  <Chip key={f.id} active={framing === f.id} onClick={() => setFraming(f.id)}>
                    {f.label}
                  </Chip>
                ))}
              </div>
              <div className="mb-3 flex gap-1.5">
                {PNG_SIZES.map((s) => (
                  <Chip key={s} active={pngSize === s} onClick={() => setPngSize(s)}>
                    {s}px
                  </Chip>
                ))}
              </div>
              <label className="mb-3 flex items-center gap-2 text-xs text-neutral-300">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} className="accent-indigo-500" />
                Transparent background
              </label>
              <Button variant="primary" className="w-full" onClick={exportPNG} disabled={busy !== null}>
                {busy === "png" ? <Spinner /> : <Icon name="download" size={16} />} Download PNG
              </Button>
            </section>

            <section className="border-b border-white/[0.06] p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="cube" size={16} className="text-indigo-300" /> 3D model (GLB)
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-neutral-400">One skeleton, face blendshapes (ARKit names) and, optionally, every animation — ready for Blender, Unity or Unreal.</p>
              <label className="mb-3 flex items-center gap-2 text-xs text-neutral-300">
                <input type="checkbox" checked={withAnimations} onChange={(e) => setWithAnimations(e.target.checked)} className="accent-indigo-500" />
                Include {library ? library.clips.length : 13} animations
              </label>
              <Button className="w-full" onClick={exportGLB} disabled={busy !== null}>
                {busy === "glb" ? <Spinner /> : <Icon name="download" size={16} />} Download GLB
              </Button>
            </section>

            <section className="border-b border-white/[0.06] p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="cloud" size={16} className="text-indigo-300" /> Render with the API
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-neutral-400">
                The same server pipeline developers call with <code className="text-neutral-300">POST /api/v1/avatars/render</code>. Uses the current animation pose. {cloud.avatarId && !dirty ? "" : "Saves your avatar first."}
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {CAMERAS.map((c) => (
                  <Chip key={c.id} active={serverCamera === c.id} onClick={() => setServerCamera(c.id)}>
                    {c.label}
                  </Chip>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={serverRender} disabled={busy !== null}>
                  {busy === "serverPng" ? <Spinner /> : <Icon name="image" size={15} />} HD PNG
                </Button>
                <Button onClick={serverGlb} disabled={busy !== null}>
                  {busy === "serverGlb" ? <Spinner /> : <Icon name="cube" size={15} />} Server GLB
                </Button>
              </div>
              {busy?.startsWith("server") && <p className="mt-2 text-[11px] text-neutral-500">Rendering in Blender on the server — usually 5–15 seconds…</p>}
            </section>

            <section className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="code" size={16} className="text-indigo-300" /> Configuration JSON
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={() => { exportConfigJSON(config); toast.success("Configuration downloaded"); }}>
                  <Icon name="download" size={14} /> Download
                </Button>
                <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Icon name="upload" size={14} /> Import
                </Button>
              </div>
              <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
