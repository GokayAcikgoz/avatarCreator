"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/controls";
import { Icon, Spinner } from "@/components/ui/Icon";
import { toast } from "@/components/ui/toast";
import { useAvatarStore } from "../avatar/state/avatarStore";
import { useEditorUi } from "../avatar/state/editorUi";
import { FaceAnalysis } from "./analyzeFace";
import { PhotoSuggestion, TraitKey, applySuggestion, suggestFromAnalysis } from "./faceToConfig";
import { PhotoAnalysisError, analyzePhoto, loadVisionRuntime, toCanvas } from "./photoAnalysis";

type Step = { kind: "choose" } | { kind: "camera" } | { kind: "analyzing"; preview: string } | { kind: "result"; preview: string; analysis: FaceAnalysis; suggestion: PhotoSuggestion } | { kind: "error"; message: string; preview?: string };

const ALL_TRAITS: Record<TraitKey, boolean> = { skin: true, eyes: true, hair: true, facialHair: true, face: true };

/**
 * "Create from photo": take a selfie or upload a photo, analyze it on this device (MediaPipe, see
 * photoAnalysis.ts), review what was found and apply it — as one undoable edit.
 */
export function PhotoAvatarDialog() {
  const open = useEditorUi((s) => s.photoOpen);
  const setOpen = useEditorUi((s) => s.setPhotoOpen);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [include, setInclude] = useState<Record<TraitKey, boolean>>(ALL_TRAITS);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setStep({ kind: "choose" });
  }, [setOpen]);

  // Warm the models up as soon as the dialog opens, so analysis feels instant.
  useEffect(() => {
    if (open) void loadVisionRuntime().catch(() => undefined);
  }, [open]);

  const analyze = useCallback(async (canvas: HTMLCanvasElement) => {
    const preview = canvas.toDataURL("image/jpeg", 0.85);
    setStep({ kind: "analyzing", preview });
    try {
      const { analysis, otherFaces } = await analyzePhoto(canvas);
      const suggestion = suggestFromAnalysis(analysis, useAvatarStore.getState().config);
      if (otherFaces > 0) analysis.warnings.unshift("More than one face found — used the largest one.");
      setInclude({ ...ALL_TRAITS, eyes: Boolean(suggestion.eyeColor), hair: Boolean(suggestion.hair) });
      setStep({ kind: "result", preview, analysis, suggestion });
    } catch (error) {
      setStep({ kind: "error", preview, message: error instanceof PhotoAnalysisError ? error.message : "Something went wrong while analyzing the photo." });
    }
  }, []);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setStep({ kind: "error", message: "That file isn't an image. JPG, PNG or WebP photos work best." });
        return;
      }
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const canvas = toCanvas(bitmap);
        bitmap.close();
        await analyze(canvas);
      } catch {
        setStep({ kind: "error", message: "That image couldn't be opened (HEIC photos need converting to JPG first)." });
      }
    },
    [analyze]
  );

  const apply = () => {
    if (step.kind !== "result") return;
    const store = useAvatarStore.getState();
    store.edit((config) => applySuggestion(config, step.suggestion, include));
    store.focusCamera("face");
    toast.success("Your avatar was updated from the photo.", { label: "Undo", onClick: () => useAvatarStore.getState().undo() });
    close();
  };

  return (
    <Dialog open={open} onClose={close} title="Create from a photo" description="We find your face, skin tone, eyes, hair and facial hair — you choose what to use." width="lg">
      {step.kind === "choose" && (
        <div className="flex flex-col gap-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onFile(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center gap-4 rounded-3xl border border-dashed px-6 py-8 text-center transition ${dragging ? "border-indigo-400 bg-indigo-500/10" : "border-white/15 bg-white/[0.02]"}`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 text-white">
              <Icon name="camera" size={26} />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">Take a selfie or drop a photo here</p>
              <p className="mt-1 text-xs text-neutral-400">Face the camera, good light, no sunglasses or hat.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button variant="primary" onClick={() => setStep({ kind: "camera" })}>
                <Icon name="camera" size={16} /> Take a photo
              </Button>
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={16} /> Upload a photo
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="photo-file" />
            </div>
          </div>
          <p className="flex items-center gap-2 text-xs text-neutral-400">
            <Icon name="lock" size={14} /> Your photo is analyzed on this device and is never uploaded or stored.
          </p>
        </div>
      )}

      {step.kind === "camera" && <CameraCapture onCancel={() => setStep({ kind: "choose" })} onCapture={(canvas) => void analyze(canvas)} onError={(message) => setStep({ kind: "error", message })} />}

      {step.kind === "analyzing" && (
        <div className="flex flex-col items-center gap-4 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img src={step.preview} alt="Your photo" className="max-h-72 rounded-2xl object-contain opacity-60" />
          <p className="flex items-center gap-2 text-sm text-neutral-300">
            <Spinner /> Analyzing your photo… (the first time also loads the face model, ≈5 MB)
          </p>
        </div>
      )}

      {step.kind === "error" && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          {step.preview && <img src={step.preview} alt="Your photo" className="max-h-60 rounded-2xl object-contain opacity-70" />}
          <p className="text-sm text-rose-300">{step.message}</p>
          <Button variant="secondary" onClick={() => setStep({ kind: "choose" })}>
            Try another photo
          </Button>
        </div>
      )}

      {step.kind === "result" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img src={step.preview} alt="Your photo" className="max-h-56 w-full rounded-2xl object-cover object-top sm:max-h-72" />
          <div className="flex flex-col gap-2.5" data-testid="photo-traits">
            <TraitRow on={include.skin} onToggle={(v) => setInclude({ ...include, skin: v })} label="Skin tone" swatches={[step.suggestion.skinTone]} detail={step.suggestion.skinTone} />
            <TraitRow
              on={include.eyes}
              disabled={!step.suggestion.eyeColor}
              onToggle={(v) => setInclude({ ...include, eyes: v })}
              label="Eye color"
              swatches={step.suggestion.eyeColor ? [step.suggestion.eyeColor] : []}
              detail={step.suggestion.eyeColor ?? "Not visible"}
            />
            <TraitRow
              on={include.hair}
              disabled={!step.suggestion.hair}
              onToggle={(v) => setInclude({ ...include, hair: v })}
              label="Hair"
              swatches={step.suggestion.hair?.style ? [step.suggestion.hair.color] : []}
              detail={step.suggestion.hair?.label ?? "Couldn't tell"}
            />
            <TraitRow
              on={include.facialHair}
              onToggle={(v) => setInclude({ ...include, facialHair: v })}
              label="Facial hair"
              swatches={step.suggestion.facialHair.beardStyle || step.suggestion.facialHair.mustacheStyle ? [step.suggestion.facialHair.color] : []}
              detail={step.suggestion.facialHair.label}
            />
            <TraitRow
              on={include.face}
              disabled={step.suggestion.sliders.length === 0}
              onToggle={(v) => setInclude({ ...include, face: v })}
              label="Face shape"
              detail={
                step.suggestion.sliders.filter((s) => s.value !== 0).length
                  ? step.suggestion.sliders
                      .filter((s) => s.value !== 0)
                      .map((s) => `${s.label} ${s.value > 0 ? "+" : "−"}`)
                      .join(" · ")
                  : "Close to average — base shape kept"
              }
            />
            {step.analysis.warnings.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
                {step.analysis.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2.5">
              <Button variant="secondary" onClick={() => setStep({ kind: "choose" })}>
                Use another photo
              </Button>
              <Button variant="primary" onClick={apply} disabled={!Object.values(include).some(Boolean)} data-testid="photo-apply">
                <Icon name="check" size={16} /> Apply to my avatar
              </Button>
            </div>
            <p className="text-[11px] text-neutral-500">
              Everything stays editable afterwards. Nothing about you is guessed beyond these visible traits.
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function TraitRow({ on, onToggle, label, detail, swatches = [], disabled = false }: { on: boolean; onToggle: (on: boolean) => void; label: string; detail: string; swatches?: string[]; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition ${disabled ? "border-white/[0.04] opacity-50" : on ? "border-indigo-400/40 bg-indigo-500/[0.07]" : "border-white/[0.07]"}`}>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 accent-indigo-400" />
      <span className="w-24 shrink-0 text-sm font-medium text-white">{label}</span>
      {swatches.map((hex) => (
        <span key={hex} className="h-5 w-5 shrink-0 rounded-full ring-1 ring-white/20" style={{ backgroundColor: hex }} />
      ))}
      <span className="min-w-0 truncate text-xs text-neutral-400" title={detail}>
        {detail}
      </span>
    </label>
  );
}

function CameraCapture({ onCapture, onCancel, onError }: { onCapture: (canvas: HTMLCanvasElement) => void; onCancel: () => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError("This browser can't use the camera here — upload a photo instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);
      } catch (error) {
        const denied = (error as DOMException)?.name === "NotAllowedError";
        onError(denied ? "Camera access was blocked. Allow it in the browser's address bar, or upload a photo instead." : "No camera could be started — upload a photo instead.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onError]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full -scale-x-100 object-cover" />
        {/* Framing guide */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[72%] w-[42%] rounded-[50%] border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-neutral-300">
            <Spinner /> Starting camera…
          </div>
        )}
      </div>
      <div className="flex gap-2.5">
        <Button variant="secondary" onClick={onCancel}>
          Back
        </Button>
        <Button variant="primary" disabled={!ready} onClick={() => videoRef.current && onCapture(toCanvas(videoRef.current, true))}>
          <Icon name="camera" size={16} /> Capture
        </Button>
      </div>
    </div>
  );
}
