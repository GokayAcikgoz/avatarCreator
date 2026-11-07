import * as THREE from "three";
import { getExpressionPreset } from "../config/expressions";

const BLINK_KEYS = ["eyeBlinkLeft", "eyeBlinkRight"];

/**
 * Composes every facial morph source into one weight map per frame and writes it to every mesh
 * that carries face shape keys (body, eyes, brows, lashes, teeth, tongue, facial hair):
 *   1. structural sliders   — config.face.morphs (MakeHuman target names)
 *   2. expression           — the user's preset, cross-faded with an animation's signature
 *                             expression (laugh, wave...) by the animation mixer's own weights
 *   3. procedural blink     — additive on the eyeBlink keys, clamped to 1
 * ARKit naming means a future webcam face tracker could feed layer 2 directly.
 */
export class FaceDriver {
  /** Mesh → its authored (glTF default) morph weights. The body ships non-zero defaults for its 8
   * MakeHuman "macro" targets: that blend IS the body shape every garment was fitted to, so undriven
   * keys must rest at their default, never at 0 (zeroing them made the body poke through clothes). */
  private meshes = new Map<THREE.Mesh, Float32Array>();
  private weights = new Map<string, number>();

  register(meshes: THREE.Mesh[], mounted: boolean) {
    for (const mesh of meshes) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      if (mounted) {
        if (!this.meshes.has(mesh)) this.meshes.set(mesh, Float32Array.from(mesh.morphTargetInfluences));
      } else {
        this.meshes.delete(mesh);
      }
    }
  }

  /**
   * `live` (camera face tracking, ARKit weights) is blended in by `liveWeight` 0..1; the preset
   * expression, animation expression and procedural blink fade out by the same amount.
   */
  apply(structural: Record<string, number>, expressions: [string, number][], blink: number, live?: Map<string, number>, liveWeight = 0) {
    const w = this.weights;
    w.clear();
    for (const [name, value] of Object.entries(structural)) w.set(name, value);
    if (live && liveWeight > 0) {
      for (const [name, value] of live) w.set(name, (w.get(name) ?? 0) + value * liveWeight);
      expressions = expressions.map(([id, weight]) => [id, weight * (1 - liveWeight)]);
      blink *= 1 - liveWeight;
    }
    for (const [id, weight] of expressions) {
      if (weight <= 0) continue;
      for (const [name, value] of Object.entries(getExpressionPreset(id).morphs)) {
        w.set(name, (w.get(name) ?? 0) + value * weight);
      }
    }
    if (blink > 0) for (const key of BLINK_KEYS) w.set(key, Math.min(1, (w.get(key) ?? 0) + blink));

    for (const [mesh, defaults] of this.meshes) {
      const dict = mesh.morphTargetDictionary!;
      const influences = mesh.morphTargetInfluences!;
      for (const name in dict) {
        const i = dict[name];
        influences[i] = defaults[i] + (w.get(name) ?? 0);
      }
    }
  }
}
