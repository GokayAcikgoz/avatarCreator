// Renders every catalog asset's thumbnail with the real web viewer (same lighting and materials the
// person will see), via the dev-only /studio/thumbnail page and a headless Chromium.
//
//   npm run dev                                           (in another terminal)
//   node tools/asset-pipeline/render_thumbnails.mjs       [asset ids...]
//
// Chromium: set CHROMIUM_PATH, or it uses Playwright's cached build (npx playwright install chromium).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalog = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "asset-catalog.json"), "utf8"));
const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));
const OUT = path.join(REPO, "public", "thumbnails");
const URL = process.env.STUDIO_URL ?? "http://localhost:3000/studio/thumbnail";
const SIZE = 320;

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

// A neutral, clean base look so the thumbnail is about the asset, not the outfit around it.
const base = structuredClone(presets.presets.find((p) => p.id === "weekend").configuration);
base.facialHair = { beardStyle: null, mustacheStyle: null, color: "#3B2415" };
base.face.expression = "neutral";
base.face.morphs = {};
base.accessories = [];
base.accessoryColors = {};
base.hair = { style: "hair_crop", color: "#3B2415" };

const palettes = catalog.palettes;
// Showcase colors: readable, not black-on-dark.
const SHOWCASE = { hair: palettes.hair[3], tops: palettes.tops[2], bottoms: palettes.bottoms[1], shoes: palettes.shoes[2], hats: palettes.hats[4] };

function configFor(asset) {
  const c = structuredClone(base);
  const color = asset.palette ? SHOWCASE[asset.palette] ?? palettes[asset.palette]?.[0] : undefined;
  switch (asset.slot) {
    case "hair":
      c.hair = { style: asset.id, color };
      return [c, "portrait"];
    case "beard":
      c.facialHair = { ...c.facialHair, beardStyle: asset.id, color: "#3B2415" };
      c.hair = { style: "hair_crop", color: "#3B2415" };
      return [c, "portrait"];
    case "mustache":
      c.facialHair = { ...c.facialHair, mustacheStyle: asset.id, color: "#3B2415" };
      return [c, "portrait"];
    case "top":
      c.clothing = { ...c.clothing, top: asset.id, topColor: color };
      return [c, "torso"];
    case "bottom":
      c.clothing = { ...c.clothing, bottom: asset.id, bottomColor: color };
      return [c, "legs"];
    case "shoes":
      // Shorts, so long trousers don't hide the footwear.
      c.clothing = asset.incompatibleWith?.includes("bottom_denim_shorts")
        ? { ...c.clothing, shoes: asset.id, shoesColor: color }
        : { ...c.clothing, bottom: "bottom_denim_shorts", bottomColor: palettes.bottoms[1], shoes: asset.id, shoesColor: color };
      return [c, "shoes"];
    case "head":
      c.accessories = [asset.id];
      if (color) c.accessoryColors = { [asset.id]: color };
      return [c, "face"]; // hats rise above the head — the tight portrait would crop them
    case "face":
      c.accessories = [asset.id];
      return [c, "portrait"];
    default:
      return null;
  }
}

const only = new Set(process.argv.slice(2));
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__afStudio), null, { timeout: 60000 });

fs.mkdirSync(OUT, { recursive: true });
for (const asset of catalog.assets) {
  if (asset.alwaysOn || (only.size && !only.has(asset.id))) continue;
  const job = configFor(asset);
  if (!job) continue;
  const [configuration, focus] = job;
  await page.evaluate(({ configuration, focus }) => window.__afStudio.show(configuration, focus), { configuration, focus });
  await page.waitForTimeout(700); // camera snap + a couple of frames
  const dataUrl = await page.evaluate((size) => window.__afStudio.capture(size), SIZE);
  const file = path.join(OUT, `${asset.id}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`${asset.id.padEnd(22)} ${focus.padEnd(6)} ${Math.round(fs.statSync(file).size / 1024)} KB`);
}
await browser.close();
