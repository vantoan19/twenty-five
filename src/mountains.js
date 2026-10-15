// Alpine mountains: heightfield massifs with sharp summits, curved aretes,
// sagging cirque faces, radial couloirs and jagged crests, painted with snow,
// rock and alpine meadow by height, slope and hollowness.
import * as THREE from 'three';
import { makeSimplex, makeSimplex3, mulberry32, TAU, clamp, smoothstep, lerp, ridged } from './math.js';
import { COMMON, TERRAIN_PALETTE, SEA_SURFACE_GLSL } from './shaders.js';
import { heightAt, CLOUD_BASE, CLOUD_TOP } from './world.js';

const sJ = makeSimplex(71);
const sK = makeSimplex(83);
const n3 = makeSimplex3(5);
const s01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }
function smax(a, b, k) { return -smin(-a, -b, k); }

// ---------------------------------------------------------------------------
// Where the mountains stand. [x, z, apexY, radius, seed, satellites]
// World 1: peaks piercing the sea of clouds (bases hidden in the cloud layer)
export const SEA_PEAKS = [
  // left of the flight
  [-300, 250, 430, 200, 3, 2],
  [-345, 10, 480, 230, 2, 2],
  [-300, -235, 440, 210, 7, 2],
  [-590, 200, 460, 260, 9, 2],
  [-620, -110, 500, 280, 16, 2],
  // right of the flight
  [300, 175, 450, 210, 4, 2],
  [430, -70, 510, 240, 6, 2],
  [400, -300, 430, 210, 8, 2],
  [600, 110, 480, 270, 17, 2],
  [640, -200, 520, 290, 12, 2],
  // small spikes through the clouds, for depth
  [-185, -150, 244, 70, 23, 1],
  [160, 330, 248, 70, 24, 1],
  // behind the start
  [-140, 700, 470, 260, 13, 2],
  [220, 760, 500, 280, 14, 2],
];
// World 2: snowy peaks standing over the valley and the garden
export const VALLEY_PEAKS = [
  [-318, -470, 372, 220, 18, 2],
  [300, -520, 352, 210, 19, 2],
  [-290, -716, 410, 240, 20, 2],
  [296, -786, 452, 250, 21, 3],
  [-470, -616, 430, 270, 22, 2],
  [490, -650, 466, 290, 23, 2],
  [-740, -1120, 420, 300, 35, 2],
  [760, -1180, 450, 320, 36, 2],
];
// Worlds 3-4: the great range closing the canyon
export const FAR_PEAKS = [
  [-560, -1560, 430, 280, 24, 2],
  [-300, -1640, 520, 320, 25, 2],
  [-60, -1720, 600, 350, 26, 3],
  [190, -1620, 450, 290, 27, 2],
  [420, -1680, 560, 340, 28, 2],
  [660, -1580, 440, 290, 29, 2],
  [-820, -1520, 500, 330, 30, 2],
  [880, -1640, 520, 340, 31, 2],
  [-260, -1940, 680, 380, 32, 2],
  [320, -1980, 640, 380, 33, 2],
  [60, -2180, 900, 470, 34, 3],
];

// ---------------------------------------------------------------------------
// Height model
function makePeak(rnd, x, z, H, R, seed, phi) {
  const n = 3 + Math.floor(rnd() * 3);
  const str = [];
  for (let k = 0; k < n; k++) str.push(0.45 + rnd() * 0.55);
  return {
    x, z, H, R, n, str,
    phi: phi ?? rnd() * TAU,
    curve: (rnd() - 0.5) * 1.3,
    rot: rnd() * TAU,
    ax: 1 + rnd() * 0.3,
    sag: 0.22 + rnd() * 0.16,
    pw: 1.12 + rnd() * 0.22,
    gully: 0.07 + rnd() * 0.04,
    seed: seed * 7.13 + rnd() * 10,
  };
}

function peakField(P, x, z) {
  const dx = x - P.x, dz = z - P.z;
  const c = Math.cos(P.rot), s = Math.sin(P.rot);
  const u = (dx * c + dz * s) / P.ax, v = -dx * s + dz * c;
  const d = Math.hypot(u, v) / P.R;
  if (d >= 1.2) return 0;
  const th = Math.atan2(v, u);
  // aretes: curved crest lines leaving the summit; faces between them sag like cirques
  const f = ((th + P.curve * d - P.phi) * P.n) / TAU;
  const k = Math.round(f);
  const a = Math.abs(f - k) * 2;
  const sk = P.str[((k % P.n) + P.n) % P.n];
  const reach = 1 + 0.2 * sk * (1 - s01(a * 1.5));
  const dd = d / reach;
  if (dd >= 1) return 0;
  const bell = Math.pow(Math.sin(Math.PI * Math.min(dd, 1)), 0.75);
  let h = Math.pow(1 - dd, P.pw) * (1 - s01(a) * P.sag * bell * (1.2 - sk * 0.4));
  // couloirs and spurs running down every face (radially stretched ridged noise)
  const ct = Math.cos(th), st = Math.sin(th);
  let g1 = 1 - Math.abs(n3(ct * 3.1 + P.seed, st * 3.1, dd * 1.6 + P.seed * 0.37));
  let g2 = 1 - Math.abs(n3(ct * 7.3 - P.seed, st * 7.3, dd * 3.3 + 11.0));
  g1 *= g1; g2 *= g2;
  const g = g1 * 0.62 + g2 * 0.38;
  const gb = smoothstep(0.03, 0.24, dd) * (1 - smoothstep(0.7, 1.0, dd));
  h += (g - 0.5) * P.gully * gb;
  return h * P.H;
}

function makeMassif(def, baseFn, scale = 1) {
  const [x, z, apex, R0, seed, sats] = def;
  const rnd = mulberry32(seed * 97 + 3);
  const base = baseFn(x, z, R0 * 1.25);
  const H = apex - base;
  const R = Math.max(R0, H * 0.6) * scale;
  const main = makePeak(rnd, x, z, H, R, seed);
  const peaks = [main];
  for (let i = 0; i < sats; i++) {
    // satellites sit on the main aretes, as sub-summits and shoulders
    const k = Math.floor(rnd() * main.n);
    const dd = 0.32 + rnd() * 0.3;
    const a = main.phi + (k / main.n) * TAU - main.curve * dd + (rnd() - 0.5) * 0.25;
    const ar = (Math.cos(a) * main.ax), az = Math.sin(a);
    // undo the main peak's rotation to place it in world space
    const cr = Math.cos(main.rot), sr = Math.sin(main.rot);
    const lx = ar * dd * R, lz = az * dd * R;
    const wx = x + lx * cr - lz * sr, wz = z + lx * sr + lz * cr;
    const hh = H * (1 - dd) * (0.95 + rnd() * 0.3);
    peaks.push(makePeak(rnd, wx, wz, hh * 0.98 + H * 0.06, R * (0.42 + rnd() * 0.18), seed * 3 + i));
  }
  let half = 0;
  peaks.forEach((p) => { half = Math.max(half, Math.abs(p.x - x) + p.R * 1.25 * p.ax, Math.abs(p.z - z) + p.R * 1.25 * p.ax); });
  return { x, z, base, H, peaks, half, seed, k: H * 0.05 };
}

export function massifHeight(M, x, z) {
  let h = 0;
  for (const P of M.peaks) {
    const v = peakField(P, x, z);
    if (v > 0) h = smax(h, v, M.k);
  }
  if (h <= 0) return M.base;
  // jagged crests and rock steps, strongest high up
  const rel = h / M.H;
  const rr = ridged(sJ, x * 0.019 + M.seed * 1.7, z * 0.019, 4);
  const fine = sK(x * 0.07, z * 0.07);
  h += (rr - 0.42) * M.H * 0.06 * Math.sqrt(rel) + fine * 1.6 * rel;
  return M.base + Math.max(0, h);
}

// ---------------------------------------------------------------------------
// Mesh: per-massif grid; quads that never rise from the base (or that stay
// hidden under the cloud layer) are skipped. Carries a hollowness attribute.
function massifGeometry(M, N, { allowed = null, hideBelow = -1e9 } = {}) {
  const half = M.half, n1 = N + 1;
  const step = (2 * half) / N;
  const x0 = M.x - half, z0 = M.z - half;
  const H = new Float32Array(n1 * n1);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      let h = massifHeight(M, x, z);
      if (allowed) {
        const al = allowed(x, z);
        if (al < h + 30) h = smin(h, al, 16);
      }
      H[j * n1 + i] = Math.max(h, M.base);
    }
  }
  const at = (i, j) => H[clamp(j, 0, N) * n1 + clamp(i, 0, N)];
  const pos = new Float32Array(n1 * n1 * 3), nor = new Float32Array(n1 * n1 * 3), cav = new Float32Array(n1 * n1);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * n1 + i, h = H[k];
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z0 + j * step;
      let nx = -(at(i + 1, j) - at(i - 1, j)) / (2 * step), nz = -(at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const l = Math.hypot(nx, 1, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nz / l;
      // hollowness: how far the point sits below its neighbours (couloirs > 0, crests < 0)
      const c1 = ((at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) * 0.25 - h) / step;
      const c3 = ((at(i + 3, j) + at(i - 3, j) + at(i, j + 3) + at(i, j - 3)) * 0.25 - h) / (3 * step);
      cav[k] = clamp((c1 * 0.4 + c3 * 0.6) * 2.6, -1, 1);
    }
  }
  const idx = [];
  const lim = M.base + 0.05;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      const mx = Math.max(H[a], H[b], H[c], H[d]);
      if (mx <= lim || mx < hideBelow) continue;
      if (Math.abs(H[b] - H[c]) < Math.abs(H[a] - H[d])) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aCav', new THREE.BufferAttribute(cav, 1));
  g.setIndex(idx);
  return g;
}

function mergeMountainGeos(geos) {
  let nv = 0, ni = 0;
  geos.forEach((g) => { nv += g.attributes.position.count; ni += g.index.count; });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cav = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  geos.forEach((g) => {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    cav.set(g.attributes.aCav.array, vo);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aCav', new THREE.BufferAttribute(cav, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// Ceiling that keeps every peak clear of the camera and of her flight
function clearanceField(points, { x0 = -1000, x1 = 1000, z0 = -2400, z1 = 900, cell = 12, reach = 260, drop = 18, flat = 22, slope = 1.05 } = {}) {
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const F = new Float32Array(nx * nz).fill(1e9);
  const rc = Math.ceil(reach / cell);
  for (const [px, py, pz] of points) {
    const ci = Math.round((px - x0) / cell), cj = Math.round((pz - z0) / cell);
    for (let j = Math.max(0, cj - rc); j <= Math.min(nz - 1, cj + rc); j++) {
      for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
        const d = Math.hypot(x - px, z - pz);
        const al = py - drop + Math.max(0, d - flat) * slope;
        const k = j * nx + i;
        if (al < F[k]) F[k] = al;
      }
    }
  }
  return (x, z) => {
    const fx = clamp((x - x0) / cell, 0, nx - 1.001), fz = clamp((z - z0) / cell, 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i], d = F[(j + 1) * nx + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

// ---------------------------------------------------------------------------
// The two peaks she circles in World 1 - first the one on the left, then the one on the
// right - and the long ridge running down from the second into the valley, which she
// follows down. Steep horns standing out of the sea of clouds; built finer than the other
// peaks and drawn in both layers (the camera passes close to them).
export const HERO = {
  L: { x: -60, z: 160, top: 345, r: 112, seed: 41, n: 4 },
  R: { x: 85, z: -30, top: 340, r: 112, seed: 42, n: 3 },
  // the ridge's crest line: [x, z, crest] - from the second peak's north shoulder away
  // toward the valley, a high wall she skims along, then its steep nose
  ridge: [
    [70, -80, 270], [60, -130, 262], [52, -180, 254], [47, -230, 244], [44, -272, 228], [45, -312, 192],
    [48, -350, 148], [52, -386, 104], [56, -416, 58], [58, -440, 18], [60, -460, -15],
  ],
};
const HERO_BASE = CLOUD_BASE - 26;
function heroPeak(D) {
  const rnd = mulberry32(D.seed * 131 + 7);
  const H = D.top - HERO_BASE;
  const P = makePeak(rnd, D.x, D.z, H, D.r, D.seed);
  // (horns: concave flanks sweeping up to a sharp summit, a few strong aretes)
  P.n = D.n; P.str = P.str.slice(0, D.n).concat([0.9, 0.8, 0.7]).slice(0, D.n);
  P.pw = 1.45; P.sag = 0.18;
  return { P, H, seed: D.seed };
}
const HP = [heroPeak(HERO.L), heroPeak(HERO.R)];
function heroPeakHeight(Q, x, z) {
  const v = peakField(Q.P, x, z);
  if (v <= 0) return -1e9;
  const rel = v / Q.H;
  const rr = ridged(sJ, x * 0.021 + Q.seed * 1.7, z * 0.021, 4);
  return HERO_BASE + v + (rr - 0.42) * Q.H * 0.05 * Math.sqrt(rel) + sK(x * 0.07, z * 0.07) * 1.4 * rel;
}
// the ridge: a rounded crest, its flanks steepening as they fall away, scored by gullies.
// (The crest line is a smooth curve through the points, sampled finely; each spot takes
// the crest height of the nearest sample.)
const RIDGE = (() => {
  const R = HERO.ridge, out = [];
  const P = [R[0].map((v, k) => 2 * v - R[1][k]), ...R, R[R.length - 1].map((v, k) => 2 * v - R[R.length - 2][k])];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2));
    for (let k = 0; k < n; k++) {
      const u = k / n, u2 = u * u, u3 = u2 * u;
      out.push([0, 1, 2].map((c) => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3)));
    }
  }
  out.push(R[R.length - 1]);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of out) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { S: out, box: [x0 - 190, x1 + 190, z0 - 190, z1 + 190] };
})();
function ridgeHeight(x, z) {
  const { S, box } = RIDGE;
  if (x < box[0] || x > box[1] || z < box[2] || z > box[3]) return -1e9;
  let bd = 1e18, bh = 0;
  for (let i = 0; i < S.length; i++) {
    const dx = x - S[i][0], dz = z - S[i][1], d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; bh = S[i][2]; }
  }
  const d = Math.sqrt(bd);
  if (d > 190) return -1e9;
  const g = ridged(sK, x * 0.017 + 3.3, z * 0.017 - 1.1, 3);
  return bh - (0.3 * d + 0.0075 * d * d) + ((g - 0.45) * 9 + sJ(x * 0.05, z * 0.05) * 1.6) * smoothstep(6, 36, d);
}
// height of the hero peaks and ridge (-1e9 where there is none)
export function heroHeight(x, z) {
  let h = -1e9;
  for (const Q of HP) h = Math.max(h, heroPeakHeight(Q, x, z));
  const r = ridgeHeight(x, z);
  if (r > -1e8) h = h > -1e8 ? smax(h, r, 14) : r;
  return h;
}
// a grid over a rectangle; quads wholly below the ground or hidden in the sea of clouds
// are left out. Carries the hollowness the alpine shader paints with.
function heroGeometry(x0, x1, z0, z1, step, allowed) {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const H = new Float32Array(nx * nz), G = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    let h = heroHeight(x, z);
    const g = heightAt(x, z);
    if (h > -1e8 && allowed) { const al = allowed(x, z); if (al < h + 30) h = smin(h, al, 12); }
    G[j * nx + i] = g;
    H[j * nx + i] = Math.max(h, g - 6);
  }
  const at = (i, j) => H[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)];
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), cav = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, h = H[k];
    pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z0 + j * step;
    const ex = -(at(i + 1, j) - at(i - 1, j)) / (2 * step), ez = -(at(i, j + 1) - at(i, j - 1)) / (2 * step);
    const l = Math.hypot(ex, 1, ez);
    nor[k * 3] = ex / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = ez / l;
    const c1 = ((at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) * 0.25 - h) / step;
    const c3 = ((at(i + 3, j) + at(i - 3, j) + at(i, j + 3) + at(i, j - 3)) * 0.25 - h) / (3 * step);
    cav[k] = clamp((c1 * 0.4 + c3 * 0.6) * 2.6, -1, 1);
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // (under the ground, or deep in the sea of clouds, nothing to draw)
    const above = H[a] > G[a] + 0.2 || H[b] > G[b] + 0.2 || H[c] > G[c] + 0.2 || H[d] > G[d] + 0.2;
    if (!above) continue;
    const zc = z0 + (j + 0.5) * step;
    if (zc > -230 && Math.max(H[a], H[b], H[c], H[d]) < CLOUD_BASE - 10) continue;
    if (Math.abs(H[b] - H[c]) < Math.abs(H[a] - H[d])) idx.push(a, c, b, b, c, d);
    else idx.push(a, c, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aCav', new THREE.BufferAttribute(cav, 1));
  geo.setIndex(idx);
  return geo;
}

// ---------------------------------------------------------------------------
export function alpineMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uSnowL: { value: new THREE.Color('#f1f3f5') },
    uSnowM: { value: new THREE.Color('#d0d9e8') },
    uSnowS: { value: new THREE.Color('#a2b1cf') },
    // (mossy, green-grey stone rather than slate blue)
    uRockL: { value: new THREE.Color('#a9b28a') },
    uRockM: { value: new THREE.Color('#5f7a66') },
    uRockD: { value: new THREE.Color('#2f4a44') },
    // (fresh, lively greens: spring green in the sun, a deep but clear green in shade)
    uG1: { value: new THREE.Color('#2d6239') },
    uG2: { value: new THREE.Color('#438640') },
    uG3: { value: new THREE.Color('#5f9e49') },
    uG4: { value: new THREE.Color('#7fb552') },
    uG5: { value: new THREE.Color('#a0c86a') },
    uF0: { value: new THREE.Color('#22492f') },
    uF1: { value: new THREE.Color('#2f6538') },
    uF2: { value: new THREE.Color('#57903f') },
    uSnowLine: { value: new THREE.Vector2(...(opts.snowLine ?? [235, 275])) },
    uTreeLine: { value: new THREE.Vector2(...(opts.treeLine ?? [165, 215])) },
    uAmbAdd: { value: opts.ambAdd ?? 0.05 },
    // the two lower peaks she swoops round, snow-capped all the same: (x, z, summit, radius)
    uHeroA: { value: new THREE.Vector4(...(opts.heroes?.[0] ?? [0, 0, -1e4, 1])) },
    uHeroB: { value: new THREE.Vector4(...(opts.heroes?.[1] ?? [0, 0, -1e4, 1])) },
    // the sea of clouds' surface (shared with the sea once it is built), so the peaks melt into
    // the cloud exactly where it laps against them
    uZCut: { value: new THREE.Vector2(-9000, -8900) },
    uHole: { value: new THREE.Vector4(0, -640, -2000, 320) },
    uCeil: { value: null },
    uCeilRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSeaBase: { value: CLOUD_BASE + 4 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aCav;
      varying vec3 vW; varying vec3 vN; varying float vCav;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vCav = aCav;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uSnowL, uSnowM, uSnowS, uRockL, uRockM, uRockD, uG1, uG2, uG3, uG4, uG5, uF0, uF1, uF2;
      uniform vec2 uSnowLine, uTreeLine; uniform float uAmbAdd; uniform vec4 uHeroA, uHeroB;
      uniform vec2 uZCut; uniform vec4 uHole; uniform sampler2D uCeil; uniform vec4 uCeilRect; uniform float uSeaBase;
      varying vec3 vW; varying vec3 vN; varying float vCav;
      ${SEA_SURFACE_GLSL}
      void main() {
        vec3 N = normalize(vN);
        vec3 P = vW;
        float slope = clamp(1.0 - N.y, 0.0, 1.0);
        vec2 q = P.xz;
        vec2 dh = normalize(N.xz + vec2(1e-4));
        // (on steep faces the painting is mapped across and up the face rather than through
        // a squashed plan view: cliffs keep their texture instead of smearing into streaks)
        float sface = smoothstep(0.45, 0.85, slope);
        vec2 qf = mix(q, vec2(dot(q, vec2(-dh.y, dh.x)), P.y), sface);
        vec4 nA = texSmooth(uNoise, qf * 0.0021);
        vec4 nB = texSmooth(uNoise, qf * 0.0085 + 0.37);
        vec4 nC = texture2D(uNoise, qf * 0.029 + 0.71);
        // up close (flying past a summit) the rock and snow break into ledges, layers and
        // cracks; far off this is all below a pixel and skipped
        float near = 1.0 - smoothstep(110.0, 300.0, length(cameraPosition - P));
        vec4 nD = vec4(0.5);
        float layers = 0.5;
        if (near > 0.001) {
          nD = texture2D(uNoise, qf * 0.09 + 0.13);
          layers = texture2D(uNoise, vec2(dot(q, vec2(-dh.y, dh.x)) * 0.012, P.y * 0.16 + nD.r * 0.6)).g;
        }
        // brush strokes that follow the fall line
        // (on the steepest walls, where the fall line is all height, the strokes are shorter:
        // no long smears running the whole height of a face)
        vec2 sq = vec2(dot(q, vec2(-dh.y, dh.x)) * 0.075, dot(q, dh) * 0.011 + P.y * mix(0.004, 0.015, sface));
        float stroke = texture2D(uNoise, sq).g;
        float cav = vCav + (stroke - 0.5) * 0.35;

        float ndl = dot(N, uSunDir);
        float L = ndl * 0.64 + 0.42 + (nA.r - 0.5) * 0.2 + (nB.g - 0.5) * 0.12 + (stroke - 0.5) * 0.14;
        float e = (nC.r - 0.5) * 0.08;

        // zones: snow holds on gentle ground and in hollows, rock shows on crests and walls
        // World 1 (above the cloud sea) is higher country: lower snow, no meadows
        float wz = smoothstep(-260.0, -460.0, P.z);
        float sl = mix(uSnowLine.x, uSnowLine.y, wz) + (nA.g - 0.5) * 70.0 + (stroke - 0.5) * 26.0;
        {
          // (a snow cap some fifty metres deep on each of the two peaks she swoops round)
          float ka = 1.0 - smoothstep(uHeroA.w * 0.45, uHeroA.w * 1.05, length(P.xz - uHeroA.xy));
          float kb = 1.0 - smoothstep(uHeroB.w * 0.45, uHeroB.w * 1.05, length(P.xz - uHeroB.xy));
          float jit = (nA.g - 0.5) * 30.0 + (stroke - 0.5) * 14.0;
          sl = mix(sl, uHeroA.z - 40.0 + jit, ka);
          sl = mix(sl, uHeroB.z - 40.0 + jit, kb);
        }
        float above = smoothstep(sl - 8.0, sl + 14.0, P.y);
        // wind-scoured crests are bare, couloirs and shelves fill, walls keep only streaks
        float steep = smoothstep(0.44, 0.68, slope + (nB.b - 0.5) * 0.12);
        float crest = smoothstep(-0.06, -0.32, vCav);
        float gully = smoothstep(0.06, 0.34, vCav + (stroke - 0.5) * 0.2);
        float streaks = smoothstep(0.5, 0.62, stroke + (nB.g - 0.5) * 0.35);
        float hold = mix(1.0, streaks * 0.9, steep);
        hold = max(hold, gully) * (1.0 - crest * 0.9);
        // (and in World 1, high on the great peaks, it plasters even the steep faces: white
        // summits ribbed with dark rock)
        hold = max(hold, smoothstep(sl - 10.0, sl + 40.0, P.y) * (0.55 + 0.3 * streaks) * (1.0 - crest * 0.25) * (1.0 - wz));
        float snow = smoothstep(0.36, 0.64, above * hold);
        // tongues of snow running down the couloirs below the line
        // (soft-edged and fainter up close, where the mesh's hollows would show as hard,
        // stepped shapes)
        // (short and soft: long white stripes down every gully made the peaks look busy and harsh)
        float tongueK = mix(0.35, 0.7, smoothstep(60.0, 260.0, length(cameraPosition - P)));
        snow = max(snow, smoothstep(sl - 70.0, sl - 5.0, P.y) * smoothstep(0.3, 0.7, gully * smoothstep(0.92, 0.62, slope)) * tongueK);
        // green country: alpine meadows on the shoulders, forest in the hollows and on the
        // mid slopes, rock only on sharp crests and sheer walls
        float tl = mix(uTreeLine.x, uTreeLine.y, wz) + (nA.b - 0.5) * 80.0 + (nB.g - 0.5) * 30.0;
        float vegH = 1.0 - smoothstep(tl - 30.0, tl + 12.0, P.y);
        // (green holds on all but the sheerest walls and sharpest crests: lush mountains)
        // (sheer faces break up: green ledges and runnels cut across them)
        float wall = smoothstep(0.86, 1.0, slope + (nB.r - 0.5) * 0.3 - cav * 0.25 - (stroke - 0.5) * 0.22 - (nC.g - 0.5) * 0.12);
        // (bare, knife-edged crests belong to the high peaks; lower ridges stay grassy)
        float sharp = smoothstep(-0.4, -0.7, vCav) * smoothstep(tl - 230.0, tl - 50.0, P.y);
        float veg = vegH * (1.0 - wall) * (1.0 - sharp * 0.7);
        veg = smoothstep(0.35, 0.65, veg + (stroke - 0.5) * 0.3);
        veg *= 1.0 - snow;
        float forest = smoothstep(0.18, 0.42, slope + vCav * 0.45 + (nB.g - 0.5) * 0.4) * smoothstep(tl + 5.0, tl - 70.0, P.y);
        // canopy: clumped crowns with dark gaps (object-scale noise, fades into tone far away)
        float crown = 0.5;
        if (forest * veg > 0.01) {
          float cr1 = texture2D(uNoise, P.xz * 0.034 + vec2(P.y * 0.021, 0.0)).b;
          float cr2 = texture2D(uNoise, vec2(P.x + P.z * 0.6, P.y * 1.4) * 0.05 + 0.3).b;
          crown = cr1 * 0.6 + cr2 * 0.4;
        }

        // painted value bands
        vec3 rock = mix(uRockD, uRockM, smoothstep(0.29 + e, 0.39 + e, L));
        rock = mix(rock, uRockL, smoothstep(0.59 + e, 0.69 + e, L));
        rock *= 0.86 + stroke * 0.28;
        rock *= 1.0 - smoothstep(0.15, 0.7, vCav) * 0.3;
        {
          float crack = smoothstep(0.62, 0.8, nD.b) * sface;
          float ledge = smoothstep(0.55, 0.75, layers);
          rock *= mix(1.0, (0.82 + 0.36 * nD.r) * (1.0 - 0.38 * crack) * (1.0 + 0.2 * ledge * sface), near);
        }
        // (snow in shadow stays a pale lilac - lit by the sky - rather than sinking toward the
        // blue of the sky itself, most of all close by)
        vec3 sn = mix(uSnowS, uSnowM, smoothstep(mix(0.33, 0.18, near) + e, 0.43 + e, L));
        sn *= mix(1.0, 0.95 + 0.07 * nD.g, near);
        sn = mix(sn, uSnowL, smoothstep(0.58 + e, 0.68 + e, L));
        sn *= 0.97 + nC.g * 0.05;
        // meadow: four painted greens from shade to sunlit lime
        vec3 gr = mix(uG1, uG2, smoothstep(0.29 + e, 0.4 + e, L));
        gr = mix(gr, uG3, smoothstep(0.45 + e, 0.56 + e, L));
        gr = mix(gr, uG4, smoothstep(0.61 + e, 0.72 + e, L));
        gr = mix(gr, uG5, smoothstep(0.78 + e, 0.86 + e, L) * 0.8);
        gr *= 0.93 + nC.b * 0.14;
        // forest: deep blue-greens, crowns catching light
        float Lf = L + (crown - 0.5) * 0.55;
        vec3 fo = mix(uF0, uF1, smoothstep(0.34 + e, 0.44 + e, Lf));
        fo = mix(fo, uF2, smoothstep(0.6 + e, 0.7 + e, Lf));
        gr = mix(gr, fo, forest * 0.92);
        // (and what rock shows is mossy: green in its hollows and on its ledges)
        float moss = smoothstep(0.3, 0.75, (1.0 - slope) * 0.7 + max(vCav, 0.0) * 1.5 + (nB.b - 0.5) * 0.5 + smoothstep(0.5, 0.8, nC.g) * 0.45) * vegH;
        rock = mix(rock, gr * 0.85, moss * 0.55);
        vec3 col = mix(rock, gr, veg);
        col = mix(col, sn, snow);

        float lit = smoothstep(0.3, 0.66, L);
        col *= mix(uShadowTint, uLightTint, lit);
        col += uAmb * uAmbAdd * (1.0 - lit * 0.5);
        // where the peaks rise out of the sea of clouds, they melt into a soft band of mist
        // (no hard line where the cloud tops meet the rock)
        // (only where the sea is: not down in the open valley beyond its edge)
        // (a smooth band just above the cloud's own surface, as the sea is there - deep where it
        // heaps up, thin where it parts: no fixed line, no marbling)
        float mb = 0.0;
        if (P.y < uSeaBase + 96.0 && P.z > -2200.0 && P.y > uSeaBase - 40.0) {
          float st = uSeaBase + seaH(P.xz, uSeaBase);
          // (and seen from beneath the deck, the slopes fade up into its base: no line below)
          mb = (1.0 - smoothstep(st - 2.0, st + 30.0, P.y)) * smoothstep(uSeaBase - 40.0, uSeaBase - 6.0, P.y) * smoothstep(-0.05, 0.6, seaFade(P.xz, 0.0));
          mb = mb * mb * (3.0 - 2.0 * mb);
        }
        // (the mist the colour of the sea where it meets it - bright on the sunny side, the
        // sea's pale blue in shade - so the cloud tops lap against the rock without a seam)
        vec3 mcol = mix(vec3(0.76, 0.81, 0.92), vec3(0.98, 0.97, 0.94), max(smoothstep(-0.3, 0.6, ndl), smoothstep(176.0, 204.0, P.y)));
        col = mix(col, mcol * uLightTint, mb * 0.96);
        // (less of the blue-grey haze on the mountains: their greens stay fresh with distance)
        col = applyFogK(col, P, 0.74);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// clearPts: [[x, y, z], ...] camera and flight positions the peaks must clear
export function buildMountains(U, quality, clearPts) {
  const lo = quality === 'low';
  const allowed = clearanceField(clearPts);
  const minGround = (x, z, r) => {
    let m = 1e9;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) m = Math.min(m, heightAt(x + (i / 3) * r, z + (j / 3) * r));
    return m - 30;
  };
  const group = new THREE.Group();
  const mat = alpineMaterial(U, { snowLine: [430, 470], treeLine: [400, 440], heroes: [[HERO.L.x, HERO.L.z, HERO.L.top, 80], [HERO.R.x, HERO.R.z, HERO.R.top, 84]] });
  const build = (list, baseFn, N, hideBelow, scale) => {
    const ms = list.map((d) => makeMassif(d, baseFn, scale));
    const geo = mergeMountainGeos(ms.map((M, i) => massifGeometry(M, Math.round(N * (list[i][6] || 1)), { allowed, hideBelow: hideBelow(M) })));
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    return { mesh, massifs: ms };
  };
  // (they are seen from 56 m and more, the far wall from 400 m and more, and drawn in the
  // half-resolution far layer: coarser grids lose nothing)
  const k = lo ? 0.52 : 0.9;
  const sea = build(SEA_PEAKS, () => CLOUD_BASE - 26, Math.round(150 * k), (M) => (M.z > -250 ? CLOUD_BASE - 12 : -1e9), 1);
  const valley = build(VALLEY_PEAKS, minGround, Math.round(116 * (lo ? 0.62 : 1)), () => -1e9, 1);
  const far = build(FAR_PEAKS, minGround, Math.round(72 * k), () => -1e9, 1);
  // height of the World 1 peaks (for the clouds that hug them)
  const seaHeight = (x, z) => {
    let h = -1e9;
    for (const M of sea.massifs) if (Math.abs(x - M.x) < M.half && Math.abs(z - M.z) < M.half) h = Math.max(h, massifHeight(M, x, z));
    return h;
  };
  // the peaks she circles and the ridge she follows down: a steeper ceiling (they may rise
  // close beside her, never into her way)
  const heroAllowed = clearanceField(clearPts, { x0: -340, x1: 360, z0: -560, z1: 600, cell: 4, reach: 90, drop: 12, flat: 10, slope: 2.4 });
  const hs = lo ? 3.6 : 2.6;
  const hero = new THREE.Mesh(mergeMountainGeos([heroGeometry(-235, 255, -440, 315, hs, heroAllowed)]), mat);
  hero.geometry.computeBoundingBox();
  group.add(hero);
  // (and of the peaks standing over the valley: the clouds hanging in it keep clear of them)
  const valleyHeight = (x, z) => {
    let h = -1e9;
    for (const M of valley.massifs) if (Math.abs(x - M.x) < M.half && Math.abs(z - M.z) < M.half) { const v = massifHeight(M, x, z); if (v > M.base + 0.5) h = Math.max(h, v); }
    return h;
  };
  return { group, mat, sea: sea.mesh, valley: valley.mesh, far: far.mesh, hero, seaMassifs: sea.massifs, valleyMassifs: valley.massifs, seaHeight, valleyHeight };
}
