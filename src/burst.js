// The bloom: the moment the little flower opens, the meadow bursts into flower. Real time
// (fired once as the scroll passes the bloom, reset when scrolling back): a wave of
// growth races out from the flower (flowers spring up and open where it passes), and a
// soft puff of petals and glitter drifts up from the flower itself.
import * as THREE from 'three';
import { heightAt, normalAt, FLOWER } from './world.js';
import { mulberry32, TAU, clamp, smoothstep } from './math.js';
import { COMMON } from './shaders.js';
import { Points } from './effects.js';

// shockwave radius (m) and strength, tau seconds after the burst
export function burstRadius(tau) {
  if (tau <= 0) return 0;
  return 18 * (1 - Math.exp(-tau * 2.6)) + 30 * (1 - Math.exp(-tau / 3.0));
}
export function burstAmount(tau, R) {
  if (tau <= 0) return 0;
  // (the golden band fades once the flowers have spread across the valley, so it is not
  // left circling far below when she looks back from the trail)
  return (0.5 + 0.8 * Math.exp(-tau * 1.1)) * smoothstep(0, 0.05, tau) * (1 - smoothstep(4, 9, tau)) * (1 - smoothstep(38, 47, R));
}
function radiusInverse(r) {
  let lo = 0, hi = 40;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (burstRadius(m) < r) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// petals: one small quad each, shaped and shaded in the fragment shader; their whole
// flight (thrown out, slowed by the air, fluttering down, resting on the ground) is a
// function of time, so nothing is simulated on the CPU
function petalMaterial(U, loop = false) {
  return new THREE.ShaderMaterial({
    defines: loop ? { LOOP: 1 } : {},
    uniforms: { ...U, uTau: { value: -1 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTau; uniform float uOpacity;
      attribute vec3 aP0; attribute vec3 aV0; attribute vec4 aRot; attribute vec3 aCol; attribute vec4 aMisc; attribute vec3 aGround;
      varying vec2 vUv; varying vec3 vCol; varying float vA; varying vec3 vN; varying vec3 vW;
      mat3 rotAxis(vec3 a, float t) {
        float c = cos(t), s = sin(t), ic = 1.0 - c;
        return mat3(c + a.x * a.x * ic, a.y * a.x * ic + a.z * s, a.z * a.x * ic - a.y * s,
                    a.x * a.y * ic - a.z * s, c + a.y * a.y * ic, a.z * a.y * ic + a.x * s,
                    a.x * a.z * ic + a.y * s, a.y * a.z * ic - a.x * s, c + a.z * a.z * ic);
      }
      void main() {
        #ifdef LOOP
          // falling again and again, each petal on its own cycle
          float age = mod(uTau - aMisc.y, aMisc.z);
        #else
          float age = uTau - aMisc.y;
        #endif
        vUv = uv; vCol = aCol;
        if (age <= 0.0 || age > aMisc.z) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
        // linear air drag: fast out, then a slow fall at a gentle terminal speed
        float k = 1.8;
        vec3 g = vec3(0.0, -1.35, 0.0);
        float e = exp(-k * age);
        vec3 p = aP0 + aV0 * (1.0 - e) / k + g / k * (age - (1.0 - e) / k);
        // fluttering loops as they fall
        float fl = 1.0 - e;
        float sd = aMisc.w;
        p.x += sin(age * (1.6 + sd * 1.4) + sd * 40.0) * 0.32 * fl;
        p.z += cos(age * (1.2 + sd * 1.1) + sd * 23.0) * 0.32 * fl;
        p.y += sin(age * (2.3 + sd) + sd * 9.0) * 0.06 * fl;
        // resting on the ground
        float gy = aGround.x + aGround.y * (p.x - aP0.x) + aGround.z * (p.z - aP0.z) + 0.015;
        float landed = smoothstep(gy + 0.04, gy, p.y);
        p.y = max(p.y, gy);
        float ang = aRot.w * min(age, 3.0 + sd * 2.0) + sd * 6.2831;
        mat3 R = rotAxis(normalize(aRot.xyz), ang);
        float sz = aMisc.x * (1.0 - smoothstep(0.82, 1.0, age / aMisc.z) * 0.8) * smoothstep(0.0, 0.08, age) * uOpacity;
        vec3 lp = vec3(position.x, 0.0, position.y) * sz;
        lp.y += position.x * position.x * sz * 0.5; // a softly cupped petal
        vec3 off = R * lp;
        // once down, they lie flat-ish on the grass
        off = mix(off, vec3(off.x, off.y * 0.15, off.z), landed);
        vec3 wp = p + off;
        vN = normalize(R * vec3(0.0, 1.0, 0.0));
        vW = wp;
        vA = 1.0 - smoothstep(0.88, 1.0, age / aMisc.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uOpacity;
      varying vec2 vUv; varying vec3 vCol; varying float vA; varying vec3 vN; varying vec3 vW;
      void main() {
        // a rounded petal with a soft point at its base
        vec2 q = vUv - vec2(0.5, 0.5);
        float w = mix(0.18, 0.5, smoothstep(-0.5, 0.15, q.y)) * (1.0 - smoothstep(0.25, 0.5, q.y) * 0.35);
        float inside = step(abs(q.x), w * sqrt(max(0.0, 1.0 - pow(q.y / 0.5, 2.0))));
        if (inside < 0.5 || vA < 0.02) discard;
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSunDir);
        float l = smoothstep(-0.4, 0.6, ndl);
        // deeper toward the base, pale at the tip, a fine centre vein
        vec3 base = mix(vCol * 0.82, mix(vCol, vec3(1.0), 0.28), smoothstep(-0.5, 0.45, q.y));
        base *= 1.0 - 0.08 * smoothstep(0.04, 0.0, abs(q.x)) * smoothstep(-0.4, 0.2, q.y);
        vec3 col = base * mix(uShadowTint * 0.8, uLightTint * 1.08, l);
        // light through the petal when the sun is behind it
        float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
        col += base * uSunCol * back * 0.5;
        col += base * uAmb * 0.12;
        col = applyFogK(col, vW, 0.8);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}

const PETAL_COLS = ['#ff9cc0', '#ff86b0', '#ffb3cf', '#f78fb8', '#fff0f5', '#d9a6ff', '#c49af5', '#ffd76e', '#ffc94f', '#9fc8ff', '#ffffff', '#ffab8f', '#ff9aa0', '#ffc2dd'];

export class BloomBurst {
  constructor(U, { quality = 'high', head } = {}) {
    const lo = quality === 'low';
    this.U = U;
    this.head = head.clone();
    this.group = new THREE.Group();
    this.fired = false;
    this.t0 = 0;
    this.tau = -1;
    // --- petals: a soft puff lifting off the opening flower ---
    const rnd = mulberry32(4242);
    const N = lo ? 160 : 380;
    const P0 = new Float32Array(N * 3), V0 = new Float32Array(N * 3), ROT = new Float32Array(N * 4), COL = new Float32Array(N * 3), MISC = new Float32Array(N * 4), GR = new Float32Array(N * 3);
    // the ground around the flower as a plane (petals rest on it)
    let sy = 0, sxx = 0, szz = 0, sxy = 0, szy = 0, n = 0;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const dx = i * 1.6, dz = j * 1.6, y = heightAt(FLOWER.x + dx, FLOWER.z + dz);
      sy += y; sxx += dx * dx; szz += dz * dz; sxy += dx * y; szy += dz * y; n++;
    }
    // least squares (the grid is symmetric, so the cross terms vanish)
    const pb = sxy / sxx, pc = szy / szz, pa = sy / n;
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // petals lift off the opening flower and drift away on the air
      const a = rnd() * TAU, el = (0.3 + rnd() * 0.18) * Math.PI;
      const sp = 0.7 + Math.pow(rnd(), 0.8) * 2.2;
      const x = this.head.x + (rnd() - 0.5) * 0.1, y = this.head.y + (rnd() - 0.5) * 0.06, z = this.head.z + (rnd() - 0.5) * 0.1;
      const vx = Math.cos(a) * Math.cos(el) * sp, vy = Math.sin(el) * sp + 0.9, vz = Math.sin(a) * Math.cos(el) * sp;
      const birth = rnd() * 1.2, life = 7 + rnd() * 6, size = 0.045 + rnd() * 0.04;
      const gy = pa + pb * (x - FLOWER.x) + pc * (z - FLOWER.z), gsx = pb, gsz = pc;
      P0.set([x, y, z], i * 3);
      V0.set([vx, vy, vz], i * 3);
      const ax = rnd() - 0.5, ay = rnd() - 0.5, az = rnd() - 0.5;
      ROT.set([ax, ay + 0.2, az, (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 6)], i * 4);
      col.set(PETAL_COLS[Math.floor(rnd() * PETAL_COLS.length)]);
      COL.set([col.r, col.g, col.b], i * 3);
      MISC.set([size, birth, life, rnd()], i * 4);
      GR.set([gy, gsx, gsz], i * 3);
    }
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    g.setAttribute('aP0', new THREE.InstancedBufferAttribute(P0, 3));
    g.setAttribute('aV0', new THREE.InstancedBufferAttribute(V0, 3));
    g.setAttribute('aRot', new THREE.InstancedBufferAttribute(ROT, 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(COL, 3));
    g.setAttribute('aMisc', new THREE.InstancedBufferAttribute(MISC, 4));
    g.setAttribute('aGround', new THREE.InstancedBufferAttribute(GR, 3));
    g.instanceCount = N;
    this.petalMat = petalMaterial(U);
    this.petals = new THREE.Mesh(g, this.petalMat);
    this.petals.frustumCulled = false;
    this.petals.visible = false;
    this.group.add(this.petals);

    // --- a little glitter rising with them ---
    this.sparks = new Points(U, lo ? 90 : 200, { goldMix: 0.85, gravity: [0, 0.05, 0], wobble: 0.35, twinkle: 0.85, seed: 777, drag: 1.2 });
    const r2 = this.sparks.rnd;
    for (let i = 0; i < this.sparks.count; i++) {
      const a = r2() * TAU, el = (0.3 + r2() * 0.18) * Math.PI;
      const sp = 0.4 + r2() * 1.0;
      this.sparks.emit(this.head.x, this.head.y, this.head.z,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 0.5, Math.sin(a) * Math.cos(el) * sp,
        r2() * 2.4, 2.5 + r2() * 3, 0.025 + r2() * 0.035);
    }
    this.sparks.dirty();
    this.sparks.mesh.visible = false;
    this.group.add(this.sparks.mesh);
    this.pointMats = [this.sparks.mat];
    // what the rest of the scene reads each frame
    this.state = { R: 0, A: 0, flash: 0, kick: 0, tau: -1, sat: 0, bloom: 0 };
  }

  fire(time) { this.fired = true; this.t0 = time; }
  reset() { this.fired = false; this.tau = -1; }

  update(time, camera, reduced) {
    const st = this.state;
    if (!this.fired) {
      st.R = 0; st.A = 0; st.flash = 0; st.kick = 0; st.tau = -1; st.sat = 0; st.bloom = 0;
      this.group.children.forEach((c) => { c.visible = false; });
      return st;
    }
    const tau = time - this.t0;
    this.tau = tau;
    st.tau = tau;
    st.R = burstRadius(tau);
    st.A = burstAmount(tau, st.R);
    // no flash, no shake: the flowers are the show
    st.flash = 0; st.bloom = 0; st.sat = 0; st.kick = 0;
    this.petals.visible = tau < 14;
    this.petalMat.uniforms.uTau.value = tau;
    this.sparks.mesh.visible = tau < 7;
    this.sparks.mat.uniforms.uClock.value = tau;
    return st;
  }
}

// petals drifting down from the blossom trees, endlessly (looping, real time)
export class TreePetals {
  constructor(U, trees, quality = 'high') {
    const per = quality === 'low' ? 14 : 34;
    const rnd = mulberry32(5151);
    const N = trees.length * per;
    const P0 = new Float32Array(N * 3), V0 = new Float32Array(N * 3), ROT = new Float32Array(N * 4), COL = new Float32Array(N * 3), MISC = new Float32Array(N * 4), GR = new Float32Array(N * 3);
    const col = new THREE.Color();
    const cols = ['#f7b9cd', '#fbd3df', '#ffffff', '#f3a6c1', '#fde6ee'];
    let i = 0;
    for (const tr of trees) {
      const gy = heightAt(tr.x, tr.z);
      for (let k = 0; k < per; k++, i++) {
        // released from the crown's surface, drifting off on the breeze
        const a = rnd() * TAU, r = tr.s * (0.15 + rnd() * 0.3);
        const x = tr.x + Math.cos(a) * r, z = tr.z + Math.sin(a) * r;
        const y = tr.y + tr.s * (0.45 + rnd() * 0.35);
        P0.set([x, y, z], i * 3);
        V0.set([0.5 + rnd() * 0.9, -0.2 + rnd() * 0.4, 0.2 + rnd() * 0.6], i * 3);
        ROT.set([rnd() - 0.5, rnd() - 0.5 + 0.3, rnd() - 0.5, (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 4)], i * 4);
        col.set(cols[Math.floor(rnd() * cols.length)]);
        COL.set([col.r, col.g, col.b], i * 3);
        const fall = (y - gy) / 0.75;
        MISC.set([0.05 + rnd() * 0.035, rnd() * 20, fall + 2.5 + rnd() * 3, rnd()], i * 4);
        GR.set([heightAt(x + 2, z + 1), 0, 0], i * 3);
      }
    }
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    g.setAttribute('aP0', new THREE.InstancedBufferAttribute(P0, 3));
    g.setAttribute('aV0', new THREE.InstancedBufferAttribute(V0, 3));
    g.setAttribute('aRot', new THREE.InstancedBufferAttribute(ROT, 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(COL, 3));
    g.setAttribute('aMisc', new THREE.InstancedBufferAttribute(MISC, 4));
    g.setAttribute('aGround', new THREE.InstancedBufferAttribute(GR, 3));
    g.instanceCount = N;
    this.mat = petalMaterial(U, true);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }
  update(time, on) {
    this.mesh.visible = on > 0.01;
    this.mat.uniforms.uTau.value = time;
    this.mat.uniforms.uOpacity.value = on;
  }
}
