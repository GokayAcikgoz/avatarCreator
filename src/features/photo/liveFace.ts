/**
 * Live face: the camera drives the avatar's face (CLAUDE.md §13). MediaPipe Face Landmarker in
 * VIDEO mode gives 52 ARKit blendshapes per frame — the same names the avatar's face rig uses — and
 * the head's turn / nod / tilt from the landmarks. Mirror mode: the avatar behaves like a mirror
 * image of the person (left and right swapped), which is what people expect from a selfie view.
 *
 * Runs entirely on the device; frames are never stored or uploaded. The viewer reads
 * `liveFaceFrame.current` every frame (not React state — that's 30 updates a second).
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { Euler, Matrix4 } from "three";
import { create } from "zustand";
import { LM, headPose, toPixels } from "./faceMetrics";
import { quietly } from "./photoAnalysis";

const BASE = "/mediapipe";

export type LiveFaceStatus = "off" | "starting" | "tracking" | "searching" | "error";

interface LiveFaceState {
  status: LiveFaceStatus;
  message: string | null;
  setStatus: (status: LiveFaceStatus, message?: string | null) => void;
}

export const useLiveFace = create<LiveFaceState>((set) => ({
  status: "off",
  message: null,
  setStatus: (status, message = null) => set({ status, message }),
}));

export interface LiveFaceFrame {
  /** ARKit blendshape weights, already mirrored. */
  weights: Map<string, number>;
  /** Head rotation for the avatar (radians), already mirrored: + turn = toward the avatar's left,
   * + down = nodding down, + tilt = toward the avatar's right shoulder. */
  turn: number;
  down: number;
  tilt: number;
  /** performance.now() of the detection. */
  at: number;
  /** Milliseconds between detections (slow devices track at a lower rate). */
  interval: number;
}

export const liveFaceFrame: { current: LiveFaceFrame | null } = { current: null };
// Development only: lets QA scripts read what the tracker sees.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __afLiveFace?: typeof liveFaceFrame }).__afLiveFace = liveFaceFrame;

/** Whether a tracked frame is still current: older than ~3 detection intervals (min 0.6 s) means the
 * face was lost, and the avatar eases back to its own expression. */
export function isLiveFrameFresh(frame: LiveFaceFrame, now: number) {
  return now - frame.at < Math.max(600, frame.interval * 3);
}

let landmarker: Promise<FaceLandmarker> | null = null;

function loadVideoLandmarker(): Promise<FaceLandmarker> {
  landmarker ??= quietly(async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const make = (delegate: "GPU" | "CPU") =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/models/face_landmarker.task`, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  });
  landmarker.catch(() => {
    landmarker = null;
  });
  return landmarker;
}

/** Person's left ↔ avatar's right, so the avatar mirrors the person. */
const mirrorName = (name: string) => (name.endsWith("Left") ? `${name.slice(0, -4)}Right` : name.endsWith("Right") ? `${name.slice(0, -5)}Left` : name);

let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let preview: HTMLVideoElement | null = null;
let raf = 0;
let running = false;
let starting = false;
let lastVideoTime = -1;
let lastDetect = 0;
let detectCost = 0;
/** The person's resting head pose (first frames of a session): camera angle and posture aren't a nod. */
const neutral = { turn: 0, down: 0, tilt: 0, n: 0 };
const NEUTRAL_FRAMES = 15;
const matrix = new Matrix4();
const euler = new Euler();
let detectCount = 0;

function loop(lm: FaceLandmarker) {
  if (!running || !video) return;
  const now = performance.now();
  // ~30 detections/s; slower when a detection is expensive (CPU fallback) so the page stays smooth.
  const interval = Math.max(33, detectCost * 1.5);
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetect >= interval) {
    lastVideoTime = video.currentTime;
    lastDetect = now;
    try {
      // The first detections initialize the graph, which logs INFO lines through console.error.
      const quiet = detectCount++ < 3;
      const { error, warn } = console;
      if (quiet) console.error = console.warn = () => undefined;
      let result: ReturnType<FaceLandmarker["detectForVideo"]>;
      try {
        result = lm.detectForVideo(video, now);
      } finally {
        console.error = error;
        console.warn = warn;
      }
      detectCost = performance.now() - now;
      const landmarks = result.faceLandmarks?.[0];
      const categories = result.faceBlendshapes?.[0]?.categories;
      if (landmarks && categories) {
        const weights = new Map<string, number>();
        for (const c of categories) if (c.categoryName !== "_neutral") weights.set(mirrorName(c.categoryName), c.score);
        // Head pose: MediaPipe's facial transformation (canonical face → camera, fitted to all 478
        // points; ~identity when facing the camera). Euler YXZ: + yaw = the person turns to their
        // left, + pitch = nods down, + roll = tilts to their right. Landmark fallback otherwise.
        let yaw: number;
        let pitch: number;
        let roll: number;
        const m = result.facialTransformationMatrixes?.[0]?.data;
        if (m && m.length === 16) {
          euler.setFromRotationMatrix(matrix.fromArray(m), "YXZ");
          yaw = euler.y;
          pitch = euler.x;
          roll = euler.z;
        } else {
          const pts = toPixels(landmarks, video.videoWidth || 1, video.videoHeight || 1);
          const pose = headPose(pts);
          yaw = pose.yaw;
          pitch = pose.pitch;
          roll = -Math.atan2(pts[LM.faceLeft].y - pts[LM.faceRight].y, pts[LM.faceLeft].x - pts[LM.faceRight].x);
        }
        // Mirror: the person turning (or tilting) to their left reads as the avatar doing it to its right.
        let turn = -yaw;
        let down = pitch;
        let tilt = -roll;
        if (neutral.n < NEUTRAL_FRAMES) {
          neutral.n++;
          neutral.turn += (turn - neutral.turn) / neutral.n;
          neutral.down += (down - neutral.down) / neutral.n;
          neutral.tilt += (tilt - neutral.tilt) / neutral.n;
        }
        turn -= neutral.turn;
        down -= neutral.down;
        tilt -= neutral.tilt;
        const previous = liveFaceFrame.current;
        const interval = previous ? Math.min(2000, now - previous.at) : 33;
        liveFaceFrame.current = { weights, turn, down, tilt, at: now, interval };
        if (useLiveFace.getState().status !== "tracking") useLiveFace.getState().setStatus("tracking");
      } else if (useLiveFace.getState().status !== "searching") {
        useLiveFace.getState().setStatus("searching", "Looking for your face…");
      }
    } catch (error) {
      stopLiveFace();
      useLiveFace.getState().setStatus("error", `Face tracking stopped (${(error as Error).message}).`);
      return;
    }
  }
  raf = requestAnimationFrame(() => loop(lm));
}

/** Starts the camera into `target` (a <video> the UI shows as a mirrored preview) and tracks it. */
export async function startLiveFace(target: HTMLVideoElement) {
  if (running || starting) return;
  starting = true;
  const { setStatus } = useLiveFace.getState();
  setStatus("starting", "Starting camera…");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here.");
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    if (!starting) {
      acquired.getTracks().forEach((t) => t.stop()); // stopped while the permission prompt was open
      return;
    }
    stream = acquired;
    video = target;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    setStatus("starting", "Loading face tracking…");
    const lm = await loadVideoLandmarker();
    if (!starting) return; // stopped while loading
    running = true;
    lastVideoTime = -1;
    Object.assign(neutral, { turn: 0, down: 0, tilt: 0, n: 0 });
    setStatus("searching", "Looking for your face…");
    raf = requestAnimationFrame(() => loop(lm));
  } catch (error) {
    stopLiveFace();
    const denied = (error as DOMException)?.name === "NotAllowedError";
    setStatus("error", denied ? "Camera access was blocked — allow it in the address bar to use live face." : (error as Error).message || "The camera couldn't be started.");
  } finally {
    starting = false;
  }
}

/** The <video> element the live-face preview shows (registered by LiveFaceOverlay). */
export function registerLivePreview(element: HTMLVideoElement | null) {
  preview = element;
}

export function isLiveFaceOn() {
  return running || starting;
}

export function toggleLiveFace() {
  if (isLiveFaceOn()) stopLiveFace();
  else if (preview) void startLiveFace(preview);
}

export function stopLiveFace() {
  running = false;
  starting = false;
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
  video = null;
  liveFaceFrame.current = null;
  const { status, setStatus } = useLiveFace.getState();
  if (status !== "error") setStatus("off");
}
