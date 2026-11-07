// Calibrates photo → face-slider mapping (shared/face-calibration.json) with the production code:
//
//   reference  = face proportions of MediaPipe's canonical face (an average human face), measured
//                with src/features/photo/faceMetrics.ts
//   perUnit    = how much each proportion changes per unit of its avatar slider: our own avatar is
//                rendered by the real web viewer at slider 0 and slider max, and both renders go
//                through the real photo pipeline (MediaPipe Face Landmarker in the browser)
//
// A photo whose proportion equals the reference keeps the avatar's base face; larger features move
// the slider by (measured − reference) / perUnit.
//
//   npm run dev                                   (in another terminal)
//   node tools/asset-pipeline/calibrate_face_metrics.mjs
//
// Needs .pipeline-tools/mediapipe/canonical_face_model.obj (Apache-2.0, from the MediaPipe repo:
// mediapipe/modules/face_geometry/data/canonical_face_model.obj).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const URL = process.env.STUDIO_URL ?? "http://localhost:3000/studio/thumbnail";
const OBJ = path.join(REPO, ".pipeline-tools", "mediapipe", "canonical_face_model.obj");
const OUT = path.join(REPO, "shared", "face-calibration.json");

// Which measured proportion each slider drives (labels = src/features/avatar/config/faceMorphs.ts).
const SLIDERS = [
  { label: "Face Width", metric: "faceWidth", targets: ["head-scale-horiz-incr"], max: 1 },
  { label: "Jaw Width", metric: "jawWidth", targets: ["chin-width-incr"], max: 1 },
  { label: "Eye Size", metric: "eyeWidth", targets: ["l-eye-scale-incr", "r-eye-scale-incr"], max: 0.85 },
  { label: "Eye Spacing", metric: "eyeSpacing", targets: ["l-eye-trans-out", "r-eye-trans-out"], max: 0.7 },
  { label: "Nose Width", metric: "noseWidth", targets: ["nose-scale-horiz-incr"], max: 1 },
  { label: "Nose Length", metric: "noseLength", targets: ["nose-scale-vert-incr"], max: 0.8 },
  { label: "Mouth Width", metric: "mouthWidth", targets: ["mouth-scale-horiz-incr"], max: 0.85 },
  { label: "Lips", metric: "lipThickness", targets: ["mouth-upperlip-volume-incr", "mouth-lowerlip-volume-incr"], max: 1 },
];

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "ms-playwright") : path.join(os.homedir(), ".cache", "ms-playwright");
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const dir of dirs) {
    for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const candidate = path.join(cache, dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("No Chromium found — set CHROMIUM_PATH or run `npx playwright install chromium`.");
}

const canonical = fs
  .readFileSync(OBJ, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("v "))
  .map((l) => {
    const [x, y, z] = l.slice(2).trim().split(/\s+/).map(Number);
    return { x, y: -y, z }; // image-style y-down; distances don't care
  });

const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));
const base = structuredClone(presets.presets.find((p) => p.id === "weekend").configuration);
Object.assign(base, { accessories: [], accessoryColors: {} });
base.hair = { style: "hair_crop", color: "#3B2415" };
base.facialHair = { beardStyle: null, mustacheStyle: null, color: "#3B2415" };
base.face.expression = "neutral";
base.face.morphs = {};
const VIEW = { position: [0, 1.52, 0.95], target: [0, 1.515, 0], fov: 26 };

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__afStudio && window.__afPhoto), null, { timeout: 120_000 });

const reference = await page.evaluate((points) => window.__afPhoto.metricsOf(points), canonical);

async function measure(config) {
  await page.evaluate((c) => window.__afStudio.show(c, "full"), config);
  await page.evaluate(() => window.__afStudio.pose("idle", 0));
  const shot = await page.evaluate((view) => window.__afStudio.capture(768, view), VIEW);
  const result = await page.evaluate((url) => window.__afPhoto.analyze(url), shot);
  return result.analysis.metrics;
}

const avatarBase = await measure(base);
const sliders = [];
for (const s of SLIDERS) {
  const config = structuredClone(base);
  for (const t of s.targets) config.face.morphs[t] = s.max;
  const m = await measure(config);
  const perUnit = (m[s.metric] - avatarBase[s.metric]) / s.max;
  console.log(`${s.label.padEnd(12)} ${s.metric.padEnd(13)} base ${avatarBase[s.metric].toFixed(4)} → ${m[s.metric].toFixed(4)}  (reference ${reference[s.metric].toFixed(4)})  perUnit ${perUnit.toFixed(4)}`);
  // A slider whose full range moves its landmarks by < 0.2 % of the face height can't be read from a photo.
  if (perUnit * s.max > 0.002) sliders.push({ label: s.label, metric: s.metric, perUnit: Math.round(perUnit * 1e5) / 1e5 });
  else console.warn(`  ${s.label}: the slider doesn't move ${s.metric} measurably — left out`);
}
await browser.close();

const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1e5) / 1e5]));
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      $comment: "GENERATED by tools/asset-pipeline/calibrate_face_metrics.mjs — photo → face-slider mapping (see src/features/photo/faceToConfig.ts).",
      version: 1,
      reference: round(reference),
      avatarBase: round(avatarBase),
      sliders,
    },
    null,
    2
  ) + "\n"
);
console.log("wrote", path.relative(REPO, OUT));
