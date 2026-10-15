// Her dog: a little white Pomeranian - a puffball of stand-off fur, a huge lion's ruff
// framing a small fox face (dark eyes, black button nose, a smiling mouth), little pointed
// ears peeking out of the fluff, a plumed tail fanned flat over its back, tiny feet. It
// waits with the cat where she lands, greets her with zoomies, trots along beside them
// and sits with her, showing off its tricks.
//
// Built like the cat (one skinned mesh with sculpted tufts, a second with layers of
// strands, the face painted in the shader), on the same kind of skeleton.
import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { contactShadow } from './character.js';
import { heightAt } from './world.js';
import { clamp, lerp, smoothstep, TAU } from './math.js';
import { CatBuilder, ellipsoidAt, tubeAt, vnoise, hexc, mix3, bump, ragged, ik2, rotX, mulberry, wrapA, approachA } from './cat.js';

export const DOG_SCALE = 1.16;
// how far the outer layers of the coat reach, as a share of each part's fur length
const SHELL_LEN = 0.56;

const COL = {
  white: hexc('#fbf8f1'),
  whiteW: hexc('#f8f1e4'),
  cream: hexc('#f6ead6'),
  creamD: hexc('#eddcc0'),
  inner: hexc('#f0c4b6'),
  pad: hexc('#4a3a37'),
  nose: hexc('#211b1b'),
  tongue: hexc('#f08f9a'),
};

// ---------------------------------------------------------------------------
// Proportions: a round little body on short legs, a big ruff, a small head with a short
// pointed muzzle
const HC = new THREE.Vector3(0, 0.302, 0.156); // head (skull) centre
const HEAD_R = [0.07, 0.064, 0.066];
const hp = (x, y, z) => new THREE.Vector3(HC.x + x, HC.y + y, HC.z + z);
const MZC = hp(0, -0.026, 0.054); // muzzle centre
const MZR = [0.025, 0.021, 0.033];

// Skeleton (bind pose: all rotations zero). +z forward, +x its left, y up. (The same bones,
// in the same order, as the cat's - its breathing and gait read them by index.)
const E0 = [0.036, HC.y + 0.05, HC.z - 0.02];
export const BONES = [
  ['root', -1, 0, 0, 0],
  ['hips', 0, 0, 0.152, -0.082],
  ['chest', 1, 0, 0.162, 0.048],
  ['neck', 2, 0, 0.215, 0.098],
  ['head', 3, HC.x, HC.y, HC.z],
  ['earL', 4, E0[0], E0[1], E0[2]],
  ['earR', 4, -E0[0], E0[1], E0[2]],
  ['shL', 2, 0.044, 0.15, 0.082], ['elL', 7, 0.044, 0.087, 0.087], ['pwFL', 8, 0.044, 0.03, 0.098],
  ['shR', 2, -0.044, 0.15, 0.082], ['elR', 10, -0.044, 0.087, 0.087], ['pwFR', 11, -0.044, 0.03, 0.098],
  ['hipL', 1, 0.05, 0.14, -0.1], ['knL', 13, 0.052, 0.086, -0.083], ['pwBL', 14, 0.052, 0.03, -0.106],
  ['hipR', 1, -0.05, 0.14, -0.1], ['knR', 16, -0.052, 0.086, -0.083], ['pwBR', 17, -0.052, 0.03, -0.106],
];
// the plume: set high on the rump, curling up and forward to lie flat along its back
const TAIL_N = 6;
const TP0 = new THREE.Vector3(0, 0.198, -0.128), TP1 = new THREE.Vector3(0, 0.31, -0.15), TP2 = new THREE.Vector3(0, 0.288, -0.025);
function tailAt(t, out = new THREE.Vector3()) {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return out.set(TP0.x * a + TP1.x * b + TP2.x * c, TP0.y * a + TP1.y * b + TP2.y * c, TP0.z * a + TP1.z * b + TP2.z * c);
}
function tailTan(t, out = new THREE.Vector3()) {
  return out.set(2 * (1 - t) * (TP1.x - TP0.x) + 2 * t * (TP2.x - TP1.x), 2 * (1 - t) * (TP1.y - TP0.y) + 2 * t * (TP2.y - TP1.y), 2 * (1 - t) * (TP1.z - TP0.z) + 2 * t * (TP2.z - TP1.z)).normalize();
}
for (let i = 0; i < TAIL_N; i++) {
  const p = tailAt(i / TAIL_N);
  BONES.push([`tail${i}`, i === 0 ? 1 : BONES.length - 1, p.x, p.y, p.z]);
}
const BI = {};
BONES.forEach((b, i) => { BI[b[0]] = i; });
const bpos = (n) => { const b = BONES[BI[n]]; return [b[2], b[3], b[4]]; };

// head surface (before fur): a small round skull, a little broader at the cheeks
function headShape(nx, ny, nz) {
  const rx = HEAD_R[0] * (1 + 0.1 * smoothstep(0.2, -0.5, ny) * smoothstep(0.9, 0.2, nz));
  const ry = HEAD_R[1] * (ny > 0 ? 0.94 : 1);
  const rz = HEAD_R[2] * (nz > 0 ? 0.95 : 1.02);
  return [HC.x + nx * rx, HC.y + ny * ry, HC.z + nz * rz];
}
// the muzzle: short and tapering to the nose (a fox's), its bridge rising into the brow
function muzzleShape(nx, ny, nz) {
  const f = Math.max(0, nz);
  const rx = MZR[0] * (1 - 0.42 * f * f), ry = MZR[1] * (1 - 0.26 * f * f) * (ny > 0 ? 1.05 : 0.92);
  const rz = MZR[2] * (nz > 0 ? 1 : 0.8);
  // (the bridge of the nose slopes up toward the forehead)
  const up = 0.006 * smoothstep(0.3, -0.6, nz) * Math.max(0, ny);
  return [MZC.x + nx * rx, MZC.y + ny * ry + up, MZC.z + nz * rz];
}
const NOSE_C = hp(0, -0.0195, 0.0905);
const MOUTH_C = hp(0, -0.0325, 0.0855);
// the tongue: a little pink tongue that comes out when it pants or smiles (it shrinks to
// nothing inside the muzzle when the mouth is closed)
const TONGUE_ROOT = hp(0, -0.036, 0.064);
const TONGUE_C = hp(0, -0.044, 0.081);
// eyes: dark, set into the face above the muzzle
const EYE_R = 0.019, EYE_OPEN = 0.0138, EYE_K = 0.74;
function eyePlacement(side) {
  const d = new THREE.Vector3(side * 0.4, 0.1, 0.91).normalize();
  const s = headShape(d.x, d.y, d.z);
  const surf = new THREE.Vector3(...s);
  const n = new THREE.Vector3((s[0] - HC.x) / (HEAD_R[0] * HEAD_R[0]), (s[1] - HC.y) / (HEAD_R[1] * HEAD_R[1]), (s[2] - HC.z) / (HEAD_R[2] * HEAD_R[2])).normalize();
  const depth = Math.sqrt(EYE_R * EYE_R - EYE_OPEN * EYE_OPEN);
  const c = surf.clone().addScaledVector(n, -depth);
  const ax = new THREE.Vector3(side * 0.28, 0.08, 1).normalize();
  return { c, ax };
}
const EYE_L = eyePlacement(1), EYE_R2 = eyePlacement(-1);
// (no fur over the eyes: it thins to nothing round them)
const eyeClear = (p) => {
  const d = Math.min(Math.hypot(p[0] - EYE_L.c.x, p[1] - EYE_L.c.y, p[2] - EYE_L.c.z), Math.hypot(p[0] - EYE_R2.c.x, p[1] - EYE_R2.c.y, p[2] - EYE_R2.c.z));
  return smoothstep(EYE_R * 1.05, EYE_R * 1.9, d);
};

// ---------------------------------------------------------------------------
export function dogGeometry(quality = 'high') {
  const q = quality === 'low' ? 0.72 : 1;
  const B = new CatBuilder(q);
  const head = () => [[BI.head, 1]];
  const CK = [0.046, HC.y - 0.028, HC.z + 0.016];
  const OCC = [
    { name: 'torso', c: [0, 0.158, -0.02], r: [0.075, 0.07, 0.125] },
    { name: 'ruff', c: [0, 0.232, 0.095], r: [0.08, 0.09, 0.07] },
    { name: 'head', c: [HC.x, HC.y, HC.z], r: HEAD_R, k: 0.8 },
    { name: 'muzzle', c: [MZC.x, MZC.y, MZC.z], r: MZR, k: 0.5 },
    { name: 'hauL', c: [0.05, 0.128, -0.098], r: [0.036, 0.05, 0.05] },
    { name: 'hauR', c: [-0.05, 0.128, -0.098], r: [0.036, 0.05, 0.05] },
  ];
  // (white all over, the faintest cream along its back and in the plume)
  const backCream = (p, n) => smoothstep(0.35, 0.95, n[1]) * smoothstep(0.17, 0.23, p[1]) * 0.35;

  // --- body: short and round, under a long stand-off coat ---
  B.part(52, 40, (u, v) => {
    const a = v * Math.PI;
    const z = -0.02 - 0.122 * Math.cos(a);
    const s = Math.sin(a), ph = u * TAU;
    const rx = 0.07 + 0.008 * bump(v, 0.3, 0.22) + 0.006 * bump(v, 0.72, 0.2);
    const ry = 0.066 + 0.008 * bump(v, 0.72, 0.25);
    const cy = 0.158 + 0.008 * bump(v, 0.75, 0.3);
    const c = Math.cos(ph);
    return [s * rx * Math.sin(ph), cy + s * ry * c * (c < 0 ? 0.92 : 1), z];
  }, {
    occ: 'torso', seed: 211, cell: 0.034, axis: [0, 0, 1], stretch: 1.6, nrmK: 0.28, inflate: 0.3,
    L: (p, n) => 0.038 + 0.016 * smoothstep(0.1, -0.7, n[1]) + 0.006 * smoothstep(0.2, 0.9, Math.abs(n[0])),
    // (a stand-off coat: the fur stands out from the body, combed only a little back; under
    // the belly it hangs down in a skirt over the tops of the legs)
    comb: (p, n) => [n[0] * 0.6, n[1] * 0.4 - 0.25 - 0.5 * smoothstep(0.0, -0.7, n[1]), -0.65],
    color: (p, n) => mix3(COL.white, COL.cream, backCream(p, n)),
    bones: (p) => { const w = smoothstep(-0.08, 0.06, p[2]); return [[BI.hips, 1 - w], [BI.chest, w]]; },
  });

  // --- the ruff: a great mane of long fur round the neck and chest, framing the face ---
  B.part(44, 34, ellipsoidAt(null, null, 'y', (nx, ny, nz) => {
    const push = 0.02 * smoothstep(0.1, -0.7, ny) * Math.max(0, nz);
    // (widest about the face, like a lion's mane, narrowing toward the chest)
    return [nx * 0.08 * (1 + 0.12 * bump(ny, 0.3, 0.45) - 0.1 * smoothstep(-0.2, -0.9, ny)), 0.232 + ny * 0.09, 0.095 + nz * 0.07 + push];
  }), {
    occ: 'ruff', seed: 221, cell: 0.034, axis: [0, 1, 0], stretch: 1.7, nrmK: 0.3, inflate: 0.32,
    // (long all round and longest in the bib under the chin; short where it lies under the
    // face, over the top behind the head - the head's own fur makes the round there - and low
    // on the sides and behind, where it meets the body)
    L: (p, n) => (0.052 + 0.024 * Math.max(0, n[2]) * smoothstep(0.3, -0.5, n[1]) + 0.016 * Math.abs(n[0]) * bump(n[1], 0.2, 0.5))
      * (1 - 0.85 * smoothstep(0.15, 0.55, n[1]) * smoothstep(0.1, 0.5, n[2])) * (1 - 0.5 * smoothstep(0.3, 0.85, n[1]))
      * (1 - 0.32 * smoothstep(-0.2, -0.8, n[1]) * (1 - Math.max(0, n[2]))),
    comb: (p, n) => [n[0] * 0.75, -0.55 + 0.3 * n[1], 0.25 * n[2] - 0.35],
    color: (p, n) => mix3(COL.white, COL.cream, smoothstep(0.5, 1, n[1]) * smoothstep(0.0, -0.7, n[2]) * 0.3),
    bones: (p) => { const w = smoothstep(0.23, 0.3, p[1]) * 0.55; return [[BI.chest, 1 - w], [BI.neck, w]]; },
  });

  // --- head: small and round, fluffy at the back and cheeks, short fur on the face ---
  B.part(46, 36, ellipsoidAt(null, null, 'y', headShape), {
    occ: 'head', seed: 231, cell: 0.018, axis: [0, 0, 1], stretch: 1.6, nrmK: 0.36,
    L: (p, n) => {
      const front = smoothstep(0.35, 0.8, n[2]);
      return (lerp(0.024, 0.0035, front) + 0.018 * smoothstep(0.2, 0.8, Math.abs(n[0])) * smoothstep(0.4, -0.4, n[1]) * (1 - front)) * eyeClear(p);
    },
    comb: (p, n) => [n[0] * 0.9, -0.2 + 0.2 * n[1], -1],
    color: (p, n) => mix3(COL.white, COL.cream, smoothstep(0.6, 1, n[1]) * smoothstep(0.6, -0.2, n[2]) * 0.4),
    bones: head,
  });

  // --- cheeks: soft fluff below and behind the eyes ---
  for (const sx of [1, -1]) {
    B.part(26, 20, ellipsoidAt([sx * CK[0], CK[1], CK[2]], [0.032, 0.03, 0.033]), {
      seed: 241 + sx, cell: 0.017, axis: [0, 1, 0], stretch: 1.7, nrmK: 0.36, occ: 'head',
      L: (p, n) => (0.015 + 0.018 * Math.max(0, sx * n[0]) * smoothstep(0.5, -0.5, n[1])) * eyeClear(p),
      comb: () => [sx * 0.9, -0.6, -0.6],
      color: () => COL.white,
      bones: head,
    });
  }

  // --- muzzle: short, pointed, velvety ---
  B.part(26, 20, ellipsoidAt(null, null, 'z', muzzleShape), {
    kind: 4, furry: 0.55, occ: 'muzzle', seed: 236, cell: 0.008, inflate: 0.6, nrmK: 0.3,
    L: (p, n) => 0.0028 * smoothstep(0.95, 0.6, n[2]), comb: () => [0, 0, -1],
    color: (p) => mix3(COL.white, COL.whiteW, smoothstep(MZC.y + 0.01, MZC.y - 0.02, p[1]) * 0.6),
    bones: head,
  });
  // --- nose: a black button ---
  B.part(18, 14, ellipsoidAt(null, null, 'y', (nx, ny, nz) => [
    NOSE_C.x + nx * 0.0112 * (0.82 + 0.25 * clamp(ny + 0.2, -1, 1)), NOSE_C.y + ny * 0.0086, NOSE_C.z + nz * 0.0078 - 0.0012 * ny * ny,
  ]), { kind: 3, furry: 0, occ: 'muzzle', color: () => COL.nose, bones: head });
  // --- tongue (folded away inside the muzzle until it pants) ---
  B.part(16, 12, ellipsoidAt(null, null, 'z', (nx, ny, nz) => [
    TONGUE_C.x + nx * 0.0105 * (1 - 0.2 * Math.max(0, nz)), TONGUE_C.y + ny * 0.0034 - 0.004 * Math.max(0, nz) * Math.max(0, nz), TONGUE_C.z + nz * 0.0165,
  ]), { kind: 6, furry: 0, color: () => COL.tongue, bones: head });
  // --- eyes ---
  for (const [E, kind] of [[EYE_L, 1], [EYE_R2, 2]]) {
    const c = E.c;
    B.part(22, 16, ellipsoidAt([c.x, c.y, c.z], [EYE_R, EYE_R, EYE_R]), { kind, furry: 0, occ: 'head', color: () => COL.white, bones: head });
  }
  // --- ears: little pointed triangles standing up out of the fluff, cream outside, pink
  // inside with white tufts ---
  for (const sx of [1, -1]) {
    const A0 = new THREE.Vector3(sx * E0[0], E0[1] - 0.012, E0[2]), A1 = new THREE.Vector3(sx * 0.053, HC.y + 0.097, HC.z - 0.03);
    const up = A1.clone().sub(A0); const len = up.length(); up.normalize();
    const fw = new THREE.Vector3(sx * 0.45, 0.05, 1); fw.addScaledVector(up, -fw.dot(up)).normalize();
    const sd = new THREE.Vector3().crossVectors(up, fw).normalize();
    const W0 = 0.028;
    const earAt = (u, v) => {
      const t = lerp(-0.2, 1, v);
      const th = u * TAU;
      // (a pointed tip: straight sides narrowing to it)
      const w = Math.max(0, W0 * (1 - t));
      const d = 0.011 * (1 - t) + 0.0015;
      const cs = Math.cos(th), sn = Math.sin(th);
      const f = sn > 0 ? -0.3 * sn * d : sn * d;
      const x = cs * w, z = f;
      const c = A0.clone().addScaledVector(up, t * len);
      return [c.x + sd.x * x + fw.x * z, c.y + sd.y * x + fw.y * z, c.z + sd.z * x + fw.z * z];
    };
    const inner = (p, n) => {
      const r = new THREE.Vector3(p[0] - A0.x, p[1] - A0.y, p[2] - A0.z);
      const t = r.dot(up) / len, x = r.dot(sd);
      const w = Math.max(1e-3, W0 * (1 - t));
      const front = n[0] * fw.x + n[1] * fw.y + n[2] * fw.z;
      return smoothstep(0.1, 0.4, front) * smoothstep(0.85, 0.5, Math.abs(x) / w) * smoothstep(0.85, 0.65, t) * smoothstep(-0.05, 0.1, t);
    };
    B.part(20, 16, earAt, {
      seed: 251 + sx, cell: 0.009, axis: [up.x, up.y, up.z], stretch: 2.2, inflate: 0.2, shear: 1.0, nrmK: 0.3,
      L: (p, n) => 0.007 + 0.011 * inner(p, n),
      comb: () => [up.x + fw.x * 0.6, up.y + fw.y * 0.6, up.z + fw.z * 0.6],
      color: (p, n, h) => mix3(COL.cream, mix3(COL.inner, COL.white, h * 0.8), inner(p, n)),
      bones: (p) => {
        const t = clamp((p[1] - A0.y) / (A1.y - A0.y), 0, 1);
        const w = smoothstep(0.0, 0.3, t);
        return [[sx > 0 ? BI.earL : BI.earR, w], [BI.head, 1 - w]];
      },
    });
  }

  // paws: little round feet, white fur over the top, dark pads beneath
  const pawFur = (p, n) => (0.006 + 0.004 * smoothstep(0.35, 0.85, n[2])) * smoothstep(-0.5, 0.05, n[1]);
  const pawColor = (p, n) => mix3(COL.white, COL.pad, smoothstep(-0.8, -0.96, n[1]) * 0.85);
  const foot = (cx, cy, cz) => ellipsoidAt(null, null, 'y', (nx, ny, nz) => {
    const toes = 0.12 * Math.max(0, nz) * Math.pow(Math.abs(Math.cos(Math.atan2(nx, nz) * 3.2)), 3) * smoothstep(-0.5, 0.3, ny);
    const k = 1 + toes;
    return [cx + nx * 0.018 * k, cy + ny * 0.016 * (ny < 0 ? 0.6 : 1), cz + nz * 0.022 * k];
  });
  // --- front legs: slim, feathered behind ---
  for (const sx of [1, -1]) {
    const s = sx > 0 ? 'L' : 'R';
    const top = [sx * 0.044, 0.158, 0.08], bot = [sx * 0.044, 0.03, 0.096];
    B.part(16, 14, tubeAt(top, bot, (t) => 0.018 - 0.004 * t, false, true), {
      seed: 261 + sx, cell: 0.014, axis: [0, 1, 0], stretch: 2.2, inflate: 0.45,
      L: (p, n) => 0.012 + 0.024 * smoothstep(0.1, -0.8, n[2]) * smoothstep(0.03, 0.08, p[1]),
      comb: () => [0, -0.8, -0.6],
      color: () => COL.white,
      bones: (p) => { const w = smoothstep(0.07, 0.1, p[1]); return [[BI['el' + s], 1 - w], [BI['sh' + s], w]]; },
    });
    B.part(20, 14, foot(sx * 0.044, 0.017, 0.108), {
      seed: 271 + sx, cell: 0.01, L: pawFur, comb: () => [0, -0.55, 1], inflate: 0.45, stretch: 1.6, nrmK: 0.35,
      color: pawColor, bones: () => [[BI['pwF' + s], 1]],
    });
  }
  // --- hind legs: fluffy "pantaloons", slim lower legs ---
  for (const sx of [1, -1]) {
    const s = sx > 0 ? 'L' : 'R';
    B.part(32, 26, ellipsoidAt([sx * 0.05, 0.128, -0.098], [0.036, 0.05, 0.05]), {
      occ: sx > 0 ? 'hauL' : 'hauR', seed: 281 + sx, cell: 0.026, axis: [0, 1, 0], stretch: 1.8, nrmK: 0.3, inflate: 0.36,
      L: (p, n) => 0.032 + 0.02 * smoothstep(0.1, -0.8, n[2]) + 0.01 * smoothstep(0.2, -0.7, n[1]),
      comb: () => [0, -0.9, -0.55],
      color: () => COL.white,
      bones: (p) => { const w = smoothstep(0.15, 0.19, p[1]) * 0.7; return [[BI['hip' + s], 1 - w], [BI.hips, w]]; },
    });
    B.part(14, 12, tubeAt([sx * 0.052, 0.094, -0.086], [sx * 0.052, 0.03, -0.1], (t) => 0.016 - 0.002 * t, false, true), {
      seed: 291 + sx, cell: 0.014, axis: [0, 1, 0], inflate: 0.45,
      L: (p, n) => 0.009 + 0.015 * smoothstep(0.1, -0.8, n[2]), comb: () => [0, -1, -0.4],
      color: () => COL.white,
      bones: (p) => { const w = smoothstep(0.07, 0.09, p[1]); return [[BI['kn' + s], 1 - w], [BI['hip' + s], w]]; },
    });
    B.part(20, 14, foot(sx * 0.052, 0.017, -0.092), {
      seed: 301 + sx, cell: 0.01, L: pawFur, comb: () => [0, -0.55, 1], inflate: 0.45, stretch: 1.6, nrmK: 0.35,
      color: pawColor, bones: () => [[BI['pwB' + s], 1]],
    });
  }

  // --- the plume: a curling tail, its long fur fanned out to both sides over the back ---
  {
    const P = new THREE.Vector3(), T = new THREE.Vector3(), S1 = new THREE.Vector3(), S2 = new THREE.Vector3();
    const rf = (t) => 0.016 + 0.015 * smoothstep(0.0, 0.35, t) - 0.009 * smoothstep(0.65, 1, t);
    const at = (u, v) => {
      // (round caps at both ends)
      const t = lerp(-0.06, 1.06, v);
      const tc = clamp(t, 0, 1);
      tailAt(tc, P); tailTan(tc, T);
      S1.set(1, 0, 0); S2.crossVectors(T, S1).normalize();
      const over = t < 0 ? -t / 0.06 : t > 1 ? (t - 1) / 0.06 : 0;
      const r = rf(tc) * Math.sqrt(Math.max(0, 1 - over * over));
      const ph = u * TAU;
      const ext = (t < 0 ? -1 : t > 1 ? 1 : 0) * over * rf(tc) * 0.85;
      return [P.x + T.x * ext + S1.x * Math.cos(ph) * r + S2.x * Math.sin(ph) * r * 0.85, P.y + T.y * ext + S1.y * Math.cos(ph) * r + S2.y * Math.sin(ph) * r * 0.85, P.z + T.z * ext + S1.z * Math.cos(ph) * r + S2.z * Math.sin(ph) * r * 0.85];
    };
    // nearest point along the plume (for bone weights and the comb)
    const along = (p) => {
      let best = 0, bd = 1e9;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24; tailAt(t, P);
        const d = (p[0] - P.x) ** 2 + (p[1] - P.y) ** 2 + (p[2] - P.z) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    };
    B.part(22, 38, at, {
      seed: 311, cell: 0.032, axis: [0, 0, 1], stretch: 1.8, nrmK: 0.28, inflate: 0.34,
      // (its fur shortening toward the tip, which lies along the back below the head)
      L: (p, n) => (0.062 + 0.02 * Math.abs(n[0]) - 0.014 * smoothstep(-0.2, -0.8, n[1])) * (1 - 0.3 * smoothstep(0.55, 1, along(p))),
      comb: (p, n) => { const t = along(p); tailTan(t, T); return [T.x + n[0] * 0.9, T.y + n[1] * 0.2 - 0.2, T.z]; },
      color: (p) => mix3(COL.white, COL.cream, 0.28 * smoothstep(0.0, 0.5, along(p)) * (1 - smoothstep(0.8, 1, along(p)))),
      bones: (p) => {
        const f = along(p);
        const k = clamp(f * TAIL_N, 0, TAIL_N - 1e-3);
        const i = Math.floor(k), w = k - i;
        if (f < 0.04) return [[BI.tail0, 0.6], [BI.hips, 0.4]];
        return i + 1 < TAIL_N ? [[BI['tail' + i], 1 - w], [BI['tail' + (i + 1)], w]] : [[BI['tail' + i], 1]];
      },
    });
  }
  B.occlude(OCC);
  return { base: B.build(), shell: B.buildShells(quality === 'low' ? 4 : 5) };
}

// ---------------------------------------------------------------------------
// Material: the cat's soft fur light, and the painted face of a dog
export function dogMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uShade: { value: new THREE.Color(opts.shade || '#c3bfca') },
    uFogScale: { value: opts.fogScale ?? 0.5 },
    uEyeL: { value: EYE_L.c.clone() }, uEyeR: { value: EYE_R2.c.clone() },
    uEyeAxL: { value: EYE_L.ax.clone() }, uEyeAxR: { value: EYE_R2.ax.clone() },
    uNoseC: { value: NOSE_C.clone() }, uMouthC: { value: MOUTH_C.clone() },
    uGaze: { value: new THREE.Vector2() },
    uBlink: { value: 0 }, uHappy: { value: 0 }, uPupil: { value: 1 }, uOpen: { value: 0 },
    uTongue: { value: 0 }, uTongueRoot: { value: TONGUE_ROOT.clone() },
    uShellLen: { value: opts.shellLen ?? 0.3 }, uShellFade: { value: 1 },
    uBreath: { value: 0 },
  };
  const shell = !!opts.shell;
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { SHELL: shell ? 1 : 0, LOW_Q: opts.lowQ ? 1 : 0 },
    alphaToCoverage: shell && !opts.lowQ,
    vertexShader: /* glsl */ `
      #include <skinning_pars_vertex>
      attribute vec3 aCol; attribute vec4 aFur;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec4 vFur; varying vec3 vB;
      #if SHELL
        attribute float aShell; attribute float aLen; attribute vec3 aComb;
        uniform float uShellLen;
        varying float vShell; varying vec3 vBase; varying vec3 vComb;
      #endif
      uniform float uBreath, uTongue; uniform vec3 uTongueRoot;
      void main() {
        vec3 objectNormal = normal;
        vec3 transformed = position;
        if (aFur.y > 5.5) {
          // the tongue comes out of the mouth (and folds away inside it), lolling a little
          vec3 r = transformed - uTongueRoot;
          float k = uTongue;
          r.y -= max(r.z, 0.0) * 0.35 * k;
          transformed = uTongueRoot + r * k;
        }
        #ifdef USE_SKINNING
          vec4 tb = step(abs(skinIndex - vec4(${BI.hips}.0)), vec4(0.5)) + step(abs(skinIndex - vec4(${BI.chest}.0)), vec4(0.5));
          transformed += normal * uBreath * dot(skinWeight, tb) * (0.55 + 0.45 * smoothstep(0.4, -0.5, normal.y));
        #endif
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #if SHELL
          float sf = aShell;
          vShell = sf; vBase = position; vComb = aComb;
          float L = aLen * uShellLen;
          // (a stand-off coat: the layers go straight out, combed and drooping only a little)
          transformed += normal * (L * sf + 0.0006) + aComb * L * 0.55 * sf * sf - vec3(0.0, L * 0.22 * sf * sf, 0.0);
        #endif
        #include <skinning_vertex>
        vec4 w = modelMatrix * vec4(transformed, 1.0);
        vN = normalize(mat3(modelMatrix) * objectNormal);
        vW = w.xyz;
        vCol = aCol; vFur = aFur; vB = position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uShade, uRimCol; uniform float uFogScale;
      uniform vec3 uEyeL, uEyeR, uEyeAxL, uEyeAxR, uNoseC, uMouthC;
      uniform vec2 uGaze; uniform float uBlink, uHappy, uPupil, uOpen;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec4 vFur; varying vec3 vB;
      #if SHELL
        uniform float uShellFade, uMSAA, uPxK;
        varying float vShell; varying vec3 vBase; varying vec3 vComb;
        // a 4x4 ordered-dither threshold in [0, 1)
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      #endif
      float cover(float d, float pw) { return clamp(0.5 - d / pw, 0.0, 1.0); }
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 cR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 cU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 cB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 Ld = normalize(mix(uSunDir, normalize(-cR * 0.62 + cU * 0.55 + cB * 0.56), 0.55));
        float fur = vFur.x, kind = vFur.y, ao = vFur.w;
        #if SHELL
          // The coat: its strands gather into soft pointed locks. Near the skin every strand
          // is there (a dense undercoat); further out only the middles of the locks reach, so
          // the coat ends in tapering tufts that stand off the body. Where a strand (or a lock)
          // is finer than a pixel it is drawn as its density instead, so the fluff stays soft
          // at a distance rather than glittering.
          vec3 cb = vComb / max(length(vComb), 1e-3);
          // (the locks show where the coat is seen edge-on - its outline; looking straight
          // into it, it is an even, soft fleece)
          float gz = smoothstep(0.3, 0.8, 1.0 - abs(dot(N, V)));
          // metres across a pixel here: strands and locks finer than that become their density
          float px = uPxK * length(cameraPosition - vW);
          // the locks (round cells, drawn out a little along the way the fur lies)
          vec3 kp = vBase * 56.0;
          kp -= cb * dot(kp, cb) * 0.3;
          vec3 ki = floor(kp);
          vec3 kh = fract(sin(vec3(dot(ki, vec3(41.3, 289.1, 17.9)), dot(ki, vec3(157.7, 23.3, 211.9)), dot(ki, vec3(71.1, 199.3, 103.7)))) * 43758.5453);
          vec3 kf = fract(kp) - 0.5 - (kh - 0.5) * 0.4;
          float kr = length(kf) * 1.7;
          // (each lock its own length; all of them shorter as the dog gets far away)
          float kL = (0.68 + 0.42 * kh.z) * uShellFade;
          float kU = vShell / max(kL, 1e-3);
          float kR = kU < 1.0 ? mix(1.6, 0.14, kU) : 0.0;
          float lockA = smoothstep(kR + 0.14, kR - 0.14, kr);
          lockA = mix(lockA, 1.0 - exp(-0.85 * kR * kR * kR), smoothstep(0.7, 1.6, px * 56.0));
          lockA = mix(step(vShell, uShellFade), lockA, gz);
          // the strands
          vec3 sp = vBase * 300.0;
          sp -= cb * dot(sp, cb) * 0.55;
          vec3 ci = floor(sp);
          vec3 hs = fract(sin(vec3(dot(ci, vec3(127.1, 311.7, 74.7)), dot(ci, vec3(269.5, 183.3, 246.1)), dot(ci, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          vec3 fp = fract(sp) - 0.5 - (hs - 0.5) * 0.55;
          float rr = length(fp);
          float rad0 = mix(0.58, 0.3, vShell);
          float cut = vShell * mix(0.5, 0.3, gz);
          float strandA = smoothstep(rad0 + 0.08, rad0 - 0.08, rr) * step(cut, hs.x + 0.12);
          strandA = mix(strandA, (1.0 - exp(-4.19 * rad0 * rad0 * rad0)) * clamp(1.12 - cut, 0.0, 1.0), smoothstep(1.1, 2.6, px * 300.0));
          float shellA = strandA * lockA;
          // (without multisampling - phones, and the denser screens - a fixed screen pattern
          // stands in for partial cover: each layer a different one, so they add up)
          float dth = bayer4(gl_FragCoord.xy);
          dth = fract(dth + vShell * 2.618) * 0.92 + 0.04;
          #if LOW_Q
            if (shellA < dth) discard;
          #else
            if (uMSAA < 0.5) { if (shellA < dth) discard; }
            else if (shellA < 0.02) discard;
          #endif
          // (deeper in the coat, and between the locks, is a little darker)
          float heart = mix(1.0, smoothstep(1.2, 0.2, kr), gz);
        #endif
        float ndl = dot(N, Ld);
        float l = smoothstep(mix(-0.25, -0.75, fur), mix(0.55, 0.88, fur), ndl);
        vec3 base = vCol;
        vec3 shade = uShade * uShadowTint;
        vec3 lit = mix(shade, uLightTint * 1.05, l * mix(0.6, 1.0, ao));
        vec3 col = base * lit;
        col += base * mix(vec3(0.05, 0.045, 0.04), uAmb * 0.13, N.y * 0.5 + 0.5) * ao;
        float nv = clamp(dot(N, V), 0.0, 1.0);
        float rim = pow(1.0 - nv, 2.4);
        col += uRimCol * rim * (0.12 + 0.24 * fur) * (0.45 + 0.55 * l) * ao;
        float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
        col += uSunCol * base * back * rim * 0.8 * fur;
        if (kind > 0.5) {
          if (kind < 2.5) {
            // --- eye: a dark, shining button eye with a black rim ---
            bool left = kind < 1.5;
            vec3 c = left ? uEyeL : uEyeR;
            vec3 ax = left ? uEyeAxL : uEyeAxR;
            vec3 q = normalize(vB - c);
            vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), ax));
            vec3 ey = cross(ax, ex);
            vec2 e = vec2(dot(q, ex), dot(q, ey)) / ${EYE_K.toFixed(3)};
            float pw = max(length(fwidth(e)), 1e-4) * 1.2;
            vec2 qi = e - uGaze * vec2(0.2, 0.16);
            float r = length(qi);
            // (deep brown, nearly black, a warm glint low in the iris)
            vec3 iris = mix(vec3(0.17, 0.09, 0.05), vec3(0.36, 0.2, 0.1), smoothstep(0.1, -0.6, qi.y) * 0.8);
            iris = mix(iris, vec3(0.06, 0.035, 0.03), smoothstep(0.45, 0.8, r));
            float pupil = cover(length(qi / (0.42 * uPupil)) - 1.0, pw * 2.0);
            vec3 ec = mix(iris, vec3(0.015, 0.012, 0.014), pupil);
            float shine = uNight * pow(max(dot(N, V), 0.0), 2.5);
            ec += vec3(0.25, 0.32, 0.22) * shine * pupil * 0.6;
            // (the black rim round the eye)
            ec = mix(ec, vec3(0.05, 0.035, 0.035), smoothstep(0.86, 0.96, length(e)));
            ec *= mix(0.75, 1.06, smoothstep(-0.6, 0.6, ndl));
            // catchlights: a big soft one toward the light, a small one below
            float h1 = cover(length((e - vec2(-0.22, 0.28)) / vec2(0.21, 0.23)) - 1.0, pw * 4.0);
            float h2 = cover(length(e - vec2(0.22, -0.24)) - 0.085, pw);
            ec = mix(ec, vec3(1.0, 0.99, 0.97), max(h1 * 0.95, h2 * 0.75));
            // lids: blinks; happy, both lids curve up into smiling arcs
            float cov = max(uBlink, uHappy);
            float hw = uHappy / max(uHappy + uBlink, 1e-3);
            float bend = mix(0.06 - 0.12 * e.x * e.x / max(1.0 - e.x * e.x, 0.05), mix(-0.32, 0.46, hw), cov);
            float yl = mix(0.95, mix(-0.3, -0.28, uHappy), cov) + bend * (1.0 - e.x * e.x);
            float low = mix(-1.05, yl - 0.06, smoothstep(0.75, 1.0, cov));
            float lid = max(cover(yl - e.y, pw), cover(e.y - low, pw));
            vec3 furC = base * lit;
            vec3 eyeC = mix(ec, furC, lid);
            float line = cover(abs(e.y - yl) - mix(0.08, 0.1, cov), pw);
            eyeC = mix(eyeC, vec3(0.06, 0.04, 0.04), line * smoothstep(1.1, 0.85, abs(e.x)));
            col = eyeC;
          } else if (kind < 3.5) {
            // --- nose: black, glossy, two nostrils ---
            vec2 n = vec2((vB.x - uNoseC.x) / 0.0115, (vB.y - uNoseC.y) / 0.0088);
            float pw = max(length(fwidth(n)), 1e-4);
            vec3 nc = vec3(0.075, 0.062, 0.065) * mix(0.75, 1.1, smoothstep(-0.8, 0.6, n.y));
            float nos = max(cover(length((n - vec2(0.42, -0.3)) / vec2(0.22, 0.15)) - 1.0, pw * 0.3), cover(length((n - vec2(-0.42, -0.3)) / vec2(0.22, 0.15)) - 1.0, pw * 0.3));
            nc = mix(nc, vec3(0.012, 0.01, 0.01), nos);
            col = nc * mix(shade, uLightTint * 1.05, l) + uAmb * 0.02;
            // (a wet shine on top)
            col += vec3(1.0) * cover(length((n - vec2(-0.15, 0.48)) / vec2(0.36, 0.2)) - 1.0, pw * 0.6) * 0.42 * (0.4 + 0.6 * l);
            col += vec3(0.9) * pow(max(dot(reflect(-V, N), Ld), 0.0), 24.0) * 0.25;
          } else if (kind < 4.5) {
            // --- mouth: the line down from the nose and the smiling lips; open, a dark
            // mouth with the tongue showing ---
            vec2 m = vec2(vB.x - uMouthC.x, vB.y - uMouthC.y);
            float pw = max(length(fwidth(m)), 1e-6);
            float ax = abs(m.x);
            float w = max(0.0008, pw * 0.8);
            float vis = smoothstep(uMouthC.z - 0.03, uMouthC.z - 0.016, vB.z);
            // philtrum: from under the nose down to the lips
            float d1 = length(vec2(m.x, m.y - clamp(m.y, -0.0055, 0.0))) - w * 0.5;
            // the lips: down from the philtrum and out, curling up at the corners (a smile)
            float lipY = -0.0055 - 0.0035 * sin(clamp(ax / 0.009, 0.0, 1.0) * 1.5708) + 0.009 * smoothstep(0.008, 0.02, ax) * (ax - 0.008) / 0.012;
            float d2 = ax < 0.021 ? abs(m.y - lipY) - w * 0.6 : 1.0;
            float a = cover(min(d1, d2), pw) * vis * (1.0 - smoothstep(0.0016, 0.0035, pw));
            col = mix(col, vec3(0.08, 0.06, 0.06) * mix(uShadowTint, uLightTint, 0.8), a * 0.9);
            if (uOpen > 0.01) {
              // the mouth opens below the lips: dark inside, the tongue at the bottom
              float hh = 0.0105 * uOpen;
              float yTop = -0.0062;
              vec2 mo = vec2(m.x / (0.0105 + 0.0025 * uOpen), (m.y - yTop) / hh);
              float inside = cover((length(vec2(mo.x, min(mo.y, 0.0) + 0.5) - vec2(0.0, 0.5)) - 0.5) * hh * 2.0, pw) * step(mo.y, 0.4);
              inside *= vis;
              vec3 mc = mix(vec3(0.25, 0.07, 0.09), vec3(0.95, 0.52, 0.58), smoothstep(-0.25, -0.85, mo.y));
              col = mix(col, mc * mix(uShadowTint, uLightTint, 0.85), inside);
            }
          } else {
            // --- tongue: pink with a little groove down its middle ---
            float g = smoothstep(0.003, 0.0, abs(vB.x)) * 0.25;
            col = vec3(0.94, 0.53, 0.58) * (1.0 - g) * mix(shade * 1.1, uLightTint * 1.05, l);
            col += vec3(1.0, 0.85, 0.88) * pow(max(dot(reflect(-V, N), Ld), 0.0), 16.0) * 0.3;
          }
        }
        col += base * pointLight(vW, N) * 1.3;
        #if SHELL
          col *= mix(0.9, 1.03, vShell) * mix(0.95, 1.0, max(heart, vShell));
        #endif
        col = applyFogK(col, vW, uFogScale);
        #if SHELL && !LOW_Q
          gl_FragColor = vec4(col, shellA);
        #else
          gl_FragColor = vec4(col, 1.0);
        #endif
      }`,
  });
}

// ---------------------------------------------------------------------------
// leg rig data (bind)
function legInfo(up, mid, end, parentChain, bend) {
  const A = bpos(up), M = bpos(mid), E = bpos(end);
  const L1 = Math.hypot(M[1] - A[1], M[2] - A[2]), L2 = Math.hypot(E[1] - M[1], E[2] - M[2]);
  return { up, mid, end, A, M, E, L1, L2, b1: Math.atan2(M[2] - A[2], -(M[1] - A[1])), b2: Math.atan2(E[2] - M[2], -(E[1] - M[1])), parentChain, bend };
}
const LEGS = {
  FL: legInfo('shL', 'elL', 'pwFL', 'front', -1), FR: legInfo('shR', 'elR', 'pwFR', 'front', -1),
  BL: legInfo('hipL', 'knL', 'pwBL', 'hind', 1), BR: legInfo('hipR', 'knR', 'pwBR', 'hind', 1),
};
const LEG_KEYS = ['FL', 'FR', 'BL', 'BR'];
const GAIT = {
  walk: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 },
  trot: { FL: 0, BR: 0, FR: 0.5, BL: 0.5 },
  bound: { BL: 0, BR: 0.1, FL: 0.45, FR: 0.55 },
};

// ---------------------------------------------------------------------------
export class Dog {
  constructor(U, { quality = 'high' } = {}) {
    this.quality = quality;
    const geo = dogGeometry(quality);
    this.mat = dogMaterial(U);
    const mesh = new THREE.SkinnedMesh(geo.base, this.mat);
    const bones = BONES.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
    BONES.forEach(([, parent, x, y, z], i) => {
      const b = bones[i];
      if (parent < 0) { b.position.set(x, y, z); mesh.add(b); return; }
      const pb = BONES[parent];
      b.position.set(x - pb[2], y - pb[3], z - pb[4]);
      bones[parent].add(b);
    });
    mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    mesh.frustumCulled = false;
    this.shellMat = dogMaterial(U, { shell: true, lowQ: quality === 'low', shellLen: SHELL_LEN });
    const shell = new THREE.SkinnedMesh(geo.shell, this.shellMat);
    mesh.add(shell);
    shell.bind(skeleton, new THREE.Matrix4());
    shell.frustumCulled = false;
    shell.renderOrder = 1;
    this.shell = shell;
    mesh.scale.setScalar(DOG_SCALE);
    this.mesh = mesh;
    this.bones = {};
    bones.forEach((b) => { this.bones[b.name] = b; b.rotation.order = 'YXZ'; });
    this.bind = {};
    bones.forEach((b) => { this.bind[b.name] = b.position.clone(); });
    this.shadow = contactShadow(0.36, 0.46, 0.62);
    this.group = new THREE.Group();
    this.group.add(mesh, this.shadow);
    this.P = this.defaultPose();
    this.ik = [0, 0];
    this.tmp = [0, 0];
    this.A = { x: 0, z: 0, y: 0, vx: 0, vz: 0, yaw: 0, inited: false, mode: 'wait', mt: 0, phase: 0, gK: 0, bK: 0, sit: 1, hx: 0, hy: 0, hr: 0, blinkT: 2.5, earT: 3, lapAcc: 0, laps: 0, lapDir: 1, prevAng: 0, side: 1, nextLap: 6, glanceT: 2, glance: 0, spin: 0 };
    this.v = { her: new THREE.Vector3(), prevHer: new THREE.Vector3(), hv: new THREE.Vector3(), lookT: new THREE.Vector3() };
    this.active = false;
  }

  defaultPose() {
    return { sit: 0, phase: 0, speed: 0, gK: 0, bK: 0, stride: 0.1, lift: 0.025, hop: 0, pitch: 0, roll: 0, spine: 0, headYaw: 0, headPitch: 0, headRoll: 0, wag: 0, wagAmp: 0.3, tailLift: 0, tailLag: 0, earL: 0, earR: 0, earBack: 0, blink: 0, happy: 0, gazeX: 0, gazeY: 0, pupil: 1, open: 0, tongue: 0, crouch: 0, reach: 0, stretch: 0, leap: 0, stand: 0, paddle: 0, flop: 0, flopSide: 1, breath: 0, time: 0 };
  }

  // Pose the skeleton from a few high-level parameters (the cat's rig, with a dog's tail)
  pose(P) {
    const b = this.bones, bind = this.bind;
    const fl = P.flop || 0, fside = P.flopSide || 1;
    const sit = P.sit * (1 - fl), run = P.bK, trot = P.gK;
    const go = (P.speed > 0.02 ? 1 : 0) * (1 - sit);
    const D = lerp(lerp(0.6, 0.48, trot), 0.34, run);
    const sweep = Math.min(D * P.stride, lerp(0.045, 0.062, run));
    const FT = this.feet || (this.feet = { FL: {}, FR: {}, BL: {}, BR: {} });
    let loadF = 0, loadH = 0, zF = 0, zH = 0;
    for (const k of LEG_KEYS) {
      const off = lerp(lerp(GAIT.walk[k], GAIT.trot[k], trot), GAIT.bound[k], run);
      const lp = (((P.phase + off) % 1) + 1) % 1;
      const f = FT[k];
      if (lp < D) {
        const u = lp / D;
        f.z = lerp(sweep, -sweep, u); f.y = 0; f.curl = 0; f.load = Math.sin(Math.PI * u);
      } else {
        const u = (lp - D) / (1 - D);
        const e = u * u * (3 - 2 * u);
        f.z = lerp(-sweep, sweep, e); f.y = Math.pow(Math.sin(Math.PI * u), 0.75) * (1 - 0.25 * u);
        f.curl = Math.sin(Math.PI * Math.min(1, u * 1.35)); f.load = 0;
      }
      f.z *= go; f.y *= go; f.curl *= go; f.load *= go;
      if (k[0] === 'F') { loadF += f.load * 0.5; zF += f.z * 0.5; } else { loadH += f.load * 0.5; zH += f.z * 0.5; }
    }
    // (a springy little trot: it bounces along)
    const meanLoad = D * 2 / Math.PI;
    const bAmp = lerp(lerp(0.005, 0.01, trot), 0.024, run);
    const bounce = -bAmp * ((loadF + loadH) * 0.5 - meanLoad) * go;
    const gather = clamp((zH - zF) / (2 * sweep + 1e-4), -1, 1);
    const flex = gather * lerp(0.035, 0.3, run) * go;
    const cr = P.crouch || 0, lp0 = P.leap || 0;
    const rootY = P.hop + bounce - (cr * 0.04 + 0.01 * run * go);
    // the play bow: front down along the ground, rump up, tail going
    const st = P.stretch || 0;
    const rootP = P.pitch - run * 0.13 * (loadH - loadF) * go + 0.36 * st - 0.06 * lp0;
    const froll = fside * (Math.PI / 2) * fl * (1 + 0.06 * Math.sin(P.time * 2.3) * fl);
    b.root.position.set(0, rootY + 0.088 * Math.sin(Math.abs(froll)), 0);
    b.root.rotation.set(rootP, 0, P.roll + froll);
    const su = P.stand || 0;
    const hipsDrop = 0.07 * sit + 0.02 * su;
    b.hips.position.set(bind.hips.x, bind.hips.y - hipsDrop, bind.hips.z + 0.01 * sit);
    const ph = P.phase * TAU;
    // (sitting, a dog sits up straight: front legs straight, chest high)
    const hx = -0.72 * sit - 0.5 * flex + 0.15 * st - 0.06 * cr - 1.12 * su;
    b.hips.rotation.set(hx, 0.05 * Math.sin(ph) * trot * (1 - run) * go, 0);
    const cx = 0.16 * sit + flex + P.spine - P.reach * 0.6 + 0.2 * st + 0.12 * cr + 0.12 * su;
    b.chest.rotation.set(cx, -0.06 * Math.sin(ph) * trot * (1 - run) * go, 0);
    const nx0 = 0.3 * sit;
    b.neck.rotation.set(nx0 + P.headPitch * 0.35, P.headYaw * 0.35, -froll * 0.3);
    const nod = (0.03 * (1 - run) * (1 - trot * 0.5)) * Math.sin(ph * 2 + 0.6) * go;
    const bodyPitch = hx + cx + nx0 + P.headPitch * 0.35 + rootP * 0.85;
    b.head.rotation.set(-bodyPitch + P.headPitch + nod, P.headYaw * 0.65, P.headRoll);
    // ears: perked; laid back flat when happy or rushing along
    b.earL.rotation.set(-0.5 * P.earBack - 0.2 * run, P.earL, -0.3 * P.earBack - 0.1 * run);
    b.earR.rotation.set(-0.5 * P.earBack - 0.2 * run, -P.earR, 0.3 * P.earBack + 0.1 * run);
    // legs
    for (const k of LEG_KEYS) {
      const L = LEGS[k];
      const front = L.parentChain === 'front';
      const f = FT[k];
      let tz = L.E[2] + f.z - (front ? 0.006 * go : 0);
      let ty = L.E[1] + P.lift * f.y + Math.max(0, P.hop) * 0.55;
      if (front) {
        tz += sit * 0.004 + P.reach * 0.06 + st * 0.1 + cr * 0.02 + lp0 * 0.09;
        ty += P.reach * 0.13 + lp0 * 0.07;
        // up on its hind legs: front paws held up in front of its chest, paddling
        if (su > 0) {
          const pd = (P.paddle || 0) * Math.max(0, Math.sin(P.time * 9 + (k === 'FL' ? 0 : Math.PI)));
          tz = lerp(tz, 0.13 + 0.015 * pd, su); ty = lerp(ty, 0.25 + 0.02 * pd, su);
        }
      } else {
        tz += sit * 0.1 - lp0 * 0.08 + su * 0.04;
        ty += sit * 0.004 + lp0 * 0.025;
      }
      rotX(ty - rootY, tz, -rootP, this.tmp);
      ty = this.tmp[0]; tz = this.tmp[1];
      const hy = bind.hips.y - hipsDrop, hz = bind.hips.z + 0.01 * sit;
      let Ay, Az;
      if (front) {
        const c = this.tmp;
        const cb = bind.chest, sb = bind[L.up];
        rotX(sb.y, sb.z, cx, c);
        const sy = cb.y + c[0], sz = cb.z + c[1];
        rotX(sy, sz, hx, c);
        Ay = hy + c[0]; Az = hz + c[1];
      } else {
        const c = rotX(bind[L.up].y, bind[L.up].z, hx, this.tmp);
        Ay = hy + c[0]; Az = hz + c[1];
      }
      if (fl > 0) { ty = lerp(ty, Ay - 0.08, fl); tz = lerp(tz, Az + (front ? 0.045 : -0.05), fl); }
      const r = ik2(Ay, Az, ty, tz, L.L1, L.L2, L.bend, this.ik);
      const parent = front ? hx + cx : hx;
      const a1 = L.b1 - r[0] - parent;
      const a2 = L.b2 - r[1] - parent - a1;
      // (paddling up on its hind legs, the front paws swing in and out a little too)
      const abd = front && su > 0 ? (k === 'FL' ? 1 : -1) * 0.12 * su : 0;
      b[L.up].rotation.set(a1, 0, abd);
      b[L.mid].rotation.set(a2, 0, 0);
      const curl = lerp(0.7, 1.15, run) * f.curl + (front ? P.reach * 0.6 - st * 0.25 + su * 0.9 : 0);
      b[L.end].rotation.set(-(parent + a1 + a2) + curl, 0, 0);
    }
    // the plume: held over its back, wagging from side to side (the whole fan swings), lifted
    // a little when it is pleased, trailing round turns
    const wagA = P.wagAmp * Math.sin(P.wag);
    for (let i = 0; i < TAIL_N; i++) {
      const t = b['tail' + i];
      const f = i / (TAIL_N - 1);
      let rx = 0, ry = 0, rz = 0;
      if (i === 0) {
        rx = -0.12 * P.tailLift + 0.08 * run - 0.25 * sit + 0.2 * su;
        ry = wagA * 0.55 + P.tailLag * 0.4;
        rz = wagA * 0.25;
      } else {
        ry = wagA * 0.12 * (1 - f * 0.4) + P.tailLag * 0.1;
        rx = -0.03 * P.tailLift * f + 0.02 * Math.sin(P.time * 1.7 - i) * (1 - run);
      }
      // (lying on its side, the plume flops out behind)
      if (fl > 0) { rx = lerp(rx, i === 0 ? 0.6 : 0.05, fl); ry = lerp(ry, 0.1 * Math.sin(P.time * 1.4 - i * 0.5), fl); }
      t.rotation.set(rx, ry, rz);
    }
    // face
    const u = this.mat.uniforms;
    u.uBlink.value = P.blink;
    u.uHappy.value = P.happy;
    u.uGaze.value.set(P.gazeX, P.gazeY);
    u.uPupil.value = P.pupil;
    u.uOpen.value = P.open || 0;
    u.uTongue.value = P.tongue || 0;
    u.uBreath.value = P.breath || 0;
    this.shellMat.uniforms.uBreath.value = P.breath || 0;
    this.shellMat.uniforms.uTongue.value = 0;
  }

  // -------------------------------------------------------------------------
  // Where to be, near her: the camera must see it - in the frame (clear of its edges), not
  // hidden behind her nor standing in front of her, not under the lens, not in front of
  // the cake - and it keeps clear of the cat, the flower and the cake. Each moment adds its
  // own wishes (pref). Spots round her on two rings; the current one is kept unless another
  // is clearly better.
  spotScore(x, z, ctx, C, fig, tgt) {
    let seen = 1, hidden = 0, cover = 0, close = 0, cakeBlock = 0, face = 0;
    const cam = ctx.camera;
    if (cam && fig) {
      const p = this._pp;
      p.set(x, heightAt(x, z) + 0.24, z).project(cam);
      seen = p.z > 1 ? 0 : 1 - smoothstep(0.66, 0.9, Math.max(Math.abs(p.x), Math.abs(p.y)));
      const dS = Math.hypot(x - ctx.cam.x, z - ctx.cam.z);
      const onHer = smoothstep(fig.hw * 1.25, fig.hw * 0.6, Math.abs(p.x - fig.x0)) * (p.y < fig.y1 && p.y > fig.y0 - 0.1 ? 1 : 0);
      if (dS > fig.d - 0.1) hidden = onHer; else cover = onHer;
      close = smoothstep(2.1, 1.25, dS);
      // (nor so near the lens that it looms: on screen it should stand well under half her height)
      {
        const py = p.y;
        p.set(x, heightAt(x, z) + 0.45, z).project(cam);
        // (its height on screen beside hers, as if it stood at her side: about a third)
        const R = (Math.abs(p.y - py) / 0.21) / (Math.max(0.02, fig.y1 - fig.y0) / 1.2) * 0.32;
        // (looming in the foreground is worse than being out of the picture for a moment)
        close = Math.max(close, 1.5 * smoothstep(0.36, 0.5, R));
        p.set(x, heightAt(x, z) + 0.24, z).project(cam);
      }
      // (and from where it sits, looking at what it watches, its face is toward us)
      if (tgt) {
        const ax = tgt.x - x, az = tgt.z - z, al = Math.hypot(ax, az) || 1;
        face = smoothstep(-0.2, 0.6, ((ctx.cam.x - x) * ax + (ctx.cam.z - z) * az) / (al * (dS || 1)));
      }
      if (fig.cake && dS < fig.cake.d) cakeBlock = smoothstep(0.16, 0.06, Math.abs(p.x - fig.cake.x)) * smoothstep(0.35, 0.1, Math.abs(p.y - fig.cake.y));
      // (behind the stump: hidden)
      if (fig.cake && dS > fig.cake.d) hidden = Math.max(hidden, smoothstep(fig.cake.hw * 1.1, fig.cake.hw * 0.6, Math.abs(p.x - fig.cake.sx)) * (p.y < fig.cake.top ? 1 : 0));
      // (not in front of or behind the cat on screen either: two white-and-ginger balls of fluff
      // run together)
      if (fig.cat) {
        const dx = (p.x - fig.cat.x) * fig.asp, dy = p.y - fig.cat.y;
        cover = Math.max(cover, smoothstep(fig.cat.r * 2.4, fig.cat.r * 1.3, Math.hypot(dx, dy)));
      }
    }
    const dc = C ? Math.min(Math.hypot(x - (C.tx ?? C.x), z - (C.tz ?? C.z)), Math.hypot(x - C.x, z - C.z)) : 9;
    const dfl = Math.hypot(x - ctx.flower.x, z - ctx.flower.z), dck = Math.hypot(x - ctx.cake.x, z - ctx.cake.z);
    return 2.2 * seen - 2.5 * hidden - 1.9 * cover - 2.0 * close + 0.9 * face - 1.5 * cakeBlock - 2 * smoothstep(0.7, 0.35, dc) - 2 * smoothstep(0.6, 0.35, dfl) - 2 * smoothstep(0.85, 0.6, dck);
  }
  pickSpot(her, ctx, C, pref, cur = null, radii = [0.66, 0.92], tgt = her) {
    const fwx = Math.sin(ctx.herYaw), fwz = Math.cos(ctx.herYaw);
    const lfx = Math.cos(ctx.herYaw), lfz = -Math.sin(ctx.herYaw);
    const cam = ctx.camera;
    const p = this._pp || (this._pp = new THREE.Vector3());
    // her figure on screen (feet to shoulders, a skirt's width), and the cake's
    let fig = null;
    if (cam) {
      cam.updateMatrixWorld();
      const cr = (this._cr || (this._cr = new THREE.Vector3())).setFromMatrixColumn(cam.matrixWorld, 0);
      p.set(her.x, her.y + 0.05, her.z).project(cam); const y0 = p.y, x0 = p.x;
      p.set(her.x, her.y + 1.25, her.z).project(cam); const y1 = p.y;
      p.set(her.x + cr.x * 0.4, her.y + 0.5, her.z + cr.z * 0.4).project(cam); const hw = Math.abs(p.x - x0);
      fig = { x0, y0: Math.min(y0, y1), y1: Math.max(y0, y1), hw, d: Math.hypot(her.x - ctx.cam.x, her.z - ctx.cam.z), cake: null };
      const dk = Math.hypot(ctx.cake.x - ctx.cam.x, ctx.cake.z - ctx.cam.z);
      if (dk < 12) {
        p.set(ctx.cake.x, ctx.cake.y + 0.6, ctx.cake.z).project(cam); fig.cake = { x: p.x, y: p.y, d: dk };
        p.set(ctx.cake.x, ctx.cake.y + 0.5, ctx.cake.z).project(cam); fig.cake.top = p.y; fig.cake.sx = p.x;
        p.set(ctx.cake.x + cr.x * 0.38, ctx.cake.y + 0.25, ctx.cake.z + cr.z * 0.38).project(cam); fig.cake.hw = Math.abs(p.x - fig.cake.sx);
      }
      // the cat on screen (where it sits, or is heading), and about how big
      fig.asp = cam.aspect || 1;
      if (C && ctx.catVisible) {
        const cx = C.tx ?? C.x, cz = C.tz ?? C.z;
        p.set(cx, heightAt(cx, cz) + 0.2, cz).project(cam); const px = p.x, py = p.y;
        p.set(cx, heightAt(cx, cz) + 0.42, cz).project(cam);
        fig.cat = { x: px, y: py, r: Math.max(0.02, Math.abs(p.y - py)) };
      }
    }
    let best = null;
    // (rings round her; and round what it watches, when that is not her)
    // (and a wider one, for a tight frame - a phone held upright - where there is no room
    // close by: from a little way off it still watches)
    const rings = [[her, radii], [her, [1.55]]];
    if (tgt !== her) rings.push([tgt, [0.62, 0.9]]);
    for (const [c, rr] of rings) for (const r of rr) {
      for (let k = 0; k < 16; k++) {
        const a = ctx.herYaw + (k / 16) * TAU + (r > rr[0] ? TAU / 32 : 0);
        const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
        const sc = pref(x, z) + this.spotScore(x, z, ctx, C, fig, tgt) - (r > 1.4 ? 0.45 : 0);
        if (!best || sc > best.score) best = { score: sc, x, z };
      }
    }
    if (cur) {
      const sc = pref(cur.x, cur.z) + this.spotScore(cur.x, cur.z, ctx, C, fig, tgt);
      if (sc > best.score - 0.45) best = { score: sc, x: cur.x, z: cur.z };
    }
    best.ac = (best.x - her.x) * lfx + (best.z - her.z) * lfz;
    best.al = (best.x - her.x) * fwx + (best.z - her.z) * fwz;
    return best;
  }

  // -------------------------------------------------------------------------
  // The agent. ctx: like the cat's (t, time, her, herYaw, fly, walk, kneel, cam, wait, flower,
  // cake, burstAge, wishAge, reduced, night), plus cat: the cat's agent (to keep clear of it
  // and to run its laps the same way), hug, summitSit, sing, catPet (she is fussing the cat)
  update(dt, ctx) {
    dt = Math.min(dt, 0.1);
    const A = this.A, P = this.P, v = this.v;
    const time = ctx.time, t = ctx.t;
    const rnd = this.rnd || (this.rnd = mulberry(23));
    const her = v.her.copy(ctx.her);
    if (!A.inited) v.prevHer.copy(her);
    const hvx = (her.x - v.prevHer.x) / Math.max(dt, 1e-3), hvz = (her.z - v.prevHer.z) / Math.max(dt, 1e-3);
    v.prevHer.copy(her);
    const kv = 1 - Math.exp(-dt * 6);
    v.hv.x += (clamp(hvx, -30, 30) - v.hv.x) * kv; v.hv.z += (clamp(hvz, -30, 30) - v.hv.z) * kv;
    const herSp = Math.hypot(v.hv.x, v.hv.z);
    const fwx = Math.sin(ctx.herYaw), fwz = Math.cos(ctx.herYaw);
    const lfx = Math.cos(ctx.herYaw), lfz = -Math.sin(ctx.herYaw);
    const camSide = ((ctx.cam.x - her.x) * lfx + (ctx.cam.z - her.z) * lfz) >= 0 ? 1 : -1;
    const landed = ctx.fly < 0.15;
    const W = ctx.wait;
    const C = ctx.cat && ctx.cat.inited ? ctx.cat : null;
    // --- what to do ---
    const ctxMode = !landed ? 'wait'
      : ctx.kneel > 0.02 || (t > 0.397 && t < 0.505) ? 'flower'
        : t > 0.736 && t < 0.786 && ctx.walk < 0.5 ? 'summit'
          : t > 0.843 ? 'cake'
            : herSp > 0.3 ? 'follow' : 'near';
    const prevLanded = A.landed;
    A.landed = landed;
    if (!A.inited) { A.inited = true; A.mode = ctxMode; A.mt = 0; A.snap = true; }
    if (landed && prevLanded === false && t < 0.33 && !ctx.reduced) {
      // she has just touched down: zoomies! round and round her, wider than the cat runs
      A.mode = 'greet'; A.mt = 0; A.lapAcc = 0; A.laps = 2.3;
      A.lapDir = C ? (C.lapDir || 1) : 1;
      A.prevAng = Math.atan2(A.x - her.x, A.z - her.z);
      A.hop0 = time; A.hopDur = 0.32; A.hopH = 0.06;
      A.barks = [time + 0.15, time + 0.45];
    } else if (A.mode === 'greet' || A.mode === 'lap') {
      if (!landed || ctxMode === 'flower' || ctxMode === 'summit' || ctxMode === 'cake') A.mode = ctxMode;
    } else if (ctxMode !== A.mode) {
      A.mode = ctxMode; A.mt = 0;
    }
    if (A.mode !== A.prevMode) { A.mt = 0; A.prevMode = A.mode; A.scout = null; A.nextScout = undefined; A.spot = null; A.spotT = 0; A.lane = null; A.idle = A.idle === 'roll' ? null : A.idle; }
    A.mt += dt;
    const mode = A.mode;
    let tx = A.x, tz = A.z, vmax = 3, faceYaw = A.yaw, wantSit = false, ff = 0, arriveK = 2.6;
    const look = v.lookT;
    const herHead = (h) => look.set(her.x, her.y + (landed ? h : 0.25), her.z);
    // (how excited it is: the faster its tail goes; and whether it smiles, mouth open)
    let excite = 0.35, happy = 0, lookW = 1, earBack = 0, pupil = 1, startle = 0, smile = 0;
    // (which side of her the cat is on; the side away from it is the dog's)
    const catSide = C ? (((C.x - her.x) * lfx + (C.z - her.z) * lfz) >= 0 ? 1 : -1) : -camSide;
    const across = (x, z) => (x - her.x) * lfx + (z - her.z) * lfz;
    const ahead = (x, z) => (x - her.x) * fwx + (z - her.z) * fwz;
    const away = (x, z) => (across(x, z) * catSide < 0 ? 1 : 0);
    const sitSpot = (pref, every = 3, radii, tgt = her) => {
      A.spotT = (A.spotT || 0) - dt;
      if (!A.spot || A.spotT <= 0 || A.spot.her.distanceTo(her) > 0.3) {
        // (the current spot, carried along with her)
        const cur = A.spot ? { x: A.spot.x + (her.x - A.spot.her.x), z: A.spot.z + (her.z - A.spot.her.z) } : null;
        const s = this.pickSpot(her, ctx, C, pref, cur, radii, tgt);
        A.spot = { x: s.x, z: s.z, her: her.clone() };
        A.spotT = every;
      }
      const S = A.spot;
      tx = S.x + (her.x - S.her.x); tz = S.z + (her.z - S.her.z);
    };
    if (mode === 'wait') {
      const ex = smoothstep(0.222, 0.242, t);
      herHead(1.3);
      excite = 0.35 + 0.6 * ex; pupil = 1 + 0.3 * ex;
      if (t < 0.2445) {
        // sitting in the meadow with the cat, watching her come down out of the sky; as she
        // comes close, up on its paws, bouncing and spinning with excitement
        tx = W.x; tz = W.z;
        faceYaw = Math.atan2(her.x - W.x, her.z - W.z);
        wantSit = ex < 0.45;
        vmax = 3.5;
        if (ex > 0.6 && !ctx.reduced && Math.hypot(W.x - A.x, W.z - A.z) < 0.35) {
          A.hopT = (A.hopT ?? 0) - dt;
          if (A.hopT <= 0 && time - (A.hop0 ?? -9) > 0.45) { A.hop0 = time; A.hopDur = 0.3; A.hopH = 0.04 + rnd() * 0.03; A.hopT = 0.45 + rnd() * 0.4; }
          if (!A.waitSpin && ex > 0.8) { A.waitSpin = true; A.idle = 'spin'; A.g0 = time; A.spinDir = rnd() < 0.5 ? 1 : -1; }
          smile = 1;
        }
      } else {
        // she glides over: run after her, to be there as she lands
        tx = her.x + fwx * 1.4 - lfx * camSide * 0.5; tz = her.z + fwz * 1.4 - lfz * camSide * 0.5;
        ff = 1; vmax = 5.2; lookW = 0.8; excite = 1; smile = 1;
      }
    } else if (mode === 'greet' || mode === 'lap') {
      // zoomies: tearing round her in a wide circle, ears back, grinning
      const still = 1 - smoothstep(0.3, 1.2, herSp);
      const ox = her.x + fwx * 0.4 * still, oz = her.z + fwz * 0.4 * still;
      const th = Math.atan2(A.x - ox, A.z - oz);
      const d = wrapA(th - A.prevAng) * A.lapDir;
      A.prevAng = th;
      if (d > 0) A.lapAcc += d;
      const R = (mode === 'greet' ? 1.45 : 1.3) + 0.1 * Math.sin(time * 2.1);
      const ta = th + A.lapDir * 0.7;
      tx = ox + Math.sin(ta) * R; tz = oz + Math.cos(ta) * R;
      vmax = (mode === 'greet' ? 3.6 : 3.2) * smoothstep(0, 0.5, A.mt) + 0.7 + herSp;
      arriveK = 6;
      herHead(1.3); lookW = 0.5;
      excite = 1; smile = 1; earBack = 0.55;
      if (!ctx.reduced && A.mt > 0.5 && time - (A.hop0 ?? -9) > 0.9 && rnd() < dt * 1.8) { A.hop0 = time; A.hopDur = 0.3; A.hopH = 0.05 + rnd() * 0.03; }
      if (A.lapAcc >= A.laps * TAU) {
        A.mode = herSp > 0.3 ? 'follow' : 'near'; A.mt = 0;
        A.nextLap = 5 + rnd() * 4;
        // (and a last happy spin to finish)
        if (!ctx.reduced && mode === 'greet') { A.idle = 'spin'; A.g0 = time; A.spinDir = A.lapDir; }
      }
    } else if (mode === 'near') {
      // sitting by her, looking up at her, tail going
      sitSpot((x, z) => 0.35 * away(x, z) + 0.15 * smoothstep(-0.3, 0.4, ahead(x, z)));
      faceYaw = Math.atan2(her.x - tx, her.z - tz);
      wantSit = true; vmax = 2.4;
      herHead(1.32);
      excite = 0.5; happy = 0.15;
      // now and then a smile, mouth open, panting softly
      A.smileT = (A.smileT ?? 2) - dt;
      if (A.smileT <= 0) { A.smiling = !A.smiling; A.smileT = A.smiling ? 3 + rnd() * 4 : 2 + rnd() * 3; }
      smile = A.smiling ? 1 : 0;
      // she is fussing the cat: it wants some too - up on its hind legs, dancing for her
      if (ctx.catPet && !A.idle && !ctx.reduced && time - (A.lastBeg ?? -99) > 7) { A.idle = 'dance'; A.g0 = time; A.lastBeg = time; }
      // its little tricks, while she rests
      if (A.mt > A.nextLap && !ctx.reduced && !A.idle && !ctx.hug) {
        const r = rnd();
        A.g0 = time;
        if (r < 0.2) { A.idle = 'spin'; A.spinDir = rnd() < 0.5 ? 1 : -1; }
        else if (r < 0.4) A.idle = 'dance';
        else if (r < 0.56) A.idle = 'bow';
        else if (r < 0.72 && herSp < 0.2) {
          A.mode = 'lap'; A.mt = 0; A.lapAcc = 0; A.laps = 1;
          A.prevAng = Math.atan2(A.x - her.x, A.z - her.z);
          A.lapDir = C ? (C.lapDir || 1) : (rnd() < 0.5 ? 1 : -1);
        } else if (r < 0.86) { A.idle = 'roll'; A.flopSide = rnd() < 0.5 ? 1 : -1; }
        else A.idle = 'bark';
        A.nextLap = A.mt + 6 + rnd() * 5;
      }
    } else if (mode === 'follow') {
      // trotting along beside them in a lane the camera sees - out wide on our side as a
      // rule (the cat keeps close to her), else behind, ahead, or over on her far side
      const side = camSide;
      A.laneT = (A.laneT || 0) - dt;
      if (!A.lane || A.laneT <= 0) {
        // (beside her rather than far ahead or behind; never in her way)
        const pref = (x, z) => { const ac = across(x, z), al = ahead(x, z); return 0.3 * (ac * side > 0 ? 1 : 0) + 0.3 * smoothstep(0.9, 0.2, Math.abs(al + 0.1)) - 1.2 * smoothstep(0.5, 0.25, Math.abs(ac)) * (al > 0 ? 1 : 0.4); };
        A.lane = this.pickSpot(her, ctx, C, pref, A.lane ? { x: her.x + lfx * A.lane.ac + fwx * A.lane.al, z: her.z + lfz * A.lane.ac + fwz * A.lane.al } : null, [0.8, 1.08]);
        A.laneT = 2.5;
      }
      const Ln = A.lane;
      tx = her.x + lfx * Ln.ac + fwx * Ln.al + v.hv.x * 0.12;
      tz = her.z + lfz * Ln.ac + fwz * Ln.al + v.hv.z * 0.12;
      ff = 1; vmax = 2.8 + herSp * 0.6;
      excite = 0.6; smile = 1;
      // now and then a dash on ahead along the way, a happy little wait for her there
      if (A.nextScout === undefined) A.nextScout = 6 + rnd() * 8;
      const hvl = Math.hypot(v.hv.x, v.hv.z) || 1;
      if (!A.scout && A.mt > A.nextScout && herSp > 0.45 && herSp < 2.2 && !ctx.reduced && !(C && C.scout)) {
        const ux = v.hv.x / hvl, uz = v.hv.z / hvl;
        A.scout = { x: her.x + ux * 3.4 - uz * side * 0.6, z: her.z + uz * 3.4 + ux * side * 0.6, ux, uz, t0: time, b: false };
      }
      if (A.scout) {
        const S = A.scout;
        tx = S.x; tz = S.z; ff = 0; vmax = 4.4; arriveK = 3;
        const there = Math.hypot(A.x - S.x, A.z - S.z) < 0.3;
        if (there) {
          faceYaw = Math.atan2(her.x - S.x, her.z - S.z); herHead(1.25); excite = 1;
          // (a bark for her: come on!)
          if (!S.b) { S.b = true; A.barks = [time + 0.2]; }
        }
        const along = (her.x - S.x) * S.ux + (her.z - S.z) * S.uz;
        if (along > -0.6 || time - S.t0 > 8 || herSp > 2.6) { A.scout = null; A.nextScout = A.mt + 10 + rnd() * 10; }
      } else {
        // mostly looking ahead, nose down now and then for an interesting smell
        A.glanceT = (A.glanceT ?? 3) - dt;
        if (A.glanceT <= 0) { A.glance = (A.glance + 1 + Math.floor(rnd() * 2)) % 3; A.glanceT = A.glance === 1 ? 0.9 + rnd() * 0.5 : A.glance === 2 ? 0.8 + rnd() * 0.5 : 1.8 + rnd() * 2.5; }
        if (A.glance === 1) herHead(1.3);
        else if (A.glance === 2) { look.set(A.x + Math.sin(A.yaw) * 0.35, A.y - 0.05, A.z + Math.cos(A.yaw) * 0.35); smile = 0; }
        else look.set(A.x + Math.sin(A.yaw) * 3, A.y + 0.2, A.z + Math.cos(A.yaw) * 3);
      }
    } else if (mode === 'flower') {
      // sitting watching the little flower, on the far side of it from the cat
      sitSpot((x, z) => {
        // (near the flower, but never between her and it)
        const df = Math.hypot(x - ctx.flower.x, z - ctx.flower.z);
        const sx = ctx.flower.x - her.x, sz = ctx.flower.z - her.z, sl = sx * sx + sz * sz || 1;
        const u = clamp(((x - her.x) * sx + (z - her.z) * sz) / sl, 0, 1);
        const between = smoothstep(0.35, 0.15, Math.hypot(x - her.x - sx * u, z - her.z - sz * u));
        return 0.5 * smoothstep(1.3, 0.75, df) + 0.25 * away(x, z) - 1.5 * between;
      }, 4, [0.66, 0.92, 1.2], ctx.flower);
      faceYaw = Math.atan2(ctx.flower.x - tx, ctx.flower.z - tz);
      wantSit = true; vmax = 2.4;
      look.set(ctx.flower.x, ctx.flower.y + 0.1, ctx.flower.z);
      excite = 0.4; pupil = 1.15;
      const ba = ctx.burstAge;
      if (ba >= 0 && ba < 3.2) {
        // the flower bursts open: a startled jump back and a bark, then bouncing after the
        // drifting petals
        startle = smoothstep(0, 0.08, ba) * (1 - smoothstep(0.7, 1.2, ba));
        wantSit = ba > 2.6;
        pupil = 1.5;
        look.y += 0.5 + 0.9 * smoothstep(0.1, 1.2, ba);
        earBack = 0.6 * startle; excite = 0.2 + 0.8 * smoothstep(0.8, 1.5, ba);
        if (ba < 0.12 && !(A.burstHop > 0)) { A.burstHop = 1; A.hop0 = time; A.hopDur = 0.36; A.hopH = 0.08; A.barks = [time + 0.35, time + 0.6]; }
        if (ba > 1.6 && ba < 2.6 && !ctx.reduced && A.idle !== 'dance') { A.idle = 'dance'; A.g0 = time; }
      } else A.burstHop = 0;
    } else if (mode === 'summit') {
      // side by side with her, looking out at the view (the cat on her other side)
      sitSpot((x, z) => 0.5 * smoothstep(0.6, 0.15, Math.abs(ahead(x, z))) + 0.3 * away(x, z), 5);
      faceYaw = ctx.herYaw;
      if (ctx.summitSit) faceYaw = Math.atan2(her.x + fwx * 20 - tx, her.z + fwz * 20 - tz);
      wantSit = true; vmax = 2.4;
      look.set(tx + fwx * 30, A.y + 4, tz + fwz * 30);
      if ((A.mt % 8) > 6.2) herHead(1.2);
      excite = 0.3; smile = 1; happy = 0.2;
    } else if (mode === 'cake') {
      // sitting by the cake with her (the other side of her from the cat), its eyes on
      // the cake; when she wishes, a happy bark, and up dancing as the lanterns rise
      sitSpot((x, z) => 0.45 * smoothstep(1.7, 0.85, Math.hypot(x - ctx.cake.x, z - ctx.cake.z)) + 0.3 * away(x, z), 4, [0.7, 1.0, 1.35], ctx.cake);
      faceYaw = Math.atan2(ctx.cake.x - tx, ctx.cake.z - tz);
      const toHer = Math.atan2(her.x - tx, her.z - tz);
      faceYaw = toHer + wrapA(faceYaw - toHer) * 0.5;
      wantSit = true; vmax = 2.4;
      look.set(ctx.cake.x, ctx.cake.y + 0.9, ctx.cake.z);
      if ((A.mt % 7) > 5) herHead(1.3);
      excite = 0.5; pupil = 1.2; smile = (A.mt % 9) > 4 ? 1 : 0;
      const wa = ctx.wishAge;
      if (wa >= 0) {
        if (!A.wishB) { A.wishB = true; A.barks = [time + 0.75, time + 1.0]; A.wishSpin = false; A.wishDance = false; }
        if (wa < 1.9) look.set(ctx.cake.x, ctx.cake.y + 0.95 + Math.max(0, wa - 1) * 0.7, ctx.cake.z);
        else if (wa < 4.3) herHead(1.0);
        else look.set(her.x + fwx * 6, her.y + 3 + Math.min(wa, 8) * 1.4, her.z + fwz * 6);
        excite = 0.9; smile = 1; happy = 0.4;
        if (wa > 5.2 && !A.wishSpin && !ctx.reduced && !A.idle) { A.wishSpin = true; A.idle = 'spin'; A.g0 = time; A.spinDir = 1; }
        if (wa > 9.6 && !A.wishDance && !ctx.reduced && !A.idle) { A.wishDance = true; A.idle = 'dance'; A.g0 = time; }
      } else A.wishB = false;
      // (now and then, up on its hind legs begging at the cake)
      if (wa < 0 && !A.idle && !ctx.reduced && A.mt > (A.nextBeg ?? 6)) { A.idle = 'dance'; A.g0 = time; A.nextBeg = A.mt + 9 + rnd() * 6; }
    }
    // she has the cat in her arms: it is beside itself - dancing round at her feet
    if (ctx.hug && landed && !ctx.reduced) {
      const H = ctx.hug;
      const hfx = Math.sin(H.yaw), hfz = Math.cos(H.yaw), hlx = Math.cos(H.yaw), hlz = -Math.sin(H.yaw);
      const s = ((ctx.cam.x - H.her.x) * hlx + (ctx.cam.z - H.her.z) * hlz) >= 0 ? 1 : -1;
      tx = H.her.x + hfx * 0.55 + hlx * s * 0.45; tz = H.her.z + hfz * 0.55 + hlz * s * 0.45;
      faceYaw = Math.atan2(H.her.x - tx, H.her.z - tz);
      look.set(H.her.x, H.her.y + 1.0, H.her.z); lookW = 1;
      excite = 1; smile = 1;
      wantSit = true;
      if (H.lift > 0.4 && !A.idle && time - (A.lastBeg ?? -99) > 4.5) { A.idle = 'dance'; A.g0 = time; A.lastBeg = time; }
    }
    // a butterfly on her hand: it watches it, head tilted
    if (ctx.herFly && !A.idle && (mode === 'near' || mode === 'summit')) { look.copy(ctx.herFly); lookW = 1; pupil = Math.max(pupil, 1.35); }
    if (ctx.night > 0) pupil *= 1 + 0.3 * ctx.night;

    // --- its tricks ---
    let stand = 0, paddle = 0, bow = 0, flop = 0, spinV = 0;
    if (A.idle) {
      const f = time - A.g0;
      const burst = ctx.burstAge >= 0 && ctx.burstAge < 4 && !(mode === 'flower' && A.idle === 'dance');
      const calm = !ctx.reduced && (landed || mode === 'wait') && !burst;
      const dur = A.idle === 'spin' ? 1.9 : A.idle === 'dance' ? 2.8 : A.idle === 'bow' ? 2.0 : A.idle === 'roll' ? 3.6 : 1.3;
      if (f > dur || !calm || (A.idle !== 'dance' && mode === 'follow')) A.idle = null;
      else if (A.idle === 'spin') {
        // chasing its tail: two quick turns on the spot
        wantSit = false; tx = A.x; tz = A.z; vmax = 0.2; lookW = 0;
        spinV = (A.spinDir || 1) * 2 * TAU / 1.45 * smoothstep(0.0, 0.2, f) * (1 - smoothstep(1.35, 1.6, f));
        excite = 1; smile = 1; earBack = 0.4;
        if (f > 1.55 && !A.spinHop) { A.spinHop = true; A.hop0 = time; A.hopDur = 0.28; A.hopH = 0.04; }
      } else if (A.idle === 'dance') {
        // up on its hind legs, front paws paddling, bobbing and turning a little: please!
        wantSit = false; vmax = 0.4; arriveK = 2;
        stand = smoothstep(0.05, 0.35, f) * (1 - smoothstep(dur - 0.4, dur - 0.05, f));
        paddle = 1;
        excite = 1; smile = 1; earBack = 0.25; happy = Math.max(happy, 0.2);
        if (Math.floor(f / 0.42) !== A.danceN && f < dur - 0.5) { A.danceN = Math.floor(f / 0.42); A.hop0 = time; A.hopDur = 0.3; A.hopH = 0.018; }
        spinV = Math.sin(f * 2.2) * 0.9 * stand;
      } else if (A.idle === 'bow') {
        // the play bow: front down, rump up, tail going - and a bark - then a bounce
        wantSit = false; vmax = 0.3;
        faceYaw = Math.atan2(her.x - A.x, her.z - A.z);
        bow = smoothstep(0.05, 0.3, f) * (1 - smoothstep(1.35, 1.6, f));
        excite = 1; smile = 1; earBack = 0.2;
        if (!A.bowBark) { A.bowBark = true; A.barks = [time + 0.55]; }
        if (f > 1.55 && !A.bowHop) { A.bowHop = true; A.hop0 = time; A.hopDur = 0.3; A.hopH = 0.06; }
      } else if (A.idle === 'roll') {
        // flopped over on its side, legs out, tail swishing, grinning up at her
        wantSit = false; vmax = 0.2;
        flop = smoothstep(0.1, 0.5, f) * (1 - smoothstep(dur - 0.5, dur - 0.1, f));
        excite = 0.7; smile = 1; happy = 0.5 * flop;
      } else if (A.idle === 'bark') {
        excite = 0.9;
        if (!A.barkSet) { A.barkSet = true; A.barks = [time + 0.1, time + 0.4]; }
      }
    }
    if (!A.idle) { A.spinHop = false; A.bowBark = false; A.bowHop = false; A.barkSet = false; A.danceN = -1; }

    // --- move ---
    let dx = tx - A.x, dz = tz - A.z;
    if (A.snap || Math.hypot(dx, dz) > 14) {
      A.x = tx; A.z = tz; A.vx = ff ? v.hv.x : 0; A.vz = ff ? v.hv.z : 0;
      A.yaw = ff && herSp > 0.2 ? Math.atan2(v.hv.x, v.hv.z) : faceYaw;
      A.sit = wantSit ? 1 : 0; A.sitWait = wantSit ? 1 : 0; A.snap = false;
    }
    // obstacles: her skirt, the flower, the cake, and the cat. Segments [ax, az, bx, bz, r].
    const obs = this._obs || (this._obs = []);
    obs.length = 0;
    if (landed) {
      if (ctx.kneel > 0.25 && mode === 'flower') obs.push([her.x, her.z, ctx.flower.x, ctx.flower.z, 0.45]);
      else obs.push([her.x, her.z, her.x, her.z, 0.44]);
    }
    obs.push([ctx.flower.x, ctx.flower.z, ctx.flower.x, ctx.flower.z, 0.3]);
    obs.push([ctx.cake.x, ctx.cake.z, ctx.cake.x, ctx.cake.z, 0.56]);
    if (C && ctx.catVisible) obs.push([C.x, C.z, C.x, C.z, 0.34]);
    const near = (o, px, pz, out) => {
      const sx = o[2] - o[0], sz = o[3] - o[1], sl = sx * sx + sz * sz;
      const f = sl > 1e-6 ? clamp(((px - o[0]) * sx + (pz - o[1]) * sz) / sl, 0, 1) : 0;
      out[0] = o[0] + sx * f; out[1] = o[1] + sz * f;
      return Math.hypot(px - out[0], pz - out[1]);
    };
    const cp = this.tmp;
    for (const o of obs) {
      const d = near(o, tx, tz, cp);
      if (d < o[4] + 0.04) {
        const k = d > 1e-4 ? (o[4] + 0.04) / d : 1;
        tx = cp[0] + (tx - cp[0]) * k; tz = cp[1] + (tz - cp[1]) * k;
        if (d <= 1e-4) tx += o[4] + 0.04;
      }
    }
    A.tx = tx; A.tz = tz;
    dx = tx - A.x; dz = tz - A.z;
    const arrive = Math.min(vmax, Math.hypot(dx, dz) * arriveK);
    const dl = Math.hypot(dx, dz) || 1;
    let dvx = (dx / dl) * arrive + v.hv.x * ff, dvz = (dz / dl) * arrive + v.hv.z * ff;
    const dsp = Math.hypot(dvx, dvz), cap = vmax + herSp * ff;
    if (dsp > cap) { dvx *= cap / dsp; dvz *= cap / dsp; }
    const cp2 = this._cp2 || (this._cp2 = [0, 0]);
    const blocked = (o) => { for (let k = 1; k <= 6; k++) { const f = k / 6; if (near(o, lerp(A.x, tx, f), lerp(A.z, tz, f), cp2) < o[4] + 0.02) return true; } return false; };
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const d = near(o, A.x, A.z, cp);
      if (d > o[4] + 0.3 || d < 1e-5 || !blocked(o)) continue;
      const nx = (A.x - cp[0]) / d, nz = (A.z - cp[1]) / d;
      const dn = dvx * nx + dvz * nz;
      if (dn >= 0) continue;
      const gx = tx - cp[0], gz = tz - cp[1];
      let s2 = nx * gz - nz * gx >= 0 ? 1 : -1;
      const key = 'av' + i;
      if (A[key] && time - A[key].t < 1.5) s2 = A[key].s; else A[key] = { s: s2, t: time };
      A[key].t = time;
      const m = Math.hypot(dvx, dvz);
      const w = smoothstep(o[4] + 0.3, o[4] + 0.05, d);
      const tvx = -nz * s2 * m, tvz = nx * s2 * m;
      dvx = lerp(dvx - nx * dn, tvx, w); dvz = lerp(dvz - nz * dn, tvz, w);
    }
    const up = 1 - smoothstep(0.3, 0.8, A.sit);
    const ka = 1 - Math.exp(-dt * 7);
    A.vx += (dvx * up - A.vx) * ka; A.vz += (dvz * up - A.vz) * ka;
    A.x += A.vx * dt; A.z += A.vz * dt;
    for (const o of obs) {
      const d = near(o, A.x, A.z, cp);
      if (d < o[4] && d > 1e-5) {
        const nx = (A.x - cp[0]) / d, nz = (A.z - cp[1]) / d;
        A.x = cp[0] + nx * o[4]; A.z = cp[1] + nz * o[4];
        const vn = A.vx * nx + A.vz * nz;
        if (vn < 0) { A.vx -= nx * vn; A.vz -= nz * vn; }
      }
    }
    const sp = Math.hypot(A.vx, A.vz);
    // --- face ---
    const moving = sp > 0.16;
    const yawPrev = A.yaw;
    if (spinV !== 0) A.yaw = wrapA(A.yaw + spinV * dt);
    else {
      const wantYaw = moving ? Math.atan2(A.vx, A.vz) : faceYaw;
      const yawErr = Math.abs(wrapA(wantYaw - A.yaw));
      if (yawErr > 0.6) A.turnUp = 1; else if (yawErr < 0.12) A.turnUp = 0;
      const yawRate = moving ? 10 : A.sit > 0.5 && !A.turnUp ? 1.5 : 4;
      A.yaw = approachA(A.yaw, wantYaw, 1 - Math.exp(-dt * yawRate));
    }
    const turnRate = wrapA(A.yaw - yawPrev) / Math.max(dt, 1e-3);
    const arrived = Math.hypot(tx - A.x, tz - A.z) < 0.12 && sp < 0.15;
    A.sitWait = arrived && wantSit ? (A.sitWait || 0) + dt : 0;
    const sitT = A.sitWait > 0.25 && !(A.turnUp && spinV === 0 && Math.abs(turnRate) > 0.3) ? 1 : 0;
    A.sit += (sitT - A.sit) * (1 - Math.exp(-dt * (sitT > A.sit ? 5 : 10)));
    // --- body animation ---
    const spM = sp / DOG_SCALE;
    const gK = smoothstep(0.35, 0.9, spM), bK = smoothstep(1.45, 2.3, spM);
    A.gK = lerp(A.gK, gK, 1 - Math.exp(-dt * 5)); A.bK = lerp(A.bK, bK, 1 - Math.exp(-dt * 5));
    // (quick little steps: a toy dog's busy trot)
    const stride = lerp(lerp(0.07, 0.11, A.gK), 0.22, A.bK);
    const stepSp = Math.max(spM, Math.abs(turnRate) * 0.045);
    A.phase = (A.phase + Math.min(stepSp / (2 * stride), 7) * dt) % 1;
    let hop = 0;
    if (A.hop0 !== undefined) { const f = (time - A.hop0) / A.hopDur; if (f >= 0 && f < 1) hop = A.hopH * Math.sin(Math.PI * f); }
    // the head: toward what it watches, with a curious tilt now and then
    const sY = Math.sin(A.yaw), cY = Math.cos(A.yaw);
    const hx = A.x + sY * 0.17 * DOG_SCALE, hz = A.z + cY * 0.17 * DOG_SCALE, hy = A.y + 0.31 * DOG_SCALE;
    const lx = look.x - hx, ly = look.y - hy, lz = look.z - hz;
    const fz2 = lx * sY + lz * cY, fx2 = lx * cY - lz * sY;
    let yawL = Math.atan2(fx2, fz2);
    let pitchL = -Math.atan2(ly, Math.hypot(fx2, fz2));
    const tooFar = Math.abs(yawL) > 1.35;
    yawL = clamp(yawL, -1.1, 1.1) * lookW;
    pitchL = clamp(pitchL, -1.0, 0.65) * lookW;
    if (tooFar) yawL *= 0.5;
    const kh = 1 - Math.exp(-dt * 8);
    A.hx = lerp(A.hx, yawL, kh); A.hy = lerp(A.hy, pitchL, kh);
    // (the famous head tilt: sitting, listening to her)
    const tilt = A.sit > 0.5 ? 0.32 * smoothstep(0.55, 1, Math.sin(time * 0.5 + 0.7)) * (Math.sin(time * 0.13) > 0 ? 1 : -1) : 0;
    A.hr = lerp(A.hr, tilt, 1 - Math.exp(-dt * 4));
    // blinks
    A.blinkT -= dt;
    if (A.blinkT <= 0) { A.b0 = time; A.blinkT = 2 + rnd() * 3.5; }
    let blink = 0;
    if (A.b0 !== undefined) { const f = (time - A.b0) / 0.16; if (f >= 0 && f < 1) blink = Math.sin(Math.PI * f); }
    // barks: a quick snap of the jaw, head up, ears forward
    let bark = 0;
    if (A.barks) {
      for (const b0 of A.barks) { const f = (time - b0) / 0.22; if (f >= 0 && f < 1) bark = Math.max(bark, Math.sin(Math.PI * f)); }
      if (A.barks.every((b0) => time - b0 > 0.3)) A.barks = null;
    }
    // breathing and panting: after running it pants, tongue out; smiling, mouth open
    {
      const spx = sp / DOG_SCALE;
      A.exert = clamp((A.exert || 0) + (spx > 1.2 ? dt * 0.3 * spx : -dt * 0.06), 0, 1);
      const pantT = ctx.reduced ? 0 : Math.max(smile * 0.8, A.exert);
      A.pant = lerp(A.pant || 0, pantT, 1 - Math.exp(-dt * 4));
      const rate = lerp(0.45, 2.6, Math.max(A.exert, A.pant * 0.6));
      A.bph = ((A.bph || 0) + rate * dt) % 1;
      const ph = A.bph * TAU;
      P.breath = (Math.sin(ph) + 0.25 * Math.sin(2 * ph - 0.6)) * lerp(0.0025, 0.005, Math.max(A.exert, A.pant)) * (1 - 0.7 * Math.min(1, spx)) * (ctx.reduced ? 0.5 : 1);
      const pantBob = Math.sin(ph) * 0.12 * A.pant;
      P.open = clamp(A.pant * (0.62 + pantBob) + bark * 0.85, 0, 1.1);
      P.tongue = clamp(A.pant * (0.9 + pantBob * 0.5) * (1 - bark * 0.6), 0, 1);
    }
    // the tail: wagging, faster and wider the happier it is; trailing round turns
    const ex2 = ctx.reduced ? Math.min(excite, 0.5) : excite;
    A.excite = lerp(A.excite ?? 0.4, ex2, 1 - Math.exp(-dt * 3));
    A.wag = ((A.wag || 0) + dt * (3 + 25 * Math.pow(A.excite, 1.5)) * (A.sit > 0.5 ? 0.85 : 1)) % (TAU * 1000);
    {
      const goal = clamp(-turnRate * 0.06, -0.5, 0.5);
      A.tlv = (A.tlv || 0) + ((goal - (A.tl || 0)) * 38 - (A.tlv || 0) * 6.5) * dt;
      A.tl = (A.tl || 0) + A.tlv * dt;
    }
    // ear flicks
    A.earT -= dt;
    if (A.earT <= 0) { A.e0 = time; A.eSide = rnd() < 0.5 ? 0 : 1; A.earT = 2 + rnd() * 4; }
    const ef = A.e0 !== undefined ? (time - A.e0) / 0.25 : 9;
    const flick = ef >= 0 && ef < 1 ? Math.sin(Math.PI * ef) * 0.45 : 0;
    A.startle = lerp(A.startle || 0, startle, 1 - Math.exp(-dt * 14));
    A.stand = lerp(A.stand || 0, stand, 1 - Math.exp(-dt * 10));
    A.bow = lerp(A.bow || 0, bow, 1 - Math.exp(-dt * 9));
    A.flop = lerp(A.flop || 0, flop, 1 - Math.exp(-dt * 5));
    // --- pose ---
    P.sit = A.sit; P.phase = A.phase; P.speed = Math.max(spM, stepSp > 0.05 ? 0.05 : 0); P.gK = A.gK; P.bK = A.bK;
    P.stride = stride * Math.min(1, stepSp / 0.22 + 0.2);
    P.lift = lerp(lerp(0.024, 0.032, A.gK), 0.044, A.bK);
    P.hop = hop; P.pitch = -0.08 * A.startle; P.roll = clamp(-turnRate * sp * 0.04, -0.25, 0.25);
    P.headYaw = A.hx * (1 - A.bow * 0.5); P.headPitch = A.hy - 0.18 * bark + 0.15 * A.bow; P.headRoll = A.hr * (1 - A.stand) * (1 - Math.min(1, sp));
    P.wag = A.wag; P.wagAmp = lerp(0.12, 0.55, A.excite) * (1 - 0.5 * A.flop);
    P.tailLift = A.excite; P.tailLag = ctx.reduced ? 0 : A.tl;
    P.earL = A.eSide === 0 ? flick : 0; P.earR = A.eSide === 1 ? flick : 0;
    P.earBack = Math.max(earBack, 0.6 * A.startle) * (1 - 0.8 * bark);
    P.blink = Math.max(blink, 0.6 * A.startle);
    P.happy = Math.max(happy, 0.35 * A.pant * (A.sit > 0.5 ? 1 : 0.5), 0.5 * A.flop);
    P.pupil = pupil;
    P.gazeX = clamp((yawL - A.hx) * 1.5, -1, 1); P.gazeY = clamp(-(pitchL - A.hy) * 1.5, -1, 1);
    P.crouch = 0; P.reach = 0; P.time = time;
    P.stretch = A.bow; P.leap = 0;
    P.stand = A.stand; P.paddle = paddle;
    P.flop = A.flop; P.flopSide = A.flopSide || 1;
    this.pose(P);
    A.y = this.place(A.x, A.z, A.yaw);
    // (startled, its fur stands up)
    this.shellMat.uniforms.uShellLen.value = SHELL_LEN * (1 + 0.5 * A.startle);
    this.shadow.material.uniforms.uOpacity.value = 0.36 * (1 - hop * 6);
    const cd = Math.hypot(ctx.cam.x - A.x, ctx.cam.z - A.z);
    this.group.visible = t > 0.17 && cd < 120;
    // (the coat's outer locks shorten only far off, where the whole dog is a few pixels)
    const fade = 1 - smoothstep(11, 16, Math.hypot(ctx.cam.x - A.x, ctx.cam.y - A.y - 0.25, ctx.cam.z - A.z));
    this.shellMat.uniforms.uShellFade.value = fade;
    this.shell.visible = fade > 0.01;
    this.active = this.group.visible && (sp > 0.25 || mode === 'greet' || mode === 'lap' || hop > 0 || !!A.idle || bark > 0);
    this.barkNow = bark;
  }

  // Place in the world: feet on the ground at (x, z), facing yaw, tilted with the slope
  place(x, z, yaw) {
    const y = heightAt(x, z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const L = 0.17 * DOG_SCALE;
    const hf = heightAt(x + fx * L, z + fz * L), hb = heightAt(x - fx * L, z - fz * L);
    const slope = Math.atan2(hf - hb, 2 * L);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const hl = heightAt(x + lx * 0.11, z + lz * 0.11), hr = heightAt(x - lx * 0.11, z - lz * 0.11);
    const side = Math.atan2(hl - hr, 0.22) * 0.6;
    this.mesh.position.set(x, Math.min(y, (hf + hb) / 2) + 0.004, z);
    this.mesh.rotation.set(-slope, yaw, side, 'YXZ');
    const sh = this.shadow;
    sh.position.set(x, y + 0.02, z);
    sh.rotation.set(0, yaw, 0);
    return y;
  }
}
