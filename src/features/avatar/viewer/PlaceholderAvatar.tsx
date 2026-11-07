"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAvatarStore } from "../state/avatarStore";

/**
 * Stand-in body while the licensed/authored base mesh (see Asset Strategy)
 * isn't wired in yet. It is a real, procedurally-animated rig hierarchy
 * (hips -> spine -> head / arms / legs), not a static prop — the animation
 * buttons drive actual motion here so nothing in the UI is a no-op.
 * Swapping in a skinned GLB later means replacing this component's meshes
 * with bone-driven ones; the AnimationController contract (animation name
 * in the store) stays the same.
 */
export function PlaceholderAvatar() {
  const animation = useAvatarStore((s) => s.animation);

  const hips = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!hips.current || !spine.current || !armL.current || !armR.current || !legL.current || !legR.current) {
      return;
    }

    hips.current.position.y = 1;
    hips.current.rotation.set(0, 0, 0);
    spine.current.rotation.set(0, 0, 0);
    armL.current.rotation.set(0, 0, 0);
    armR.current.rotation.set(0, 0, 0);
    legL.current.rotation.set(0, 0, 0);
    legR.current.rotation.set(0, 0, 0);

    switch (animation) {
      case "idle": {
        hips.current.position.y = 1 + Math.sin(t * 1.5) * 0.015;
        armL.current.rotation.z = 0.12 + Math.sin(t * 1.5) * 0.02;
        armR.current.rotation.z = -0.12 - Math.sin(t * 1.5) * 0.02;
        spine.current.rotation.y = Math.sin(t * 0.6) * 0.03;
        break;
      }
      case "walk": {
        const speed = 5;
        legL.current.rotation.x = Math.sin(t * speed) * 0.6;
        legR.current.rotation.x = Math.sin(t * speed + Math.PI) * 0.6;
        armL.current.rotation.x = Math.sin(t * speed + Math.PI) * 0.5;
        armR.current.rotation.x = Math.sin(t * speed) * 0.5;
        hips.current.position.y = 1 + Math.abs(Math.sin(t * speed)) * 0.05;
        spine.current.rotation.y = Math.sin(t * speed) * 0.08;
        break;
      }
      case "run": {
        const speed = 9;
        legL.current.rotation.x = Math.sin(t * speed) * 1.0;
        legR.current.rotation.x = Math.sin(t * speed + Math.PI) * 1.0;
        armL.current.rotation.x = Math.sin(t * speed + Math.PI) * 0.9;
        armR.current.rotation.x = Math.sin(t * speed) * 0.9;
        hips.current.position.y = 1 + Math.abs(Math.sin(t * speed)) * 0.08;
        spine.current.rotation.x = 0.15;
        spine.current.rotation.y = Math.sin(t * speed) * 0.1;
        break;
      }
      case "wave": {
        armR.current.rotation.z = -2.2;
        armR.current.rotation.x = Math.sin(t * 6) * 0.4;
        armL.current.rotation.z = 0.1;
        spine.current.rotation.y = Math.sin(t * 1.2) * 0.05;
        break;
      }
      case "jump": {
        const phase = (t * 1.6) % 1;
        const arc = Math.sin(phase * Math.PI);
        hips.current.position.y = 1 + arc * 0.35;
        legL.current.rotation.x = -arc * 0.5;
        legR.current.rotation.x = -arc * 0.5;
        armL.current.rotation.z = 0.3 + arc * 0.6;
        armR.current.rotation.z = -0.3 - arc * 0.6;
        break;
      }
      case "dance": {
        hips.current.position.y = 1 + Math.sin(t * 4) * 0.04;
        hips.current.rotation.y = Math.sin(t * 2) * 0.3;
        spine.current.rotation.z = Math.sin(t * 4) * 0.12;
        armL.current.rotation.z = 0.6 + Math.sin(t * 4) * 0.4;
        armR.current.rotation.z = -0.6 - Math.sin(t * 4 + Math.PI) * 0.4;
        legL.current.rotation.z = Math.sin(t * 4) * 0.15;
        legR.current.rotation.z = -Math.sin(t * 4) * 0.15;
        break;
      }
    }
  });

  return (
    <group ref={hips} position={[0, 1, 0]}>
      <group ref={spine} position={[0, 0.35, 0]}>
        <mesh castShadow position={[0, 0.15, 0]}>
          <capsuleGeometry args={[0.22, 0.5, 4, 8]} />
          <meshStandardMaterial color="#3a4a63" roughness={0.6} metalness={0.05} />
        </mesh>
        <mesh ref={head} castShadow position={[0, 0.68, 0]}>
          <sphereGeometry args={[0.16, 24, 24]} />
          <meshStandardMaterial color="#e0b89a" roughness={0.7} />
        </mesh>

        <group ref={armL} position={[0.32, 0.35, 0]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.07, 0.5, 4, 8]} />
            <meshStandardMaterial color="#e0b89a" roughness={0.7} />
          </mesh>
        </group>
        <group ref={armR} position={[-0.32, 0.35, 0]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.07, 0.5, 4, 8]} />
            <meshStandardMaterial color="#e0b89a" roughness={0.7} />
          </mesh>
        </group>
      </group>

      <group ref={legL} position={[0.11, 0, 0]}>
        <mesh castShadow position={[0, -0.45, 0]}>
          <capsuleGeometry args={[0.09, 0.7, 4, 8]} />
          <meshStandardMaterial color="#1f2937" roughness={0.8} />
        </mesh>
      </group>
      <group ref={legR} position={[-0.11, 0, 0]}>
        <mesh castShadow position={[0, -0.45, 0]}>
          <capsuleGeometry args={[0.09, 0.7, 4, 8]} />
          <meshStandardMaterial color="#1f2937" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}
