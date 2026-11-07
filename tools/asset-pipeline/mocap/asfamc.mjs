// ASF/AMC (Acclaim) motion capture: parser + forward kinematics, as used by the CMU Graphics Lab
// Motion Capture Database. Output per frame: every bone's global rotation relative to the ASF rest
// pose (a T-pose: arms out, legs down) and its global end position in meters.
//
// FK follows the format's definition (see CMU's amc_to_matrix / AMCParser):
//   C_b  = rotation from the bone's `axis` (its local frame in the rest pose)
//   R_b  = rotation from the frame's dof values, in that local frame
//   M_b  = M_parent · C_b · R_b · C_b⁻¹          (global rotation, identity at rest)
//   P_b  = P_parent + length · (M_b · direction)
// Euler angles are "static XYZ": R = Rz · Ry · Rx, degrees.
import fs from "node:fs";
import * as THREE from "three";

const DEG = Math.PI / 180;

function eulerXYZ(rx, ry, rz) {
  // Static XYZ → apply X, then Y, then Z: q = qZ · qY · qX
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx * DEG);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry * DEG);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz * DEG);
  return qz.multiply(qy).multiply(qx);
}

export function parseAsf(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let section = "";
  let lengthUnit = 1;
  const bones = new Map();
  let current = null;
  const children = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith(":")) {
      section = line.split(/\s+/)[0];
      continue;
    }
    const parts = line.split(/\s+/);
    if (section === ":units" && parts[0] === "length") lengthUnit = Number(parts[1]);
    if (section === ":bonedata") {
      if (parts[0] === "begin") current = { dof: [], direction: new THREE.Vector3(), length: 0, C: new THREE.Quaternion() };
      else if (parts[0] === "end") {
        bones.set(current.name, current);
        current = null;
      } else if (current) {
        if (parts[0] === "name") current.name = parts[1];
        if (parts[0] === "direction") current.direction.set(+parts[1], +parts[2], +parts[3]).normalize();
        if (parts[0] === "length") current.length = +parts[1];
        if (parts[0] === "axis") {
          if (parts[4] && parts[4] !== "XYZ") throw new Error(`${file}: unsupported axis order ${parts[4]}`);
          current.C = eulerXYZ(+parts[1], +parts[2], +parts[3]);
        }
        if (parts[0] === "dof") current.dof = parts.slice(1);
      }
    }
    if (section === ":hierarchy" && parts[0] !== "begin" && parts[0] !== "end") children.set(parts[0], parts.slice(1));
  }
  // Meters per ASF length unit: lengths are in (1 / lengthUnit) inches.
  const meters = 0.0254 / lengthUnit;
  const parent = new Map();
  for (const [p, cs] of children) for (const c of cs) parent.set(c, p);
  const order = [];
  const visit = (name) => {
    order.push(name);
    for (const c of children.get(name) ?? []) visit(c);
  };
  visit("root");
  return { bones, parent, order, meters };
}

export function parseAmc(file) {
  const frames = [];
  let current = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(":")) continue;
    if (/^\d+$/.test(line)) {
      current = new Map();
      frames.push(current);
      continue;
    }
    const [name, ...values] = line.split(/\s+/);
    current?.set(name, values.map(Number));
  }
  return frames;
}

/**
 * Global rotations (relative to the ASF rest pose) and end positions (meters) of every bone for
 * each frame. CMU data is 120 fps.
 */
export function solveMotion(asf, amcFrames) {
  return amcFrames.map((frame) => {
    const rot = new Map();
    const pos = new Map();
    const rootValues = frame.get("root");
    rot.set("root", eulerXYZ(rootValues[3], rootValues[4], rootValues[5]));
    pos.set("root", new THREE.Vector3(rootValues[0], rootValues[1], rootValues[2]).multiplyScalar(asf.meters));
    for (const name of asf.order) {
      if (name === "root") continue;
      const bone = asf.bones.get(name);
      const parentName = asf.parent.get(name);
      const values = frame.get(name) ?? [];
      const angles = { rx: 0, ry: 0, rz: 0 };
      bone.dof.forEach((d, i) => (angles[d] = values[i] ?? 0));
      const R = eulerXYZ(angles.rx, angles.ry, angles.rz);
      const M = rot.get(parentName).clone().multiply(bone.C).multiply(R).multiply(bone.C.clone().invert());
      rot.set(name, M);
      pos.set(name, pos.get(parentName).clone().add(bone.direction.clone().applyQuaternion(M).multiplyScalar(bone.length * asf.meters)));
    }
    return { rot, pos };
  });
}

/** Rest-pose end positions (meters, root at origin), e.g. for leg lengths. */
export function restPositions(asf) {
  const pos = new Map([["root", new THREE.Vector3()]]);
  for (const name of asf.order) {
    if (name === "root") continue;
    const bone = asf.bones.get(name);
    pos.set(name, pos.get(asf.parent.get(name)).clone().add(bone.direction.clone().multiplyScalar(bone.length * asf.meters)));
  }
  return pos;
}
