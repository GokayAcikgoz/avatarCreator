// Live face QA: a fake camera plays a video of a face alternating neutral ↔ laughing (rendered from
// our own avatar), the editor's "Live face" tracks it, and the avatar's smile must follow while its
// head stays straight (the face in the video looks straight at the camera).
//
//   npm run dev   (in another terminal)
//   node tools/asset-pipeline/qa_live_face.mjs      → exit code 1 on failure
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const OUT = path.join(REPO, ".pipeline-tools", "qa");
fs.mkdirSync(OUT, { recursive: true });

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

// 1. The "camera video": the avatar's face, neutral then laughing, as JPEG frames → MJPEG.
const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));
const subject = structuredClone(presets.presets.find((p) => p.id === "weekend").configuration);
Object.assign(subject, { accessories: [], accessoryColors: {} });
subject.facialHair = { beardStyle: null, mustacheStyle: null, color: "#3B2415" };
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const frames = {};
try {
  const studio = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await studio.goto(`${ORIGIN}/studio/thumbnail`, { waitUntil: "networkidle" });
  await studio.waitForFunction(() => Boolean(window.__afStudio), null, { timeout: 120_000 });
  for (const expression of ["neutral", "laugh"]) {
    await studio.evaluate((c) => window.__afStudio.show(c, "full"), { ...subject, face: { ...subject.face, expression } });
    await studio.evaluate(() => window.__afStudio.pose("idle", 0.9)); // the moment the idle head looks straight ahead
    frames[expression] = await studio.evaluate(async () => {
      const url = await window.__afStudio.capture(480, { position: [0, 1.55, 0.8], target: [0, 1.53, 0], fov: 30 });
      const img = new Image();
      await new Promise((r) => ((img.onload = r), (img.src = url)));
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#9aa0a8";
      ctx.fillRect(0, 0, 640, 480);
      ctx.drawImage(img, 80, 0);
      return c.toDataURL("image/jpeg", 0.9);
    });
  }
} finally {
  await browser.close();
}
const jpeg = (k) => Buffer.from(frames[k].split(",")[1], "base64");
const mjpeg = path.join(OUT, "live_face.mjpeg");
fs.writeFileSync(mjpeg, Buffer.concat([...Array(45).fill(jpeg("neutral")), ...Array(45).fill(jpeg("laugh"))]));

// 2. The editor with that camera.
const cam = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${mjpeg}`],
});
let failed = false;
const report = (ok, label, detail = "") => {
  console.log(`${ok ? "ok " : "BAD"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
try {
  const context = await cam.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["camera"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.text().startsWith("tracker") && console.log("   ", m.text()));
  await page.goto(`${ORIGIN}/create`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="live-face-toggle"]').click({ timeout: 60_000 });
  await page.locator('[data-testid="live-face-status"]', { hasText: "Live" }).waitFor({ timeout: 120_000 });
  report(true, "tracking started");

  // Sample the avatar's jawOpen for 6 s (the fake camera alternates neutral/laugh every 1.5 s).
  const samples = await page.evaluate(async () => {
    const out = [];
    let body = null;
    window.__afScene.traverse((o) => {
      if (!body && o.isSkinnedMesh && o.morphTargetDictionary?.jawOpen !== undefined && o.name.startsWith("Human")) body = o;
    });
    if (!body) return null;
    const i = body.morphTargetDictionary.mouthSmileLeft;
    for (let t = 0; t < 60; t++) {
      const f = window.__afLiveFace?.current;
      if (t % 10 === 0) console.log(`tracker smile ${f?.weights.get("mouthSmileLeft")?.toFixed(2)} turn ${f?.turn?.toFixed(2)} down ${f?.down?.toFixed(2)} tilt ${f?.tilt?.toFixed(2)} → avatar smile ${body.morphTargetInfluences[i].toFixed(2)}`);
      out.push([body.morphTargetInfluences[i], f ? Math.max(Math.abs(f.turn), Math.abs(f.tilt)) : 0]);
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  });
  const smiles = (samples ?? []).map((s) => s[0]);
  const lo = Math.min(...smiles);
  const hi = Math.max(...smiles);
  report(Boolean(samples) && hi - lo > 0.4, "avatar smile follows the camera", samples ? `mouthSmile ${lo.toFixed(2)} … ${hi.toFixed(2)}` : "no body mesh");
  const pose = Math.max(...(samples ?? []).map((s) => s[1]));
  report(pose < 0.1, "head stays straight for a straight face", `max |turn|,|tilt| ${pose.toFixed(3)} rad`);
  await page.screenshot({ path: path.join(OUT, "live_face_editor.png") });

  await page.locator('[data-testid="live-face-toggle"]').click();
  await page.waitForTimeout(800);
  const off = await page.locator('[data-testid="live-face"]').evaluate((el) => el.classList.contains("hidden"));
  report(off, "turning it off hides the preview");
  report(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await cam.close();
}
console.log(failed ? "\nFAILED" : "\npassed");
process.exit(failed ? 1 : 0);
