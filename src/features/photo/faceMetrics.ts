/**
 * Face proportions from MediaPipe Face Landmarker points (the 468-point canonical topology; the
 * iris points 468–477 are not needed). Every metric is a distance divided by the face height
 * (forehead → chin), so it doesn't depend on photo size or distance — and no avatar slider changes
 * face height, so calibration against our own avatar stays clean.
 *
 * Shared by the live analysis (analyzeFace.ts) and the calibration tool
 * (tools/asset-pipeline/calibrate_face_metrics.mjs → shared/face-calibration.json).
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Landmark indices (MediaPipe canonical face mesh). "Right"/"left" are the subject's. */
export const LM = {
  foreheadTop: 10,
  chin: 152,
  faceRight: 234,
  faceLeft: 454,
  jawRight: 172,
  jawLeft: 397,
  eyeRightOuter: 33,
  eyeRightInner: 133,
  eyeLeftInner: 362,
  eyeLeftOuter: 263,
  eyeRightTop: 159,
  eyeRightBottom: 145,
  eyeLeftTop: 386,
  eyeLeftBottom: 374,
  noseBridge: 168,
  noseTip: 1,
  subnasale: 2,
  alarRight: 64,
  alarLeft: 294,
  mouthRight: 61,
  mouthLeft: 291,
  upperLipTop: 0,
  upperLipInner: 13,
  lowerLipInner: 14,
  lowerLipBottom: 17,
  irisRight: 468,
  irisLeft: 473,
} as const;

export const METRIC_IDS = ["faceWidth", "jawWidth", "eyeWidth", "eyeSpacing", "noseWidth", "noseLength", "mouthWidth", "lipThickness"] as const;
export type MetricId = (typeof METRIC_IDS)[number];
export type FaceMetrics = Record<MetricId, number>;

/**
 * Landmarks in a metric space: MediaPipe gives x, y normalized to the image and z in roughly x's
 * scale, so multiply by the image size to get isotropic pixel coordinates.
 */
export function toPixels(landmarks: Point3[], width: number, height: number): Point3[] {
  return landmarks.map((p) => ({ x: p.x * width, y: p.y * height, z: p.z * width }));
}

const dist = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a: Point3, b: Point3): Point3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

export function faceMetrics(points: Point3[]): FaceMetrics {
  const p = (i: number) => points[i];
  const height = dist(p(LM.foreheadTop), p(LM.chin));
  const eyeCenterR = mid(p(LM.eyeRightOuter), p(LM.eyeRightInner));
  const eyeCenterL = mid(p(LM.eyeLeftOuter), p(LM.eyeLeftInner));
  return {
    faceWidth: dist(p(LM.faceRight), p(LM.faceLeft)) / height,
    jawWidth: dist(p(LM.jawRight), p(LM.jawLeft)) / height,
    eyeWidth: (dist(p(LM.eyeRightOuter), p(LM.eyeRightInner)) + dist(p(LM.eyeLeftOuter), p(LM.eyeLeftInner))) / 2 / height,
    eyeSpacing: dist(eyeCenterR, eyeCenterL) / height,
    noseWidth: dist(p(LM.alarRight), p(LM.alarLeft)) / height,
    noseLength: dist(p(LM.noseBridge), p(LM.subnasale)) / height,
    mouthWidth: dist(p(LM.mouthRight), p(LM.mouthLeft)) / height,
    lipThickness: (dist(p(LM.upperLipTop), p(LM.upperLipInner)) + dist(p(LM.lowerLipInner), p(LM.lowerLipBottom))) / height,
  };
}

/** Head yaw/pitch (radians) from the landmarks alone: how far the face is turned from the camera. */
export function headPose(points: Point3[]): { yaw: number; pitch: number } {
  const r = points[LM.faceRight];
  const l = points[LM.faceLeft];
  const top = points[LM.foreheadTop];
  const chin = points[LM.chin];
  const yaw = Math.atan2(l.z - r.z, l.x - r.x);
  const pitch = Math.atan2(chin.z - top.z, chin.y - top.y);
  return { yaw, pitch };
}
