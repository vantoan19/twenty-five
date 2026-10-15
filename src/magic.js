// Living details and the extra magic: string lights, sky lanterns, shooting
// stars, island waterfalls, garden butterflies, drifting petals.
import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { heightAt, FLOWER } from './world.js';
import { mulberry32, TAU, lerp } from './math.js';

const HIDE = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0;';

// Point lights that open into soft bokeh discs when out of focus (matches the
// post pipeline's circle of confusion, so the lens blur has a smooth source).
export const BOKEH_VERT = /* glsl */ `
  uniform float uEdge, uDof, uFocus, uDofMax;
  float bkEdgeR(vec2 uv) {
    vec2 c = uv - 0.5;
    float ell = length(c * vec2(1.0, 1.15)) * 1.414;
    return uEdge * smoothstep(0.8, 1.25, ell);
  }
  float bkDofR(float z) {
    float band = max(2.5, uFocus * 0.9);
    float d = z - uFocus;
    float kb = clamp((d - band) / (uFocus * 4.0 + 20.0), 0.0, 1.0);
    float kf = clamp((-d - band) / (uFocus * 0.5 + 1.0), 0.0, 1.0);
    return uDofMax * uDof * max(kb, kf);
  }
  // returns point size; writes energy scale & bokeh mix
  float bokehSize(vec4 clip, float z, float base, out float energy, out float bokeh) {
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    float coc = max(bkEdgeR(suv), bkDofR(z));
    float size = min(max(base, coc * 1.6), 110.0);
    energy = (base * base) / (size * size);
    bokeh = smoothstep(1.0, 2.2, size / max(base, 1.0));
    return size;
  }
`;
export function bokehUniforms(post) {
  const s = post.shared;
  return { uEdge: s.uEdge, uDof: s.uDof, uFocus: s.uFocus, uDofMax: s.uDofMax };
}

// ---------------------------------------------------------------------------
// Festoon lights on slim poles in an arc behind the cake (twilight clearing)
export function buildStringLights(U, centre, pathDist, toonMat, bokehU) {
  const rnd = mulberry32(909);
  const bulbs = [];
  const wire = [];
  const poles = [];
  const angles = [18, 44, 70, 96, 122, 148, 174];
  angles.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const R = 9.2 + (i % 2) * 1.3 + rnd() * 0.6;
    const x = centre.x + Math.cos(a) * R, z = centre.z + Math.sin(a) * R;
    if (pathDist(x, z) < 2.4) return;
    const h = 2.7 + rnd() * 0.35;
    poles.push({ x, z, y: heightAt(x, z), h });
  });
  const strand = (pA, pB, sagK) => {
    const L = pA.distanceTo(pB);
    const sag = sagK * L + 0.25;
    const n = Math.max(5, Math.round(L / 0.42));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const p = pA.clone().lerp(pB, u);
      p.y -= sag * 4 * u * (1 - u);
      if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
      if (k > 0 && k < n) {
        const r = rnd();
        const c = r < 0.72 ? [1.0, 0.84, 0.58] : r < 0.86 ? [1.0, 0.7, 0.6] : [1.0, 0.93, 0.78];
        bulbs.push([p.x, p.y - 0.06, p.z, c, 0.075 + rnd() * 0.03, rnd()]);
      }
    }
  };
  const top = (p) => new THREE.Vector3(p.x, p.y + p.h - 0.06, p.z);
  for (let i = 0; i < poles.length - 1; i++) strand(top(poles[i]), top(poles[i + 1]), 0.06 + rnd() * 0.03);
  // a second, deeper-sagging strand for a fuller festoon
  for (let i = 0; i < poles.length - 1; i++) {
    const a = top(poles[i]), b = top(poles[i + 1]);
    a.y -= 0.35; b.y -= 0.35;
    strand(a, b, 0.1 + rnd() * 0.03);
  }
  // poles
  const poleGeo = new THREE.CylinderGeometry(0.028, 0.04, 1, 6);
  poleGeo.translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const poleGroup = new THREE.Group();
  poles.forEach((p) => {
    const m = new THREE.Mesh(poleGeo, toonMat);
    m.position.set(p.x, p.y - 0.1, p.z);
    m.scale.y = p.h + 0.1;
    poleGroup.add(m);
    const c = new THREE.Mesh(capGeo, toonMat);
    c.position.set(p.x, p.y + p.h, p.z);
    poleGroup.add(c);
  });
  const n = bulbs.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
  bulbs.forEach(([x, y, z, c, s, sd], i) => {
    pos.set([x, y, z], i * 3); col.set(c, i * 3); size[i] = s; seed[i] = sd;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uScale: { value: 300 }, uOpacity: { value: 0 }, ...bokehU },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aSeed; attribute vec3 color;
      uniform float uScale; uniform float uTime;
      varying vec3 vCol; varying float vA; varying float vE; varying float vB;
      ${BOKEH_VERT}
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float base = clamp(aSize * uScale / max(d, 0.3), 2.0, 56.0);
        gl_PointSize = bokehSize(gl_Position, d, base, vE, vB);
        vA = (0.8 + 0.2 * sin(uTime * (0.7 + aSeed * 1.3) + aSeed * 40.0));
        vCol = color;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vCol; varying float vA; varying float vE; varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.62, 0.26, d);
        float halo = smoothstep(1.0, 0.0, d);
        vec3 bulb = vCol * (halo * halo * 1.1 + core * 4.2);
        float disc = smoothstep(1.0, 0.82, d) * (0.8 + 0.3 * smoothstep(0.5, 0.95, d));
        vec3 bok = vCol * disc * 2.6 * min(vE * 1.9, 1.0);
        gl_FragColor = vec4(mix(bulb, bok, vB) * vA * uOpacity, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 52;
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  const wireMat = new THREE.LineBasicMaterial({ color: '#2d2626', transparent: true, opacity: 0 });
  const lines = new THREE.LineSegments(wg, wireMat);
  lines.frustumCulled = false;
  const group = new THREE.Group();
  group.add(lines, points, poleGroup);
  return {
    group, mat, count: n,
    set(amt) {
      mat.uniforms.uOpacity.value = amt;
      wireMat.opacity = 0.5 * Math.min(1, amt * 1.5);
      group.visible = amt > 0.005;
    },
  };
}

// ---------------------------------------------------------------------------
// Paper lanterns released into the night sky after the wish
const LANTERN_MOTION = /* glsl */ `
  vec3 lanternPos(vec3 o, float seed, float age) {
    float ease = min(age * 0.35, 1.0);
    float rise = age * (0.5 + 0.32 * seed) + age * age * 0.0035;
    float sx = sin(age * 0.42 + seed * 31.0) * (0.35 + 0.5 * seed) * ease;
    float sz = cos(age * 0.36 + seed * 17.0) * (0.35 + 0.4 * seed) * ease;
    return o + vec3(sx + age * 0.07 * (seed - 0.5), rise, sz - age * 0.16);
  }
`;
export class SkyLanterns {
  constructor(U, count = 24, bokehU = {}) {
    this.count = count;
    const prof = [[0.001, -0.004], [0.085, -0.002], [0.125, 0.04], [0.142, 0.16], [0.136, 0.29], [0.1, 0.355], [0.001, 0.362]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const base = new THREE.LatheGeometry(prof, 14);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    this.origin = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    this.delay = new Float32Array(count);
    this.aOrigin = new THREE.InstancedBufferAttribute(this.origin, 3);
    this.aSeed = new THREE.InstancedBufferAttribute(this.seed, 1);
    this.aDelay = new THREE.InstancedBufferAttribute(this.delay, 1);
    g.setAttribute('aOrigin', this.aOrigin);
    g.setAttribute('aSeed', this.aSeed);
    g.setAttribute('aDelay', this.aDelay);
    g.instanceCount = count;
    const uniforms = { ...U, uStart: { value: -1e9 }, uScale: { value: 300 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aOrigin; attribute float aSeed; attribute float aDelay;
        uniform float uTime; uniform float uStart;
        varying vec3 vW; varying float vY; varying float vA; varying float vSeed;
        ${LANTERN_MOTION}
        void main() {
          float age = uTime - uStart - aDelay;
          vSeed = aSeed;
          if (uStart < -1e8 || age < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          vec3 c = lanternPos(aOrigin, aSeed, age);
          float yaw = age * 0.25 + aSeed * 6.283;
          vec3 p = position;
          p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
          p.x += p.y * sin(age * 0.8 + aSeed * 9.0) * 0.12;
          vec3 w = c + p * (0.95 + aSeed * 0.45);
          vW = w; vY = position.y / 0.362;
          vA = smoothstep(0.0, 1.6, age) * (1.0 - smoothstep(60.0, 85.0, age));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        varying vec3 vW; varying float vY; varying float vA; varying float vSeed;
        void main() {
          vec3 warm = mix(vec3(1.0, 0.86, 0.6), vec3(0.98, 0.5, 0.22), smoothstep(0.05, 0.95, vY));
          float flick = 0.9 + 0.1 * sin(uTime * 8.0 + vSeed * 50.0) * sin(uTime * 5.3 + vSeed * 20.0);
          vec3 col = warm * (1.05 + 1.25 * smoothstep(0.55, 0.0, vY)) * flick;
          // paper ribs
          col *= 0.9 + 0.1 * smoothstep(0.2, 0.0, abs(fract(vY * 4.0) - 0.5));
          col = applyFogK(col, vW, 0.35);
          gl_FragColor = vec4(col, vA);
        }`,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 48;
    // soft halos (same motion)
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    pg.setAttribute('aOrigin', this.aOrigin);
    pg.setAttribute('aSeed', this.aSeed);
    pg.setAttribute('aDelay', this.aDelay);
    pg.instanceCount = count;
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uStart: uniforms.uStart, uScale: uniforms.uScale, ...bokehU },
      vertexShader: /* glsl */ `
        attribute vec3 aOrigin; attribute float aSeed; attribute float aDelay;
        uniform float uTime; uniform float uStart; uniform float uScale;
        varying float vA; varying float vE; varying float vB;
        ${LANTERN_MOTION}
        ${BOKEH_VERT}
        void main() {
          float age = uTime - uStart - aDelay;
          if (uStart < -1e8 || age < 0.0) { ${HIDE} vA = 0.0; return; }
          vec3 c = lanternPos(aOrigin, aSeed, age) + vec3(0.0, 0.14, 0.0);
          vec4 mv = viewMatrix * vec4(c, 1.0);
          gl_Position = projectionMatrix * mv;
          float base = clamp(0.95 * uScale / max(-mv.z, 0.5), 2.0, 90.0);
          gl_PointSize = min(bokehSize(gl_Position, -mv.z, base, vE, vB), 80.0);
          vE = mix(1.0, vE, vB);
          vA = smoothstep(0.0, 1.6, age) * (1.0 - smoothstep(60.0, 85.0, age)) * (0.85 + 0.15 * sin(uTime * 6.0 + aSeed * 30.0));
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vE;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float h = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.3) * h * h * 0.75 * vA * vE, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Points(pg, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 49;
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.glow);
    this.group.visible = false;
    this.rnd = mulberry32(4242);
  }
  // her: position, yaw (facing); the first lantern rises from her hands
  fire(time, her, yaw, cake) {
    const r = this.rnd;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let i = 0; i < this.count; i++) {
      let x, y, z, delay;
      if (i === 0) {
        x = her.x + fx * 0.3; z = her.z + fz * 0.3; y = her.y + 1.15; delay = 0.9;
      } else if (i < 7) {
        // close by, in front of her (away from the camera behind her)
        const fwd = 2.5 + r() * 5, lat = (r() - 0.5) * 9;
        x = her.x + fx * fwd + fz * lat; z = her.z + fz * fwd - fx * lat; y = heightAt(x, z) + 0.6 + r() * 0.8; delay = 1.6 + i * 0.7 + r() * 0.8;
      } else {
        // further out across the clearing and the canyon rim, for depth
        const fwd = 8 + r() * 30, lat = (r() - 0.5) * 50;
        x = her.x + fx * fwd + fz * lat; z = her.z + fz * fwd - fx * lat; y = Math.max(heightAt(x, z), her.y - 20) + 0.8 + r() * 2.5; delay = 2.5 + r() * 12;
      }
      this.origin.set([x, y, z], i * 3);
      this.seed[i] = r();
      this.delay[i] = delay;
    }
    this.aOrigin.needsUpdate = true; this.aSeed.needsUpdate = true; this.aDelay.needsUpdate = true;
    this.mat.uniforms.uStart.value = time;
    this.group.visible = true;
  }
  reset() {
    this.mat.uniforms.uStart.value = -1e9;
    this.group.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Shooting stars streaking across the twilight sky
export class ShootingStars {
  constructor(U, n = 5) {
    this.n = n;
    const base = new THREE.PlaneGeometry(1, 1, 8, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    this.start = new Float32Array(n * 3);
    this.dir = new Float32Array(n * 3);
    this.par = new Float32Array(n * 4).fill(-100); // birth, duration, length, width
    this.aStart = new THREE.InstancedBufferAttribute(this.start, 3);
    this.aDir = new THREE.InstancedBufferAttribute(this.dir, 3);
    this.aPar = new THREE.InstancedBufferAttribute(this.par, 4);
    g.setAttribute('aStart', this.aStart);
    g.setAttribute('aDir', this.aDir);
    g.setAttribute('aPar', this.aPar);
    g.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aStart; attribute vec3 aDir; attribute vec4 aPar;
        uniform float uTime;
        varying float vU; varying float vV; varying float vA;
        void main() {
          float k = (uTime - aPar.x) / aPar.y;
          if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          float u = position.x + 0.5;
          vec3 head = aStart + aDir * aPar.z * 2.6 * k;
          vec3 p = head - aDir * aPar.z * (1.0 - u) * smoothstep(0.0, 0.25, k);
          vec3 V = normalize(cameraPosition - p);
          vec3 side = normalize(cross(aDir, V));
          p += side * position.y * aPar.w * mix(0.25, 1.0, u);
          vU = u; vV = position.y * 2.0;
          vA = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.7, 1.0, k));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vU; varying float vV; varying float vA;
        void main() {
          float core = pow(max(1.0 - abs(vV), 0.0), 2.0);
          vec3 col = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.95, 0.84), vU);
          float head = smoothstep(0.86, 1.0, vU);
          gl_FragColor = vec4(col * core * (pow(vU, 2.4) * 1.6 + head * 2.5) * vA * uOpacity, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 42;
    this.next = 0;
    this.slot = 0;
    this.rnd = mulberry32(777);
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
  }
  spawn(time, camera, delay = 0) {
    const r = this.rnd;
    const f = camera.getWorldDirection(this._f);
    const right = this._r.crossVectors(f, camera.up).normalize();
    const up = this._u.crossVectors(right, f).normalize();
    const i = this.slot; this.slot = (this.slot + 1) % this.n;
    const D = 900;
    const side = r() < 0.5 ? -1 : 1;
    const sx = (r() - 0.5) * 2 * 420, sy = 180 + r() * 260;
    const P = camera.position.clone().addScaledVector(f, D).addScaledVector(right, sx - side * 120).addScaledVector(up, sy);
    const d = right.clone().multiplyScalar(side).addScaledVector(up, -(0.35 + r() * 0.35)).addScaledVector(f, (r() - 0.5) * 0.3).normalize();
    this.start.set([P.x, P.y, P.z], i * 3);
    this.dir.set([d.x, d.y, d.z], i * 3);
    this.par.set([time + delay, 0.9 + r() * 0.6, 90 + r() * 80, 2.6 + r() * 1.4], i * 4);
    this.aStart.needsUpdate = true; this.aDir.needsUpdate = true; this.aPar.needsUpdate = true;
  }
  // automatic: occasional stars at twilight, a little shower after the wish
  update(time, camera, active, wishedAt) {
    this.mesh.visible = active;
    if (!active) { this.next = time + 3; return; }
    if (wishedAt !== null && !this.shower) {
      this.shower = true;
      this.spawn(time, camera, 1.2); this.spawn(time, camera, 2.4); this.spawn(time, camera, 3.3);
      this.next = time + 7;
    }
    if (wishedAt === null) this.shower = false;
    if (time > this.next) {
      this.spawn(time, camera, 0);
      this.next = time + (wishedAt !== null ? 3.5 + this.rnd() * 4 : 7 + this.rnd() * 7);
    }
  }
}

// ---------------------------------------------------------------------------
// Thin waterfalls spilling from the larger floating islands
export function addIslandWaterfalls(U, islands, faceZ = 1) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uOpacity;
      varying vec2 vUv; varying vec3 vW;
      void main() {
        float n1 = texture2D(uNoise, vec2(vUv.x * 1.3, vUv.y * 0.7 + uTime * 0.21)).r;
        float n2 = texture2D(uNoise, vec2(vUv.x * 2.7 + 0.31, vUv.y * 1.6 + uTime * 0.37)).g;
        float streak = smoothstep(0.38, 0.82, n1 * 0.55 + n2 * 0.55);
        float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        float top = smoothstep(1.0, 0.95, vUv.y);
        float fade = smoothstep(0.0, 0.55, vUv.y);
        float a = edge * top * fade * (0.28 + 0.72 * streak) * uOpacity;
        vec3 col = mix(vec3(0.78, 0.86, 0.92), vec3(1.0), streak) * mix(uShadowTint, uLightTint, 0.75) * 1.08;
        col = applyFogK(col, vW, 0.9);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const out = [];
  islands.list.forEach((isl, k) => {
    if (isl.R < 17) return;
    const R = isl.R;
    const H = R * 2.6;
    const geo = new THREE.PlaneGeometry(1, 1, 1, 12);
    // widen toward the bottom as the water breaks into spray
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5; // 1 top, 0 bottom
      p.setX(i, p.getX(i) * lerp(R * 0.3, R * 0.09, y));
      p.setY(i, (y - 1) * H);
      p.setZ(i, (1 - y) * (1 - y) * R * 0.25);
    }
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    const a = Math.PI * 0.5 * faceZ + (k % 2 ? 0.35 : -0.3);
    m.position.set(Math.cos(a) * R * 1.04, R * 0.02, Math.sin(a) * R * 1.04);
    m.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
    m.renderOrder = 20;
    isl.holder.add(m);
    out.push(m);
  });
  return { mat, meshes: out };
}

// ---------------------------------------------------------------------------
// Butterflies fluttering through the garden (a few find the flower once it blooms)
export function buildButterflies(U, path, wp) {
  const rnd = mulberry32(3131);
  const items = [];
  const cols = ['#9ec5f0', '#c9a5e8', '#f6c08f', '#f5df7a', '#fff6ee', '#f2a7c0', '#b9d9f5'];
  for (let i = 0; i < 40; i++) {
    const s = wp.touchdown + 2 + rnd() * (wp.trailStart - wp.touchdown + 4);
    const p = path.posAt(s); const d = path.dirAt(s);
    const off = (rnd() < 0.5 ? -1 : 1) * (1.1 + rnd() * 3.6);
    const x = p.x - d.z * off, z = p.z + d.x * off;
    items.push({ c: [x, heightAt(x, z) + 0.7 + rnd() * 0.9, z], r: 0.6 + rnd() * 1.4, col: cols[i % cols.length], flower: 0 });
  }
  // a few that keep her company along the garden path (close enough to read in the close-ups)
  for (let i = 0; i < 10; i++) {
    const s = wp.touchdown + 3 + (i / 10) * (wp.flower - wp.touchdown - 3) + rnd() * 2;
    const p = path.posAt(s); const d = path.dirAt(s);
    const off = (i % 2 ? -1 : 1) * (0.9 + rnd() * 1.1);
    const x = p.x - d.z * off, z = p.z + d.x * off;
    items.push({ c: [x, heightAt(x, z) + 1.0 + rnd() * 0.6, z], r: 0.5 + rnd() * 0.7, col: cols[(i * 3) % cols.length], flower: 0 });
  }
  for (let i = 0; i < 4; i++) {
    items.push({ c: [FLOWER.x, heightAt(FLOWER.x, FLOWER.z) + 0.95 + rnd() * 0.35, FLOWER.z], r: 0.45 + rnd() * 0.45, col: cols[(i + 2) % cols.length], flower: 1 });
  }
  const n = items.length;
  // one quad per wing: x in [-1, 1] (sign = side), z across the wing
  const base = new THREE.PlaneGeometry(2, 1, 2, 1);
  base.rotateX(-Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const ac = new Float32Array(n * 3), ap = new Float32Array(n * 4), acol = new Float32Array(n * 3);
  const col = new THREE.Color();
  items.forEach((it, i) => {
    ac.set(it.c, i * 3);
    ap.set([rnd(), it.r, it.flower, 0.85 + rnd() * 0.4], i * 4);
    col.set(it.col); acol.set([col.r, col.g, col.b], i * 3);
  });
  g.setAttribute('aCentre', new THREE.InstancedBufferAttribute(ac, 3));
  g.setAttribute('aPar', new THREE.InstancedBufferAttribute(ap, 4));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(acol, 3));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uOpacity: { value: 0 }, uFlowerOn: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aCentre; attribute vec4 aPar; attribute vec3 aCol;
      uniform float uTime; uniform float uFlowerOn;
      varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vA;
      void main() {
        float seed = aPar.x, r = aPar.y, sc = aPar.w;
        float t = uTime * (0.55 + seed * 0.4) + seed * 40.0;
        vec3 c = aCentre + vec3(sin(t) * r + sin(t * 2.3) * 0.15, sin(t * 1.9) * 0.22 + sin(t * 5.1) * 0.05, cos(t * 0.83) * r * 0.8);
        vec3 v = vec3(cos(t) * r + cos(t * 2.3) * 0.345, 0.0, -sin(t * 0.83) * r * 0.66);
        float yaw = atan(v.x, v.z);
        float flap = (0.5 + 0.5 * sin(uTime * (13.0 + seed * 6.0) + seed * 60.0)) * 1.25 + 0.08;
        vec3 p = position * vec3(0.075, 1.0, 0.068) * sc;
        float side = sign(position.x + 1e-4);
        float ax = abs(p.x);
        p = vec3(side * ax * cos(flap), ax * sin(flap), p.z);
        p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
        vec3 w = c + p;
        vW = w; vUv = uv; vCol = aCol;
        vA = mix(1.0, uFlowerOn, aPar.z);
        if (vA < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uOpacity;
      varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vA;
      void main() {
        // two rounded lobes per wing, mirrored across the body
        vec2 q = vec2(abs(vUv.x - 0.5) * 2.0, 1.0 - vUv.y);
        float fore = length((q - vec2(0.55, 0.66)) * vec2(1.0, 1.25));
        float hind = length((q - vec2(0.45, 0.3)) * vec2(1.15, 1.4));
        float shape = min(fore - 0.42, hind - 0.32);
        if (shape > 0.0 || q.x < 0.04 || vA * uOpacity < 0.01) discard;
        vec3 col = vCol;
        col = mix(col, col * 0.62, smoothstep(-0.07, 0.0, shape));
        col = mix(col, vec3(1.0), smoothstep(0.07, 0.0, length(q - vec2(0.62, 0.72))) * 0.6);
        col *= mix(uShadowTint, uLightTint, 0.8) * 1.05;
        col = applyFogK(col, vW, 0.6);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
// Blossom petals drifting through the air around the camera (garden)
export function buildPetals(U, count = 260) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uOpacity: { value: 0 }, uScale: { value: 300 }, uLight: U.uLightTint },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vA; varying float vRot; varying vec3 vTint;
      void main() {
        vec3 box = vec3(18.0, 9.0, 18.0);
        float t = uTime + aSeed * 100.0;
        vec3 p = position + vec3(sin(t * 0.7) * 1.2 + uTime * 0.35, -uTime * (0.22 + aSeed * 0.18), cos(t * 0.5) * 1.0 + uTime * 0.12);
        p = mod(p - cameraPosition + box * 0.5, box) - box * 0.5 + cameraPosition;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp((0.08 + aSeed * 0.05) * uScale / max(d, 0.4), 0.0, 34.0);
        vA = smoothstep(0.8, 2.2, d) * (1.0 - smoothstep(7.0, 9.0, d));
        vRot = t * (0.8 + aSeed) ;
        vTint = mix(vec3(0.98, 0.72, 0.8), vec3(1.0, 0.93, 0.94), fract(aSeed * 7.0));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uLight;
      varying float vA; varying float vRot; varying vec3 vTint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float cs = cos(vRot), sn = sin(vRot);
        c = mat2(cs, -sn, sn, cs) * c;
        // tumbling petal: squash one axis over time
        c.y /= 0.35 + 0.65 * abs(sin(vRot * 0.7));
        float d = length(c * vec2(1.0, 1.55));
        float a = smoothstep(0.44, 0.36, d) * vA * uOpacity;
        if (a < 0.5) discard;
        vec3 col = vTint * uLight * (0.92 + 0.12 * c.x);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const rnd = mulberry32(919);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd() - 0.5) * 18; pos[i * 3 + 1] = (rnd() - 0.5) * 9; pos[i * 3 + 2] = (rnd() - 0.5) * 18;
    seed[i] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 58;
  return { mesh: m, mat };
}
