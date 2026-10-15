import * as THREE from 'three';
import { heightAt, FLIGHT, WALK } from './world.js';
import { clamp, lerp } from './math.js';

// The character's route through all four worlds, sampled by arc length.
export class JourneyPath {
  constructor() {
    const pts = [];
    FLIGHT.forEach(([x, y, z]) => pts.push(new THREE.Vector3(x, y, z)));
    WALK.forEach(([x, z]) => pts.push(new THREE.Vector3(x, heightAt(x, z), z)));
    this.ctrl = pts;
    this.walkStart = FLIGHT.length;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const n = pts.length - 1;
    // dense parameter sampling
    const N = 12000;
    const P = [];
    const U = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const p = curve.getPoint(u);
      if (u * n >= this.walkStart - 1e-6) p.y = heightAt(p.x, p.z);
      P.push(p); U.push(u * n);
    }
    // cumulative arc length
    const S = [0];
    for (let i = 1; i <= N; i++) S.push(S[i - 1] + P[i].distanceTo(P[i - 1]));
    this.length = S[N];
    // resample uniformly by arc length
    this.step = 0.25;
    const M = Math.ceil(this.length / this.step) + 1;
    this.count = M;
    this.px = new Float32Array(M); this.py = new Float32Array(M); this.pz = new Float32Array(M);
    this.pu = new Float32Array(M);
    let j = 0;
    for (let k = 0; k < M; k++) {
      const s = Math.min(k * this.step, this.length);
      while (j < N - 1 && S[j + 1] < s) j++;
      const f = (s - S[j]) / Math.max(S[j + 1] - S[j], 1e-6);
      this.px[k] = lerp(P[j].x, P[j + 1].x, f);
      this.py[k] = lerp(P[j].y, P[j + 1].y, f);
      this.pz[k] = lerp(P[j].z, P[j + 1].z, f);
      this.pu[k] = lerp(U[j], U[j + 1], f);
    }
    // s for each control index (and fractional lookups)
    this.ctrlS = [];
    j = 0;
    for (let i = 0; i <= n; i++) {
      while (j < N - 1 && U[j + 1] < i) j++;
      const f = clamp((i - U[j]) / Math.max(U[j + 1] - U[j], 1e-6), 0, 1);
      this.ctrlS.push(lerp(S[j], S[Math.min(j + 1, N)], f));
    }
    this.walkS = this.ctrlS[this.walkStart];
  }
  sAtIndex(fi) {
    const i = Math.floor(fi), f = fi - i;
    const a = this.ctrlS[clamp(i, 0, this.ctrlS.length - 1)];
    const b = this.ctrlS[clamp(i + 1, 0, this.ctrlS.length - 1)];
    return lerp(a, b, f);
  }
  posAt(s, out = new THREE.Vector3()) {
    const k = clamp(s / this.step, 0, this.count - 1);
    const i = Math.floor(k), f = k - i, i2 = Math.min(i + 1, this.count - 1);
    return out.set(
      lerp(this.px[i], this.px[i2], f), lerp(this.py[i], this.py[i2], f), lerp(this.pz[i], this.pz[i2], f),
    );
  }
  // direction of travel (full 3D), averaged over a window for smoothness
  dirAt(s, win = 3, out = new THREE.Vector3()) {
    const a = this.posAt(Math.max(0, s - win), _a);
    const b = this.posAt(Math.min(this.length, s + win), _b);
    out.subVectors(b, a);
    if (out.lengthSq() < 1e-8) out.set(0, 0, -1);
    return out.normalize();
  }
  // horizontal heading angle (atan2(x, z)) averaged over a window
  headingAt(s, win = 8) {
    let hx = 0, hz = 0;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const ss = s - win + (2 * win * (i + 0.5)) / steps;
      const d = this.dirAt(clamp(ss, 0, this.length), 2, _c);
      const w = 1 - Math.abs((i + 0.5) / steps - 0.5);
      hx += d.x * w; hz += d.z * w;
    }
    return Math.atan2(hx, hz);
  }
  isWalking(s) { return s >= this.walkS; }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
