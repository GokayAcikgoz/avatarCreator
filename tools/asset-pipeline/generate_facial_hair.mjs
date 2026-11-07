// AvatarForge's own facial hair — generated from the base body, no third-party art.
//
// Each style is a region of the body's own face surface, exported as a skinned GLB that:
//   * shares the body's skeleton and skinning weights → follows every animation exactly
//   * carries the body's morph targets for those vertices → follows jaw, smile, face sliders
//   * is subdivided (1–2 levels) so thin shapes like a pencil mustache get clean edges
//   * has UVs into a tileable strand/stubble texture and a per-vertex coverage alpha (COLOR_0.a)
//   * stores a "shell" recipe in mesh extras: the viewer / renderer stack N copies of the surface,
//     each grown by `offset × _GROW` — a per-vertex vector: the normal combed downward (beards and
//     mustaches hang like hair), its length the local thickness (fuller chin). Outer shells only keep
//     the denser core (`taper`) and inner shells are darker (`shade`) — a soft, volumetric look.
//     (One custom attribute on purpose: Blender's glTF importer mis-merges several of different sizes.)
//
// Regions come from measured face landmarks, not guesses: the lip-volume and nose morph targets
// locate the vermilion border, the lower lip and the nose; a cylindrical head frame (θ around the
// head's vertical axis, y height) carries cheek lines, necklines and sideburns.
//
//   python tools/asset-pipeline/generate_facial_hair_textures.py   (once)
//   node tools/asset-pipeline/generate_facial_hair.mjs [ids…]
//   node tools/asset-pipeline/postprocess_attachments.mjs beard_stubble beard_short ...
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BODY = path.join(REPO, "api", "server-assets", "avatar-base-poc.glb");
const TEX_DIR = path.join(REPO, ".pipeline-tools", "facial-hair");
const OUT_DIR = path.join(REPO, ".pipeline-tools", "raw-attachments");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ── Head frame (meters, body bind pose; +Z forward, +Y up).
const Z_CENTER = 0.03; // the head's vertical axis sits ~3 cm behind the origin plane
const RADIUS = 0.085; // for arc-length UVs around the head
const SIDEBURN = 1.33; // |θ| just in front of the ear (ear ≈ 1.47)

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const band = (x, lo, hi, featherLo, featherHi = featherLo) => smoothstep(lo - featherLo, lo + featherLo, x) * (1 - smoothstep(hi - featherHi, hi + featherHi, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ────────────────────────────────────────────────────────────────────────── body + signals ──
const doc0 = await io.read(BODY);
const bodyMesh = doc0.getRoot().listMeshes()[0];
const bodyPrim = bodyMesh.listPrimitives()[0];
const TARGET_NAMES = bodyMesh.getExtras().targetNames;
const TARGETS = bodyPrim.listTargets();
const P = bodyPrim.getAttribute("POSITION");
const N = bodyPrim.getAttribute("NORMAL");
const COUNT = P.getCount();

function deltaMag(name) {
  const a = TARGETS[TARGET_NAMES.indexOf(name)].getAttribute("POSITION");
  const m = new Float32Array(COUNT);
  let max = 0;
  const e = [];
  for (let i = 0; i < COUNT; i++) {
    a.getElement(i, e);
    m[i] = Math.hypot(e[0], e[1], e[2]);
    max = Math.max(max, m[i]);
  }
  for (let i = 0; i < COUNT; i++) m[i] /= max || 1;
  return m;
}
const SIG = {
  lipU: deltaMag("mouth-upperlip-volume-incr"),
  lipL: deltaMag("mouth-lowerlip-volume-incr"),
  nose: (() => {
    const a = deltaMag("nose-scale-horiz-incr");
    const b = deltaMag("nose-scale-vert-incr");
    return a.map((v, i) => Math.max(v, b[i]));
  })(),
};
const POS = [];
const NOR = [];
for (let i = 0; i < COUNT; i++) {
  POS.push(P.getElement(i, []));
  NOR.push(N.getElement(i, []));
}
const thetaOf = (x, z) => Math.abs(Math.atan2(x, z - Z_CENTER));

// ── Landmarks per θ (0.01 rad buckets): vermilion border, lower lip bottom, nose bottom.
function curve(select, reduce) {
  const buckets = new Map();
  for (let i = 0; i < COUNT; i++) {
    const [x, y, z] = POS[i];
    if (z < 0 || y < 1.4 || y > 1.56) continue;
    if (!select(i, y)) continue;
    const k = Math.round(thetaOf(x, z) / 0.01);
    buckets.set(k, buckets.has(k) ? reduce(buckets.get(k), y) : y);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const fn = (th) => {
    const k = th / 0.01;
    if (k <= keys[0]) return buckets.get(keys[0]);
    if (k >= keys.at(-1)) return buckets.get(keys.at(-1));
    let i = 0;
    while (keys[i + 1] < k) i++;
    return lerp(buckets.get(keys[i]), buckets.get(keys[i + 1]), (k - keys[i]) / (keys[i + 1] - keys[i]));
  };
  fn.maxTheta = keys.at(-1) * 0.01;
  return fn;
}
const lipTop = curve((i) => SIG.lipU[i] > 0.35, Math.max);
const lowerLipBottom = curve((i) => SIG.lipL[i] > 0.35, Math.min);
const noseBottom = curve((i, y) => SIG.nose[i] > 0.3 && y > 1.49, Math.min);
const CORNER = Math.max(lipTop.maxTheta, lowerLipBottom.maxTheta); // mouth corner |θ|
const CORNER_Y = lipTop(CORNER);
const NOSE_WIDTH = noseBottom.maxTheta;

/** Cheek line: from the mouth corner up and back to the top of the sideburn. */
const cheekLine = (th) => {
  const t = clamp01((th - CORNER) / (SIDEBURN - CORNER));
  return th < CORNER ? lowerLipBottom(th) - 0.002 : lerp(CORNER_Y + 0.006, 1.585, t) + 0.012 * Math.sin(Math.min(1, (th - CORNER) / 0.9) * Math.PI);
};
/** Neckline: under the chin at the front, rising to the jaw hinge toward the ear. */
const neckLine = (th) => (th < 0.9 ? lerp(1.395, 1.425, th / 0.9) : lerp(1.425, 1.5, Math.min(1, (th - 0.9) / (SIDEBURN - 0.9))));

/**
 * A mustache on the skin between the nose and the upper lip: `height` above the vermilion border
 * at the middle (capped by the nose), thinning toward the ends; `overhang` hangs over the lip;
 * `endDrop` lets the ends fall past the mouth corners.
 */
function mustacheZone(v, { height = 0.012, overhang = 0.002, reach = 0.035, endDrop = 0.004 } = {}) {
  const t = clamp01(v.th / (CORNER + reach));
  const nose = v.th < NOSE_WIDTH ? noseBottom(v.th) + 0.002 : Infinity;
  const top = Math.min(nose, v.lipTop + height * (1 - 0.6 * t * t));
  const bottom = v.lipTop - overhang - endDrop * t * t;
  const across = 1 - smoothstep(CORNER + reach - 0.025, CORNER + reach + 0.006, v.th);
  return band(v.y, bottom, top, 0.0015, 0.0025) * across * (1 - smoothstep(0.3, 0.55, v.nose));
}
/** Cheeks, jaw, chin and neck up to the cheek line, stopping short of the ear. */
function beardZone(v, { neckDrop = 0, cheekRaise = 0, feather = 0.006, cheekFeather = 0.008 } = {}) {
  return band(v.y, neckLine(v.th) - neckDrop, cheekLine(v.th) + cheekRaise, feather + 0.004, cheekFeather) * (1 - smoothstep(SIDEBURN - 0.1, SIDEBURN + 0.01, v.th));
}
const noLips = (v) => (1 - smoothstep(0.15, 0.3, v.lipL)) * (1 - smoothstep(0.15, 0.3, v.lipU) * (1 - smoothstep(v.lipTop - 0.012, v.lipTop - 0.004, v.y)));
const chin = (v) => smoothstep(1.47, 1.42, v.y) * (1 - smoothstep(0.35, 0.95, v.th));

/**
 * Styles. weight(v) → coverage 0..1; thickness(v) scales shell offsets; droop combs the growth
 * direction downward (0 = straight out of the skin); shells are [offset m, opacity, taper, shade].
 */
const STYLES = {
  beard_stubble: {
    // Regrowth is densest on the chin and upper lip and fades out over the cheeks and neck — a wide,
    // well-smoothed fade (no hard patch edge on the coarse face mesh).
    texture: "stubble", tile: 0.03, levels: 0, droop: 0, smoothing: 6,
    weight: (v) =>
      v.surface * noLips(v) * (1 - smoothstep(0.3, 0.55, v.nose)) *
      Math.max(beardZone(v, { feather: 0.026, cheekFeather: 0.022 }) * (0.55 + 0.45 * Math.max(chin(v), 1 - smoothstep(0.15, 0.6, v.th))), mustacheZone(v, { height: 0.01, overhang: 0 })),
    thickness: () => 1,
    shells: [[0.0003, 0.95, 0, 0.9], [0.0008, 0.7, 0.3, 1]],
  },
  beard_short: {
    texture: "strands", tile: 0.034, levels: 0, droop: 0.35,
    weight: (v) => v.surface * noLips(v) * (1 - smoothstep(0.3, 0.55, v.nose)) * Math.max(beardZone(v, { neckDrop: 0.004 }), 0.9 * mustacheZone(v, { height: 0.01, overhang: 0.001 })),
    thickness: (v) => (1 + 0.35 * chin(v)) * (1 - 0.3 * mustacheZone(v, { height: 0.01, overhang: 0.001 })),
    shells: [[0.0004, 1, 0, 0.72], [0.0014, 1, 0.12, 0.8], [0.0026, 0.9, 0.28, 0.9], [0.004, 0.7, 0.46, 1]],
  },
  beard_full: {
    texture: "strands", tile: 0.036, levels: 0, droop: 0.55,
    weight: (v) => v.surface * noLips(v) * (1 - smoothstep(0.3, 0.55, v.nose)) * Math.max(beardZone(v, { neckDrop: 0.018, cheekRaise: 0.006, feather: 0.01, cheekFeather: 0.01 }), mustacheZone(v, { overhang: 0.003 })),
    thickness: (v) => (1 + 1.4 * chin(v)) * (1 - 0.35 * mustacheZone(v, { overhang: 0.003 })),
    shells: [[0.0005, 1, 0, 0.62], [0.0021, 1, 0.08, 0.7], [0.0041, 0.95, 0.18, 0.78], [0.0064, 0.88, 0.3, 0.86], [0.009, 0.72, 0.44, 0.94], [0.0118, 0.5, 0.6, 1]],
  },
  beard_goatee: {
    texture: "strands", tile: 0.032, levels: 1, droop: 0.5,
    weight: (v) => v.surface * noLips(v) * band(v.y, 1.425, lowerLipBottom(Math.min(v.th, CORNER)) - 0.001, 0.006, 0.0025) * (1 - smoothstep(CORNER + 0.03, CORNER + 0.14, v.th)),
    thickness: (v) => 1 + 0.6 * smoothstep(1.46, 1.425, v.y),
    shells: [[0.0005, 1, 0, 0.68], [0.0017, 1, 0.12, 0.78], [0.0031, 0.9, 0.28, 0.9], [0.0047, 0.7, 0.46, 1]],
  },
  mustache_classic: {
    texture: "strands", tile: 0.03, levels: 1, droop: 0.75, flare: 0.3, comb: 0.35,
    weight: (v) => v.surface * mustacheZone(v, { height: 0.013, overhang: 0.002, reach: 0.04, endDrop: 0.007 }),
    thickness: (v) => 1 + 0.6 * (1 - smoothstep(0, CORNER, v.th)),
    shells: [[0.0005, 1, 0, 0.68], [0.0017, 1, 0.12, 0.78], [0.0031, 0.92, 0.28, 0.9], [0.0046, 0.72, 0.46, 1]],
  },
  mustache_pencil: {
    texture: "strands", tile: 0.026, levels: 1, droop: 0.35, flare: 0.3, comb: 0.45,
    weight: (v) => v.surface * band(v.y, v.lipTop - 0.001, v.lipTop + 0.0035, 0.001, 0.0012) * (1 - smoothstep(CORNER - 0.03, CORNER - 0.005, v.th)) * smoothstep(0.012, 0.03, v.th),
    thickness: () => 1,
    shells: [[0.0004, 1, 0, 0.72], [0.0012, 0.95, 0.2, 0.86], [0.0021, 0.7, 0.42, 1]],
  },
  mustache_horseshoe: {
    texture: "strands", tile: 0.03, levels: 1, droop: 0.75, flare: 0.2, comb: 0.25,
    weight: (v) =>
      v.surface *
      Math.max(
        mustacheZone(v, { height: 0.011, overhang: 0.003, reach: 0.03, endDrop: 0.004 }),
        band(v.th, CORNER + 0.005, CORNER + 0.085, 0.015) * band(v.y, 1.428, v.lipTop + 0.006, 0.005, 0.003) * (1 - smoothstep(0.15, 0.3, v.lipL))
      ),
    thickness: () => 1.1,
    shells: [[0.0005, 1, 0, 0.68], [0.0017, 1, 0.12, 0.78], [0.0031, 0.92, 0.28, 0.9], [0.0046, 0.72, 0.46, 1]],
  },
};

// ───────────────────────────────────────────────────────────────────────────── geometry ──
/** Chart variables for weight functions. */
function chartOf(pos, nor, sig) {
  const [x, y, z] = pos;
  const rz = z - Z_CENTER;
  const len = Math.hypot(x, rz) || 1;
  const th = Math.abs(Math.atan2(x, rz));
  return {
    x, y, z, th,
    surface: smoothstep(0.05, 0.35, (nor[0] * x + nor[2] * rz) / len),
    lipU: sig.lipU, lipL: sig.lipL, nose: sig.nose,
    lipTop: th <= CORNER ? lipTop(th) : CORNER_Y,
  };
}

/** One vertex of the working mesh: everything that has to be interpolated on subdivision. */
// The body's 8 MakeHuman macro targets have non-zero default weights: that blend IS the default face.
// Facial hair bakes it into its base positions and normals (and drops those targets) — copying only
// position deltas left the hair lit with the un-blended normals (light and dark blotches on the skin).
const DEFAULT_WEIGHTS = bodyMesh.getWeights();
const MACRO = TARGETS.map((_, ti) => ti).filter((ti) => (DEFAULT_WEIGHTS[ti] ?? 0) !== 0);
const TARGET_HAS_NORMALS = TARGETS.every((t) => t.getAttribute("NORMAL"));

/** Per kept target: position delta (3) + normal delta (3). */
const MORPH_STRIDE = 6;

function vertexFromBody(i, keep) {
  const skin = new Map();
  const j = bodyPrim.getAttribute("JOINTS_0").getElement(i, []);
  const w = bodyPrim.getAttribute("WEIGHTS_0").getElement(i, []);
  for (let k = 0; k < 4; k++) if (w[k] > 0) skin.set(j[k], (skin.get(j[k]) ?? 0) + w[k]);
  const morph = new Float32Array(keep.length * MORPH_STRIDE);
  const e = [];
  keep.forEach((ti, k) => {
    TARGETS[ti].getAttribute("POSITION").getElement(i, e);
    morph.set(e, k * MORPH_STRIDE);
    if (TARGET_HAS_NORMALS) {
      TARGETS[ti].getAttribute("NORMAL").getElement(i, e);
      morph.set(e, k * MORPH_STRIDE + 3);
    }
  });
  const outPos = [...POS[i]];
  const outNor = [...NOR[i]];
  // Gender composite (macro_transfer.mjs): Σ male default·Δ − Σ female default·Δ, positions + normals.
  const gender = new Float32Array(6);
  for (const ti of MACRO) {
    const sign = TARGET_NAMES[ti].includes("$fe") ? -1 : 1;
    TARGETS[ti].getAttribute("POSITION").getElement(i, e);
    for (let a = 0; a < 3; a++) gender[a] += sign * DEFAULT_WEIGHTS[ti] * e[a];
    if (TARGET_HAS_NORMALS) {
      TARGETS[ti].getAttribute("NORMAL").getElement(i, e);
      for (let a = 0; a < 3; a++) gender[3 + a] += sign * DEFAULT_WEIGHTS[ti] * e[a];
    }
  }
  for (const ti of MACRO) {
    const wt = DEFAULT_WEIGHTS[ti];
    TARGETS[ti].getAttribute("POSITION").getElement(i, e);
    for (let a = 0; a < 3; a++) outPos[a] += wt * e[a];
    if (TARGET_HAS_NORMALS) {
      TARGETS[ti].getAttribute("NORMAL").getElement(i, e);
      for (let a = 0; a < 3; a++) outNor[a] += wt * e[a];
    }
  }
  const nl = Math.hypot(...outNor) || 1;
  return { pos: POS[i], nor: NOR[i], outPos, outNor: outNor.map((c) => c / nl), gender, skin, morph, sig: { lipU: SIG.lipU[i], lipL: SIG.lipL[i], nose: SIG.nose[i] } };
}
function midpoint(a, b) {
  const pos = a.pos.map((v, k) => (v + b.pos[k]) / 2);
  const n = a.nor.map((v, k) => v + b.nor[k]);
  const nl = Math.hypot(...n) || 1;
  const skin = new Map();
  for (const [j, w] of a.skin) skin.set(j, (skin.get(j) ?? 0) + w / 2);
  for (const [j, w] of b.skin) skin.set(j, (skin.get(j) ?? 0) + w / 2);
  const morph = a.morph.map((v, k) => (v + b.morph[k]) / 2);
  const sig = { lipU: (a.sig.lipU + b.sig.lipU) / 2, lipL: (a.sig.lipL + b.sig.lipL) / 2, nose: (a.sig.nose + b.sig.nose) / 2 };
  const outPos = a.outPos.map((v, k) => (v + b.outPos[k]) / 2);
  const on = a.outNor.map((v, k) => v + b.outNor[k]);
  const onl = Math.hypot(...on) || 1;
  const gender = a.gender.map((v, k) => (v + b.gender[k]) / 2);
  return { pos, nor: n.map((v) => v / nl), outPos, outNor: on.map((v) => v / onl), gender, skin, morph, sig };
}
function subdivide(verts, tris) {
  const cache = new Map();
  const mid = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!cache.has(key)) {
      cache.set(key, verts.length);
      verts.push(midpoint(verts[a], verts[b]));
    }
    return cache.get(key);
  };
  const out = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return out;
}
/** Top-4 skin influences, renormalized — what glTF can store. */
function packSkin(skin) {
  const top = [...skin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  while (top.length < 4) top.push([0, 0]);
  return [top.map(([j]) => j), top.map(([, w]) => w / sum)];
}

function toWebp(pngPath) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "af-fh-")), "out.webp");
  execFileSync("python", ["-c", `from PIL import Image; Image.open(r"${pngPath}").save(r"${tmp}", "WEBP", quality=85, method=6)`]);
  return new Uint8Array(fs.readFileSync(tmp));
}

async function build(id, style, textures) {
  // Coarse selection on the body's own vertices, dilated by one ring so subdivision can feather.
  const weightAt = (pos, nor, sig) => {
    if (pos[1] < 1.3 || pos[1] > 1.66) return 0;
    return clamp01(style.weight(chartOf(pos, nor, sig)));
  };
  const coarse = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) coarse[i] = weightAt(POS[i], NOR[i], { lipU: SIG.lipU[i], lipL: SIG.lipL[i], nose: SIG.nose[i] });
  const indices = bodyPrim.getIndices().getArray();
  const touched = new Set();
  for (let t = 0; t < indices.length; t += 3) {
    if (Math.max(coarse[indices[t]], coarse[indices[t + 1]], coarse[indices[t + 2]]) > 0.001) touched.add(indices[t]).add(indices[t + 1]).add(indices[t + 2]);
  }
  const seedTris = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    if (touched.has(a) || touched.has(b) || touched.has(c)) seedTris.push(a, b, c);
  }

  // Morph targets that actually move this region (the rest are dropped to keep the file small).
  const seedVerts = [...new Set(seedTris)];
  const keep = [];
  for (let ti = 0; ti < TARGETS.length; ti++) {
    const a = TARGETS[ti].getAttribute("POSITION");
    const e = [];
    // Keep targets that move this region by more than 0.3 mm anywhere (below that it's invisible).
    if (MACRO.includes(ti)) continue; // baked into the base shape
    if (TARGET_NAMES[ti] === "af-gender") continue; // added below, exactly
    if (seedVerts.some((i) => (a.getElement(i, e), Math.hypot(e[0], e[1], e[2]) > 3e-4))) keep.push(ti);
  }

  const remap = new Map();
  const verts = [];
  const tris = seedTris.map((i) => {
    if (!remap.has(i)) {
      remap.set(i, verts.length);
      verts.push(vertexFromBody(i, keep));
    }
    return remap.get(i);
  });
  let working = tris;
  for (let l = 0; l < style.levels; l++) working = subdivide(verts, working);

  // Coverage on the fine mesh, then two smoothing passes over the mesh graph (removes faceting).
  let cover = verts.map((v) => weightAt(v.pos, v.nor, v.sig));
  const neighbors = verts.map(() => new Set());
  for (let t = 0; t < working.length; t += 3) {
    const [a, b, c] = [working[t], working[t + 1], working[t + 2]];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  for (let pass = 0; pass < (style.smoothing ?? 2); pass++) {
    cover = cover.map((w, i) => {
      if (!neighbors[i].size) return w;
      let s = 0;
      for (const j of neighbors[i]) s += cover[j];
      return 0.5 * w + (0.5 * s) / neighbors[i].size;
    });
  }

  const finalTris = [];
  for (let t = 0; t < working.length; t += 3) {
    const [a, b, c] = [working[t], working[t + 1], working[t + 2]];
    if (Math.max(cover[a], cover[b], cover[c]) > 0.02) finalTris.push(a, b, c);
  }
  const order = [];
  const index = new Map();
  const idx = new Uint32Array(finalTris.map((i) => {
    if (!index.has(i)) {
      index.set(i, order.length);
      order.push(i);
    }
    return index.get(i);
  }));
  const n = order.length;

  // Per-vertex attributes.
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const color = new Float32Array(n * 4);
  const grow = new Float32Array(n * 3);
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  order.forEach((vi, k) => {
    const v = verts[vi];
    const [x, y, z] = v.pos;
    const [nx, ny, nz] = v.outNor;
    position.set(v.outPos, k * 3);
    normal.set(v.outNor, k * 3);
    // Growth: out of the skin, combed down (droop), outward from the philtrum (flare).
    const down = [0 - nx * -ny, -1 - ny * -ny, 0 - nz * -ny]; // (0,-1,0) projected onto the tangent plane
    const dl = Math.hypot(...down) || 1;
    const side = Math.sign(x) || 1;
    const out = [side - nx * nx * side, -ny * nx * side, -nz * nx * side]; // (±1,0,0) projected
    const ol = Math.hypot(...out) || 1;
    const flare = (style.flare ?? 0) * (1 - smoothstep(CORNER * 0.6, CORNER * 1.2, chartOf(v.pos, v.nor, v.sig).th));
    const g = [0, 1, 2].map((a) => v.outNor[a] + (style.droop * down[a]) / dl + (flare * out[a]) / ol);
    const gl = Math.hypot(...g) || 1;
    const thickness = style.thickness(chartOf(v.pos, v.nor, v.sig));
    grow.set(g.map((c) => (c / gl) * thickness), k * 3);
    // UVs: arc length around the head × height; mustaches comb their strands outward.
    const th = Math.atan2(x, z - Z_CENTER);
    let u = (th * RADIUS) / style.tile;
    let w = -y / style.tile;
    if (style.comb) {
      const a = style.comb * side;
      [u, w] = [u * Math.cos(a) - w * Math.sin(a), u * Math.sin(a) + w * Math.cos(a)];
    }
    uv.set([u, w], k * 2);
    color.set([1, 1, 1, clamp01(cover[vi])], k * 4);
    const [js, ws] = packSkin(v.skin);
    joints.set(js, k * 4);
    weights.set(ws, k * 4);
  });

  // Output document: the body file with its mesh swapped for ours (same skeleton, skin, nodes).
  const doc = await io.read(BODY);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const buf = root.listBuffers()[0];
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buf);

  const texture = doc.createTexture(style.texture).setImage(textures[style.texture]).setMimeType("image/webp");
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const material = doc
    .createMaterial(`${id}_material`)
    .setBaseColorTexture(texture)
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.95)
    .setAlphaMode("BLEND")
    .setDoubleSided(false);

  const newPrim = doc
    .createPrimitive()
    .setIndices(acc("SCALAR", idx))
    .setAttribute("POSITION", acc("VEC3", position))
    .setAttribute("NORMAL", acc("VEC3", normal))
    .setAttribute("TEXCOORD_0", acc("VEC2", uv))
    .setAttribute("COLOR_0", acc("VEC4", color))
    .setAttribute("JOINTS_0", acc("VEC4", joints))
    .setAttribute("WEIGHTS_0", acc("VEC4", weights))
    .setAttribute("_GROW", acc("VEC3", grow))
    .setMaterial(material);

  const defaultWeights = mesh.getWeights();
  const keptNames = [];
  const keptWeights = [];
  keep.forEach((ti, kk) => {
    const deltas = new Float32Array(n * 3);
    const normalDeltas = new Float32Array(n * 3);
    order.forEach((vi, k) => {
      deltas.set(verts[vi].morph.subarray(kk * MORPH_STRIDE, kk * MORPH_STRIDE + 3), k * 3);
      normalDeltas.set(verts[vi].morph.subarray(kk * MORPH_STRIDE + 3, kk * MORPH_STRIDE + 6), k * 3);
    });
    const target = doc.createPrimitiveTarget(TARGET_NAMES[ti]).setAttribute("POSITION", acc("VEC3", deltas));
    if (TARGET_HAS_NORMALS) target.setAttribute("NORMAL", acc("VEC3", normalDeltas));
    newPrim.addTarget(target);
    keptNames.push(TARGET_NAMES[ti]);
    keptWeights.push(defaultWeights[ti] ?? 0);
  });
  {
    const deltas = new Float32Array(n * 3);
    const normalDeltas = new Float32Array(n * 3);
    order.forEach((vi, k) => {
      deltas.set(verts[vi].gender.subarray(0, 3), k * 3);
      normalDeltas.set(verts[vi].gender.subarray(3, 6), k * 3);
    });
    const target = doc.createPrimitiveTarget("af-gender").setAttribute("POSITION", acc("VEC3", deltas));
    if (TARGET_HAS_NORMALS) target.setAttribute("NORMAL", acc("VEC3", normalDeltas));
    newPrim.addTarget(target);
    keptNames.push("af-gender");
    keptWeights.push(0);
  }

  prim.dispose();
  mesh.addPrimitive(newPrim);
  mesh
    .setName(id)
    .setWeights(keptWeights)
    .setExtras({ targetNames: keptNames, avatarforge: { kind: "facialHair", version: 2, shells: style.shells } });
  for (const node of root.listNodes()) if (node.getMesh() === mesh) node.setName(`${id}_mesh`);
  for (const m of root.listMaterials()) if (m !== material) m.dispose();
  for (const t of root.listTextures()) if (t !== texture) t.dispose();
  await doc.transform(prune());

  const file = path.join(OUT_DIR, `${id}.glb`);
  await io.write(file, doc);
  console.log(`${id.padEnd(20)} ${String(n).padStart(5)} verts  ${String(idx.length / 3).padStart(5)} tris  ${keptNames.length} morphs  ${Math.round(fs.statSync(file).size / 1024)} KB`);
}

console.log(`landmarks: mouth corner θ=${CORNER.toFixed(3)} y=${CORNER_Y.toFixed(3)} · lip top (center) ${lipTop(0).toFixed(3)} · nose bottom (center) ${noseBottom(0).toFixed(3)} · lower lip bottom ${lowerLipBottom(0).toFixed(3)} · nose half-width θ=${NOSE_WIDTH.toFixed(3)}`);
fs.mkdirSync(OUT_DIR, { recursive: true });
const textures = {
  strands: toWebp(path.join(TEX_DIR, "strands.png")),
  stubble: toWebp(path.join(TEX_DIR, "stubble.png")),
};
const only = new Set(process.argv.slice(2));
for (const [id, style] of Object.entries(STYLES)) {
  if (only.size && !only.has(id)) continue;
  await build(id, style, textures);
}
