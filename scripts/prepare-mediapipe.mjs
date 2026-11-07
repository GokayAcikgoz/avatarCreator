// Self-hosts the on-device face analysis runtime used by "Create from photo":
//   public/mediapipe/wasm/*      ← copied from node_modules/@mediapipe/tasks-vision (version-matched)
//   public/mediapipe/models/*    ← MediaPipe models (Apache-2.0), downloaded once if missing
//
// Runs before `next dev` / `next build` (package.json pre-scripts). Nothing is fetched from a CDN at
// runtime and the photo itself never leaves the browser.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WASM_SRC = path.join(REPO, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const OUT = path.join(REPO, "public", "mediapipe");
const MODELS = {
  "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "hair_segmenter.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite",
};

fs.mkdirSync(path.join(OUT, "wasm"), { recursive: true });
fs.mkdirSync(path.join(OUT, "models"), { recursive: true });

if (!fs.existsSync(WASM_SRC)) {
  console.warn("[mediapipe] @mediapipe/tasks-vision is not installed — run npm install. Photo analysis will be unavailable.");
} else {
  for (const file of fs.readdirSync(WASM_SRC)) {
    const src = path.join(WASM_SRC, file);
    const dst = path.join(OUT, "wasm", file);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  }
}

for (const [file, url] of Object.entries(MODELS)) {
  const dst = path.join(OUT, "models", file);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 0) continue;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(dst, Buffer.from(await response.arrayBuffer()));
    console.log(`[mediapipe] downloaded ${file}`);
  } catch (error) {
    console.warn(`[mediapipe] could not download ${file} (${error.message}). Photo analysis will be unavailable until it is present in public/mediapipe/models/.`);
  }
}
