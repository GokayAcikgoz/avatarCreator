// Final step of the attachment pipeline (after tools/blender-pipeline/generate_attachments.py).
//
// One source, two outputs per asset:
//   public/models/attachments/<id>.glb   — meshopt-compressed, for the browser
//   api/server-assets/attachments/<id>.glb — uncompressed, for the API's Blender renderer
//                                           (Blender's glTF importer can't read EXT_meshopt_compression)
//
// Also normalizes materials the MPFB exporter leaves in a state three.js renders poorly:
//   * every material gets metallic=0 (MPFB's GAMEENGINE materials / missing materials otherwise
//     fall back to three.js's fully-metallic default and render dark gray)
//   * primitives without any material get a neutral one (e.g. the newsboy cap shipped none)
//   * alpha mode per asset family (hair cards → MASK, glasses lenses → BLEND, clothing → OPAQUE)
//   * the stray "Icosphere" helper MPFB leaves in some exports is removed
//
// Usage:
//   node tools/asset-pipeline/postprocess_attachments.mjs            # every raw attachment + body + face parts
//   node tools/asset-pipeline/postprocess_attachments.mjs hair_bun   # only the listed ids
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from "@gltf-transform/extensions";
import { dequantize, meshopt, prune } from "@gltf-transform/functions";
import { bakeBindShape } from "./gltf-utils.mjs";
import { addGenderTarget } from "./macro_transfer.mjs";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_DIR = path.join(REPO, ".pipeline-tools", "raw-attachments");
const PUBLIC_DIR = path.join(REPO, "public", "models");
const SERVER_DIR = path.join(REPO, "api", "server-assets");
const SKIN_TEXTURE = path.join(REPO, "public", "textures", "skin_detail.webp");
const IMAGE_OPS = path.join(REPO, "tools", "asset-pipeline", "image_ops.py");

// Hair whose alpha coverage is too sparse for a 0.5 cutoff renders invisible under MASK (verified
// for hair_long in Phase 6 — see docs/performance-baseline.md); those stay OPAQUE.
const OPAQUE_HAIR = new Set(["hair_long"]);
// Hair whose texture is flat gray (no strands at all) → synthesized streaks along its locks' UV axis.
const SYNTH_STRANDS = { hair_swept: "u" };
const FACE_PARTS = {
  body_eyes_lowpoly: { alpha: "OPAQUE" },
  // alphaGain: the fine brow strokes sit below the cutoff and vanish (thin, washed-out brows).
  body_eyebrows_001: { alpha: "MASK", neutralize: true, alphaGain: 1.8 },
  body_eyelashes_001: { alpha: "MASK" },
  body_teeth_base: { alpha: "OPAQUE" },
  body_tongue_01: { alpha: "OPAQUE" },
};

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

function materialPolicy(id) {
  if (id.startsWith("hair_")) {
    return OPAQUE_HAIR.has(id)
      ? { alpha: "OPAQUE", doubleSided: true, roughness: 0.78 }
      : { alpha: "MASK", cutoff: 0.4, doubleSided: true, roughness: 0.78 };
  }
  if (id.startsWith("glasses_")) return { alpha: "BLEND", doubleSided: true, roughness: 0.35 };
  // Generated facial hair (generate_facial_hair.mjs): soft-edged shells, alpha-blended.
  if (id.startsWith("beard_") || id.startsWith("mustache_")) return { alpha: "BLEND", doubleSided: false, roughness: 0.92 };
  if (FACE_PARTS[id]) {
    const part = FACE_PARTS[id];
    return { alpha: part.alpha, cutoff: 0.5, doubleSided: part.alpha === "MASK", roughness: id === "body_eyes_lowpoly" ? 0.25 : 0.7 };
  }
  // Garments: MASK, not OPAQUE — several MakeHuman garments cut ragged hems/edges out with texture
  // alpha, and OPAQUE renders those cut-outs as black patches.
  // Double-sided: several community garments have faces with flipped winding that single-sided
  // rendering culls, leaving see-through holes onto whatever is underneath.
  return { alpha: "MASK", cutoff: 0.5, doubleSided: true, roughness: 0.82 };
}

function removeHelpers(doc) {
  for (const node of doc.getRoot().listNodes()) {
    if (/^Icosphere/i.test(node.getName())) node.dispose();
  }
}

function processTexture(doc, texture, op = "neutralize", ...extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "af-tex-"));
  const ext = texture.getMimeType() === "image/webp" ? ".webp" : ".png";
  const src = path.join(tmp, `in${ext}`);
  const dst = path.join(tmp, "out.webp");
  fs.writeFileSync(src, Buffer.from(texture.getImage()));
  execFileSync("python", [IMAGE_OPS, op, src, dst, ...extra.map(String)]);
  texture.setImage(new Uint8Array(fs.readFileSync(dst))).setMimeType("image/webp");
  doc.createExtension(EXTTextureWebP);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/** glTF normal maps are tangent-space (mean ≈ 128,128,255). Some community hair ships object-space ones. */
function isTangentSpaceNormalMap(texture) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "af-nrm-"));
  const src = path.join(tmp, texture.getMimeType() === "image/webp" ? "n.webp" : "n.png");
  fs.writeFileSync(src, Buffer.from(texture.getImage()));
  const [r, g, b] = execFileSync("python", [IMAGE_OPS, "mean_rgb", src]).toString().trim().split(" ").map(Number);
  fs.rmSync(tmp, { recursive: true, force: true });
  return Math.abs(r - 128) < 40 && Math.abs(g - 128) < 40 && b > 190;
}

function applyMaterialPolicy(doc, id) {
  const policy = materialPolicy(id);
  let fallback = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getMaterial()) {
        fallback ??= doc.createMaterial(`${id}_material`).setBaseColorFactor([0.9, 0.9, 0.9, 1]);
        prim.setMaterial(fallback);
      }
    }
  }
  for (const material of doc.getRoot().listMaterials()) {
    material.setMetallicFactor(0);
    material.setRoughnessFactor(Math.max(material.getRoughnessFactor(), policy.roughness));
    material.setAlphaMode(policy.alpha);
    if (policy.alpha === "MASK") material.setAlphaCutoff(policy.cutoff ?? 0.5);
    material.setDoubleSided(policy.doubleSided);
    if (FACE_PARTS[id]?.neutralize) {
      const texture = material.getBaseColorTexture();
      if (texture && !material.getExtras()?.neutralized) {
        processTexture(doc, texture, "neutralize", ...(FACE_PARTS[id].alphaGain ? [FACE_PARTS[id].alphaGain] : []));
        material.setExtras({ ...material.getExtras(), neutralized: true });
      }
    }
    if (id.startsWith("hair_")) {
      // Tintable hair: no black strand lines, no dark mip fringes (image_ops.py hair_tone).
      const texture = material.getBaseColorTexture();
      if (texture && !material.getExtras()?.hairToned) {
        if (SYNTH_STRANDS[id]) processTexture(doc, texture, "hair_strands", SYNTH_STRANDS[id]);
        processTexture(doc, texture, "hair_tone");
        material.setExtras({ ...material.getExtras(), hairToned: true });
      }
      // An object-space normal map read as tangent-space shades cards in dark streaks: drop it.
      const normal = material.getNormalTexture();
      if (normal && !isTangentSpaceNormalMap(normal)) {
        console.log(`  ${id}: dropped object-space normal map "${normal.getName()}"`);
        material.setNormalTexture(null);
      }
    }
  }
}

function addSkinMaterial(doc) {
  const image = new Uint8Array(fs.readFileSync(SKIN_TEXTURE));
  const root = doc.getRoot();
  let material = root.listMaterials().find((m) => m.getName() === "Skin");
  let texture = material?.getBaseColorTexture();
  if (!texture) {
    texture = doc.createTexture("skin_detail");
  }
  texture.setImage(image).setMimeType("image/webp").setURI("skin_detail.webp");
  doc.createExtension(EXTTextureWebP);
  if (!material) {
    material = doc.createMaterial("Skin");
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(material);
  }
  // Default tone (#C68863) / 0.78 in linear space — see tools/asset-pipeline/prepare_skin_texture.py.
  material
    .setBaseColorTexture(texture)
    .setBaseColorFactor([0.5647 / 0.78, 0.2462 / 0.78, 0.1248 / 0.78, 1].map((v) => Math.min(1, v)))
    .setMetallicFactor(0)
    .setRoughnessFactor(0.6)
    .setAlphaMode("OPAQUE");
}

async function writeBoth(doc, relPath, { isBody = false } = {}) {
  const serverPath = path.join(SERVER_DIR, relPath);
  const publicPath = path.join(PUBLIC_DIR, relPath);
  fs.mkdirSync(path.dirname(serverPath), { recursive: true });
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });

  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext instanceof EXTMeshoptCompression) ext.dispose();
  }
  await doc.transform(dequantize());
  bakeBindShape(doc);
  // Gender follows into everything worn (closest-point transfer from the body; see macro_transfer.mjs).
  await addGenderTarget(doc, { isBody });
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === "KHR_mesh_quantization") ext.dispose();
  }
  await doc.transform(prune());
  await io.write(serverPath, doc);

  // 8-bit normals match the original Phase 6 compression (visually lossless for shading, half the size of the 10-bit default).
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium", quantizeNormal: 8 }));
  await io.write(publicPath, doc);
  console.log(
    `${relPath.padEnd(34)} server ${String(Math.round(fs.statSync(serverPath).size / 1024)).padStart(5)} KB   public ${String(Math.round(fs.statSync(publicPath).size / 1024)).padStart(5)} KB`
  );
}

const only = new Set(process.argv.slice(2).map((a) => a.replace(/\.glb$/, "")));
const wanted = (id) => only.size === 0 || only.has(id);

// 1. Raw Blender exports → both copies.
for (const file of fs.readdirSync(RAW_DIR).filter((f) => f.endsWith(".glb")).sort()) {
  const id = file.replace(/\.glb$/, "");
  if (!wanted(id)) continue;
  const doc = await io.read(path.join(RAW_DIR, file));
  removeHelpers(doc);
  applyMaterialPolicy(doc, id);
  await writeBoth(doc, path.join("attachments", file));
}

// 2. Face parts (owned by generate_face_system.py; their uncompressed server copy is the source).
for (const id of Object.keys(FACE_PARTS)) {
  if (!wanted(id)) continue;
  const doc = await io.read(path.join(SERVER_DIR, "attachments", `${id}.glb`));
  applyMaterialPolicy(doc, id);
  await writeBoth(doc, path.join("attachments", `${id}.glb`));
}

// 3. Body: attach the tone-neutral skin material.
if (wanted("avatar-base-poc")) {
  const doc = await io.read(path.join(SERVER_DIR, "avatar-base-poc.glb"));
  addSkinMaterial(doc);
  await writeBoth(doc, "avatar-base-poc.glb", { isBody: true });
}

console.log("DONE");
