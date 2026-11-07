"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useAvatarStore, CameraFocus } from "../state/avatarStore";
import { heightScale } from "../config/rigSpec";
import { loadClipLibrary } from "../animation/clipLibrary";

/** Camera framings (target, camera position) for a 1.0-height-scale avatar, tuned for a ~4:3 viewport. */
const FRAMINGS: Record<CameraFocus, { target: [number, number, number]; position: [number, number, number] }> = {
  full: { target: [0, 0.9, 0], position: [0, 1.02, 4.7] },
  upper: { target: [0, 1.28, 0], position: [0.45, 1.42, 2.55] },
  face: { target: [0, 1.53, 0.02], position: [0.28, 1.58, 1.2] },
  lower: { target: [0, 0.55, 0], position: [0.4, 0.78, 2.75] },
  feet: { target: [0, 0.2, 0.06], position: [0.7, 0.42, 1.4] },
  portrait: { target: [0, 1.56, 0.03], position: [0.2, 1.6, 0.78] },
  torso: { target: [0, 1.17, 0.02], position: [0.3, 1.24, 1.6] },
  legs: { target: [0, 0.56, 0.02], position: [0.35, 0.62, 1.85] },
  shoes: { target: [0, 0.09, 0.06], position: [0.42, 0.28, 0.82] },
};

/** Image-based lighting from three's procedural RoomEnvironment — no HDR download, generated once. */
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // The R3F scene is a mutable three.js object by design; environment lighting is set on it directly.
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft stage disc and a blob shadow that follows the avatar — a fraction of the cost of real-time contact shadows. */
function Stage() {
  const stageTexture = useMemo(
    () => radialTexture([[0, "rgba(120,130,255,0.20)"], [0.55, "rgba(90,100,200,0.08)"], [1, "rgba(0,0,0,0)"]]),
    []
  );
  const shadowTexture = useMemo(() => radialTexture([[0, "rgba(0,0,0,0.55)"], [0.6, "rgba(0,0,0,0.18)"], [1, "rgba(0,0,0,0)"]]), []);
  const shadowRef = useRef<THREE.Mesh>(null);
  const { scene } = useThree();
  const hips = useRef<THREE.Object3D | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    if (!hips.current) hips.current = scene.getObjectByName("root") ?? null;
    if (!hips.current) return;
    hips.current.getWorldPosition(tmp);
    const airborne = Math.max(0, tmp.y - 0.9);
    shadow.position.set(tmp.x, 0.002, tmp.z + 0.04);
    const s = 1.1 - Math.min(0.5, airborne * 1.4);
    shadow.scale.set(s, s, s);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.85 - Math.min(0.6, airborne * 1.6);
  });

  return (
    <group userData={{ captureHidden: true }}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} userData={{ captureHidden: true }}>
        <circleGeometry args={[1.9, 64]} />
        <meshBasicMaterial map={stageTexture} transparent depthWrite={false} />
      </mesh>
      <mesh ref={shadowRef} rotation-x={-Math.PI / 2} userData={{ captureHidden: true }}>
        <planeGeometry args={[0.95, 0.95]} />
        <meshBasicMaterial map={shadowTexture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * A minimal stool that eases in for clips that sit (the "sit" capture is on a high stool); its seat
 * height and depth come from the clip data, so the avatar sits on it, not on air.
 */
function Stool() {
  const animation = useAvatarStore((s) => s.animation);
  const library = use(loadClipLibrary());
  const prop = library.clips.find((c) => c.id === animation)?.prop;
  const [seat, setSeat] = useState({ seatHeight: 0.6, seatZ: -0.04 });
  if (prop && (prop.seatHeight !== seat.seatHeight || prop.seatZ !== seat.seatZ)) setSeat({ seatHeight: prop.seatHeight, seatZ: prop.seatZ });
  const visible = Boolean(prop);
  const ref = useRef<THREE.Group>(null);
  const scaleY = useRef(0);
  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    scaleY.current = THREE.MathUtils.damp(scaleY.current, visible ? 1 : 0, 6, delta);
    group.visible = scaleY.current > 0.01;
    group.scale.setScalar(Math.max(0.001, scaleY.current));
  });
  return (
    <group ref={ref} position={[0, 0, seat.seatZ - 0.05]}>
      <mesh position={[0, seat.seatHeight - 0.025, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.05, 40]} />
        <meshStandardMaterial color="#2a2f3d" roughness={0.45} metalness={0.2} />
      </mesh>
      <mesh position={[0, (seat.seatHeight - 0.05) / 2, 0]}>
        <cylinderGeometry args={[0.025, 0.035, seat.seatHeight - 0.05, 16]} />
        <meshStandardMaterial color="#1b1f29" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.16, 0.18, 0.024, 32]} />
        <meshStandardMaterial color="#1b1f29" roughness={0.3} metalness={0.6} />
      </mesh>
    </group>
  );
}

/**
 * Orbit controls plus a "director" that glides the camera to a framing whenever the editor asks
 * for one (picking the Face tab frames the face, Shoes frames the feet). Any user drag/zoom takes
 * over immediately; pan is limited so the avatar can't be lost off-screen.
 */
function CameraRig({ snap = false }: { snap?: boolean }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const focus = useAvatarStore((s) => s.cameraFocus);
  const nonce = useAvatarStore((s) => s.cameraNonce);
  const height = useAvatarStore((s) => heightScale(s.config.body.height));
  const { size } = useThree();
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const framing = FRAMINGS[focus];
    const aspect = size.width / Math.max(1, size.height);
    // Narrow (phone) viewports need to back off to keep the same framing visible.
    const widen = aspect < 1 ? Math.pow(1 / aspect, 0.85) : 1;
    const target = new THREE.Vector3(framing.target[0], framing.target[1] * height, framing.target[2]);
    const offset = new THREE.Vector3(...framing.position).sub(new THREE.Vector3(...framing.target)).multiplyScalar(widen);
    goal.current = { target, position: target.clone().add(offset) };
  }, [focus, nonce, height, size.width, size.height]);

  useEffect(() => {
    const ctrl = controls.current;
    if (!ctrl) return;
    const cancel = () => (goal.current = null);
    ctrl.addEventListener("start", cancel);
    return () => ctrl.removeEventListener("start", cancel);
  }, []);

  useFrame((state, delta) => {
    const ctrl = controls.current;
    if (!ctrl) return;
    if (goal.current) {
      const k = snap ? 1 : 1 - Math.exp(-delta * 5);
      ctrl.target.lerp(goal.current.target, k);
      state.camera.position.lerp(goal.current.position, k);
      if (ctrl.target.distanceTo(goal.current.target) < 0.002 && state.camera.position.distanceTo(goal.current.position) < 0.004) {
        goal.current = null;
      }
    }
    ctrl.target.x = THREE.MathUtils.clamp(ctrl.target.x, -0.7, 0.7);
    ctrl.target.y = THREE.MathUtils.clamp(ctrl.target.y, 0.1, 1.9);
    ctrl.target.z = THREE.MathUtils.clamp(ctrl.target.z, -0.5, 0.5);
    ctrl.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.65}
      maxDistance={8}
      minPolarAngle={Math.PI * 0.12}
      maxPolarAngle={Math.PI * 0.62}
      enablePan
      screenSpacePanning
      panSpeed={0.6}
      rotateSpeed={0.75}
      zoomSpeed={0.8}
    />
  );
}

export function AvatarStage({ interactive = true, snap = false }: { interactive?: boolean; snap?: boolean }) {
  return (
    <>
      <StudioEnvironment />
      <hemisphereLight args={["#dfe6ff", "#141414", 0.35]} />
      <directionalLight position={[2.6, 3.6, 3.4]} intensity={2.1} color="#fff4e8" />
      <directionalLight position={[-3.2, 1.8, 2.2]} intensity={0.75} color="#cdd8ff" />
      <directionalLight position={[0.3, 3.2, -3.8]} intensity={1.9} color="#e8ecff" />
      <Stage />
      <Suspense fallback={null}>
        <Stool />
      </Suspense>
      {interactive ? <CameraRig snap={snap} /> : null}
    </>
  );
}
