import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { RestPose, threeBoneName } from "../animation/clipLibrary";
import { RIG_SPEC, legFactor, shoulderFactor } from "../config/rigSpec";

export interface BodyRig extends RestPose {
  scene: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  skinMaterial: THREE.MeshStandardMaterial;
  /** Height difference between hip and ankle in the current rest pose — what a leg-length factor scales. */
  legSpan: number;
  /** Bone matrices (relative to the rig's scene) at the authored bind pose. */
  bindMatrices: Map<string, THREE.Matrix4>;
  /** Bone local positions for the current gender: the rest that body-shape sliders scale. */
  shapedRest: Map<string, THREE.Vector3>;
  /** Bone matrices at the current gender's rest, or null at the authored body (gender 0.5). */
  genderMatrices: Map<string, THREE.Matrix4> | null;
}

/**
 * Clones the cached body glTF (so edits never leak into useGLTF's shared cache or other viewers),
 * indexes its skeleton and snapshots the rest pose every animation and body-shape edit is relative to.
 */
export function createBodyRig(source: THREE.Object3D): BodyRig {
  const scene = cloneSkinned(source);
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = obj as THREE.SkinnedMesh;
    // Skinned bounds are computed in bind pose; animated limbs would otherwise get culled at the frustum edge.
    obj.frustumCulled = false;
  });
  if (!mesh) throw new Error("Body model has no skinned mesh");
  const skinned = mesh as THREE.SkinnedMesh;

  const bones = new Map<string, THREE.Bone>();
  const rest = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  for (const bone of skinned.skeleton.bones) {
    bones.set(bone.name, bone);
    rest.set(bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }

  scene.updateMatrixWorld(true);
  const hip = bones.get(threeBoneName("upperleg01.L"))?.getWorldPosition(new THREE.Vector3());
  const ankle = bones.get(threeBoneName("foot.L"))?.getWorldPosition(new THREE.Vector3());
  const legSpan = hip && ankle ? hip.y - ankle.y : 0.8;
  const sceneInverse = scene.matrixWorld.clone().invert();
  const bindMatrices = new Map<string, THREE.Matrix4>();
  for (const [name, bone] of bones) bindMatrices.set(name, sceneInverse.clone().multiply(bone.matrixWorld));
  const shapedRest = new Map([...rest].map(([name, r]) => [name, r.position.clone()]));

  const original = skinned.material as THREE.MeshStandardMaterial;
  const skinMaterial = original.clone();
  skinMaterial.metalness = 0;
  skinMaterial.roughness = 0.62;
  skinMaterial.envMapIntensity = 0.55;
  skinned.material = skinMaterial;

  return { scene, mesh: skinned, skinMaterial, legSpan, bones, rest, bindMatrices, shapedRest, genderMatrices: null };
}

const linear = new THREE.Color();

/** final = detail texture x (tone / reference) — the exact formula the API's Blender renderer uses. */
export function applySkinTone(rig: BodyRig, hex: string) {
  const ref = RIG_SPEC.skin.detailReference;
  linear.set(hex); // THREE.Color stores linear-sRGB after parsing a CSS hex
  // Not clamped to 1: for very fair tones the red channel exceeds the detail map's reference, and
  // clamping it flattens the hue toward white. (GLB export clamps, as glTF requires factors <= 1.)
  rig.skinMaterial.color.setRGB(linear.r / ref, linear.g / ref, linear.b / ref);
}

/**
 * Shoulder width and leg length move bones, never scale them: scaling a bone would scale every
 * child too (hands, feet). Translating the joint stretches only the skin between the two bones,
 * and every garment follows because it is bound to this same skeleton.
 */
export function applyBodyShape(rig: BodyRig, body: { shoulderWidth: number; proportion: number }): number {
  const shoulders = shoulderFactor(body.shoulderWidth);
  const legs = legFactor(body.proportion);
  for (const name of RIG_SPEC.body.shoulderWidth.bones) scaleRestOffset(rig, name, shoulders);
  for (const name of RIG_SPEC.body.proportion.bones) scaleRestOffset(rig, name, legs);
  // Longer legs would sink the feet through the floor — the caller lifts the root by this much.
  return (legs - 1) * rig.legSpan;
}

function scaleRestOffset(rig: BodyRig, fileName: string, factor: number) {
  const name = threeBoneName(fileName);
  const bone = rig.bones.get(name);
  const rest = rig.shapedRest.get(name);
  if (bone && rest) bone.position.copy(rest).multiplyScalar(factor);
}

const GENDER_JOINTS = new Map(Object.entries(RIG_SPEC.gender.joints as Record<string, number[]>).map(([name, d]) => [threeBoneName(name), new THREE.Vector3(...d)]));
/** Name of the gender morph target every mesh carries (weight 2g − 1). */
export const GENDER_TARGET = RIG_SPEC.gender.target as string;
export const genderWeight = (gender: number) => 2 * Math.min(1, Math.max(0, gender)) - 1;

/**
 * Gender moves the joints with the body (rig-spec.json → gender.joints, at weight 2g − 1): every
 * bone's rest position is shifted, and `genderMatrices` records the new rest so attachments can be
 * re-bound to it (see rebindSkeleton) — the morph moves the skin, the joints follow, nothing moves
 * twice. Returns how far the root moved (the caller offsets the animated root by it).
 */
export function applyGender(rig: BodyRig, gender: number): THREE.Vector3 {
  const w = genderWeight(gender);
  const world = new Map<string, THREE.Vector3>();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const [name, m] of rig.bindMatrices) {
    m.decompose(position, quaternion, scale);
    world.set(name, position.clone().addScaledVector(GENDER_JOINTS.get(name) ?? new THREE.Vector3(), w));
  }
  const matrices = new Map<string, THREE.Matrix4>();
  for (const [name, bone] of rig.bones) {
    const bind = rig.bindMatrices.get(name)!;
    bind.decompose(position, quaternion, scale);
    matrices.set(name, new THREE.Matrix4().compose(world.get(name)!, quaternion, scale));
    // Local rest position = parent's rest frame applied to the world offset between the joints.
    const parent = bone.parent as THREE.Bone | null;
    const parentMatrix = parent && rig.bindMatrices.has(parent.name) ? new THREE.Matrix4().compose(world.get(parent.name)!, new THREE.Quaternion().setFromRotationMatrix(rig.bindMatrices.get(parent.name)!), new THREE.Vector3(1, 1, 1)) : null;
    const local = parentMatrix ? world.get(name)!.clone().applyMatrix4(parentMatrix.invert()) : rig.rest.get(name)!.position.clone().addScaledVector(GENDER_JOINTS.get(name) ?? new THREE.Vector3(), w);
    rig.shapedRest.set(name, local);
    bone.position.copy(local);
  }
  rig.genderMatrices = Math.abs(w) < 1e-6 ? null : matrices;
  const hip = world.get(threeBoneName("upperleg01.L"));
  const ankle = world.get(threeBoneName("foot.L"));
  if (hip && ankle) rig.legSpan = hip.y - ankle.y;
  const root = rig.rest.get("root");
  return root ? rig.shapedRest.get("root")!.clone().sub(root.position) : new THREE.Vector3();
}

const originalInverses = new WeakMap<THREE.Skeleton, THREE.Matrix4[]>();
/**
 * Points a skeleton's inverse bind matrices at the current gender's rest (or back to the authored
 * one): newInverse = rest⁻¹ · bind · originalInverse, so a skinned mesh is unchanged at rest while
 * the joints it bends around have moved with the body.
 */
export function rebindSkeleton(rig: BodyRig, skeleton: THREE.Skeleton) {
  if (!originalInverses.has(skeleton)) originalInverses.set(skeleton, skeleton.boneInverses.map((m) => m.clone()));
  const originals = originalInverses.get(skeleton)!;
  skeleton.bones.forEach((bone, i) => {
    const target = rig.genderMatrices?.get(bone.name);
    const bind = rig.bindMatrices.get(bone.name);
    if (!target || !bind) skeleton.boneInverses[i].copy(originals[i]);
    else skeleton.boneInverses[i].copy(target).invert().multiply(bind).multiply(originals[i]);
  });
}
