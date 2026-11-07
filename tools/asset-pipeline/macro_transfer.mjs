// Gender ("body shape") for the body and everything worn on it.
//
// The body carries MakeHuman's 8 macro targets (female/male × 3 heritages + 2 universal); their
// default blend is the body every garment was fitted to. Moving the gender g ∈ [0, 1] scales the
// female targets by 2(1−g) and the male ones by 2g relative to that default, so the change is
// linear in g: one composite target
//
//   af-gender = Σ_male default·Δ − Σ_female default·Δ        weight = 2g − 1  (−1 feminine … +1 masculine)
//
// added to the body (positions + normals) and, by closest-point transfer, to every attachment:
// each vertex follows the body surface point nearest to it — the standard way to make clothes,
// hair and accessories follow body blendshapes. The skeleton follows too: per bone, the joint
// delta at weight 1 is the mean delta of the body vertices around the joint (rig-spec.json → gender).
//
//   node tools/asset-pipeline/macro_transfer.mjs     # recompute the joint table
//   postprocess_attachments.mjs calls addGenderTarget() for the body and every attachment
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BODY = path.join(REPO, "api", "server-assets", "avatar-base-poc.glb");
const RIG_SPEC = path.join(REPO, "shared", "rig-spec.json");
export const GENDER_TARGET = "af-gender";
const isMacro = (name) => name.startsWith("$md");
const isFemale = (name) => name.includes("$fe");

let bodyCache = null;
/** The body in its default shape, the composite gender delta (positions + normals), a triangle grid. */
export async function loadBody(file = BODY) {
  if (bodyCache) return bodyCache;
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const names = mesh.getExtras().targetNames;
  const defaults = mesh.getWeights();
  const P = prim.getAttribute("POSITION");
  const n = P.getCount();
  const pos = new Float32Array(n * 3);
  const delta = new Float32Array(n * 3);
  const normalDelta = new Float32Array(n * 3);
  const e = [];
  for (let i = 0; i < n; i++) pos.set(P.getElement(i, e), i * 3);
  prim.listTargets().forEach((t, ti) => {
    if (!isMacro(names[ti])) return;
    const d = defaults[ti] ?? 0;
    const sign = isFemale(names[ti]) ? -1 : 1;
    const a = t.getAttribute("POSITION");
    const na = t.getAttribute("NORMAL");
    for (let i = 0; i < n; i++) {
      a.getElement(i, e);
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] += d * e[k];
        delta[i * 3 + k] += sign * d * e[k];
      }
      if (na) {
        na.getElement(i, e);
        for (let k = 0; k < 3; k++) normalDelta[i * 3 + k] += sign * d * e[k];
      }
    }
  });
  const index = prim.getIndices().getArray();
  const CELL = 0.04;
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let t = 0; t < index.length; t += 3) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++)
      for (let a = 0; a < 3; a++) {
        const v = pos[index[t + k] * 3 + a];
        lo[a] = Math.min(lo[a], v);
        hi[a] = Math.max(hi[a], v);
      }
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
          const k = key(x, y, z);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(t);
        }
  }
  const joints = doc.getRoot().listSkins()[0].listJoints().map((j) => ({ name: j.getName(), world: j.getWorldMatrix() }));
  bodyCache = { pos, n, index, delta, normalDelta, grid, CELL, key, joints };
  return bodyCache;
}

/** Closest point on a triangle (Ericson, Real-Time Collision Detection) as barycentric weights. */
function closestBarycentric(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [1 - v - w, v, w];
}

/** The nearest body surface point to `p`: its triangle's vertices and barycentric weights. */
export function nearestSurface(body, p) {
  const { pos, index, grid, CELL, key } = body;
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
  for (let r = 1; r <= 8; r++) {
    let best = null;
    let bestD = Infinity;
    const seen = new Set();
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++)
          for (const t of grid.get(key(x, y, z)) ?? []) {
            if (seen.has(t)) continue;
            seen.add(t);
            const ia = index[t], ib = index[t + 1], ic = index[t + 2];
            const A = [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]];
            const B = [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]];
            const C = [pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]];
            const w = closestBarycentric(p, A, B, C);
            const d = [0, 1, 2].reduce((s, k) => s + (w[0] * A[k] + w[1] * B[k] + w[2] * C[k] - p[k]) ** 2, 0);
            if (d < bestD) {
              bestD = d;
              best = { verts: [ia, ib, ic], weights: w };
            }
          }
    // A hit closer than the searched radius can't be beaten by a farther ring.
    if (best && Math.sqrt(bestD) <= r * CELL) return best;
  }
  return null;
}

/**
 * Adds the composite gender target to every skinned primitive of `doc` that lacks it. The body gets
 * its own exact deltas (positions + normals); attachments get the closest-point transfer.
 */
export async function addGenderTarget(doc, { isBody = false } = {}) {
  const body = await loadBody();
  const buffer = doc.getRoot().listBuffers()[0];
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = mesh.getExtras() ?? {};
    const names = [...(extras.targetNames ?? [])];
    if (names.includes(GENDER_TARGET)) continue;
    const prims = mesh.listPrimitives();
    if (!prims.every((p) => p.getAttribute("JOINTS_0"))) continue;
    for (const prim of prims) {
      const P = prim.getAttribute("POSITION");
      const n = P.getCount();
      let delta;
      let normals = null;
      if (isBody) {
        delta = body.delta;
        normals = body.normalDelta;
      } else {
        delta = new Float32Array(n * 3);
        const e = [];
        for (let i = 0; i < n; i++) {
          const hit = nearestSurface(body, P.getElement(i, e));
          if (!hit) continue;
          for (let a = 0; a < 3; a++) {
            let v = 0;
            for (let k = 0; k < 3; k++) v += hit.weights[k] * body.delta[hit.verts[k] * 3 + a];
            delta[i * 3 + a] = v;
          }
        }
      }
      const target = doc.createPrimitiveTarget(GENDER_TARGET).setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(delta).setBuffer(buffer));
      if (normals) target.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer));
      // glTF needs the same attributes on every target of a primitive: give others a zero NORMAL if they have one.
      const others = prim.listTargets();
      if (!normals && others.some((t) => t.getAttribute("NORMAL"))) target.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(n * 3)).setBuffer(buffer));
      if (normals && others.some((t) => !t.getAttribute("NORMAL"))) target.setAttribute("NORMAL", null);
      prim.addTarget(target);
    }
    const weights = [...mesh.getWeights()];
    while (weights.length < names.length) weights.push(0);
    names.push(GENDER_TARGET);
    weights.push(0);
    mesh.setWeights(weights).setExtras({ ...extras, targetNames: names });
  }
}

/** Per bone: how far the joint moves (meters, model space) at gender weight +1 (fully masculine). */
export async function computeJointDeltas() {
  const body = await loadBody();
  const { pos, n, joints, delta } = body;
  const table = {};
  for (const j of joints) {
    const jp = [j.world[12], j.world[13], j.world[14]];
    // The ring of skin around the joint: its nearest vertices (fewer for small hand/face joints).
    const k = /finger|toe|eye|jaw|tongue|oris|levator|risorius|orbicularis|temporalis|special|oculi|cheek|nose|brow|metacarpal/.test(j.name) ? 10 : 40;
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = (pos[i * 3] - jp[0]) ** 2 + (pos[i * 3 + 1] - jp[1]) ** 2 + (pos[i * 3 + 2] - jp[2]) ** 2;
    const nearest = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b]).slice(0, k);
    const s = [0, 0, 0];
    for (const i of nearest) for (let a = 0; a < 3; a++) s[a] += delta[i * 3 + a];
    const v = s.map((x) => Math.round((x / k) * 10000) / 10000);
    // Symmetric joints (midline) stay on the midline.
    if (!/\.(L|R)$/.test(j.name)) v[0] = 0;
    if (Math.hypot(...v) > 0.0005) table[j.name] = v;
  }
  return table;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = JSON.parse(fs.readFileSync(RIG_SPEC, "utf8"));
  delete spec.macro;
  spec.gender = {
    $comment: "GENERATED by tools/asset-pipeline/macro_transfer.mjs. Morph target af-gender at weight 2g−1 (g: 0 feminine … 1 masculine; 0.5 = the default body). joints: how far each joint moves at weight +1 (meters, model space).",
    target: "af-gender",
    joints: await computeJointDeltas(),
  };
  fs.writeFileSync(RIG_SPEC, JSON.stringify(spec, null, 2) + "\n");
  console.log(`rig-spec gender: ${Object.keys(spec.gender.joints).length} moving joints`);
}
