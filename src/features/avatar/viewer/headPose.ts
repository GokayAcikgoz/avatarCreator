import * as THREE from "three";
import { BodyRig } from "./bodyRig";

/** Rest-pose world rotation of a bone, composed from the rig's rest snapshot (independent of the current pose). */
function restWorldQuaternion(rig: BodyRig, bone: THREE.Object3D): THREE.Quaternion {
  const q = new THREE.Quaternion();
  for (let node: THREE.Object3D | null = bone; node; node = node.parent) {
    const local = (node as THREE.Bone).isBone ? rig.rest.get(node.name)?.quaternion ?? node.quaternion : node.quaternion;
    q.premultiply(local);
  }
  return q;
}

/**
 * Adds a head turn / nod / tilt on top of whatever the animation mixer posed this frame, spread over
 * the neck and head like the clip builder does (neck01 30 %, neck02 25 %, head 45 %). Axes are the
 * avatar's body axes (X = its left, Y = up, Z = forward) expressed in each bone's rest frame — the
 * same convention as tools/asset-pipeline/build_animation_clips.mjs, whose calibrated signs are:
 * + rotation about X nods down, about Y turns toward the avatar's left, about Z tilts to its right.
 */
export class HeadPoseDriver {
  private readonly joints: { bone: THREE.Bone; x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3; share: number }[] = [];
  private readonly q = new THREE.Quaternion();
  private turn = 0;
  private down = 0;
  private tilt = 0;

  constructor(rig: BodyRig) {
    for (const [name, share] of [
      ["neck01", 0.3],
      ["neck02", 0.25],
      ["head", 0.45],
    ] as const) {
      const bone = rig.bones.get(name);
      if (!bone) continue;
      const inv = restWorldQuaternion(rig, bone).invert();
      this.joints.push({
        bone,
        share,
        x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv).normalize(),
        y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv).normalize(),
        z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv).normalize(),
      });
    }
  }

  /** Smoothly follows the target rotation (radians) scaled by `weight`, and applies it. */
  apply(target: { turn: number; down: number; tilt: number } | null, weight: number, dt: number) {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 14);
    const clamp = THREE.MathUtils.clamp;
    this.turn += ((target ? clamp(target.turn, -0.7, 0.7) : 0) * weight - this.turn) * k;
    this.down += ((target ? clamp(target.down, -0.45, 0.45) : 0) * weight - this.down) * k;
    this.tilt += ((target ? clamp(target.tilt, -0.4, 0.4) : 0) * weight - this.tilt) * k;
    if (Math.abs(this.turn) + Math.abs(this.down) + Math.abs(this.tilt) < 1e-4) return;
    for (const j of this.joints) {
      j.bone.quaternion
        .multiply(this.q.setFromAxisAngle(j.y, this.turn * j.share))
        .multiply(this.q.setFromAxisAngle(j.x, this.down * j.share))
        .multiply(this.q.setFromAxisAngle(j.z, this.tilt * j.share));
    }
  }
}
