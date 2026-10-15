// Meadow plants: dense grass clumps, Ha Giang buckwheat, daisies, cosmos,
// lavender and forget-me-nots. Unit-scale geometries for instancing; every
// vertex carries its part (stem / leaf / bloom / centre) and its height along
// the plant (for the dark-to-light gradient and the wind bend).
import * as THREE from 'three';
import { mulberry32, TAU, clamp } from './math.js';
import { COMMON, BLOOM_GLSL, GROW_GLSL } from './shaders.js';

const STEM = 0, LEAF = 1, BLOOM = 2, CENTRE = 3;

class PB {
  constructor() { this.p = []; this.n = []; this.k = []; this.t = []; this.i = []; this.c = []; this.r = []; this.s = []; this.hc = null; this.pr = 0; this.ps = 0; }
  // hc: the centre of the flower head being built (petals open out from it); pr: how far
  // along its petal a vertex lies (0 at the heart, 1 at the tip)
  v(x, y, z, nx, ny, nz, part, t) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z); this.n.push(nx / l, ny / l, nz / l); this.k.push(part); this.t.push(t);
    if (this.hc) this.c.push(this.hc[0], this.hc[1], this.hc[2]); else this.c.push(x, y, z);
    this.r.push(this.pr);
    this.s.push(this.ps);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.k, 1));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute('aHC', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aR', new THREE.Float32BufferAttribute(this.r, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// A tapered ribbon along a polyline (blades, stems, leaves). Normals lean up so
// thin geometry shades softly from every side.
function ribbon(B, pts, widths, part, t0 = 0, t1 = 1, up = 0.6, side = null) {
  const n = pts.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // side vector: horizontal, perpendicular to the tangent (or given)
    let sx, sz;
    if (side) { sx = side[0]; sz = side[1]; } else { sx = -tz; sz = tx; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl; if (Math.hypot(tx, tz) < 0.05) { sx = 1; sz = 0; } }
    const w = widths[i] * 0.5;
    // face normal = side x tangent, then tilted up
    let nx = 0 * tz - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty - 0 * tx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const t = t0 + (t1 - t0) * (i / (n - 1));
    const [x, y, z] = pts[i];
    // (aS across the ribbon: -1 one edge, 1 the other - a blade's fold, a leaf's midrib)
    if (w < 1e-5) { B.ps = 0; const c = B.v(x, y, z, nx, ny + up, nz, part, t); L.push(c); R.push(c); }
    else { B.ps = -1; L.push(B.v(x - sx * w, y, z - sz * w, nx, ny + up, nz, part, t)); B.ps = 1; R.push(B.v(x + sx * w, y, z + sz * w, nx, ny + up, nz, part, t)); }
  }
  B.ps = 0;
  for (let i = 0; i < n - 1; i++) {
    if (L[i + 1] === R[i + 1]) B.tri(L[i], R[i], L[i + 1]);
    else if (L[i] === R[i]) B.tri(L[i], R[i + 1], L[i + 1]);
    else B.quad(L[i], R[i], R[i + 1], L[i + 1]);
  }
}

// curved stalk from the ground: lean direction (dx, dz), bend grows toward the tip
function stalk(h, dx, dz, lean, segs = 3, x0 = 0, z0 = 0) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const f = i / segs;
    pts.push([x0 + dx * lean * h * f * f, h * f, z0 + dz * lean * h * f * f]);
  }
  return pts;
}

// flat flower head: centre disc + petals, facing `nrm` (unit), at `c`
// petal styles: 'wedge' (one slim ray), 'round' (base, two shoulders and a rounded tip),
// 'notch' (cosmos: a notched, fan-shaped tip)
function head(B, c, nrm, rnd, { petals = 12, r0 = 0.012, r1 = 0.05, w = 0.012, cup = 0.25, notch = false, centre = 0.016, tMax = 1, wedge = false, ring = 6, round = false, paddle = false, kite = false } = {}) {
  // basis around the normal
  const [nx, ny, nz] = nrm;
  let ux = -nz, uy = 0, uz = nx; let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-3) { ux = 1; uy = 0; uz = 0; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const at = (a, r, lift) => [c[0] + (ux * Math.cos(a) + vx * Math.sin(a)) * r + nx * lift, c[1] + (uy * Math.cos(a) + vy * Math.sin(a)) * r + ny * lift, c[2] + (uz * Math.cos(a) + vz * Math.sin(a)) * r + nz * lift];
  const off = rnd() * TAU;
  B.hc = c;
  // (rr: how far out along the petal; sd: across it, -1 one edge, 0 its midline, 1 the other)
  const V = (p, rr, t, sd = 0) => { B.pr = rr; B.ps = sd; return B.v(...p, nx, ny + 0.4, nz, BLOOM, t); };
  for (let k = 0; k < petals; k++) {
    const a = off + (k / petals) * TAU + (rnd() - 0.5) * 0.12;
    const len = r1 * (0.88 + rnd() * 0.22);
    const hw = w * 0.5 * (len / r1);
    const da = hw / Math.max(len, 1e-3);
    const p0 = at(a, r0, 0.002);
    if (wedge) {
      // one slim triangle per petal (cheap rays)
      const i0 = V(at(a - da * 0.3, r0, 0.002), 0, tMax * 0.92, -1);
      const i1 = V(at(a + da * 0.3, r0, 0.002), 0, tMax * 0.92, 1);
      const i2 = V(at(a, len, len * cup), 1, tMax, 0);
      B.tri(i0, i1, i2);
      continue;
    }
    if (kite) {
      // two triangles: a diamond petal (cheap; reads round when small)
      const i0 = V(p0, 0, tMax * 0.92, 0);
      const il = V(at(a - da * 1.1, len * 0.58, len * cup * 0.4), 0.58, tMax * 0.97, -1);
      const ir = V(at(a + da * 1.1, len * 0.58, len * cup * 0.4), 0.58, tMax * 0.97, 1);
      const tp = V(at(a, len, len * cup), 1, tMax, 0);
      B.tri(i0, ir, il); B.tri(il, ir, tp);
      continue;
    }
    if (paddle) {
      // three triangles: a spoon-shaped petal with a broad, squared-off tip
      const i0 = V(p0, 0, tMax * 0.92, 0);
      const il = V(at(a - da * 1.0, len * 0.55, len * cup * 0.4), 0.55, tMax * 0.97, -1);
      const ir = V(at(a + da * 1.0, len * 0.55, len * cup * 0.4), 0.55, tMax * 0.97, 1);
      const tl = V(at(a - da * 0.62, len, len * cup), 1, tMax, -0.62);
      const tr = V(at(a + da * 0.62, len, len * cup), 1, tMax, 0.62);
      B.tri(i0, ir, il); B.tri(il, ir, tr); B.tri(il, tr, tl);
      continue;
    }
    if (round) {
      // a rounded petal: narrow at the heart, widest two thirds out, soft tip
      const i0 = V(p0, 0, tMax * 0.92, 0);
      const il = V(at(a - da * 1.0, len * 0.62, len * cup * 0.45), 0.62, tMax * 0.97, -1);
      const ir = V(at(a + da * 1.0, len * 0.62, len * cup * 0.45), 0.62, tMax * 0.97, 1);
      const tl = V(at(a - da * 0.55, len * 0.94, len * cup * 0.9), 0.94, tMax, -0.55);
      const tr = V(at(a + da * 0.55, len * 0.94, len * cup * 0.9), 0.94, tMax, 0.55);
      const tp = V(at(a, len, len * cup), 1, tMax, 0);
      B.tri(i0, ir, il); B.tri(il, ir, tr); B.tri(il, tr, tl); B.tri(tl, tr, tp);
      continue;
    }
    const pl = at(a - da * 0.8, len * 0.55, len * cup * 0.35);
    const pr = at(a + da * 0.8, len * 0.55, len * cup * 0.35);
    const i0 = V(p0, 0, tMax * 0.92, 0);
    const il = V(pl, 0.55, tMax, -1);
    const ir = V(pr, 0.55, tMax, 1);
    if (notch) {
      const tl = at(a - da * 0.55, len, len * cup);
      const tm = at(a, len * 0.9, len * cup * 0.9);
      const tr = at(a + da * 0.55, len, len * cup);
      const a1 = V(tl, 1, tMax, -0.6), a2 = V(tm, 0.9, tMax, 0), a3 = V(tr, 1, tMax, 0.6);
      B.tri(i0, ir, il); B.tri(il, ir, a2); B.tri(il, a2, a1); B.tri(ir, a3, a2);
    } else {
      const tp = V(at(a, len, len * cup), 1, tMax, 0);
      B.tri(i0, ir, il); B.tri(il, ir, tp);
    }
  }
  if (centre > 0) {
    // little domed disc
    B.pr = 0;
    const top = B.v(...at(0, 0, centre * 0.55), nx, ny, nz, CENTRE, tMax);
    const rv = [];
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * TAU;
      const p = at(a, centre, 0.002);
      const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
      rv.push(B.v(...p, nx + dx * 20, ny + dy * 20, nz + dz * 20, CENTRE, tMax));
    }
    for (let k = 0; k < ring; k++) B.tri(top, rv[k], rv[(k + 1) % ring]);
  }
  B.hc = null; B.pr = 0; B.ps = 0;
}

// --- grass: a clump of curved, tapering blades ---------------------------------
// (a soft tuft: blades fan out from a tight base, arching over, a couple of them taller)
export function grassClumpGeometry(seed = 1, blades = 7, segs = 3) {
  const rnd = mulberry32(seed * 3 + 1);
  const B = new PB();
  for (let i = 0; i < blades; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 0.09;
    const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r;
    const tall = rnd() < 0.25;
    const h = (0.28 + rnd() * 0.3) * (tall ? 1.35 : 1);
    const la = a + (rnd() - 0.5) * 1.0;
    const pts = stalk(h, Math.cos(la), Math.sin(la), 0.3 + rnd() * 0.5, segs, x0, z0);
    // arch over: the tip droops a little
    const tip = pts[pts.length - 1];
    tip[1] -= h * 0.08 * (0.5 + rnd());
    const w = 0.026 + rnd() * 0.02;
    const ws = segs === 3 ? [w, w * 0.92, w * 0.62, 0] : [w, w * 0.72, 0];
    ribbon(B, pts, ws, BLOOM, 0, 1, 0.9);
  }
  return B.build();
}

// --- buckwheat (tam giac mach): red stems, heart leaves, frothy pink-white racemes
export function buckwheatGeometry2(seed = 1, { stems = 2, racemes = 3, florets = 8 } = {}) {
  const rnd = mulberry32(seed * 17 + 5);
  const B = new PB();
  for (let s = 0; s < stems; s++) {
    const a = rnd() * TAU;
    const h = 0.36 + rnd() * 0.24;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = stalk(h, dx, dz, 0.18 + rnd() * 0.22, 2, dx * 0.02, dz * 0.02);
    ribbon(B, pts, [0.012, 0.01, 0.007], STEM, 0, 0.9, 0.3);
    // heart-shaped leaves along the stem
    for (let l = 0; l < 1; l++) {
      const f = 0.3 + l * 0.28 + rnd() * 0.08;
      const p = pts[Math.min(pts.length - 1, Math.round(f * (pts.length - 1)))];
      const la = a + (l ? 2.2 : -2.0) + (rnd() - 0.5) * 0.8;
      const ldx = Math.cos(la), ldz = Math.sin(la);
      const L = 0.07 + rnd() * 0.03;
      const lp = [[p[0], p[1], p[2]], [p[0] + ldx * L * 0.45, p[1] + L * 0.12, p[2] + ldz * L * 0.45], [p[0] + ldx * L, p[1] - L * 0.08, p[2] + ldz * L]];
      ribbon(B, lp, [0.012, 0.06, 0], LEAF, f * 0.9, f * 0.9 + 0.05, 1.2);
    }
    // corymb of little racemes at the top
    const tip = pts[pts.length - 1];
    const nr = racemes;
    for (let r = 0; r < nr; r++) {
      const ra = a + (r / nr) * TAU + rnd() * 0.8;
      const cx = tip[0] + Math.cos(ra) * 0.035, cz = tip[2] + Math.sin(ra) * 0.035, cy = tip[1] - 0.01 + rnd() * 0.03;
      ribbon(B, [[tip[0], tip[1] - 0.03, tip[2]], [cx, cy, cz]], [0.006, 0.004], STEM, 0.88, 0.95, 0.3);
      const nf = florets;
      for (let f = 0; f < nf; f++) {
        const fa = rnd() * TAU, fr = Math.sqrt(rnd()) * 0.034, fy = (rnd() - 0.3) * 0.036;
        const fx = cx + Math.cos(fa) * fr, fz = cz + Math.sin(fa) * fr, fyy = cy + fy;
        const sz = 0.017 + rnd() * 0.009;
        // tiny floret: a diamond facing a random way
        const ang = rnd() * Math.PI;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        B.hc = [fx, fyy, fz]; B.pr = 1;
        const q1 = [B.v(fx - ca * sz, fyy, fz - sa * sz, -sa, 1, ca, BLOOM, 1), B.v(fx, fyy + sz * 0.9, fz, -sa, 1, ca, BLOOM, 1), B.v(fx + ca * sz, fyy, fz + sa * sz, -sa, 1, ca, BLOOM, 1), B.v(fx, fyy - sz * 0.6, fz, -sa, 1, ca, BLOOM, 1)];
        B.hc = null; B.pr = 0;
        B.quad(q1[0], q1[3], q1[2], q1[1]);
      }
    }
  }
  return B.build();
}

// --- daisy (cuc hoa mi): white rays around a golden disc ------------------------
export function daisyGeometry(seed = 1, { heads = 1, petals = 15, size = 1, leaves = 2, ring = 6, round = false } = {}) {
  const rnd = mulberry32(seed * 23 + 7);
  const B = new PB();
  // basal leaves
  for (let l = 0; l < leaves; l++) {
    const a = rnd() * TAU, L = 0.09 + rnd() * 0.04;
    const dx = Math.cos(a), dz = Math.sin(a);
    ribbon(B, [[0, 0, 0], [dx * L * 0.5, L * 0.35, dz * L * 0.5], [dx * L, L * 0.2, dz * L]], [0.01, 0.026, 0], LEAF, 0, 0.25, 1.0);
  }
  for (let hI = 0; hI < heads; hI++) {
    const a = rnd() * TAU, h = (0.26 + rnd() * 0.12) * (hI ? 0.85 : 1);
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = stalk(h, dx, dz, 0.12 + rnd() * 0.2, 2);
    ribbon(B, pts, [0.009, 0.008, 0.006], STEM, 0, 0.92, 0.3);
    const tip = pts[pts.length - 1];
    const tilt = 0.35 + rnd() * 0.3;
    const nrm = [dx * Math.sin(tilt), Math.cos(tilt), dz * Math.sin(tilt)];
    head(B, tip, nrm, rnd, round
      ? { petals, r0: 0.014 * size, r1: 0.06 * size, w: 0.022 * size, cup: 0.2, centre: 0.018 * size, round: true, ring }
      : { petals, r0: 0.014 * size, r1: 0.056 * size, w: 0.016 * size, cup: 0.18, centre: 0.017 * size, wedge: true, ring });
  }
  return B.build();
}

// --- cosmos (sao nhai): tall, airy, eight notched petals -----------------------
export function cosmosGeometry(seed = 1, { heads = 2, petals = 8, notch = true, leaves = 2, segs = 3 } = {}) {
  const rnd = mulberry32(seed * 29 + 3);
  const B = new PB();
  for (let hI = 0; hI < heads; hI++) {
    const a = rnd() * TAU, h = 0.42 + rnd() * 0.16 - hI * 0.08;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = stalk(h, dx, dz, 0.16 + rnd() * 0.2, segs);
    ribbon(B, pts, segs === 3 ? [0.009, 0.008, 0.006, 0.005] : [0.009, 0.007, 0.005], STEM, 0, 0.92, 0.3);
    // thread-fine leaves
    for (let l = 0; l < leaves; l++) {
      const p = pts[Math.min(pts.length - 1, 1 + (l % 3))];
      const la = a + (l - 1) * 2.1 + rnd();
      const L = 0.06 + rnd() * 0.03;
      ribbon(B, [[p[0], p[1], p[2]], [p[0] + Math.cos(la) * L, p[1] + L * 0.5, p[2] + Math.sin(la) * L]], [0.008, 0], LEAF, 0.3, 0.5, 1.0);
    }
    const tip = pts[pts.length - 1];
    const tilt = 0.45 + rnd() * 0.35;
    head(B, tip, [dx * Math.sin(tilt), Math.cos(tilt), dz * Math.sin(tilt)], rnd, { petals, r0: 0.012, r1: 0.06, w: 0.03, cup: 0.22, notch, centre: 0.016, ring: notch ? 5 : 4 });
  }
  return B.build();
}

// --- cup flower: broad, cupped petals in vivid colours (poppies, ranunculus) ------
export function cupFlowerGeometry(seed = 1, { heads = 1, petals = 6, size = 1, leaves = 2 } = {}) {
  const rnd = mulberry32(seed * 41 + 13);
  const B = new PB();
  for (let l = 0; l < leaves; l++) {
    const a = rnd() * TAU, L = 0.08 + rnd() * 0.05;
    const dx = Math.cos(a), dz = Math.sin(a);
    ribbon(B, [[0, 0, 0], [dx * L * 0.5, L * 0.4, dz * L * 0.5], [dx * L, L * 0.25, dz * L]], [0.012, 0.03, 0], LEAF, 0, 0.25, 1.0);
  }
  for (let hI = 0; hI < heads; hI++) {
    const a = rnd() * TAU, h = (0.3 + rnd() * 0.12) * (hI ? 0.82 : 1);
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = stalk(h, dx, dz, 0.1 + rnd() * 0.16, 2);
    ribbon(B, pts, [0.01, 0.009, 0.007], STEM, 0, 0.9, 0.3);
    const tip = pts[pts.length - 1];
    const tilt = 0.2 + rnd() * 0.25;
    const nrm = [dx * Math.sin(tilt), Math.cos(tilt), dz * Math.sin(tilt)];
    // two rings: outer broad petals and a smaller inner cup
    head(B, tip, nrm, rnd, { petals, r0: 0.008 * size, r1: 0.062 * size, w: 0.07 * size, cup: 0.55, centre: 0, round: true });
    head(B, [tip[0] + nrm[0] * 0.006, tip[1] + nrm[1] * 0.006, tip[2] + nrm[2] * 0.006], nrm, rnd, { petals: 4, r0: 0.006 * size, r1: 0.04 * size, w: 0.06 * size, cup: 0.85, centre: 0.013 * size, round: true, ring: 5 });
  }
  return B.build();
}

// --- lavender: a tuft of grey-green stems with purple spikes ---------------------
export function lavenderGeometry(seed = 1, { stems = 7, buds = 4, leaves = 4 } = {}) {
  const rnd = mulberry32(seed * 31 + 9);
  const B = new PB();
  const n = stems;
  for (let s = 0; s < n; s++) {
    const a = (s / n) * TAU + rnd() * 0.6;
    const h = 0.3 + rnd() * 0.14;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = stalk(h, dx, dz, 0.28 + rnd() * 0.2, 2, dx * 0.015, dz * 0.015);
    ribbon(B, pts, [0.007, 0.006, 0.004], STEM, 0, 0.7, 0.4);
    // spike: whorls of tiny buds along the top third
    const tip = pts[pts.length - 1], mid = pts[pts.length - 2];
    const tx = tip[0] - mid[0], ty = tip[1] - mid[1], tz = tip[2] - mid[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    for (let b = 0; b < buds; b++) {
      const f = b / Math.max(1, buds - 1);
      const cx = tip[0] - (tx / tl) * 0.1 * (1 - f), cy = tip[1] - (ty / tl) * 0.1 * (1 - f), cz = tip[2] - (tz / tl) * 0.1 * (1 - f);
      const r = 0.013 * (1 - f * 0.4);
      const ba = b * 2.4 + a;
      const ca = Math.cos(ba), sa = Math.sin(ba);
      B.hc = [cx, cy, cz]; B.pr = 0.6 + 0.4 * f;
      const i0 = B.v(cx - ca * r, cy, cz - sa * r, -sa, 0.7, ca, BLOOM, 0.75 + f * 0.25);
      const i1 = B.v(cx, cy + r * 1.7, cz, -sa, 0.7, ca, BLOOM, 0.75 + f * 0.25);
      const i2 = B.v(cx + ca * r, cy, cz + sa * r, -sa, 0.7, ca, BLOOM, 0.75 + f * 0.25);
      const i3 = B.v(cx, cy - r * 1.0, cz, -sa, 0.7, ca, BLOOM, 0.75 + f * 0.25);
      B.hc = null; B.pr = 0;
      B.quad(i0, i3, i2, i1);
    }
  }
  // a low mound of narrow leaves
  for (let l = 0; l < leaves; l++) {
    const a = rnd() * TAU, L = 0.08 + rnd() * 0.04;
    ribbon(B, stalk(L, Math.cos(a), Math.sin(a), 0.9, 2), [0.01, 0.008, 0], LEAF, 0, 0.25, 1.0);
  }
  return B.build();
}

// --- forget-me-nots: low clusters of tiny sky-blue flowers -----------------------
export function forgetMeNotGeometry(seed = 1, { stems = 3, flowers = 3 } = {}) {
  const rnd = mulberry32(seed * 37 + 1);
  const B = new PB();
  for (let s = 0; s < stems; s++) {
    const a = rnd() * TAU, h = 0.14 + rnd() * 0.1;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts = stalk(h, dx, dz, 0.35, 2);
    ribbon(B, pts, [0.008, 0.007, 0.006], STEM, 0, 0.9, 0.3);
    const tip = pts[pts.length - 1];
    for (let f = 0; f < flowers; f++) {
      const fa = rnd() * TAU, fr = 0.02 + rnd() * 0.02;
      const c = [tip[0] + Math.cos(fa) * fr, tip[1] + (rnd() - 0.4) * 0.02, tip[2] + Math.sin(fa) * fr];
      head(B, c, [Math.cos(fa) * 0.3, 1, Math.sin(fa) * 0.3], rnd, { petals: 5, r0: 0.003, r1: 0.02, w: 0.02, cup: 0.15, centre: 0, wedge: true });
    }
    ribbon(B, [[0, 0, 0], [dx * 0.05, 0.03, dz * 0.05], [dx * 0.09, 0.02, dz * 0.09]], [0.008, 0.024, 0], LEAF, 0, 0.2, 1.0);
  }
  return B.build();
}

// --- a little posy: a few small flowers on slender stems from one root, each its own
// colour (picked in the shader), with a couple of leaves. About 15-20 triangles a
// flower, so the meadow can be carpeted with them.
export function posyGeometry(seed = 1, { heads = 3, petals = 5, size = 1, leaves = 1, h = 0.3, spread = 0.07, style = 'paddle' } = {}) {
  const rnd = mulberry32(seed * 53 + 11);
  const B = new PB();
  for (let l = 0; l < leaves; l++) {
    const a = rnd() * TAU, L = 0.07 + rnd() * 0.04;
    const dx = Math.cos(a), dz = Math.sin(a);
    ribbon(B, [[0, 0, 0], [dx * L * 0.5, L * 0.35, dz * L * 0.5], [dx * L, L * 0.12, dz * L]], [0.01, 0.026, 0], LEAF, 0, 0.25, 1.0);
  }
  const a0 = rnd() * TAU;
  for (let k = 0; k < heads; k++) {
    const a = a0 + (k / heads) * TAU + (rnd() - 0.5) * 0.9;
    const r = k === 0 ? spread * 0.15 : spread * (0.65 + rnd() * 0.5);
    const hh = h * (k === 0 ? 1 : 0.62 + rnd() * 0.36);
    const dx = Math.cos(a), dz = Math.sin(a);
    // stems lean out from the root so the heads part like a little bouquet
    const pts = stalk(hh, dx, dz, (r / hh) * 1.1 + 0.06, 1, dx * 0.004, dz * 0.004);
    ribbon(B, pts, [0.008, 0.006], STEM, 0, 0.9, 0.3);
    const tip = pts[pts.length - 1];
    const tilt = 0.22 + rnd() * 0.4;
    const nrm = [dx * Math.sin(tilt), Math.cos(tilt), dz * Math.sin(tilt)];
    const sz = size * (0.82 + rnd() * 0.4);
    const pp = petals + (rnd() < 0.3 ? 1 : 0);
    head(B, tip, nrm, rnd, { petals: pp, r0: 0.007 * sz, r1: 0.06 * sz, w: 0.052 * sz, cup: 0.3, centre: 0.015 * sz, ring: 4, paddle: style === 'paddle', kite: style === 'kite', wedge: style === 'wedge' });
  }
  return B.build();
}

// --- material ---------------------------------------------------------------------
export function meadowMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uStem: { value: new THREE.Color(opts.stem || '#5b8a3c') },
    uLeaf: { value: new THREE.Color(opts.leaf || '#5f8f42') },
    uCentre: { value: new THREE.Color(opts.centre || '#f2c14e') },
    uShade: { value: new THREE.Color(opts.shade || '#7f86a8') },
    uSway: { value: opts.sway ?? 1.4 },
    uEmit: { value: opts.emit ?? 0 },
    uRoot: { value: opts.root ?? 0.5 },
    uTrans: { value: opts.trans ?? 0.35 },
    uFogScale: { value: opts.fogScale ?? 1 },
    uGrowKey: { value: -1e4 },
    uGK: { value: new THREE.Vector4(-1e4, -1e4, -1e4, -1e4) },
    uTipCol: { value: new THREE.Color(opts.tip || '#ffffff') },
    uTipAmt: { value: opts.tipAmt ?? 0 },
  };
  return new THREE.ShaderMaterial({
    defines: { ...(opts.grow ? { GROW: 1 } : {}), ...(opts.grass ? { GRASS: 1 } : {}), ...(opts.multi ? { MULTI: 1 } : {}), ...(opts.low ? { LOW_Q: 1 } : {}) },
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWind; uniform float uSway;
      uniform vec4 uRipple; uniform float uRippleAmt; uniform vec4 uPush0, uPush1, uPush2;
      uniform vec3 uStem, uLeaf, uCentre;
      uniform sampler2D uNoise;
      attribute float aPart; attribute float aT; attribute vec3 aHC; attribute float aR; attribute float aS;
      #ifdef GROW
        attribute float aKey;
      #endif
      ${GROW_GLSL}
      ${BLOOM_GLSL}
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vT; varying float vBloom; varying float vGlow; varying float vR; varying float vGust;
      varying float vS; varying vec3 vEye; varying float vCentre; varying float vLeaf;
      float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec3 p = position;
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        vec3 ipos = (modelMatrix * im[3]).xyz;
        float scaleY = length(im[1].xyz);
        float ph = dot(ipos.xz, vec2(0.13, 0.17));
        float rd = length(ipos.xz - uRipple.xz);
        float ring = exp(-pow((rd - uRipple.w) / (0.9 + uRipple.w * 0.04), 2.0)) * uRippleAmt;
        p *= 1.0 + ring * 0.24;
        float pop = 0.0;
        #ifdef GROW
          // the bloom reaches this plant: the stem springs up out of the ground (past its
          // height and back), and a beat later the flower bursts open from its heart;
          // the heads of a posy open one after another
          float isHead = step(1.5, aPart);
          float stag = isHead * hash13(aHC * 37.0 + ipos * 0.13) * 0.55;
          float x = growX(aKey);
          if (x < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          x *= 1.7;
          float xh = max(x - stag, 0.0);
          float spring = 1.0 - exp(-x * 3.0) * cos(x * 7.0);
          float open = smoothstep(0.08, 0.5, xh);
          float openO = open + 0.3 * sin(open * 3.14159);
          vec3 hp = p - aHC;
          float tw = (1.0 - open) * 2.2;
          hp.xz = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * hp.xz;
          p = aHC + hp * mix(0.05, 1.0, openO);
          p.y *= spring;
          p.xz *= mix(0.35, 1.0, min(x * 3.0, 1.0)) * mix(1.0, spring, 0.5);
          pop = exp(-xh * 2.4) * smoothstep(0.0, 0.06, xh) * 0.45;
        #endif
        #ifdef GRASS
          // (far off the blades sink into the ground before their patch is dropped from view, so
          // no patch of grass ever pops in or out - most of all as she glides down to land)
          float gk = 1.0 - smoothstep(66.0, 90.0, length(cameraPosition - ipos));
          if (gk <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          p.y *= gk;
        #endif
        vec4 w = modelMatrix * im * vec4(p, 1.0);
        // Wind: gusts - patches of stronger wind some tens of metres across - roll over the
        // meadow downwind; in them the plants lean further over and flutter, between them
        // they sway softly and spring back. Stems bend from the root.
        vec2 wd = vec2(0.943, 0.333);
        vec2 gq = ipos.xz * 0.019 - wd * uTime * 0.15;
        float gn = texture2D(uNoise, gq).r;
        float gust = smoothstep(0.4, 0.85, gn) * clamp(uWind * 1.6, 0.0, 1.0);
        float sw = sin(uTime * 1.6 + ph) * 0.55 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
        float fl = sin(uTime * 7.3 + ph * 3.1) * 0.6 + sin(uTime * 11.7 + ph * 5.3) * 0.4;
        float bend = uWind * uSway * aT * aT * scaleY;
        vec2 off = wd * (0.3 + gust * 1.25 + fl * gust * 0.22) * bend * 0.13
                 + vec2(sw, cos(uTime * 1.3 + ph) * 0.5) * bend * (0.07 + gust * 0.05);
        // (flower heads nod and shiver a little more than the stems)
        off *= 1.0 + step(1.5, aPart) * 0.25;
        w.xz += off;
        w.y -= length(off) * 0.3;
        vGust = gust;
        // pushed aside where she stands and walks, and where her cat and her dog run through
        {
          vec2 d0 = ipos.xz - uPush0.xy, d1 = ipos.xz - uPush1.xy, d2 = ipos.xz - uPush2.xy;
          float l0 = length(d0), l1 = length(d1), l2 = length(d2);
          vec2 pv = d0 / max(l0, 1e-3) * uPush0.w * (1.0 - smoothstep(uPush0.z * 0.35, uPush0.z, l0))
                  + d1 / max(l1, 1e-3) * uPush1.w * (1.0 - smoothstep(uPush1.z * 0.35, uPush1.z, l1))
                  + d2 / max(l2, 1e-3) * uPush2.w * (1.0 - smoothstep(uPush2.z * 0.35, uPush2.z, l2));
          float pk = aT * aT * min(scaleY, 1.5);
          w.xz += pv * pk;
          w.y -= length(pv) * pk * 0.4;
        }
        // the shockwave blows them back as it passes; behind it they spring upright again
        if (uRippleAmt > 0.0) {
          vec2 away = (ipos.xz - uRipple.xz) / max(rd, 0.01);
          float behind = uRipple.w - rd;
          float front = exp(-pow((rd - uRipple.w + 0.4) / (1.3 + uRipple.w * 0.025), 2.0));
          float wob = behind > 0.0 ? exp(-behind * 0.2) * sin(behind * 0.8) : 0.0;
          float push = (front * 0.2 - wob * 0.08) * min(uRippleAmt, 1.0) * aT * aT * scaleY;
          w.xz += away * push;
          w.y -= front * min(uRippleAmt, 1.0) * aT * aT * scaleY * 0.1;
        }
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        #ifdef USE_INSTANCING_COLOR
          vec3 ic = instanceColor;
        #else
          vec3 ic = vec3(1.0);
        #endif
        // the eye: each petal's base in a deeper (or contrasting) tone of the flower
        vec3 eyeC = ic * vec3(0.78, 0.66, 0.74);
        #ifdef MULTI
          // each flower the kind of its patch of meadow, sometimes a stray
          vec4 pt = bloomPatch(ipos.xz);
          float hh = hash13(aHC * 53.0 + ipos * 0.71);
          vec3 pc, ec; vec4 sh;
          bloomKind(hh < 0.25 || pt.z < 0.18 ? fract(hh * 4.0 + 0.37) : pt.x, fract(hh * 7.3), pc, ec, sh);
          ic = pc;
          eyeC = mix(pc * vec3(0.78, 0.66, 0.74), ec, 0.6);
        #endif
        vEye = eyeC;
        vS = aS;
        vCentre = step(2.5, aPart);
        vLeaf = step(0.5, aPart) * (1.0 - step(1.5, aPart));
        vec3 c = uStem;
        c = mix(c, uLeaf, step(0.5, aPart) * (1.0 - step(1.5, aPart)));
        c = mix(c, ic, step(1.5, aPart) * (1.0 - step(2.5, aPart)));
        c = mix(c, uCentre, step(2.5, aPart));
        vCol = c;
        vBloom = step(1.5, aPart) * (1.0 - step(2.5, aPart));
        vT = aT;
        vR = aR;
        vGlow = ring * 0.55 + smoothstep(uRipple.w + 1.0, uRipple.w - 3.0, rd) * 0.07 * uRippleAmt + pop * 0.45;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uShade; uniform float uEmit, uRoot, uTrans, uFogScale;
      uniform vec3 uTipCol; uniform float uTipAmt;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vT; varying float vBloom; varying float vGlow; varying float vR; varying float vGust;
      varying float vS; varying vec3 vEye; varying float vCentre; varying float vLeaf;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        // thin leaves and blades are lit through from either side: both faces keep the
        // upward lean of their normal (no blade turns black just because we see its back)
        // (the far side of a blade or leaf still reads a shade deeper, for depth in the sward;
        // petals keep their own two-sided look)
        float bf = gl_FrontFacing ? 1.0 : 0.76;
        #ifdef GRASS
          N.y = abs(N.y);
        #else
          if (vBloom < 0.5) N.y = abs(N.y);
          bf = mix(bf, 1.0, vBloom);
        #endif
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSunDir);
        float l = smoothstep(-0.3, 0.45, ndl);
        // darker toward the roots, where the meadow shades itself
        float ao = mix(uRoot, 1.0, smoothstep(0.0, 0.7, vT));
        vec3 base = vCol;
        #ifdef GRASS
          // blades lighten toward sunny, yellow-green tips
          base = mix(base * 0.84, mix(base, uTipCol, uTipAmt), smoothstep(0.2, 1.0, vT));
          // a folded blade: the crease down its middle catches the light, the edges fall a
          // little darker (evened out where a blade is only a pixel or two wide)
          #ifndef LOW_Q
            float fk = 1.0 - smoothstep(0.3, 0.8, fwidth(vS));
            base *= 1.0 + 0.1 * (1.0 - 2.0 * smoothstep(0.15, 0.95, abs(vS))) * fk;
          #endif
          // where a gust bends them over, their pale undersides catch the light: bright waves
          // running across the field with the wind
          base = mix(base, base * 1.22 + vec3(0.035, 0.045, 0.01), vGust * smoothstep(0.25, 0.9, vT) * 0.75);
        #else
          // petals: a deeper, richer heart fading to pale, glowing tips
          float pr = vR * vBloom;
          vec3 heart = base * vec3(0.86, 0.8, 0.84) * mix(vec3(1.0), vec3(1.02, 0.88, 0.95), step(dot(base, vec3(0.333)), 0.9));
          base = mix(base, mix(heart, mix(base, vec3(1.0), 0.18), smoothstep(0.0, 1.0, pr)), vBloom);
          if (vBloom > 0.5) {
            // the eye at the base of every petal, fading out along it
            float eyeK = 1.0 - smoothstep(0.12, 0.46, pr + abs(vS) * 0.08);
            base = mix(base, vEye, eyeK * 0.82);
            #ifndef LOW_Q
            // fine veins fanning out from the heart and a soft crease down the middle (they
            // fade away where they would be finer than a pixel)
            float aw = fwidth(vS);
            float vis = 1.0 - smoothstep(0.1, 0.4, aw);
            float vf = abs(fract(vS * 2.5 + 0.5) - 0.5) * 2.0;
            float vein = (1.0 - smoothstep(0.0, 0.24 + aw * 2.0, vf)) * (1.0 - smoothstep(0.35, 0.95, pr));
            float rib = (1.0 - smoothstep(0.0, 0.16 + aw * 2.0, abs(vS))) * (1.0 - smoothstep(0.6, 1.0, pr) * 0.6);
            base = mix(base, base * vec3(0.74, 0.72, 0.78), (vein * 0.5 + rib * 0.4) * vis);
            // thin, pale, light-catching edges
            base = mix(base, mix(base, vec3(1.0), 0.34), smoothstep(0.66, 1.0, abs(vS)) * 0.5 * vis);
            #endif
          }
          // the heart of the flower: a little dome, golden on top, a darker ring round it,
          // speckled with pollen
          #ifndef LOW_Q
          if (vCentre > 0.5) {
            vec3 cq = floor(vW * 420.0);
            float sp = fract(sin(dot(cq, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float cv = 1.0 - smoothstep(0.002, 0.008, length(fwidth(vW)) * 8.0);
            base *= mix(0.78, 1.12, smoothstep(0.2, 0.9, N.y)) * (1.0 + (sp - 0.5) * 0.35 * cv);
          }
          // leaves: a pale midrib, darker toward the edges
          if (vLeaf > 0.5) {
            float lk = 1.0 - smoothstep(0.3, 0.8, fwidth(vS));
            float mid = 1.0 - smoothstep(0.0, 0.22 + fwidth(vS) * 1.5, abs(vS));
            base *= 1.0 + (mid * 0.16 - smoothstep(0.5, 1.0, abs(vS)) * 0.1) * lk;
          }
          #endif
        #endif
        vec3 col = base * mix(uShade * uShadowTint, uLightTint * 1.05, l * ao) * mix(0.75, 1.0, ao) * bf;
        // petals and blades glow when the sun is behind them
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        col += base * uSunCol * back * uTrans * smoothstep(0.3, 1.0, vT);
        // a soft sheen along the petal edges
        float rim = pow(1.0 - abs(dot(N, V)), 3.0);
        col += uLightTint * rim * 0.12 * vBloom;
        col += uGold * vGlow * 0.9;
        col += base * uEmit * vBloom * (0.35 + 0.65 * uNight);
        col += base * pointLight(vW, N) * 1.4;
        col = applyFogK(col, vW, uFogScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}
