// Her cat: a long-haired British, ginger and white (a white blaze widening down to the
// nose, white muzzle and chin, a big white ruff, white socks, golden eyes). It waits
// where she lands, looking up as she flies down, runs happy circles around her once she
// touches the grass, then trots at her side for the rest of the way.
//
// One skinned mesh (one draw call): fluffy parts with tufts of fur sculpted into the
// geometry, shaded like her (soft wrap light, fuzzy rim, the sun glowing through the fur
// at its edges); eyes, nose and mouth are painted in the shader. A small agent moves it
// in real time, so it keeps playing around her while the page rests.
import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { contactShadow } from './character.js';
import { heightAt } from './world.js';
import { clamp, lerp, smoothstep, TAU } from './math.js';

// the model is built at real size (metres); drawn a little larger, she is a little doll
export const CAT_SCALE = 1.16;

// ---------------------------------------------------------------------------
// noise
function ih(i, j, k, s) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 1440662683) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
const WR = { d1: 0, d2: 0, id: 0 };
export function worley(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, d2 = 9, id = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const dx = cx + ih(cx, cy, cz, seed) - x, dy = cy + ih(cx, cy, cz, seed + 1) - y, dz = cz + ih(cx, cy, cz, seed + 2) - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < d1) { d2 = d1; d1 = d; id = ih(cx, cy, cz, seed + 3); } else if (d < d2) d2 = d;
  }
  WR.d1 = d1; WR.d2 = d2; WR.id = id;
  return WR;
}
export function vnoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => ih(xi + a, yi + b, zi + d, seed);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
export const hexc = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const bump = (v, c, w) => Math.exp(-((v - c) / w) * ((v - c) / w));

const COL = {
  // (her cat is a soft, yellowy ginger - apricot cream rather than orange)
  ginger: hexc('#e3c28f'),
  gingerD: hexc('#c9a26c'),
  gingerL: hexc('#f1deb6'),
  white: hexc('#faf6ef'),
  pad: hexc('#f7e2c4'),
  inner: hexc('#f0c3b5'),
  bean: hexc('#f3a6ad'),
  nose: hexc('#f0b4ac'),
};

// ---------------------------------------------------------------------------
// Proportions: a cobby little cat with short sturdy legs and a big round head
const HC = new THREE.Vector3(0, 0.298, 0.17); // head centre
const HK = 1.08; // head features, scaled from the first sculpt
const hp = (x, y, z) => new THREE.Vector3(HC.x + x * HK, HC.y + y * HK, HC.z + z * HK);

// Skeleton (bind pose: all rotations zero). +z forward, +x the cat's left, y up.
const E0L = hp(0.055, 0.054, -0.016);
export const BONES = [
  ['root', -1, 0, 0, 0],
  ['hips', 0, 0, 0.146, -0.095],
  ['chest', 1, 0, 0.156, 0.05],
  ['neck', 2, 0, 0.211, 0.115],
  ['head', 3, HC.x, HC.y, HC.z],
  ['earL', 4, E0L.x, E0L.y, E0L.z],
  ['earR', 4, -E0L.x, E0L.y, E0L.z],
  ['shL', 2, 0.053, 0.141, 0.098], ['elL', 7, 0.053, 0.079, 0.094], ['pwFL', 8, 0.052, 0.034, 0.112],
  ['shR', 2, -0.053, 0.141, 0.098], ['elR', 10, -0.053, 0.079, 0.094], ['pwFR', 11, -0.052, 0.034, 0.112],
  ['hipL', 1, 0.06, 0.131, -0.115], ['knL', 13, 0.062, 0.079, -0.095], ['pwBL', 14, 0.062, 0.034, -0.124],
  ['hipR', 1, -0.06, 0.131, -0.115], ['knR', 16, -0.062, 0.079, -0.095], ['pwBR', 17, -0.062, 0.034, -0.124],
];
const TAIL0 = [0, 0.176, -0.19];
const TAIL_DIR = new THREE.Vector3(0, 0.5, -0.866).normalize();
const TAIL_LEN = 0.27, TAIL_N = 6;
for (let i = 0; i < TAIL_N; i++) {
  const f = (i / TAIL_N) * TAIL_LEN;
  BONES.push([`tail${i}`, i === 0 ? 1 : BONES.length - 1, TAIL0[0] + TAIL_DIR.x * f, TAIL0[1] + TAIL_DIR.y * f, TAIL0[2] + TAIL_DIR.z * f]);
}
const BI = {};
BONES.forEach((b, i) => { BI[b[0]] = i; });
const bpos = (n) => { const b = BONES[BI[n]]; return [b[2], b[3], b[4]]; };

// where the face is drawn (bind space), shared with the shader
const HEAD_C = HC;
const HEAD_R = [0.096 * HK, 0.083 * HK, 0.085 * HK];
// (a big, flat-fronted eyeball: the cornea bulges only a little out of the face)
const EYE_R = 0.03, EYE_OPEN = 0.0168, EYE_K = 0.59;
// the muzzle sits a little forward of the round head: a short nose, full whisker pads
const MZ = 0.0045;
const NOSE_C = hp(0, -0.0135, 0.0822 + MZ);
const MOUTH_C = hp(0, -0.0212, 0.0858 + MZ);
// (where the whiskers spring from: they turn about here, forward or back with its mood)
const WHISK_PIVOT = (() => { const p = hp(0.0138, -0.0284, 0.0672 + MZ); return new THREE.Vector3(p.x + 0.011, p.y, p.z + 0.0072); })();

// head surface (before fur), as a function of a unit direction from its centre
function headShape(nx, ny, nz) {
  const rx = HEAD_R[0] * (1 + 0.08 * smoothstep(0.25, -0.5, ny));
  const ry = HEAD_R[1] * (ny > 0 ? 0.95 : 1);
  // (the face comes forward a little below the eyes: the bridge of a short nose)
  const muz = smoothstep(0.6, 0.97, nz) * bump(ny, -0.18, 0.3) * (1 - smoothstep(0.12, 0.42, Math.abs(nx)));
  const rz = HEAD_R[2] * (nz > 0 ? 0.93 : 1) * (1 + 0.075 * muz);
  return [HEAD_C.x + nx * rx, HEAD_C.y + ny * ry, HEAD_C.z + nz * rz];
}
// eyes: set into the face so a little more than half of each shows
function eyePlacement(side) {
  const d = new THREE.Vector3(side * 0.41, 0.075, 0.9).normalize();
  const s = headShape(d.x, d.y, d.z);
  const surf = new THREE.Vector3(...s);
  const n = new THREE.Vector3((s[0] - HEAD_C.x) / (HEAD_R[0] * HEAD_R[0]), (s[1] - HEAD_C.y) / (HEAD_R[1] * HEAD_R[1]), (s[2] - HEAD_C.z) / (HEAD_R[2] * HEAD_R[2])).normalize();
  const open = EYE_OPEN;
  const depth = Math.sqrt(EYE_R * EYE_R - open * open);
  const c = surf.clone().addScaledVector(n, -depth);
  // they look forward, a touch outward
  const ax = new THREE.Vector3(side * 0.2, 0.04, 1).normalize();
  return { c, ax };
}
const EYE_L = eyePlacement(1), EYE_R2 = eyePlacement(-1);

// ---------------------------------------------------------------------------
// Geometry. Each part is a grid over a smooth surface; fur tufts (cells of Worley noise,
// stretched along the way the fur lies) push it out, combed tips lean along the fur.
export class CatBuilder {
  constructor(q) {
    this.q = q;
    this.pos = []; this.nrm = []; this.col = []; this.fur = []; this.si = []; this.sw = []; this.idx = [];
    this.len = []; this.comb = [];
    this.parts = [];
  }
  // at(u, v) -> [x, y, z]; u wraps around; o: { kind, furry, L(p,n), comb(p,n), cell, axis, seed, color(p,n,h,id), bones(p), inflate, shear, nrmK }
  part(nu, nv, at, o) {
    nu = Math.max(6, Math.round(nu * this.q)); nv = Math.max(4, Math.round(nv * this.q));
    const n = (nu + 1) * (nv + 1);
    const P0 = new Float32Array(n * 3);
    for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
      const p = at(i / nu, j / nv);
      P0[k * 3] = p[0]; P0[k * 3 + 1] = p[1]; P0[k * 3 + 2] = p[2];
    }
    const idx = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const N0 = normalsOf(P0, idx, nu, nv);
    // face outward
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += P0[k * 3]; cy += P0[k * 3 + 1]; cz += P0[k * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    let s = 0;
    for (let k = 0; k < n; k++) s += (P0[k * 3] - cx) * N0[k * 3] + (P0[k * 3 + 1] - cy) * N0[k * 3 + 1] + (P0[k * 3 + 2] - cz) * N0[k * 3 + 2];
    if (s < 0 && !o.keepWinding) {
      for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
      for (let k = 0; k < N0.length; k++) N0[k] = -N0[k];
    }
    // fur
    const P = new Float32Array(n * 3), H = new Float32Array(n), ID = new Float32Array(n), LL = new Float32Array(n), CB = new Float32Array(n * 3);
    const cell = o.cell || 0.03, seed = o.seed || 1, inflate = o.inflate ?? 0.3, shear = o.shear ?? 0.85;
    const axis = o.axis || [0, 0, 1], st = o.stretch ?? 1.9;
    const p = [0, 0, 0], nn = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      p[0] = P0[k * 3]; p[1] = P0[k * 3 + 1]; p[2] = P0[k * 3 + 2];
      nn[0] = N0[k * 3]; nn[1] = N0[k * 3 + 1]; nn[2] = N0[k * 3 + 2];
      let L = o.L ? o.L(p, nn) : 0;
      let h = 0, id = 0.5;
      if (L > 0) {
        // tufts stretched along the axis the fur lies on
        const qx = p[0] / cell, qy = p[1] / cell, qz = p[2] / cell;
        const along = qx * axis[0] + qy * axis[1] + qz * axis[2];
        const k2 = 1 - 1 / st;
        const w = worley(qx - axis[0] * along * k2, qy - axis[1] * along * k2, qz - axis[2] * along * k2, seed);
        h = Math.pow(clamp(1 - w.d1 / 0.86, 0, 1), 1.45);
        id = w.id;
        L *= 0.78 + 0.44 * vnoise(p[0] * 34, p[1] * 34, p[2] * 34, seed + 9);
        const lift = L * (inflate + (1 - inflate) * h);
        let cb = o.comb ? o.comb(p, nn) : [0, 0, -1];
        // comb in the tangent plane
        const dn = cb[0] * nn[0] + cb[1] * nn[1] + cb[2] * nn[2];
        let tx = cb[0] - nn[0] * dn, ty = cb[1] - nn[1] * dn, tz = cb[2] - nn[2] * dn;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const sh = L * shear * h * h;
        LL[k] = L; CB[k * 3] = tx; CB[k * 3 + 1] = ty; CB[k * 3 + 2] = tz;
        P[k * 3] = p[0] + nn[0] * lift + tx * sh;
        P[k * 3 + 1] = p[1] + nn[1] * lift + ty * sh;
        P[k * 3 + 2] = p[2] + nn[2] * lift + tz * sh;
      } else {
        P[k * 3] = p[0] + nn[0] * (o.push || 0); P[k * 3 + 1] = p[1] + nn[1] * (o.push || 0); P[k * 3 + 2] = p[2] + nn[2] * (o.push || 0);
      }
      H[k] = h; ID[k] = id;
    }
    const N1 = normalsOf(P, idx, nu, nv);
    const nk = o.nrmK ?? 0.55;
    const base = this.pos.length / 3;
    for (let k = 0; k < n; k++) {
      p[0] = P0[k * 3]; p[1] = P0[k * 3 + 1]; p[2] = P0[k * 3 + 2];
      nn[0] = N0[k * 3]; nn[1] = N0[k * 3 + 1]; nn[2] = N0[k * 3 + 2];
      let mx = lerp(N0[k * 3], N1[k * 3], nk), my = lerp(N0[k * 3 + 1], N1[k * 3 + 1], nk), mz = lerp(N0[k * 3 + 2], N1[k * 3 + 2], nk);
      const ml = Math.hypot(mx, my, mz) || 1;
      this.pos.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
      this.nrm.push(mx / ml, my / ml, mz / ml);
      let c = o.color ? o.color(p, nn, H[k], ID[k]) : COL.ginger;
      if (o.L) {
        // roots in shadow, tips catching the light, each lock a little different
        const f = lerp(0.9, 1.04, H[k]) * (0.97 + 0.06 * ID[k]);
        c = [c[0] * f, c[1] * f, c[2] * f];
      }
      this.col.push(c[0], c[1], c[2]);
      this.fur.push(o.furry ?? (o.L ? 1 : 0), o.kind || 0, H[k], 0);
      this.len.push(o.kind ? 0 : LL[k]); this.comb.push(CB[k * 3], CB[k * 3 + 1], CB[k * 3 + 2]);
      const bw = o.bones(p);
      let tw = 0;
      for (const [, w] of bw) tw += w;
      for (let q = 0; q < 4; q++) {
        const e = bw[q];
        this.si.push(e ? e[0] : 0);
        this.sw.push(e ? e[1] / tw : 0);
      }
    }
    for (const t of idx) this.idx.push(base + t);
    this.parts.push({ base, n, occ: o.occ || null });
    return this;
  }
  // soft occlusion where the parts press into each other, and under the body
  occlude(occluders) {
    const n = this.pos.length / 3;
    let pi = 0;
    for (let k = 0; k < n; k++) {
      while (pi < this.parts.length - 1 && k >= this.parts[pi + 1].base) pi++;
      const own = this.parts[pi].occ;
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      const nx = this.nrm[k * 3], ny = this.nrm[k * 3 + 1], nz = this.nrm[k * 3 + 2];
      let occ = 0;
      for (const O of occluders) {
        if (O.name === own) continue;
        const dx = (x - O.c[0]) / O.r[0], dy = (y - O.c[1]) / O.r[1], dz = (z - O.c[2]) / O.r[2];
        const e = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (e > 1.45) continue;
        // facing it?
        const fl = Math.hypot(dx, dy, dz) || 1;
        const facing = clamp(-(nx * dx + ny * dy + nz * dz) / fl, 0, 1);
        occ = Math.max(occ, smoothstep(1.45, 0.98, e) * (0.35 + 0.65 * facing) * (O.k || 1));
      }
      // the ground's shade under the belly and between the legs
      occ = Math.max(occ, smoothstep(0.09, 0.0, y) * smoothstep(0.2, -0.6, ny) * 0.55);
      const a = 1 - 0.5 * occ;
      this.col[k * 3] *= a; this.col[k * 3 + 1] *= a; this.col[k * 3 + 2] *= a;
      this.fur[k * 4 + 3] = 1 - occ;
    }
  }
  // whiskers: thin ribbons from the whisker pads, widened to the camera in the shader
  // (normal = the strand's direction; aFur = (0, 5, along, side))
  whiskers(pad) {
    let v = this.pos.length / 3;
    const add = (p, t, along, side) => {
      this.pos.push(p.x, p.y, p.z); this.nrm.push(t.x, t.y, t.z);
      this.col.push(0.95, 0.93, 0.89); this.fur.push(0, 5, along, side);
      this.len.push(0); this.comb.push(0, 0, 0);
      this.si.push(BI.head, 0, 0, 0); this.sw.push(1, 0, 0, 0);
    };
    const N = 6;
    for (const sx of [1, -1]) for (let r = 0; r < 3; r++) {
      const root = new THREE.Vector3(sx * (pad.x + 0.011), pad.y + 0.0045 - r * 0.0045, pad.z + 0.0072);
      const dir = new THREE.Vector3(sx, 0.2 - r * 0.15, 0.36 - r * 0.05).normalize();
      const len = 0.06 + (r === 1 ? 0.01 : 0) - (r === 2 ? 0.006 : 0);
      const p = new THREE.Vector3(), tg = new THREE.Vector3();
      for (let k = 0; k <= N; k++) {
        const f = k / N;
        // a gentle arc, drooping toward the tip
        p.copy(root).addScaledVector(dir, len * f); p.y -= 0.011 * f * f;
        tg.copy(dir); tg.y -= 0.022 * f; tg.normalize();
        add(p, tg, f, -1); add(p, tg, f, 1);
      }
      for (let k = 0; k < N; k++) { const a = v + k * 2; this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      v += (N + 1) * 2;
    }
  }
  // layers of fur over the furry parts: N copies of their surface, each to be pushed out
  // a little further along the fur (in the shader), where thinning strands are cut out
  buildShells(N) {
    const nV = this.pos.length / 3;
    const keep = new Int32Array(nV).fill(-1);
    let m = 0;
    for (let k = 0; k < nV; k++) if (this.len[k] > 0.004 && this.fur[k * 4 + 1] === 0) keep[k] = m++;
    const tris = [];
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = keep[this.idx[t]], b = keep[this.idx[t + 1]], c = keep[this.idx[t + 2]];
      if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c);
    }
    const T = m * N;
    const pos = new Float32Array(T * 3), nrm = new Float32Array(T * 3), col = new Float32Array(T * 3), fur = new Float32Array(T * 4);
    const si = new Uint16Array(T * 4), sw = new Float32Array(T * 4), len = new Float32Array(T), comb = new Float32Array(T * 3), shell = new Float32Array(T);
    for (let s = 0; s < N; s++) {
      const f = (s + 1) / N;
      for (let k = 0; k < nV; k++) {
        const j = keep[k];
        if (j < 0) continue;
        const o = s * m + j;
        for (let q = 0; q < 3; q++) { pos[o * 3 + q] = this.pos[k * 3 + q]; nrm[o * 3 + q] = this.nrm[k * 3 + q]; col[o * 3 + q] = this.col[k * 3 + q]; comb[o * 3 + q] = this.comb[k * 3 + q]; }
        for (let q = 0; q < 4; q++) { fur[o * 4 + q] = this.fur[k * 4 + q]; si[o * 4 + q] = this.si[k * 4 + q]; sw[o * 4 + q] = this.sw[k * 4 + q]; }
        len[o] = this.len[k]; shell[o] = f;
      }
    }
    const idx = new Uint32Array(tris.length * N);
    for (let s = 0; s < N; s++) for (let t = 0; t < tris.length; t++) idx[s * tris.length + t] = tris[t] + s * m;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFur', new THREE.BufferAttribute(fur, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
    g.setAttribute('aComb', new THREE.BufferAttribute(comb, 3));
    g.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFur', new THREE.Float32BufferAttribute(this.fur, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
// area-weighted vertex normals of an (nu+1) x (nv+1) grid, averaged across its seam
// (first and last column) and over rows that close into a pole
function normalsOf(P, idx, nu, nv) {
  const n = P.length / 3;
  const N = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    N[a * 3] += cx; N[a * 3 + 1] += cy; N[a * 3 + 2] += cz;
    N[b * 3] += cx; N[b * 3 + 1] += cy; N[b * 3 + 2] += cz;
    N[c * 3] += cx; N[c * 3 + 1] += cy; N[c * 3 + 2] += cz;
  }
  const W = nu + 1;
  for (let j = 0; j <= nv; j++) {
    const r0 = j * W;
    // a pole: every vertex of the row in one place
    let pole = true;
    for (let i = 1; i <= nu && pole; i++) {
      const k = r0 + i;
      if (Math.abs(P[k * 3] - P[r0 * 3]) + Math.abs(P[k * 3 + 1] - P[r0 * 3 + 1]) + Math.abs(P[k * 3 + 2] - P[r0 * 3 + 2]) > 1e-7) pole = false;
    }
    if (pole) {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i <= nu; i++) { const k = r0 + i; x += N[k * 3]; y += N[k * 3 + 1]; z += N[k * 3 + 2]; }
      for (let i = 0; i <= nu; i++) { const k = r0 + i; N[k * 3] = x; N[k * 3 + 1] = y; N[k * 3 + 2] = z; }
    } else {
      const a = r0, b = r0 + nu;
      for (let q = 0; q < 3; q++) { const m = N[a * 3 + q] + N[b * 3 + q]; N[a * 3 + q] = m; N[b * 3 + q] = m; }
    }
  }
  for (let k = 0; k < n; k++) {
    const l = Math.hypot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]) || 1;
    N[k * 3] /= l; N[k * 3 + 1] /= l; N[k * 3 + 2] /= l;
  }
  return N;
}

// a closed ellipsoid around centre c with radii r (poles on y unless axis 'z')
export function ellipsoidAt(c, r, poles = 'y', shape) {
  return (u, v) => {
    const ph = u * TAU, th = v * Math.PI;
    let nx, ny, nz;
    if (poles === 'z') { nz = -Math.cos(th); nx = Math.sin(th) * Math.sin(ph); ny = Math.sin(th) * Math.cos(ph); }
    else { ny = Math.cos(th); nx = Math.sin(th) * Math.sin(ph); nz = Math.sin(th) * Math.cos(ph); }
    if (shape) { const s = shape(nx, ny, nz); return s; }
    return [c[0] + nx * r[0], c[1] + ny * r[1], c[2] + nz * r[2]];
  };
}
// a tube from a to b with radius r(t) (t along), optionally closed with round caps
export function tubeAt(a, b, rf, capA = true, capB = true) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A); const len = d.length(); d.normalize();
  const e1 = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize();
  const e2 = d.clone().cross(e1).normalize();
  const c0 = capA ? 0.12 : 0, c1 = capB ? 0.88 : 1;
  return (u, v) => {
    let r, along;
    if (v < c0) {
      const th = (1 - v / c0) * Math.PI / 2;
      r = rf(0) * Math.cos(th); along = -rf(0) * 0.85 * Math.sin(th);
    } else if (v > c1) {
      const th = ((v - c1) / (1 - c1)) * Math.PI / 2;
      r = rf(1) * Math.cos(th); along = len + rf(1) * 0.85 * Math.sin(th);
    } else {
      const t = (v - c0) / (c1 - c0);
      r = rf(t); along = t * len;
    }
    const ph = u * TAU;
    const cx = Math.cos(ph) * r, cy = Math.sin(ph) * r;
    return [A.x + d.x * along + e1.x * cx + e2.x * cy, A.y + d.y * along + e1.y * cx + e2.y * cy, A.z + d.z * along + e1.z * cx + e2.z * cy];
  };
}

// colour helpers (bind space)
export function ragged(p, f = 60, a = 0.012, seed = 3) { return (vnoise(p[0] * f, p[1] * f, p[2] * f, seed) - 0.5) * 2 * a; }
function bodyWhite(p) {
  // the belly line: low at the rump, high at the chest; white below it
  const line = lerp(0.092, 0.19, smoothstep(-0.12, 0.12, p[2])) + ragged(p, 45, 0.016);
  return smoothstep(line + 0.012, line - 0.012, p[1]);
}
function stripes(p) {
  // faint ginger tabby stripes over the back and sides
  const s = Math.sin(p[2] * 62 + vnoise(p[0] * 20, p[1] * 20, p[2] * 20, 5) * 4.5 + Math.abs(p[0]) * 20);
  return smoothstep(0.35, 0.95, s) * 0.45;
}

export function catGeometry(quality = 'high') {
  const q = quality === 'low' ? 0.72 : 1;
  const B = new CatBuilder(q);
  const head = (w = 1) => () => [[BI.head, w]];
  const CK = hp(0.058, -0.027, -0.012);
  const PAD = hp(0.0138, -0.0284, 0.0672 + MZ), CHIN = hp(0, -0.0452, 0.0598 + MZ * 0.8);
  const OCC = [
    { name: 'torso', c: [0, 0.146, -0.0375], r: [0.1, 0.09, 0.175] },
    { name: 'ruff', c: [0, 0.192, 0.112], r: [0.084, 0.097, 0.068] },
    { name: 'head', c: [HC.x, HC.y, HC.z], r: HEAD_R, k: 0.8 },
    { name: 'cheekL', c: [CK.x, CK.y, CK.z], r: [0.04, 0.038, 0.044], k: 0.5 },
    { name: 'cheekR', c: [-CK.x, CK.y, CK.z], r: [0.04, 0.038, 0.044], k: 0.5 },
    { name: 'hauL', c: [0.058, 0.122, -0.126], r: [0.05, 0.068, 0.07] },
    { name: 'hauR', c: [-0.058, 0.122, -0.126], r: [0.05, 0.068, 0.07] },
  ];

  // --- torso: a cobby bean, broad chest and round rump; poles front and back ---
  B.part(66, 50, (u, v) => {
    const a = v * Math.PI;
    const z = -0.0375 - 0.1725 * Math.cos(a);
    const s = Math.sin(a), ph = u * TAU;
    const rx = 0.093 + 0.012 * bump(v, 0.28, 0.22) + 0.01 * bump(v, 0.74, 0.2);
    const ry = 0.085 + 0.012 * bump(v, 0.72, 0.25);
    const cy = 0.144 + 0.012 * bump(v, 0.75, 0.3) - 0.004 * bump(v, 0.2, 0.2);
    const c = Math.cos(ph);
    return [s * rx * Math.sin(ph), cy + s * ry * c * (c < 0 ? 0.93 : 1), z];
  }, {
    occ: 'torso', seed: 11, cell: 0.025, axis: [0, 0, 1], stretch: 2.2, nrmK: 0.32, inflate: 0.35,
    L: (p, n) => 0.016 + 0.02 * smoothstep(0.1, -0.75, n[1]) - 0.004 * smoothstep(0.5, 1, n[1]),
    comb: (p, n) => [n[0] * 0.2, -0.35 - 0.7 * Math.max(0, -n[1]), -1],
    color: (p, n) => {
      const w = bodyWhite(p);
      let c = mix3(COL.ginger, COL.gingerD, stripes(p) * smoothstep(0.1, 0.18, p[1]));
      c = mix3(c, COL.gingerD, smoothstep(0.6, 1, n[1]) * 0.3);
      return mix3(c, COL.white, w);
    },
    bones: (p) => { const w = smoothstep(-0.08, 0.06, p[2]); return [[BI.hips, 1 - w], [BI.chest, w]]; },
  });

  // --- the ruff: a big white bib of long fur over the chest ---
  B.part(46, 36, ellipsoidAt(null, null, 'y', (nx, ny, nz) => {
    const push = 0.022 * smoothstep(0.2, -0.7, ny) * Math.max(0, nz);
    return [nx * 0.084 * (1 + 0.08 * smoothstep(0, -0.8, ny)), 0.188 + ny * 0.103, 0.112 + nz * 0.068 + push];
  }), {
    occ: 'ruff', seed: 21, cell: 0.024, axis: [0, 1, 0], stretch: 2.4, nrmK: 0.38,
    L: (p, n) => 0.025 + 0.012 * Math.max(0, n[2]) + 0.009 * smoothstep(0, -0.8, n[1]),
    comb: () => [0, -1, 0.45],
    color: (p) => {
      const top = smoothstep(0.045, 0.085, Math.abs(p[0]) + ragged(p, 50, 0.012)) * smoothstep(0.21, 0.25, p[1] + ragged(p, 40, 0.01));
      return mix3(COL.white, COL.ginger, top);
    },
    bones: (p) => { const w = smoothstep(0.225, 0.285, p[1]) * 0.45; return [[BI.chest, 1 - w], [BI.neck, w]]; },
  });

  // --- head: round, broad British face with full cheeks ---
  B.part(56, 44, ellipsoidAt(null, null, 'y', headShape), {
    occ: 'head', seed: 31, cell: 0.02, axis: [0, 0, 1], stretch: 1.8, nrmK: 0.4,
    L: (p, n) => {
      const front = smoothstep(0.3, 0.75, n[2]);
      return lerp(0.011, 0.0022, front) + 0.01 * smoothstep(0.3, 0.85, Math.abs(n[0])) * smoothstep(0.3, -0.5, n[1]);
    },
    comb: (p, n) => [n[0] * 0.8, -0.25, -1],
    color: (p, n) => {
      const hy = (p[1] - HEAD_C.y) / HK, ax = Math.abs(p[0]) / HK;
      // the blaze: a thin line up the forehead, widening between the eyes down to the nose
      const bw = 0.0035 + 0.027 * smoothstep(0.026, -0.02, hy);
      const blaze = smoothstep(bw + 0.004, bw - 0.004, ax + ragged(p, 70, 0.003)) * smoothstep(0.3, 0.6, n[2]) * smoothstep(0.065, 0.04, hy);
      // the lower jaw and throat are white
      const jaw = smoothstep(-0.03, -0.05, hy + ragged(p, 55, 0.008) - 0.018 * smoothstep(0.03, 0.09, ax));
      let c = mix3(COL.ginger, COL.gingerL, 0.22 * smoothstep(0.6, 0.9, n[2]));
      c = mix3(c, COL.gingerD, smoothstep(0.55, 0.95, n[1]) * 0.22 * (1 - blaze));
      // faint tabby lines running up the forehead from the brows
      const tab = Math.pow(Math.abs(Math.sin((ax + ragged(p, 40, 0.003)) * 150 + 0.4)), 3) * smoothstep(0.03, 0.06, hy) * smoothstep(0.11, 0.08, hy) * smoothstep(0.075, 0.03, ax);
      c = mix3(c, COL.gingerD, tab * 0.55 * (1 - blaze));
      return mix3(c, COL.white, Math.max(blaze, jaw));
    },
    bones: head(),
  });

  // --- full cheeks ---
  for (const sx of [1, -1]) {
    B.part(30, 24, ellipsoidAt([sx * CK.x, CK.y, CK.z], [0.04, 0.038, 0.044]), {
      occ: sx > 0 ? 'cheekL' : 'cheekR', seed: 41 + sx, cell: 0.02, axis: [0, 1, 0], stretch: 1.8, nrmK: 0.4,
      L: (p, n) => 0.012 + 0.008 * Math.max(0, sx * n[0]) * smoothstep(0.4, -0.4, n[1]),
      comb: () => [sx * 0.9, -0.9, -0.35],
      color: (p) => mix3(COL.ginger, COL.white, smoothstep(CK.y - 0.002, CK.y - 0.02, p[1] + ragged(p, 50, 0.008))),
      bones: head(),
    });
  }

  // --- muzzle: two soft whisker pads and a little chin ---
  for (const sx of [1, -1]) {
    B.part(20, 14, ellipsoidAt([sx * PAD.x, PAD.y, PAD.z], [0.0192, 0.0158, 0.0148]), {
      kind: 4, furry: 0.35, seed: 51, push: 0.0006, occ: 'head',
      // (white in the middle, warming to cream and a little ginger at the sides; like hers,
      // a ginger smudge on the upper lip beside the nose - more of it on its left)
      color: (p) => {
        let c = mix3(mix3(COL.white, COL.pad, smoothstep(0.012, 0.032, Math.abs(p[0])) * 0.5), COL.gingerL, smoothstep(0.022, 0.034, Math.abs(p[0])) * 0.6);
        const ax = Math.abs(p[0]), up = p[1] - PAD.y;
        const sm = smoothstep(0.004, 0.009, ax) * smoothstep(0.03, 0.018, ax) * smoothstep(-0.004, 0.006, up + ragged(p, 90, 0.002)) * (sx > 0 ? 0.75 : 0.45);
        return mix3(c, COL.ginger, sm);
      },
      bones: head(),
    });
  }
  B.part(18, 12, ellipsoidAt([CHIN.x, CHIN.y, CHIN.z], [0.0155, 0.0108, 0.0112]), {
    kind: 4, furry: 0.35, occ: 'head', color: () => COL.white, bones: head(),
  });
  // --- nose: a little pink rounded triangle ---
  B.part(16, 12, ellipsoidAt(null, null, 'y', (nx, ny, nz) => [
    NOSE_C.x + nx * 0.0112 * (0.72 + 0.38 * clamp(ny + 0.2, -1, 1)), NOSE_C.y + ny * 0.0074, NOSE_C.z + nz * 0.0068 - 0.0014 * ny * ny,
  ]), { kind: 3, furry: 0, occ: 'head', color: () => COL.nose, bones: head() });
  // --- eyes ---
  for (const [E, kind] of [[EYE_L, 1], [EYE_R2, 2]]) {
    const c = E.c;
    B.part(24, 18, ellipsoidAt([c.x, c.y, c.z], [EYE_R, EYE_R, EYE_R]), { kind, furry: 0, occ: 'head', color: () => mix3(COL.ginger, COL.gingerL, 0.22), bones: head() });
  }
  // --- ears: small, round-tipped and set wide, cupped and turned a little outward;
  // ginger outside, pale pink inside with long white tufts ---
  for (const sx of [1, -1]) {
    const E0 = hp(sx * 0.055, 0.054, -0.016), E1 = hp(sx * 0.085, 0.118, -0.031);
    const up = E1.clone().sub(E0); const len = up.length(); up.normalize();
    const fw = new THREE.Vector3(sx * 0.72, 0.12, 1); fw.addScaledVector(up, -fw.dot(up)).normalize();
    const sd = new THREE.Vector3().crossVectors(up, fw).normalize();
    const W0 = 0.039;
    const earAt = (u, v) => {
      const t = lerp(-0.15, 1, v);
      const th = u * TAU;
      const w = Math.max(0, W0 * (1 - t) + 0.008 * Math.sin(Math.PI * clamp(t, 0, 1)));
      const d = 0.021 * (1 - t) + 0.003;
      const cs = Math.cos(th), sn = Math.sin(th);
      // the front is a deep dish, the back rounded
      const f = sn > 0 ? -0.35 * sn * d : sn * d;
      // (a round tip)
      const tipR = t > 0.7 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.7) / 0.3, 2))) : 1;
      const x = cs * w * tipR, z = f * tipR;
      const c = E0.clone().addScaledVector(up, t * len);
      return [c.x + sd.x * x + fw.x * z, c.y + sd.y * x + fw.y * z, c.z + sd.z * x + fw.z * z];
    };
    const inner = (p, n) => {
      const r = new THREE.Vector3(p[0] - E0.x, p[1] - E0.y, p[2] - E0.z);
      const t = r.dot(up) / len, x = r.dot(sd);
      const w = Math.max(1e-3, W0 * (1 - t));
      const front = n[0] * fw.x + n[1] * fw.y + n[2] * fw.z;
      return smoothstep(0.1, 0.4, front) * smoothstep(0.8, 0.52, Math.abs(x) / w) * smoothstep(0.9, 0.72, t) * smoothstep(-0.05, 0.08, t);
    };
    B.part(24, 18, earAt, {
      seed: 61 + sx, cell: 0.011, axis: [up.x, up.y, up.z], stretch: 2.5, inflate: 0.15, shear: 1.2, nrmK: 0.3,
      // (the tufts inside are long and stand out of the ear)
      L: (p, n) => 0.003 + 0.022 * inner(p, n),
      comb: () => [up.x + fw.x * 0.9, up.y + fw.y * 0.9, up.z + fw.z * 0.9],
      color: (p, n, h) => mix3(COL.ginger, mix3(COL.inner, COL.white, h * 0.85), inner(p, n)),
      bones: (p) => {
        const t = clamp((p[1] - E0.y) / (E1.y - E0.y), 0, 1);
        const w = smoothstep(0.0, 0.3, t);
        return [[sx > 0 ? BI.earL : BI.earR, w], [BI.head, 1 - w]];
      },
    });
  }

  // paws: white fur over the top and sides, longer tufts between the toes at the front,
  // none underneath (the beans); the fur parts into creases between the toes
  const toeCleft = (n) => {
    const c = Math.abs(Math.cos(Math.atan2(n[0], n[2]) * 3.2));
    return smoothstep(0.42, 0.05, c) * smoothstep(0.25, 0.65, n[2]) * smoothstep(-0.35, 0.15, n[1]);
  };
  const pawFur = (p, n) => (0.0068 + 0.0045 * smoothstep(0.35, 0.85, n[2]) * smoothstep(-0.55, -0.05, n[1])) * smoothstep(-0.5, 0.05, n[1]) * (1 - 0.45 * toeCleft(n));
  const pawColor = (p, n) => {
    const c = mix3(COL.white, COL.bean, smoothstep(-0.78, -0.95, n[1]) * 0.8);
    const k = 1 - 0.2 * toeCleft(n);
    return [c[0] * k, c[1] * k, c[2] * (k * 0.98 + 0.02)];
  };
  // --- front legs and paws: short, fluffy, white socks ---
  for (const sx of [1, -1]) {
    const s = sx > 0 ? 'L' : 'R';
    const top = [sx * 0.053, 0.15, 0.097], bot = [sx * 0.052, 0.03, 0.113];
    B.part(18, 14, tubeAt(top, bot, (t) => 0.03 - 0.006 * t, false, true), {
      seed: 71 + sx, cell: 0.018, axis: [0, 1, 0], stretch: 2.4, inflate: 0.5,
      L: () => 0.013, comb: () => [0, -1, 0.1],
      color: () => COL.white,
      bones: (p) => { const w = smoothstep(0.065, 0.095, p[1]); return [[BI['el' + s], 1 - w], [BI['sh' + s], w]]; },
    });
    B.part(22, 14, ellipsoidAt(null, null, 'y', (nx, ny, nz) => {
      // toes: three soft bumps along the front edge
      const toes = 0.15 * Math.max(0, nz) * Math.pow(Math.abs(Math.cos(Math.atan2(nx, nz) * 3.2)), 3) * smoothstep(-0.5, 0.3, ny);
      const k = 1 + toes;
      return [sx * 0.052 + nx * 0.0242 * k, 0.0195 + ny * 0.0195 * (ny < 0 ? 0.6 : 1), 0.1255 + nz * 0.0284 * k];
    }), {
      // (fluffy white mittens: fur over the top, parting between the toes, tufts poking
      // out in front; bare pink beans underneath)
      seed: 81 + sx, cell: 0.011, L: pawFur, comb: () => [0, -0.55, 1], inflate: 0.45, stretch: 1.6, nrmK: 0.35,
      // soft pink toe beans underneath (they show when a paw comes up)
      color: pawColor,
      bones: () => [[BI['pwF' + s], 1]],
    });
  }

  // --- hind legs: fluffy ginger britches, white lower legs and paws ---
  for (const sx of [1, -1]) {
    const s = sx > 0 ? 'L' : 'R';
    B.part(36, 28, ellipsoidAt([sx * 0.058, 0.122, -0.126], [0.05, 0.068, 0.07]), {
      occ: sx > 0 ? 'hauL' : 'hauR', seed: 91 + sx, cell: 0.024, axis: [0, 1, 0], stretch: 2.1, nrmK: 0.32, inflate: 0.35,
      L: (p, n) => 0.02 + 0.013 * smoothstep(0.2, -0.7, n[1]),
      comb: () => [0, -1, -0.55],
      color: (p) => {
        const w = smoothstep(0.092, 0.07, p[1] + ragged(p, 50, 0.012)) * smoothstep(-0.115, -0.16, p[2]);
        return mix3(mix3(COL.ginger, COL.gingerD, stripes(p) * 0.6), COL.white, Math.max(w, smoothstep(0.075, 0.05, p[1])));
      },
      bones: (p) => { const w = smoothstep(0.15, 0.195, p[1]) * 0.7; return [[BI['hip' + s], 1 - w], [BI.hips, w]]; },
    });
    B.part(14, 12, tubeAt([sx * 0.062, 0.09, -0.106], [sx * 0.062, 0.03, -0.122], (t) => 0.024 - 0.003 * t, false, true), {
      seed: 101 + sx, cell: 0.018, axis: [0, 1, 0], L: () => 0.009, inflate: 0.5, comb: () => [0, -1, -0.2],
      color: () => COL.white,
      bones: (p) => { const w = smoothstep(0.068, 0.088, p[1]); return [[BI['kn' + s], 1 - w], [BI['hip' + s], w]]; },
    });
    B.part(22, 14, ellipsoidAt(null, null, 'y', (nx, ny, nz) => {
      const toes = 0.14 * Math.max(0, nz) * Math.pow(Math.abs(Math.cos(Math.atan2(nx, nz) * 3.2)), 3) * smoothstep(-0.5, 0.3, ny);
      const k = 1 + toes;
      return [sx * 0.062 + nx * 0.0232 * k, 0.019 + ny * 0.019 * (ny < 0 ? 0.6 : 1), -0.1065 + nz * 0.0274 * k];
    }), {
      seed: 111 + sx, cell: 0.011, L: pawFur, comb: () => [0, -0.55, 1], inflate: 0.45, stretch: 1.6, nrmK: 0.35,
      color: pawColor,
      bones: () => [[BI['pwB' + s], 1]],
    });
  }

  // --- tail: big and bushy, with faint rings ---
  {
    const a = [TAIL0[0] - TAIL_DIR.x * 0.03, TAIL0[1] - TAIL_DIR.y * 0.03, TAIL0[2] - TAIL_DIR.z * 0.03];
    const b = [TAIL0[0] + TAIL_DIR.x * TAIL_LEN, TAIL0[1] + TAIL_DIR.y * TAIL_LEN, TAIL0[2] + TAIL_DIR.z * TAIL_LEN];
    B.part(26, 46, tubeAt(a, b, (t) => 0.019 + 0.018 * smoothstep(0.0, 0.4, t) - 0.004 * smoothstep(0.6, 1, t), false, true), {
      seed: 121, cell: 0.022, axis: [TAIL_DIR.x, TAIL_DIR.y, TAIL_DIR.z], stretch: 2.4, nrmK: 0.3, inflate: 0.5,
      L: () => 0.03, comb: () => [TAIL_DIR.x, TAIL_DIR.y, TAIL_DIR.z], shear: 1.0,
      color: (p) => {
        const f = ((p[0] - TAIL0[0]) * TAIL_DIR.x + (p[1] - TAIL0[1]) * TAIL_DIR.y + (p[2] - TAIL0[2]) * TAIL_DIR.z) / TAIL_LEN;
        const ring = smoothstep(0.3, 0.9, Math.sin(f * TAU * 3.6 + 0.6)) * smoothstep(0.1, 0.3, f) * 0.4;
        return mix3(COL.ginger, COL.gingerD, ring);
      },
      bones: (p) => {
        const f = ((p[0] - TAIL0[0]) * TAIL_DIR.x + (p[1] - TAIL0[1]) * TAIL_DIR.y + (p[2] - TAIL0[2]) * TAIL_DIR.z) / TAIL_LEN;
        const k = clamp(f * TAIL_N, 0, TAIL_N - 1e-3);
        const i = Math.floor(k), w = k - i;
        if (f < 0) return [[BI.tail0, 0.6], [BI.hips, 0.4]];
        return i + 1 < TAIL_N ? [[BI['tail' + i], 1 - w], [BI['tail' + (i + 1)], w]] : [[BI['tail' + i], 1]];
      },
    });
  }
  B.occlude(OCC);
  B.whiskers(PAD);
  return { base: B.build(), shell: B.buildShells(quality === 'low' ? 3 : 4) };
}

// ---------------------------------------------------------------------------
// Material: soft fur light like hers, and the painted face
export function catMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uShade: { value: new THREE.Color(opts.shade || '#c2a2a6') },
    uFogScale: { value: opts.fogScale ?? 0.5 },
    uEyeL: { value: EYE_L.c.clone() }, uEyeR: { value: EYE_R2.c.clone() },
    uEyeAxL: { value: EYE_L.ax.clone() }, uEyeAxR: { value: EYE_R2.ax.clone() },
    uNoseC: { value: NOSE_C.clone() }, uMouthC: { value: MOUTH_C.clone() },
    uGaze: { value: new THREE.Vector2() },
    uBlink: { value: 0 }, uHappy: { value: 0 }, uPupil: { value: 1 }, uMeow: { value: 0 },
    uShellLen: { value: opts.shellLen ?? 0.5 }, uShellFade: { value: 1 },
    uBreath: { value: 0 }, uWhisk: { value: 0 }, uWhiskPivot: { value: WHISK_PIVOT.clone() },
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
      uniform float uBreath, uWhisk; uniform vec3 uWhiskPivot;
      void main() {
        vec3 objectNormal = normal;
        vec3 transformed = position;
        if (aFur.y > 4.5 && abs(uWhisk) > 0.001) {
          // whiskers swing forward (curious, hunting) or back (startled, drowsy) at the root
          float sx = sign(position.x);
          vec2 pv = vec2(sx * uWhiskPivot.x, uWhiskPivot.z);
          vec2 r = transformed.xz - pv;
          float th = -sx * uWhisk * 0.4;
          float c = cos(th), s = sin(th);
          transformed.xz = pv + vec2(c * r.x + s * r.y, -s * r.x + c * r.y);
          objectNormal.xz = vec2(c * objectNormal.x + s * objectNormal.z, -s * objectNormal.x + c * objectNormal.z);
        }
        #ifdef USE_SKINNING
          // breathing: its chest and flanks rise and fall (the belly most)
          vec4 tb = step(abs(skinIndex - vec4(${BI.hips}.0)), vec4(0.5)) + step(abs(skinIndex - vec4(${BI.chest}.0)), vec4(0.5));
          transformed += normal * uBreath * dot(skinWeight, tb) * (0.55 + 0.45 * smoothstep(0.4, -0.5, normal.y));
        #endif
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #if SHELL
          // each layer a little further out along the fur, combed and drooping a touch
          float sf = aShell;
          vShell = sf; vBase = position; vComb = aComb;
          float L = aLen * uShellLen;
          transformed += normal * (L * sf + 0.0006) + aComb * L * 0.75 * sf * sf - vec3(0.0, L * 0.3 * sf * sf, 0.0);
        #endif
        #include <skinning_vertex>
        vec4 w = modelMatrix * vec4(transformed, 1.0);
        vN = normalize(mat3(modelMatrix) * objectNormal);
        if (aFur.y > 4.5) {
          // a whisker: a ribbon about a pixel wide, gone when too far to see
          vec3 Vw = cameraPosition - w.xyz;
          float d = length(Vw);
          vec3 Sd = normalize(cross(vN, Vw / d));
          float wid = (0.0006 * (1.0 - 0.8 * aFur.z) + 0.00042 * d) * (1.0 - smoothstep(3.0, 5.5, d));
          w.xyz += Sd * aFur.w * wid;
          vN = Vw / d;
        }
        vW = w.xyz;
        vCol = aCol; vFur = aFur; vB = position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uShade, uRimCol; uniform float uFogScale;
      uniform vec3 uEyeL, uEyeR, uEyeAxL, uEyeAxR, uNoseC, uMouthC;
      uniform vec2 uGaze; uniform float uBlink, uHappy, uPupil, uMeow;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec4 vFur; varying vec3 vB;
      #if SHELL
        uniform float uShellFade;
        varying float vShell; varying vec3 vBase; varying vec3 vComb;
      #endif
      float cover(float d, float pw) { return clamp(0.5 - d / pw, 0.0, 1.0); }
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        // the same portrait key as hers: the sun pulled toward the camera's upper left
        vec3 cR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 cU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 cB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 Ld = normalize(mix(uSunDir, normalize(-cR * 0.62 + cU * 0.55 + cB * 0.56), 0.55));
        float fur = vFur.x, kind = vFur.y, ao = vFur.w;
        #if SHELL
          // strands: little cells of fur, each strand thinning toward its tip and fewer
          // of them the further out the layer
          // (cells drawn out along the way the fur lies: streaks, not dots)
          vec3 cb = vComb / max(length(vComb), 1e-3);
          vec3 sp = vBase * 420.0;
          sp -= cb * dot(sp, cb) * 0.72;
          vec3 ci = floor(sp);
          vec3 hs = fract(sin(vec3(dot(ci, vec3(127.1, 311.7, 74.7)), dot(ci, vec3(269.5, 183.3, 246.1)), dot(ci, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          vec3 fp = fract(sp) - 0.5 - (hs - 0.5) * 0.55;
          float rr = length(fp);
          float rad = mix(0.5, 0.17, vShell) * step(vShell * 0.62 + (1.0 - uShellFade) * 1.1, hs.x + 0.05);
          float shellA = smoothstep(rad + 0.08, rad - 0.08, rr);
          #if LOW_Q
            if (shellA < 0.5) discard;
          #else
            if (shellA < 0.02) discard;
          #endif
        #endif
        if (kind > 4.5) {
          vec3 wc = vec3(0.96, 0.94, 0.9) * mix(uShadowTint, uLightTint, 0.8) + uAmb * 0.04;
          gl_FragColor = vec4(applyFogK(wc, vW, uFogScale), 1.0);
          return;
        }
        float ndl = dot(N, Ld);
        // light scatters through fur: a very wide, soft terminator
        float l = smoothstep(mix(-0.25, -0.7, fur), mix(0.55, 0.85, fur), ndl);
        vec3 base = vCol;
        vec3 shade = uShade * uShadowTint;
        vec3 lit = mix(shade, uLightTint * 1.05, l * mix(0.6, 1.0, ao));
        vec3 col = base * lit;
        col += base * mix(vec3(0.05, 0.045, 0.04), uAmb * 0.13, N.y * 0.5 + 0.5) * ao;
        float nv = clamp(dot(N, V), 0.0, 1.0);
        float rim = pow(1.0 - nv, 2.4);
        col += uRimCol * rim * (0.12 + 0.24 * fur) * (0.45 + 0.55 * l) * ao;
        // the sun glowing through the fur at the edges when it is behind the cat
        float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
        col += uSunCol * base * back * rim * 0.8 * fur;
        if (kind > 0.5) {
          if (kind < 2.5) {
            // --- eye: amber iris, big dark pupil, catchlights, lids ---
            bool left = kind < 1.5;
            vec3 c = left ? uEyeL : uEyeR;
            vec3 ax = left ? uEyeAxL : uEyeAxR;
            vec3 q = normalize(vB - c);
            vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), ax));
            vec3 ey = cross(ax, ex);
            vec2 e = vec2(dot(q, ex), dot(q, ey)) / ${EYE_K.toFixed(3)};
            float pw = max(length(fwidth(e)), 1e-4) * 1.2;
            vec2 qi = e - uGaze * vec2(0.24, 0.2);
            float r = length(qi);
            vec3 iris = mix(vec3(0.9, 0.68, 0.24), vec3(1.0, 0.9, 0.5), smoothstep(0.15, -0.65, qi.y) * 0.85);
            iris *= 0.95 + 0.05 * sin(atan(qi.y, qi.x) * 21.0 + r * 11.0);
            iris = mix(iris, vec3(0.58, 0.37, 0.12), smoothstep(0.55, 0.85, r));
            vec2 pp = qi / vec2(0.3 * uPupil, 0.38 * mix(uPupil, 1.0, 0.35));
            float pupil = cover(length(pp) - 1.0, pw * 2.2);
            vec3 ec = mix(iris, vec3(0.02, 0.016, 0.02), pupil);
            // at night its eyes catch the light: the soft green-gold glow deep in a cat's eyes
            float shine = uNight * pow(max(dot(N, V), 0.0), 2.5);
            ec += vec3(0.28, 0.5, 0.26) * shine * pupil * smoothstep(0.9, 0.1, length(pp)) * 0.9;
            ec += iris * shine * (1.0 - pupil) * 0.25;
            // dark rims where the eye meets the fur
            ec = mix(ec, vec3(0.16, 0.08, 0.04), smoothstep(0.84, 0.97, length(e)));
            ec *= mix(0.72, 1.06, smoothstep(-0.6, 0.6, ndl));
            // catchlights: a big soft one toward the light, a small one below
            float h1 = cover(length((e - vec2(-0.24, 0.3)) / vec2(0.2, 0.22)) - 1.0, pw * 5.0);
            float h2 = cover(length(e - vec2(0.2, -0.24)) - 0.075, pw);
            ec = mix(ec, vec3(1.0, 0.99, 0.96), max(h1 * 0.95, h2 * 0.8));
            // lids: blinking brings the upper lid down; happy, both curve into arcs
            float cov = max(uBlink, uHappy);
            float hw = uHappy / max(uHappy + uBlink, 1e-3);
            float bend = mix(0.06 - 0.12 * e.x * e.x / max(1.0 - e.x * e.x, 0.05), mix(-0.32, 0.46, hw), cov);
            float yl = mix(0.93, mix(-0.3, -0.28, uHappy), cov) + bend * (1.0 - e.x * e.x);
            float low = mix(-1.05, yl - 0.06, smoothstep(0.75, 1.0, cov));
            float lid = max(cover(yl - e.y, pw), cover(e.y - low, pw));
            vec3 furC = base * lit;
            vec3 eyeC = mix(ec, furC, lid);
            float line = cover(abs(e.y - yl) - mix(0.07, 0.09, cov), pw);
            eyeC = mix(eyeC, vec3(0.1, 0.06, 0.05), line * smoothstep(1.1, 0.85, abs(e.x)));
            col = eyeC;
          } else if (kind < 3.5) {
            // --- nose: pink, glossy on top, two little nostrils ---
            vec2 n = vec2((vB.x - uNoseC.x) / 0.0118, (vB.y - uNoseC.y) / 0.0078);
            float pw = max(length(fwidth(n)), 1e-4);
            vec3 nc = base * mix(0.82, 1.08, smoothstep(-0.8, 0.6, n.y));
            // (a slightly deeper pink rim round the leather)
            nc = mix(nc, nc * vec3(0.84, 0.7, 0.7), smoothstep(0.7, 0.98, length(n * vec2(1.0, 1.15))));
            float nos = max(cover(length((n - vec2(0.42, -0.38)) / vec2(0.2, 0.14)) - 1.0, pw * 0.3), cover(length((n - vec2(-0.42, -0.38)) / vec2(0.2, 0.14)) - 1.0, pw * 0.3));
            nc = mix(nc, vec3(0.42, 0.2, 0.2), nos * 0.8);
            nc = mix(nc, vec3(0.4, 0.2, 0.2), cover(abs(n.x) - 0.06, pw) * smoothstep(-0.3, -0.85, n.y) * 0.8);
            col = nc * mix(shade, uLightTint * 1.05, l) + base * uAmb * 0.05;
            col += vec3(1.0, 0.95, 0.95) * cover(length((n - vec2(-0.1, 0.5)) / vec2(0.32, 0.18)) - 1.0, pw * 0.5) * 0.35 * l;
          } else {
            // --- mouth: a little philtrum line and the "w" of the lips ---
            vec2 m = vec2(vB.x - uMouthC.x, vB.y - uMouthC.y);
            float pw = max(length(fwidth(m)), 1e-6);
            float ax = abs(m.x);
            float w = max(0.0009, pw * 0.8);
            float d1 = length(vec2(m.x, m.y - clamp(m.y, -0.0068, 0.0))) - w * 0.5;
            float yArc = -0.0068 - 0.0042 * sin(clamp(ax / 0.0115, 0.0, 1.0) * 3.14159);
            float d2 = ax < 0.0125 ? abs(m.y - yArc) - w * 0.5 : 1.0;
            float vis = smoothstep(uMouthC.z - 0.026, uMouthC.z - 0.014, vB.z);
            float a = cover(min(d1, d2), pw) * vis * (1.0 - smoothstep(0.0016, 0.0035, pw));
            col = mix(col, col * vec3(0.5, 0.36, 0.36), a * (1.0 - min(uMeow, 1.0)));
            // the little rows of whisker dots on the pads
            {
              float dots = 0.0;
              for (int r = 0; r < 3; r++) for (int i = 0; i < 3; i++) {
                vec2 dc = vec2(0.0072 + 0.0036 * float(i) + 0.0016 * float(r), 0.0012 - 0.0031 * float(r) - 0.0008 * float(i));
                dots = max(dots, cover(length(vec2(ax, m.y) - dc) - 0.00055, pw));
              }
              col = mix(col, col * vec3(0.72, 0.6, 0.52), dots * vis * 0.7 * (1.0 - smoothstep(0.0008, 0.002, pw)));
            }
            // a meow: the little mouth opens into a soft rounded "o", pink tongue below
            if (uMeow > 0.01) {
              // (opening downward: a big yawn drops the jaw, the top stays under the nose)
              float ry = 0.0068 * uMeow + 0.001;
              float topY = min(-0.0098 + ry, -0.0022);
              vec2 mo = (m - vec2(0.0, topY - ry)) / vec2(0.0072 + 0.0016 * max(uMeow - 1.0, 0.0), ry);
              float dm = (length(mo) - 1.0) * min(0.0072, ry);
              float inside = cover(dm, pw) * vis;
              vec3 mc = mix(vec3(0.36, 0.11, 0.13), vec3(0.93, 0.52, 0.56), smoothstep(0.1, 0.8, -mo.y) * 0.85);
              col = mix(col, mc * mix(uShadowTint, uLightTint, 0.85), inside);
              // a big yawn shows two little fangs
              if (uMeow > 1.0) {
                vec2 fp = vec2(abs(m.x) - 0.0045, m.y - topY + 0.0019);
                float fd = length(fp / vec2(0.00105 + 0.0006 * (fp.y / 0.002), 0.002)) - 1.0;
                col = mix(col, vec3(0.97, 0.95, 0.92) * mix(uShadowTint, uLightTint, 0.9), cover(fd * 0.0011, pw) * inside * smoothstep(1.0, 1.3, uMeow));
              }
              col = mix(col, col * vec3(0.55, 0.38, 0.38), cover(abs(dm) - w * 0.4, pw) * vis);
            }
          }
        }
        col += base * pointLight(vW, N) * 1.3;
        #if SHELL
          // deeper in the fur is a little darker, the tips catch the light
          col *= mix(0.9, 1.05, vShell);
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
// two-bone IK in the leg's plane (y, z): angles measured from straight down toward +z
export function ik2(Ay, Az, Ty, Tz, L1, L2, bend, out) {
  const dy = Ty - Ay, dz = Tz - Az;
  const d = clamp(Math.hypot(dy, dz), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  const phi = Math.atan2(dz, -dy);
  const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const t1 = phi + bend * a;
  const Ey = Ay - L1 * Math.cos(t1), Ez = Az + L1 * Math.sin(t1);
  out[0] = t1; out[1] = Math.atan2(Tz - Ez, -(Ty - Ey));
  return out;
}
export const rotX = (y, z, a, out) => { const c = Math.cos(a), s = Math.sin(a); out[0] = y * c - z * s; out[1] = y * s + z * c; return out; };
export function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const wrapA = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const approachA = (a, b, k) => a + wrapA(b - a) * k;

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
// The butterfly it plays with: one little pale-blue butterfly, flown by the cat's agent
export function catButterfly(U, color = '#9fd0ff', size = 1) {
  const g = new THREE.PlaneGeometry(2, 1, 2, 1);
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uPos: { value: new THREE.Vector3() }, uYaw: { value: 0 }, uFlap: { value: 0 }, uAlpha: { value: 0 }, uCol: { value: new THREE.Color(color) }, uSize: { value: size } },
    vertexShader: /* glsl */ `
      uniform vec3 uPos; uniform float uYaw, uFlap, uSize;
      varying vec2 vUv; varying vec3 vW;
      void main() {
        vec3 p = position * vec3(0.034, 1.0, 0.03) * uSize;
        float side = sign(position.x + 1e-4);
        float ax = abs(p.x);
        p = vec3(side * ax * cos(uFlap), ax * sin(uFlap), p.z);
        p.xz = mat2(cos(uYaw), -sin(uYaw), sin(uYaw), cos(uYaw)) * p.xz;
        vec3 w = uPos + p;
        vW = w; vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uAlpha; uniform vec3 uCol;
      varying vec2 vUv; varying vec3 vW;
      void main() {
        vec2 q = vec2(abs(vUv.x - 0.5) * 2.0, 1.0 - vUv.y);
        float fore = length((q - vec2(0.55, 0.66)) * vec2(1.0, 1.25));
        float hind = length((q - vec2(0.45, 0.3)) * vec2(1.15, 1.4));
        float shape = min(fore - 0.42, hind - 0.32);
        if (shape > 0.0 || q.x < 0.04 || uAlpha < 0.01) discard;
        vec3 col = uCol;
        col = mix(col, col * 0.55, smoothstep(-0.07, 0.0, shape));
        col = mix(col, vec3(1.0), smoothstep(0.08, 0.0, length(q - vec2(0.62, 0.72))) * 0.6);
        col *= mix(uShadowTint, uLightTint, 0.85) * 1.08;
        col += uCol * uNight * 0.35;
        col = applyFogK(col, vW, 0.6);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return { mesh, mat, pos: new THREE.Vector3(), prev: new THREE.Vector3() };
}

// a firefly for it to leap after at night: a soft glowing point, pulsing
export function catFirefly() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 800 }, uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uScale; uniform float uGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(0.2 * uScale / max(-mv.z, 0.05), 4.0, 96.0) * (0.8 + 0.2 * uGlow);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(0.16, 0.0, d), halo = exp(-d * d * 7.0) * 0.8 + exp(-d * d * 30.0) * 0.6;
        vec3 c = vec3(0.86, 1.0, 0.55) * (core * 1.6 + halo) * uGlow;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 7;
  return { pts, mat };
}

// a little puff of pollen from a sneeze: a few soft specks blown out from its nose
export function catPuff(U) {
  const N = 22;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(N), 1));
  g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(N).map((v, i) => 0.6 + 0.8 * ((i * 37) % 11) / 10), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uScale: { value: 800 } },
    vertexShader: /* glsl */ `
      attribute float aA; attribute float aS; uniform float uScale; varying float vA; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * w;
        vA = aA; vW = w.xyz;
        gl_PointSize = clamp(0.02 * aS * uScale / max(-mv.z, 0.05), 1.5, 34.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying float vA; varying vec3 vW;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5 || vA < 0.01) discard;
        vec3 c = vec3(1.0, 0.95, 0.72) * mix(uShadowTint, uLightTint, 0.9) * 1.25;
        gl_FragColor = vec4(applyFogK(c, vW, 0.6), smoothstep(0.5, 0.12, d) * vA);
      }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 7;
  return { pts, mat, N, t0: -9, v: new Float32Array(N * 3), o: new THREE.Vector3() };
}

// ---------------------------------------------------------------------------
export class Cat {
  constructor(U, { quality = 'high' } = {}) {
    this.quality = quality;
    const geo = catGeometry(quality);
    this.mat = catMaterial(U);
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
    // the fur layers: a second skinned mesh on the same skeleton, drawn just after
    this.shellMat = catMaterial(U, { shell: true, lowQ: quality === 'low', shellLen: 0.5 });
    const shell = new THREE.SkinnedMesh(geo.shell, this.shellMat);
    mesh.add(shell);
    shell.bind(skeleton, new THREE.Matrix4());
    shell.frustumCulled = false;
    shell.renderOrder = 1;
    this.shell = shell;
    mesh.scale.setScalar(CAT_SCALE);
    this.mesh = mesh;
    this.bones = {};
    bones.forEach((b) => { this.bones[b.name] = b; b.rotation.order = 'YXZ'; });
    this.bind = {};
    bones.forEach((b) => { this.bind[b.name] = b.position.clone(); });
    this.shadow = contactShadow(0.36, 0.42, 0.6);
    this.group = new THREE.Group();
    this.group.add(mesh, this.shadow);
    this.bfly = catButterfly(U);
    this.group.add(this.bfly.mesh);
    this.puff = catPuff(U);
    this.group.add(this.puff.pts);
    this.fly = catFirefly();
    this.group.add(this.fly.pts);
    this.P = this.defaultPose();
    this.ik = [0, 0];
    this.tmp = [0, 0];
    // the agent
    this.A = { x: 0, z: 0, y: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, roll: 0, inited: false, mode: 'wait', mt: 0, phase: 0, gK: 0, bK: 0, sit: 1, look: new THREE.Vector3(), lookW: 0, hx: 0, hy: 0, hr: 0, blinkT: 2, blink: 0, slowT: 4, earT: 3, ear: [0, 0], twitch: [0, 0], hop: 0, hopT: 0, laps: 0, lapAcc: 0, lapDir: 1, prevAng: 0, side: 1, nextLap: 6, glanceT: 3, glance: 0, burstSeen: false, tail: 0, tailSwing: 0 };
    this.v = { her: new THREE.Vector3(), prevHer: new THREE.Vector3(), hv: new THREE.Vector3(), tgt: new THREE.Vector3(), lookT: new THREE.Vector3(), headW: new THREE.Vector3() };
    this.active = false;
  }

  defaultPose() {
    return { sit: 0, phase: 0, speed: 0, gK: 0, bK: 0, stride: 0.12, lift: 0.025, bob: 0, hop: 0, pitch: 0, roll: 0, spine: 0, headYaw: 0, headPitch: 0, headRoll: 0, tailUp: 0.4, tailSwish: 0, tailCurl: 0, tailFlat: 0, tailLag: 0, tailFlick: 0, groom: 0, lick: 0, meow: 0, earL: 0, earR: 0, earBack: 0, blink: 0, happy: 0, gazeX: 0, gazeY: 0, pupil: 1, crouch: 0, reach: 0, stretch: 0, wiggle: 0, leap: 0, loaf: 0, knead: 0, stand: 0, held: 0, flop: 0, flopSide: 1, arch: 0, standHigh: 0, tailHook: 0, box: 0, swatL: 0, swatR: 0, breath: 0, whisk: 0, tailQuiver: 0, pawL: 0, pawR: 0, pawShake: 0, pawZ: 0, pawY: 0, pawX: 0, time: 0 };
  }

  // Pose the skeleton from a few high-level parameters
  pose(P) {
    const b = this.bones, bind = this.bind;
    // (lying in a loaf replaces sitting: belly on the ground, paws tucked under)
    const lf = P.loaf || 0;
    // (flopped over on its side: rolled round its long axis, legs out along the ground)
    const fl = P.flop || 0, fside = P.flopSide || 1;
    const sit = P.sit * (1 - lf) * (1 - fl), run = P.bK, trot = P.gK;
    const go = (P.speed > 0.02 ? 1 : 0) * (1 - sit);
    // --- the gait: each foot is planted for part of the cycle (longer walking, short
    // and springy bounding) and sweeps back under the body at its speed, then lifts and
    // swings forward. The body travels 2 * stride per cycle.
    const D = lerp(lerp(0.62, 0.5, trot), 0.34, run);
    const sweep = Math.min(D * P.stride, lerp(0.05, 0.068, run));
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
        // (a quick lift, a reach forward, set down softly)
        f.z = lerp(-sweep, sweep, e); f.y = Math.pow(Math.sin(Math.PI * u), 0.75) * (1 - 0.25 * u);
        f.curl = Math.sin(Math.PI * Math.min(1, u * 1.35)); f.load = 0;
      }
      f.z *= go; f.y *= go; f.curl *= go; f.load *= go;
      if (k[0] === 'F') { loadF += f.load * 0.5; zF += f.z * 0.5; } else { loadH += f.load * 0.5; zH += f.z * 0.5; }
    }
    // the body dips as the feet take its weight and rises when they leave the ground;
    // bounding, the back flexes as the hind feet come up under it and stretches out
    // as the front feet reach forward
    const meanLoad = D * 2 / Math.PI;
    const bAmp = lerp(lerp(0.004, 0.007, trot), 0.026, run);
    const bounce = -bAmp * ((loadF + loadH) * 0.5 - meanLoad) * go;
    const gather = clamp((zH - zF) / (2 * sweep + 1e-4), -1, 1);
    const flex = gather * lerp(0.035, 0.32, run) * go;
    // (and it runs low)
    // (hunting: low to the ground, rump wiggling before the pounce)
    const cr = P.crouch || 0, wg = (P.wiggle || 0) * Math.sin(P.time * 15), lp0 = P.leap || 0;
    const rootY = P.hop + bounce - (cr * 0.05 + 0.012 * run * go) - 0.066 * lf;
    // a big stretch: front paws out along the ground, chest down, rump up
    const st = P.stretch || 0;
    const rootP = P.pitch - run * 0.13 * (loadH - loadF) * go + 0.36 * st - 0.06 * (P.leap || 0);
    const froll = fside * (Math.PI / 2) * fl * (1 + 0.08 * Math.sin(P.time * 2.3) * fl);
    b.root.position.set(0, rootY + 0.098 * Math.sin(Math.abs(froll)), 0);
    b.root.rotation.set(rootP, 0, P.roll + wg * 0.03 + froll);
    // (standing up on its hind legs: the body swings up round the hips)
    const su = P.stand || 0;
    const hipsDrop = 0.072 * sit + 0.022 * su;
    b.hips.position.set(bind.hips.x, bind.hips.y - hipsDrop, bind.hips.z + 0.01 * sit);
    const ph = P.phase * TAU;
    const hd = P.held || 0;
    const ar = P.arch || 0;
    const hx = -0.62 * sit - 0.5 * flex + 0.15 * st - 0.06 * cr - 1.08 * su - 0.3 * hd - 0.32 * ar;
    b.hips.rotation.set(hx, 0.05 * Math.sin(ph) * trot * (1 - run) * go + wg * 0.16, 0);
    const cx = 0.1 * sit + flex + P.spine - P.reach * 0.6 + 0.2 * st + 0.12 * cr + 0.14 * su + 0.62 * ar;
    b.chest.rotation.set(cx, -0.06 * Math.sin(ph) * trot * (1 - run) * go, 0);
    const nx0 = 0.3 * sit + 0.12 * lf;
    // (lying on its side it lifts its head a little toward upright)
    b.neck.rotation.set(nx0 + P.headPitch * 0.35, P.headYaw * 0.35, -froll * 0.3);
    // the head looks where it is told, whatever the body does (a little nod with each
    // step as it walks)
    const nod = (0.035 * (1 - run) * (1 - trot * 0.5)) * Math.sin(ph * 2 + 0.6) * go;
    const bodyPitch = hx + cx + nx0 + P.headPitch * 0.35 + rootP * 0.85;
    const g = P.groom, lk = Math.sin(P.lick);
    b.head.rotation.set(-bodyPitch + P.headPitch * (1 - g) + g * (0.62 + 0.07 * lk) + nod, P.headYaw * 0.65 * (1 - g) + g * 0.32, P.headRoll * (1 - g) + g * 0.2);
    // ears: perked, flicking, flattened a little when running
    b.earL.rotation.set(-0.15 * P.earBack - 0.25 * run, P.earL, -0.25 * P.earBack - 0.18 * run);
    b.earR.rotation.set(-0.15 * P.earBack - 0.25 * run, -P.earR, 0.25 * P.earBack + 0.18 * run);
    // legs: feet planted by IK along their paths
    for (const k of LEG_KEYS) {
      const L = LEGS[k];
      const front = L.parentChain === 'front';
      const f = FT[k];
      // (the front feet step a touch behind their rest spot: the legs are short)
      let tz = L.E[2] + f.z - (front ? 0.008 * go : 0);
      let ty = L.E[1] + P.lift * f.y + Math.max(0, P.hop) * 0.55;
      if (front) {
        // sitting: front paws together under the chest; reaching: paws up
        tz += sit * 0.008 + P.reach * 0.06 + st * 0.1 + cr * 0.02 + lp0 * 0.09 - lf * 0.008;
        ty += P.reach * 0.13 + lp0 * 0.07 - lf * 0.012;
        // standing: paws up on her skirt, patting
        if (su > 0) { tz = lerp(tz, 0.19 - 0.04 * (P.standHigh || 0), su); ty = lerp(ty, 0.26 + 0.12 * (P.standHigh || 0) + Math.max(0, Math.sin(P.time * 6.5 + (k === 'FL' ? 0 : 2.2))) * 0.012 * (1 - (P.standHigh || 0)) * (1 - (P.box || 0)), su); }
        // (up to bat at something: paws held up in front of its chest, one flicking up and
        // out to swat, hooking down)
        if (P.box) {
          const sw = k === 'FL' ? P.swatL : P.swatR;
          tz = lerp(tz, 0.15 + 0.07 * sw, P.box); ty = lerp(ty, 0.25 + 0.14 * sw - 0.02 * (k === 'FL' ? P.swatR : P.swatL), P.box);
        }
        // held: paws resting up on her chest
        if (hd > 0) { tz = lerp(tz, 0.16, hd); ty = lerp(ty, 0.34, hd); }
        // a paw up into her hand ("shake")
        const pu = k === 'FL' ? (P.pawL || 0) : (P.pawR || 0);
        if (pu) { tz = lerp(tz, P.pawZ + 0.006, pu); ty = lerp(ty, P.pawY + 0.016, pu); }
        // kneading, happy under her hand: the front paws pressing in turn
        if (P.knead) { const kp = Math.max(0, Math.sin(P.time * 5.5 + (k === 'FL' ? 0 : Math.PI))) * P.knead; ty += kp * 0.014; tz += kp * 0.006; }
        // grooming: the left paw up to its mouth
        if (k === 'FL' && P.groom > 0) { const gg = P.groom; tz = lerp(tz, 0.185 + 0.006 * Math.sin(P.lick), gg); ty = lerp(ty, 0.2 + 0.008 * Math.sin(P.lick + 1), gg); }
      } else {
        tz += sit * 0.115 - lp0 * 0.08 + lf * 0.04 + su * 0.045;
        ty += sit * 0.004 + lp0 * 0.025 - lf * 0.012;
      }
      rotX(ty - rootY, tz, -rootP, this.tmp);
      ty = this.tmp[0]; tz = this.tmp[1];
      // the leg's root joint, carried by the body
      const hy = bind.hips.y - hipsDrop, hz = bind.hips.z + 0.01 * sit;
      let Ay, Az;
      if (front) {
        // chest relative to hips, shoulder relative to chest
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
      // (held up in her arms, the hind legs hang)
      if (!front && hd > 0) { ty = lerp(ty, Ay - 0.098, hd); tz = lerp(tz, Az + 0.012, hd); }
      // (flopped: legs reaching out along the ground, front ones forward, hind ones back)
      if (fl > 0) { ty = lerp(ty, Ay - 0.085, fl); tz = lerp(tz, Az + (front ? 0.045 : -0.05), fl); }
      const r = ik2(Ay, Az, ty, tz, L.L1, L.L2, L.bend, this.ik);
      const parent = front ? hx + cx : hx;
      const a1 = L.b1 - r[0] - parent;
      const a2 = L.b2 - r[1] - parent - a1;
      // (batting at something, the paw flicks out to the side too)
      let abd = front && P.box ? (k === 'FL' ? P.swatL : -P.swatR) * 0.95 * P.box : 0;
      // (a paw up into her hand: swung in or out to meet it)
      const pu2 = front ? (k === 'FL' ? (P.pawL || 0) : (P.pawR || 0)) : 0;
      if (pu2) abd += clamp((P.pawX - bind[L.up].x) / Math.max(0.08, Math.hypot(ty - Ay, tz - Az)), -0.8, 0.8) * pu2;
      b[L.up].rotation.set(a1, 0, abd);
      b[L.mid].rotation.set(a2, 0, 0);
      // paws stay level, curling as they lift (flicking right back when bounding)
      const curl = lerp(0.7, 1.15, run) * f.curl - (front ? 0.5 * (k === 'FL' ? (P.pawL || 0) : (P.pawR || 0)) : 0) + (front && P.box ? (k === 'FL' ? P.swatL : P.swatR) * 0.9 * P.box : 0) + (front ? P.reach * 0.6 - st * 0.25 + lf * 1.2 + (P.knead ? Math.max(0, Math.sin(P.time * 5.5 + (k === 'FL' ? 0 : Math.PI))) * 0.45 * P.knead : 0) : lf * 0.6) + (k === 'FL' ? P.groom * 1.15 : 0);
      b[L.end].rotation.set(-(parent + a1 + a2) + curl, 0, 0);
    }
    // tail: up and hooked when happy, curled round the paws when sitting, streaming when running
    const tUp = P.tailUp * (1 - Math.max(sit, lf)) * (1 - run * 0.3);
    for (let i = 0; i < TAIL_N; i++) {
      const t = b['tail' + i];
      const f = i / (TAIL_N - 1);
      const sw = P.tailSwish * Math.sin(P.time * 2.6 - i * 0.55) * (0.3 + 0.7 * f);
      let rx = 0, ry = sw * (1 - sit * 0.7);
      if (i === 0) rx = 0.95 * tUp - 0.35 * run - 0.15 * (1 - P.tailUp) * (1 - sit) - sit * 0.75 - 0.6 * (P.crouch || 0) + 0.55 * su;
      else rx = (f > 0.6 ? 0.42 : 0.04) * tUp - 0.08 * run * Math.sin(P.phase * TAU - i) - (1 - P.tailUp) * (1 - sit) * 0.12 * (1 - run);
      // sitting: the tail lies along the ground and wraps around to the front paws
      rx += sit * (i === 0 ? 0.45 : i === 1 ? 0.22 : 0);
      ry += sit * P.tailCurl * (i === 0 ? 0.3 : 0.42);
      // it trails behind turns and swings back; sitting, the tip flicks now and then
      ry += P.tailLag * (0.35 + 0.65 * f) * (1 - sit * 0.6);
      // (rubbing against her, hooked over toward her)
      if (P.tailHook) ry -= P.tailHook * (i === 0 ? 0.14 : 0.16 + 0.22 * f);
      // (so happy to see her: the upright tail quivers)
      if (P.tailQuiver) { const q = P.tailQuiver * tUp * (0.25 + 0.75 * f); rx += Math.sin(P.time * 47 + i * 1.7) * 0.04 * q; ry += Math.sin(P.time * 43 + i * 2.3) * 0.035 * q; }
      if (i >= TAIL_N - 2) { rx += P.tailFlick * 0.55 * sit; ry += P.tailFlick * 0.25 * sit; }
      // flopped: the tail lies out behind it, swishing lazily
      if (fl > 0) {
        const frx = (i === 0 ? -0.55 : 0.02) + 0.05 * Math.sin(P.time * 1.8 - i * 0.6);
        rx = lerp(rx, frx, fl); ry = lerp(ry, 0.12 * Math.sin(P.time * 1.3 - i * 0.5), fl);
      }
      // in a loaf: down to the ground and curled round along its side (tip still flicking)
      if (lf > 0) {
        const lrx = (i === 0 ? -1.4 : i === 1 ? 0.9 : 0) + (i >= TAIL_N - 2 ? P.tailFlick * 0.4 : 0);
        const lry = (i === 0 ? 0.25 : 0.4) * P.tailCurl + sw * 0.25;
        rx = lerp(rx, lrx, lf); ry = lerp(ry, lry, lf);
      }
      t.rotation.set(rx, ry, 0);
    }
    // face
    const u = this.mat.uniforms;
    u.uBlink.value = P.blink;
    u.uHappy.value = P.happy;
    u.uGaze.value.set(P.gazeX, P.gazeY);
    u.uPupil.value = P.pupil;
    u.uMeow.value = P.meow || 0;
    u.uWhisk.value = P.whisk || 0;
    u.uBreath.value = P.breath || 0;
    this.shellMat.uniforms.uBreath.value = P.breath || 0;
  }

  // -------------------------------------------------------------------------
  // The agent. ctx: { t, time, her (her feet, or her body while flying), herYaw, fly,
  // walk, kneel, cam, wait: { x, z, yaw, td: {x, z} }, flower, cake, burstAge, wishAge, reduced }
  update(dt, ctx) {
    dt = Math.min(dt, 0.1);
    const A = this.A, P = this.P, v = this.v;
    const time = ctx.time, t = ctx.t;
    const rnd = this.rnd || (this.rnd = mulberry(7));
    const her = v.her.copy(ctx.her);
    // her speed over the ground (smoothed)
    if (!A.inited) { v.prevHer.copy(her); }
    const hvx = (her.x - v.prevHer.x) / Math.max(dt, 1e-3), hvz = (her.z - v.prevHer.z) / Math.max(dt, 1e-3);
    v.prevHer.copy(her);
    const kv = 1 - Math.exp(-dt * 6);
    v.hv.x += (clamp(hvx, -30, 30) - v.hv.x) * kv; v.hv.z += (clamp(hvz, -30, 30) - v.hv.z) * kv;
    const herSp = Math.hypot(v.hv.x, v.hv.z);
    const fwx = Math.sin(ctx.herYaw), fwz = Math.cos(ctx.herYaw);
    const lfx = Math.cos(ctx.herYaw), lfz = -Math.sin(ctx.herYaw);
    // which of her sides faces the camera
    const camSide = ((ctx.cam.x - her.x) * lfx + (ctx.cam.z - her.z) * lfz) >= 0 ? 1 : -1;
    const landed = ctx.fly < 0.15;
    const W = ctx.wait;
    // --- choose what to do ---
    let mode = A.mode;
    const prevLanded = A.landed;
    A.landed = landed;
    const ctxMode = !landed ? 'wait'
      : ctx.kneel > 0.02 || (t > 0.397 && t < 0.505) ? 'flower'
        : t > 0.736 && t < 0.786 && ctx.walk < 0.5 ? 'summit'
          : t > 0.843 ? 'cake'
            : ctx.pet && ctx.pet !== 'idle' ? 'pet'
              : herSp > 0.3 ? 'follow' : 'play';
    if (!A.inited) {
      // first frame: already where it belongs
      A.inited = true; mode = ctxMode === 'play' || ctxMode === 'follow' ? ctxMode : ctxMode;
      A.mode = mode; A.mt = 0; A.snap = true;
    }
    if (landed && prevLanded === false && t < 0.33 && !ctx.reduced) {
      // she has just touched down: happy laps around her
      A.mode = 'greet'; A.mt = 0; A.lapAcc = 0; A.laps = 2.6;
      const th = Math.atan2(A.x - her.x - fwx * 0.4, A.z - her.z - fwz * 0.4), tc = Math.atan2(ctx.cam.x - her.x, ctx.cam.z - her.z);
      A.lapDir = wrapA(tc - th) >= 0 ? 1 : -1;
      A.prevAng = th;
      A.hop0 = time; A.hopDur = 0.38; A.hopH = 0.05;
    } else if (A.mode === 'greet') {
      if (!landed || ctxMode === 'flower' || ctxMode === 'summit' || ctxMode === 'cake' || ctxMode === 'pet') A.mode = ctxMode;
    } else if (A.mode === 'lap' || A.mode === 'weave') {
      if ((ctxMode !== 'play' && ctxMode !== 'follow') || (A.mode === 'weave' && ctxMode === 'follow')) { A.mode = ctxMode; if (A.mode === 'follow') A.side = camSide; }
    } else if (ctxMode !== A.mode && !(A.mode === 'near' && ctxMode === 'play')) {
      A.mode = ctxMode === 'play' ? 'near' : ctxMode; A.mt = 0;
      if (A.mode === 'near') A.side = camSide;
      if (A.mode === 'follow' && A.prevMode !== 'lap') A.side = camSide;
      A.nextLap = 4 + rnd() * 3;
    }
    if (A.mode === 'play') A.mode = 'near';
    if (A.mode !== A.prevMode) { A.mt = 0; A.prevMode = A.mode; A.scout = null; A.nextScout = undefined; }
    A.mt += dt;
    mode = A.mode;
    // --- where to go, which way to face, where to look ---
    let tx = A.x, tz = A.z, vmax = 3, faceYaw = A.yaw, wantSit = false, ff = 0, arriveK = 2.6;
    const look = v.lookT;
    const herHead = (h) => look.set(her.x, her.y + (landed ? h : 0.25), her.z);
    let tailUp = 1, swish = 0.25, pupil = 1, ex = 0, happy = 0, lookW = 1, earBack = 0, startle = 0, cuddle = 0;
    if (mode === 'wait') {
      ex = smoothstep(0.222, 0.242, t);
      herHead(1.3);
      tailUp = ex; swish = 0.2 + 0.5 * ex; pupil = 1 + 0.3 * ex;
      if (t < 0.2445) {
        // sitting in the meadow, watching her come down out of the sky
        tx = W.x; tz = W.z;
        faceYaw = Math.atan2(her.x - W.x, her.z - W.z);
        wantSit = ex < 0.55;
        vmax = 3.5;
        // up on its paws and bouncing with excitement as she comes close
        if (ex > 0.75 && !ctx.reduced && Math.hypot(W.x - A.x, W.z - A.z) < 0.3) {
          A.hopT = (A.hopT ?? 0) - dt;
          if (A.hopT <= 0 && time - (A.hop0 ?? -9) > 0.5) { A.hop0 = time; A.hopDur = 0.36; A.hopH = 0.045 + rnd() * 0.02; A.hopT = 0.7 + rnd() * 0.5; }
        }
      } else {
        // she glides over: run after her, to be there as she lands
        tx = her.x + fwx * 1.1; tz = her.z + fwz * 1.1;
        ff = 1; vmax = 5; lookW = 0.8;
        tailUp = 1; pupil = 1.25;
      }
    } else if (mode === 'weave') {
      const th = Math.atan2(A.x - her.x, A.z - her.z);
      const d = wrapA(th - A.prevAng) * A.lapDir;
      A.prevAng = th;
      if (d > 0) A.lapAcc += d;
      // (pressed right up against her skirt, leaning its whole side into her as it goes
      // round, cheek first, in slow pushes)
      const R = 0.385 + 0.012 * Math.sin(time * 2.3);
      const ta = th + A.lapDir * 0.38;
      tx = her.x + Math.sin(ta) * R; tz = her.z + Math.cos(ta) * R;
      vmax = 0.5 * smoothstep(0, 0.6, A.mt) + 0.18;
      arriveK = 5;
      // head turned in to her, tail up and hooked over toward her
      look.set(her.x, A.y + 0.3, her.z); lookW = 0.85;
      tailUp = 1; swish = 0.15;
      happy = 0.6 * smoothstep(0.4, 1.2, A.mt);
      if (A.lapAcc >= A.laps * TAU) { A.mode = 'near'; A.mt = 0; A.side = camSide; A.nextLap = 5 + rnd() * 4; }
    } else if (mode === 'greet' || mode === 'lap') {
      // run circles around her: chase a point a little ahead on the circle
      const still = 1 - smoothstep(0.3, 1.2, herSp);
      const ox = her.x + fwx * 0.4 * still, oz = her.z + fwz * 0.4 * still;
      const th = Math.atan2(A.x - ox, A.z - oz);
      const d = wrapA(th - A.prevAng) * A.lapDir;
      A.prevAng = th;
      if (d > 0) A.lapAcc += d;
      const R = (mode === 'greet' ? 1.0 : 0.92) + 0.08 * Math.sin(time * 2.3);
      const ta = th + A.lapDir * 0.75;
      tx = ox + Math.sin(ta) * R; tz = oz + Math.cos(ta) * R;
      vmax = (mode === 'greet' ? 3.1 : 2.5) * smoothstep(0, 0.5, A.mt) + 0.6 + herSp;
      arriveK = 6;
      herHead(1.3); lookW = 0.6;
      tailUp = 1; swish = 0.15; pupil = 1.2;
      // little leaps of joy on the first laps
      if (mode === 'greet' && !ctx.reduced && A.mt > 0.6 && time - (A.hop0 ?? -9) > 1.0 && rnd() < dt * 1.6) {
        A.hop0 = time; A.hopDur = 0.34; A.hopH = 0.06 + rnd() * 0.03;
      }
      if (A.lapAcc >= A.laps * TAU) {
        A.mode = herSp > 0.3 ? 'follow' : 'near'; A.mt = 0; A.side = camSide;
        A.nextLap = 5 + rnd() * 4;
      }
    } else if (mode === 'near') {
      // sit at her side, looking up at her
      const side = A.side || camSide;
      const cdx = ctx.cam.x - her.x, cdz = ctx.cam.z - her.z, cdl = Math.hypot(cdx, cdz) || 1;
      const front = (cdx * fwx + cdz * fwz) / cdl < -0.2;
      if (A.nearFront === undefined || A.mt < 0.05) A.nearFront = front;
      if (A.nearFront) { tx = her.x + fwx * 1.25 + lfx * side * 0.15; tz = her.z + fwz * 1.25 + lfz * side * 0.15; }
      else { tx = her.x + lfx * side * 0.62 + fwx * 0.3; tz = her.z + lfz * side * 0.62 + fwz * 0.3; }
      faceYaw = Math.atan2(her.x - tx, her.z - tz);
      wantSit = true;
      herHead(1.32);
      tailUp = 0.9; swish = 0.15;
      vmax = 2.2;
      // (nothing new while it is busy with something)
      if (A.idle) A.nextLap = Math.max(A.nextLap, A.mt + (A.idle === 'loaf' ? 2.5 : 1.5));
      // she twirls: it runs round her the same way, as she spins
      if (ctx.twirl && !A.idle && !ctx.reduced && A.twirlSeen !== ctx.twirl.t0) {
        A.twirlSeen = ctx.twirl.t0;
        A.mode = 'lap'; A.laps = 1; A.lapDir = ctx.twirl.side; A.mt = 0; A.lapAcc = 0;
        A.prevAng = Math.atan2(A.x - her.x, A.z - her.z);
      }
      if (A.mt > A.nextLap && !ctx.reduced && !ctx.hug) {
        const r0 = rnd();
        // (seen from behind her, the tails of her sash are hard to resist - now and then)
        const cdx0 = ctx.cam.x - her.x, cdz0 = ctx.cam.z - her.z;
        const fromBack = (cdx0 * fwx + cdz0 * fwz) / (Math.hypot(cdx0, cdz0) || 1) < -0.35;
        if (fromBack && ctx.ribbon && !ctx.herFly && !A.idle && ctx.walk < 0.05 && time - (A.lastRibbon ?? -99) > 40 && rnd() < 0.5) {
          const cs = (cdx0 * lfx + cdz0 * lfz) >= 0 ? 1 : -1;
          A.rbx = { x: her.x - fwx * 0.43 + lfx * cs * 0.05, z: her.z - fwz * 0.43 + lfz * cs * 0.05, t1: 0, side: cs, n: 0 };
          A.idle = 'ribbon'; A.g0 = time; A.lastRibbon = time;
          A.nextLap = A.mt + 10 + rnd() * 3;
        } else if (r0 < 0.38 && A.sit > 0.95 && !A.idle) {
          // or stays sitting and does a little something (a stretch, a yawn, a wash)
          A.idleReq = true;
          A.nextLap = A.mt + 5 + rnd() * 2;
        } else if (r0 < 0.53 && !A.idle && ctx.walk < 0.05 && !ctx.herFly) {
          const cdx = ctx.cam.x - her.x, cdz = ctx.cam.z - her.z, cdl = Math.hypot(cdx, cdz) || 1;
          const cs = (cdx * lfx + cdz * lfz) >= 0 ? 1 : -1;
          const front = (cdx * fwx + cdz * fwz) / cdl > 0.3;
          {
            // or comes round in front of her and stands up on its hind legs, front paws on
            // her skirt, looking up at her ("up! up!")
            // (in front of her if we see her face, else at the side of her that we can see)
            let bx = front ? fwx + lfx * cs * 0.18 : lfx * cs + fwx * 0.35, bz = front ? fwz + lfz * cs * 0.18 : lfz * cs + fwz * 0.35;
            const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
            A.bg = { x: her.x + bx * 0.4, z: her.z + bz * 0.4, t1: 0 };
            A.idle = 'beg'; A.g0 = time;
            A.nextLap = A.mt + 8 + rnd() * 3;
          }
        } else if (r0 < 0.76) {
          A.mode = 'lap'; A.laps = 1 + Math.round(rnd());
          A.prevAng = Math.atan2(A.x - her.x - fwx * 0.4, A.z - her.z - fwz * 0.4);
        } else {
          // or a slow loop pressed against her skirt, rubbing its cheek on her
          A.mode = 'weave'; A.laps = 1;
          A.prevAng = Math.atan2(A.x - her.x, A.z - her.z);
        }
        if (A.mode !== 'near') {
          A.mt = 0; A.lapAcc = 0;
          A.lapDir = rnd() < 0.5 ? 1 : -1;
        }
      }
    } else if (mode === 'follow') {
      // trotting at her side, a little ahead, tail up
      const side = A.side || camSide;
      tx = her.x + lfx * side * 0.58 + fwx * 0.3 + v.hv.x * 0.12;
      tz = her.z + lfz * side * 0.58 + fwz * 0.3 + v.hv.z * 0.12;
      ff = 1;
      vmax = 2.5 + herSp * 0.6;
      tailUp = 1; swish = 0.12;
      // now and then it dashes on ahead of her along the way, sits down and waits for her,
      // watching her come; then trots on with her as she passes
      if (A.nextScout === undefined) A.nextScout = 8 + rnd() * 8;
      const hvl = Math.hypot(v.hv.x, v.hv.z);
      if (!A.scout && A.mt > A.nextScout && herSp > 0.45 && herSp < 2.2 && !ctx.reduced) {
        const ux = v.hv.x / hvl, uz = v.hv.z / hvl, cs = A.side || camSide;
        A.scout = { x: her.x + ux * 4.0 + uz * cs * 0.45, z: her.z + uz * 4.0 - ux * cs * 0.45, ux, uz, t0: time };
      }
      if (A.scout) {
        const S = A.scout;
        tx = S.x; tz = S.z; ff = 0; vmax = 4.2; arriveK = 3;
        const there = Math.hypot(A.x - S.x, A.z - S.z) < 0.25;
        if (there) { faceYaw = Math.atan2(her.x - S.x, her.z - S.z); wantSit = true; herHead(1.25); tailUp = 0.9; swish = 0.2; happy = 0.3; }
        // (she has caught up, or gone past, or stopped; or it is taking too long)
        const along = (her.x - S.x) * S.ux + (her.z - S.z) * S.uz;
        if (along > -0.7 || time - S.t0 > 9 || herSp > 2.6) { A.scout = null; A.nextScout = A.mt + 14 + rnd() * 10; A.nextLap = Math.max(A.nextLap, A.mt + 5); }
      } else {
      // mostly looking ahead, now and then up at her
      A.glanceT = (A.glanceT ?? 3) - dt;
      if (A.glanceT <= 0) { A.glance = A.glance > 0 ? 0 : 1; A.glanceT = A.glance ? 0.9 + rnd() * 0.6 : 2.5 + rnd() * 3; }
      if (A.glance) herHead(1.3); else look.set(A.x + Math.sin(A.yaw) * 3, A.y + 0.25, A.z + Math.cos(A.yaw) * 3);
      if (A.mt > A.nextLap + 6 && herSp < 2.6 && !ctx.reduced) {
        A.mode = 'lap'; A.mt = 0; A.lapAcc = 0; A.laps = 1;
        A.prevAng = Math.atan2(A.x - her.x, A.z - her.z);
        A.lapDir = -A.side * (Math.sign(wrapA(Math.atan2(v.hv.x, v.hv.z) - A.prevAng)) || 1);
      }
      }
    } else if (mode === 'flower') {
      // sitting beside her as she kneels, watching the little flower
      // (on her far side from the camera, a little forward: watching past the flower,
      // clear of her and of the flower on screen)
      // (if the camera has come round so that she hides it, it goes round to her other side)
      {
        const hx = her.x - ctx.cam.x, hz = her.z - ctx.cam.z, hl = Math.hypot(hx, hz) || 1;
        const cx2 = A.x - ctx.cam.x, cz2 = A.z - ctx.cam.z, cl2 = Math.hypot(cx2, cz2) || 1;
        const off = Math.abs(hx * cz2 - hz * cx2) / cl2;
        const hidden = cl2 > hl && off < 0.32 && (hx * cx2 + hz * cz2) > 0;
        A.hiddenT = hidden && landed && !A.sniff ? (A.hiddenT || 0) + dt : 0;
        if (A.hiddenT > 0.6 && time - (A.fsideT ?? -9) > 4 && !(ctx.burstAge >= 0 && ctx.burstAge < 1.2)) { A.fside = -(A.fside || -camSide); A.fsideT = time; A.hiddenT = 0; }
      }
      const side = A.fside || (A.fside = -camSide);
      tx = her.x + lfx * side * 0.88 + fwx * 0.42; tz = her.z + lfz * side * 0.88 + fwz * 0.42;
      faceYaw = Math.atan2(ctx.flower.x - tx, ctx.flower.z - tz);
      wantSit = true;
      look.set(ctx.flower.x, ctx.flower.y + 0.15, ctx.flower.z);
      tailUp = 0.8; swish = 0.18;
      const ba = ctx.burstAge;
      const fdx = tx - ctx.flower.x, fdz = tz - ctx.flower.z, fdl = Math.hypot(fdx, fdz) || 1;
      // curious: now and then it gets up and goes to sniff the little flower
      if (ba < 0 && !ctx.reduced) {
        A.sniffT = (A.sniffT ?? 2.5) - (A.sit > 0.9 || A.sniff ? dt : 0);
        if (!A.sniff && A.sniffT <= 0) { A.sniff = time; A.sniffT = 6 + rnd() * 4; }
      }
      if (A.sniff && (time - A.sniff > 3.4 || ba >= 0)) A.sniff = 0;
      // (and sometimes the pollen tickles: "ah - tchi!")
      if (A.sniff) {
        if (A.sneezeP === undefined) A.sneezeP = rnd() < 0.6;
        const s2 = time - A.sniff - 2.3;
        A.sneeze = A.sneezeP && s2 >= 0 && s2 < 0.7 ? s2 : -1;
        if (A.sneeze >= 0.2 && !A.sneezed) { A.sneezed = true; A.sneezeAt = time; this.puffAt(time); }
      } else { A.sneezeP = undefined; A.sneezed = false; A.sneeze = -1; }
      if (A.sniff) {
        const sx = ctx.flower.x + (fdx / fdl) * 0.36, sz = ctx.flower.z + (fdz / fdl) * 0.36;
        tx = sx; tz = sz; wantSit = false; vmax = 1.2;
        faceYaw = Math.atan2(ctx.flower.x - sx, ctx.flower.z - sz);
        look.set(ctx.flower.x, ctx.flower.y - 0.04, ctx.flower.z);
        tailUp = 0.9; swish = 0.3; earBack = -0.3;
      }
      if (ba >= 0 && ba < 3.2) {
        // the flower bursts open: up on its paws, eyes wide, watching the petals fly - and if
        // it had its nose right in it: a startled leap back, back arched, fur all puffed up
        if (ba < 0.05 && A.startleK === undefined) A.startleK = Math.hypot(A.x - ctx.flower.x, A.z - ctx.flower.z) < 1.05 ? 1 : 0.35;
        const sk = A.startleK ?? 0.35;
        startle = sk * smoothstep(0, 0.08, ba) * (1 - smoothstep(0.9, 1.5, ba));
        wantSit = ba > 2.2;
        pupil = 1.35 + 0.35 * sk;
        look.y += 0.5 + 0.9 * smoothstep(0.1, 1.2, ba);
        if (sk > 0.5 && ba < 1.0) { tx = ctx.flower.x + (fdx / fdl) * 0.75; tz = ctx.flower.z + (fdz / fdl) * 0.75; vmax = 3.5; faceYaw = Math.atan2(ctx.flower.x - tx, ctx.flower.z - tz); }
        earBack = 0.7 * startle; tailUp = 1; swish = 0.05;
        if (ba < 0.12 && !(A.burstHop > 0)) { A.burstHop = 1; A.hop0 = time; A.hopDur = sk > 0.5 ? 0.42 : 0.34; A.hopH = sk > 0.5 ? 0.11 : 0.05; }
      } else { A.burstHop = 0; if (ba < 0) A.startleK = undefined; }
      // then, as the petals come drifting down, up on its hind legs batting at them
      if (ba >= 1.75 && ba < 3.7 && !ctx.reduced) {
        const up = smoothstep(1.8, 2.05, ba) * (1 - smoothstep(3.3, 3.6, ba));
        A.petalUp = up;
        if (up > 0.02) wantSit = false;
        for (const [t0, paw] of [[2.1, 1], [2.5, 0], [2.9, 1]]) {
          const u = (ba - t0) / 0.3;
          if (u >= 0 && u <= 1) A.petalSwat = [paw, Math.sin(Math.PI * u)];
        }
        look.set(A.x + Math.sin(A.yaw) * 0.25 + Math.sin(time * 1.7) * 0.15, A.y + 0.7 - 0.25 * smoothstep(2.0, 3.3, ba), A.z + Math.cos(A.yaw) * 0.25);
        pupil = 1.55;
      } else A.petalUp = 0;
      vmax = Math.max(vmax, 2.4);
    } else if (mode === 'pet') {
      // she is calling it over to pet it: sit right in front of her, then lean into her hand
      tx = ctx.petSpot.x; tz = ctx.petSpot.z;
      faceYaw = Math.atan2(her.x - tx, her.z - tz);
      wantSit = true; vmax = 1.3;
      const pa = ctx.petAmt || 0;
      // looking up at her face, then at her hand as it comes down
      look.set(her.x + fwx * 0.35, A.y + lerp(1.2, 0.62, pa), her.z + fwz * 0.35);
      happy = smoothstep(0.35, 0.9, pa);
      earBack = 0.45 * pa;
      tailUp = 0.9; swish = 0.08;
      A.petRoll = lerp(A.petRoll || 0, 0.28 * pa * Math.sin(time * 1.3), 1 - Math.exp(-dt * 3));
      // booped on the nose: eyes squeezed shut, ears back - then a little sneeze and a shake
      if (ctx.boopT > 0) {
        const bd = time - ctx.boopT;
        if (bd > -0.05 && bd < 0.45) { A.boopEyes = 1; earBack = Math.max(earBack, 0.6); }
        if (bd > 0.4 && bd < 1.1) A.boopShake = Math.sin((bd - 0.4) * 38) * (1 - smoothstep(0.6, 1.1, bd)) * smoothstep(0.4, 0.5, bd);
      }
      // shake: eyes on her open hand as its paw goes up into it, ears forward, keen
      if (ctx.paw && ctx.paw.amt > 0.01) {
        const pk = ctx.paw.amt;
        look.set(lerp(look.x, ctx.paw.x, pk), lerp(look.y, ctx.paw.y + 0.05, pk), lerp(look.z, ctx.paw.z, pk));
        earBack *= 1 - 0.8 * pk; A.petRoll *= 1 - pk;
      }
      // cuddling up with her for a long while: curled into a loaf at her knees, eyes heavy
      if (ctx.pet === 'cuddle') { cuddle = 1; happy = Math.max(happy, 0.7); A.petRoll *= 0.5; }
    } else if (mode === 'summit') {
      // side by side, looking out at the view
      const side = A.sside || (A.sside = camSide);
      tx = her.x + lfx * side * 0.6 + fwx * 0.05; tz = her.z + lfz * side * 0.6 + fwz * 0.05;
      faceYaw = ctx.herYaw;
      wantSit = true;
      look.set(tx + fwx * 30, A.y + 4, tz + fwz * 30);
      if ((A.mt % 7) > 5.2) herHead(1.3);
      tailUp = 0.7; swish = 0.1;
      vmax = 2.4;
      // she sits down to watch the view: it comes and sits pressed against her side, leaning
      // into her under her arm, looking out with her (and up at her now and then)
      const M = ctx.summitSit;
      if (M) {
        tx = M.spot.x; tz = M.spot.z; vmax = 0.9; arriveK = 4;
        A.sside = M.side;
        if ((A.mt % 9) > 7.2) herHead(1.0);
        happy = 0.3 + 0.35 * M.arm;
        A.lean = M.arm;
      }
    } else if (mode === 'cake') {
      // sitting with her by the cake; when she wishes, watching the lanterns rise
      // seen from the front: between her and the cake, turned half toward us; seen from
      // behind: at her other side, looking where she looks
      const cs = ((ctx.cake.x - her.x) * lfx + (ctx.cake.z - her.z) * lfz) >= 0 ? 1 : -1;
      const cdx = ctx.cam.x - her.x, cdz = ctx.cam.z - her.z, cdl = Math.hypot(cdx, cdz) || 1;
      const camF = (cdx * fwx + cdz * fwz) / cdl;
      if (A.cakeFront === undefined) A.cakeFront = camF > 0;
      if (camF > 0.3) A.cakeFront = true; else if (camF < -0.3) A.cakeFront = false;
      if (A.cakeFront) {
        tx = her.x + lfx * cs * 0.4 + fwx * 0.2; tz = her.z + lfz * cs * 0.4 + fwz * 0.2;
        const toCake = Math.atan2(ctx.cake.x - tx, ctx.cake.z - tz), toCam = Math.atan2(ctx.cam.x - tx, ctx.cam.z - tz);
        faceYaw = toCam + wrapA(toCake - toCam) * 0.45;
      } else {
        tx = her.x - lfx * cs * 0.62 + fwx * 0.12; tz = her.z - lfz * cs * 0.62 + fwz * 0.12;
        faceYaw = ctx.herYaw - cs * 0.3;
      }
      wantSit = true;
      herHead(1.3);
      tailUp = 0.8; swish = 0.12;
      const wa = ctx.wishAge;
      A.blowFlinch = 0;
      if (wa >= 0) {
        // she blows out her candles: its ears flinch back at the puff, and it watches the
        // smoke curl up; then, as she closes her eyes and wishes, it gazes up at her and
        // closes its eyes too; then the lanterns
        const blow = ctx.reduced ? 0 : smoothstep(0.42, 0.55, wa) * (1 - smoothstep(0.9, 1.3, wa));
        A.blowFlinch = blow;
        if (wa < 1.0) look.set(ctx.cake.x, ctx.cake.y + 0.95, ctx.cake.z);
        else if (wa < 1.9) look.set(ctx.cake.x, ctx.cake.y + 0.95 + (wa - 1.0) * 0.7, ctx.cake.z);
        else if (wa < 4.3) herHead(1.0);
        else look.set(her.x + fwx * 6, her.y + 3 + Math.min(wa, 8) * 1.4, her.z + fwz * 6);
        earBack = Math.max(earBack, 0.6 * blow);
        const wishEyes = smoothstep(2.4, 3.0, wa) * (1 - smoothstep(3.8, 4.3, wa));
        happy = Math.max(smoothstep(9, 11, wa) * (1 - smoothstep(14, 15, wa)), 0.92 * wishEyes);
        pupil = 1.3;
      }
      vmax = 2.4;
    }
    // after her wish: it comes to her feet, stands up into her hands, and she lifts it into
    // her arms (posed and placed from her hands; see place below)
    let held = 0;
    const reunion = ctx.hug && ctx.hug.kind === 'reunion';
    const archHug = ctx.hug && ctx.hug.kind === 'arch';
    if (ctx.hug && (mode === 'cake' || reunion || archHug)) {
      const H = ctx.hug;
      // (in front of her, the way she faces now)
      const hfx = Math.sin(H.yaw), hfz = Math.cos(H.yaw);
      tx = H.her.x + hfx * 0.36; tz = H.her.z + hfz * 0.36;
      faceYaw = H.yaw + Math.PI;
      wantSit = H.d < 2.25; vmax = 2.2; arriveK = 4;
      herHead(1.2); lookW = 1; happy = 0.5; tailUp = 0.8; swish = 0.2;
      A.idle = null;
      held = H.lift;
      if (reunion) {
        // (back together: tail up and quivering, then in her arms its eyes squeeze shut,
        // gazing up at her between)
        tailUp = 1; swish = 0.1;
        happy = held > 0.5 ? 0.45 + 0.4 * smoothstep(0.5, 1, Math.sin(time * 0.7)) : 0.35;
      } else if (archHug) {
        // (she turns it round as she lifts it: held up facing out, its back to her, looking
        // out at us beside her face, now and then up at her)
        if (H.lift > 0.3) faceYaw = H.yaw;
        if (held > 0.5) {
          if (Math.sin(time * 0.4) > -0.45) look.copy(ctx.cam); else herHead(1.0);
          happy = 0.25 + 0.35 * smoothstep(0.6, 1, Math.sin(time * 0.55 + 1));
        }
      }
      // (kissed on the head: its eyes squeeze shut, ears tip back)
      if ((reunion || archHug) && H.kiss > 0.05) {
        happy = Math.max(happy, 0.95 * smoothstep(0.05, 0.4, H.kiss));
        earBack = Math.max(earBack, 0.35 * H.kiss);
      }
      if (!reunion && !archHug && held > 0.5) {
        // in her arms: looking out over her shoulder at us, then up at the lanterns
        const lw = Math.sin(time * 0.35) > -0.2;
        if (lw) look.copy(ctx.cam); else look.set(her.x + fwx * 6, her.y + 4, her.z + fwz * 6);
        happy = 0.35 + 0.3 * smoothstep(0.6, 1, Math.sin(time * 0.5));
      }
    }
    // standing up to her: walk round to just in front of her, up on its hind legs with its
    // front paws on her skirt, patting, looking up into her face; then down again
    let standUp = 0;
    if (A.idle === 'beg' || A.idle === 'peek') {
      const B = A.bg, peek = A.idle === 'peek';
      // (peeking: up on its hind legs at the stump, paws on its edge, nose toward the cake)
      const fxp = peek ? ctx.cake.x : her.x, fzp = peek ? ctx.cake.z : her.z;
      tx = B.x; tz = B.z; faceYaw = Math.atan2(fxp - B.x, fzp - B.z);
      wantSit = false; vmax = 1.5; arriveK = 4;
      if (peek) look.set(ctx.cake.x, ctx.cake.y + 0.95, ctx.cake.z); else herHead(1.25);
      lookW = 1;
      tailUp = 0.55; swish = 0.3; pupil = 1.25;
      if (!B.t1 && Math.hypot(A.x - B.x, A.z - B.z) < 0.07 && Math.abs(wrapA(A.yaw - faceYaw)) < 0.35) B.t1 = time;
      if (B.t1) {
        standUp = smoothstep(B.t1 + 0.05, B.t1 + 0.45, time) * (1 - smoothstep(B.t1 + 2.7, B.t1 + 3.1, time));
        happy = 0.35 * standUp;
        if (time > B.t1 + 3.3) { A.idle = null; A.nextLap = A.mt + 3 + rnd() * 3; }
      }
      if (time - A.g0 > 7) A.idle = null;
    }
    // playing with her sash: sitting behind her it watches the tails sway (head following
    // them, pupils wide, tail swishing), then up on its hind legs it bats at them a paw at a
    // time (they swing); down again, watching them swing; and (often) once more
    let swatL = 0, swatR = 0, box = 0;
    if (A.idle === 'ribbon') {
      const B = A.rbx;
      tx = B.x; tz = B.z; faceYaw = Math.atan2(her.x - B.x, her.z - B.z);
      vmax = 1.4; arriveK = 4;
      pupil = 1.6; tailUp = 0.45; swish = 0.55; lookW = 1;
      const e0 = ctx.ribbon[0], e1 = ctx.ribbon[1];
      look.set((e0.x + e1.x) / 2, (e0.y + e1.y) / 2, (e0.z + e1.z) / 2);
      if (!B.t1 && Math.hypot(A.x - B.x, A.z - B.z) < 0.08 && Math.abs(wrapA(A.yaw - faceYaw)) < 0.35) {
        B.t1 = time; B.first = rnd() < 0.5 ? 1 : 0; B.twice = rnd() < 0.65;
        B.sw = [1.75, 2.18, 2.62, 3.02].concat(B.twice ? [5.35, 5.8, 6.22] : []);
      }
      wantSit = true;
      if (B.t1) {
        const f = time - B.t1;
        // up on its hind legs for each bout
        const up = smoothstep(1.3, 1.6, f) * (1 - smoothstep(3.3, 3.65, f)) + (B.twice ? smoothstep(5.0, 5.3, f) * (1 - smoothstep(6.55, 6.9, f)) : 0);
        if (up > 0.02) wantSit = false;
        box = up;
        A.rbUp = up;
        standUp = Math.max(standUp, up);
        // each swat: the paw flicks up and out and hooks down (and the tail it hits swings)
        for (let i = 0; i < B.sw.length; i++) {
          const u = (f - B.sw[i]) / 0.32;
          if (u < 0 || u > 1) continue;
          const paw = (i + B.first) % 2;
          const a = Math.sin(Math.PI * u);
          if (paw === 1) swatL = Math.max(swatL, a); else swatR = Math.max(swatR, a);
          const e = paw === 1 ? e1 : e0;
          look.copy(e);
          if (u >= 0.45 && B.n <= i) { B.n = i + 1; A.swatHit = { id: (A.swatHit ? A.swatHit.id : 0) + 1, paw, time }; }
        }
        // (between bouts it sits back, watching them swing)
        if (f > (B.twice ? 7.6 : 4.8)) { A.idle = null; A.nextLap = A.mt + 3 + rnd() * 3; }
      }
      if (time - A.g0 > 12) A.idle = null;
    } else A.rbUp = 0;
    // playing: a butterfly settles by its paws — it creeps low, wiggles, pounces (and
    // misses: the butterfly flutters up and away, and it sits looking after it)
    let crouch = 0, wiggle = 0, leap = 0, pin = 0;
    this.flyButterfly(time);
    if (A.idle === 'pounce') {
      const f = time - A.g0, B = A.pb;
      faceYaw = Math.atan2(B.tx - B.sx, B.tz - B.sz);
      wantSit = f > 3.05;
      if (f < 1.7) { tx = B.sx; tz = B.sz; } else { tx = B.lx; tz = B.lz; }
      vmax = 0.8; arriveK = 4;
      look.copy(this.bfly.pos); lookW = 1;
      // (just after it lands it looks at its paws - nothing there - then up after it)
      if (f > 2.02 && f < 2.35) look.set(B.tx, A.y + 0.03, B.tz);
      pupil = 1.65; tailUp = 0.25 + 0.6 * smoothstep(2.2, 2.8, f); swish = 0.9 * (1 - smoothstep(1.6, 1.8, f));
      crouch = smoothstep(0.35, 0.9, f) * (1 - smoothstep(1.62, 1.72, f));
      wiggle = smoothstep(1.05, 1.25, f) * (1 - smoothstep(1.55, 1.65, f));
      leap = smoothstep(1.66, 1.74, f) * (1 - smoothstep(1.98, 2.08, f));
      pin = smoothstep(1.98, 2.08, f) * (1 - smoothstep(2.4, 2.75, f));
      earBack = -0.4 * crouch;
    }
    // or the butterfly hovers just over its head: it watches it, eyes wide, then up on its
    // hind legs batting at it (it bobs up out of reach), down, a crouch - and a leap
    // straight up after it, both paws high; it lands, and sits watching it flutter away
    if (A.idle === 'leap') {
      const f = time - A.g0, B = A.pb;
      tx = B.sx; tz = B.sz;
      faceYaw = Math.atan2(B.dx, B.dz);
      wantSit = f > 3.3;
      vmax = 0.7; arriveK = 4;
      look.copy(this.bfly.pos); lookW = 1;
      pupil = 1.65; tailUp = 0.35 + 0.55 * smoothstep(3.0, 3.6, f); swish = 0.7 * (1 - smoothstep(2.25, 2.45, f));
      const up = smoothstep(1.3, 1.55, f) * (1 - smoothstep(2.12, 2.3, f));
      const air = smoothstep(2.5, 2.62, f) * (1 - smoothstep(3.02, 3.12, f));
      standUp = Math.max(standUp, up, air);
      box = Math.max(box, up, air);
      const s1 = (f - 1.6) / 0.32, s2 = (f - 1.98) / 0.32;
      if (s1 >= 0 && s1 <= 1) swatL = Math.max(swatL, Math.sin(Math.PI * s1));
      if (s2 >= 0 && s2 <= 1) swatR = Math.max(swatR, Math.sin(Math.PI * s2));
      swatL = Math.max(swatL, air * 0.95); swatR = Math.max(swatR, air * 0.95);
      crouch = Math.max(crouch, smoothstep(2.28, 2.42, f) * (1 - smoothstep(2.54, 2.62, f)));
      wiggle = Math.max(wiggle, smoothstep(2.36, 2.44, f) * (1 - smoothstep(2.52, 2.58, f)));
      if (f >= 2.6 && !B.hop) { B.hop = true; A.hop0 = time; A.hopDur = 0.5; A.hopH = 0.36; }
    }
    // (batting at the falling petals after the flower bursts)
    if (mode === 'flower' && A.petalUp > 0) {
      standUp = Math.max(standUp, A.petalUp); box = Math.max(box, A.petalUp);
      if (A.petalSwat) { if (A.petalSwat[0] === 1) swatL = Math.max(swatL, A.petalSwat[1]); else swatR = Math.max(swatR, A.petalSwat[1]); }
    }
    A.petalSwat = null;
    // a butterfly on her hand: it watches it, eyes wide, tail tip twitching
    if (ctx.herFly && !A.idle && (mode === 'near' || mode === 'pet' || mode === 'summit')) {
      look.copy(ctx.herFly); lookW = 1; pupil = Math.max(pupil, 1.45); swish = Math.max(swish, 0.6);
    }
    if (ctx.night > 0) pupil *= 1 + 0.3 * ctx.night;
    // --- move ---
    let dx = tx - A.x, dz = tz - A.z;
    const dist = Math.hypot(dx, dz);
    if (A.snap || dist > 14) {
      // a jump in the story (or the first frame): just be there
      A.x = tx; A.z = tz; A.vx = ff ? v.hv.x : 0; A.vz = ff ? v.hv.z : 0;
      A.yaw = ff && herSp > 0.2 ? Math.atan2(v.hv.x, v.hv.z) : faceYaw;
      A.sit = wantSit ? 1 : 0; A.sitWait = wantSit ? 1 : 0; A.snap = false;
      dx = 0; dz = 0;
    }
    // obstacles: her skirt (her and the flower together while she kneels to it), the
    // flower, the cake. Segments [ax, az, bx, bz, r].
    const obs = this._obs || (this._obs = []);
    obs.length = 0;
    if (landed) {
      if (ctx.kneel > 0.25 && mode === 'flower') obs.push([her.x, her.z, ctx.flower.x, ctx.flower.z, 0.45]);
      else if (mode === 'pet') obs.push([her.x, her.z, her.x, her.z, 0.4]);
      else if (A.idle === 'beg' || A.idle === 'ribbon' || ctx.hug) obs.push([her.x, her.z, her.x, her.z, 0.28]);
      else if (ctx.summitSit && mode === 'summit') obs.push([her.x, her.z, her.x, her.z, 0.22]);
      else if (mode === 'weave') obs.push([her.x, her.z, her.x, her.z, 0.355]);
      else obs.push([her.x, her.z, her.x, her.z, 0.44]);
    }
    obs.push([ctx.flower.x, ctx.flower.z, ctx.flower.x, ctx.flower.z, 0.3]);
    obs.push([ctx.cake.x, ctx.cake.z, ctx.cake.x, ctx.cake.z, 0.56]);
    // (and the dog, unless she is holding it up in her arms)
    if (ctx.dog && ctx.dog.inited && ctx.dogVisible && !held) obs.push([ctx.dog.x, ctx.dog.z, ctx.dog.x, ctx.dog.z, 0.3]);
    const near = (o, px, pz, out) => {
      const sx = o[2] - o[0], sz = o[3] - o[1], sl = sx * sx + sz * sz;
      const f = sl > 1e-6 ? clamp(((px - o[0]) * sx + (pz - o[1]) * sz) / sl, 0, 1) : 0;
      out[0] = o[0] + sx * f; out[1] = o[1] + sz * f;
      return Math.hypot(px - out[0], pz - out[1]);
    };
    const cp = this.tmp;
    // a spot inside an obstacle is moved to its edge
    for (const o of obs) {
      const d = near(o, tx, tz, cp);
      if (d < o[4] + 0.04) {
        const k = d > 1e-4 ? (o[4] + 0.04) / d : 1;
        tx = cp[0] + (tx - cp[0]) * k; tz = cp[1] + (tz - cp[1]) * k;
        if (d <= 1e-4) tx += o[4] + 0.04;
      }
    }
    // (its goal, for the dog to keep clear of)
    A.tx = tx; A.tz = tz;
    dx = tx - A.x; dz = tz - A.z;
    const arrive = Math.min(vmax, Math.hypot(dx, dz) * arriveK);
    const dl = Math.hypot(dx, dz) || 1;
    let dvx = (dx / dl) * arrive + v.hv.x * ff, dvz = (dz / dl) * arrive + v.hv.z * ff;
    const dsp = Math.hypot(dvx, dvz), cap = vmax + herSp * ff;
    if (dsp > cap) { dvx *= cap / dsp; dvz *= cap / dsp; }
    // steer round obstacles: near one, heading into it, walk along its edge instead
    // (on the side nearer the goal, kept for a while so it does not dither)
    // (only when the way to the goal actually runs through it: a goal just outside its edge
    // is walked straight up to)
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
    // (no running off while sitting: it gets up first)
    const up = 1 - smoothstep(0.3, 0.8, A.sit);
    const ka = 1 - Math.exp(-dt * 7);
    A.vx += (dvx * up - A.vx) * ka; A.vz += (dvz * up - A.vz) * ka;
    A.x += A.vx * dt; A.z += A.vz * dt;
    if (A.idle === 'pounce') {
      // the leap itself: a short arc from where it crouched to just short of the butterfly
      const B = A.pb, u = (time - A.g0 - 1.7) / 0.34;
      if (u >= 0 && u <= 1) {
        const e = u * u * (3 - 2 * u);
        A.x = lerp(B.sx, B.lx, e); A.z = lerp(B.sz, B.lz, e); A.vx = 0; A.vz = 0;
        if (!B.hop) { B.hop = true; A.hop0 = time; A.hopDur = 0.34; A.hopH = 0.1; }
      }
    }
    // and never inside one
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
    // rubbing against her: how much it leans into her, and on which side of it she is
    {
      const dH = Math.hypot(A.x - her.x, A.z - her.z);
      const rubT = mode === 'weave' && !ctx.reduced && landed ? smoothstep(0.5, 0.42, dH) * smoothstep(0.2, 0.7, A.mt) : 0;
      A.rub = lerp(A.rub || 0, rubT, 1 - Math.exp(-dt * 5));
      A.rubSide = ((her.x - A.x) * Math.cos(A.yaw) - (her.z - A.z) * Math.sin(A.yaw)) >= 0 ? 1 : -1;
    }
    // --- face ---
    const moving = sp > 0.16;
    const wantYaw = moving ? Math.atan2(A.vx, A.vz) : faceYaw;
    const yawPrev = A.yaw;
    // (a sitting cat doesn't swivel round on its bottom: for more than a small turn it gets
    // up, steps round, and sits again)
    const yawErr = Math.abs(wrapA(wantYaw - A.yaw));
    if (yawErr > 0.6) A.turnUp = 1; else if (yawErr < 0.12) A.turnUp = 0;
    const yawRate = moving ? 10 : A.sit > 0.5 && !A.turnUp ? 1.5 : 3.6;
    A.yaw = approachA(A.yaw, wantYaw, 1 - Math.exp(-dt * yawRate));
    const turnRate = wrapA(A.yaw - yawPrev) / Math.max(dt, 1e-3);
    // sit down once arrived and still; get up to move
    const arrived = Math.hypot(tx - A.x, tz - A.z) < 0.12 && sp < 0.15;
    A.sitWait = arrived && wantSit ? (A.sitWait || 0) + dt : 0;
    // (up on its paws for a stretch, sitting back down at the end of it)
    const stretching = (A.idle === 'stretch' && (time - A.g0) / 3.6 < 0.84) || (A.idle === 'pounce' && time - A.g0 < 3.05) || (A.idle === 'leap' && time - A.g0 > 1.3 && time - A.g0 < 3.3);
    const sitT = A.sitWait > 0.25 && !stretching && !(A.turnUp && !A.held) ? 1 : 0;
    A.sit += (sitT - A.sit) * (1 - Math.exp(-dt * (sitT > A.sit ? 4 : 9)));
    // --- body animation ---
    const spM = sp / CAT_SCALE;
    const gK = smoothstep(0.45, 1.0, spM), bK = smoothstep(1.5, 2.4, spM);
    A.gK = lerp(A.gK, gK, 1 - Math.exp(-dt * 5)); A.bK = lerp(A.bK, bK, 1 - Math.exp(-dt * 5));
    const stride = lerp(lerp(0.085, 0.15, A.gK), 0.28, A.bK);
    // (turning on the spot takes little steps too)
    const stepSp = Math.max(spM, Math.abs(turnRate) * 0.05);
    A.phase = (A.phase + Math.min(stepSp / (2 * stride), 6) * dt) % 1;
    // hops
    let hop = 0;
    if (A.hop0 !== undefined) { const f = (time - A.hop0) / A.hopDur; if (f >= 0 && f < 1) hop = A.hopH * Math.sin(Math.PI * f); }
    // the head: toward what it watches (in its own frame), with a curious tilt now and then
    const sY = Math.sin(A.yaw), cY = Math.cos(A.yaw);
    const hx = A.x + sY * 0.17 * CAT_SCALE, hz = A.z + cY * 0.17 * CAT_SCALE, hy = A.y + 0.3 * CAT_SCALE;
    const lx = look.x - hx, ly = look.y - hy, lz = look.z - hz;
    const fz2 = lx * sY + lz * cY, fx2 = lx * cY - lz * sY;
    let yawL = Math.atan2(fx2, fz2);
    let pitchL = -Math.atan2(ly, Math.hypot(fx2, fz2));
    const tooFar = Math.abs(yawL) > 1.35;
    yawL = clamp(yawL, -1.15, 1.15) * lookW;
    pitchL = clamp(pitchL, -1.05, 0.5) * lookW;
    if (tooFar) { yawL *= 0.5; }
    const kh = 1 - Math.exp(-dt * 7);
    A.hx = lerp(A.hx, yawL, kh); A.hy = lerp(A.hy, pitchL, kh);
    const tilt = A.sit > 0.5 ? 0.22 * smoothstep(0.6, 1, Math.sin(time * 0.45 + 1.3)) : 0;
    A.hr = lerp(A.hr, tilt, 1 - Math.exp(-dt * 3));
    // blinks (slow, loving ones while sitting by her)
    A.blinkT -= dt;
    if (A.blinkT <= 0) {
      const slow = A.sit > 0.6 && rnd() < 0.45;
      A.b0 = time; A.bDur = slow ? 1.6 : 0.17; A.bMax = slow ? 0.75 : 1;
      A.blinkT = (slow ? 2.2 : 0.4) + 2 + rnd() * 3.5;
    }
    let blink = 0, slowBlink = 0;
    if (A.b0 !== undefined) {
      const f = (time - A.b0) / A.bDur;
      // (the slow, loving blink closes into soft happy arcs)
      if (f >= 0 && f < 1) { if (A.bDur > 1) slowBlink = A.bMax * smoothstep(0, 0.3, f) * (1 - smoothstep(0.7, 1, f)); else blink = Math.sin(Math.PI * f); }
    }
    // little things it does, sitting a while with nothing to watch: a wash, a yawn, or
    // up on its paws for a big stretch (front paws out, rump up, a yawn at the top of it)
    const calm = !ctx.reduced && ctx.wishAge < 0 && !ctx.hug && !(ctx.burstAge >= 0 && ctx.burstAge < 4)
      && (mode === 'near' || mode === 'summit' || mode === 'cake' || (mode === 'wait' && ex < 0.3));
    const canIdle = calm && (A.sit > 0.95 || A.idle === 'stretch' || A.idle === 'pounce' || A.idle === 'leap' || A.idle === 'beg' || A.idle === 'peek' || A.idle === 'ribbon');
    if (canIdle && !A.idle) A.groomT = (A.groomT ?? 3) - dt;
    // (sitting a long while, it settles down into a loaf)
    A.sitLong = calm && A.sit > 0.95 ? (A.sitLong || 0) + dt : 0;
    if (canIdle && (A.groomT <= 0 || A.idleReq) && !A.idle) {
      const r = rnd();
      // (by the cake it stays put: a wash or a yawn; the stump-peek reads badly from the cake
      // cameras, so it is not chosen)
      A.idle = A.sitLong > 9 && r < 0.6 ? 'loaf' : r < 0.2 ? 'groom' : r < 0.38 || mode === 'cake' ? 'yawn' : r < 0.56 ? 'stretch' : r < 0.78 || mode !== 'near' ? 'pounce' : 'flop';
      if (A.idle === 'peek') {
        // (behind the stump as we see it, a little away from her: its face peeks up over the
        // edge beside the cake)
        let dx = (ctx.cake.x - ctx.cam.x) / Math.max(1e-3, Math.hypot(ctx.cake.x - ctx.cam.x, ctx.cake.z - ctx.cam.z)) + (ctx.cake.x - her.x) * 0.6;
        let dz = (ctx.cake.z - ctx.cam.z) / Math.max(1e-3, Math.hypot(ctx.cake.x - ctx.cam.x, ctx.cake.z - ctx.cam.z)) + (ctx.cake.z - her.z) * 0.6;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        A.bg = { x: ctx.cake.x + dx * 0.6, z: ctx.cake.z + dz * 0.6, t1: 0 };
        if (Math.hypot(A.bg.x - her.x, A.bg.z - her.z) < 0.5) A.idle = 'yawn';
      }
      // (sitting under her arm at the summit it stays put: a wash or a yawn)
      if (ctx.summitSit && mode === 'summit' && A.idle !== 'groom' && A.idle !== 'yawn') A.idle = r < 0.5 ? 'groom' : 'yawn';
      // (flopping over away from her)
      if (A.idle === 'flop') A.flopSide = ((her.x - A.x) * Math.cos(A.yaw) - (her.z - A.z) * Math.sin(A.yaw)) > 0 ? 1 : -1;
      A.g0 = time; A.groomT = 7 + rnd() * 8;
      // (a pounce on it in the grass, or now and then a leap up after it in the air)
      if (A.idle === 'pounce') { if (rnd() < 0.45 && this.planLeap(her, ctx)) A.idle = 'leap'; else if (!this.planPounce(her, ctx)) A.idle = 'stretch'; }
      // (by the cake at night a firefly comes drifting by, just out of reach: up after it)
      if (mode === 'cake' && (ctx.night || 0) > 0.5 && !ctx.hug && time - (A.lastFly ?? -99) > 25 && rnd() < 0.45 && this.planLeap(her, ctx)) {
        A.idle = 'leap'; A.pb.firefly = true; A.lastFly = time;
      }
    }
    if (!calm || A.idle) A.idleReq = false;
    let groom = 0, stretch = 0, yawn = 0, loaf = 0, flop = 0;
    if (A.idle) {
      const dur = A.idle === 'groom' ? 2.8 : A.idle === 'yawn' ? 1.9 : A.idle === 'pounce' ? 4.2 : A.idle === 'leap' ? 4.6 : A.idle === 'loaf' ? 9 : A.idle === 'beg' || A.idle === 'peek' ? 7.2 : A.idle === 'flop' ? 7.5 : A.idle === 'ribbon' ? 12.5 : 3.6;
      const f = (time - A.g0) / dur;
      if (f >= 1 || !calm || (A.idle !== 'stretch' && A.idle !== 'pounce' && A.idle !== 'leap' && A.idle !== 'beg' && A.idle !== 'peek' && A.idle !== 'ribbon' && A.sit < 0.9)) A.idle = null;
      else if (A.idle === 'pounce' || A.idle === 'leap') { /* (posed from the steering above) */ }
      else if (A.idle === 'loaf') loaf = smoothstep(0, 0.12, f) * (1 - smoothstep(0.88, 1, f));
      else if (A.idle === 'beg' || A.idle === 'peek' || A.idle === 'ribbon') { /* (posed from the steering above) */ }
      else if (A.idle === 'flop') flop = smoothstep(0, 0.14, f) * (1 - smoothstep(0.85, 1, f));
      else if (A.idle === 'groom') groom = smoothstep(0, 0.18, f) * (1 - smoothstep(0.8, 1, f));
      else if (A.idle === 'yawn') yawn = smoothstep(0.05, 0.32, f) * (1 - smoothstep(0.62, 0.95, f));
      else {
        stretch = smoothstep(0.1, 0.36, f) * (1 - smoothstep(0.7, 0.88, f));
        yawn = smoothstep(0.3, 0.45, f) * (1 - smoothstep(0.6, 0.72, f));
      }
    }
    A.groom = lerp(A.groom || 0, groom, 1 - Math.exp(-dt * 10));
    A.stretch = lerp(A.stretch || 0, stretch, 1 - Math.exp(-dt * 8));
    A.yawn = lerp(A.yawn || 0, yawn, 1 - Math.exp(-dt * 12));
    A.loaf = lerp(A.loaf || 0, Math.max(loaf, cuddle), 1 - Math.exp(-dt * 3));
    A.flop = lerp(A.flop || 0, flop, 1 - Math.exp(-dt * 4));
    const grooming = A.idle === 'groom';
    // meows: on meeting her, now and then while sitting with her, in awe of the lanterns
    if (mode === 'greet' && A.mt < dt * 1.5) A.m0 = time + 0.15;
    if (mode === 'near' && A.sit > 0.9 && !A.idle) {
      A.meowT = (A.meowT ?? 4) - dt;
      if (A.meowT <= 0) { A.m0 = time; A.meowT = 6 + rnd() * 7; }
    }
    if (ctx.wishAge >= 0 && !A.wishMeow) { A.wishMeow = true; A.m0 = time + 2.2; }
    if (ctx.wishAge < 0) A.wishMeow = false;
    let meow = 0;
    if (A.m0 !== undefined) { const f = (time - A.m0) / 0.55; if (f >= 0 && f < 1) meow = Math.sin(Math.PI * Math.pow(f, 0.7)); }
    // the tail trails behind turns, springing back
    {
      const goal = clamp(-turnRate * 0.085, -0.65, 0.65);
      A.tlv = (A.tlv || 0) + ((goal - (A.tl || 0)) * 38 - (A.tlv || 0) * 6.5) * dt;
      A.tl = (A.tl || 0) + A.tlv * dt;
    }
    // and its tip flicks while it sits
    A.flickT = (A.flickT ?? 2) - dt;
    if (A.flickT <= 0) { A.fl0 = time; A.flickT = 1.8 + rnd() * 3.5; }
    const ff2 = A.fl0 !== undefined ? (time - A.fl0) / 0.45 : 9;
    const flickV = ff2 >= 0 && ff2 < 1 ? Math.sin(Math.PI * ff2) * (ff2 < 0.5 ? 1 : 0.6) : 0;
    // ear flicks
    A.earT -= dt;
    if (A.earT <= 0) { A.e0 = time; A.eSide = rnd() < 0.5 ? 0 : 1; A.earT = 1.5 + rnd() * 4; }
    const ef = A.e0 !== undefined ? (time - A.e0) / 0.28 : 9;
    const flick = ef >= 0 && ef < 1 ? Math.sin(Math.PI * ef) * 0.5 : 0;
    // --- pose ---
    P.sit = A.sit; P.phase = A.phase; P.speed = Math.max(spM, stepSp > 0.05 ? 0.05 : 0); P.gK = A.gK; P.bK = A.bK;
    P.stride = stride * Math.min(1, stepSp / 0.25 + 0.2);
    P.lift = lerp(lerp(0.022, 0.03, A.gK), 0.042, A.bK);
    P.hop = hop; P.pitch = 0; P.roll = clamp(-turnRate * sp * 0.04, -0.25, 0.25);
    // (stretching it looks straight ahead; yawning, its head tips up)
    P.headYaw = A.hx * (1 - A.yawn * 0.6) * (1 - A.stretch * 0.85);
    P.headPitch = lerp(A.hy * (1 - A.yawn) - 0.42 * A.yawn, 0.06 - 0.3 * A.yawn, A.stretch); P.headRoll = A.hr + (mode === 'pet' ? (A.petRoll || 0) : 0);
    P.tailUp = Math.max(tailUp, A.stretch); P.tailSwish = swish * (ctx.reduced ? 0.5 : 1); P.tailCurl = 1;
    P.tailLag = ctx.reduced ? 0 : A.tl; P.tailFlick = ctx.reduced ? 0 : flickV;
    P.earL = A.eSide === 0 ? flick : 0; P.earR = A.eSide === 1 ? flick : 0; P.earBack = Math.max(earBack, 0.7 * A.yawn, 0.3 * A.stretch);
    P.blink = Math.max(blink, A.yawn, A.boopEyes || 0, 0.7 * (A.blowFlinch || 0));
    if (A.boopShake) { P.headYaw += A.boopShake * 0.3; P.headRoll += A.boopShake * 0.15; P.headPitch += 0.12 * Math.abs(A.boopShake); }
    A.boopEyes = 0; A.boopShake = 0; P.happy = Math.max(happy, slowBlink, A.groom * 0.85, A.stretch * 0.9); P.pupil = pupil;
    P.groom = A.groom; P.lick = time * 10.5; P.meow = Math.max(meow, 1.6 * A.yawn);
    P.stretch = A.stretch;
    P.gazeX = clamp((yawL - A.hx) * 1.5, -1, 1); P.gazeY = clamp(-(pitchL - A.hy) * 1.5, -1, 1);
    P.crouch = crouch; P.reach = 0; P.time = time;
    P.wiggle = wiggle; P.leap = leap; P.stretch = Math.max(P.stretch, 0.8 * pin);
    A.stand = lerp(A.stand || 0, Math.max(standUp, ctx.hug && (mode === 'cake' || ctx.hug.kind === 'reunion' || ctx.hug.kind === 'arch') ? ctx.hug.stand : 0), 1 - Math.exp(-dt * 10));
    P.stand = A.stand;
    P.standHigh = A.idle === 'peek' ? 1 : 0;
    P.box = box; P.swatL = swatL; P.swatR = swatR;
    P.held = held;
    // loafing: eyes heavy, slow blinks; being petted: kneading its front paws
    A.startle = lerp(A.startle || 0, startle, 1 - Math.exp(-dt * 14));
    P.arch = A.startle;
    // (startled, its fur stands on end)
    this.shellMat.uniforms.uShellLen.value = 0.5 * (1 + 0.85 * A.startle);
    if (A.sniff) P.headPitch += Math.sin(time * 19) * 0.035 * (A.sneeze >= 0 ? 0 : 1);
    if (mode === 'flower' && A.sneeze >= 0) {
      // "ah-": nose up, eyes half shut - "tchi!": a sharp nod, eyes squeezed, ears back - and
      // a little shake of the head
      const s = A.sneeze;
      const ah = smoothstep(0, 0.17, s) * (1 - smoothstep(0.19, 0.23, s));
      const ch = smoothstep(0.18, 0.23, s) * (1 - smoothstep(0.3, 0.45, s));
      P.headPitch += -0.24 * ah + 0.42 * ch;
      P.blink = Math.max(P.blink, 0.55 * ah, ch);
      P.earBack = Math.max(P.earBack, 0.75 * ch);
      P.meow = Math.max(P.meow || 0, 0.5 * ch);
      if (s > 0.36) P.headYaw += Math.sin((s - 0.36) * 42) * 0.2 * (1 - smoothstep(0.42, 0.7, s));
    }
    P.loaf = A.loaf;
    P.flop = A.flop; P.flopSide = A.flopSide || 1;
    if (A.flop > 0.05) { P.happy = Math.max(P.happy, 0.6 * A.flop); P.headPitch *= 1 - 0.6 * A.flop; P.headYaw *= 1 - 0.6 * A.flop; }
    P.happy = Math.max(P.happy, 0.45 * A.loaf);
    // rubbing along her: its whole side leaning into her skirt, its head turned in and
    // pressing its cheek against her in slow pushes, eyes squeezed happily, tail hooked
    // over toward her
    // (under her arm, leaning into her side)
    if (mode === 'summit' && ctx.summitSit && A.sit > 0.5) {
      const ls = ((her.x - A.x) * Math.cos(A.yaw) - (her.z - A.z) * Math.sin(A.yaw)) >= 0 ? 1 : -1;
      P.roll += -ls * 0.1 * (A.lean || 0);
      P.headRoll += -ls * 0.12 * (A.lean || 0);
    } else A.lean = 0;
    P.tailHook = 0;
    if (A.rub > 0.01) {
      const r = A.rub, s = A.rubSide;
      const push = 0.5 + 0.5 * Math.sin(time * 3.6);
      P.roll += -s * 0.17 * r;
      P.headRoll += -s * (0.16 + 0.16 * push) * r;
      P.headYaw = lerp(P.headYaw, clamp(P.headYaw, -0.8, 0.8) + s * 0.1 * push, r);
      P.headPitch += (0.05 - 0.1 * push) * r;
      P.earBack = Math.max(P.earBack, 0.35 * r * push);
      P.happy = Math.max(P.happy, (0.5 + 0.4 * push) * r);
      P.tailHook = s * r;
    }
    // singing along to the birthday tune: chin up, eyes closed, mouth open on the note
    if (ctx.sing > 0.01) {
      const sg = ctx.sing;
      P.meow = Math.max(P.meow || 0, 0.95 * sg);
      P.headPitch -= 0.28 * sg;
      P.happy = Math.max(P.happy, 0.8 * sg);
      P.earBack = Math.max(P.earBack, 0.15 * sg);
    }
    // shaking hands: its paw up into her open hand (the paw on that side), looking at it
    P.pawL = 0; P.pawR = 0; P.pawShake = 0;
    if (!(mode === 'pet' && ctx.paw && ctx.paw.amt > 0.01)) A.pawSide = 0;
    else {
      // (her palm, in its own frame: the paw is placed on it, and rides her little shake)
      const pl = this.mesh.worldToLocal((this._pl || (this._pl = new THREE.Vector3())).set(ctx.paw.x, ctx.paw.y, ctx.paw.z));
      P.pawZ = pl.z; P.pawY = pl.y; P.pawX = pl.x;
      // (the paw on our side, so we see it)
      if (!A.pawSide) A.pawSide = ((ctx.cam.x - A.x) * Math.cos(A.yaw) - (ctx.cam.z - A.z) * Math.sin(A.yaw)) >= 0 ? 1 : -1;
      if (A.pawSide > 0) P.pawL = ctx.paw.amt; else P.pawR = ctx.paw.amt;
      P.pawShake = ctx.paw.shake || 0;
      P.happy = Math.max(P.happy, 0.4 * ctx.paw.amt);
    }
    // the happy tail quiver: meeting her as she lands, coming when she calls, back in her arms
    P.tailQuiver = ctx.reduced ? 0 : Math.max(
      mode === 'greet' ? 1 - smoothstep(2.5, 4, A.mt) : 0,
      mode === 'wait' && ex > 0.75 ? 1 : 0,
      mode === 'pet' && ctx.pet === 'call' ? 0.8 : 0,
      ctx.hug && ctx.hug.kind === 'reunion' && held < 0.3 ? 1 : 0);
    // breathing: slow and soft at rest, quick and deep for a while after a run (mostly hidden
    // by its gait while it moves)
    {
      const spx = sp / CAT_SCALE;
      A.exert = clamp((A.exert || 0) + (spx > 1.3 ? dt * 0.22 * spx : -dt * 0.075), 0, 1);
      const rate = lerp(0.42, 1.3, A.exert) * (A.loaf > 0.5 || mode === 'pet' ? 0.85 : 1);
      A.bph = ((A.bph || 0) + rate * dt) % 1;
      const ph = A.bph * TAU;
      P.breath = (Math.sin(ph) + 0.25 * Math.sin(2 * ph - 0.6)) * lerp(0.0028, 0.0055, A.exert) * (1 - 0.7 * Math.min(1, spx)) * (ctx.reduced ? 0.5 : 1);
    }
    // whiskers: forward when it is curious or hunting, swept back when startled, yawning or
    // booped, a little back when drowsy or blissful
    {
      let wk = smoothstep(1.25, 1.55, P.pupil / (1 + 0.3 * Math.max(0, ctx.night || 0))) * 0.85 + (A.sniff ? 0.6 : 0);
      wk -= 1.3 * A.startle + 1.0 * A.yawn + 0.35 * A.loaf + 1.1 * (A.blowFlinch || 0) + 0.3 * smoothstep(0.5, 0.9, P.happy) + (P.blink > 0.6 && !A.yawn ? 0.4 : 0);
      A.whisk = lerp(A.whisk || 0, clamp(wk, -1, 1), 1 - Math.exp(-dt * 8));
      P.whisk = ctx.reduced ? 0 : A.whisk;
    }
    P.knead = mode === 'pet' ? smoothstep(0.6, 0.95, ctx.petAmt || 0) : 0.75 * smoothstep(0.7, 1, held);
    this.pose(P);
    A.y = this.place(A.x, A.z, A.yaw);
    if (held > 0) {
      // lifted into her arms: its chest goes where her hands hold it
      const m = this.mesh;
      m.rotation.set(0, A.yaw, 0, 'YXZ');
      m.updateMatrixWorld(true);
      const cw = this.bones.chest.getWorldPosition(this._cw || (this._cw = new THREE.Vector3()));
      const H = ctx.hug;
      m.position.set(lerp(m.position.x, m.position.x + H.chest.x - cw.x, held), lerp(m.position.y, m.position.y + H.chest.y - cw.y, held), lerp(m.position.z, m.position.z + H.chest.z - cw.z, held));
    }
    this.updatePuff(time, dt);
    // the shadow lifts away with a hop
    this.shadow.material.uniforms.uOpacity.value = 0.36 * (1 - hop * 6) * (1 - held);
    const cd = Math.hypot(ctx.cam.x - A.x, ctx.cam.z - A.z);
    this.group.visible = t > 0.17 && cd < 120;
    // the fur layers only where the strands can be seen
    const fade = 1 - smoothstep(3.8, 6.5, Math.hypot(ctx.cam.x - A.x, ctx.cam.y - A.y - 0.25, ctx.cam.z - A.z));
    this.shellMat.uniforms.uShellFade.value = fade;
    this.shell.visible = fade > 0.01;
    this.active = this.group.visible && (sp > 0.25 || mode === 'greet' || mode === 'lap' || mode === 'weave' || hop > 0 || !!ctx.hug);
  }

  // a spot for the butterfly game: about 0.85 m off, across the view (so the leap is seen
  // side on), clear of her and of the flower and the cake
  planPounce(her, ctx) {
    const A = this.A;
    const cx = ctx.cam.x - A.x, cz = ctx.cam.z - A.z, cl = Math.hypot(cx, cz) || 1;
    const px = -cz / cl, pz = cx / cl;
    let best = null;
    for (const sd of [1, -1]) for (const a of [0, 0.35, -0.35, 0.7, -0.7]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = (px * ca - pz * sa) * sd, dz = (px * sa + pz * ca) * sd;
      const tx = A.x + dx * 0.85, tz = A.z + dz * 0.85;
      const dh = Math.hypot(tx - her.x, tz - her.z);
      const dm = Math.hypot(A.x + dx * 0.4 - her.x, A.z + dz * 0.4 - her.z);
      const df = Math.hypot(tx - ctx.flower.x, tz - ctx.flower.z), dc = Math.hypot(tx - ctx.cake.x, tz - ctx.cake.z);
      const dl = Math.hypot(tx - dx * 0.24 - her.x, tz - dz * 0.24 - her.z);
      if (dh < 0.85 || dl < 0.7 || dm < 0.6 || df < 0.7 || dc < 0.95 || dh > 2.6) continue;
      // (away from her rather than toward her; across the view rather than along it)
      const ah = Math.hypot(A.x - her.x, A.z - her.z) || 1;
      const score = 0.7 * (dx * (A.x - her.x) + dz * (A.z - her.z)) / ah - 0.5 * Math.abs(dx * cx + dz * cz) / cl;
      if (!best || score > best.score) best = { score, tx, tz, dx, dz };
    }
    if (!best) return false;
    A.pb = { sx: A.x, sz: A.z, tx: best.tx, tz: best.tz, lx: best.tx - best.dx * 0.24, lz: best.tz - best.dz * 0.24, dx: best.dx, dz: best.dz, hop: false };
    return true;
  }

  // a leap for it: the butterfly will hover just over its head, a little to one side of
  // it (across our view, so we see it reach up in profile)
  planLeap(her, ctx) {
    const A = this.A;
    // out to the side, away from her (and across our view, so we see it reach up in profile):
    // it steps out a little, and the butterfly hovers just over its head
    let ox = A.x - her.x, oz = A.z - her.z;
    const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    const cx = ctx.cam.x - A.x, cz = ctx.cam.z - A.z, cl = Math.hypot(cx, cz) || 1;
    const along = (ox * cx + oz * cz) / cl;
    let dx = ox - (cx / cl) * along * 0.7, dz = oz - (cz / cl) * along * 0.7;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const sx = A.x + dx * 0.2, sz = A.z + dz * 0.2, hx = sx + dx * 0.17, hz = sz + dz * 0.17;
    for (const [x, z] of [[sx, sz], [hx, hz]]) {
      if (Math.hypot(x - her.x, z - her.z) < 0.55 || Math.hypot(x - ctx.flower.x, z - ctx.flower.z) < 0.55 || Math.hypot(x - ctx.cake.x, z - ctx.cake.z) < 0.85) return false;
    }
    A.pb = { leap: true, sx, sz, hx, hz, dx, dz, hop: false, tx: hx, tz: hz };
    return true;
  }

  // the butterfly: comes fluttering down beside it, rests by the grass, gets away just in time
  // (or, for a leap, hovers just out of reach over its head, and darts up and away)
  flyButterfly(time) {
    const A = this.A, bf = this.bfly;
    if (!(A.idle === 'leap' && A.pb && A.pb.firefly)) this.fly.pts.visible = false;
    if ((A.idle !== 'pounce' && A.idle !== 'leap') || !A.pb) { bf.mesh.visible = false; return; }
    const f = time - A.g0, B = A.pb;
    if (B.leap) { this.hoverButterfly(time, f, B); return; }
    bf.mat.uniforms.uSize.value = 1;
    const gy = heightAt(B.tx, B.tz);
    const hx = B.tx, hy = gy + 0.17, hz = B.tz;
    const p = bf.pos;
    bf.prev.copy(p);
    let resting = 0;
    if (f < 1.0) {
      const e = smoothstep(0, 1, f / 1.0), w = 1 - e;
      p.set(hx + B.dx * 0.9 * w + B.dz * Math.sin(f * 9) * 0.06 * w, hy + 1.15 * w * w + Math.sin(f * 7.3) * 0.04 * w, hz + B.dz * 0.9 * w - B.dx * Math.sin(f * 9) * 0.06 * w);
    } else if (f < 1.78) {
      resting = smoothstep(1.0, 1.2, f) * (1 - smoothstep(1.7, 1.78, f));
      p.set(hx + Math.sin(f * 2.1) * 0.006, hy + Math.sin(f * 5.0) * 0.01, hz);
    } else {
      const u = f - 1.78;
      p.set(hx + B.dx * 0.75 * u + B.dz * Math.sin(u * 8) * 0.07, hy + 1.1 * (1 - Math.exp(-u * 1.8)) + 0.22 * u + Math.sin(u * 11) * 0.03, hz + B.dz * 0.75 * u - B.dx * Math.sin(u * 8) * 0.07);
    }
    const u = bf.mat.uniforms;
    const vx = p.x - bf.prev.x, vz = p.z - bf.prev.z;
    if (Math.hypot(vx, vz) > 1e-4) u.uYaw.value = Math.atan2(vx, vz);
    u.uPos.value.copy(p);
    // (wings beating in flight; slowly opening and closing at rest)
    const beat = (0.5 + 0.5 * Math.sin(time * 27)) * 1.25 + 0.08;
    const rest = 1.05 + 0.35 * Math.sin(time * 3.4);
    u.uFlap.value = lerp(beat, rest, resting);
    u.uAlpha.value = smoothstep(0, 0.15, f) * (1 - smoothstep(3.7, 4.15, f));
    bf.mesh.visible = u.uAlpha.value > 0.01;
  }

  hoverButterfly(time, f, B) {
    const bf = this.bfly, p = bf.pos;
    bf.prev.copy(p);
    const gy = heightAt(B.hx, B.hz);
    const hx = B.hx, hy = gy + 0.53, hz = B.hz;
    bf.mat.uniforms.uSize.value = 1.35;
    // (bobbing up out of reach at each swat)
    const dodge = 0.08 * (smoothstep(1.62, 1.72, f) * (1 - smoothstep(1.9, 2.1, f)) + smoothstep(2.0, 2.1, f) * (1 - smoothstep(2.3, 2.5, f)));
    let resting = 0;
    if (f < 1.0) {
      const e = smoothstep(0, 1, f), w = 1 - e;
      p.set(hx - B.dz * 0.8 * w + Math.sin(f * 9) * 0.05 * w, hy + 0.7 * w * w + Math.sin(f * 7.3) * 0.04 * w, hz + B.dx * 0.8 * w + Math.cos(f * 8) * 0.05 * w);
    } else if (f < 2.64) {
      // little loops in the air, teasing
      resting = 0.25;
      p.set(hx + Math.sin(f * 4.1) * 0.045, hy + dodge + Math.sin(f * 6.3) * 0.025, hz + Math.cos(f * 3.3) * 0.04);
    } else {
      const u = f - 2.64;
      p.set(hx + B.dx * 0.6 * u + Math.sin(u * 8) * 0.06, hy + 1.2 * (1 - Math.exp(-u * 2.4)) + 0.25 * u + Math.sin(u * 11) * 0.03, hz + B.dz * 0.6 * u + Math.cos(u * 7) * 0.06);
    }
    if (B.firefly) {
      // (a firefly: the same dance, as a soft pulsing light)
      bf.mesh.visible = false;
      const F = this.fly;
      F.pts.geometry.attributes.position.array.set([p.x, p.y, p.z]);
      F.pts.geometry.attributes.position.needsUpdate = true;
      F.mat.uniforms.uGlow.value = (0.65 + 0.35 * Math.sin(time * 5.3) * Math.sin(time * 2.1 + 1)) * smoothstep(0, 0.4, f) * (1 - smoothstep(4.0, 4.6, f));
      F.pts.visible = true;
      return;
    }
    const u = bf.mat.uniforms;
    const vx = p.x - bf.prev.x, vz = p.z - bf.prev.z;
    if (Math.hypot(vx, vz) > 1e-4) u.uYaw.value = Math.atan2(vx, vz);
    u.uPos.value.copy(p);
    const beat = (0.5 + 0.5 * Math.sin(time * 27)) * 1.25 + 0.08;
    u.uFlap.value = lerp(beat, 1.0 + 0.4 * Math.sin(time * 9), resting);
    u.uAlpha.value = smoothstep(0, 0.15, f) * (1 - smoothstep(4.2, 4.6, f));
    bf.mesh.visible = u.uAlpha.value > 0.01;
  }

  // a sneeze: the puff starts at its nose, blown forward and out
  puffAt(time) {
    const F = this.puff, A = this.A;
    const h = this.bones.head.getWorldPosition(F.o);
    const fx = Math.sin(A.yaw), fz = Math.cos(A.yaw);
    h.x += fx * 0.1 * CAT_SCALE; h.z += fz * 0.1 * CAT_SCALE; h.y -= 0.03;
    const pos = F.pts.geometry.attributes.position.array;
    const rnd = this.rnd;
    for (let i = 0; i < F.N; i++) {
      pos[i * 3] = h.x; pos[i * 3 + 1] = h.y; pos[i * 3 + 2] = h.z;
      const sp = 0.3 + rnd() * 0.5, sx = (rnd() - 0.5) * 1.3, sy = rnd() * 0.7 - 0.1;
      F.v[i * 3] = (fx + fz * sx) * sp; F.v[i * 3 + 1] = sy * sp; F.v[i * 3 + 2] = (fz - fx * sx) * sp;
    }
    F.t0 = time;
  }
  updatePuff(time, dt) {
    const F = this.puff, age = time - F.t0;
    if (age < 0 || age > 1.1) { F.pts.visible = false; return; }
    F.pts.visible = true;
    const pos = F.pts.geometry.attributes.position, a = F.pts.geometry.attributes.aA;
    const drag = Math.exp(-dt * 3.2);
    for (let i = 0; i < F.N; i++) {
      F.v[i * 3] *= drag; F.v[i * 3 + 1] = F.v[i * 3 + 1] * drag + 0.04 * dt; F.v[i * 3 + 2] *= drag;
      pos.array[i * 3] += F.v[i * 3] * dt; pos.array[i * 3 + 1] += F.v[i * 3 + 1] * dt; pos.array[i * 3 + 2] += F.v[i * 3 + 2] * dt;
      a.array[i] = 0.85 * (1 - smoothstep(0.35, 1.1, age)) * smoothstep(0, 0.05, age) * (0.6 + 0.4 * ((i * 7) % 5) / 4);
    }
    pos.needsUpdate = true; a.needsUpdate = true;
  }

  // the tip of its nose, in the world
  noseWorld(out) { return this.bones.head.localToWorld(out.copy(NOSE_C).sub(HC)); }

  // Place in the world: feet on the ground at (x, z), facing yaw, tilted with the slope
  place(x, z, yaw) {
    const y = heightAt(x, z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const L = 0.2 * CAT_SCALE;
    const hf = heightAt(x + fx * L, z + fz * L), hb = heightAt(x - fx * L, z - fz * L);
    const slope = Math.atan2(hf - hb, 2 * L);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const hl = heightAt(x + lx * 0.12, z + lz * 0.12), hr = heightAt(x - lx * 0.12, z - lz * 0.12);
    const side = Math.atan2(hl - hr, 0.24) * 0.6;
    this.mesh.position.set(x, Math.min(y, (hf + hb) / 2) + 0.004, z);
    this.mesh.rotation.set(-slope, yaw, side, 'YXZ');
    const sh = this.shadow;
    sh.position.set(x, y + 0.02, z);
    sh.rotation.set(0, yaw, 0);
    return y;
  }
}
