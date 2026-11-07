// Photo → avatar QA with ground truth: renders "selfies" of avatars whose traits we know (skin,
// eyes, hair, facial hair), runs them through the production photo pipeline in the browser
// (MediaPipe + analyzeFace + suggestFromAnalysis) and checks the suggestions recover the traits.
//
//   npm run dev                                          (in another terminal)
//   node tools/asset-pipeline/qa_photo_analysis.mjs      → exit code 1 if a check fails
//
// Also writes .pipeline-tools/qa/photo_cases.png (the synthetic photos) for a visual check.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const URL = process.env.STUDIO_URL ?? "http://localhost:3000/studio/thumbnail";
const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));

function config(preset, patch) {
  const c = structuredClone(presets.presets.find((p) => p.id === preset).configuration);
  c.accessories = [];
  c.accessoryColors = {};
  c.face.expression = "neutral";
  return patch(c) ?? c;
}

const CASES = [
  { name: "brown hair, stubble", config: config("weekend", (c) => void (c.facialHair = { beardStyle: "beard_stubble", mustacheStyle: null, color: "#3B2415" })), expect: { skin: "#C68863", hairLength: "short", hairColor: ["#3B2415", "#1B1210", "#5E3B22"], beard: ["beard_stubble", null] } },
  { name: "blond long hair", config: config("sunny", () => {}), expect: { skin: "#EDC3A2", hairLength: "long", hairColor: ["#B8864B", "#D9B77E", "#8B5A2B"], beard: [null] } },
  { name: "black hair, beard + mustache", config: config("studio", () => {}), expect: { skin: "#8D5A3B", hairLength: "short", hairColor: ["#1B1210", "#3B2415"], beard: ["beard_short", "beard_full"], mustache: true } },
  {
    name: "full beard, blue eyes",
    config: config("weekend", (c) => {
      c.hair = { style: "hair_crop", color: "#5E3B22" };
      c.face.eyeColor = "#4A6FA5";
      c.facialHair = { beardStyle: "beard_full", mustacheStyle: "mustache_classic", color: "#5E3B22" };
    }),
    expect: { skin: "#C68863", hairLength: "short", beard: ["beard_full", "beard_short"], eyes: ["#4A6FA5", "#3E7C8C", "#7B8794"] },
  },
  { name: "dark skin, goatee", config: config("urban", (c) => void (c.hair = { style: "hair_crop", color: "#1B1210" })), expect: { skin: "#6B4128", hairLength: "short", beard: ["beard_goatee", "beard_short", "beard_stubble"] } },
  { name: "bob with bangs, green eyes", config: config("cozy", (c) => {
    c.hair = { style: "hair_bob_bangs", color: "#8B5A2B" };
    c.face.eyeColor = "#5B7F4F";
  }), expect: { skin: "#E0AC89", hairLength: "medium", bangs: true, eyes: ["#5B7F4F", "#8E6B3E", "#3E7C8C"], beard: [null] } },
];

// Selfie framing: head and shoulders, straight on.
const VIEW = { position: [0.03, 1.5, 1.05], target: [0, 1.46, 0], fov: 32 };

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

// ΔE between hex colors (CIELAB), to judge "close enough" skin tones.
function lab(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const x = (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047;
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const z = (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__afStudio && window.__afPhoto), null, { timeout: 120_000 });

let failures = 0;
const shots = [];
for (const test of CASES) {
  await page.evaluate((c) => window.__afStudio.show(c, "full"), test.config);
  await page.evaluate(() => window.__afStudio.pose("idle", 0));
  const shot = await page.evaluate((view) => window.__afStudio.capture(720, view), VIEW);
  shots.push([test.name, shot]);
  const { analysis, suggestion, debugUrl } = await page.evaluate((url) => window.__afPhoto.analyze(url, "#8a8f98"), shot);
  fs.mkdirSync(path.join(REPO, ".pipeline-tools", "qa"), { recursive: true });
  fs.writeFileSync(path.join(REPO, ".pipeline-tools", "qa", `photo_debug_${CASES.indexOf(test)}.png`), Buffer.from(debugUrl.split(",")[1], "base64"));
  const hex = (c) => (c ? "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("") : "none");
  console.log(`    raw: eye ${hex(analysis.eyeColor)} hair ${hex(analysis.hair.color)} skin ${hex(analysis.skinTone)} facial ${hex(analysis.facialHair.color)}`);
  const e = test.expect;
  const checks = [];
  const check = (label, ok, detail) => checks.push({ label, ok, detail });
  check("skin", dE(suggestion.skinTone, e.skin) < 14, `${suggestion.skinTone} vs ${e.skin} (ΔE ${dE(suggestion.skinTone, e.skin).toFixed(1)})`);
  if (e.hairLength) check("hair length", analysis.hair.length === e.hairLength, `${analysis.hair.length} (style ${suggestion.hair?.style})`);
  if (e.hairColor) check("hair color", e.hairColor.includes(suggestion.hair?.color), `${suggestion.hair?.color}`);
  if (e.bangs !== undefined) check("bangs", analysis.hair.bangs === e.bangs, String(analysis.hair.bangs));
  if (e.eyes) check("eyes", e.eyes.includes(suggestion.eyeColor), `${suggestion.eyeColor}`);
  if (e.beard) check("beard", e.beard.includes(suggestion.facialHair.beardStyle), `${suggestion.facialHair.beardStyle} (darkening ${Object.entries(analysis.facialHair.darkening).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")})`);
  if (e.mustache !== undefined) check("mustache", Boolean(suggestion.facialHair.mustacheStyle) === e.mustache, `${suggestion.facialHair.mustacheStyle}`);
  const bad = checks.filter((c) => !c.ok);
  failures += bad.length;
  console.log(`${bad.length ? "✗" : "✓"} ${test.name}`);
  for (const c of checks) console.log(`    ${c.ok ? "ok " : "BAD"} ${c.label.padEnd(12)} ${c.detail}`);
  if (analysis.warnings.length) console.log(`    warnings: ${analysis.warnings.join(" | ")}`);
  console.log(`    sliders: ${suggestion.sliders.map((s) => `${s.label} ${s.value}`).join(", ") || "none"}`);
}

const sheet = await page.evaluate(async (shots) => {
  const cell = 240;
  const canvas = document.createElement("canvas");
  canvas.width = cell * shots.length;
  canvas.height = cell + 20;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a8f98";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < shots.length; i++) {
    const img = new Image();
    await new Promise((r) => ((img.onload = r), (img.src = shots[i][1])));
    ctx.drawImage(img, i * cell, 20, cell, cell);
    ctx.fillStyle = "#111";
    ctx.font = "12px sans-serif";
    ctx.fillText(shots[i][0], i * cell + 4, 14);
  }
  return canvas.toDataURL("image/png");
}, shots);
fs.mkdirSync(path.join(REPO, ".pipeline-tools", "qa"), { recursive: true });
fs.writeFileSync(path.join(REPO, ".pipeline-tools", "qa", "photo_cases.png"), Buffer.from(sheet.split(",")[1], "base64"));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
