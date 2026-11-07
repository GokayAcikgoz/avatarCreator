"use client";

import { useEffect, useEffectEvent, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BodyRig } from "./bodyRig";
import { irisTexture } from "./eyeTexture";

/**
 * How a part is shaded: garments/hair/hats/facial hair sit millimetres above the skin and get a
 * depth bias; face parts inside the head (eyes, teeth, tongue) must not (teeth would show through
 * closed lips); glasses float in front of the face with see-through lenses.
 */
export type AttachmentKind = "garment" | "glasses" | "eyes" | "brows" | "inner";

interface AttachmentProps {
  url: string;
  rig: BodyRig;
  kind: AttachmentKind;
  /** Garment stacking order (rig-spec.json garmentLayers): outer layers get a larger depth bias. */
  layer?: number;
  /** Texture tint (multiplied), or null for assets that keep their authored colors. */
  color: string | null;
  eyeColor?: string;
  /** Scalp or facial hair: low-specular material. */
  hair?: boolean;
  /** Height (meters, bind pose) above which this garment is covered by an outer layer and should retract. */
  retractAbove?: number | null;
  /** How far to retract there (meters) — deeper for voluminous hair under a hat than for a waistband. */
  retractDepth?: number;
  /** Reports this garment's lowest point (meters, bind pose) — its hem — for layering the garment under it. */
  onHem?: (hemMeters: number | null) => void;
  onMeshes: (meshes: THREE.SkinnedMesh[], mounted: boolean) => void;
  /** Called once the asset has loaded and is on screen. */
  onReady?: () => void;
}

interface BoundInstance {
  root: THREE.Object3D;
  meshes: THREE.SkinnedMesh[];
  materials: THREE.MeshStandardMaterial[];
  baseMaps: Map<THREE.MeshStandardMaterial, THREE.Texture | null>;
}

/**
 * Re-targets an attachment onto the body's skeleton. Every attachment was rigged to the same
 * MakeHuman armature before export, so its bones match the body's by name; binding its
 * SkinnedMesh to the *body's* bones (keeping its own inverse bind matrices) means one animation
 * mixer drives everything in perfect sync, and a GLB export carries a single skeleton.
 */
interface BindShape {
  /** Mesh units → meters scale, and the vertical offset, of the mesh's bind space. */
  scale: number;
  offsetY: number;
}

/**
 * Quantized GLBs store positions in a scaled "bind shape" space (meshopt folds the scale into the
 * inverse bind matrices), so distances in meters must be converted into it. Call while the mesh is
 * still bound to its own, never-animated skeleton: bone.matrixWorld × boneInverse *is* the bind shape.
 */
function bindShapeOf(mesh: THREE.SkinnedMesh): BindShape {
  mesh.skeleton.bones[0].updateWorldMatrix(true, false);
  const m = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.bones[0].matrixWorld, mesh.skeleton.boneInverses[0]);
  return { scale: m.getMaxScaleOnAxis(), offsetY: m.elements[13] };
}

/** Push-out distance for a garment layer — identical to assemble_avatar.py's, so both renderers stack clothes the same way. */
export const pushOutMeters = (layer: number) => 0.0012 + 0.0008 * layer;
/** How far a garment retracts where an outer layer covers it (e.g. a waistband under a shirt). */
export const RETRACT_METERS = 0.012;
const NO_RETRACT = 1e6;

interface GarmentUniforms {
  afPush: { value: number };
  afRetractAbove: { value: number };
  afRetractDepth: { value: number };
}

/**
 * Two bind-space vertex adjustments, applied before skinning so they follow every animation:
 *  - push-out: the garment sits a layer-dependent few millimetres off the skin
 *  - retract: above `afRetractAbove` (the hem of the garment layered over this one) the surface is
 *    pulled back inside, because a trouser waistband genuinely sticks out through a shirt by more
 *    than any depth bias can hide. That region is covered by the outer layer, so it's never seen.
 */
function applyGarmentShader(material: THREE.MeshStandardMaterial, pushUnits: number, retractDepthUnits: number): GarmentUniforms {
  const uniforms: GarmentUniforms = {
    afPush: { value: pushUnits },
    afRetractAbove: { value: NO_RETRACT },
    afRetractDepth: { value: retractDepthUnits },
  };
  material.userData.afUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", ["#include <common>", "uniform float afPush;", "uniform float afRetractAbove;", "uniform float afRetractDepth;"].join("\n"))
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "vec3 afN = normalize(normal);",
          "transformed += afN * afPush;",
          "if (position.y > afRetractAbove) transformed -= afN * afRetractDepth;",
        ].join("\n")
      );
  };
  material.customProgramCacheKey = () => "af-garment";
  return uniforms;
}

interface ShellRecipe {
  kind: "facialHair";
  /**
   * Innermost first: [offset in meters, opacity, taper, shade]. `taper` = the coverage an outer shell
   * needs before it shows (rounded, thinning edges); `shade` darkens inner layers (depth). Version-1
   * assets only carry [offset, opacity].
   */
  shells: number[][];
}

/** Coverage → a shell's alpha: outer shells keep only the denser core. Same math in assemble_avatar.py. */
export function shellAlpha(coverage: number, opacity: number, taper: number): number {
  return opacity * Math.min(1, Math.max(0, (coverage - taper) / Math.max(1e-3, 1 - taper)));
}

/**
 * Generated facial hair (tools/asset-pipeline/generate_facial_hair.mjs) ships one surface layer
 * plus a shell recipe. Stacking copies grown along `_grow` (the normal combed downward) gives the
 * hair real volume; the copies share every attribute except position and color, including the
 * (large) morph target data.
 */
function growShells(mesh: THREE.SkinnedMesh, recipe: ShellRecipe): THREE.SkinnedMesh[] {
  const base = mesh.geometry;
  const position = base.getAttribute("position");
  const normal = base.getAttribute("normal");
  // v2 assets: `_grow` = growth direction x local thickness. v1: the normal, scaled by `_thickness`.
  const grow = base.getAttribute("_grow");
  const coverage = base.getAttribute("color");
  const thickness = base.getAttribute("_thickness");
  // Quantized GLBs store positions in a scaled "bind shape" space (the scale is folded into the
  // inverse bind matrices); meters must be converted into that space. The attachment's own
  // skeleton is still at rest here, so bone.matrixWorld × boneInverse *is* that bind shape.
  const unitsPerMeter = 1 / bindShapeOf(mesh).scale;

  return recipe.shells.map(([offset, opacity, taper = 0, shade = 1], index) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(base.attributes)) if (name !== "position" && name !== "color") geometry.setAttribute(name, attribute);
    geometry.setIndex(base.index);
    geometry.morphAttributes = base.morphAttributes;
    geometry.morphTargetsRelative = base.morphTargetsRelative;
    const moved = new Float32Array(position.count * 3);
    const colors = new Float32Array(position.count * 4);
    const g = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      const d = offset * unitsPerMeter;
      if (grow) g.fromBufferAttribute(grow, i);
      else g.fromBufferAttribute(normal, i).normalize().multiplyScalar(thickness ? thickness.getX(i) : 1);
      moved[i * 3] = position.getX(i) + g.x * d;
      moved[i * 3 + 1] = position.getY(i) + g.y * d;
      moved[i * 3 + 2] = position.getZ(i) + g.z * d;
      const cover = coverage ? coverage.getW(i) : 1;
      colors.set([shade, shade, shade, shellAlpha(cover, opacity, taper)], i * 4);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(moved, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));

    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    material.vertexColors = true;
    material.opacity = 1;
    material.transparent = true;
    material.depthWrite = index === 0;
    const shell = new THREE.SkinnedMesh(geometry, material);
    shell.name = `${mesh.name}_shell${index}`;
    shell.userData = { ...mesh.userData };
    shell.morphTargetDictionary = mesh.morphTargetDictionary;
    shell.morphTargetInfluences = [...(mesh.morphTargetInfluences ?? [])];
    shell.renderOrder = 20 + index; // inner → outer, after opaque geometry
    shell.userData.shellIndex = index;
    shell.frustumCulled = false;
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    return shell;
  });
}

function bindToRig(source: THREE.Object3D, rig: BodyRig, kind: AttachmentKind, layer: number, hair: boolean): BoundInstance {
  const root = cloneSkinned(source);
  const found: THREE.SkinnedMesh[] = [];
  root.traverse((obj) => {
    obj.frustumCulled = false;
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) found.push(obj as THREE.SkinnedMesh);
  });

  // Measured before any re-binding, while each mesh still hangs off its own rest-pose skeleton.
  const binds = new Map(found.map((mesh) => [mesh, bindShapeOf(mesh)]));

  const meshes: THREE.SkinnedMesh[] = [];
  for (const mesh of found) {
    const recipe = mesh.userData?.avatarforge as ShellRecipe | undefined;
    if (recipe?.kind === "facialHair" && recipe.shells?.length) {
      const shells = growShells(mesh, recipe);
      mesh.parent?.add(...shells);
      mesh.removeFromParent();
      meshes.push(...shells);
    } else {
      meshes.push(mesh);
    }
  }

  const materials: THREE.MeshStandardMaterial[] = [];
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones.map((bone) => rig.bones.get(bone.name) ?? bone);
    mesh.bind(new THREE.Skeleton(bones, mesh.skeleton.boneInverses.map((m) => m.clone())), mesh.bindMatrix.clone());
    const shellIndex = mesh.userData.shellIndex as number | undefined;
    const cloned = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => prepareMaterial(m.clone() as THREE.MeshStandardMaterial, kind, layer, shellIndex, hair));
    if (kind === "garment" && shellIndex === undefined) {
      const bind = binds.get(mesh) ?? { scale: 1, offsetY: 0 };
      mesh.userData.afBind = bind;
      mesh.userData.afUniforms = cloned.map((material) => applyGarmentShader(material, pushOutMeters(layer) / bind.scale, RETRACT_METERS / bind.scale));
    }
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    materials.push(...cloned);
  }

  // Hair: the alpha-tested pass above draws the solid core with correct depth; a second,
  // alpha-blended pass of the same cards adds the soft strand tips the cutoff discarded (the
  // core redraws over itself unchanged). Viewer-only — GLB export skips it.
  if (hair) {
    for (const mesh of [...meshes]) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (Array.isArray(mesh.material) || !(material.alphaTest > 0) || mesh.userData.shellIndex !== undefined) continue;
      const soft = material.clone();
      soft.alphaTest = 0;
      soft.alphaToCoverage = false;
      soft.transparent = true;
      soft.depthWrite = false;
      const fringe = new THREE.SkinnedMesh(mesh.geometry, soft);
      fringe.name = `${mesh.name}_fringe`;
      fringe.frustumCulled = false;
      fringe.renderOrder = 10;
      fringe.userData = { ...mesh.userData, afExportSkip: true };
      if (mesh.userData.afBind) {
        const bind = mesh.userData.afBind as BindShape;
        fringe.userData.afUniforms = [applyGarmentShader(soft, pushOutMeters(layer) / bind.scale, RETRACT_METERS / bind.scale)];
      }
      fringe.bind(mesh.skeleton, mesh.bindMatrix);
      fringe.morphTargetDictionary = mesh.morphTargetDictionary;
      fringe.morphTargetInfluences = mesh.morphTargetInfluences ? [...mesh.morphTargetInfluences] : undefined;
      mesh.parent?.add(fringe);
      meshes.push(fringe);
      materials.push(soft);
    }
  }

  // The attachment's own copy of the armature no longer drives anything — detach it so it is
  // neither updated every frame nor exported as a second skeleton.
  const orphanBones: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone && !(obj.parent as THREE.Bone | null)?.isBone) orphanBones.push(obj);
  });
  for (const bone of orphanBones) bone.removeFromParent();

  return { root, meshes, materials, baseMaps: new Map(materials.map((m) => [m, m.map])) };
}

/**
 * Hair keeps ~a third of the default dielectric reflectance: with the default, dark hair turns
 * into a gray sheen under studio lights and a beard reads as a pale patch at grazing angles.
 * Mirrors soften_specular(obj, 0.15) in assemble_avatar.py (Blender's default level is 0.5).
 */
function lowSpecular(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  material.defines = { STANDARD: "", PHYSICAL: "" };
  material.specularIntensity = 0.3;
  material.roughness = Math.max(material.roughness, 0.75);
  return material;
}

function prepareMaterial(source: THREE.MeshStandardMaterial, kind: AttachmentKind, layer: number, shellIndex?: number, hair = false): THREE.MeshStandardMaterial {
  const material = hair ? lowSpecular(source) : source;
  material.metalness = 0;
  material.envMapIntensity = 0.6;
  if (shellIndex !== undefined) {
    // Hair shells are physically offset from the skin and from each other; only the innermost
    // needs a (small) bias. A large slope-dependent bias on every shell produces triangle-shaped
    // artifacts where adjacent faces disagree about which shell is in front.
    material.polygonOffset = shellIndex === 0;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
    return material;
  }
  if (kind === "garment" || kind === "brows") {
    // Form-fitted proxies share the skin's depth (and overlap each other at the waist, ankles...);
    // bias them toward the camera by stacking layer instead of moving geometry, so a shirt wins
    // over the trousers it covers and hair wins over the collar.
    // Only a small slope-scaled factor: a large one gives grazing-angle faces (the silhouette of a
    // waistband under a shirt) a huge bias that pops them in front of the outer layer. The real
    // layering is geometric (push-out/retract in the garment shader); this just settles near-coplanar
    // ties, with outer layers winning.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = kind === "garment" ? -(4 + 4 * layer) : -4;
  }
  if (material.alphaTest > 0) {
    // Hair cards / brows: MSAA-smoothed cut-outs instead of hard stair-stepped edges.
    material.alphaToCoverage = true;
  }
  if (kind === "glasses") {
    material.transparent = true;
    material.depthWrite = true;
  }
  return material;
}

export function Attachment({ url, rig, kind, layer = 3, color, eyeColor, hair = false, retractAbove = null, retractDepth = RETRACT_METERS, onHem, onMeshes, onReady }: AttachmentProps) {
  const gltf = useGLTF(url);
  const instance = useMemo(() => bindToRig(gltf.scene, rig, kind, layer, hair), [gltf.scene, rig, kind, layer, hair]);

  useEffect(() => {
    onMeshes(instance.meshes, true);
    return () => {
      onMeshes(instance.meshes, false);
      for (const material of instance.materials) material.dispose();
    };
  }, [instance, onMeshes]);
  // Reported once per loaded instance; the callback itself may change every render.
  const ready = useEffectEvent(() => onReady?.());
  useEffect(() => ready(), [instance]);

  useEffect(() => {
    if (!onHem) return;
    let hem = Infinity;
    for (const mesh of instance.meshes) {
      const bind = mesh.userData.afBind as BindShape | undefined;
      const position = mesh.geometry.getAttribute("position");
      if (!bind || !position) continue;
      for (let i = 0; i < position.count; i++) hem = Math.min(hem, position.getY(i) * bind.scale + bind.offsetY);
    }
    onHem(Number.isFinite(hem) ? hem : null);
    return () => onHem(null);
  }, [instance, onHem]);

  useEffect(() => {
    for (const mesh of instance.meshes) {
      const bind = mesh.userData.afBind as BindShape | undefined;
      const uniforms = mesh.userData.afUniforms as GarmentUniforms[] | undefined;
      if (!bind || !uniforms) continue;
      const above = retractAbove == null ? NO_RETRACT : (retractAbove - bind.offsetY) / bind.scale;
      for (const u of uniforms) {
        // Shader uniforms are mutable GPU-side state owned by this component's cloned materials.
        // eslint-disable-next-line react-hooks/immutability
        u.afRetractAbove.value = above;
        u.afRetractDepth.value = retractDepth / bind.scale;
      }
    }
  }, [instance, retractAbove, retractDepth]);

  useEffect(() => {
    for (const material of instance.materials) {
      if (color) material.color.set(color);
      else material.color.setRGB(1, 1, 1);
    }
  }, [instance, color]);

  useEffect(() => {
    if (kind !== "eyes" || !eyeColor) return;
    for (const material of instance.materials) {
      const base = instance.baseMaps.get(material);
      if (!base) continue;
      // three.js materials are imperative objects owned by this component (cloned in bindToRig).
      // eslint-disable-next-line react-hooks/immutability
      material.map = irisTexture(base, eyeColor);
      material.needsUpdate = true;
    }
  }, [instance, kind, eyeColor]);

  return <primitive object={instance.root} />;
}
