"use client";

import { Component, ReactNode, Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { useAvatarStore, CaptureOptions } from "../state/avatarStore";
import { AvatarConfiguration } from "../config/avatarConfig";
import { alwaysOnAssets, getAsset, getAssetColors } from "../config/assetManifest";
import { AssetMetadata } from "../config/assetMetadata";
import { BODY_MODEL_URL, RIG_SPEC, garmentLayer, heightScale } from "../config/rigSpec";
import { buildClips, loadClipLibrary } from "../animation/clipLibrary";
import { Attachment, AttachmentKind } from "./Attachment";
import { BodyRig, GENDER_TARGET, applyBodyShape, applyGender, applySkinTone, createBodyRig, genderWeight, rebindSkeleton } from "./bodyRig";
import { FaceDriver } from "./faceDriver";
import { getBlinkWeight } from "./blinkClock";
import { GazeController } from "./gaze";
import { HeadPoseDriver } from "./headPose";
import { isLiveFrameFresh, liveFaceFrame } from "@/features/photo/liveFace";

interface PartSpec {
  key: string;
  asset: AssetMetadata;
  kind: AttachmentKind;
  color: string | null;
  layer: number;
}

/** Same sRGB-space darkening as the API's AssetResolver.Darken, so brows match in both renderers. */
function darken(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const channel = (i: number) => Math.round(parseInt(value.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Tint only assets that offer colors — glasses lenses or a red holiday hat keep what the artist made. */
function tint(asset: AssetMetadata | undefined, color: string | null | undefined): string | null {
  return asset && color && getAssetColors(asset).length > 0 ? color : null;
}

/** config → the list of parts to render. Pure; recomputed only when the configuration changes. */
function partsFor(config: AvatarConfiguration): PartSpec[] {
  const parts: PartSpec[] = [];
  const browColor = darken(config.hair.style ? config.hair.color : config.facialHair.color, RIG_SPEC.eyebrows.darkenFromHair);
  for (const asset of alwaysOnAssets()) {
    const kind: AttachmentKind = asset.slot === "eyes" ? "eyes" : asset.slot === "eyebrows" || asset.slot === "eyelashes" ? "brows" : "inner";
    parts.push({ key: asset.id, asset, kind, color: asset.slot === "eyebrows" ? browColor : null, layer: 0 });
  }
  const slot = (id: string | null, color: string, kind: AttachmentKind = "garment") => {
    const asset = getAsset(id);
    if (asset?.model) parts.push({ key: asset.id, asset, kind, color: tint(asset, color), layer: garmentLayer(asset.slot, asset.layer) });
  };
  slot(config.hair.style, config.hair.color);
  slot(config.facialHair.beardStyle, config.facialHair.color);
  slot(config.facialHair.mustacheStyle, config.facialHair.color);
  slot(config.clothing.top, config.clothing.topColor);
  slot(config.clothing.bottom, config.clothing.bottomColor);
  slot(config.clothing.shoes, config.clothing.shoesColor);
  for (const id of config.accessories) {
    const asset = getAsset(id);
    const color = config.accessoryColors[id] ?? getAssetColors(asset)[0] ?? null;
    slot(id, color ?? "#ffffff", asset?.slot === "face" ? "glasses" : "garment");
  }
  return parts;
}

/** Which "place" a part occupies: its slot (accessories: their accessory slot), or itself for always-on parts. */
const slotOf = (part: PartSpec) => (part.layer === 0 ? part.key : part.asset.slot);

/** One broken/missing asset must never take the whole avatar down (CLAUDE.md §37). */
class PartBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn(`[AvatarModel] "${this.props.name}" failed to load and was skipped.`, error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface AvatarModelProps {
  /** Register PNG/GLB capture on the store (the editor). Read-only viewers skip it. */
  exportable?: boolean;
  /** Procedural blinking (off for studio/thumbnail captures so nobody is caught mid-blink). */
  blink?: boolean;
}

export function AvatarModel({ exportable = true, blink = true }: AvatarModelProps) {
  const config = useAvatarStore((s) => s.config);
  const animation = useAvatarStore((s) => s.animation);
  const gltf = useGLTF(BODY_MODEL_URL);
  const library = use(loadClipLibrary());

  const rig = useMemo<BodyRig>(() => createBodyRig(gltf.scene), [gltf.scene]);
  const face = useMemo(() => new FaceDriver(), []);
  // Living eyes (look at the person, saccades) go with blinking: off for studio captures.
  const gaze = useMemo(() => new GazeController(rig), [rig]);
  // Live face (camera tracking): head pose on top of the animation + ARKit weights into the face.
  const headPose = useMemo(() => new HeadPoseDriver(rig), [rig]);
  const liveRef = useRef({ weight: 0, smoothed: new Map<string, number>() });
  const groupRef = useRef<THREE.Group>(null);
  /** Offset of the animated root: gender moves the hips, longer legs lift them. */
  const liftRef = useRef(new THREE.Vector3());
  /** Every skinned mesh on the avatar (body + attachments), to re-bind when the gender changes. */
  const skinnedRef = useRef(new Set<THREE.SkinnedMesh>());
  const pausedRef = useRef(false);

  // ── Animation: one mixer on the body skeleton drives every attachment (they share its bones).
  const anim = useMemo(() => {
    const mixer = new THREE.AnimationMixer(rig.scene);
    const clips = buildClips(library, rig);
    const actions = new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
    const defs = new Map(library.clips.map((d) => [d.id, d]));
    return { mixer, clips, actions, defs };
  }, [library, rig]);
  const currentAction = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    const next = anim.actions.get(animation) ?? anim.actions.get("idle");
    if (!next || (next === currentAction.current && next.isRunning())) return;
    const fade = anim.defs.get(next.getClip().name)?.fadeIn ?? 0.35;
    const previous = currentAction.current;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous && previous !== next && previous.getMixer() === anim.mixer && previous.isRunning()) previous.crossFadeTo(next, fade, false);
    else next.fadeIn(0.2);
    currentAction.current = next;
  }, [anim, animation]);

  // Stop (don't uncache) on unmount: under StrictMode the same memoized actions are replayed right
  // after this cleanup, and an uncached action throws when it's played again.
  useEffect(() => () => void anim.mixer.stopAllAction(), [anim]);

  // ── Body: skin tone + bone-based shape (shoulders, legs); height is the group scale below.
  useEffect(() => applySkinTone(rig, config.face.skinTone), [rig, config.face.skinTone]);
  const gender = config.body.gender;
  useEffect(() => {
    // Gender first (it sets the rest the body-shape sliders scale), then re-bind everything worn.
    const offset = applyGender(rig, gender);
    for (const mesh of skinnedRef.current) rebindSkeleton(rig, mesh.skeleton);
    const legs = applyBodyShape(rig, config.body);
    liftRef.current.copy(offset).add(new THREE.Vector3(0, legs, 0));
  }, [rig, gender, config.body]);

  const registerMeshes = useCallback(
    (meshes: THREE.Mesh[], mounted: boolean) => {
      face.register(meshes, mounted);
      for (const mesh of meshes as THREE.SkinnedMesh[]) {
        if (!mesh.isSkinnedMesh) continue;
        if (mounted) {
          skinnedRef.current.add(mesh);
          rebindSkeleton(rig, mesh.skeleton); // an asset put on later joins the current body shape
        } else skinnedRef.current.delete(mesh);
      }
    },
    [face, rig]
  );
  useEffect(() => {
    registerMeshes([rig.mesh], true);
    return () => registerMeshes([rig.mesh], false);
  }, [registerMeshes, rig]);

  const expressionsRef = useRef<[string, number][]>([]);
  const structuralRef = useRef<Record<string, number>>({});
  const advance = useCallback(
    (delta: number, camera?: THREE.Camera) => {
      anim.mixer.update(delta);
      const root = rig.bones.get("root");
      if (root) root.position.add(liftRef.current);

      // Expression weights follow the mixer's own cross-fade weights, so a "laugh" face fades in
      // and out together with the laugh animation.
      const user = useAvatarStore.getState().config.face;
      const weights = expressionsRef.current;
      weights.length = 0;
      let total = 0;
      for (const [id, action] of anim.actions) {
        const w = action.isRunning() ? action.getEffectiveWeight() : 0;
        if (w <= 0) continue;
        weights.push([anim.defs.get(id)?.expression ?? user.expression, w]);
        total += w;
      }
      if (total < 1) weights.push([user.expression, 1 - total]);

      // Live face: fades in when tracking starts and back out when the face is lost.
      const live = liveRef.current;
      const frame = liveFaceFrame.current;
      const fresh = blink && frame && isLiveFrameFresh(frame, performance.now()) ? frame : null;
      live.weight += ((fresh ? 1 : 0) - live.weight) * (1 - Math.exp(-delta * 6));
      if (fresh) {
        const k = 1 - Math.exp(-delta * 30); // tracking jitter filter, ~33 ms
        for (const [name, value] of fresh.weights) {
          const prev = live.smoothed.get(name) ?? 0;
          live.smoothed.set(name, prev + (value - prev) * k);
        }
      }
      if (live.weight > 1e-3 || fresh) headPose.apply(fresh, live.weight, delta);

      const structural = structuralRef.current;
      for (const key of Object.keys(structural)) delete structural[key];
      Object.assign(structural, user.morphs, { [GENDER_TARGET]: genderWeight(useAvatarStore.getState().config.body.gender) });
      face.apply(structural, weights, blink ? getBlinkWeight(performance.now() / 1000) : 0, live.smoothed, live.weight);
      if (blink && camera) {
        // While the camera drives the face, the eyes follow the person's own eyes (eyeLook* weights).
        if (live.weight > 0.02) gaze.reset();
        else gaze.update(camera, performance.now() / 1000, delta);
      }
    },
    [anim, rig, face, gaze, headPose, blink]
  );
  useFrame((state, delta) => {
    if (!pausedRef.current) advance(Math.min(delta, 0.1), state.camera);
  });

  const parts = useMemo(() => partsFor(config), [config]);

  // Layering: an outer piece's lowest edge decides where the piece it covers tucks in underneath it —
  // trousers under a shirt's hem, hair under a hat's rim. (A tucked-in top, layered *below* the
  // trousers, is simply covered by them instead.)
  const [hems, setHems] = useState<Record<string, number | null>>({});
  const reportHem = useMemo(() => {
    const make = (slot: string) => (hem: number | null) => setHems((prev) => (prev[slot] === hem ? prev : { ...prev, [slot]: hem }));
    return { top: make("top"), head: make("head") };
  }, []);
  const layerOf = (slot: string) => parts.find((p) => p.asset.slot === slot)?.layer;
  const covering = (slot: string): { above: number; depth: number } | null => {
    if (slot === "bottom") {
      const top = layerOf("top");
      const bottom = layerOf("bottom");
      return top !== undefined && bottom !== undefined && top > bottom && hems.top != null ? { above: hems.top + 0.015, depth: 0.012 } : null;
    }
    if (slot === "hair") return layerOf("head") !== undefined && hems.head != null ? { above: hems.head + 0.02, depth: 0.025 } : null;
    return null;
  };
  const scale = heightScale(config.body.height);

  const { gl, scene, camera } = useThree();
  const registerViewerHandle = useAvatarStore((s) => s.registerViewerHandle);

  useEffect(() => {
    if (!exportable) return;

    async function capturePNG({ size, transparent, framing }: CaptureOptions): Promise<Blob> {
      const group = groupRef.current;
      const height = group ? group.scale.y : 1;
      let cam = camera as THREE.PerspectiveCamera;
      if (typeof framing === "object") {
        cam = new THREE.PerspectiveCamera(framing.fov ?? 30, 1, 0.05, 30);
        cam.position.set(...framing.position);
        cam.lookAt(...framing.target);
      } else if (framing !== "current") {
        cam = new THREE.PerspectiveCamera(framing === "portrait" ? 24 : 30, 1, 0.05, 30);
        if (framing === "portrait") {
          cam.position.set(0.22, 1.6 * height, 1.45);
          cam.lookAt(0, 1.5 * height, 0.02);
        } else {
          cam.position.set(0, 0.98 * height, 4.6);
          cam.lookAt(0, 0.9 * height, 0);
        }
      }
      // Render into the canvas's own (default) framebuffer, not a render target: three.js applies
      // tone mapping only when drawing to the screen, so a render-target capture would come out
      // brighter/flatter than what the person sees. Resize → render → read → restore happens in one
      // synchronous task, so the browser never paints the temporary size.
      const hidden: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.userData.captureHidden && obj.visible) hidden.push(obj);
      });
      hidden.forEach((obj) => (obj.visible = false));
      const prevBackground = scene.background;
      const prevClear = new THREE.Color();
      gl.getClearColor(prevClear);
      const prevAlpha = gl.getClearAlpha();
      const prevAspect = (camera as THREE.PerspectiveCamera).aspect;
      const prevTarget = gl.getRenderTarget();
      const prevSize = gl.getSize(new THREE.Vector2());
      const prevRatio = gl.getPixelRatio();
      const pixels = new Uint8Array(size * size * 4);
      try {
        scene.background = null;
        gl.setClearColor(transparent ? 0x000000 : 0x0b0d12, transparent ? 0 : 1);
        if (cam === camera) {
          cam.aspect = 1;
          cam.updateProjectionMatrix();
        }
        gl.setRenderTarget(null);
        gl.setPixelRatio(1);
        gl.setSize(size, size, false);
        gl.clear(true, true, true);
        gl.render(scene, cam);
        const ctx = gl.getContext();
        ctx.readPixels(0, 0, size, size, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels);
      } finally {
        gl.setPixelRatio(prevRatio);
        gl.setSize(prevSize.x, prevSize.y, false);
        gl.setRenderTarget(prevTarget);
        gl.setClearColor(prevClear, prevAlpha);
        scene.background = prevBackground;
        if (cam === camera) {
          (camera as THREE.PerspectiveCamera).aspect = prevAspect;
          camera.updateProjectionMatrix();
        }
        hidden.forEach((obj) => (obj.visible = true));
      }

      // WebGL reads bottom-up and the canvas is premultiplied-alpha: flip rows, un-premultiply.
      const out = new Uint8ClampedArray(pixels.length);
      const row = size * 4;
      for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * row;
        const dst = y * row;
        for (let x = 0; x < row; x += 4) {
          const a = pixels[src + x + 3];
          const k = a > 0 && a < 255 ? 255 / a : 1;
          out[dst + x] = pixels[src + x] * k;
          out[dst + x + 1] = pixels[src + x + 1] * k;
          out[dst + x + 2] = pixels[src + x + 2] * k;
          out[dst + x + 3] = a;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d")!.putImageData(new ImageData(out, size, size), 0, 0);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png")
      );
    }

    async function exportGLB({ animations }: { animations: boolean }): Promise<ArrayBuffer> {
      const group = groupRef.current;
      if (!group) throw new Error("Avatar not ready yet");
      // Export the configured avatar standing at rest (body shape kept), eyes open, then resume.
      pausedRef.current = true;
      const saved = [...rig.bones.values()].map((bone) => [bone, bone.quaternion.clone(), bone.position.clone()] as const);
      const skinColor = rig.skinMaterial.color.clone();
      try {
        // glTF baseColorFactor must be <= 1 (the live factor can exceed it for very fair tones).
        const c = rig.skinMaterial.color;
        c.setRGB(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b));
        for (const [name, rest] of rig.rest) rig.bones.get(name)?.quaternion.copy(rest.quaternion);
        const root = rig.bones.get("root");
        const rootRest = rig.rest.get("root");
        if (root && rootRest) root.position.copy(rootRest.position).add(liftRef.current);
        const current = useAvatarStore.getState().config;
        face.apply({ ...current.face.morphs, [GENDER_TARGET]: genderWeight(current.body.gender) }, [[current.face.expression, 1]], 0);
        group.updateMatrixWorld(true);

        const lift = liftRef.current;
        const clips = animations
          ? anim.clips.map((clip) => {
              const copy = clip.clone();
              for (const track of copy.tracks) {
                if (track.name === "root.position")
                  for (let i = 0; i < track.values.length; i += 3) {
                    track.values[i] += lift.x;
                    track.values[i + 1] += lift.y;
                    track.values[i + 2] += lift.z;
                  }
              }
              return copy;
            })
          : [];
        // Bake each garment's shader push-out into its exported positions, so other engines stack
        // the clothes exactly like the viewer does.
        const swapped: [THREE.BufferGeometry, THREE.BufferAttribute | THREE.InterleavedBufferAttribute][] = [];
        group.traverse((obj) => {
          const mesh = obj as THREE.SkinnedMesh;
          const uniforms = (mesh.userData?.afUniforms as { afPush: { value: number }; afRetractAbove: { value: number }; afRetractDepth: { value: number } }[] | undefined)?.[0];
          if (!mesh.isSkinnedMesh || !uniforms || mesh.userData.afExportSkip) return;
          const geometry = mesh.geometry;
          const position = geometry.getAttribute("position");
          const normal = geometry.getAttribute("normal");
          if (!normal) return;
          const push = uniforms.afPush.value;
          const above = uniforms.afRetractAbove.value;
          const depth = uniforms.afRetractDepth.value;
          const baked = new Float32Array(position.count * 3);
          const n = new THREE.Vector3();
          for (let i = 0; i < position.count; i++) {
            n.fromBufferAttribute(normal, i).normalize();
            // Same math as the garment vertex shader (Attachment.tsx): push out, retract where covered.
            const d = push - (position.getY(i) > above ? depth : 0);
            baked[i * 3] = position.getX(i) + n.x * d;
            baked[i * 3 + 1] = position.getY(i) + n.y * d;
            baked[i * 3 + 2] = position.getZ(i) + n.z * d;
          }
          swapped.push([geometry, position]);
          geometry.setAttribute("position", new THREE.BufferAttribute(baked, 3));
        });
        // Viewer-only render passes (hair fringe) share geometry with the real meshes: leave them out.
        const skipped: THREE.Object3D[] = [];
        group.traverse((obj) => {
          if (obj.userData.afExportSkip && obj.visible) skipped.push(obj);
        });
        skipped.forEach((obj) => (obj.visible = false));
        try {
          const result = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true, animations: clips });
          return result as ArrayBuffer;
        } finally {
          skipped.forEach((obj) => (obj.visible = true));
          for (const [geometry, position] of swapped) geometry.setAttribute("position", position);
        }
      } finally {
        rig.skinMaterial.color.copy(skinColor);
        for (const [bone, q, p] of saved) {
          bone.quaternion.copy(q);
          bone.position.copy(p);
        }
        pausedRef.current = false;
      }
    }

    function freezeAt(id: string | null, time = 0) {
      if (id === null) {
        pausedRef.current = false;
        return;
      }
      const action = anim.actions.get(id);
      if (!action) throw new Error(`Unknown animation "${id}"`);
      anim.mixer.stopAllAction();
      action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      action.time = time % action.getClip().duration;
      currentAction.current = action;
      advance(0);
      pausedRef.current = true;
    }

    registerViewerHandle({ capturePNG, exportGLB, freezeAt });
    // Development only: lets QA scripts inspect the live scene graph.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __afScene?: THREE.Scene }).__afScene = scene;
    return () => registerViewerHandle(null);
  }, [exportable, gl, scene, camera, rig, anim, face, advance, registerViewerHandle]);

  // Per slot, the part currently on screen (see the Suspense fallback below).
  const [settled, setSettled] = useState<Record<string, PartSpec>>({});
  const markSettled = useCallback((slot: string, part: PartSpec) => setSettled((s) => (s[slot] === part ? s : { ...s, [slot]: part })), []);
  const renderPart = (part: PartSpec, onReady?: () => void) => (
    <Attachment
          url={part.asset.model!}
          rig={rig}
          kind={part.kind}
          layer={part.layer}
          color={part.color}
          eyeColor={part.kind === "eyes" ? config.face.eyeColor : undefined}
          hair={part.asset.slot === "hair" || part.asset.slot === "beard" || part.asset.slot === "mustache" || part.asset.slot === "eyebrows"}
          onHem={part.asset.slot === "top" ? reportHem.top : part.asset.slot === "head" ? reportHem.head : undefined}
          retractAbove={covering(part.asset.slot)?.above ?? null}
          retractDepth={covering(part.asset.slot)?.depth}
          onMeshes={registerMeshes}
          onReady={onReady}
        />
  );

  return (
    <group ref={groupRef} scale={scale} name="AvatarForgeAvatar">
      <primitive object={rig.scene} />
      {parts.map((part) => {
        const slot = slotOf(part);
        const previous = settled[slot];
        return (
          <PartBoundary key={part.key} name={part.asset.name}>
            {/* While a newly chosen asset downloads, the one it replaces stays on screen (no bald or
                bare flash between them). */}
            <Suspense fallback={previous && previous.key !== part.key ? renderPart(previous) : null}>{renderPart(part, () => markSettled(slot, part))}</Suspense>
          </PartBoundary>
        );
      })}
    </group>
  );
}

useGLTF.preload(BODY_MODEL_URL);
