// Small math + noise toolkit shared by the whole journey.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const remap = (x, a, b, c, d) => c + (d - c) * clamp((x - a) / (b - a), 0, 1);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const fract = (x) => x - Math.floor(x);
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D simplex noise (Gustavson), returns [-1, 1]
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
];
export function makeSimplex(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2);
  };
}

// 3D simplex noise (Gustavson), returns about [-1, 1]
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
export function makeSimplex3(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const F3 = 1 / 3, Gc = 1 / 6;
  return function (x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * Gc;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + Gc, y1 = y0 - j1 + Gc, z1 = z0 - k1 + Gc;
    const x2 = x0 - i2 + 2 * Gc, y2 = y0 - j2 + 2 * Gc, z2 = z0 - k2 + 2 * Gc;
    const x3 = x0 - 1 + 3 * Gc, y3 = y0 - 1 + 3 * Gc, z3 = z0 - 1 + 3 * Gc;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = G3[pm12[ii + perm[jj + perm[kk]]]]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = G3[pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = G3[pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = G3[pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]]; t3 *= t3; n += t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
    return 32 * n;
  };
}

export function fbm(noise, x, y, oct = 4, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

// ridged multifractal in [0, 1]
export function ridged(noise, x, y, oct = 5) {
  let a = 0.5, f = 1, s = 0, w = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(noise(x * f, y * f));
    v *= v;
    v *= w;
    w = clamp(v * 1.6, 0, 1);
    s += v * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// ---------------------------------------------------------------------------
// Keyframe tracks over the scroll timeline (t in [0, 1]).
// Scalars use smooth (cosine-free) hermite easing between keys; vector tracks
// use Catmull-Rom so the camera glides through keys without stopping.

export class Track {
  // keys: [[t, v0, v1, ...], ...] sorted by t
  constructor(keys, { smooth = true } = {}) {
    this.keys = keys;
    this.dim = keys[0].length - 1;
    this.smooth = smooth;
    this.out = new Array(this.dim).fill(0);
  }
  _seg(t) {
    const k = this.keys;
    if (t <= k[0][0]) return -1;
    if (t >= k[k.length - 1][0]) return k.length - 1;
    let lo = 0, hi = k.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (k[m][0] <= t) lo = m; else hi = m;
    }
    return lo;
  }
  // Catmull-Rom with non-uniform key spacing (finite-difference tangents).
  sample(t) {
    const k = this.keys, out = this.out, d = this.dim;
    const i = this._seg(t);
    if (i < 0) { for (let j = 0; j < d; j++) out[j] = k[0][j + 1]; return out; }
    if (i >= k.length - 1) { for (let j = 0; j < d; j++) out[j] = k[k.length - 1][j + 1]; return out; }
    const a = k[i], b = k[i + 1];
    const p = k[Math.max(0, i - 1)], n = k[Math.min(k.length - 1, i + 2)];
    const h = b[0] - a[0];
    let u = (t - a[0]) / h;
    if (!this.smooth) {
      u = u * u * (3 - 2 * u);
      for (let j = 0; j < d; j++) out[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * u;
      return out;
    }
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let j = 0; j < d; j++) {
      const va = a[j + 1], vb = b[j + 1];
      // tangents scaled to this segment's duration; damped to avoid overshoot
      const ma = i > 0 ? ((vb - p[j + 1]) / (b[0] - p[0])) * h : vb - va;
      const mb = i + 2 < k.length ? ((n[j + 1] - va) / (n[0] - a[0])) * h : vb - va;
      // limit tangents (monotone-ish) so slow holds stay still
      const lim = Math.abs(vb - va) * 2.2 + 1e-9;
      const ta = clamp(ma, -lim, lim) * 0.85, tb = clamp(mb, -lim, lim) * 0.85;
      out[j] = h00 * va + h10 * ta + h01 * vb + h11 * tb;
    }
    return out;
  }
  get(t, j = 0) { return this.sample(t)[j]; }
}

// Linear-ish scalar with eased segments; handy for effect switches.
export function keyed(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      const u = smoothstep(a[0], b[0], t);
      return a[1] + (b[1] - a[1]) * u;
    }
  }
  return keys[keys.length - 1][1];
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
