// Shared glTF helpers for the asset pipeline scripts.

const mul4 = (a, b) => {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return r;
};

function invertAffine(m) {
  // Affine inverse (upper 3x3 + translation), column-major.
  const [a, b, c, , d, e, f, , g, h, i, , tx, ty, tz] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const inv3 = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
  const t = [
    -(inv3[0] * tx + inv3[3] * ty + inv3[6] * tz),
    -(inv3[1] * tx + inv3[4] * ty + inv3[7] * tz),
    -(inv3[2] * tx + inv3[5] * ty + inv3[8] * tz),
  ];
  return [inv3[0], inv3[1], inv3[2], 0, inv3[3], inv3[4], inv3[5], 0, inv3[6], inv3[7], inv3[8], 0, t[0], t[1], t[2], 1];
}

function rewrite(attribute, fn) {
  const count = attribute.getCount();
  const size = attribute.getElementSize();
  const out = new Float32Array(count * size);
  const el = [];
  for (let i = 0; i < count; i++) {
    attribute.getElement(i, el); // decodes normalized/quantized integers
    const v = fn(el);
    for (let k = 0; k < size; k++) out[i * size + k] = v[k] ?? el[k];
  }
  attribute.setArray(out).setNormalized(false);
}

/**
 * meshopt quantization folds a scale/offset "bind shape" into the inverse bind matrices of skinned
 * meshes. three.js doesn't care, but Blender's importer builds the armature's rest pose from those
 * IBMs — so a quantized body and an unquantized shirt end up with DIFFERENT rest skeletons and
 * can't share one armature (the API's assemble step re-targets every attachment onto the body's).
 * This bakes the bind shape back into the vertices (positions: full transform; morph deltas and
 * normals: linear part only) and resets each IBM to inverse(joint world) — the canonical form.
 */
export function bakeBindShape(doc) {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices();
    const bindShape = mul4(joints[0].getWorldMatrix(), ibm.getElement(0, []));
    const identity = bindShape.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);
    if (identity) continue;

    const m = bindShape;
    const linear = (v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
    const affine = (v) => {
      const r = linear(v);
      return [r[0] + m[12], r[1] + m[13], r[2] + m[14]];
    };
    const direction = (v) => {
      const r = linear(v);
      const len = Math.hypot(r[0], r[1], r[2]) || 1;
      return [r[0] / len, r[1] / len, r[2] / len];
    };
    const scale = Math.cbrt(Math.abs(m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])));
    const deltaNormal = (v) => linear(v).map((c) => c / scale);

    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute("POSITION")) rewrite(prim.getAttribute("POSITION"), affine);
      if (prim.getAttribute("NORMAL")) rewrite(prim.getAttribute("NORMAL"), direction);
      for (const target of prim.listTargets()) {
        if (target.getAttribute("POSITION")) rewrite(target.getAttribute("POSITION"), linear);
        if (target.getAttribute("NORMAL")) rewrite(target.getAttribute("NORMAL"), deltaNormal);
      }
    }
    const inverse = invertAffine(bindShape);
    const baked = new Float32Array(joints.length * 16);
    joints.forEach((_, j) => baked.set(mul4(ibm.getElement(j, []), inverse), j * 16));
    ibm.setArray(baked);
    console.log(`  baked bind shape of ${mesh.getName()} (scale ${scale.toFixed(4)})`);
  }
}
