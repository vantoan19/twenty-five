import * as THREE from 'three';
import { mulberry32 } from './math.js';

// Tileable multi-channel noise texture used by every painterly shader.
// R: soft low-frequency fbm, G: mid fbm, B: fine fbm, A: ridged veins.
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function perlinPeriodic(P, rnd) {
  const gx = new Float32Array(P * P), gy = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) {
    const a = rnd() * Math.PI * 2;
    gx[i] = Math.cos(a); gy[i] = Math.sin(a);
  }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P;
    const X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P;
    const d = (X, Y, dx, dy) => gx[Y * P + X] * dx + gy[Y * P + X] * dy;
    const n00 = d(X0, Y0, xf, yf), n10 = d(X1, Y0, xf - 1, yf);
    const n01 = d(X0, Y1, xf, yf - 1), n11 = d(X1, Y1, xf - 1, yf - 1);
    const u = fade(xf), v = fade(yf);
    const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41421;
  };
}

export function makeNoiseData(size = 256) {
  const rnd = mulberry32(1607);
  const chans = [
    { base: 4, oct: 5, gain: 0.55 },
    { base: 8, oct: 4, gain: 0.5 },
    { base: 16, oct: 4, gain: 0.5 },
    { base: 8, oct: 4, gain: 0.5, ridged: true },
  ];
  const out = new Float32Array(size * size * 4);
  chans.forEach((c, ci) => {
    const octs = [];
    for (let o = 0; o < c.oct; o++) octs.push(perlinPeriodic(c.base << o, rnd));
    let mn = Infinity, mx = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        let s = 0, a = 1, n = 0;
        for (let o = 0; o < c.oct; o++) {
          const P = c.base << o;
          let val = octs[o](u * P, v * P);
          if (c.ridged) { val = 1 - Math.abs(val); val *= val; }
          s += val * a; n += a; a *= c.gain;
        }
        s /= n;
        out[(y * size + x) * 4 + ci] = s;
        if (s < mn) mn = s; if (s > mx) mx = s;
      }
    }
    // stretch each channel to [0, 1]
    for (let i = 0; i < size * size; i++) {
      const k = i * 4 + ci;
      out[k] = (out[k] - mn) / (mx - mn);
    }
  });
  return { size, data: out };
}

export function makeNoiseTexture(noise) {
  const { size, data } = noise;
  const bytes = new Uint8Array(size * size * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(data[i] * 255);
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// CPU bilinear sample of the same data (for effects that must agree with shaders)
export function sampleNoise(noise, u, v, ch) {
  const { size, data } = noise;
  const x = (((u % 1) + 1) % 1) * size - 0.5, y = (((v % 1) + 1) % 1) * size - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const g = (X, Y) => data[((((Y % size) + size) % size) * size + (((X % size) + size) % size)) * 4 + ch];
  const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
