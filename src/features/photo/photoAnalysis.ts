/**
 * On-device photo analysis: MediaPipe Face Landmarker (478 points + blendshapes) and the hair
 * segmenter, both self-hosted under /mediapipe (scripts/prepare-mediapipe.mjs). The photo is only
 * ever drawn to an in-memory canvas — nothing is uploaded.
 */
import type { FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import { FaceAnalysis, analyzeFace } from "./analyzeFace";
import { Point3 } from "./faceMetrics";

const BASE = "/mediapipe";
const MAX_SIDE = 1024;

interface VisionRuntime {
  faceLandmarker: FaceLandmarker;
  hairSegmenter: ImageSegmenter | null;
}

let runtime: Promise<VisionRuntime> | null = null;

/**
 * MediaPipe's wasm prints its internal INFO/WARNING log lines through console.error/warn (e.g.
 * "INFO: Created TensorFlow Lite XNNPACK delegate"), which dev tooling reports as errors. Drop just
 * those lines while MediaPipe is working; everything else passes through.
 */
export async function quietly<T>(work: () => Promise<T> | T): Promise<T> {
  const noise = /^(INFO:|[IWE]\d{4} \d)/;
  const { error, warn } = console;
  console.error = (...args: unknown[]) => void (typeof args[0] === "string" && noise.test(args[0]) ? undefined : error(...args));
  console.warn = (...args: unknown[]) => void (typeof args[0] === "string" && noise.test(args[0]) ? undefined : warn(...args));
  try {
    return await work();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

/** Loads the models once (≈4.5 MB + wasm, cached by the browser afterwards). GPU first, CPU fallback. */
export function loadVisionRuntime(): Promise<VisionRuntime> {
  runtime ??= quietly(async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const create = async (delegate: "GPU" | "CPU"): Promise<VisionRuntime> => {
      const faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/models/face_landmarker.task`, delegate },
        runningMode: "IMAGE",
        numFaces: 3,
        outputFaceBlendshapes: true,
      });
      // Hair is a bonus: without it the rest of the analysis still works.
      const hairSegmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/models/hair_segmenter.tflite`, delegate },
        runningMode: "IMAGE",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }).catch(() => null);
      return { faceLandmarker, hairSegmenter };
    };
    try {
      return await create("GPU");
    } catch {
      return await create("CPU");
    }
  });
  runtime.catch(() => {
    runtime = null; // allow a retry after a network hiccup
  });
  return runtime;
}

export class PhotoAnalysisError extends Error {
  constructor(
    public code: "NO_FACE" | "RUNTIME" | "IMAGE",
    message: string
  ) {
    super(message);
  }
}

export interface PhotoAnalysisResult {
  analysis: FaceAnalysis;
  /** The (downscaled) photo as analyzed, for the preview. */
  canvas: HTMLCanvasElement;
  landmarks: Point3[];
  otherFaces: number;
  /** Hair confidence (maskWidth × maskHeight), for the preview overlay. */
  hairMask: { data: Float32Array; width: number; height: number } | null;
}

/** Draws any image source onto a canvas no larger than MAX_SIDE, keeping aspect. */
export function toCanvas(source: CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }, mirror = false): HTMLCanvasElement {
  const w = source.videoWidth || source.naturalWidth || (source.width as number);
  const h = source.videoHeight || source.naturalHeight || (source.height as number);
  if (!w || !h) throw new PhotoAnalysisError("IMAGE", "That image couldn't be read.");
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function analyzePhoto(canvas: HTMLCanvasElement): Promise<PhotoAnalysisResult> {
  let vision: VisionRuntime;
  try {
    vision = await loadVisionRuntime();
  } catch (error) {
    throw new PhotoAnalysisError("RUNTIME", `Face analysis couldn't start in this browser (${(error as Error).message}).`);
  }
  const result = await quietly(() => vision.faceLandmarker.detect(canvas));
  if (!result.faceLandmarks.length) throw new PhotoAnalysisError("NO_FACE", "No face found. Try a well-lit, straight-on photo with your whole face visible.");

  // The largest face is the person; others (a friend in the background) are ignored.
  const size = (lm: { x: number; y: number }[]) => {
    const xs = lm.map((p) => p.x);
    const ys = lm.map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  let best = 0;
  result.faceLandmarks.forEach((lm, i) => {
    if (size(lm) > size(result.faceLandmarks[best])) best = i;
  });
  const landmarks = result.faceLandmarks[best].map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const blendshapes: Record<string, number> = {};
  for (const c of result.faceBlendshapes?.[best]?.categories ?? []) blendshapes[c.categoryName] = c.score;

  let hairMask: Float32Array | null = null;
  let maskWidth = canvas.width;
  let maskHeight = canvas.height;
  if (vision.hairSegmenter) {
    const segmenter = vision.hairSegmenter;
    const seg = await quietly(() => segmenter.segment(canvas));
    try {
      const masks = seg.confidenceMasks ?? [];
      const hairChannel = masks[masks.length - 1]; // [background, hair]
      if (hairChannel) {
        hairMask = new Float32Array(hairChannel.getAsFloat32Array());
        maskWidth = hairChannel.width;
        maskHeight = hairChannel.height;
      }
    } finally {
      seg.close();
    }
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const analysis = analyzeFace({ width: canvas.width, height: canvas.height, pixels: image.data, landmarks, blendshapes, hairMask, maskWidth, maskHeight });
  return { analysis, canvas, landmarks, otherFaces: result.faceLandmarks.length - 1, hairMask: hairMask ? { data: hairMask, width: maskWidth, height: maskHeight } : null };
}
