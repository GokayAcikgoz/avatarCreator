// Editor smoke test against the running web app + API:
//   every animation button plays without page errors · create account + save through the API ·
//   reload restores the saved avatar · server-side posed render (Blender) of the saved avatar.
//
//   npm run dev · npm run api      (in other terminals)
//   node tools/asset-pipeline/qa_editor_smoke.mjs     → exit code 1 on failure
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const API = process.env.API_ORIGIN ?? "http://localhost:5080";
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

const clips = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "animation-clips.json"), "utf8")).clips;
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
let failed = false;
const report = (ok, label, detail = "") => {
  console.log(`${ok ? "ok " : "BAD"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/create`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Studio", exact: false }).first().click({ timeout: 60_000 });

  // Every animation.
  for (const clip of clips) {
    await page.getByRole("button", { name: clip.name, exact: true }).first().click();
    await page.waitForTimeout(clip.id === "sit" ? 1200 : 700);
  }
  await page.screenshot({ path: path.join(OUT, "smoke_after_animations.png") });
  report(errors.length === 0, `played ${clips.length} animations`, errors.join(" | "));

  // Save → create an account in the dialog.
  const email = `smoke-${Date.now()}@avatarforge.local`;
  await page.keyboard.press("Control+s");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create account" }).first().click();
  await dialog.locator('input[type="email"]').fill(email);
  await dialog.locator('input[type="password"]').fill("SmokeTest!2026");
  await dialog.getByRole("button", { name: "Create account" }).last().click();
  await page.waitForURL(/avatarId=/, { timeout: 60_000 });
  const avatarId = new URL(page.url()).searchParams.get("avatarId");
  report(Boolean(avatarId), "saved to the account", avatarId ?? "");

  // Reload restores it from the account.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 60_000 });
  report(true, "reload restores the saved avatar");

  // Server render of a pose, through the same session.
  const render = await page.evaluate(
    async ([api, id]) => {
      const r = await fetch(`${api}/api/v1/avatars/${id}/render`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "png", width: 512, height: 512, camera: "full", background: "#1b1f27", animation: "run", time: 0.2 }),
      });
      return { status: r.status, body: await r.json() };
    },
    [API, avatarId]
  );
  report(render.status === 200 && render.body.status === "completed", "server render (run pose)", JSON.stringify(render.body).slice(0, 120));
  if (render.body.url) {
    const png = await (await fetch(`${API}${render.body.url}`)).arrayBuffer();
    fs.writeFileSync(path.join(OUT, "smoke_server_run.png"), Buffer.from(png));
  }
  report(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
}
console.log(failed ? "\nFAILED" : "\npassed");
process.exit(failed ? 1 : 0);
