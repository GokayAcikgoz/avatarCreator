// Builds shared/animation-clips.json — AvatarForge's animation library as DATA, not code.
//
// Consumers:
//   * web viewer  → THREE.AnimationClip per rig, played through an AnimationMixer with cross-fades
//   * API/Blender → samples a single frame to pose the armature for server-side renders
//   * GLB export  → the same clips are embedded as glTF animations (Unity/Unreal/Blender)
//
// Track values are DELTAS applied on top of each bone's rest rotation (final = rest × delta) in the
// bone's local frame, plus a root translation delta (meters, model space). Bone names are the rig's
// glTF node names ("upperarm01.L"); three.js strips the dot when loading.
//
// HOW POSES ARE AUTHORED — no guessed axis signs anywhere:
//   * The rig's rest pose is read from the body GLB and a small forward-kinematics solver runs here.
//   * Every semantic joint motion ("hip flexion", "knee flexion", "spine bends forward", "finger
//     curls into the palm"...) is a rotation about an anatomical axis whose SIGN is calibrated at
//     startup by FK tests (e.g. hip flexion must move the knee forward). Wrong-way bends can't happen.
//   * Arms use a hinge-aware solver: you give the upper-arm direction, the elbow bend and which way
//     the forearm should fold; the upper arm is rolled so the elbow's real hinge axis lines up, so
//     the elbow only ever flexes like an elbow. The palm is then turned by forearm pronation.
//   * Motion curves are periodic, smoothly interpolated keyframes (like an animator's graph editor).
//
//   node tools/asset-pipeline/build_animation_clips.mjs
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAmc, parseAsf, restPositions, solveMotion } from "./mocap/asfamc.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(REPO, "shared", "animation-clips.json");
const BODY = path.join(REPO, "api", "server-assets", "avatar-base-poc.glb");
const FPS = 30; // captured motion (120 fps) keeps fast gestures like waving crisp at 30
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0); // avatar's left
const Y = V(0, 1, 0); // up
const Z = V(0, 0, 1); // forward (toward the viewer)
const IDENTITY = new THREE.Quaternion();

// ───────────────────────────────────────────────────────────── rest pose + forward kinematics ──
const JOINTS = new Map(); // name -> { parent, t: Vector3, r: Quaternion }
const ORDER = []; // parents before children
{
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(BODY);
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  for (const j of joints) {
    const parent = j.getParentNode();
    JOINTS.set(j.getName(), {
      parent: parent && joints.includes(parent) ? parent.getName() : null,
      t: V(...j.getTranslation()),
      r: new THREE.Quaternion(...j.getRotation()),
    });
  }
  const visit = (name) => {
    if (ORDER.includes(name)) return;
    const parent = JOINTS.get(name).parent;
    if (parent) visit(parent);
    ORDER.push(name);
  };
  for (const name of JOINTS.keys()) visit(name);
}

/** World (model-space) position + rotation of every joint for a set of local deltas. */
function fk(deltas = new Map(), root = V(0, 0, 0)) {
  const world = new Map();
  for (const name of ORDER) {
    const j = JOINTS.get(name);
    const local = j.r.clone().multiply(deltas.get(name) ?? IDENTITY);
    if (!j.parent) world.set(name, { p: j.t.clone().add(root), q: local });
    else {
      const pw = world.get(j.parent);
      world.set(name, { p: j.t.clone().applyQuaternion(pw.q).add(pw.p), q: pw.q.clone().multiply(local) });
    }
  }
  return world;
}

const REST = fk();
const restPos = (bone) => REST.get(bone).p.clone();
const restAxisLocal = (bone, bodyAxis) => bodyAxis.clone().applyQuaternion(REST.get(bone).q.clone().invert()).normalize();
/** A point rigidly attached to `bone` (given in rest world space), after posing. */
const follow = (world, bone, restPoint) =>
  restPoint.clone().sub(REST.get(bone).p).applyQuaternion(REST.get(bone).q.clone().invert()).applyQuaternion(world.get(bone).q).add(world.get(bone).p);

function rotationDelta(bone, bodyAxis, angle) {
  return new THREE.Quaternion().setFromAxisAngle(restAxisLocal(bone, bodyAxis), angle);
}

/** Calibrate: the sign that makes rotating `bone` about `bodyAxis` move `probe` along `want`. */
function calibrate(bone, bodyAxis, probeBone, probePoint, want) {
  const before = follow(REST, probeBone, probePoint);
  const after = follow(fk(new Map([[bone, rotationDelta(bone, bodyAxis, 0.3)]])), probeBone, probePoint);
  const s = Math.sign(after.sub(before).dot(want));
  if (s === 0) throw new Error(`calibration failed for ${bone}`);
  return s;
}

const mirror = (side, v) => (side === "L" ? v.clone() : V(-v.x, v.y, v.z));
const sideSign = (side) => (side === "L" ? 1 : -1);

// Anatomical sign table, measured — never assumed.
const SIGN = {};
for (const s of ["L", "R"]) {
  SIGN[`hipFlex${s}`] = calibrate(`upperleg01.${s}`, X, `lowerleg01.${s}`, restPos(`lowerleg01.${s}`), Z); // knee forward
  SIGN[`hipAbduct${s}`] = calibrate(`upperleg01.${s}`, Z, `lowerleg01.${s}`, restPos(`lowerleg01.${s}`), mirror(s, X)); // knee outward
  SIGN[`hipTurn${s}`] = calibrate(`upperleg01.${s}`, Y, `foot.${s}`, restPos(`foot.${s}`).add(V(0, 0, 0.12)), mirror(s, X)); // toes outward
  SIGN[`knee${s}`] = calibrate(`lowerleg01.${s}`, X, `foot.${s}`, restPos(`foot.${s}`), Z.clone().negate()); // ankle backward
  SIGN[`ankle${s}`] = calibrate(`foot.${s}`, X, `toe3-1.${s}`, restPos(`toe3-1.${s}`), Y); // toes up
  SIGN[`shrug${s}`] = calibrate(`clavicle.${s}`, Z, `upperarm01.${s}`, restPos(`upperarm01.${s}`), Y); // shoulder up
  SIGN[`protract${s}`] = calibrate(`clavicle.${s}`, Y, `upperarm01.${s}`, restPos(`upperarm01.${s}`), Z); // shoulder forward
}
const headTop = restPos("head").add(V(0, 0.12, 0));
const nose = restPos("head").add(V(0, 0.02, 0.12));
SIGN.spineFwd = calibrate("spine03", X, "head", headTop, Z);
SIGN.spineSide = calibrate("spine03", Z, "head", headTop, X.clone().negate()); // positive leans to the avatar's right
SIGN.spineTwist = calibrate("spine03", Y, "upperarm01.R", restPos("upperarm01.R"), Z); // positive turns chest to the avatar's left
SIGN.headDown = calibrate("head", X, "head", headTop, Z);
SIGN.headTurn = calibrate("head", Y, "head", nose, X); // positive looks to the avatar's left
SIGN.headTilt = calibrate("head", Z, "head", headTop, X.clone().negate()); // positive tilts to the avatar's right
SIGN.rootTurn = calibrate("root", Y, "spine01", restPos("spine01").add(V(0, 0, 0.1)), X);
SIGN.rootTilt = calibrate("root", Z, "spine01", restPos("spine01"), X.clone().negate());

// Palm normal of each hand at rest (pointing out of the palm), and finger curl signs.
const PALM = {};
for (const s of ["L", "R"]) {
  const wrist = restPos(`wrist.${s}`);
  const along = restPos(`finger3-1.${s}`).sub(wrist).normalize();
  const across = restPos(`finger2-1.${s}`).sub(restPos(`finger5-1.${s}`)).normalize();
  let n = new THREE.Vector3().crossVectors(along, across).normalize();
  // The thumb sits on the palm side of the knuckle plane.
  if (restPos(`finger1-3.${s}`).sub(wrist).dot(n) < 0) n.negate();
  PALM[s] = n;
  // Curl: rotating a finger segment about its own local X must move the tip toward the palm.
  const tipOf = (f) => restPos(`finger${f}-3.${s}`).add(restPos(`finger${f}-3.${s}`).sub(restPos(`finger${f}-2.${s}`)));
  const test = (bone, tipBone, tip) => {
    const q = new THREE.Quaternion().setFromAxisAngle(X, 0.4);
    const moved = follow(fk(new Map([[bone, q]])), tipBone, tip).sub(follow(REST, tipBone, tip));
    return Math.sign(moved.dot(n)) || 1;
  };
  SIGN[`curl${s}`] = test(`finger3-1.${s}`, `finger3-3.${s}`, tipOf(3));
  SIGN[`thumb${s}`] = test(`finger1-2.${s}`, `finger1-3.${s}`, tipOf(1));
}

// ───────────────────────────────────────────────────────────────────────────── pose builder ──
class Pose {
  constructor() {
    this.deltas = new Map();
    this.root = V(0, 0, 0);
  }
  /** Rotation about an anatomical (body-frame) axis, composed onto the bone's current delta. */
  turn(bone, bodyAxis, angle) {
    if (!angle) return this;
    const d = this.deltas.get(bone) ?? new THREE.Quaternion();
    this.deltas.set(bone, d.multiply(rotationDelta(bone, bodyAxis, angle)));
    return this;
  }
  local(bone, axis, angle) {
    if (!angle) return this;
    const d = this.deltas.get(bone) ?? new THREE.Quaternion();
    this.deltas.set(bone, d.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle)));
    return this;
  }
  move(x = 0, y = 0, z = 0) {
    this.root.add(V(x, y, z));
    return this;
  }
}

// Torso & head ------------------------------------------------------------------------------
function spine(p, { fwd = 0, side = 0, twist = 0 } = {}) {
  for (const [bone, w] of [["spine05", 0.15], ["spine04", 0.25], ["spine03", 0.3], ["spine02", 0.3]]) {
    p.turn(bone, X, SIGN.spineFwd * fwd * w).turn(bone, Z, SIGN.spineSide * side * w).turn(bone, Y, SIGN.spineTwist * twist * w);
  }
}
function head(p, { down = 0, turn = 0, tilt = 0 } = {}) {
  for (const [bone, w] of [["neck01", 0.3], ["neck02", 0.25], ["head", 0.45]]) {
    p.turn(bone, X, SIGN.headDown * down * w).turn(bone, Y, SIGN.headTurn * turn * w).turn(bone, Z, SIGN.headTilt * tilt * w);
  }
}
function hips(p, { turn = 0, tilt = 0 } = {}) {
  p.turn("root", Y, SIGN.rootTurn * turn).turn("root", Z, SIGN.rootTilt * tilt);
}
function shoulder(p, s, { shrug = 0, forward = 0 } = {}) {
  p.turn(`clavicle.${s}`, Z, SIGN[`shrug${s}`] * shrug).turn(`clavicle.${s}`, Y, SIGN[`protract${s}`] * forward);
}

// Legs ---------------------------------------------------------------------------------------
function leg(p, s, { flex = 0, abduct = 0, rotate = 0, knee = 0, ankle = 0, toes = 0 } = {}) {
  p.turn(`upperleg01.${s}`, X, SIGN[`hipFlex${s}`] * flex)
    .turn(`upperleg01.${s}`, Z, SIGN[`hipAbduct${s}`] * abduct)
    .turn(`upperleg01.${s}`, Y, SIGN[`hipTurn${s}`] * rotate)
    .turn(`lowerleg01.${s}`, X, SIGN[`knee${s}`] * Math.max(0, knee))
    .turn(`foot.${s}`, X, SIGN[`ankle${s}`] * ankle);
  if (toes) for (const t of [1, 2, 3, 4, 5]) p.turn(`toe${t}-1.${s}`, X, SIGN[`ankle${s}`] * toes);
}

// Arms (hinge-aware) ---------------------------------------------------------------------------
function world(p) {
  return fk(p.deltas, p.root);
}

// Ground contact ---------------------------------------------------------------------------------
// Sole points (heel, ball, toe tips) in rest space, rigidly attached to the foot/toe bones. The rest
// pose stands on y = 0.
const SOLE = ["L", "R"].flatMap((s) => {
  const x = sideSign(s);
  return [
    [`foot.${s}`, V(0.181 * x, 0, -0.045)],
    [`foot.${s}`, V(0.19 * x, 0, 0.13)],
    [`toe1-1.${s}`, V(0.15 * x, 0, 0.19)],
    [`toe3-1.${s}`, V(0.197 * x, 0, 0.2)],
    [`toe5-1.${s}`, V(0.225 * x, 0, 0.16)],
  ];
});
function soleHeight(p) {
  const w = world(p);
  return Math.min(...SOLE.map(([bone, point]) => follow(w, bone, point).y));
}
/** Moves the body vertically so the lowest foot point rests on the floor (+ `air` meters above it). */
function ground(p, air = 0) {
  p.root.y += air - soleHeight(p);
}

// Arm chain geometry measured from the rest pose: bone-local axes toward the next joint, lengths,
// and the elbow's hinge (fixed in the upper arm's frame; the rest pose is already bent 43° in it).
const ARM = {};
for (const s of ["L", "R"]) {
  const S = REST.get(`upperarm01.${s}`);
  const E = REST.get(`lowerarm01.${s}`);
  const Wr = REST.get(`wrist.${s}`);
  const U0 = E.p.clone().sub(S.p);
  const F0 = Wr.p.clone().sub(E.p);
  const u0 = U0.clone().normalize();
  const front0 = Z.clone().sub(u0.clone().multiplyScalar(Z.dot(u0))).normalize();
  const hinge0 = new THREE.Vector3().crossVectors(u0, front0).normalize();
  ARM[s] = {
    L1: U0.length(),
    L2: F0.length(),
    upperAxis: u0.clone().applyQuaternion(S.q.clone().invert()),
    foreAxis: F0.clone().normalize().applyQuaternion(E.q.clone().invert()),
    hingeLocal: hinge0.applyQuaternion(S.q.clone().invert()).normalize(),
  };
}
const QA = { twist: new Set() }; // anatomical range warnings collected while sampling
let currentClip = "";

/**
 * Poses one arm from world-space directions: `U` = upper arm (shoulder → elbow), `bend` = elbow
 * flexion (0 = straight), `foldW` = which way the forearm folds, `palmW` = where the palm faces.
 */
function armWorld(p, s, U, bend, foldW, palmW, shrugAuto = true, fingersW = null) {
  const upper = `upperarm01.${s}`;
  const fore = `lowerarm01.${s}`;
  const twist = `lowerarm02.${s}`;
  const { upperAxis, foreAxis, hingeLocal } = ARM[s];
  U = U.clone().normalize();

  // Lifting the arm above the shoulder also lifts the shoulder girdle (scapulohumeral rhythm).
  if (shrugAuto && U.y > 0) shoulder(p, s, { shrug: 0.35 * U.y });

  // The plane the forearm folds in; its normal is where the elbow's hinge has to point.
  let foldPerp = foldW.clone().sub(U.clone().multiplyScalar(foldW.dot(U)));
  if (foldPerp.lengthSq() < 1e-6) foldPerp = Z.clone().sub(U.clone().multiplyScalar(Z.dot(U)));
  foldPerp.normalize();
  const N = new THREE.Vector3().crossVectors(U, foldPerp).normalize();

  // Upper-arm world rotation mapping its local axis → U and its local hinge → N.
  const frame = (a, b) => {
    const b2 = b.clone().sub(a.clone().multiplyScalar(b.dot(a))).normalize();
    return new THREE.Matrix4().makeBasis(a, b2, new THREE.Vector3().crossVectors(a, b2));
  };
  const Rupper = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(frame(U, N), frame(upperAxis, hingeLocal).transpose()));
  const w0 = world(p);
  const baseUpper = w0.get(JOINTS.get(upper).parent).q.clone().multiply(JOINTS.get(upper).r);
  p.deltas.set(upper, baseUpper.clone().invert().multiply(Rupper));

  // QA: humeral rotation relative to a plain swing from the rest arm — beyond ~100° is unnatural.
  const restQ = REST.get(upper).q;
  const swingOnly = new THREE.Quaternion().setFromUnitVectors(upperAxis.clone().applyQuaternion(restQ), U);
  const naturalHinge = hingeLocal.clone().applyQuaternion(restQ).applyQuaternion(swingOnly);
  const roll = Math.atan2(U.dot(new THREE.Vector3().crossVectors(naturalHinge, N)), naturalHinge.dot(N));
  if (Math.abs(roll) > 1.75) QA.twist.add(`${currentClip}: ${s} upper-arm roll ${(roll / DEG).toFixed(0)}°`);

  // Forearm: swing from its base to F — with the upper arm rolled, that's a pure hinge rotation.
  const F = U.clone().multiplyScalar(Math.cos(bend)).add(foldPerp.clone().multiplyScalar(Math.sin(bend))).normalize();
  const w1 = world(p);
  const baseFore = w1.get(JOINTS.get(fore).parent).q.clone().multiply(JOINTS.get(fore).r);
  p.deltas.set(fore, new THREE.Quaternion().setFromUnitVectors(foreAxis, F.clone().applyQuaternion(baseFore.clone().invert()).normalize()));

  // Palm: pronation/supination about the forearm axis (lowerarm02 is the twist bone).
  p.deltas.delete(twist);
  p.deltas.delete(`wrist.${s}`);
  if (palmW && fingersW) orientHand(p, s, F, fingersW, palmW);
  else if (palmW) {
    const want = palmW.clone().normalize();
    const w2 = world(p);
    const restPalmLocal = PALM[s].clone().applyQuaternion(REST.get(`wrist.${s}`).q.clone().invert());
    const current = restPalmLocal.applyQuaternion(w2.get(`wrist.${s}`).q);
    const c = current.clone().sub(F.clone().multiplyScalar(current.dot(F))).normalize();
    const d = want.clone().sub(F.clone().multiplyScalar(want.dot(F))).normalize();
    let angle = Math.atan2(F.dot(new THREE.Vector3().crossVectors(c, d)), c.dot(d));
    angle = Math.max(-1.9, Math.min(1.9, angle)); // pronation/supination range
    const baseTwist = w2.get(JOINTS.get(twist).parent).q.clone().multiply(JOINTS.get(twist).r);
    p.deltas.set(twist, new THREE.Quaternion().setFromAxisAngle(F.clone().applyQuaternion(baseTwist.clone().invert()).normalize(), angle));
  }
  return F;
}

// Hand frame at rest, in the wrist's local space: where the fingers point and where the palm faces.
const HAND = {};
for (const s of ["L", "R"]) {
  const inv = REST.get(`wrist.${s}`).q.clone().invert();
  HAND[s] = {
    fingers: restPos(`finger3-1.${s}`).sub(restPos(`wrist.${s}`)).normalize().applyQuaternion(inv),
    palm: PALM[s].clone().applyQuaternion(inv),
  };
}
const handFrame = (f, n) => {
  const n2 = n.clone().sub(f.clone().multiplyScalar(n.dot(f))).normalize();
  return new THREE.Matrix4().makeBasis(f, n2, new THREE.Vector3().crossVectors(f, n2));
};

/**
 * Turns the hand so the fingers point along `fingersW` with the palm facing `palmW` (world). The
 * roll about the forearm goes to the forearm twist bone (pronation, ±110°); what's left is a wrist
 * swing, capped at 75° — the hand can't do anything a real wrist can't.
 */
function orientHand(p, s, F, fingersW, palmW) {
  const twistBone = `lowerarm02.${s}`;
  const wristBone = `wrist.${s}`;
  const w = world(p);
  const cur = w.get(wristBone).q;
  const curF = HAND[s].fingers.clone().applyQuaternion(cur);
  const curN = HAND[s].palm.clone().applyQuaternion(cur);
  const R = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().multiplyMatrices(handFrame(fingersW.clone().normalize(), palmW), handFrame(curF, curN).transpose())
  );
  // Swing-twist split of R about the forearm axis.
  const proj = F.clone().multiplyScalar(F.dot(V(R.x, R.y, R.z)));
  const twistQ = new THREE.Quaternion(proj.x, proj.y, proj.z, R.w).normalize();
  let angle = 2 * Math.atan2(V(twistQ.x, twistQ.y, twistQ.z).dot(F), twistQ.w);
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  angle = Math.max(-1.9, Math.min(1.9, angle));
  const baseTwist = w.get(JOINTS.get(twistBone).parent).q.clone().multiply(JOINTS.get(twistBone).r);
  p.deltas.set(twistBone, new THREE.Quaternion().setFromAxisAngle(F.clone().applyQuaternion(baseTwist.clone().invert()).normalize(), angle));

  // Remaining rotation → wrist, limited.
  const w2 = world(p);
  const cur2 = w2.get(wristBone).q;
  const R2 = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().multiplyMatrices(
      handFrame(fingersW.clone().normalize(), palmW),
      handFrame(HAND[s].fingers.clone().applyQuaternion(cur2), HAND[s].palm.clone().applyQuaternion(cur2)).transpose()
    )
  );
  const baseWrist = w2.get(JOINTS.get(wristBone).parent).q.clone().multiply(JOINTS.get(wristBone).r);
  const delta = baseWrist.clone().invert().multiply(R2).multiply(cur2);
  const deltaAngle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
  const limit = 75 * DEG;
  if (deltaAngle > limit) {
    QA.twist.add(`${currentClip}: ${s} wrist wants ${(deltaAngle / DEG).toFixed(0)}° (capped)`);
    delta.slerp(new THREE.Quaternion(), 1 - limit / deltaAngle);
  }
  p.deltas.set(wristBone, delta);
}

/**
 * Arm by directions, authored for the LEFT arm in body space and mirrored for the right.
 * `dir`: upper arm direction · `bend`: elbow flexion · `fold`: where the forearm folds · `palm`.
 */
function arm(p, s, { dir, bend = 0.2, fold = V(0, 0, 1), palm = null, fingers = null, shrugAuto = true } = {}) {
  return armWorld(p, s, mirror(s, dir), bend, mirror(s, fold).normalize(), palm ? mirror(s, palm) : null, shrugAuto, fingers ? mirror(s, fingers) : null);
}

/**
 * Arm IK: puts the wrist at `target` (world space, meters) with the elbow pointing toward `pole`
 * (world space). Solved analytically (law of cosines) on the measured bone lengths.
 */
function reach(p, s, target, { pole = mirror(s, V(0.3, -1, -0.3)), palm = null, fingers = null } = {}) {
  const { L1, L2 } = ARM[s];
  const S = world(p).get(`upperarm01.${s}`).p;
  const toT = target.clone().sub(S);
  const d = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-3, toT.length()));
  const D = toT.normalize();
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  let P = pole.clone().sub(D.clone().multiplyScalar(pole.dot(D)));
  if (P.lengthSq() < 1e-8) P = V(0, -1, 0);
  P.normalize();
  const U = D.clone().multiplyScalar(cosA).add(P.multiplyScalar(Math.sqrt(1 - cosA * cosA)));
  const wristPos = S.clone().add(D.clone().multiplyScalar(d));
  const F = wristPos.sub(S.clone().add(U.clone().multiplyScalar(L1))).normalize();
  const bend = Math.acos(Math.max(-1, Math.min(1, U.dot(F))));
  armWorld(p, s, U, bend, F, palm, false, fingers);
}

/** World position of a rest-space point carried by `bone` in the current pose. */
function at(p, bone, restPoint = REST.get(bone).p) {
  return follow(world(p), bone, restPoint);
}

function wrist(p, s, { flex = 0, deviate = 0 } = {}) {
  // Flexion bends the hand toward the palm; deviation tilts it toward the thumb/pinky.
  p.local(`wrist.${s}`, X, SIGN[`curl${s}`] * flex).local(`wrist.${s}`, Z, deviate * sideSign(s));
}

/** Hand shape: curl 0 = open, 1 = loose fist, 1.5 = tight fist. Per-finger overrides. */
function hand(p, s, { curl = 0.25, thumb = 0.2, index = null, spread = 0 } = {}) {
  for (const f of [1, 2, 3, 4, 5]) for (const j of [1, 2, 3]) p.deltas.delete(`finger${f}-${j}.${s}`);
  const sign = SIGN[`curl${s}`];
  for (const f of [2, 3, 4, 5]) {
    const c = f === 2 && index !== null ? index : curl;
    for (const [j, w] of [[1, 0.8], [2, 1.05], [3, 0.75]]) p.local(`finger${f}-${j}.${s}`, X, sign * c * w);
    if (spread) p.local(`finger${f}-1.${s}`, Z, (f - 3.5) * spread * 0.15 * sideSign(s));
  }
  const tsign = SIGN[`thumb${s}`];
  for (const [j, w] of [[2, 0.6], [3, 0.8]]) p.local(`finger1-${j}.${s}`, X, tsign * thumb * w);
}

/** Relaxed standing arms: hanging by the thighs, soft elbows, palms facing the body. */
function relaxedArms(p, sway = 0) {
  for (const s of ["L", "R"]) {
    arm(p, s, { dir: V(0.16, -1, 0.02 + sway * (s === "L" ? 1 : -1)), bend: 0.22, fold: V(-0.1, 0, 1), palm: V(-1, 0, 0.1) });
    hand(p, s, { curl: 0.35, thumb: 0.2 });
  }
}

// ─────────────────────────────────────────────────────────────────────────── motion curves ──
/** Smooth periodic curve through [phase, value] keys (Catmull-Rom), phase in [0, 1). */
function loop(keys, phase) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  const ph = ((phase % 1) + 1) % 1;
  let i = n - 1;
  for (let j = 0; j < n; j++) if (k[j][0] <= ph) i = j;
  const at = (idx) => {
    const wrap = Math.floor(idx / n);
    const e = k[((idx % n) + n) % n];
    return [e[0] + wrap, e[1]];
  };
  const [t1, v1] = at(i);
  const [t2, v2] = at(i + 1);
  const [t0, v0] = at(i - 1);
  const [t3, v3] = at(i + 2);
  let t = ph < t1 ? ph + 1 : ph;
  const u = (t - t1) / (t2 - t1);
  const m1 = ((v2 - v0) / (t2 - t0)) * (t2 - t1);
  const m2 = ((v3 - v1) / (t3 - t1)) * (t2 - t1);
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v2 + (u3 - u2) * m2;
}
const wave = (phase, cycles = 1, offset = 0) => Math.sin(TAU * (phase * cycles + offset));
const ease = (x) => x * x * (3 - 2 * x);

// Direction helper: an arm direction from "how far forward" and "how far out" angles (radians),
// starting from hanging straight down. Written for the LEFT arm.
function armDir(forward, out) {
  const d = V(0, -1, 0);
  d.applyAxisAngle(Z, out); // out: rotates toward +X (away from the body for the left arm)
  d.applyAxisAngle(X, -forward); // forward: rotates toward +Z
  return d.normalize();
}

// ─────────────────────────────────────────────────────────── motion capture retargeting ──
// Real human motion (CMU Graphics Lab Motion Capture Database, see fetch_cmu_mocap.mjs) mapped onto
// our rig. For every mapped bone the source's global rotation (relative to its T-pose rest) is
// applied to our bone after aligning our rest direction with the source's rest direction:
//   Rw_ours(t) = M_src(t) · A · Rest_ours,   A = swing(our rest bone direction → source rest direction)
// so bone directions follow the performer exactly whatever the two rigs' rest poses (T vs A) are.
// Fingers and face stay ours (CMU hands are nearly static); feet are planted by the ground solver.
const MOCAP_DIR = path.join(REPO, ".pipeline-tools", "mocap", "cmu");
const MOCAP_FPS = 120;

/** [our bone, CMU bone, our joint that defines the bone's direction (null = rotation only)]. */
const RETARGET = (() => {
  const map = [
    ["root", "root", null],
    ["spine05", "lowerback", "spine04"],
    ["spine04", "lowerback", "spine03"],
    ["spine03", "upperback", "spine02"],
    ["spine02", "thorax", "spine01"],
    ["spine01", "thorax", "neck01"],
    ["neck01", "lowerneck", "neck02"],
    ["neck02", "upperneck", "neck03"],
    ["neck03", "upperneck", "head"],
    ["head", "head", null],
  ];
  for (const [s, c] of [["L", "l"], ["R", "r"]]) {
    map.push([`clavicle.${s}`, `${c}clavicle`, `upperarm01.${s}`]);
    map.push([`upperarm01.${s}`, `${c}humerus`, `lowerarm01.${s}`]);
    map.push([`lowerarm01.${s}`, `${c}radius`, `wrist.${s}`]);
    map.push([`lowerarm02.${s}`, `${c}wrist`, `wrist.${s}`]);
    map.push([`wrist.${s}`, `${c}hand`, `finger3-1.${s}`]);
    map.push([`upperleg01.${s}`, `${c}femur`, `lowerleg01.${s}`]);
    map.push([`lowerleg01.${s}`, `${c}tibia`, `foot.${s}`]);
    map.push([`foot.${s}`, `${c}foot`, `toe3-1.${s}`]);
    for (const k of [1, 2, 3, 4, 5]) map.push([`toe${k}-1.${s}`, `${c}toes`, JOINTS.has(`toe${k}-2.${s}`) ? `toe${k}-2.${s}` : null]);
  }
  return map.filter(([t, , child]) => JOINTS.has(t) && (!child || JOINTS.has(child)));
})();
const OUR_LEG = restPos("root").y - restPos("toe3-1.L").y;
/** Root, pelvis and legs — what a `lower` source replaces (upper-body gestures over a calm stance). */
const LOWER_BODY = new Set(ORDER.filter((n) => n === "root" || /^(pelvis|upperleg|lowerleg|foot|toe)/.test(n)));

const mocapCache = new Map();
function loadMocap(trial) {
  if (!mocapCache.has(trial)) {
    const subject = trial.split("_")[0].padStart(2, "0");
    const asfFile = path.join(MOCAP_DIR, `${subject}.asf`);
    if (!fs.existsSync(asfFile)) throw new Error(`Motion capture missing — run: node tools/asset-pipeline/fetch_cmu_mocap.mjs (${trial})`);
    const asf = parseAsf(asfFile);
    const frames = solveMotion(asf, parseAmc(path.join(MOCAP_DIR, `${trial}.amc`)));
    const rest = restPositions(asf);
    const align = new Map();
    for (const [ours, theirs, child] of RETARGET) {
      const src = asf.bones.get(theirs);
      if (!child || !src) {
        align.set(ours, new THREE.Quaternion());
        continue;
      }
      const dOurs = restPos(child).sub(restPos(ours)).normalize();
      align.set(ours, new THREE.Quaternion().setFromUnitVectors(dOurs, src.direction));
    }
    const legScale = OUR_LEG / Math.max(0.3, -rest.get("ltoes").y);
    mocapCache.set(trial, { trial, frames, align, legScale });
  }
  return mocapCache.get(trial);
}

const smoothArray = (values, radius) =>
  values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k++) {
      sum += values[k];
      n++;
    }
    return sum / n;
  });

/**
 * A playable loop from source frames [from, to): faces +Z, stays in place (locomotion progress or
 * drift removed, natural sway kept), the end cross-faded into the start, feet on the floor.
 */
function mocapSegment(trial, { from, to, blend = 24, travel = false, ground: grounded = true, mirrorSides = false, lower = null, levelHead = true } = {}) {
  const src = loadMocap(trial);
  const frames = src.frames;
  const a = Math.max(from, blend);
  const b = Math.min(to, frames.length);
  // Heading: circular mean of where the pelvis faces.
  let sx = 0;
  let sz = 0;
  for (let i = a; i < b; i++) {
    const f = V(0, 0, 1).applyQuaternion(frames[i].rot.get("root"));
    sx += f.x;
    sz += f.z;
  }
  const heading = new THREE.Quaternion().setFromAxisAngle(Y, -Math.atan2(sx, sz));
  // Root trajectory in the heading frame; remove forward progress (linear trend) or drift (mean).
  const rootAt = (i) => frames[i].pos.get("root").clone().applyQuaternion(heading);
  const start = rootAt(a);
  const end = rootAt(b - 1);
  const meanX = Array.from({ length: b - a }, (_, k) => rootAt(a + k).x).reduce((x, y) => x + y, 0) / (b - a);
  const meanZ = Array.from({ length: b - a }, (_, k) => rootAt(a + k).z).reduce((x, y) => x + y, 0) / (b - a);
  const flatten = (i) => {
    const r = rootAt(i);
    const t = (i - a) / Math.max(1, b - 1 - a);
    if (travel) return V(r.x - (start.x + (end.x - start.x) * t), r.y, r.z - (start.z + (end.z - start.z) * t));
    return V(r.x - meanX, r.y, r.z - meanZ);
  };
  const frameAt = (i) => {
    const rot = new Map();
    for (const [name, q] of frames[i].rot) rot.set(name, heading.clone().multiply(q));
    // The performer's trunk line (hip joints → base of the neck), which our spine is matched to.
    const P = (n) => frames[i].pos.get(n);
    const trunk = P("thorax").clone().sub(P("lhipjoint").clone().add(P("rhipjoint")).multiplyScalar(0.5)).applyQuaternion(heading).normalize();
    return { rot, root: flatten(i), trunk };
  };
  // Seamless loop: the last `blend` frames ease into the frames that precede the start.
  const out = [];
  for (let i = a; i < b; i++) {
    const f = frameAt(i);
    const k = i - (b - blend);
    if (k >= 0) {
      const w = ease((k + 1) / blend);
      const g = frameAt(i - (b - a));
      for (const [name, q] of f.rot) q.slerp(g.rot.get(name), w);
      f.root.lerp(g.root, w);
      f.trunk.lerp(g.trunk, w).normalize();
    }
    out.push(f);
  }
  const segment = { src, frames: out, length: out.length, duration: out.length / MOCAP_FPS, grounded, mirrorSides, lift: null, heading, from: a, lower: null };
  if (lower) {
    segment.lower = mocapSegment(lower.trial, { from: lower.from, to: lower.from + out.length, blend: lower.blend ?? 30 });
    if (levelHead) segment.headFix = headLevelFix(segment);
    return segment; // footing comes from the lower segment
  }
  if (grounded) {
    // Ground: the typical contact level becomes the floor; penetrations are lifted (smoothed).
    const heights = out.map((_, i) => soleHeight(retargetFrame(segment, i)));
    const sorted = [...heights].sort((x, y) => x - y);
    const floor = sorted[Math.floor(sorted.length * 0.08)];
    const deficit = heights.map((h) => Math.max(0, floor - h));
    const spread = deficit.map((_, i) => Math.max(...deficit.slice(Math.max(0, i - 6), i + 7)));
    segment.lift = smoothArray(spread, 4).map((d) => d - floor);
  }
  if (levelHead) segment.headFix = headLevelFix(segment);
  return segment;
}

const HEAD_FORWARD_LOCAL = V(0, 0, 1).applyQuaternion(REST.get("head").q.clone().invert());
/**
 * Performers often look down at the floor or off to one side for a whole take; an avatar should
 * meet the viewer's eye. The clip's *average* gaze is levelled and centred; the head still moves
 * around it exactly as captured.
 */
function headLevelFix(segment) {
  let down = 0;
  let turn = 0;
  let n = 0;
  for (let i = 0; i < segment.length; i += 4) {
    const fwd = HEAD_FORWARD_LOCAL.clone().applyQuaternion(world(retargetFrame(segment, i)).get("head").q);
    down += -Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    turn += Math.atan2(fwd.x, fwd.z);
    n++;
  }
  return { down: -down / n, turn: -turn / n };
}

/** Our pose for segment frame `index` (integer). */
function retargetFrame(segment, index) {
  if (segment.lower) {
    // Upper body from this segment, root + legs (and footing) from the lower segment.
    const upper = retargetFrame({ ...segment, lower: null, lift: null }, index);
    const lower = retargetFrame(segment.lower, Math.min(segment.lower.length - 1, Math.round((index / segment.length) * segment.lower.length)));
    for (const name of LOWER_BODY) {
      if (lower.deltas.has(name)) upper.deltas.set(name, lower.deltas.get(name));
      else upper.deltas.delete(name);
    }
    upper.root.copy(lower.root);
    return upper;
  }
  const f = segment.frames[index];
  const p = new Pose();
  const worldQ = new Map();
  const byTarget = new Map(RETARGET.map(([ours, theirs]) => [ours, theirs]));
  for (const name of ORDER) {
    const j = JOINTS.get(name);
    const parentQ = j.parent ? worldQ.get(j.parent) : IDENTITY;
    let theirs = byTarget.get(name);
    if (theirs && segment.mirrorSides) theirs = theirs.replace(/^l(?=[a-z])/, "#").replace(/^r(?=[a-z])/, "l").replace(/^#/, "r");
    const M = theirs ? f.rot.get(theirs) : null;
    if (M) {
      const Mq = segment.mirrorSides ? new THREE.Quaternion(M.x, -M.y, -M.z, M.w) : M; // mirror across the YZ plane
      const Rw = Mq.clone().multiply(segment.src.align.get(name)).multiply(REST.get(name).q);
      p.deltas.set(name, j.r.clone().invert().multiply(parentQ.clone().invert().multiply(Rw)));
      worldQ.set(name, Rw);
    } else {
      worldQ.set(name, parentQ.clone().multiply(j.r));
    }
  }
  // Trunk match: CMU's spine starts at the pelvis centre, ~5 cm behind the hip joints, and its
  // segments have other lengths than ours — copying bone directions alone leaves our upper body
  // ~10° off the performer's. Swing the whole upper body (at spine05) so hips→neck lines up.
  if (f.trunk) {
    const w = fk(p.deltas);
    const hips = w.get("upperleg01.L").p.clone().add(w.get("upperleg01.R").p).multiplyScalar(0.5);
    const ours = w.get("neck01").p.clone().sub(hips).normalize();
    const trunk = segment.mirrorSides ? V(-f.trunk.x, f.trunk.y, f.trunk.z) : f.trunk;
    const swing = new THREE.Quaternion().setFromUnitVectors(ours, trunk);
    const spineParent = w.get(JOINTS.get("spine05").parent).q;
    const fixed = swing.multiply(w.get("spine05").q);
    p.deltas.set("spine05", JOINTS.get("spine05").r.clone().invert().multiply(spineParent.clone().invert().multiply(fixed)));
  }
  const scale = segment.src.legScale;
  const r = f.root.clone();
  if (segment.mirrorSides) r.x = -r.x;
  p.root.set(r.x * scale, r.y * scale - restPos("root").y, r.z * scale);
  if (segment.lift) p.root.y += segment.lift[index];
  return p;
}

/** Pose at loop phase `ph` ∈ [0, 1] (1 ≡ 0), interpolating between capture frames. */
function mocapPose(segment, ph) {
  const f = (((ph % 1) + 1) % 1) * segment.length;
  const i0 = Math.floor(f) % segment.length;
  const i1 = (i0 + 1) % segment.length;
  const w = f - Math.floor(f);
  const p0 = retargetFrame(segment, i0);
  if (w < 1e-6) {
    if (segment.headFix) head(p0, segment.headFix);
    return p0;
  }
  const p1 = retargetFrame(segment, i1);
  for (const [name, q] of p0.deltas) q.slerp(p1.deltas.get(name) ?? IDENTITY, w);
  p0.root.lerp(p1.root, w);
  if (segment.headFix) head(p0, segment.headFix);
  return p0;
}

// ──────────────────────────────────────────────────────────────────────────────── the clips ──
// Most clips are real human motion (CMU trials, see fetch_cmu_mocap.mjs), retargeted and looped
// above. Gestures with no good capture (clap, think, point, thumbs up) are a real idle capture with
// the arms posed on top by IK, so the body still breathes and shifts its weight like a person.
const IDLE = "77_02"; // calm standing, arms relaxed, subtle weight shifts
/** An idle capture segment of about `seconds`, starting at `from`, for layered gestures. */
const idleBase = (seconds, from = 60) => ({ trial: IDLE, from, to: from + Math.round(seconds * MOCAP_FPS), blend: 30 });

const CLIPS = [
  { id: "idle", name: "Idle", icon: "idle", fadeIn: 0.6, mocap: { trial: IDLE, from: 60, to: 586, blend: 40 } },
  // Wave: the performer's arm, shoulders and head; feet and hips from the calm idle stance (the wave
  // capture stands with the feet well ahead of the hips, which reads as leaning back).
  { id: "wave", name: "Wave", icon: "wave", fadeIn: 0.35, expression: "smile", mocap: { trial: "141_16", from: 50, to: 121, blend: 16, lower: { trial: "77_02", from: 200, blend: 30 } }, hands: { R: { curl: 0.05, thumb: 0.05, spread: 0.6 } } },
  { id: "walk", name: "Walk", icon: "walk", fadeIn: 0.35, mocap: { trial: "07_01", from: 40, to: 171, blend: 12, travel: true }, hands: { L: { curl: 0.45, thumb: 0.25 }, R: { curl: 0.45, thumb: 0.25 } } },
  { id: "run", name: "Run", icon: "run", fadeIn: 0.3, mocap: { trial: "35_17", from: 30, to: 119, blend: 10, travel: true }, hands: { L: { curl: 1.0, thumb: 0.6 }, R: { curl: 1.0, thumb: 0.6 } } },
  { id: "jump", name: "Jump", icon: "jump", fadeIn: 0.3, expression: "surprised", mocap: { trial: "13_39", from: 20, to: 320, blend: 30 }, hands: { L: { curl: 0.5, thumb: 0.3 }, R: { curl: 0.5, thumb: 0.3 } } },
  // The Macarena: one full arm sequence (the quarter turn at the end of a round is cut).
  { id: "dance", name: "Dance", icon: "dance", fadeIn: 0.35, expression: "smile", mocap: { trial: "143_35", from: 60, to: 596, blend: 48 }, hands: { L: { curl: 0.15, thumb: 0.1 }, R: { curl: 0.15, thumb: 0.1 } } },
  {
    id: "clap", name: "Clap", icon: "clap", fadeIn: 0.3, expression: "smile", mocap: idleBase(1.0),
    layer(p, ph) {
      // Two claps per loop: hands meet in front of the chest, palms facing, then open ~30 cm.
      const open = Math.pow(0.5 - 0.5 * Math.cos(TAU * 2 * ph), 0.8);
      const meet = at(p, "neck01").add(V(0, -0.21, 0.3));
      for (const s of ["L", "R"]) {
        const target = meet.clone().add(mirror(s, V(0.03 + 0.14 * open, 0.02 * open, -0.03 * open)));
        reach(p, s, target, { pole: mirror(s, V(0.45, -1, -0.2)), palm: mirror(s, V(-1, 0.05, 0)), fingers: mirror(s, V(-0.12, 0.5, 0.86)) });
        hand(p, s, { curl: 0.1, thumb: 0.1 });
      }
    },
  },
  { id: "laugh", name: "Laugh", icon: "laugh", fadeIn: 0.3, expression: "laugh", mocap: { trial: "79_70", from: 150, to: 643, blend: 40, levelHead: false } },
  {
    id: "think", name: "Think", icon: "think", fadeIn: 0.5, mocap: { trial: IDLE, from: 60, to: 586, blend: 40 },
    layer(p, ph) {
      // Right knuckles under the chin; the right elbow rests on the left forearm across the waist.
      head(p, { down: 0.08, turn: -0.08 + 0.04 * wave(ph, 1), tilt: 0.08 });
      const chin = at(p, "head", V(0, 1.43, 0.1));
      reach(p, "R", chin.clone().add(V(-0.015, -0.11, 0.06)), { pole: V(-0.1, -1, 0.15), palm: V(0.25, 0, -1) });
      hand(p, "R", { curl: 1.1, index: 0.35, thumb: 0.4 });
      wrist(p, "R", { flex: -0.15 });
      const elbow = at(p, "lowerarm01.R");
      reach(p, "L", elbow.add(V(0.03, -0.06, 0.02)), { pole: V(1, -0.6, -0.4), palm: V(0, 1, 0) });
      hand(p, "L", { curl: 0.45, thumb: 0.25 });
    },
  },
  { id: "celebrate", name: "Celebrate", icon: "celebrate", fadeIn: 0.3, expression: "laugh", mocap: { trial: "79_69", from: 370, to: 494, blend: 40 }, hands: { L: { curl: 1.2, thumb: 0.7 }, R: { curl: 1.2, thumb: 0.7 } } },
  {
    id: "point", name: "Point", icon: "point", fadeIn: 0.4, mocap: idleBase(3),
    layer(p, ph) {
      // Straight arm pointing forward and slightly to the avatar's right; index finger out.
      arm(p, "R", { dir: V(0.28, 0.06 + 0.02 * wave(ph, 1), 0.96), bend: 0.08, fold: V(-0.3, 0.2, 1), palm: V(-0.5, -1, 0), fingers: V(0.26, 0.1, 0.96) });
      hand(p, "R", { curl: 1.4, index: -0.05, thumb: 0.9 });
      head(p, { turn: -0.12 });
    },
  },
  {
    id: "thumbsUp", name: "Thumbs Up", icon: "thumbsUp", fadeIn: 0.4, expression: "smile", mocap: idleBase(3),
    layer(p, ph) {
      // Fist in front of the chest, thumb to the sky, a small "yes!" pulse.
      const fist = at(p, "neck01").add(V(-0.19, -0.31 + 0.012 * wave(ph, 2), 0.3));
      reach(p, "R", fist, { pole: V(-0.7, -1, -0.2), palm: V(1, 0, 0), fingers: V(0.15, 0.15, 1) });
      hand(p, "R", { curl: 1.5, thumb: -0.3 });
    },
  },
  { id: "sit", name: "Sit", icon: "sit", fadeIn: 0.8, mocap: { trial: "13_01", from: 700, to: 850, blend: 24 }, prop: "stool" },
];

// ─────────────────────────────────────────────────────────────────────────── sample & write ──
const round = (v) => Math.round(v * 10000) / 10000;
/** Quaternion components to 1e-3 (≤ 0.1° error): mocap tracks are dense, the file loads with the editor. */
const roundQ = (v) => Math.round(v * 1000) / 1000;

// --loop=TRIAL:from:minLen:maxLen  → the best loop ends for a segment starting at `from`: the
// frames whose pose (all bones, pelvis height and velocity) is closest to the start's.
const loopArg = process.argv.find((a) => a.startsWith("--loop="));
if (loopArg) {
  const [trial, from, minLen, maxLen] = loopArg.split("=")[1].split(":");
  const frames = loadMocap(trial).frames;
  const a = Number(from);
  const bones = [...frames[a].rot.keys()].filter((n) => n !== "root");
  const vel = (i) => frames[Math.min(frames.length - 1, i + 1)].pos.get("root").y - frames[Math.max(0, i - 1)].pos.get("root").y;
  const scored = [];
  for (let b = a + Number(minLen); b <= Math.min(frames.length - 1, a + Number(maxLen)); b++) {
    let d = 0;
    for (const n of bones) d += frames[a].rot.get(n).angleTo(frames[b].rot.get(n));
    d += Math.abs(frames[a].pos.get("root").y - frames[b].pos.get("root").y) * 20 + Math.abs(vel(a) - vel(b)) * 200;
    scored.push([d, b]);
  }
  scored.sort((x, y) => x[0] - y[0]);
  console.log(`${trial} from ${a} (${frames.length} frames): best ends`, scored.slice(0, 6).map(([d, b]) => `${b} (len ${b - a}, d ${d.toFixed(2)})`).join(", "));
  process.exit(0);
}

// --inspect=TRIAL:frame,frame…  → source vs retargeted body lines (trunk, legs) for debugging.
const inspectArg = process.argv.find((a) => a.startsWith("--inspect="));
if (inspectArg) {
  const [trial, list] = inspectArg.split("=")[1].split(":");
  const src = loadMocap(trial);
  const seg = mocapSegment(trial, { from: 0, to: src.frames.length, blend: 1 });
  const fmt = (v) => v.toArray().map((x) => x.toFixed(2)).join(",");
  for (const i of list.split(",").map(Number)) {
    const f = seg.frames[i];
    const w = world(retargetFrame(seg, i));
    const ours = (n) => w.get(n).p;
    const hipsO = ours("upperleg01.L").clone().add(ours("upperleg01.R")).multiplyScalar(0.5);
    const feetO = ours("foot.L").clone().add(ours("foot.R")).multiplyScalar(0.5);
    const neckO = ours("neck01");
    const raw = src.frames[i + seg.from];
    const H = (n) => raw.pos.get(n).clone().applyQuaternion(seg.heading);
    const hipsS = H("lhipjoint").add(H("rhipjoint")).multiplyScalar(0.5);
    const feetS = H("ltibia").add(H("rtibia")).multiplyScalar(0.5);
    const neckS = H("thorax");
    const dir = (a, b) => b.clone().sub(a).normalize();
    console.log(`#${i} source trunk ${fmt(dir(hipsS, neckS))} legs ${fmt(dir(feetS, hipsS))} | ours trunk ${fmt(dir(hipsO, neckO))} legs ${fmt(dir(feetO, hipsO))}`);
    void f;
  }
  process.exit(0);
}

// --preview=TRIAL[:from:to]  → a library with one clip "preview" showing raw retargeted capture
// (no loop blending), for choosing segments with qa_animation_sheets.mjs. Rebuild normally after.
const previewArg = process.argv.find((a) => a.startsWith("--preview="));
if (previewArg) {
  const [trial, from, to] = previewArg.split("=")[1].split(":");
  const total = loadMocap(trial).frames.length;
  const seg = mocapSegment(trial, { from: Number(from ?? 0), to: Number(to ?? total), blend: 1 });
  CLIPS.length = 0;
  CLIPS.push({ id: "preview", name: `Preview ${trial}`, icon: "idle", duration: Math.round(seg.duration * 100) / 100, pose: (ph) => mocapPose(seg, ph * (1 - 1 / seg.length)) });
  console.log(`preview ${trial}: frames ${from ?? 0}–${to ?? total} of ${total} (${seg.duration.toFixed(2)} s)`);
}

const RELAXED_HANDS = { L: { curl: 0.35, thumb: 0.2 }, R: { curl: 0.35, thumb: 0.2 } };
for (const clip of CLIPS) {
  if (!clip.mocap) continue;
  const segment = mocapSegment(clip.mocap.trial, clip.mocap);
  clip.duration = Math.round(segment.duration * 1000) / 1000;
  const hands = { ...RELAXED_HANDS, ...(clip.hands ?? {}) };
  clip.pose = (ph) => {
    const p = mocapPose(segment, ph);
    for (const side of ["L", "R"]) hand(p, side, hands[side]);
    clip.layer?.(p, ph);
    return p;
  };
  if (clip.prop === "stool") {
    // Seat for the viewer's stool: under the hip joints at their lowest, minus the thighs' thickness.
    let y = Infinity;
    let z = 0;
    for (let i = 0; i < segment.length; i += 4) {
      const w = world(retargetFrame(segment, i));
      const hip = w.get("upperleg01.L").p.clone().add(w.get("upperleg01.R").p).multiplyScalar(0.5);
      if (hip.y < y) {
        y = hip.y;
        z = hip.z;
      }
    }
    clip.propData = { kind: "stool", seatHeight: Math.round((y - 0.1) * 1000) / 1000, seatZ: Math.round((z - 0.04) * 1000) / 1000 };
  }
}

const clips = CLIPS.map((clip) => {
  const frames = Math.round(clip.duration * FPS) + 1;
  const poses = [];
  currentClip = clip.id;
  for (let i = 0; i < frames; i++) poses.push(clip.pose(i / (frames - 1))); // last frame == first → seamless loop
  const bones = [...new Set(poses.flatMap((p) => [...p.deltas.keys()]))].sort();
  const tracks = {};
  for (const bone of bones) {
    const values = [];
    let prev = null;
    for (const p of poses) {
      const q = (p.deltas.get(bone) ?? IDENTITY).clone().normalize();
      // Keep consecutive quaternions in the same hemisphere so interpolation takes the short path.
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev = q;
      values.push(roundQ(q.x), roundQ(q.y), roundQ(q.z), roundQ(q.w));
    }
    // Near-constant (within ~0.2°) collapses to one key.
    const constant = values.every((v, i) => Math.abs(v - values[i % 4]) <= 0.002);
    tracks[bone] = constant ? values.slice(0, 4) : values;
  }
  const rootValues = poses.flatMap((p) => [p.root.x, p.root.y, p.root.z].map(round));
  const rootConstant = rootValues.every((v, i) => v === rootValues[i % 3]);
  const root = rootConstant ? (rootValues.slice(0, 3).every((v) => v === 0) ? [] : rootValues.slice(0, 3)) : rootValues;
  return {
    id: clip.id,
    name: clip.name,
    icon: clip.icon,
    duration: clip.duration,
    loop: true,
    fadeIn: clip.fadeIn ?? 0.35,
    expression: clip.expression ?? null,
    ...(clip.mocap ? { source: `CMU ${clip.mocap.trial}` } : {}),
    ...(clip.propData ? { prop: clip.propData } : {}),
    frames,
    tracks,
    root,
  };
});

const library = {
  $comment: "GENERATED by tools/asset-pipeline/build_animation_clips.mjs — edit the clip table there, not this file. Motion capture: mocap.cs.cmu.edu (created with funding from NSF EIA-0196217).",
  version: 3,
  fps: FPS,
  space: "bone-local rotation deltas (final = rest * delta); root = armature-space translation delta in meters. A track of exactly 4 values (root: 3) is constant for the whole clip.",
  clips,
};

fs.writeFileSync(OUT, JSON.stringify(library));
console.log("calibrated signs:", JSON.stringify(SIGN));
for (const warning of QA.twist) console.warn("QA:", warning);
console.log(`wrote ${OUT} — ${clips.length} clips, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
