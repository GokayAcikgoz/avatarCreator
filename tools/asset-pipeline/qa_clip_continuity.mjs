// Continuity check for shared/animation-clips.json: per clip, the largest frame-to-frame rotation of
// any bone and of the root translation, including the loop seam (last → first). A pop shows up as
// a step far above the clip's typical motion. Exit code 1 if a seam is a pop.
//   node tools/asset-pipeline/qa_clip_continuity.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lib = JSON.parse(fs.readFileSync(path.join(REPO, "shared", "animation-clips.json"), "utf8"));
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
let bad = 0;
for (const c of lib.clips) {
  let maxStep = 0, maxBone = "", maxAt = 0, seam = 0, seamBone = "";
  for (const [bone, v] of Object.entries(c.tracks)) {
    if (v.length === 4) continue;
    const n = v.length / 4;
    for (let i = 1; i < n; i++) {
      const d = angle(v.slice((i - 1) * 4, i * 4), v.slice(i * 4, i * 4 + 4));
      if (d > maxStep) [maxStep, maxBone, maxAt] = [d, bone, i];
    }
    // The clip's last key equals its first by construction; the seam is the step out of the first key
    // compared with the step into the last one.
    const s = angle(v.slice((n - 2) * 4, (n - 1) * 4), v.slice(0, 4));
    if (s > seam) [seam, seamBone] = [s, bone];
  }
  let rootStep = 0;
  const r = c.root;
  for (let i = 3; i + 2 < r.length; i += 3) rootStep = Math.max(rootStep, Math.hypot(r[i] - r[i - 3], r[i + 1] - r[i - 2], r[i + 2] - r[i - 1]));
  const pop = seam > Math.max(0.35, maxStep * 1.6);
  if (pop) bad++;
  console.log(`${pop ? "POP" : "ok "} ${c.id.padEnd(10)} max step ${(maxStep * 57.3).toFixed(1)}° (${maxBone} @${maxAt}) · seam ${(seam * 57.3).toFixed(1)}° (${seamBone}) · root step ${(rootStep * 100).toFixed(1)} cm/frame`);
}
process.exit(bad ? 1 : 0);
