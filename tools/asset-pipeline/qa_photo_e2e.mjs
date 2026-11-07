// End-to-end check of "Create from a photo" in the real editor (/create):
//   1. renders a synthetic selfie of a known avatar (studio page) → PNG file
//   2. opens a fresh editor, clicks "Create from a photo", uploads the file
//   3. waits for the detected traits, screenshots them, applies them
//   4. reads the saved draft (localStorage) and checks the traits landed in the configuration
//
//   npm run dev   (in another terminal)
//   node tools/asset-pipeline/qa_photo_e2e.mjs      → exit code 1 on failure
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

const presets = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "avatar-presets.json"), "utf8"));
const subject = structuredClone(presets.presets.find((p) => p.id === "weekend").configuration);
Object.assign(subject, { accessories: [], accessoryColors: {} });
subject.face.skinTone = "#8D5A3B";
subject.face.eyeColor = "#4A6FA5";
subject.hair = { style: "hair_crop", color: "#1B1210" };
subject.facialHair = { beardStyle: "beard_full", mustacheStyle: "mustache_classic", color: "#1B1210" };

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failed = false;
try {
  // 1. The "photo".
  const studio = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await studio.goto(`${ORIGIN}/studio/thumbnail`, { waitUntil: "networkidle" });
  await studio.waitForFunction(() => Boolean(window.__afStudio), null, { timeout: 120_000 });
  await studio.evaluate((c) => window.__afStudio.show(c, "full"), subject);
  await studio.evaluate(() => window.__afStudio.pose("idle", 0));
  const shot = await studio.evaluate(async () => {
    const url = await window.__afStudio.capture(720, { position: [0.03, 1.5, 1.05], target: [0, 1.46, 0], fov: 32 });
    const img = new Image();
    await new Promise((r) => ((img.onload = r), (img.src = url)));
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#9aa0a8"; // a wall behind the person
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.9);
  });
  const photo = path.join(OUT, "selfie_e2e.jpg");
  fs.writeFileSync(photo, Buffer.from(shot.split(",")[1], "base64"));
  await studio.close();

  // 2. A fresh editor.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`console ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${ORIGIN}/create`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="open-photo"]').first().click({ timeout: 60_000 });
  await page.locator('[data-testid="photo-file"]').setInputFiles(photo);

  // 3. Traits.
  await page.locator('[data-testid="photo-traits"]').waitFor({ timeout: 180_000 });
  const traits = await page.locator('[data-testid="photo-traits"] label').allInnerTexts();
  console.log("detected:\n  " + traits.map((t) => t.replace(/\s+/g, " ").trim()).join("\n  "));
  const preview = await page.evaluate(() => {
    const img = document.querySelector('[role="dialog"] img');
    const r = img?.getBoundingClientRect();
    return img ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), complete: img.complete, natural: img.naturalWidth } : null;
  });
  console.log("preview image:", JSON.stringify(preview));
  await page.screenshot({ path: path.join(OUT, "photo_dialog_result.png") });
  await page.locator('[data-testid="photo-apply"]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "photo_applied_editor.png") });

  // 4. The configuration (the editor autosaves a local draft).
  const draft = await page.evaluate(() => JSON.parse(window.localStorage.getItem("avatarforge.draft.v2") ?? "null"));
  const c = draft?.configuration;
  const checks = [
    ["hair style", c?.hair?.style === "hair_crop" || ["hair_crop", "hair_short_messy", "hair_swept"].includes(c?.hair?.style), c?.hair?.style],
    ["hair color", ["#1B1210", "#3B2415"].includes(c?.hair?.color), c?.hair?.color],
    ["beard", ["beard_full", "beard_short"].includes(c?.facialHair?.beardStyle), c?.facialHair?.beardStyle],
    ["mustache", c?.facialHair?.mustacheStyle === "mustache_classic", c?.facialHair?.mustacheStyle],
    ["eyes", ["#4A6FA5", "#3E7C8C", "#7B8794"].includes(c?.face?.eyeColor), c?.face?.eyeColor],
    ["skin changed", c?.face?.skinTone && c.face.skinTone !== "#C68863", c?.face?.skinTone],
  ];
  for (const [label, ok, value] of checks) {
    console.log(`${ok ? "ok " : "BAD"} ${label.padEnd(12)} ${value}`);
    if (!ok) failed = true;
  }
  // Undo restores the previous look in one step.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1200);
  const undone = await page.evaluate(() => JSON.parse(window.localStorage.getItem("avatarforge.draft.v2") ?? "null")?.configuration);
  const undoOk = undone?.facialHair?.beardStyle !== c?.facialHair?.beardStyle || undone?.face?.skinTone !== c?.face?.skinTone;
  console.log(`${undoOk ? "ok " : "BAD"} undo         ${undone?.face?.skinTone} / ${undone?.facialHair?.beardStyle}`);
  if (!undoOk) failed = true;
} finally {
  await browser.close();
}

// 5. Camera flow: Chromium's fake camera plays the same selfie (MJPEG), and a second run with the
// default fake camera (a test pattern, no face) must end in a friendly "no face" message.
const photoPath = path.join(OUT, "selfie_e2e.jpg");
const mjpeg = path.join(OUT, "selfie_e2e.mjpeg");
fs.writeFileSync(mjpeg, Buffer.concat(Array.from({ length: 30 }, () => fs.readFileSync(photoPath))));
for (const [label, extra, expectFace] of [
  ["camera (selfie)", [`--use-file-for-fake-video-capture=${mjpeg}`], true],
  ["camera (no face)", [], false],
]) {
  const cam = await chromium.launch({
    executablePath: chromiumPath(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...extra],
  });
  try {
    const context = await cam.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["camera"] });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/create?photo=1`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Take a photo" }).click({ timeout: 60_000 });
    const capture = page.getByRole("button", { name: "Capture" });
    await capture.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] button:disabled'), null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    await capture.click();
    const outcome = await Promise.race([
      page.locator('[data-testid="photo-traits"]').waitFor({ timeout: 180_000 }).then(() => "traits"),
      page.getByText("No face found").waitFor({ timeout: 180_000 }).then(() => "no-face"),
    ]);
    const ok = expectFace ? outcome === "traits" : outcome === "no-face";
    console.log(`${ok ? "ok " : "BAD"} ${label.padEnd(16)} → ${outcome}`);
    await page.screenshot({ path: path.join(OUT, `photo_${expectFace ? "camera" : "camera_noface"}.png`) });
    if (!ok) failed = true;
  } finally {
    await cam.close();
  }
}
console.log(failed ? "\nFAILED" : "\npassed");
process.exit(failed ? 1 : 0);
