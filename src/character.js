import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial, COMMON, glowMaterial } from './shaders.js';
import { lerp, clamp, TAU, mulberry32, smoothstep } from './math.js';
import { headGeometry, faceZ, faceUV, FACE, HEAD, handGeometry, shoeGeometry, torsoGeometry, bandGeometry, torsoBack, torsoFrontZ, torsoBackZ, necklineFrill, skirtGeometry, skirtProfile, sleeveGeometry, limbGeometry, armGeometry, lockTube, mergeGeos, FINGERS } from './dollparts.js';

function smooth01(x) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }
const HEAD_SCALE = 1.5;
// her legs (the skirt) a little shorter than the base model: cuter proportions
const SK = 0.925;
// where the head sits on the torso, and the skull centre inside the head
const HEAD_POS = new THREE.Vector3(0, 0.376, 0.01);
const SKULL = new THREE.Vector3(0, 0.118, 0.008);
// her hand tucking her hair behind her ear (left arm; mirrored for the right):
// shoulder x, y, z, elbow, wrist x, y, z (solved against her head and hair)
const TUCK_A = [-1.319, 0.076, 0.889, -1.963, -0.401, 0.798, 0.311];
const TUCK_B = [-1.925, 0.163, 0.908, -1.999, 0.396, 0.932, -0.329];
// a hand held out in front of her, palm up (solved: palm level, a little below her chest)
const PERCH = [-0.183, -0.485, 0.219, -1.812, -1.476, 0.738, 1.936];
// holding her cat (solved against her body): reaching down to it while kneeling, then one arm
// under its rump and the other across its back (mirrored by the side it is held on)
const HOLD_REACH = [-0.23, -0.527, 0.225, -1.001, -1.366, -0.038, 0.082];
const HOLD_UNDER = [-0.076, -0.063, 0.34, -1.049, 1.321, 0.464, -2.041];
const HOLD_ACROSS = [-1.255, -0.785, -0.436, -0.776, -0.279, 0.751, -0.365];
// booping her cat's nose with one finger (solved: kneeling, the cat sitting at the pet spot)
// kneeling, a hand held out palm up for her cat's paw ("shake!") (solved)
const PAW = [-0.61, 0.375, -0.018, -0.378, 0.495, 1.61, -0.926];
// a peace sign beside her face, palm to us, two fingers up (solved; fingers set by the rig)
const PEACE = [-0.912, -0.084, 0.472, -1.758, 0.387, -1.083, 0.817];
// a shy giggle: her loosely curled fingers to her lips, the back of her hand to us (solved)
const COVER = [-1.033, -0.526, 0.077, -1.935, 0.596, 1.383, -0.62];
// an arm round her cat sitting beside her as she kneels, the hand on its shoulders (solved)
const AROUND = [-0.035, 0.144, 0.353, -0.048, -0.03, 0.684, 0.122];
const BOOP = [-0.352, -0.493, -0.079, -1.972, 0.98, 0.701, 1.778];
// torso space -> skull space (hair is built in skull space, but drapes over her body)
const toSkull = (x, y, z) => new THREE.Vector3(x / HEAD_SCALE, (y - HEAD_POS.y) / HEAD_SCALE - SKULL.y, (z - HEAD_POS.z) / HEAD_SCALE - SKULL.z);
// her bodice surface in torso space (its mesh is scaled 1.07, 0.95, 1)
const chestZ = (x, y) => torsoFrontZ(x / 1.07, y / 0.95);
const backZ = (x, y) => torsoBackZ(x / 1.07, y / 0.95);

// ---------------------------------------------------------------------------
// Hair, in skull space (origin at the skull centre, +z forward)
function headPt(th, ph, k) {
  return new THREE.Vector3(
    Math.sin(th) * Math.sin(ph) * HEAD.rx * k,
    Math.cos(th) * HEAD.ry * k + 0.004,
    Math.sin(th) * Math.cos(ph) * HEAD.rz * k - 0.004,
  );
}
const outOf = (p) => new THREE.Vector3(p.x, p.y - 0.004, p.z + 0.004).normalize();
const curve = (ctrl, n) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(n);

// the scalp: a smooth shell over the skull with a soft parting and a hairline
// that sweeps from the forehead down behind the ears to the nape
function capGeometry(rows = 26, cols = 84) {
  const pos = [], uv = [], ao = [], idx = [];
  const partAt = 0.0;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const ph = (i / cols) * TAU - Math.PI; // 0 = front
      const front = (Math.cos(ph) + 1) / 2;
      const tmax = lerp(0.8 * Math.PI, 0.25 * Math.PI, Math.pow(front, 2.4));
      const th = (j / rows) * tmax;
      const pa = Math.abs(((ph - partAt + Math.PI) % TAU + TAU) % TAU - Math.PI);
      const part = 0.012 * Math.exp(-Math.pow(pa / 0.06, 2)) * smooth01((th - 0.05 * Math.PI) / (0.15 * Math.PI)) * front;
      const vol = 0.05 * Math.sin(Math.min(th / (0.6 * Math.PI), 1) * Math.PI * 0.5) * (1 - front * 0.55);
      const k = 1.04 + vol - part;
      const p = headPt(th, ph, k);
      pos.push(p.x, p.y, p.z);
      uv.push((i / cols) * 1.5, j / rows);
      ao.push(0.75 + 0.25 * (1 - j / rows) - part * 8);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(gridTangents(pos, rows, cols), 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// the way the hair runs over a grid of rows (crown to ends) x cols: down the rows
function gridTangents(pos, rows, cols) {
  const tan = new Float32Array((rows + 1) * (cols + 1) * 4);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const k = j * (cols + 1) + i;
    const a = Math.max(j - 1, 0) * (cols + 1) + i, b = Math.min(j + 1, rows) * (cols + 1) + i;
    let x = pos[b * 3] - pos[a * 3], y = pos[b * 3 + 1] - pos[a * 3 + 1], z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    tan[k * 4] = x / l; tan[k * 4 + 1] = y / l; tan[k * 4 + 2] = z / l;
  }
  return tan;
}

// one stray little curl springing from her crown (an "ahoge"), small and soft
function ahogeGeometry() {
  const p0 = headPt(0.07 * Math.PI, 0.32, 1.0);
  const up = outOf(p0);
  // the curl turns diagonally, so it reads as a curl from the front and from the side
  const fwd = new THREE.Vector3(0.85, 0, 0.6).normalize();
  const ctrl = [
    p0,
    p0.clone().addScaledVector(up, 0.014).addScaledVector(fwd, 0.006),
    p0.clone().addScaledVector(up, 0.026).addScaledVector(fwd, 0.0),
    p0.clone().addScaledVector(up, 0.03).addScaledVector(fwd, -0.014),
    p0.clone().addScaledVector(up, 0.024).addScaledVector(fwd, -0.026),
  ];
  // starts a little inside the scalp so it never shows a seam when it bounces
  ctrl[0] = p0.clone().addScaledVector(up, -0.004);
  const pts = curve(ctrl, 10);
  const os = pts.map(() => new THREE.Vector3(0.6, 0, -0.85).normalize());
  const ws = pts.map((_, k) => 0.012 * (1 - 0.5 * k / 10));
  const ts = pts.map(() => 0.0045);
  const g = lockTube(pts, ws, ts, os, { segs: 5, tip: 'point', capRings: 2, reachK: 1.6 });
  g.translate(-p0.x, -p0.y, -p0.z);
  return { geo: g, base: p0 };
}

// her bangs (from her 3D scan): parted in the middle, two curtain sweeps arch
// away over the corners of her forehead to her temples, and a few thin
// see-through wisps fall between them
function bangsGeometry() {
  const list = [];
  const P = (th, ph, k) => headPt(th * Math.PI, ph, k);
  for (const s of [-1, 1]) {
    [
      // [part-side phi, upper-forehead phi, temple phi, end th, width, thickness]
      { a: 0.05, b: 0.3, c: 0.64, e: 0.47, f: 0.84, w: 0.05, t: 0.017 },
      { a: 0.16, b: 0.44, c: 0.78, e: 0.53, f: 0.98, w: 0.054, t: 0.018 },
      { a: 0.3, b: 0.62, c: 0.95, e: 0.58, f: 1.12, w: 0.05, t: 0.017 },
    ].forEach(({ a, b, c, e, f, w, t: tk }, j) => {
      const ctrl = [
        P(0.08, s * a, 0.98),
        P(0.18, s * (a + 0.03), 1.06),
        P(0.3, s * b, 1.1),
        P(0.4 + j * 0.02, s * c, 1.11),
        P(e, s * f, 1.1),
      ];
      const pts = curve(ctrl, 12);
      const os = pts.map(outOf);
      const ws = pts.map((_, k) => { const t = k / (pts.length - 1); return w * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(t * 1.4, 1))) * (1 - 0.6 * smooth01((t - 0.62) / 0.38)); });
      const ts = pts.map((_, k) => { const t = k / (pts.length - 1); return tk * (1 - 0.35 * smooth01((t - 0.6) / 0.4)); });
      list.push(lockTube(pts, ws, ts, os, { segs: 6, tip: 'point', reachK: 1.4, capRings: 2 }));
    });
  }
  // her see-through bangs: a light veil of fine wisps across her forehead - little clumps
  // of strands of different widths and lengths, each curving softly in toward her brows and
  // tapering to a fine point, with finer single strands between them (the forehead shows
  // through)
  {
    const rb = mulberry32(4242);
    const wisp = (ph, tip, w, a, f, drift, th0 = 0.11, conv = 0) => {
      const pts = [];
      const M = 12;
      for (let k = 0; k <= M; k++) {
        const t = k / M;
        const th = lerp(th0, tip, t) * Math.PI;
        // up off the scalp, over the hairline, then curving in to lie near her forehead
        const kk = 0.99 + 0.074 * smooth01(t / 0.28) - 0.05 * smooth01((t - 0.45) / 0.55);
        // (strands of a clump drawn together toward their shared tip)
        pts.push(headPt(th, ph + a * Math.sin(Math.PI * t * f) + drift * t * t - conv * smooth01((t - 0.15) / 0.85), kk));
      }
      const os = pts.map(outOf);
      const ws = pts.map((_, k) => { const t = k / M; return w * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(t * 2.2, 1))) * (1 - 0.8 * smooth01((t - 0.32) / 0.68)); });
      const ts = pts.map((_, k) => 0.0042 * (1 - 0.45 * (k / M)));
      list.push(lockTube(pts, ws, ts, os, { segs: 5, tip: 'point', capRings: 3, reachK: 2.4, tw: 0.25 }));
    };
    // little clumps: two or three strands spread at the hairline, drawn together into one
    // fine point (soft triangles, the forehead showing between them)
    const C = 6;
    for (let ci = 0; ci < C; ci++) {
      const u = (ci / (C - 1)) * 2 - 1;
      const pc = u * 0.29 + (rb() - 0.5) * 0.02;
      const tip = 0.422 + 0.03 * rb() + 0.01 * (1 - Math.abs(u));
      const n = ci === 0 || ci === C - 1 ? 2 : (ci % 2 ? 3 : 2);
      const a = (rb() - 0.5) * 0.03, f = 0.8 + rb() * 0.6, drift = Math.sign(u) * 0.03 * Math.abs(u);
      for (let j = 0; j < n; j++) {
        const o = ((j / (n - 1)) * 2 - 1) * (n === 3 ? 0.042 : 0.03);
        wisp(pc + o, tip - 0.012 * Math.abs(o) / 0.04 - 0.006 * rb(), 0.0085 + 0.004 * rb(), a, f, drift, 0.11, o * 0.92);
      }
    }
    // and a few fine loose strands in the gaps
    for (let i = 0; i < 5; i++) {
      const u = ((i + 0.5) / 5) * 2 - 1;
      wisp(u * 0.27 + (rb() - 0.5) * 0.03, 0.405 + 0.03 * rb(), 0.0042 + 0.0015 * rb(), (rb() - 0.5) * 0.05, 1 + rb(), Math.sign(u) * 0.03 * Math.abs(u), 0.13);
    }
  }
  for (const sd of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 7; k++) {
      const t = k / 7;
      pts.push(headPt(lerp(0.09, 0.3, t) * Math.PI, sd * (0.03 + 0.15 * t * t), 1.0 + 0.08 * Math.sin(Math.PI * Math.min(t * 1.2, 1))));
    }
    const os = pts.map(outOf);
    list.push(lockTube(pts, pts.map((_, k) => 0.0065 * (1 - 0.5 * k / 7)), pts.map(() => 0.004), os, { segs: 4, tip: 'point', capRings: 2, reachK: 2.0, tw: 0.25 }));
  }
  return mergeGeos(list);
}

// Her sash bow (in the bow's frame: +x across her back, +y up, -z away from her back)
function bowGeometry(lo) {
  const list = [];
  const N = lo ? 22 : 30, M = lo ? 4 : 6;
  for (const s of [-1, 1]) {
    const pos = [], uv = [], idx = [];
    const Lx = 0.086, W0 = 0.056, tilt = 0.26, ca = Math.cos(s * tilt), sa = Math.sin(s * tilt);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const far = (1 - Math.cos(a)) / 2;   // 0 at the knot, 1 at the loop's outer end
      // out along x and back; the outer layer puffs out behind, the inner one lies on her
      const sn = Math.sin(a);
      const px = s * Lx * far;
      const pz = -sn * (sn > 0 ? 0.026 : 0.006) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, far * 1.1)));
      // gathered narrow at the knot, full and rounded at the outer end
      const W = W0 * (0.26 + 0.74 * Math.pow(Math.sin(Math.PI * 0.5 * Math.min(1, far * 1.25)), 0.75)) * (1 - 0.1 * far * far);
      for (let j = 0; j <= M; j++) {
        const v = j / M - 0.5;
        // (the ribbon's edges curl softly back; a crease runs out from the knot)
        const y = v * W;
        const z = pz - 0.005 * (1 - 4 * v * v) * Math.sign(-sn || 1) * (0.4 + 0.6 * far);
        const xr = px * ca - y * sa, yr = px * sa + y * ca;
        pos.push(xr, yr + 0.004, z);
        uv.push(i / N, j / M);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j, b = a + 1, c = a + M + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    list.push(g);
  }
  // the knot: a short band of ribbon wrapped round the gathered middle
  {
    const pos = [], uv = [], idx = [];
    const R = lo ? 14 : 20, C = 4;
    for (let i = 0; i <= R; i++) {
      const b = (i / R) * TAU;
      for (let j = 0; j <= C; j++) {
        const v = j / C - 0.5;
        const bulge = 1 - 0.35 * 4 * v * v;
        pos.push(v * 0.026, Math.cos(b) * 0.0165 * bulge + 0.004, -Math.sin(b) * 0.0135 * bulge - 0.004);
        uv.push(i / R, j / C);
      }
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const a = i * (C + 1) + j, b = a + 1, c = a + C + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    list.push(g);
  }
  return mergeGeometries(list);
}

// A lock whose end parts into a few soft clumps, side by side across its width, drifting
// a little apart and each tapering to its own point at its own length (instead of a blunt
// end or a broom of thin strands)
function clumpLock(pts, ws, ts, os, opts, { at = 0.78, n = 2, spread = 0.6, lens = null, thin = 0.9 } = {}) {
  const N = pts.length;
  const ks = Math.round(at * (N - 1));
  const list = [];
  // the lock down to where it parts (its end hidden inside the clumps)
  list.push(lockTube(pts.slice(0, ks + 1), ws.slice(0, ks + 1), ts.slice(0, ks + 1), os.slice(0, ks + 1), { ...opts, wisp: false, tip: 'round', capRings: 2, uvT: [0, ks / (N - 1)] }));
  const T = new THREE.Vector3(), O = new THREE.Vector3(), S = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    const c = n === 1 ? 0 : (j / (n - 1)) * 2 - 1;
    const len = lens ? lens[j % lens.length] : 1;
    const k0 = Math.max(0, ks - 2);
    const kEnd = Math.max(ks + 1, Math.round(lerp(ks + 1, N - 1, len)));
    const P = [], W = [], Tk = [], Os = [];
    for (let k = k0; k <= kEnd; k++) {
      if (k < N - 1) T.subVectors(pts[k + 1], pts[k]); else T.subVectors(pts[k], pts[k - 1]);
      T.normalize();
      O.copy(os[k]).addScaledVector(T, -os[k].dot(T)).normalize();
      S.crossVectors(T, O).normalize();
      const f = clamp((k - ks) / Math.max(1, N - 1 - ks), 0, 1);
      const off = c * ws[k] * 0.5 * (1 - 1 / n) * (1 + spread * f * f);
      // (the clumps also curl a little in toward the lock's middle at the very end)
      P.push(pts[k].clone().addScaledVector(S, off).addScaledVector(O, -0.004 * f * f * Math.abs(c)));
      W.push(ws[k] * (1 / n) * 1.55);
      Tk.push(ts[k] * thin);
      Os.push(os[k]);
    }
    list.push(lockTube(P, W, Tk, Os, { ...opts, wisp: false, tip: 'point', capRings: 3, uvT: [k0 / (N - 1), kEnd / (N - 1)] }));
  }
  return mergeGeos(list);
}

// long curtains falling in front of her shoulders: from her temples over the
// tops of her shoulders, then parting into softer locks that fan out a little as
// they fall over her chest (the dress shows between them), ends tapering and
// turning under
function frontHairGeometry(side) {
  const s = side;
  const list = [];
  [
    // ph: where it leaves the head; x0/x1: across her chest at the shoulder / at the
    // end; end: the end's height; w: width; t: thickness; lift: off the dress
    { ph: 1.0, x0: 0.098, x1: 0.074, end: 0.135, w: 0.03, t: 0.017, lift: 0.014 },
    { ph: 1.19, x0: 0.106, x1: 0.093, end: 0.07, w: 0.04, t: 0.02, lift: 0.017 },
    { ph: 1.38, x0: 0.115, x1: 0.115, end: 0.05, w: 0.042, t: 0.021, lift: 0.019 },
    { ph: 1.58, x0: 0.124, x1: 0.137, end: 0.1, w: 0.032, t: 0.018, lift: 0.016 },
  ].forEach(({ ph, x0, x1, end, w, t: tk, lift }, li) => {
    const wv = (i) => 0.005 * Math.sin(i * 1.7 + ph * 2.3);
    const body = (x, y, l) => { const z = chestZ(x, y) + l; return toSkull(x, y, z); };
    const X = (f) => lerp(x0, x1, f);
    const ctrl = [
      headPt(0.26 * Math.PI, s * ph, 0.99),
      headPt(0.34 * Math.PI, s * ph, 1.07),
      headPt(0.5 * Math.PI, s * ph * 1.02, 1.14),
      headPt(0.66 * Math.PI, s * ph * 0.97, 1.18),
      // over the top of her shoulder
      body(s * (x0 + 0.004), 0.372, lift + 0.014),
      body(s * (X(0.15) + wv(1)), 0.3, lift + 0.002),
      body(s * (X(0.45) + wv(2)), 0.2, lift),
      body(s * (X(0.75) + wv(3)), lerp(0.2, end, 0.6), lift),
      body(s * (X(0.95) + wv(4)), end + 0.025, lift - 0.001),
      // the end turns softly under
      body(s * X(1), end, lift - 0.009),
    ];
    const pts = curve(ctrl, 22);
    const front = new THREE.Vector3(s * 0.25, 0.1, 1).normalize();
    const os = pts.map((p, k) => { const f = k / (pts.length - 1); return outOf(p).lerp(front, smooth01((f - 0.12) / 0.2)).normalize(); });
    // full over the shoulder, then each lock narrows toward a fine end
    const ws = pts.map((_, k) => { const f = k / (pts.length - 1); return (0.034 + (w - 0.034) * smooth01((f - 0.2) / 0.25)) * (1 - 0.7 * smooth01((f - 0.66) / 0.34)); });
    const ts = pts.map((_, k) => { const f = k / (pts.length - 1); return lerp(0.022, tk, smooth01((f - 0.2) / 0.25)) * (1 - 0.5 * smooth01((f - 0.72) / 0.28)); });
    list.push(lockTube(pts, ws.map((v, k) => v * (1 - 0.6 * smooth01((k / (pts.length - 1) - 0.8) / 0.2))), ts, os, { segs: 6, tip: 'point', capRings: 4, reachK: 4.5 }));
  });
  return mergeGeos(list);
}

// long hair down her back: a fan of thick locks over a soft inner sheet. Below the
// head the locks follow her back (resting on it), a little narrower than her
// shoulders, with soft waves and ends that turn under
function backLockCtrl(c, endY, k0 = 0.99, inset = 0) {
  const ph = Math.PI - c * 1.05;
  const W = (y) => c * (0.084 + 0.012 * smooth01((0.36 - y) / 0.2) - 0.006 * smooth01((0.1 - y) / 0.2));
  const wv = (i) => 0.006 * Math.sin(c * 2.6 + i * 1.9);
  const on = (y, gap, i) => { const x = W(y) + wv(i); return toSkull(x, y, -(backZ(x, y) + gap - inset)); };
  // (from the crown, lying on the scalp, so they grow out of it instead of breaking
  // through it in a ring)
  const kc = (th) => 1.046 + 0.05 * Math.sin(Math.min(th / (0.6 * Math.PI), 1) * Math.PI * 0.5) + (k0 < 0.985 ? -0.01 : 0.006);
  return [
    headPt(0.05 * Math.PI, ph, 0.99),
    headPt(0.16 * Math.PI, ph, kc(0.16 * Math.PI) - 0.004),
    headPt(0.3 * Math.PI, ph, Math.max(kc(0.3 * Math.PI), 1.07)),
    headPt(0.48 * Math.PI, ph, 1.1 + 0.02 * (1 - Math.abs(c))),
    headPt(0.7 * Math.PI, ph, 1.12),
    on(0.33, 0.024, 1),
    on(0.21, 0.02, 2),
    on(0.09, 0.019, 3),
    on(lerp(0.09, endY, 0.6), 0.019, 4),
    on(endY, 0.008, 5),
  ];
}
const backLockOut = (p, c, t) => outOf(p).lerp(new THREE.Vector3(c * 0.35, 0, -1).normalize(), smooth01((t - 0.15) / 0.25)).normalize();
function backHairGeometry() {
  const list = [];
  const rnd = mulberry32(808);
  const N = 11;
  // layered ends (torso height): longest at the centre of her back, a soft U
  const layerY = (c) => 0.058 + 0.024 * c * c;
  for (let i = 0; i < N; i++) {
    const c = (i / (N - 1)) * 2 - 1; // -1 .. 1 across her back
    const pts = curve(backLockCtrl(c, layerY(c) + (rnd() - 0.5) * 0.02), 20);
    const os = pts.map((p, k) => backLockOut(p, c, k / (pts.length - 1)));
    const ws = pts.map((_, k) => { const t = k / (pts.length - 1); return (0.05 + 0.02 * Math.sin(Math.min(t * 2, 1) * Math.PI * 0.5)) * (1 - 0.55 * smooth01((t - 0.72) / 0.28)) * (0.25 + 0.75 * smooth01(t / 0.16)); });
    const ts = pts.map((_, k) => { const t = k / (pts.length - 1); return 0.026 * (1 - 0.65 * smooth01((t - 0.72) / 0.28)); });
    list.push(lockTube(pts, ws.map((v, k) => v * (1 - 0.6 * smooth01((k / (pts.length - 1) - 0.8) / 0.2))), ts, os, { segs: 6, tip: 'point', capRings: 4, reachK: 4.5 }));
  }
  // inner sheet so no gaps show between the locks: it follows the same fall a
  // little inside the locks, starts under the scalp and stops short of the tips
  const rows = 16, cols = 10;
  const pos = [], uv = [], ao = [], idx = [];
  for (let i = 0; i <= cols; i++) {
    const c = ((i / cols) * 2 - 1) * 0.93;
    const ctrl = backLockCtrl(c, layerY(c) + 0.05, 0.97, 0.009);
    ctrl[0] = headPt(0.4 * Math.PI, Math.PI - c * 1.05, 0.98);
    ctrl[1] = headPt(0.55 * Math.PI, Math.PI - c * 1.05, 1.02);
    const pts = curve(ctrl.slice(0, 2).concat(ctrl.slice(4)), rows);
    pts.forEach((p, k) => {
      const t = k / rows;
      const o = backLockOut(p, c, 0.2 + t);
      p.addScaledVector(o, -0.008 * smooth01(t / 0.25));
      p.x *= 0.96;
      pos.push(p.x, p.y, p.z);
      uv.push(i / cols * 2.0, t);
      ao.push(0.5);
    });
  }
  for (let i = 0; i < cols; i++) for (let k = 0; k < rows; k++) {
    const a = i * (rows + 1) + k, b = a + 1, c = a + rows + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sheet.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  {
    // (the hair runs down each column of the sheet)
    const tan = new Float32Array((cols + 1) * (rows + 1) * 4);
    for (let i = 0; i <= cols; i++) for (let k = 0; k <= rows; k++) {
      const o = i * (rows + 1);
      const a = o + Math.max(k - 1, 0), b = o + Math.min(k + 1, rows), q = o + k;
      const x = pos[b * 3] - pos[a * 3], y = pos[b * 3 + 1] - pos[a * 3 + 1], z = pos[b * 3 + 2] - pos[a * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      tan[q * 4] = x / l; tan[q * 4 + 1] = y / l; tan[q * 4 + 2] = z / l;
    }
    sheet.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 4));
  }
  sheet.setIndex(idx);
  sheet.computeVertexNormals();
  list.push(sheet);
  return mergeGeos(list);
}
// Feathered wing in its local frame: span +X, chord down (-Y), u along span, v across chord
export const WING_SPAN = 1.2;
function wingTop(u) { return 0.05 + 0.2 * Math.sin(Math.min(u * 1.25, 1) * Math.PI * 0.5) - 0.17 * Math.pow(u, 3); }
// (the root is gathered small and high on her shoulder blade - short little feathers there -
// so her long hair falls over her back between the wings instead of being hidden by them
// down to a thin strip)
function wingBottom(u) {
  const t = wingTop(u), sq = 0.3 + 0.7 * smooth01(u / 0.34);
  return t + (wingBottom0(u) - t) * sq;
}
// (and flat against her back there, tucked under her hair)
function wingFlat(u) { return 0.12 + 0.88 * smooth01(u / 0.3); }
function wingBottom0(u) {
  const base = -0.13 - 0.42 * Math.sin(Math.PI * Math.min(0.12 + u * 0.95, 1)) * (1 - 0.25 * u) + 0.12 * Math.pow(u, 4);
  const feathers = 0.05 * (1 - Math.abs(Math.sin(u * Math.PI * 6.5))) * (0.3 + u);
  return base - feathers;
}
export function wingPoint(u, v, out = new THREE.Vector3()) {
  const x = u * WING_SPAN;
  const yt = wingTop(u), yb = wingBottom(u);
  // tip pulls together
  const y = lerp(yt, yb, v);
  const z = (-0.07 * Math.sin(v * Math.PI) * (1 - u * 0.6) - 0.1 * v * u) * wingFlat(u);
  return out.set(x, y, z);
}
function wingGeometry(side) {
  // a soft membrane with three rows of low-poly feathers laid over it:
  // little coverts along the leading edge, longer coverts, then the long
  // flight feathers fanning out toward the tip (all in wing space, so the
  // shader's bend and golden dissolve still work)
  const pos = [], uv = [], kind = [], ft = [], idx = [];
  const rows = 8, cols = 18;
  const p = new THREE.Vector3();
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, v = j / rows;
      wingPoint(u, v, p);
      pos.push(p.x * side, p.y, p.z);
      uv.push(u, v);
      kind.push(0);
      ft.push(1);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  // wing-space (u, v) of a point (x along span, y down the chord)
  const uvOf = (x, y) => {
    const u = clamp(x / WING_SPAN, 0, 1);
    const t = wingTop(u), bt = wingBottom(u);
    return [u, clamp((t - y) / Math.max(t - bt, 0.02), 0, 1.25)];
  };
  const zOf = (u, v) => (-0.07 * Math.sin(Math.min(v, 1) * Math.PI) * (1 - u * 0.6) - 0.1 * Math.min(v, 1.2) * u) * wingFlat(u);
  const rnd = mulberry32(side > 0 ? 7 : 7);
  const feather = (u0, v0, len, w, ang, lift) => {
    // root on the wing surface, the vane running "down" the chord, turned toward the tip by ang
    const root = wingPoint(u0, v0, new THREE.Vector3());
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const sx = -dy, sy = dx; // across the vane, in the wing plane
    // a rounded vane: narrow at the quill, widest past the middle, a soft round tip
    const TS = [0, 0.22, 0.45, 0.66, 0.8, 0.9, 0.96, 1];
    const ring = [];
    TS.forEach((t) => {
      const body = Math.pow(Math.sin(Math.PI * 0.5 * Math.min(1, 0.25 + t * 1.6)), 0.6);
      const tip = t > 0.72 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.72) / 0.28, 2))) : 1;
      const half = w * 0.5 * body * tip;
      const cx = root.x + dx * len * t, cy = root.y + dy * len * t;
      const row = [];
      for (const o of [-1, 0, 1]) {
        const x = cx + sx * half * o, y = cy + sy * half * o;
        const [fu, fv] = uvOf(x, y);
        // cupped vane, with a soft ridge along the shaft, lying just over the layer below
        const fs = Math.sign(lift) || 1;
        const z = zOf(fu, fv) + (lift + fs * ((o === 0 ? 0.006 : 0) * Math.sin(Math.PI * Math.min(1, t * 1.2)) - 0.005 * t * t)) * (0.4 + 0.6 * wingFlat(fu));
        pos.push(x * side, y, z);
        uv.push(fu, Math.min(fv, 1));
        kind.push(1);
        ft.push(t);
        row.push(pos.length / 3 - 1);
      }
      ring.push(row);
    });
    const K = TS.length - 1;
    for (let k = 0; k < K; k++) {
      const [l0, c0, r0] = ring[k], [l1, c1, r1] = ring[k + 1];
      const q = (a, b, c) => (side > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
      q(l0, l1, c0); q(c0, l1, c1); q(c0, c1, r0); q(r0, c1, r1);
    }
  };
  // feathers on both faces of the wing (seen from behind in flight, from the
  // front when she stands)
  for (const face of [-1, 1]) {
    // flight feathers (bottom layer), longest at mid-span, fanning toward the tip
    for (let i = 0; i < 14; i++) {
      const u = 0.03 + (i / 13) * 0.93;
      const chord = wingTop(u) - wingBottom(u);
      feather(u, 0.4, chord * 0.62 + 0.07 + rnd() * 0.02, 0.12 - 0.03 * u, 0.12 + 0.95 * Math.pow(u, 1.6), 0.004 * face);
    }
    // greater coverts
    for (let i = 0; i < 12; i++) {
      const u = 0.02 + (i / 11) * 0.86;
      const chord = wingTop(u) - wingBottom(u);
      feather(u, 0.2, chord * 0.42 + 0.03, 0.13 - 0.025 * u, 0.1 + 0.6 * Math.pow(u, 1.6), 0.011 * face);
    }
    // little coverts along the leading edge
    for (let i = 0; i < 13; i++) {
      const u = 0.02 + (i / 12) * 0.82;
      const chord = wingTop(u) - wingBottom(u);
      feather(u, 0.0, chord * 0.26 + 0.03, 0.12 - 0.02 * u, 0.06 + 0.4 * Math.pow(u, 1.6), 0.017 * face);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aFT', new THREE.Float32BufferAttribute(ft, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function wingMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uBase: { value: new THREE.Color('#fbf9f3') },
      uShade: { value: new THREE.Color('#b4b6da') },
      uDissolve: { value: 0 },
      uBend: { value: 0 },
      uSide: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uBend; uniform float uSide;
      attribute float aKind; attribute float aFT;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vKind; varying float vFT;
      void main() {
        vec3 p = position;
        float u = uv.x;
        p.y += uBend * u * u * 0.55;
        p.x -= uSide * abs(uBend) * u * u * 0.08;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        vKind = aKind; vFT = aFT;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uBase, uShade; uniform float uDissolve, uOpacity;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vKind; varying float vFT;
      void main() {
        float n = texture2D(uNoise, vUv * vec2(1.7, 1.1) + 0.3).r;
        float th = 0.55 * (1.0 - vUv.x) + 0.45 * n;
        if (uDissolve > 0.0 && th < uDissolve) discard;
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        // faceted, like the rest of her
        vec3 Nf = normalize(cross(dFdx(vW), dFdy(vW)));
        if (dot(Nf, N) < 0.0) Nf = -Nf;
        N = normalize(mix(N, Nf, 0.75));
        vec3 cR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 cU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 cB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 Ld = normalize(mix(uSunDir, normalize(-cR * 0.5 + cU * 0.6 + cB * 0.5), 0.45));
        float l = smoothstep(-0.35, 0.6, dot(N, Ld));
        // the membrane under the feathers keeps a hint of painted rows
        float rowsA = abs(sin(vUv.x * 3.14159 * 6.5 + vUv.y * 0.6));
        float feather = smoothstep(0.9, 1.0, rowsA) * smoothstep(0.35, 0.6, vUv.y) * (1.0 - vKind);
        vec3 col = uBase * mix(uShade * uShadowTint, uLightTint * 1.04, l);
        col *= 1.0 - feather * 0.1 - (1.0 - vKind) * 0.06;
        // each feather's quill end tucks under the row above it (soft shadow), its rim catches light
        col *= mix(1.0, 0.8 + 0.2 * smoothstep(0.05, 0.5, vFT), vKind);
        col += uLightTint * smoothstep(0.88, 1.0, vFT) * vKind * 0.05;
        col = mix(col, col * vec3(0.93, 0.92, 1.02), vUv.y * 0.4);
        // pearly toward the tips (a cool lavender) so white wings still read against white cloud
        col = mix(col, col * vec3(0.88, 0.9, 1.04), smoothstep(0.45, 1.0, vUv.x) * 0.45);
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - abs(dot(N, V)), 2.5);
        col += uGold * rim * 0.25;
        float edge = 1.0 - smoothstep(uDissolve, uDissolve + 0.1, th);
        float hot = 1.0 - smoothstep(uDissolve, uDissolve + 0.025, th);
        col = mix(col, uGold * 2.2 + 0.35 + hot * 0.9, edge * step(0.0001, uDissolve));
        // the whole wing warms to gold as it lets go
        col = mix(col, col * vec3(1.06, 1.0, 0.86) + uGold * 0.25, smoothstep(0.0, 0.35, uDissolve));
        col = applyFogK(col, vW, 0.6);
        gl_FragColor = vec4(col, uOpacity);
      }`,
    side: THREE.DoubleSide,
  });
}


// ---------------------------------------------------------------------------
// Face texture (equirect around the skull centre, face at u = 0.5, looked up per
// pixel): skin, blush, brows, nose and mouth. Her eyes are drawn by the face shader
// (so they can blink smoothly, squint when she smiles and look around).
// Features are placed from the sculpted landmarks so paint and form agree.
// mode: 'open' (gentle smile), 'smile' (happy, a little open), 'laugh'
// the texture covers just the front of her head (FACE_RECT in sphere uv), drawn in the
// coordinates of a full 2048 x 1024 equirect (so sizes below are in those pixels)
const FACE_RECT = [0.32, 0.14, 0.36, 0.72];
function faceTexture(skin, hair, mode, size = 1024) {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d');
  const P = (x, y) => { const [u, v] = faceUV(x, y); return [u * W, (1 - v) * H]; };
  g.fillStyle = skin; g.fillRect(0, 0, size, size);
  const kz = size / (FACE_RECT[2] * W);
  g.setTransform(kz, 0, 0, kz, -FACE_RECT[0] * W * kz, -(1 - FACE_RECT[1] - FACE_RECT[3]) * H * kz);
  const [cx] = P(0, 0);
  const [exA, eyeY] = P(FACE.eyeX, FACE.eyeY);
  const ex = exA - cx;
  const browY = P(FACE.eyeX, FACE.browY)[1];
  const [chA, chY] = P(FACE.cheekX, FACE.cheekY);
  const chX = chA - cx;
  const noseY = P(0, FACE.noseY)[1];
  const my = P(0, FACE.mouthY)[1];
  const pxPerM = (P(0.01, 0)[0] - cx) / 0.01;
  const happy = mode === 'smile' || mode === 'laugh';
  const puff = mode === 'blow';
  const blob = (x, y, rx, ry, c0, c1) => {
    g.save(); g.translate(x, y); g.scale(rx / 40, ry / 40);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 40);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 40, 0, TAU); g.fill(); g.restore();
  };
  // gentle warmth in the centre of the face
  const sh = g.createRadialGradient(cx, chY, 80, cx, chY, 560);
  sh.addColorStop(0, 'rgba(255,228,210,0.14)'); sh.addColorStop(1, 'rgba(170,96,90,0.12)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  // soft shade under the fringe
  const fr = g.createLinearGradient(0, browY - 150, 0, browY - 20);
  fr.addColorStop(0, 'rgba(120,64,60,0.2)'); fr.addColorStop(1, 'rgba(120,64,60,0)');
  g.fillStyle = fr; g.fillRect(cx - 400, browY - 170, 800, 150);
  // rosy cheeks with three little hatch strokes
  for (const s of [-1, 1]) {
    const bx = cx + s * chX * 1.02, by = chY + 4;
    blob(bx, by, puff ? 118 : 100, puff ? 70 : 58, `rgba(246,118,124,${happy ? 0.34 : puff ? 0.4 : mode === 'oh' ? 0.33 : mode === 'kiss' ? 0.42 : 0.26})`, 'rgba(246,118,124,0)');
    // (puffed out to blow: a round sheen on each cheek)
    if (puff) blob(bx - s * 18, by - 30, 40, 22, 'rgba(255,240,232,0.45)', 'rgba(255,240,232,0)');
    g.save(); g.strokeStyle = `rgba(222,86,98,${happy ? 0.42 : 0.3})`; g.lineWidth = 4.2; g.lineCap = 'round';
    for (let k = -1; k <= 1; k++) {
      const hx = bx + k * 17 + s * 4, hy = by + 2;
      g.beginPath(); g.moveTo(hx - 6, hy + 9); g.lineTo(hx + 6, hy - 9); g.stroke();
    }
    g.restore();
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  // soft little brows, just above her glasses (her bangs fall over them; raised and
  // arched when she is surprised)
  const bu = mode === 'oh' ? 0.007 : 0, ba = mode === 'oh' ? 0.003 : 0;
  for (const s of [-1, 1]) {
    const [bx0, by0] = P(s * (FACE.eyeX - 0.0095), FACE.eyeY + 0.0405 + bu + ba * 0.6);
    const [bx1, by1] = P(s * (FACE.eyeX + 0.0005), FACE.eyeY + 0.0445 + bu + ba);
    const [bx2, by2] = P(s * (FACE.eyeX + 0.0105), FACE.eyeY + 0.041 + bu - ba * 0.4);
    // one soft tapered shape (full at the inner end, a fine point at the outer end),
    // filled once so it is evenly toned, with a feathered edge and a few fine hair strokes
    const pt = (t) => { const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; return [a * bx0 + b * bx1 + d * bx2, a * by0 + b * by1 + d * by2]; };
    const N = 24, up = [], dn = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const [x, y] = pt(t), [xa, ya] = pt(Math.min(1, t + 0.01)), [xb, yb] = pt(Math.max(0, t - 0.01));
      let nx = -(ya - yb), ny = xa - xb; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (ny > 0) { nx = -nx; ny = -ny; }
      // (rounded at the inner end, tapering to a point at the outer)
      const hw = 5.2 * Math.pow(Math.sin(Math.min(1, t * 6) * Math.PI * 0.5), 0.6) * (1 - 0.82 * Math.pow(t, 1.3));
      up.push([x + nx * hw * 0.9, y + ny * hw * 0.9]); dn.push([x - nx * hw * 1.1, y - ny * hw * 1.1]);
    }
    g.save(); g.filter = `blur(${(1.1 * kz).toFixed(2)}px)`;
    g.fillStyle = 'rgba(78,52,46,0.6)';
    g.beginPath(); g.moveTo(up[0][0], up[0][1]);
    for (const q of up) g.lineTo(q[0], q[1]);
    for (let k = dn.length - 1; k >= 0; k--) g.lineTo(dn[k][0], dn[k][1]);
    g.closePath(); g.fill();
    g.restore();
    g.save(); g.filter = `blur(${(0.5 * kz).toFixed(2)}px)`;
    g.strokeStyle = 'rgba(62,40,36,0.28)'; g.lineWidth = 1.6; g.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      const t = 0.06 + k * 0.12, [x, y] = pt(t), [x2, y2] = pt(Math.min(1, t + 0.1));
      g.beginPath(); g.moveTo(x, y + 2.2 - k * 0.15); g.lineTo(x2, y2 - 1.5 + k * 0.1); g.stroke();
    }
    g.restore();
  }
  // a tiny button nose: soft shade beneath, a speck of light on the tip
  blob(cx, noseY + 20, 15, 6, 'rgba(160,84,74,0.2)', 'rgba(160,84,74,0)');
  blob(cx - 3, noseY - 6, 5, 4, 'rgba(255,246,238,0.5)', 'rgba(255,246,238,0)');
  // faint shadows of her glasses' rims on her cheeks
  const lensPx = P(FACE.eyeX + 0.035, FACE.eyeY)[0] - (cx + ex);
  for (const s of [-1, 1]) {
    const [gx, gy] = P(s * FACE.eyeX + 0.004, FACE.eyeY - 0.008);
    g.save(); g.filter = `blur(${(7 * kz).toFixed(2)}px)`;
    g.strokeStyle = 'rgba(140,80,80,0.11)'; g.lineWidth = 12;
    g.beginPath(); g.ellipse(gx, gy, lensPx, lensPx * 0.93, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.restore();
  }
  // mouth
  const lipCol = '#4a2626';
  if (mode === 'blow') {
    // lips pursed into a little round "o", blowing out her candles
    g.fillStyle = '#7a2f37';
    g.beginPath(); g.ellipse(cx, my + 3, 8.5, 10.5, 0, 0, TAU); g.fill();
    g.strokeStyle = '#cf727b'; g.lineWidth = 5.5;
    g.beginPath(); g.ellipse(cx, my + 3, 11.5, 13.5, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(74,32,34,0.55)'; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(cx, my + 3, 14.2, 16.2, 0, 0, TAU); g.stroke();
  } else if (mode === 'kiss') {
    // a little kiss: lips puckered into a small round pout
    g.fillStyle = '#c95f6c';
    g.beginPath(); g.ellipse(cx, my + 4, 10, 8.5, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(74,32,34,0.6)'; g.lineWidth = 2.6;
    g.beginPath(); g.ellipse(cx, my + 4, 10.5, 9, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(74,32,34,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 5, my + 4); g.quadraticCurveTo(cx, my + 6, cx + 5, my + 4); g.stroke();
    blob(cx - 3, my - 0.5, 4.5, 2.6, 'rgba(255,236,236,0.7)', 'rgba(255,236,236,0)');
  } else if (mode === 'oh') {
    // "oh!": a small open "o", a little taller than wide, the tongue low inside it
    g.fillStyle = '#7a2f37';
    g.beginPath(); g.ellipse(cx, my + 7, 13.5, 17.5, 0, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.ellipse(cx, my + 7, 13.5, 17.5, 0, 0, TAU); g.clip();
    g.fillStyle = '#e57e88'; g.beginPath(); g.ellipse(cx, my + 23, 11, 8, 0, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(74,32,34,0.6)'; g.lineWidth = 2.8;
    g.beginPath(); g.ellipse(cx, my + 7, 14, 18, 0, 0, TAU); g.stroke();
  } else if (mode === 'open') {
    // a small soft smile, corners tucked up
    // (a soft rosy lower lip just under it)
    blob(cx, my + 9, 15, 6.5, 'rgba(234,116,128,0.42)', 'rgba(234,116,128,0)');
    g.strokeStyle = lipCol; g.lineWidth = 5.2;
    g.beginPath(); g.moveTo(cx - 17, my - 4); g.quadraticCurveTo(cx, my + 15, cx + 17, my - 4); g.stroke();
    g.lineWidth = 3.4;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 17, my - 4); g.lineTo(cx + s * 20, my - 7); g.stroke(); }
  } else {
    // open, happy: a little D with a rosy tongue
    const w = mode === 'laugh' ? 27 : 21, d = mode === 'laugh' ? 31 : 21;
    g.fillStyle = '#7a2f37';
    g.beginPath();
    g.moveTo(cx - w, my - 7);
    g.quadraticCurveTo(cx, my - 1, cx + w, my - 7);
    g.quadraticCurveTo(cx + w * 0.86, my + d, cx, my + d + 1);
    g.quadraticCurveTo(cx - w * 0.86, my + d, cx - w, my - 7);
    g.closePath(); g.fill();
    g.save(); g.clip();
    g.fillStyle = '#e57e88'; g.beginPath(); g.ellipse(cx, my + d * 0.98, w * 0.62, d * 0.42, 0, 0, TAU); g.fill();
    // (a hint of her upper teeth under the lip)
    g.fillStyle = 'rgba(255,251,247,0.95)';
    g.beginPath(); g.moveTo(cx - w, my - 7); g.quadraticCurveTo(cx, my - 1, cx + w, my - 7);
    g.lineTo(cx + w, my - 7 + d * 0.2); g.quadraticCurveTo(cx, my + d * 0.24, cx - w, my - 7 + d * 0.2); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(74,32,34,0.6)'; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx - w, my - 7); g.quadraticCurveTo(cx + 0, my - 1, cx + w, my - 7);
    g.quadraticCurveTo(cx + w * 0.86, my + d, cx, my + d + 1); g.quadraticCurveTo(cx - w * 0.86, my + d, cx - w, my - 7);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.userData = { pxPerM };
  return t;
}
// where her eyes sit in the face texture's (u, v), and how fast u, v change per metre there
function eyeFrame() {
  const [uR, vR] = faceUV(FACE.eyeX, FACE.eyeY), [uL, vL] = faceUV(-FACE.eyeX, FACE.eyeY);
  const e = 0.002;
  const ku = (faceUV(FACE.eyeX + e, FACE.eyeY)[0] - faceUV(FACE.eyeX - e, FACE.eyeY)[0]) / (2 * e);
  const kv = (faceUV(FACE.eyeX, FACE.eyeY + e)[1] - faceUV(FACE.eyeX, FACE.eyeY - e)[1]) / (2 * e);
  return { c: new THREE.Vector4(uL, vL, uR, vR), k: new THREE.Vector2(ku, kv) };
}
// Her glasses catch the light with a soft blue-violet sheen (blue-light coating)
function lensMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uSunDir: U.uSunDir, uLightTint: U.uLightTint, uTime: U.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir; uniform vec3 uLightTint; uniform float uTime;
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - abs(dot(N, V)), 2.0);
        vec2 c = vUv - 0.5;
        float d = c.x * 0.8 + c.y;
        float band = smoothstep(0.15, 0.0, abs(d - 0.13)) + 0.55 * smoothstep(0.06, 0.0, abs(d + 0.17));
        vec3 tint = mix(vec3(0.55, 0.42, 1.0), vec3(0.3, 0.55, 1.0), vUv.y);
        vec3 H = normalize(V + uSunDir);
        float spec = pow(max(dot(N, H), 0.0), 60.0);
        vec3 col = tint * (0.01 + 0.16 * fres + 0.04 * band) + vec3(1.0) * spec * 0.3;
        // two short soft shine strokes across the upper corner of each lens (glass catching
        // the sky), clear of her eyes
        vec2 q = vec2(c.x * 0.8 + c.y, c.y * 0.8 - c.x);
        float lm = smoothstep(0.49, 0.43, length(c));
        float s1 = smoothstep(0.032, 0.008, abs(q.x - 0.29)) * smoothstep(0.17, 0.06, abs(q.y - 0.06));
        float s2 = smoothstep(0.014, 0.004, abs(q.x - 0.37)) * smoothstep(0.11, 0.03, abs(q.y - 0.04));
        col += vec3(1.0, 0.99, 0.97) * (s1 * 0.5 + s2 * 0.42) * lm;
        // now and then a glint sweeps across her lenses
        float sweep = fract(uTime / 7.0) * 3.5 - 1.2;
        col += vec3(1.0, 0.98, 0.94) * smoothstep(0.07, 0.0, abs(c.x * 0.7 + c.y - sweep + 0.5)) * 0.32 * smoothstep(0.5, 0.42, length(c));
        gl_FragColor = vec4(col * uLightTint, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// Soft contact shadow under her (and props)
export function contactShadow(opacity = 0.42, w = 1.2, d = 0.9) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: opacity }, uColor: { value: new THREE.Color('#1d2a28') } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        float d = length((vUv - 0.5) * 2.0);
        float a = pow(max(1.0 - d, 0.0), 1.6);
        gl_FragColor = vec4(uColor, a * uOpacity);
      }`,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.geometry.rotateX(-Math.PI / 2);
  m.renderOrder = 5;
  return m;
}


// ---------------------------------------------------------------------------
// Little accessories
// a five-petalled blossom facing +z: rounded petals cupped toward the front
function blossomGeometry(r, petals = 5, cup = 0.32, seg = 10) {
  const pp = [];
  const o = new THREE.Object3D();
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU + Math.PI / 2;
    const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3));
    o.position.set(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46, 0);
    o.rotation.set(0, 0, a);
    o.rotateY(-cup);
    o.scale.set(r * 0.5, r * 0.4, r * 0.12);
    o.updateMatrix();
    g.applyMatrix4(o.matrix);
    pp.push(g);
    // (a cherry blossom: each petal's tip parted into two soft lobes, a little notch between)
    for (const sd of [-1, 1]) {
      const l = new THREE.SphereGeometry(1, Math.max(6, seg - 2), Math.max(5, seg - 4));
      const px = -Math.sin(a) * sd * r * 0.17, py = Math.cos(a) * sd * r * 0.17;
      o.position.set(Math.cos(a) * r * 0.76 + px, Math.sin(a) * r * 0.76 + py, -Math.sin(cup) * r * 0.2);
      o.rotation.set(0, 0, a + sd * 0.32);
      o.rotateY(-cup * 1.15);
      o.scale.set(r * 0.33, r * 0.25, r * 0.1);
      o.updateMatrix();
      l.applyMatrix4(o.matrix);
      pp.push(l);
    }
  }
  const c = new THREE.SphereGeometry(r * 0.26, seg, Math.max(6, seg - 3));
  c.scale(1, 1, 0.75); c.translate(0, 0, r * 0.12);
  return { petals: mergeGeometries(pp), centre: c };
}
// a tiny heart (for her pendant), facing +z, about w wide
function heartGeometry(w, depth) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.28);
  s.bezierCurveTo(0, 0.44, -0.24, 0.56, -0.4, 0.46);
  s.bezierCurveTo(-0.62, 0.31, -0.56, 0.0, -0.34, -0.16);
  s.bezierCurveTo(-0.2, -0.27, -0.05, -0.38, 0, -0.5);
  s.bezierCurveTo(0.05, -0.38, 0.2, -0.27, 0.34, -0.16);
  s.bezierCurveTo(0.56, 0.0, 0.62, 0.31, 0.4, 0.46);
  s.bezierCurveTo(0.24, 0.56, 0, 0.44, 0, 0.28);
  const g = new THREE.ExtrudeGeometry(s, { depth: depth / w, bevelEnabled: true, bevelThickness: depth / w * 0.6, bevelSize: 0.07, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / w * 0.5);
  g.scale(w, w, w);
  g.computeVertexNormals();
  return g;
}
// her halo, while she is still an angel: warm light, brighter at the rim
function haloMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uTime: U.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform float uTime;
      varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float f = pow(1.0 - abs(dot(normalize(vN), V)), 1.4);
        vec3 col = mix(vec3(1.0, 0.76, 0.36), vec3(1.0, 0.93, 0.7), f) * (1.45 + 0.15 * sin(uTime * 2.2));
        gl_FragColor = vec4(col, uOpacity);
      }`,
    transparent: true, depthWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Finger curl: bind each hand vertex to the nearest finger segment (in the unmirrored hand
// frame: fingers hang along -y and curl toward +x), then bend about the knuckles (z axis)
function segDist(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / (abx * abx + aby * aby + abz * abz)));
  const dx = p[0] - a[0] - abx * t, dy = p[1] - a[1] - aby * t, dz = p[2] - a[2] - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function fingerBind(geo, mirror) {
  const P = geo.attributes.position, N = geo.attributes.normal, n = P.count;
  const base = new Float32Array(P.array), nbase = new Float32Array(N.array);
  const fi = new Int8Array(n), seg = new Int8Array(n), wt = new Float32Array(n), bl = new Float32Array(n);
  // (vertices in the web between two fingers follow both, half and half)
  const fi2 = new Int8Array(n), seg2 = new Int8Array(n), w2 = new Float32Array(n), bl2 = new Float32Array(n), wt2 = new Float32Array(n);
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = P.getX(i) * mirror; p[1] = P.getY(i); p[2] = P.getZ(i);
    const bestF = [1e9, 1e9, 1e9, 1e9], segF = [0, 0, 0, 0];
    FINGERS.forEach((F, f) => {
      const ks = [F.k0, F.k1, F.k2, F.k3];
      for (let j = 0; j < 3; j++) { const d = segDist(p, ks[j], ks[j + 1]); if (d < bestF[f]) { bestF[f] = d; segF[f] = j; } }
    });
    let bf = 0;
    for (let f = 1; f < 4; f++) if (bestF[f] < bestF[bf]) bf = f;
    let bf2 = bf === 0 ? 1 : 0;
    for (let f = 0; f < 4; f++) if (f !== bf && bestF[f] < bestF[bf2]) bf2 = f;
    const best = bestF[bf];
    // (the palm stays put; vertices round the base knuckle bend part way)
    const F = FINGERS[bf];
    const below = F.k0[1] - p[1];
    fi[i] = best < 0.0125 && below > -0.004 ? bf : -1;
    seg[i] = segF[bf];
    wt[i] = fi[i] < 0 ? 0 : Math.min(1, Math.max(0, (below + 0.004) / 0.008));
    bl[i] = below;
    const gap = bestF[bf2] - best;
    fi2[i] = fi[i] >= 0 && Math.abs(bf2 - bf) === 1 && gap < 0.003 ? bf2 : -1;
    w2[i] = fi2[i] < 0 ? 0 : 0.5 * (1 - gap / 0.003);
    seg2[i] = segF[bf2];
    const below2 = FINGERS[bf2].k0[1] - p[1];
    bl2[i] = below2;
    wt2[i] = Math.min(1, Math.max(0, (below2 + 0.004) / 0.008));
  }
  return { geo, mirror, base, nbase, fi, seg, wt, bl, fi2, seg2, w2, bl2, wt2 };
}
const CURL_K = [0.75, 1.05, 0.9];
// one vertex of a finger, posed: curled (distal joints first, each about its own rest
// knuckle), and for a peace sign the two raised fingers parted into a V
function fingerPose(o, x, y, z, nx, ny, nz, f, sg, wt, bl, c, point, peace) {
  const F = FINGERS[f], ks = [F.k0, F.k1, F.k2];
  let cf = point > 0 ? lerp(c, f === 3 ? -0.1 : 1.0, point) : c;
  // (a peace sign: index and middle straight, the others folded)
  if (peace > 0) cf = lerp(cf, f >= 2 ? -0.24 : 1.3, peace);
  for (let j = sg; j >= 0; j--) {
    const a = cf * CURL_K[j] * (j === 0 ? wt : 1);
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = ks[j];
    // (curling toward +x: rotate -y toward +x about z)
    const px = x - k[0], py = y - k[1];
    x = k[0] + px * ca - py * sa; y = k[1] + px * sa + py * ca;
    const qx = nx * ca - ny * sa, qy = nx * sa + ny * ca; nx = qx; ny = qy;
  }
  if (peace > 0 && f >= 2) {
    // (easing in along the finger from its knuckle, so the web between them and the
    // palm aren't torn open)
    const swk = Math.min(1, Math.max(0, (bl - 0.007) / 0.02));
    const sp = (f === 3 ? -0.3 : 0.24) * peace * swk * swk * (3 - 2 * swk), cs = Math.cos(sp), sn = Math.sin(sp);
    const k = F.k0, py = y - k[1], pz = z - k[2];
    y = k[1] + py * cs - pz * sn; z = k[2] + py * sn + pz * cs;
    const qy = ny * cs - nz * sn, qz = ny * sn + nz * cs; ny = qy; nz = qz;
  }
  o[0] = x; o[1] = y; o[2] = z; o[3] = nx; o[4] = ny; o[5] = nz;
}
// (point: 0..1 - the index finger straightens, the others close)
const _fo = new Float32Array(6), _fo2 = new Float32Array(6);
function fingerCurl(R, c, point = 0, peace = 0) {
  const P = R.geo.attributes.position.array, N = R.geo.attributes.normal.array;
  const { base, nbase, fi, seg, wt, bl, fi2, seg2, w2, bl2, wt2, mirror } = R;
  for (let i = 0, n = fi.length; i < n; i++) {
    const i3 = i * 3;
    let x = base[i3] * mirror, y = base[i3 + 1], z = base[i3 + 2];
    let nx = nbase[i3] * mirror, ny = nbase[i3 + 1], nz = nbase[i3 + 2];
    const f = fi[i];
    if (f >= 0) {
      fingerPose(_fo, x, y, z, nx, ny, nz, f, seg[i], wt[i], bl[i], c, point, peace);
      if (w2[i] > 0) {
        fingerPose(_fo2, x, y, z, nx, ny, nz, fi2[i], seg2[i], wt2[i], bl2[i], c, point, peace);
        const w = w2[i];
        for (let k = 0; k < 6; k++) _fo[k] += (_fo2[k] - _fo[k]) * w;
      }
      x = _fo[0]; y = _fo[1]; z = _fo[2];
      const nl = Math.hypot(_fo[3], _fo[4], _fo[5]) || 1;
      nx = _fo[3] / nl; ny = _fo[4] / nl; nz = _fo[5] / nl;
    }
    P[i3] = x * mirror; P[i3 + 1] = y; P[i3 + 2] = z;
    N[i3] = nx * mirror; N[i3 + 1] = ny; N[i3 + 2] = nz;
  }
  R.geo.attributes.position.needsUpdate = true;
  R.geo.attributes.normal.needsUpdate = true;
}

// ---------------------------------------------------------------------------
export class Character {
  constructor(U, opts) {
    this.U = U;
    this.opts = opts;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const dress = opts.dress, skin = opts.skin, hair = opts.hair;
    const lo = opts.quality === 'low';
    // soft contact shadows: a few spheres following her main volumes
    this.occ = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e4, 0, 0)) };
    const clay = { clay: true, occ: this.occ, facet: 0.8, term: 0.35 };

    this.mDress = toonMaterial(U, { ...clay, vao: true, color: dress, shade: '#bab4d6', rim: 0.42, deform: 'skirt', topY: 1.02, len: 1.02, side: THREE.DoubleSide, fogScale: 0.5, satin: 1, trim: '#efdcb4', embroider: true, sparkle: 1 });
    this.mBodice = toonMaterial(U, { ...clay, facet: 0.45, color: dress, shade: '#bab4d6', rim: 0.38, fogScale: 0.5, satin: 0.8, neckline: true, trim: '#e6cfa6', sparkle: 0.8 });
    this.mFrill = toonMaterial(U, { ...clay, vao: true, trimUV: true, color: dress, shade: '#bab4d6', rim: 0.4, fogScale: 0.5, satin: 0.7, trim: '#e8cf9c', side: THREE.DoubleSide });
    this.mSleeve = toonMaterial(U, { ...clay, facet: 0.3, color: dress, shade: '#bab4d6', rim: 0.38, fogScale: 0.5, satin: 0.8, side: THREE.DoubleSide, puff: true });
    this.mSash = toonMaterial(U, { ...clay, facet: 0.1, color: '#e2c286', shade: '#a98d6c', rim: 0.5, fogScale: 0.5, satin: 1.6, side: THREE.DoubleSide });
    this.mRibbon = toonMaterial(U, { ...clay, facet: 0.3, color: '#e2c286', shade: '#a98d6c', rim: 0.5, fogScale: 0.5, satin: 1.6, deform: 'hair', topY: 0.0, len: 0.5, side: THREE.DoubleSide });
    this.mSkin = toonMaterial(U, { ...clay, facet: 0.12, color: skin, shade: '#cf9580', rim: 0.25, fogScale: 0.5, sss: 0.12 });
    this.faceSize = lo ? 512 : 1024;
    this.faceOpen = faceTexture(skin, hair, 'open', this.faceSize);
    this.faceSmile = faceTexture(skin, hair, 'smile', this.faceSize);
    this.faceLaugh = faceTexture(skin, hair, 'laugh', this.faceSize);
    this.faceBlow = faceTexture(skin, hair, 'blow', this.faceSize);
    this.faceOh = faceTexture(skin, hair, 'oh', this.faceSize);
    this.faceKiss = faceTexture(skin, hair, 'kiss', this.faceSize);
    // smooth, softly glossy skin (a vinyl toy), with just a hint of facets
    this.mFace = toonMaterial(U, { ...clay, facet: 0.15, sphereUV: true, eyes: true, map: this.faceOpen, map2: this.faceSmile, shade: '#cf9580', rim: 0.18, fogScale: 0.5, sss: 0.1, spec: 0.08 });
    this.mFace.uniforms.uFaceRect.value.set(...FACE_RECT);
    {
      const ef = eyeFrame();
      this.mFace.uniforms.uEyeC.value.copy(ef.c);
      const [cuR, cvR] = faceUV(FACE.cheekX, FACE.cheekY - 0.004), [cuL, cvL] = faceUV(-FACE.cheekX, FACE.cheekY - 0.004);
      this.mFace.uniforms.uCheekC.value.set(cuL, cvL, cuR, cvR);
      this.mFace.uniforms.uEyeK.value.copy(ef.k);
    }
    // eyes: where she looks (eased), and her blinks
    this.gaze = new THREE.Vector2();
    this.gazeGoal = new THREE.Vector2();
    this.nextGlance = 0;
    this.lastTime = 0;
    this.mHair = toonMaterial(U, { ...clay, facet: 0.1, vao: true, color: hair, shade: '#5c5270', rim: 0.32, deform: 'hair', topY: 0.0, len: 0.66, side: THREE.DoubleSide, fogScale: 0.5, hair: true, sheen: '#8f8088', ring: 0.3, strand: 0.24 });
    this.mHairCap = toonMaterial(U, { ...clay, facet: 0.08, vao: true, color: hair, shade: '#5c5270', rim: 0.3, side: THREE.DoubleSide, fogScale: 0.5, hair: true, ring: 0.8, sheen: '#95868e', strand: 0.24 });
    this.mGlasses = toonMaterial(U, { color: '#3d3536', shade: '#2a2426', rim: 0.35, fogScale: 0.5, spec: 0.9 });
    this.mShoe = toonMaterial(U, { ...clay, color: '#f1e3cb', shade: '#b9a9a8', rim: 0.3, fogScale: 0.5, spec: 0.3, satin: 0.6 });
    this.mLens = lensMaterial(U);
    // little jewels: a blossom clip in her hair, a pearl, a gold heart
    this.mPetal = toonMaterial(U, { ...clay, facet: 0.22, color: '#fbd3df', shade: '#c99ab3', rim: 0.45, fogScale: 0.5, sss: 0.15 });
    this.mPearl = toonMaterial(U, { ...clay, facet: 0.3, color: '#fff4e6', shade: '#c6b8c8', rim: 0.5, fogScale: 0.5, spec: 0.9 });
    this.mGold = toonMaterial(U, { ...clay, facet: 0.5, color: '#f3cf7d', shade: '#b48a55', rim: 0.6, fogScale: 0.5, spec: 1.2, satin: 1.2 });
    this.mats = [this.mDress, this.mBodice, this.mSleeve, this.mFrill, this.mSkin, this.mFace, this.mHair, this.mHairCap, this.mGlasses, this.mSash, this.mRibbon, this.mShoe, this.mPetal, this.mPearl, this.mGold];

    // --- skirt ---
    this.skirt = new THREE.Mesh(skirtGeometry(lo ? 16 : 20, lo ? 40 : 52), this.mDress);
    this.skirt.scale.set(1, 0.78 * SK, 0.9);
    this.body.add(this.skirt);

    // --- little shoes peeking from the hem ---
    const shoeGeo = shoeGeometry(lo ? 0.006 : 0.005);
    this.feet = [-1, 1].map((side) => {
      const m = new THREE.Mesh(shoeGeo, this.mShoe);
      m.position.set(side * 0.062, 0, 0.01);
      m.rotation.y = side * 0.08;
      this.body.add(m);
      return { side, mesh: m };
    });

    // --- torso (pivot at the waist) ---
    this.torso = new THREE.Group();
    this.torso.position.y = 0.795 * SK;
    this.body.add(this.torso);
    // the dressed torso shape, a little broader and shorter than the base model
    const shape = new THREE.Group();
    shape.scale.set(1.07, 0.95, 1.0);
    this.torso.add(shape);
    shape.add(new THREE.Mesh(torsoGeometry(lo ? 12 : 16, lo ? 26 : 32), this.mBodice));
    // skin beneath, showing at the neckline
    // skin under the neckline and the neck, as one mesh
    const neckProf = [[0.0, 0.33], [0.04, 0.335], [0.0385, 0.38], [0.0355, 0.43], [0.034, 0.47], [0.0, 0.48]].map(([r, y]) => new THREE.Vector2(r, y));
    const neckGeo = new THREE.LatheGeometry(neckProf, 12);
    neckGeo.translate(0, 0, 0.004);
    shape.add(new THREE.Mesh(mergeGeos([torsoGeometry(lo ? 12 : 16, lo ? 26 : 32, 0.0022), neckGeo]), this.mSkin));
    // a soft ruffle along the neckline
    shape.add(new THREE.Mesh(necklineFrill(lo ? 56 : 72), this.mFrill));
    // satin sash with a bow and two flowing tails
    shape.add(new THREE.Mesh(bandGeometry(-0.012, 0.046, 0.005, 3, lo ? 28 : 36), this.mSash));
    {
      // a satin blossom pinned at the front of the sash, a pearl at its heart
      const bl = blossomGeometry(0.017, 5, 0.38, lo ? 7 : 10);
      const zf = (torsoFrontZ(0, 0.017) + 0.005) * 1.06 + 0.003;
      const brooch = new THREE.Group();
      brooch.position.set(0, 0.017, zf);
      brooch.rotation.x = -0.08;
      brooch.add(new THREE.Mesh(bl.petals, this.mBodice), new THREE.Mesh(bl.centre, this.mPearl));
      shape.add(brooch);
      // a fine gold chain around her neck with a little heart
      const ctrl = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const x = -0.047 * Math.cos(Math.PI * t);
        const y = 0.326 + 0.072 * Math.pow(Math.cos(Math.PI * t), 2);
        const neckZ = 0.004 + Math.sqrt(Math.max(0, 0.0405 * 0.0405 - x * x));
        const z = Math.max(torsoFrontZ(x, y), neckZ) + 0.0019;
        ctrl.push(new THREE.Vector3(x, y, z));
      }
      const chain = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ctrl), lo ? 24 : 40, 0.00105, 4, false);
      const heart = heartGeometry(0.0125, 0.0028);
      heart.rotateX(-0.3);
      heart.translate(0, 0.316, torsoFrontZ(0, 0.316) + 0.004);
      for (const g of [chain, heart]) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); }
      shape.add(new THREE.Mesh(mergeGeometries([chain.toNonIndexed(), heart.index ? heart.toNonIndexed() : heart]), this.mGold));
    }
    const bow = new THREE.Group();
    bow.position.set(0, 0.018, -(torsoBack(0.02) + 0.014));
    this.torso.add(bow);
    {
      // a big soft satin bow (seen whenever we walk behind her): two loops of ribbon,
      // pinched narrow where they are gathered into the knot and full at their round outer
      // ends, puffed out behind, tipped up a little; a band of ribbon wrapped round the knot
      bow.add(new THREE.Mesh(bowGeometry(lo), this.mSash));
    }
    this.ribbons = [];
    {
      // the two tails fall over the bell of her skirt, following its flare (built in
      // the bow's frame: torso height minus the bow's, depth behind the skirt)
      const bowY = bow.position.y, bowZ = bow.position.z;
      const skirtTop = 0.795 * SK;
      for (const sd of [-1, 1]) {
        const segs = 16, len = 0.38, w = 0.045;
        const pos = [], uv = [], idx = [];
        for (let j = 0; j <= segs; j++) {
          const d = (j / segs) * len;
          const yT = bowY - 0.004 - d;                    // torso space
          const ys = (skirtTop + yT) / (0.78 * SK);       // skirt geometry space
          const f = clamp(1 - ys / 1.02, 0, 1);
          const zS = -(skirtProfile(f) * 0.9 + 0.012 + 0.01 * (1 - smooth01(d / 0.06)));
          const x = sd * (0.012 + d * 0.16);
          // (a soft lengthwise ripple, and the end cut into a swallowtail "V")
          for (const e of [-1, 0, 1]) {
            const notch = j === segs && e === 0 ? 0.022 : 0;
            const curl = 0.0035 * (1 - e * e) * Math.sin(d * 18);
            pos.push(x + e * w * 0.5, yT - bowY + notch, Math.min(zS, -(torsoBack(0.02) + 0.02)) - bowZ - curl);
            uv.push((e + 1) / 2, j / segs);
          }
        }
        for (let j = 0; j < segs; j++) for (let c = 0; c < 2; c++) { const a = j * 3 + c; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        rg.setIndex(idx);
        rg.computeVertexNormals();
        const rb = new THREE.Mesh(rg, this.mRibbon);
        bow.add(rb);
        this.ribbons.push(rb);
        // (where its end hangs, in its own frame, and how far along the flow reaches it)
        const n2 = pos.length - 9;
        rb.userData.tip = new THREE.Vector3((pos[n2] + pos[n2 + 6]) / 2, (pos[n2 + 1] + pos[n2 + 7]) / 2, (pos[n2 + 2] + pos[n2 + 8]) / 2);
      }
    }

    // --- head ---
    this.head = new THREE.Group();
    // a big round head on a short neck: the cute proportions of a toy
    this.head.position.copy(HEAD_POS);
    this.head.scale.setScalar(HEAD_SCALE);
    this.torso.add(this.head);
    const skullPos = SKULL.clone();
    const face = new THREE.Mesh(headGeometry(lo ? 10 : 12), this.mFace);
    face.position.copy(skullPos);
    this.head.add(face);
    this.skull = face;
    // scalp and bangs share a material: one mesh
    const cap = new THREE.Mesh(mergeGeos([capGeometry(14, 40), bangsGeometry()]), this.mHairCap);
    // the little curl on her crown is springy: it bobs as she walks and lands
    const ah = ahogeGeometry();
    this.ahoge = new THREE.Group();
    this.ahoge.position.copy(skullPos).add(ah.base);
    this.ahoge.add(new THREE.Mesh(ah.geo, this.mHairCap));
    this.head.add(this.ahoge);
    this.ahogeS = { x: 0, z: 0, vx: 0, vz: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), init: false };
    cap.position.copy(skullPos);
    this.head.add(cap);
    this.backHair = new THREE.Mesh(backHairGeometry(), this.mHair);
    this.backHair.position.copy(skullPos);
    this.head.add(this.backHair);
    // both front curtains move together: one mesh
    // (their own copy of the hair material, sharing everything but the flow: each side
    // swings on its own)
    this.mLocks = this.mHair.clone();
    for (const k in this.mHair.uniforms) if (!k.startsWith('uFlow') && k !== 'uTwist') this.mLocks.uniforms[k] = this.mHair.uniforms[k];
    this.mats.push(this.mLocks);
    const lock = new THREE.Mesh(mergeGeos([frontHairGeometry(-1), frontHairGeometry(1)]), this.mLocks);
    lock.position.copy(skullPos);
    this.head.add(lock);
    this.locks = [lock];
    // glasses: large, thin dark-metal round frames, resting just off the face
    this.glasses = new THREE.Group();
    this.glasses.position.copy(skullPos);
    const lensR = 0.035, ex = FACE.eyeX, ey = FACE.eyeY + 0.002;
    const lz = faceZ(ex, ey) + 0.011;
    // frames and lenses each as one merged mesh (fewer draw calls)
    const tmp = new THREE.Object3D();
    const baked = (geo, setup) => { tmp.position.set(0, 0, 0); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1); tmp.quaternion.identity(); setup(tmp); tmp.updateMatrix(); geo.applyMatrix4(tmp.matrix); return geo; };
    const frameParts = [], lensParts = [];
    for (const s of [-1, 1]) {
      const place = (o) => { o.position.set(s * ex, ey, lz); o.rotation.set(0, s * 0.2, 0); o.scale.set(1, 0.93, 1); };
      frameParts.push(baked(new THREE.TorusGeometry(lensR, 0.0019, 8, 56), place));
      lensParts.push(baked(new THREE.CircleGeometry(lensR * 0.99, 32), (o) => { place(o); o.position.z += 0.0008; }));
      // temple arm back to the ear, hidden under the hair
      const tx0 = s * (ex + lensR * 0.97), tz0 = lz - 0.006, tx1 = s * 0.113, tz1 = 0.0;
      const dir = new THREE.Vector3(tx1 - tx0, 0.0, tz1 - tz0);
      const tl = dir.length();
      frameParts.push(baked(new THREE.CylinderGeometry(0.0015, 0.0015, tl, 6), (o) => {
        o.position.set((tx0 + tx1) / 2, ey + 0.004, (tz0 + tz1) / 2);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      }));
    }
    frameParts.push(baked(new THREE.TorusGeometry(0.0068, 0.0015, 6, 16, Math.PI), (o) => o.position.set(0, ey + 0.006, lz + 0.004)));
    this.glasses.add(new THREE.Mesh(mergeGeometries(frameParts), this.mGlasses));
    const lenses = new THREE.Mesh(mergeGeometries(lensParts), this.mLens);
    lenses.renderOrder = 8;
    this.glasses.add(lenses);
    this.head.add(this.glasses);
    // a blossom clip over her left temple, with a little bud and two leaves
    {
      const clip = new THREE.Group();
      clip.position.copy(skullPos);
      const at = headPt(0.31 * Math.PI, 1.02, 1.13);
      const nrm = outOf(at);
      const place = (obj, p, n, spin) => {
        obj.position.copy(p);
        obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        obj.rotateZ(spin);
      };
      const big = blossomGeometry(0.021, 5, 0.34, lo ? 8 : 11);
      const at2 = headPt(0.36 * Math.PI, 1.24, 1.12);
      const small = blossomGeometry(0.013, 5, 0.45, lo ? 7 : 9);
      const o1 = new THREE.Object3D(), o2 = new THREE.Object3D();
      place(o1, at, nrm, 0.3); place(o2, at2, outOf(at2), -0.4);
      o1.updateMatrix(); o2.updateMatrix();
      const petals = mergeGeometries([big.petals.applyMatrix4(o1.matrix), small.petals.applyMatrix4(o2.matrix)]);
      clip.add(new THREE.Mesh(petals, this.mPetal));
      clip.add(new THREE.Mesh(mergeGeometries([big.centre.applyMatrix4(o1.matrix), small.centre.applyMatrix4(o2.matrix)]), this.mGold));
      this.head.add(clip);
      this.clip = clip;
    }
    // her halo, while she is still an angel
    this.mHalo = haloMaterial(U);
    this.halo = new THREE.Group();
    this.halo.position.set(0, skullPos.y + 0.158, skullPos.z - 0.016);
    this.halo.rotation.x = -0.32;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.0068, 8, 56), this.mHalo);
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 12;
    this.halo.add(ring);
    this.haloGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#ffcf7a', core: 0.0, opacity: 0.55 }));
    this.haloGlow.scale.setScalar(0.62);
    this.haloGlow.renderOrder = 13;
    this.halo.add(this.haloGlow);
    this.head.add(this.halo);

    // --- arms ---
    this.arms = [];
    let sleeveBowGeo = null;
    const handGeoR = handGeometry(-1, lo ? 0.0044 : 0.003), handGeoL = handGeometry(1, lo ? 0.0044 : 0.003);
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.129, 0.328, -0.004);
      this.torso.add(sh);
      const sleeve = new THREE.Mesh(sleeveGeometry(9, 22), this.mSleeve);
      sleeve.rotation.z = s * 0.12;
      sh.add(sleeve);
      // a satin band finishing the puffed sleeve, tied in a tiny bow on the outside
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.0492, 0.0044, 6, 24), this.mSash);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.082, 0);
      sleeve.add(cuff);
      const sbow = new THREE.Mesh(sleeveBowGeo || (sleeveBowGeo = bowGeometry(true)), this.mSash);
      sbow.scale.setScalar(0.36);
      sbow.position.set(s * 0.0515, -0.08, 0.004);
      sbow.rotation.set(0, s * Math.PI / 2, 0);
      sleeve.add(sbow);
      // (one mesh from shoulder to wrist, bent smoothly at the elbow: see bendArm)
      const limb = new THREE.Mesh(armGeometry(0.212, 0.176, 0.049, 0.041, 0.03, lo ? 14 : 18), this.mSkin);
      sh.add(limb);
      const elbow = new THREE.Group();
      elbow.position.y = -0.212;
      sh.add(elbow);
      const hand = new THREE.Mesh(s > 0 ? handGeoR : handGeoL, this.mSkin);
      hand.position.y = -0.176;
      hand.scale.setScalar(1.1);
      elbow.add(hand);
      this.arms.push({ side: s, sh, elbow, hand, limb, elBent: null, curl: 0.1, curlNow: null });
    }
    // her fingers can curl and straighten: each vertex of a hand is bound to the finger
    // segment it lies on, and bent round the knuckles on the CPU when the curl changes
    this.fingerRig = [handGeoR, handGeoL].map((g, gi) => fingerBind(g, gi === 0 ? -1 : 1));

    // --- wings ---
    this.wingMats = [];
    this.wings = [];
    const wingRoot = new THREE.Group();
    wingRoot.position.set(0, 0.275, -0.079);
    this.torso.add(wingRoot);
    this.wingRoot = wingRoot;
    for (const s of [-1, 1]) {
      const m = wingMaterial(U);
      m.uniforms.uSide.value = s;
      this.wingMats.push(m);
      const pivot = new THREE.Group();
      // (at the outer edges of her shoulder blades, so her long hair lies over her back
      // between them and isn't squeezed to a thin strip between the wings)
      pivot.position.set(s * 0.096, 0.012, 0.004);
      wingRoot.add(pivot);
      const mesh = new THREE.Mesh(wingGeometry(s), m);
      pivot.add(mesh);
      this.wings.push({ side: s, pivot, mesh });
    }

    // aura glow (helps her read at landscape scale)
    this.aura = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#fff1d2', core: 0.3, opacity: 0.6 }));
    this.aura.position.set(0, 1.0, 0);
    this.aura.scale.setScalar(2.6);
    this.aura.renderOrder = 30;
    this.root.add(this.aura);

    this.root.traverse((o) => { o.frustumCulled = false; });
    this.flowWorld = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  // the tip of her nose, in the world
  noseWorld(out) { return this.skull.localToWorld(out.set(0, FACE.noseY, 0.114)); }

  setLook({ hair, skin, dress, glasses }) {
    if (dress) { [this.mDress, this.mBodice, this.mSleeve, this.mFrill].forEach((m) => m.uniforms.uBase.value.set(dress)); }
    if (hair) { this.mHair.uniforms.uBase.value.set(hair); this.mHairCap.uniforms.uBase.value.set(hair); }
    if (skin || hair) {
      this.opts = { ...this.opts, ...(hair ? { hair } : {}), ...(skin ? { skin } : {}) };
      this.mSkin.uniforms.uBase.value.set(this.opts.skin);
      this.faceOpen.dispose(); this.faceSmile.dispose(); this.faceLaugh.dispose(); this.faceBlow.dispose(); this.faceOh.dispose(); this.faceKiss.dispose();
      this.faceOpen = faceTexture(this.opts.skin, this.opts.hair, 'open', this.faceSize);
      this.faceSmile = faceTexture(this.opts.skin, this.opts.hair, 'smile', this.faceSize);
      this.faceLaugh = faceTexture(this.opts.skin, this.opts.hair, 'laugh', this.faceSize);
      this.faceBlow = faceTexture(this.opts.skin, this.opts.hair, 'blow', this.faceSize);
      this.faceOh = faceTexture(this.opts.skin, this.opts.hair, 'oh', this.faceSize);
      this.faceKiss = faceTexture(this.opts.skin, this.opts.hair, 'kiss', this.faceSize);
      this.mFace.uniforms.uMap.value = this.faceOpen;
      this.mFace.uniforms.uMap2.value = this.faceSmile;
    }
    if (glasses !== undefined) this.glasses.visible = !!glasses;
  }

  // p: pose description (see timeline). time: seconds.
  pose(p, time, reduced) {
    const amb = reduced ? 0.35 : 1;
    const fly = p.fly;
    // body offset: in flight the pivot is her centre
    this.body.position.y = -0.81 * fly - 0.435 * SK * p.kneel;
    this.body.position.z = 0.04 * p.kneel;
    // walking: she rises over each step as it passes beneath her and settles as her
    // feet spread; her weight shifts over the foot she stands on, hips and skirt turning
    // with her legs, shoulders against them
    // (gliding fast: smaller, lighter steps)
    const gl = p.glide || 0;
    const wa = p.walkAmt * (1 - 0.55 * gl), wph = p.walkPhase;
    const cw = Math.cos(wph), sw = Math.sin(wph);
    // (skipping for joy: a little hop off each step)
    const skip = (p.skip || 0) * wa;
    const walkBob = (Math.abs(cw) - 0.36) * 0.024 * wa + (Math.pow(Math.abs(cw), 0.6) - 0.62) * 0.085 * skip;
    const sway = cw * 0.011 * wa;
    const breathe = Math.sin(time * 1.6) * 0.004 * amb;
    const dip = p.landDip || 0;
    this.body.position.y += walkBob + breathe - 0.045 * dip;
    this.body.position.x = sway;
    const still = (1 - wa) * (1 - fly);
    this.body.rotation.z = Math.sin(time * 0.6) * 0.012 * amb * still;
    // standing a while, her weight settles onto one leg and now and then the other: hips
    // over that foot, the shoulder on that side dropping a little, her head tipping softly
    // the other way, the free knee easing (the hem hanging toward it)
    {
      const W = this.ws || (this.ws = { cur: 0, goal: 0, next: 0, last: time });
      const wdt = Math.min(Math.max(time - W.last, 0), 0.1);
      W.last = time;
      const ok = !reduced && still > 0.97 && p.kneel < 0.02 && !p.spin && (p.hold || 0) < 0.05 && (p.wish || 0) < 0.05;
      if (!ok) { W.goal = 0; W.next = Math.max(W.next, time + 1.5); }
      else if (time > W.next) {
        W.goal = W.goal === 0 ? (Math.random() < 0.5 ? 1 : -1) : Math.random() < 0.8 ? -W.goal : 0;
        W.next = time + 3.5 + Math.random() * 4;
      }
      W.cur += (W.goal - W.cur) * (1 - Math.exp(-wdt * 1.6));
    }
    const ws = this.ws.cur * still * (1 - p.kneel);
    // (a giggle shakes her shoulders: "hehehe")
    const gig = reduced ? 0 : smoothstep(0.35, 0.85, p.laugh || 0) * (1 - fly);
    this.giggle = gig;
    this.body.position.y += Math.abs(Math.sin(time * 15)) * 0.0045 * gig;
    this.body.position.x += ws * 0.026;
    this.body.position.y -= Math.abs(ws) * 0.007;
    // getting up (or down): the weight shifts forward over the knees half way
    const rising = p.kneel * (1 - p.kneel) * 4;
    this.torso.rotation.x = p.lean + p.kneel * 0.42 + rising * 0.2 + (Math.abs(sw) - 0.64) * 0.03 * wa + 0.1 * dip + 0.07 * gl;
    this.torso.rotation.z = -cw * 0.028 * wa + Math.sin(time * 0.9) * 0.01 * amb - ws * 0.05;
    this.torso.rotation.y = (p.torsoYaw || 0) - sw * 0.07 * wa;
    this.skirt.rotation.y = sw * 0.06 * wa;
    // (the hem: each side carried with its leg, swinging out against the hips, a beat late)
    {
      const st = this.mDress.uniforms.uStride.value;
      const lag = wph - 0.55;
      st.set(-Math.sin(lag) * 0.05 * wa, Math.sin(lag) * 0.05 * wa, -Math.cos(lag) * 0.016 * wa - ws * 0.02, (p.flare || 0) + 0.45 * Math.max(0, dip) + 0.22 * skip * Math.pow(Math.abs(Math.sin(wph - 0.9)), 2));
    }
    // feet step out from under the hem (the one she stands on stays put as she sways)
    this.feet.forEach(({ side, mesh }) => {
      const ph = wph + (side > 0 ? Math.PI : 0);
      const step = Math.sin(ph) * 0.1 * wa;
      const lift = Math.max(0, Math.cos(ph)) * 0.03 * wa;
      // (with her weight on one leg the other foot eases out a little, toe turned out)
      const free = Math.max(0, -ws * side);
      mesh.position.set(side * (0.064 + 0.012 * free) - sway - ws * 0.026, lift - 0.004 - walkBob + Math.abs(ws) * 0.007, 0.065 + step + 0.018 * free);
      mesh.rotation.y = side * 0.16 * free;
      // heel down as it lands, toe pushing off behind
      mesh.rotation.x = (-Math.max(0, Math.cos(ph)) * 0.22 + Math.max(0, -Math.cos(ph)) * Math.max(0, -Math.sin(ph)) * 0.25) * wa;
      mesh.visible = fly < 0.5 && p.kneel < 0.4;
    });
    // head
    const wish = p.wish || 0;
    this.head.rotation.set(
      p.headPitch * (1 - wish) - 0.34 * wish + Math.sin(time * 0.7) * 0.02 * amb + Math.sin(time * 15) * 0.022 * this.giggle,
      p.headYaw + Math.sin(p.walkPhase) * 0.055 * p.walkAmt,
      p.headRoll + Math.sin(time * 0.45) * 0.015 * amb * still + ws * 0.03,
    );
    const laugh = p.laugh || 0, blow = p.blow || 0;
    // (a little "oh!" of surprise and delight: brows up, eyes wide, lips a round "o")
    const oh = blow > 0.01 ? 0 : Math.min(1, p.oh || 0);
    // (a kiss for her cat: lips puckered, eyes closed)
    const kiss = blow > 0.01 || oh > 0.01 ? 0 : Math.min(1, p.kiss || 0);
    const fu = this.mFace.uniforms;
    fu.uMap2.value = blow > 0.01 ? this.faceBlow : oh > 0.01 ? this.faceOh : kiss > 0.01 ? this.faceKiss : laugh > 0.01 ? this.faceLaugh : this.faceSmile;
    const mix = Math.max(p.smile, wish, laugh, kiss) * (1 - blow) * (1 - oh);
    // (a fond smile keeps her eyes open: for watching her cat)
    fu.uMapMix.value = blow > 0.01 ? smooth01(blow * 1.6) : oh > 0.01 ? smooth01(oh * 1.5) : kiss > 0.01 ? smooth01(kiss * 1.6) : smooth01((Math.max(mix, p.fond || 0) - 0.42) / 0.16);
    fu.uHappy.value = mix;
    // she blinks now and then (and sometimes twice): quick to close, softer to open
    const blinkAt = (t0) => { const d = time - t0; return d < 0 || d > 0.2 ? 0 : d < 0.06 ? smooth01(d / 0.06) : 1 - smooth01((d - 0.06) / 0.14); };
    const bp = time % 4.7, bq = time % 13.1;
    let blink = Math.max(blinkAt(time - bp), blinkAt(time - bq + 6.0), blinkAt(time - bq + 6.26));
    if (reduced) blink = 0;
    fu.uBlink.value = blink * (1 - smooth01((mix - 0.2) / 0.3)) * (1 - oh);
    // a wink, once each time she arrives at that moment (a beat after it starts)
    const wz = p.winkZone || 0;
    if (wz > 0.5 && !this.winkOn) { this.winkOn = true; this.winkT0 = time; }
    if (wz < 0.5) this.winkOn = false;
    let wink = 0;
    if (this.winkOn) {
      const d = time - this.winkT0 - 0.45;
      wink = d < 0 ? 0 : d < 0.09 ? smooth01(d / 0.09) : d < 0.75 ? 1 : 1 - smooth01((d - 0.75) / 0.2);
    }
    fu.uWink.value = reduced ? 0 : wink;
    // (her wink by the cake: just the wink now - no hand raised; her hands are for the wish)
    // a twinkle in her eyes at the magic moments (and in the open eye when she winks)
    fu.uStar.value = Math.max(p.sparkle || 0, wink, 0.8 * oh);
    // where she looks: mostly at us, little glances now and then; down at the flower
    // when she kneels, up at the sky when she wishes
    const dt = Math.min(Math.max(time - this.lastTime, 0), 0.1);
    this.lastTime = time;
    // (her cheeks warm when she's touched: a kiss, a cuddle, its fuss over her)
    this.blushV = lerp(this.blushV || 0, reduced ? 0 : Math.min(1, p.blush || 0), 1 - Math.exp(-dt * 2.5));
    fu.uBlush.value = this.blushV;
    if (time > this.nextGlance || time < this.nextGlance - 10) {
      const r = mulberry32(Math.floor(time * 7.3))();
      const r2 = mulberry32(Math.floor(time * 3.1) + 7)();
      this.gazeGoal.set(r < 0.45 ? 0 : (r - 0.72) * 1.3, r2 < 0.5 ? 0 : (r2 - 0.75) * 0.8);
      this.nextGlance = time + 1.6 + r2 * 2.6;
    }
    const gx = lerp(this.gazeGoal.x, p.gazeX ?? 0, p.gazeK ?? 0);
    const gy = lerp(this.gazeGoal.y, p.gazeY ?? 0, p.gazeK ?? 0);
    const kneelLook = p.kneel * (1 - wish);
    const tx = lerp(gx, -0.5, kneelLook), ty = lerp(lerp(gy, -0.72, kneelLook), 0.85, wish);
    const k = 1 - Math.exp(-dt * 14);
    this.gaze.x += (tx - this.gaze.x) * k;
    this.gaze.y += (ty - this.gaze.y) * k;
    if ((p.gazeK ?? 0) >= 1) this.gaze.set(p.gazeX ?? 0, p.gazeY ?? 0);
    fu.uGaze.value.copy(this.gaze).multiplyScalar(reduced ? 0.5 : 1);
    // hair hangs with gravity when she is upright
    const tilt = (this.torso.rotation.x + this.head.rotation.x) * (1 - fly) * 0.85;
    this.mHair.uniforms.uTwist.value = -this.head.rotation.y * (1 - fly * 0.5);
    // (the front locks follow her turning head part of the way, so the far side's locks stay
    // in front of her shoulder instead of slipping round behind it)
    this.mLocks.uniforms.uTwist.value = -this.head.rotation.y * (1 - fly * 0.5) * 0.55;
    this.backHair.rotation.x = -tilt;
    this.locks.forEach((l) => { l.rotation.x = -tilt * 0.9; });
    const tiltT = this.torso.rotation.x * (1 - fly) * 0.9;
    this.ribbons.forEach((r) => { r.rotation.x = -tiltT * 0.5; });

    // arms: blend of rest, walk swing, open, reach, clasp, flight
    this.arms.forEach((arm) => {
      const { side, sh, elbow, hand } = arm;
      const aph = p.walkPhase + (side > 0 ? Math.PI : 0);
      const gla = p.glide || 0;
      const swing = Math.sin(aph) * 0.3 * p.walkAmt * (1 - 0.6 * gla) * (1 + 0.9 * (p.skip || 0)) + 0.32 * gla;
      // (the forearm swings a beat behind the upper arm, bending as it comes forward)
      let ax = swing + 0.05, az = side * (0.12 + 0.03 * p.walkAmt + 0.22 * gla), ay = 0;
      let el = -0.2 - (Math.max(0, -Math.sin(aph - 0.5)) * 0.42 + 0.06) * p.walkAmt;
      // standing still she is never quite still: arms drift softly with her breath
      const idle = still * (1 - p.kneel) * amb;
      // (a soft, relaxed stance: elbows eased, forearms a little forward, never stiff at her sides)
      ax += Math.sin(time * 0.8 + side * 0.9) * 0.03 * idle - 0.05 * idle;
      az += side * (0.025 + Math.sin(time * 0.55 + side) * 0.015) * idle;
      el -= (0.2 + Math.sin(time * 0.8 + side * 0.9 + 0.6) * 0.03) * idle;
      ax = lerp(ax, 0.5, fly); az = lerp(az, side * 0.55, fly); el = lerp(el, -0.15, fly);
      ax = lerp(ax, -0.25, p.armsOpen); az = lerp(az, side * 0.95, p.armsOpen); el = lerp(el, -0.25, p.armsOpen);
      if (side > 0) { ax = lerp(ax, -0.95, p.reach); az = lerp(az, 0.15, p.reach); el = lerp(el, -0.35, p.reach); }
      else { ax = lerp(ax, -0.25, p.reach * 0.6); az = lerp(az, -0.1, p.reach * 0.6); el = lerp(el, -1.2, p.reach * 0.6); }
      const cl = p.clasp * (1 - wish);
      ax = lerp(ax, -0.62, cl); az = lerp(az, -side * 0.02, cl); ay = lerp(ay, -side * 0.55, cl); el = lerp(el, -1.55, cl);
      ax = lerp(ax, -0.18, wish); az = lerp(az, side * 0.42, wish); el = lerp(el, -0.3, wish);
      ax = lerp(ax, -0.2, p.balance); az = lerp(az, side * 0.75, p.balance);
      az += side * 0.35 * Math.max(0, dip); el -= 0.2 * Math.max(0, dip);
      // hands to her knees as she pushes herself up
      ax = lerp(ax, -0.5, rising * 0.7); az = lerp(az, side * 0.06, rising * 0.7); el = lerp(el, -0.45, rising * 0.7);
      // petting her cat: one hand out and down onto its head, the other resting on her knee
      if (p.petArm) {
        const pa = p.petArm, ps = p.petSide || 1;
        if (side === ps) { ax = lerp(ax, -1.2, pa); az = lerp(az, side * 0.2, pa); el = lerp(el, -0.32, pa); }
        else { ax = lerp(ax, -0.42, pa); az = lerp(az, -side * 0.08, pa); el = lerp(el, -0.7, pa); }
      }
      // tucking her hair behind her ear: the hand up to the side of her head and back
      // (two solved poses: fingertips in the hair in front of her ear, then slid back over it)
      const tucking = p.tuck && side === (p.tuckSide || 1);
      const tq = (i) => lerp((p.tuckA || TUCK_A)[i], (p.tuckB || TUCK_B)[i], p.tuckSweep || 0);
      if (tucking) {
        // (the elbow folds first, so the hand comes up close past her chest, not out wide)
        const tk = p.tuck, te = smooth01(Math.min(1, tk * 1.7));
        ax = lerp(ax, tq(0), tk); ay = lerp(ay, side * tq(1), tk); az = lerp(az, side * tq(2), tk); el = lerp(el, tq(3), te);
      }
      // a hand held out, palm up (a perch for a butterfly)
      const perching = p.perch && side === (p.perchSide || 1);
      if (perching) {
        const pk = p.perch, pe = smooth01(Math.min(1, pk * 1.5));
        ax = lerp(ax, PERCH[0], pk); ay = lerp(ay, side * PERCH[1], pk); az = lerp(az, side * PERCH[2], pk); el = lerp(el, PERCH[3], pe);
      }
      // clapping her hands (delighted with her cat)
      if (p.clap) {
        const c = p.clap, o = 0.5 + 0.5 * Math.cos(time * 15);
        ax = lerp(ax, -0.7, c); ay = lerp(ay, -side * 0.5, c); az = lerp(az, side * (0.05 + 0.2 * o), c); el = lerp(el, -1.5, c);
      }
      // holding her cat
      const holding = p.hold > 0;
      const hq = (i) => lerp(HOLD_REACH[i], (side === (p.holdSide || 1) ? HOLD_UNDER : HOLD_ACROSS)[i], p.holdLift || 0);
      if (holding) {
        const k = p.hold;
        ax = lerp(ax, hq(0), k); ay = lerp(ay, side * hq(1), k); az = lerp(az, side * hq(2), k); el = lerp(el, hq(3), k);
      }
      // an arm round her cat beside her (now and then a slow stroke down its back)
      const around = p.around && side === (p.aroundSide || 1);
      if (around) {
        const k = p.around, st = (p.aroundStroke || 0) * (0.5 - 0.5 * Math.cos(time * 1.7));
        ax = lerp(ax, AROUND[0] - 0.16 * st, k); ay = lerp(ay, side * AROUND[1], k); az = lerp(az, side * (AROUND[2] - 0.03 * st), k); el = lerp(el, AROUND[3] - 0.12 * st, k);
      }
      // a hand out, palm up, for its paw (bobbing a little: "shake")
      const pawArm = p.paw && side === (p.petSide || 1);
      if (pawArm) {
        const k = p.paw, bob = Math.sin(time * 9) * 0.05 * smoothstep(0.7, 1, k) * (p.pawShake || 0);
        ax = lerp(ax, PAW[0] + bob, k); ay = lerp(ay, side * PAW[1], k); az = lerp(az, side * PAW[2], k); el = lerp(el, PAW[3] - bob, k);
      }
      // a peace sign for us
      const peaceArm = p.peace && side === (p.peaceSide || 1);
      if (peaceArm) {
        const k = p.peace, ke = smooth01(Math.min(1, k * 1.5));
        ax = lerp(ax, PEACE[0], k); ay = lerp(ay, side * PEACE[1], k); az = lerp(az, side * PEACE[2], k); el = lerp(el, PEACE[3], ke);
      }
      // giggling behind her hand
      const covering = p.cover && side === (p.coverSide || -1);
      if (covering) {
        const k = p.cover, ke = smooth01(Math.min(1, k * 1.6));
        ax = lerp(ax, COVER[0], k); ay = lerp(ay, side * COVER[1], k); az = lerp(az, side * COVER[2], k); el = lerp(el, COVER[3], ke);
      }
      // beckoning: a hand held out low toward it
      if (p.beckon && side === (p.petSide || 1)) {
        const k = p.beckon;
        ax = lerp(ax, -0.62, k); az = lerp(az, side * 0.16, k); el = lerp(el, -0.42, k);
      }
      // a boop on the nose
      const booping = p.boop > 0 && side === (p.petSide || 1);
      if (booping) {
        const k = p.boop;
        ax = lerp(ax, BOOP[0], k); ay = lerp(ay, side * BOOP[1], k); az = lerp(az, side * BOOP[2], k); el = lerp(el, BOOP[3], k);
      }
      // stroking: the hand moves softly back and forth over its head
      if (side === (p.petSide || 1) && p.stroke) {
        const sr = 3.6 * (p.strokeK || 1);
        const sk = Math.sin(time * sr);
        ax += sk * 0.1 * p.stroke; el += (Math.sin(time * sr + 0.9) * 0.1 - 0.05) * p.stroke;
      }
      sh.rotation.set(ax, ay, az);
      elbow.rotation.set(el, 0, 0);
      this.bendArm(arm, el);
      // wrists: relaxed, palms turning in; open toward the sky when she wishes
      hand.rotation.set(-0.12 - 0.3 * p.reach * (side > 0 ? 1 : 0) + Math.sin(aph - 1.1) * 0.16 * p.walkAmt, side * (0.25 + 0.5 * Math.max(cl, p.clap || 0)), side * 0.06);
      if (holding) {
        const k = p.hold;
        hand.rotation.set(lerp(hand.rotation.x, hq(4), k), lerp(hand.rotation.y, side * hq(5), k), lerp(hand.rotation.z, side * hq(6), k));
      }
      if (booping) {
        const k = p.boop;
        hand.rotation.set(lerp(hand.rotation.x, BOOP[4], k), lerp(hand.rotation.y, side * BOOP[5], k), lerp(hand.rotation.z, side * BOOP[6], k));
      }
      if (around) {
        const k = p.around;
        hand.rotation.set(lerp(hand.rotation.x, AROUND[4], k), lerp(hand.rotation.y, side * AROUND[5], k), lerp(hand.rotation.z, side * AROUND[6], k));
      }
      if (covering) {
        const k = p.cover;
        hand.rotation.set(lerp(hand.rotation.x, COVER[4], k), lerp(hand.rotation.y, side * COVER[5], k), lerp(hand.rotation.z, side * COVER[6], k));
      }
      if (peaceArm) {
        const k = p.peace;
        hand.rotation.set(lerp(hand.rotation.x, PEACE[4], k), lerp(hand.rotation.y, side * PEACE[5], k), lerp(hand.rotation.z, side * PEACE[6], k));
      }
      if (pawArm) {
        const k = p.paw;
        hand.rotation.set(lerp(hand.rotation.x, PAW[4], k), lerp(hand.rotation.y, side * PAW[5], k), lerp(hand.rotation.z, side * PAW[6], k));
      }
      if (perching) {
        const pk = smooth01(Math.min(1, p.perch * 1.3));
        hand.rotation.set(lerp(hand.rotation.x, PERCH[4], pk), lerp(hand.rotation.y, side * PERCH[5], pk), lerp(hand.rotation.z, side * PERCH[6], pk));
      }
      if (tucking) {
        const tk = smooth01(Math.min(1, p.tuck * 1.4));
        hand.rotation.set(lerp(hand.rotation.x, tq(4), tk), lerp(hand.rotation.y, side * tq(5), tk), lerp(hand.rotation.z, side * tq(6), tk));
      }
      // fingers: relaxed, a little more curled walking, closed round things she holds,
      // flat for a perch or a clap
      let curl = lerp(0.18, 0.3, p.walkAmt);
      curl = lerp(curl, 0.02, p.armsOpen);
      curl = lerp(curl, 0.55, Math.max(cl, wish * 0.6));
      if (perching) curl = lerp(curl, -0.3, p.perch);
      if (p.clap) curl = lerp(curl, -0.2, p.clap);
      if (holding) curl = lerp(curl, 0.68, p.hold);
      if (covering) curl = lerp(curl, 0.55, p.cover);
      if (pawArm) curl = lerp(curl, 0.12, p.paw);
      if (tucking) curl = lerp(curl, 0.05, p.tuck);
      // (the beckoning fingers curling and uncurling)
      if (p.beckon && side === (p.petSide || 1)) curl = lerp(curl, 0.35 + 0.45 * Math.sin(time * 7.5), p.beckon);
      const ck = arm.curlT === undefined ? 1 : 1 - Math.exp(-Math.min(Math.max(time - arm.curlT, 0), 0.1) * 10);
      arm.curlT = time;
      arm.curl += (curl - arm.curl) * ck;
      const point = side === (p.petSide || 1) ? (p.boop || 0) : 0;
      const peace = side === (p.peaceSide || 1) ? (p.peace || 0) : 0;
      if (arm.curlNow === null || Math.abs(arm.curl - arm.curlNow) > 0.008 || Math.abs(point - (arm.pointNow || 0)) > 0.01 || Math.abs(peace - (arm.peaceNow || 0)) > 0.01) {
        fingerCurl(this.fingerRig[side > 0 ? 0 : 1], arm.curl, point, peace);
        arm.curlNow = arm.curl; arm.pointNow = point; arm.peaceNow = peace;
      }
    });

    // wings
    const spread = p.wingSpread;
    const flap = Math.sin(time * p.flapSpeed) * p.flap * amb;
    this.wings.forEach(({ side, pivot }, i) => {
      const raise = lerp(-1.15, 0.12, spread) + flap * 0.55;
      const sweep = lerp(1.05, 0.18, spread);
      pivot.rotation.set(lerp(0.15, -0.05, spread), side * sweep, side * raise);
      this.wingMats[i].uniforms.uBend.value = flap * 0.6 * spread;
      this.wingMats[i].uniforms.uDissolve.value = p.dissolve;
      pivot.visible = p.dissolve < 0.999 && p.wingsVisible > 0.5;
    });
    // the halo fades with her wings
    const haloA = (p.wingsVisible > 0.5 ? 1 : 0) * (1 - smooth01(p.dissolve * 1.6));
    this.halo.visible = haloA > 0.01;
    this.mHalo.uniforms.uOpacity.value = haloA;
    this.haloGlow.material.uniforms.uOpacity.value = 0.55 * haloA;
    this.haloBob = Math.sin(time * 1.4) * 0.004 * amb;
    this.aura.material.uniforms.uOpacity.value = p.aura;
    this.aura.visible = p.aura > 0.01;
    this.mDress.uniforms.uKneel.value = p.kneel;
    this.updateOccluders();
    // springy curl: driven by how her head accelerates (in the head's own frame)
    {
      const A = this.ahogeS;
      const hp = this.head.getWorldPosition(this._v2 || (this._v2 = new THREE.Vector3()));
      const dtc = Math.min(Math.max(time - (A.t || time), 0), 1 / 20);
      A.t = time;
      if (!A.init || dtc <= 0) { A.p.copy(hp); A.v.set(0, 0, 0); A.init = true; }
      else {
        const nv = (A.nv || (A.nv = new THREE.Vector3())).copy(hp).sub(A.p).divideScalar(dtc);
        const acc = (A.acc || (A.acc = new THREE.Vector3())).copy(nv).sub(A.v).divideScalar(dtc);
        A.p.copy(hp); A.v.copy(nv);
        const qi = this.head.getWorldQuaternion(this._q2 || (this._q2 = new THREE.Quaternion())).invert();
        acc.applyQuaternion(qi).clampLength(0, 40);
        const steps = 3, h = dtc / steps;
        for (let i = 0; i < steps; i++) {
          // lean against the acceleration, a soft idle sway, springing back
          const tx = clamp(acc.z * 0.02 - acc.y * 0.012, -0.6, 0.6) + Math.sin(time * 1.3) * 0.04 * amb;
          const tz = clamp(-acc.x * 0.02, -0.6, 0.6) + Math.sin(time * 0.9 + 1.0) * 0.05 * amb;
          A.vx += (140 * (tx - A.x) - 7 * A.vx) * h; A.x += A.vx * h;
          A.vz += (140 * (tz - A.z) - 7 * A.vz) * h; A.z += A.vz * h;
        }
      }
      this.ahoge.rotation.set(clamp(A.x, -0.7, 0.7), 0, clamp(A.z, -0.7, 0.7));
      // her hair and skirt trail a little behind her movement, and swing when she stops
      const M = this.motion || (this.motion = { f: new THREE.Vector3(), v: new THREE.Vector3() });
      const goal = (M.goal || (M.goal = new THREE.Vector3())).copy(A.v).multiplyScalar(-0.025).clampLength(0, 0.06);
      if (dtc > 0) {
        const steps = 3, h = dtc / steps;
        const d = M.d || (M.d = new THREE.Vector3());
        for (let i = 0; i < steps; i++) {
          M.v.addScaledVector(d.copy(goal).sub(M.f), 60 * h).multiplyScalar(1 - 5 * h);
          M.f.addScaledVector(M.v, h);
        }
      }
    }
    this.updateSwing(time);
    // the halo floats level above her head whichever way she is turned (in flight her
    // head points forward, but the halo stays above it, tipped a little toward us)
    if (this.halo.visible) {
      const q = this.head.getWorldQuaternion(this._q).invert();
      const up = this._v.set(0, 1, 0).applyQuaternion(q);
      this.halo.position.set(0, 0.118, 0.008).addScaledVector(up, 0.175 + this.haloBob);
      this._hq = this._hq || new THREE.Quaternion();
      this._he = this._he || new THREE.Euler(0, 0, 0, 'YXZ');
      this._he.set(-0.3, this.root.rotation.y, 0, 'YXZ');
      this._hq.setFromEuler(this._he);
      this.halo.quaternion.copy(q).multiply(this._hq);
    }
  }

  // Her hair swings: the back hair and each front lock is a little damped spring, hanging
  // from a point on her head and pushed by how that point accelerates (turning her head
  // throws the locks out sideways; stopping, kneeling, a twirl set them swinging)
  updateSwing(time) {
    const S = this.swing || (this.swing = {
      t: time, init: false,
      back: { a: new THREE.Vector3(0, 0.1, -0.11), k: 55, c: 4.2, m: 0.016, x: new THREE.Vector3(), v: new THREE.Vector3(), p: new THREE.Vector3(), pv: new THREE.Vector3() },
      L: { a: new THREE.Vector3(0.11, 0.06, 0.03), k: 85, c: 4.6, m: 0.02, x: new THREE.Vector3(), v: new THREE.Vector3(), p: new THREE.Vector3(), pv: new THREE.Vector3() },
      R: { a: new THREE.Vector3(-0.11, 0.06, 0.03), k: 85, c: 4.6, m: 0.02, x: new THREE.Vector3(), v: new THREE.Vector3(), p: new THREE.Vector3(), pv: new THREE.Vector3() },
    });
    const dt = Math.min(Math.max(time - S.t, 0), 1 / 20);
    S.t = time;
    // the sash tails: knocked about (by a paw), they swing out and back, and settle
    if (!S.rb) S.rb = [{ x: new THREE.Vector3(), v: new THREE.Vector3() }, { x: new THREE.Vector3(), v: new THREE.Vector3() }];
    for (const g of S.rb) {
      const steps = 3, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        g.v.x += (-26 * g.x.x - 1.5 * g.v.x) * h;
        g.v.y += (-26 * g.x.y - 1.5 * g.v.y) * h;
        g.v.z += (-34 * g.x.z - 2.2 * g.v.z) * h;
        g.x.addScaledVector(g.v, h);
      }
      g.x.clampLength(0, 0.2);
      // (never in through her skirt)
      if (g.x.z > 0.02) { g.x.z = 0.02; g.v.z = Math.min(g.v.z, 0); }
    }
    const q = this.skull.getWorldQuaternion(this._q3 || (this._q3 = new THREE.Quaternion())).invert();
    const w = this._v3 || (this._v3 = new THREE.Vector3()), nv = this._v4 || (this._v4 = new THREE.Vector3()), acc = this._v5 || (this._v5 = new THREE.Vector3());
    for (const g of [S.back, S.L, S.R]) {
      this.skull.localToWorld(w.copy(g.a));
      if (!S.init || dt <= 0) { g.p.copy(w); g.pv.set(0, 0, 0); continue; }
      nv.copy(w).sub(g.p).divideScalar(dt);
      acc.copy(nv).sub(g.pv).divideScalar(dt);
      g.p.copy(w); g.pv.copy(nv);
      // (in the head's own frame; a hard jump in the story is ignored)
      acc.applyQuaternion(q);
      if (acc.length() > 120) acc.set(0, 0, 0);
      acc.clampLength(0, 40);
      const steps = 3, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        // F = k (goal - x) - c v, the goal: lagging against the acceleration (and not upward
        // through her head: the hair can be thrown out and back, but hangs)
        const gx = -acc.x * g.m, gy = Math.min(0, -acc.y * g.m * 0.5), gz = -acc.z * g.m;
        g.v.x += (g.k * (gx - g.x.x) - g.c * g.v.x) * h;
        g.v.y += (g.k * (gy - g.x.y) - g.c * g.v.y) * h;
        g.v.z += (g.k * (gz - g.x.z) - g.c * g.v.z) * h;
        g.x.addScaledVector(g.v, h);
      }
      g.x.clampLength(0, 0.09);
    }
    S.init = true;
  }

  // the elbow bends smoothly: each ring of the arm turns part of the way round the elbow
  // (none above it, all of it a little below), so the arm stays one soft shape
  bendArm(arm, el) {
    if (arm.elBent !== null && Math.abs(arm.elBent - el) < 2e-4) return;
    arm.elBent = el;
    const g = arm.limb.geometry, { w, pos0, nor0, L1 } = g.userData;
    const P = g.attributes.position.array, Nn = g.attributes.normal.array;
    for (let i = 0, n = w.length; i < n; i++) {
      const k = i * 3, a = w[i] * el;
      if (a === 0) { P[k] = pos0[k]; P[k + 1] = pos0[k + 1]; P[k + 2] = pos0[k + 2]; Nn[k] = nor0[k]; Nn[k + 1] = nor0[k + 1]; Nn[k + 2] = nor0[k + 2]; continue; }
      const c = Math.cos(a), sn = Math.sin(a);
      const y = pos0[k + 1] + L1, z = pos0[k + 2];
      P[k] = pos0[k]; P[k + 1] = -L1 + y * c - z * sn; P[k + 2] = y * sn + z * c;
      const ny = nor0[k + 1], nz = nor0[k + 2];
      Nn[k] = nor0[k]; Nn[k + 1] = ny * c - nz * sn; Nn[k + 2] = ny * sn + nz * c;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }

  // world-space spheres for the soft contact shadows
  updateOccluders() {
    this.root.updateMatrixWorld(true);
    const o = this.occ.value, v = this._v;
    const set = (i, obj, x, y, z, r) => { v.set(x, y, z).applyMatrix4(obj.matrixWorld); o[i].set(v.x, v.y, v.z, r); };
    set(0, this.skull, 0, 0.0, 0.0, 0.152 * HEAD_SCALE / 1.3);
    set(1, this.torso, 0, 0.345, 0.0, 0.056);
    set(2, this.torso, 0, 0.2, 0.01, 0.105);
    set(3, this.body, 0, 0.72 * SK, 0, 0.11);
    this.arms.forEach(({ sh, elbow }, k) => {
      set(4 + k, sh, 0, -0.12, 0, 0.032);
      set(6 + k, elbow, 0, -0.15, 0, 0.03);
    });
  }

  // world-space flow (wind + motion) for dress and hair, converted to local spaces
  // her cat leaning into her skirt at a point (world x, z): pressed in by amt (m), dragged
  // along it by drag (m, along the way round counter-clockwise from above)
  setPush(x, z, amt, drag) {
    const u = this.mDress.uniforms.uPush.value;
    if (!(amt > 0.0005)) { u.z = 0; return; }
    const v = this._pv || (this._pv = new THREE.Vector3());
    this.skirt.updateWorldMatrix(true, false);
    v.set(x, this.root.position.y + 0.15, z);
    this.skirt.worldToLocal(v);
    const l = Math.hypot(v.x, v.z) || 1;
    u.set(v.x / l, v.z / l, amt, drag);
  }

  setFlow(flowWorld, amtDress, amtHair) {
    if (this.motion) flowWorld = this._fw ? this._fw.copy(flowWorld).add(this.motion.f) : (this._fw = flowWorld.clone().add(this.motion.f));
    const toLocal = (obj, v) => {
      obj.getWorldQuaternion(this._q);
      return this._v.copy(v).applyQuaternion(this._q.invert());
    };
    const d = toLocal(this.skirt, flowWorld);
    this.mDress.uniforms.uFlow.value.copy(d);
    this.mDress.uniforms.uFlowAmt.value = amtDress;
    const h = toLocal(this.backHair, flowWorld);
    const S = this.swing;
    this.mHair.uniforms.uFlow.value.copy(h);
    this.mHair.uniforms.uFlowAmt.value = amtHair;
    if (S) this.mHair.uniforms.uFlow.value.addScaledVector(S.back.x, 1 / amtHair);
    this.mHair.uniforms.uFlow2.value.copy(this.mHair.uniforms.uFlow.value);
    const hl = toLocal(this.locks[0], flowWorld);
    const lu = this.mLocks.uniforms;
    lu.uFlow.value.copy(hl); lu.uFlow2.value.copy(hl);
    if (S) { lu.uFlow.value.addScaledVector(S.R.x, 1 / amtHair); lu.uFlow2.value.addScaledVector(S.L.x, 1 / amtHair); }
    lu.uFlowAmt.value = amtHair;
    const r = toLocal(this.ribbons[0], flowWorld);
    const ru = this.mRibbon.uniforms;
    ru.uFlow.value.copy(r).multiplyScalar(1.4);
    ru.uFlow2.value.copy(ru.uFlow.value);
    ru.uFlowAmt.value = amtHair;
    if (S && S.rb) { ru.uFlow.value.addScaledVector(S.rb[0].x, 1 / amtHair); ru.uFlow2.value.addScaledVector(S.rb[1].x, 1 / amtHair); }
  }

  // A sash tail (0: her right, 1: her left) knocked by a paw: a push to its end, in her
  // own frame (x to her left, z forward), m/s
  swatRibbon(i, vx, vy, vz) {
    const S = this.swing;
    if (!S || !S.rb) return;
    // (the flow moves the end by f^2 of it: about 0.58)
    S.rb[i].v.x += vx / 0.58; S.rb[i].v.y += vy / 0.58; S.rb[i].v.z += vz / 0.58;
  }

  // where a sash tail's end hangs now (world), with its swing
  ribbonEnd(i, out) {
    const rb = this.ribbons[i];
    const ru = this.mRibbon.uniforms;
    out.copy(rb.userData.tip);
    const f = i === 0 ? ru.uFlow.value : ru.uFlow2.value;
    out.addScaledVector(f, ru.uFlowAmt.value * 0.58);
    return rb.localToWorld(out);
  }
}
