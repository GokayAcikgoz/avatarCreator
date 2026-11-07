/**
 * Module-level (not React state) blink timer shared by every facial mesh. Driven purely as a
 * function of the shared R3F clock, so the body + eyes + eyelashes all compute the identical
 * blink phase every frame without needing synchronized mutable state — see
 * docs/asset-pipeline.md "Facial expression system" for why this is a plain module singleton
 * instead of Zustand state (avoids a 60fps store write).
 */
const BLINK_DURATION = 0.16;
let nextBlinkAt = 1.5 + Math.random() * 3;

export function getBlinkWeight(elapsed: number): number {
  if (elapsed >= nextBlinkAt + BLINK_DURATION) {
    nextBlinkAt = elapsed + 2.5 + Math.random() * 4.5;
    return 0;
  }
  if (elapsed >= nextBlinkAt) {
    const t = (elapsed - nextBlinkAt) / BLINK_DURATION;
    return t < 0.5 ? t * 2 : (1 - t) * 2;
  }
  return 0;
}
