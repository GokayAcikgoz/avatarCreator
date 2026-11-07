import { create } from "zustand";
import { AvatarConfiguration, DEFAULT_AVATAR_CONFIGURATION } from "../config/avatarConfig";
import { BODY_TYPES, getAsset } from "../config/assetManifest";
import { AVATAR_PRESETS } from "../config/presets";
import { randomAvatar } from "../services/randomizer";
import { AvatarVisibility } from "../services/avatarApi";

/** Every asset slot the configuration can hold a single item for. Accessories are a list (one per accessory slot). */
export type AssetSlot = "hair" | "beard" | "mustache" | "top" | "bottom" | "shoes";
export type BodyField = "height" | "shoulderWidth" | "proportion" | "gender";
/** Editor framings (full…feet) plus tight "close-up" framings used for catalog thumbnails. */
export type CameraFocus = "full" | "face" | "upper" | "lower" | "feet" | "portrait" | "torso" | "legs" | "shoes";

export interface CaptureOptions {
  size: number;
  transparent: boolean;
  /**
   * "current" = what the user is looking at; "portrait"/"full" = fixed studio framings (thumbnails,
   * share images); a view object = an explicit camera (QA contact sheets, render parity checks).
   */
  framing: "current" | "portrait" | "full" | CaptureView;
}

/** Explicit capture camera in avatar space (meters; the avatar stands at the origin facing +Z). */
export interface CaptureView {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface ViewerHandle {
  capturePNG: (options: CaptureOptions) => Promise<Blob>;
  exportGLB: (options: { animations: boolean }) => Promise<ArrayBuffer>;
  /**
   * Freezes the avatar on one frame of a clip (deterministic stills for QA and posed captures);
   * `null` resumes normal playback.
   */
  freezeAt: (animation: string | null, time?: number) => void;
}

/** Link between the editor and the account's saved copy in the API. */
export interface CloudLink {
  avatarId: string | null;
  name: string;
  visibility: AvatarVisibility;
  thumbnailUrl: string | null;
  /** JSON of the configuration as last saved — compared against the live config to show "unsaved changes". */
  savedSnapshot: string | null;
}

const HISTORY_LIMIT = 60;
const COALESCE_MS = 700;

export function getSlotAsset(config: AvatarConfiguration, slot: AssetSlot): string | null {
  switch (slot) {
    case "hair":
      return config.hair.style;
    case "beard":
      return config.facialHair.beardStyle;
    case "mustache":
      return config.facialHair.mustacheStyle;
    default:
      return config.clothing[slot];
  }
}

export function getSlotColor(config: AvatarConfiguration, slot: AssetSlot): string {
  switch (slot) {
    case "hair":
      return config.hair.color;
    case "beard":
    case "mustache":
      return config.facialHair.color;
    default:
      return config.clothing[`${slot}Color`];
  }
}

function withSlotAsset(config: AvatarConfiguration, slot: AssetSlot, id: string | null): AvatarConfiguration {
  switch (slot) {
    case "hair":
      return { ...config, hair: { ...config.hair, style: id } };
    case "beard":
      return { ...config, facialHair: { ...config.facialHair, beardStyle: id } };
    case "mustache":
      return { ...config, facialHair: { ...config.facialHair, mustacheStyle: id } };
    default:
      return { ...config, clothing: { ...config.clothing, [slot]: id } };
  }
}

function withSlotColor(config: AvatarConfiguration, slot: AssetSlot, hex: string): AvatarConfiguration {
  switch (slot) {
    case "hair":
      return { ...config, hair: { ...config.hair, color: hex } };
    case "beard":
    case "mustache":
      return { ...config, facialHair: { ...config.facialHair, color: hex } };
    default:
      return { ...config, clothing: { ...config.clothing, [`${slot}Color`]: hex } };
  }
}

/** Every asset id the configuration currently uses (for compatibility checks). */
export function currentSelections(config: AvatarConfiguration): (string | null)[] {
  return [
    config.hair.style,
    config.facialHair.beardStyle,
    config.facialHair.mustacheStyle,
    config.clothing.top,
    config.clothing.bottom,
    config.clothing.shoes,
    ...config.accessories,
  ];
}

export const configSnapshot = (config: AvatarConfiguration) => JSON.stringify(config);

interface AvatarStoreState {
  config: AvatarConfiguration;
  past: AvatarConfiguration[];
  future: AvatarConfiguration[];
  lastEdit: { key: string; at: number } | null;

  animation: string;
  selectedCategory: string;
  cameraFocus: CameraFocus;
  /** Bumped to re-apply the same focus (e.g. the "reset view" button). */
  cameraNonce: number;
  cloud: CloudLink;
  viewerHandle: ViewerHandle | null;

  /** Applies a configuration change and records it for undo. Edits sharing `coalesceKey` within a short window (slider drags) collapse into one undo step. */
  edit: (mutate: (config: AvatarConfiguration) => AvatarConfiguration, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;

  setMorph: (targets: string[], value: number) => void;
  setExpression: (id: string) => void;
  setBody: (field: BodyField, value: number) => void;
  setBodyType: (id: string) => void;
  setSkinTone: (hex: string) => void;
  setEyeColor: (hex: string) => void;
  selectSlot: (slot: AssetSlot, id: string | null) => void;
  setSlotColor: (slot: AssetSlot, hex: string) => void;
  toggleAccessory: (id: string) => void;
  setAccessoryColor: (id: string, hex: string) => void;
  applyPreset: (id: string) => void;
  randomize: () => void;
  reset: () => void;

  /** Replaces the whole configuration (open from cloud, import JSON, restore draft). Undoable. */
  loadConfig: (config: AvatarConfiguration, cloud?: Partial<CloudLink>) => void;
  /** Initial load (restored draft, deep link) — replaces the configuration without an undo step. */
  hydrate: (config: AvatarConfiguration, cloud?: Partial<CloudLink>) => void;
  setCloud: (patch: Partial<CloudLink>) => void;
  /** Detaches the editor from its cloud copy (next save creates a new avatar). */
  startNew: () => void;

  playAnimation: (id: string) => void;
  selectCategory: (id: string) => void;
  focusCamera: (focus: CameraFocus) => void;
  registerViewerHandle: (handle: ViewerHandle | null) => void;
}

const EMPTY_CLOUD: CloudLink = { avatarId: null, name: "My Avatar", visibility: "Private", thumbnailUrl: null, savedSnapshot: null };

export const useAvatarStore = create<AvatarStoreState>((set, get) => ({
  config: DEFAULT_AVATAR_CONFIGURATION,
  past: [],
  future: [],
  lastEdit: null,
  animation: "idle",
  selectedCategory: "presets",
  cameraFocus: "full",
  cameraNonce: 0,
  cloud: EMPTY_CLOUD,
  viewerHandle: null,

  edit: (mutate, coalesceKey) =>
    set((state) => {
      const next = mutate(state.config);
      if (next === state.config) return state;
      const now = Date.now();
      const coalesce =
        coalesceKey !== undefined && state.lastEdit?.key === coalesceKey && now - state.lastEdit.at < COALESCE_MS;
      const past = coalesce ? state.past : [...state.past, state.config].slice(-HISTORY_LIMIT);
      return { config: next, past, future: [], lastEdit: coalesceKey ? { key: coalesceKey, at: now } : null };
    }),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { config: previous, past: state.past.slice(0, -1), future: [state.config, ...state.future], lastEdit: null };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return { config: next, past: [...state.past, state.config], future: state.future.slice(1), lastEdit: null };
    }),

  setMorph: (targets, value) =>
    get().edit(
      (c) => ({
        ...c,
        face: { ...c.face, morphs: { ...c.face.morphs, ...Object.fromEntries(targets.map((t) => [t, value])) } },
      }),
      `morph:${targets[0]}`
    ),

  setExpression: (id) => get().edit((c) => ({ ...c, face: { ...c.face, expression: id } })),

  setBody: (field, value) => get().edit((c) => ({ ...c, body: { ...c.body, [field]: value } }), `body:${field}`),

  setBodyType: (id) => {
    const type = BODY_TYPES.find((t) => t.id === id);
    if (!type) return;
    get().edit((c) => ({ ...c, body: { ...c.body, type: id, shoulderWidth: type.shoulderWidth, proportion: type.proportion } }));
  },

  setSkinTone: (hex) => get().edit((c) => ({ ...c, face: { ...c.face, skinTone: hex } }), "skinTone"),

  setEyeColor: (hex) => get().edit((c) => ({ ...c, face: { ...c.face, eyeColor: hex } }), "eyeColor"),

  selectSlot: (slot, id) => get().edit((c) => withSlotAsset(c, slot, id)),

  setSlotColor: (slot, hex) => get().edit((c) => withSlotColor(c, slot, hex), `color:${slot}`),

  toggleAccessory: (id) =>
    get().edit((c) => {
      if (c.accessories.includes(id)) {
        return { ...c, accessories: c.accessories.filter((a) => a !== id) };
      }
      // One item per accessory slot: picking new glasses replaces the current pair.
      const slot = getAsset(id)?.slot;
      const kept = c.accessories.filter((a) => getAsset(a)?.slot !== slot);
      return { ...c, accessories: [...kept, id] };
    }),

  setAccessoryColor: (id, hex) =>
    get().edit((c) => ({ ...c, accessoryColors: { ...c.accessoryColors, [id]: hex } }), `accessory:${id}`),

  applyPreset: (id) => {
    const preset = AVATAR_PRESETS.find((p) => p.id === id);
    if (preset) get().edit(() => structuredClone(preset.configuration));
  },

  randomize: () => get().edit((c) => randomAvatar(c)),

  reset: () => {
    get().edit(() => DEFAULT_AVATAR_CONFIGURATION);
    set({ animation: "idle" });
  },

  loadConfig: (config, cloud) =>
    set((state) => ({
      config,
      past: [...state.past, state.config].slice(-HISTORY_LIMIT),
      future: [],
      lastEdit: null,
      cloud: cloud ? { ...state.cloud, ...cloud } : state.cloud,
    })),

  hydrate: (config, cloud) =>
    set((state) => ({ config, past: [], future: [], lastEdit: null, cloud: cloud ? { ...state.cloud, ...cloud } : state.cloud })),

  setCloud: (patch) => set((state) => ({ cloud: { ...state.cloud, ...patch } })),

  startNew: () => set({ cloud: EMPTY_CLOUD }),

  playAnimation: (id) => set({ animation: id }),
  selectCategory: (id) => set({ selectedCategory: id }),
  focusCamera: (focus) => set((state) => ({ cameraFocus: focus, cameraNonce: state.cameraNonce + 1 })),
  registerViewerHandle: (handle) => set({ viewerHandle: handle }),
}));

/** True when the editor holds changes the account's saved copy doesn't have yet. */
export function hasUnsavedChanges(state: Pick<AvatarStoreState, "config" | "cloud">): boolean {
  return state.cloud.savedSnapshot === null || state.cloud.savedSnapshot !== configSnapshot(state.config);
}
