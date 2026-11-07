// Animation QA: renders every clip at several moments from several angles with the real web viewer
// and writes one contact sheet per clip — the way to review poses without scrubbing by hand.
//
//   npm run dev                                                (in another terminal)
//   node tools/asset-pipeline/qa_animation_sheets.mjs [clip ids...] [--preset=weekend] [--frames=6]
//
// Output: .pipeline-tools/qa/anim_<clip>.png (rows = views, columns = moments in the clip).
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
const only = args.filter((a) => !a.startsWith("--"));
const FRAMES = Number(flag("frames", 6));
const CELL = Number(flag("cell", 260));

const library = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "animation-clips.json"), "utf8"));
const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));
const config = structuredClone(presets.presets.find((p) => p.id === flag("preset", "weekend")).configuration);

// The avatar stands at the origin facing +Z; +X is the avatar's left.
const VIEWS = {
  front: { position: [0, 1.0, 4.3], target: [0, 0.88, 0] },
  side: { position: [-4.3, 1.0, 0], target: [0, 0.88, 0] }, // from the avatar's right
  three: { position: [2.9, 1.25, 3.1], target: [0, 0.88, 0] },
  top: { position: [0, 4.4, 0.35], target: [0, 0.9, 0] },
  upper: { position: [1.05, 1.45, 1.55], target: [0, 1.15, 0.1], fov: 28 },
  upperR: { position: [-1.05, 1.45, 1.55], target: [0, 1.15, 0.1], fov: 28 },
};
const viewNames = flag("views", "front,side,three").split(",");

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
await page.evaluate((c) => window.__afStudio.show(c, "full"), config);

for (const clip of library.clips.filter((c) => !only.length || only.includes(c.id))) {
  const times = Array.from({ length: FRAMES }, (_, i) => (clip.duration * i) / FRAMES);
  const dataUrl = await page.evaluate(
    async ({ clip, times, views, cell }) => {
      const studio = window.__afStudio;
      const sheet = document.createElement("canvas");
      const label = 22;
      sheet.width = times.length * cell;
      sheet.height = views.length * cell + label;
      const ctx = sheet.getContext("2d");
      ctx.fillStyle = "#1b1f27";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = "#e6e9ef";
      ctx.font = "14px sans-serif";
      ctx.fillText(`${clip.id} — ${clip.duration}s — columns: t = ${times.map((t) => t.toFixed(2)).join(", ")} · rows: ${views.map((v) => v[0]).join(", ")}`, 8, 16);
      for (let c = 0; c < times.length; c++) {
        await studio.pose(clip.id, times[c]);
        for (let r = 0; r < views.length; r++) {
          const url = await studio.capture(cell, views[r][1]);
          const img = new Image();
          await new Promise((resolve) => {
            img.onload = resolve;
            img.src = url;
          });
          ctx.fillStyle = (r + c) % 2 ? "#232833" : "#262c38";
          ctx.fillRect(c * cell, label + r * cell, cell, cell);
          ctx.drawImage(img, c * cell, label + r * cell);
        }
      }
      await studio.pose(null);
      return sheet.toDataURL("image/png");
    },
    { clip: { id: clip.id, duration: clip.duration }, times, views: viewNames.map((v) => [v, VIEWS[v]]), cell: CELL }
  );
  const file = path.join(OUT, `anim_${clip.id}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", path.relative(REPO, file));
}
await browser.close();
