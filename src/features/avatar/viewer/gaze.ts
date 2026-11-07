import * as THREE from "three";
import { BodyRig } from "./bodyRig";

/**
 * Living eyes. The avatar looks at the person (the camera) while they are roughly in front of it,
 * with the small saccades and occasional glances away that make a face read as alive — the eyes of
 * a still avatar staring through you is what makes it feel like a mannequin.
 *
 * Only the eye bones move (no clip animates them), within a natural range (±19° sideways, ±11°
 * up/down); everything is relative to the head, so it composes with any animation. Studio captures
 * and exports don't run it (eyes stay at rest, deterministic).
 */
export class GazeController {
  private readonly head: THREE.Bone | undefined;
  private readonly eyes: { bone: THREE.Bone; rest: THREE.Quaternion }[] = [];
  /** Head-local frame at rest: where "forward", "up" and the avatar's left point. */
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private offsetYaw = 0;
  private offsetPitch = 0;
  private nextSaccade = 0;
  private glanceUntil = 0;
  private seed = 7;

  // Scratch objects (no per-frame allocation).
  private readonly qHead = new THREE.Quaternion();
  private readonly qHeadInv = new THREE.Quaternion();
  private readonly qParent = new THREE.Quaternion();
  private readonly qTurn = new THREE.Quaternion();
  private readonly qTmp = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly eyesMid = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();

  constructor(rig: BodyRig) {
    this.head = rig.bones.get("head");
    for (const name of ["eyeL", "eyeR"]) {
      const bone = rig.bones.get(name);
      if (bone) this.eyes.push({ bone, rest: bone.quaternion.clone() });
    }
    if (this.head) {
      rig.scene.updateMatrixWorld(true);
      const inv = this.head.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.forward.set(0, 0, 1).applyQuaternion(inv).normalize();
      this.up.set(0, 1, 0).applyQuaternion(inv).normalize();
      this.left.crossVectors(this.up, this.forward).normalize();
    }
  }

  get available() {
    return Boolean(this.head) && this.eyes.length === 2;
  }

  /** Deterministic pseudo-random in [0, 1). */
  private random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  update(camera: THREE.Camera, time: number, dt: number) {
    if (!this.available) return;
    const head = this.head!;
    // Fresh world transforms for just this chain (the mixer has moved the bones this frame).
    for (const { bone } of this.eyes) bone.updateWorldMatrix(true, false);
    head.getWorldQuaternion(this.qHead);
    this.qHeadInv.copy(this.qHead).invert();

    // Where is the person, seen from between the eyes, in the head's frame?
    this.eyesMid.set(0, 0, 0);
    for (const { bone } of this.eyes) this.eyesMid.add(bone.getWorldPosition(this.v));
    this.eyesMid.multiplyScalar(0.5);
    camera.getWorldPosition(this.v).sub(this.eyesMid).normalize().applyQuaternion(this.qHeadInv);
    const toYaw = Math.atan2(this.v.dot(this.left), this.v.dot(this.forward));
    const toPitch = Math.asin(THREE.MathUtils.clamp(this.v.dot(this.up), -1, 1));
    // Someone standing far to the side or behind isn't looked at: eyes return to center.
    const inView = Math.abs(toYaw) < 1.05 && Math.abs(toPitch) < 0.8;

    // Saccades: a new small fixation offset every 0.6–2.4 s; now and then a short glance away.
    if (time >= this.nextSaccade) {
      const glance = this.random() < 0.18;
      this.offsetYaw = (this.random() * 2 - 1) * (glance ? 0.26 : 0.05);
      this.offsetPitch = (this.random() * 2 - 1) * (glance ? 0.1 : 0.03);
      this.glanceUntil = glance ? time + 0.5 + this.random() * 0.7 : 0;
      this.nextSaccade = time + (glance ? 0.9 : 0.6 + this.random() * 1.8);
    }
    if (this.glanceUntil && time > this.glanceUntil) {
      this.offsetYaw *= 0.2;
      this.offsetPitch *= 0.2;
      this.glanceUntil = 0;
    }

    const targetYaw = THREE.MathUtils.clamp((inView ? toYaw * 0.85 : 0) + this.offsetYaw, -0.33, 0.33);
    const targetPitch = THREE.MathUtils.clamp((inView ? toPitch * 0.85 : 0) + this.offsetPitch, -0.2, 0.2);
    // Eyes move fast (saccades take ~50 ms); a critically damped step keeps it smooth on any frame rate.
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 22);
    this.yaw += (targetYaw - this.yaw) * k;
    this.pitch += (targetPitch - this.pitch) * k;

    // Turn in the head's frame (yaw about its up axis, then pitch about its left axis), expressed in
    // world space, then moved into each eye's parent frame.
    this.qTurn.setFromAxisAngle(this.axis.copy(this.up).applyQuaternion(this.qHead), this.yaw);
    this.qTmp.setFromAxisAngle(this.axis.copy(this.left).applyQuaternion(this.qHead).applyQuaternion(this.qTurn), -this.pitch);
    this.qTurn.premultiply(this.qTmp);
    for (const { bone, rest } of this.eyes) {
      const parent = bone.parent!;
      parent.getWorldQuaternion(this.qParent);
      // local' = parentWorld⁻¹ · turn · parentWorld · rest
      bone.quaternion.copy(this.qParent).invert().multiply(this.qTurn).multiply(this.qParent).multiply(rest);
    }
  }

  /** Eyes straight ahead (rest). */
  reset() {
    for (const { bone, rest } of this.eyes) bone.quaternion.copy(rest);
    this.yaw = this.pitch = 0;
  }
}
