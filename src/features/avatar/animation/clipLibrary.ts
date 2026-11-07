import * as THREE from "three";

/** One clip of shared/animation-clips.json (built by tools/asset-pipeline/build_animation_clips.mjs). */
export interface ClipDefinition {
  id: string;
  name: string;
  icon: string;
  duration: number;
  loop: boolean;
  fadeIn: number;
  expression: string | null;
  /** Where the motion comes from (e.g. "CMU 07_01" — mocap.cs.cmu.edu), when it is captured motion. */
  source?: string;
  /** A prop the clip needs, e.g. the stool for "sit" (seat top height and depth, meters). */
  prop?: { kind: "stool"; seatHeight: number; seatZ: number };
  frames: number;
  /** Rig bone name (file naming, e.g. "upperarm01.L") → flat quaternion deltas; exactly 4 values = constant. */
  tracks: Record<string, number[]>;
  /** Flat root translation deltas (armature space); [] = none, 3 values = constant. */
  root: number[];
}

export interface ClipLibrary {
  fps: number;
  clips: ClipDefinition[];
}

let libraryPromise: Promise<ClipLibrary> | null = null;

/** Lazily loaded (own chunk, ~60 KB gzipped) and cached for the session. */
export function loadClipLibrary(): Promise<ClipLibrary> {
  libraryPromise ??= import("@shared/animation-clips.json").then((m) => (m.default ?? m) as unknown as ClipLibrary);
  return libraryPromise;
}

export interface RestPose {
  bones: Map<string, THREE.Bone>;
  rest: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
}

/** three.js strips "." (and other reserved characters) from node names when loading glTF. */
export const threeBoneName = (fileName: string) => THREE.PropertyBinding.sanitizeNodeName(fileName);

/**
 * Converts shared clip data (rotation *deltas* on top of each bone's rest pose) into absolute
 * THREE.AnimationClips for a concrete skeleton. Every clip gets a track for every bone any clip
 * animates — otherwise cross-fading from "wave" to "idle" would leave the waving arm frozen
 * wherever the mixer last wrote it.
 */
export function buildClips(library: ClipLibrary, rig: RestPose): THREE.AnimationClip[] {
  const animated = new Set<string>();
  for (const clip of library.clips) for (const name of Object.keys(clip.tracks)) animated.add(name);

  const delta = new THREE.Quaternion();
  const out = new THREE.Quaternion();

  return library.clips.map((clip) => {
    const times = new Float32Array(clip.frames);
    for (let i = 0; i < clip.frames; i++) times[i] = clip.frames > 1 ? (i / (clip.frames - 1)) * clip.duration : 0;
    const constantTimes = new Float32Array([0, clip.duration]);

    const tracks: THREE.KeyframeTrack[] = [];
    for (const fileName of animated) {
      const boneName = threeBoneName(fileName);
      const rest = rig.rest.get(boneName);
      if (!rest) continue;
      const data = clip.tracks[fileName] ?? [0, 0, 0, 1];
      const constant = data.length === 4;
      const frameCount = constant ? 2 : clip.frames;
      const values = new Float32Array(frameCount * 4);
      for (let i = 0; i < frameCount; i++) {
        const k = constant ? 0 : i * 4;
        delta.set(data[k], data[k + 1], data[k + 2], data[k + 3]);
        out.copy(rest.quaternion).multiply(delta);
        values.set([out.x, out.y, out.z, out.w], i * 4);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, constant ? constantTimes : times, values));
    }

    const rootRest = rig.rest.get("root");
    if (rootRest) {
      const r = clip.root;
      const constant = r.length <= 3;
      const frameCount = constant ? 2 : clip.frames;
      const values = new Float32Array(frameCount * 3);
      for (let i = 0; i < frameCount; i++) {
        const k = constant ? 0 : i * 3;
        values.set([rootRest.position.x + (r[k] ?? 0), rootRest.position.y + (r[k + 1] ?? 0), rootRest.position.z + (r[k + 2] ?? 0)], i * 3);
      }
      tracks.push(new THREE.VectorKeyframeTrack("root.position", constant ? constantTimes : times, values));
    }

    return new THREE.AnimationClip(clip.id, clip.duration, tracks);
  });
}
