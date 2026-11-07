// Rebuilds api/server-assets/ (what the API's Blender renderer reads) from the committed browser
// assets in public/ — no Blender needed. Run once on a fresh clone / API host, and after any asset
// change:   node tools/asset-pipeline/build_server_assets.mjs
//
// Per GLB: decode meshopt → dequantize → bake the quantization "bind shape" back into the vertices
// (so every skeleton shares one canonical rest pose — assemble_avatar.py re-targets all garments
// onto the body's armature) → write uncompressed. Textures are copied as-is.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dequantize, prune } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bakeBindShape } from "./gltf-utils.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(REPO, "public");
const OUT = path.join(REPO, "api", "server-assets");

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

function* files(dir, ext) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full, ext);
    else if (ext.some((e) => entry.name.endsWith(e))) yield full;
  }
}

let count = 0;
for (const file of files(path.join(SRC, "models"), [".glb"])) {
  const rel = path.relative(path.join(SRC, "models"), file);
  const doc = await io.read(file);
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext instanceof EXTMeshoptCompression) ext.dispose();
  await doc.transform(dequantize());
  bakeBindShape(doc);
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === "KHR_mesh_quantization") ext.dispose();
  await doc.transform(prune());
  const out = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  count++;
}
for (const file of files(path.join(SRC, "textures"), [".webp", ".png"])) {
  const out = path.join(OUT, "textures", path.basename(file));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(file, out);
}
console.log(`server-assets: ${count} models + textures → ${OUT}`);
