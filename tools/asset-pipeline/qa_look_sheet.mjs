// Look QA: renders a set of configuration variants from several close-up angles with the real web
// viewer and writes one contact sheet (rows = variants, columns = views). Used to review facial
// hair, hair, skin and expressions side by side.
//
//   npm run dev                                                  (in another terminal)
//   node tools/asset-pipeline/qa_look_sheet.mjs facial-hair      [--out=name] [--expression=smile]
//
// Variant sets are defined below; output goes to .pipeline-tools/qa/look_<set>.png.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(REPO, ".pipeline-tools", "qa");
const URL = process.env.STUDIO_URL ?? "http://localhost:3000/studio/thumbnail";
const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const set = args.find((a) => !a.startsWith("--")) ?? "facial-hair";
const CELL = Number(flag("cell", 300));

const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "asset-catalog.json"), "utf8"));
const base = structuredClone(presets.presets.find((p) => p.id === flag("preset", "weekend")).configuration);
base.accessories = [];
base.accessoryColors = {};
base.face.expression = flag("expression", "neutral");

const HEAD = [0, 1.5, 0.03];
const VIEWS = {
  front: { position: [0, 1.52, 0.95], target: HEAD, fov: 26 },
  three: { position: [0.62, 1.54, 0.72], target: HEAD, fov: 26 },
  side: { position: [-0.95, 1.52, 0.05], target: HEAD, fov: 26 },
  low: { position: [0.25, 1.3, 0.8], target: [0, 1.46, 0.05], fov: 26 },
  fullFront: { position: [0, 1.0, 4.4], target: [0, 0.9, 0], fov: 30 },
  fullSide: { position: [-4.4, 1.0, 0], target: [0, 0.9, 0], fov: 30 },
  fullThree: { position: [3.0, 1.2, 3.2], target: [0, 0.9, 0], fov: 30 },
  torso: { position: [0.5, 1.25, 1.9], target: [0, 1.15, 0], fov: 30 },
};

const facialHair = catalog.assets.filter((a) => a.slot === "beard" || a.slot === "mustache");
const SETS = {
  "facial-hair": () =>
    [
      ...facialHair.filter((a) => a.slot === "beard").map((a) => [a.id, { beardStyle: a.id, mustacheStyle: null }]),
      ...facialHair.filter((a) => a.slot === "mustache").map((a) => [a.id, { beardStyle: null, mustacheStyle: a.id }]),
      ["full+classic", { beardStyle: "beard_full", mustacheStyle: "mustache_classic" }],
    ].map(([label, fh]) => [label, { ...structuredClone(base), facialHair: { ...fh, color: flag("color", "#3B2415") } }]),
  "facial-hair-colors": () =>
    ["#111111", "#3B2415", "#8B5A2B", "#B8864B", "#A8432C", "#9A9A9A"].map((color) => [
      color,
      { ...structuredClone(base), facialHair: { beardStyle: "beard_full", mustacheStyle: "mustache_classic", color } },
    ]),
  presets: () => presets.presets.map((p) => [p.id, structuredClone(p.configuration)]),
  // Body shape from feminine to masculine with a full outfit (garments must follow, feet stay down).
  genders: () =>
    [0, 0.15, 0.5, 0.85, 1].map((g) => {
      const c = structuredClone(base);
      c.body.gender = g;
      if (flag("outfit", "") === "summer") {
        c.clothing = { ...c.clothing, top: "top_tank", bottom: "bottom_denim_shorts", shoes: "shoes_leather_boots" };
        c.hair = { style: "hair_bun", color: "#3B2415" };
      }
      return [`gender ${g}`, c];
    }),
  // Facial hair must follow the face: every expression with a full beard + mustache and with a goatee.
  "facial-hair-expressions": () =>
    ["neutral", "smile", "laugh", "surprised", "talk", "angry"].flatMap((expression) =>
      [
        ["full+classic", { beardStyle: "beard_full", mustacheStyle: "mustache_classic" }],
        ["goatee+horseshoe", { beardStyle: "beard_goatee", mustacheStyle: "mustache_horseshoe" }],
      ].map(([label, fh]) => {
        const c = structuredClone(base);
        c.face.expression = expression;
        c.facialHair = { ...fh, color: "#3B2415" };
        return [`${expression} · ${label}`, c];
      })
    ),
  // Every face slider at a negative and a positive extreme (value = --amount, default 0.6).
  "face-sliders": () => {
    const amount = Number(flag("amount", 0.6));
    const sliders = [
      ["Face Width", ["head-scale-horiz-incr"]],
      ["Jaw Width", ["chin-width-incr"]],
      ["Cheeks", ["l-cheek-volume-incr", "r-cheek-volume-incr"]],
      ["Eye Size", ["l-eye-scale-incr", "r-eye-scale-incr"]],
      ["Eye Spacing", ["l-eye-trans-out", "r-eye-trans-out"]],
      ["Nose Width", ["nose-scale-horiz-incr"]],
      ["Nose Length", ["nose-scale-vert-incr"]],
      ["Mouth Width", ["mouth-scale-horiz-incr"]],
      ["Lips", ["mouth-upperlip-volume-incr", "mouth-lowerlip-volume-incr"]],
    ];
    const out = [["base", structuredClone(base)]];
    for (const [label, targets] of sliders) {
      for (const v of [-amount, amount]) {
        const c = structuredClone(base);
        c.face.morphs = Object.fromEntries(targets.map((t) => [t, v]));
        out.push([`${label} ${v > 0 ? "+" : ""}${v}`, c]);
      }
    }
    return out;
  },
};
const variants = SETS[set]();
const viewNames = flag("views", "front,three,side").split(",");

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

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__afStudio), null, { timeout: 120_000 });

const cells = [];
for (const [label, config] of variants) {
  await page.evaluate((c) => window.__afStudio.show(c, "full"), config);
  await page.evaluate(() => window.__afStudio.pose("idle", 0));
  const row = [];
  for (const v of viewNames) row.push(await page.evaluate(([size, view]) => window.__afStudio.capture(size, view), [CELL, VIEWS[v]]));
  cells.push([label, row]);
}
const dataUrl = await page.evaluate(
  async ({ cells, cell, views }) => {
    const label = 20;
    const sheet = document.createElement("canvas");
    sheet.width = views.length * cell;
    sheet.height = cells.length * (cell + label);
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#1b1f27";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let r = 0; r < cells.length; r++) {
      const y = r * (cell + label);
      ctx.fillStyle = "#e6e9ef";
      ctx.font = "13px sans-serif";
      ctx.fillText(cells[r][0], 6, y + 14);
      for (let c = 0; c < views.length; c++) {
        const img = new Image();
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = cells[r][1][c];
        });
        ctx.fillStyle = (r + c) % 2 ? "#2a303c" : "#30374a";
        ctx.fillRect(c * cell, y + label, cell, cell);
        ctx.drawImage(img, c * cell, y + label);
      }
    }
    return sheet.toDataURL("image/png");
  },
  { cells, cell: CELL, views: viewNames }
);
const file = path.join(OUT, `look_${flag("out", set)}.png`);
fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("wrote", path.relative(REPO, file));
await browser.close();
