// Downloads the handful of CMU Graphics Lab Motion Capture trials AvatarForge's animations are built
// from (ASF skeleton + AMC motion) into .pipeline-tools/mocap/cmu/. Polite: only the listed files,
// one at a time, skipped when already present (the site asks not to be crawled).
//
// License (mocap.cs.cmu.edu): "This data is free for use in research projects. You may include this
// data in commercially-sold products, but you may not resell this data directly, even in converted
// form." — "The motion capture data may be copied, modified, or redistributed without permission."
// Acknowledgment: "The data used in this project was obtained from mocap.cs.cmu.edu. The database
// was created with funding from NSF EIA-0196217."
//
//   node tools/asset-pipeline/fetch_cmu_mocap.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(REPO, ".pipeline-tools", "mocap", "cmu");

/** Trials used by build_animation_clips.mjs (see the CLIP_SOURCES table there). */
export const TRIALS = [
  "140_06", "140_07", "111_28", "113_21", "77_02", "82_08", // idle / standing
  "08_01", "07_01", "02_01", // walk
  "09_01", "16_35", "35_17", // run
  "13_39", "13_40", "16_01", "02_04", // jump
  "60_01", "60_02", "93_03", "55_02", "143_35", // dance (salsa, charleston, lambada, macarena)
  "141_16", "111_37", "113_27", // wave
  "13_14", "79_70", // laugh
  "74_12", // thinker
  "79_69", "80_43", "142_08", // happy / celebrate
  "13_27", // point
  "75_17", "13_01", // sit
];

async function fetchTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return false;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  await new Promise((r) => setTimeout(r, 400));
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true });
  const subjects = [...new Set(TRIALS.map((t) => t.split("_")[0]))];
  for (const s of subjects) {
    const pad = s.padStart(2, "0");
    if (await fetchTo(`http://mocap.cs.cmu.edu/subjects/${pad}/${pad}.asf`, path.join(OUT, `${pad}.asf`))) console.log("asf", pad);
  }
  for (const t of TRIALS) {
    const [s] = t.split("_");
    if (await fetchTo(`http://mocap.cs.cmu.edu/subjects/${s}/${t}.amc`, path.join(OUT, `${t}.amc`))) console.log("amc", t);
  }
  console.log(`done → ${path.relative(REPO, OUT)}`);
}
