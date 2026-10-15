import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ribbonMaterial, pointsMaterial, glowMaterial, toonMaterial, foliageMaterial } from './shaders.js';
import { heightAt, FLOWER, CAKE, PASSION_STARS, STAR_ARC, CLEARING } from './world.js';
import { mulberry32, TAU, lerp, clamp, smoothstep } from './math.js';
import { sampleNoise } from './noisetex.js';
import { wingPoint, WING_SPAN, contactShadow } from './character.js';
import { BOKEH_VERT } from './magic.js';

// ---------------------------------------------------------------------------
// Ribbon geometry from centre points
function ribbonGeometry(points, sVals, widths) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3), tan = new Float32Array(n * 2 * 3);
  const side = new Float32Array(n * 2), sArr = new Float32Array(n * 2), wArr = new Float32Array(n * 2);
  const t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, n - 1)];
    t.subVectors(b, a).normalize();
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      pos[j * 3] = points[i].x; pos[j * 3 + 1] = points[i].y; pos[j * 3 + 2] = points[i].z;
      tan[j * 3] = t.x; tan[j * 3 + 1] = t.y; tan[j * 3 + 2] = t.z;
      side[j] = k === 0 ? -1 : 1;
      sArr[j] = sVals[i];
      wArr[j] = widths ? widths[i] : 1;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aTangent', new THREE.BufferAttribute(tan, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aS', new THREE.BufferAttribute(sArr, 1));
  g.setAttribute('aW', new THREE.BufferAttribute(wArr, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildTrail(U, path, sEnd) {
  const pts = [], sv = [], wv = [];
  const walkS = path.walkS;
  for (let s = 0; s <= sEnd; s += 0.5) {
    const p = path.posAt(s);
    const w = smoothstep(walkS - 18, walkS + 4, s);
    p.y += w * (0.55 + 0.12 * Math.sin(s * 0.33));
    pts.push(p); sv.push(s); wv.push(lerp(1, 0.5, w));
  }
  const mat = ribbonMaterial(U, { width: 0.16, tail: 90, floor: 0.1, minPix: 0.0011, near: [5, 28] });
  const mesh = new THREE.Mesh(ribbonGeometry(pts, sv, wv), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
// GPU point systems
export class Points {
  constructor(U, count, opts = {}) {
    this.count = count;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.birth = new Float32Array(count).fill(-1e6);
    this.life = new Float32Array(count).fill(1);
    this.size = new Float32Array(count).fill(1);
    this.seed = new Float32Array(count);
    const rnd = mulberry32(opts.seed || 3);
    for (let i = 0; i < count; i++) this.seed[i] = rnd();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    g.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.geo = g;
    this.mat = pointsMaterial(U, opts);
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 50;
    this.cursor = 0;
    this.rnd = rnd;
  }
  dirty() {
    for (const k of ['position', 'aVel', 'aBirth', 'aLife', 'aSize']) this.geo.attributes[k].needsUpdate = true;
  }
  emit(x, y, z, vx, vy, vz, birth, life, size) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.birth[i] = birth; this.life[i] = life; this.size[i] = size;
  }
}

// Wing dissolve: particles sampled on the wings; thresholds match the wing shader
export class WingDust {
  constructor(U, noise) {
    this.p = new Points(U, 1400, { color: '#ffe7b8', goldMix: 0.9, gravity: [0, 0.05, 0], wobble: 0.55, twinkle: 0.8, seed: 9, drag: 0.35 });
    // (a soft golden glitter rather than a flurry of white dots)
    this.p.mat.uniforms.uOpacity.value = 0.85;
    this.noise = noise;
    this.samples = [];
    const rnd = mulberry32(41);
    for (let i = 0; i < this.p.count; i++) {
      const u = rnd(), v = rnd();
      const n = sampleNoise(noise, u * 1.7 + 0.3, v * 1.1 + 0.3, 0);
      const th = 0.55 * (1 - u) + 0.45 * n;
      this.samples.push({ u, v, th, side: i % 2 ? 1 : -1 });
    }
    this.ready = false;
    this.D = 10; // virtual seconds across the dissolve
  }
  // capture world positions from the live wing meshes
  capture(character) {
    const pt = new THREE.Vector3();
    const wings = character.wings;
    wings.forEach((w) => w.mesh.updateWorldMatrix(true, false));
    const rnd = this.p.rnd;
    const c = new THREE.Vector3();
    character.root.getWorldPosition(c);
    this.samples.forEach((s, i) => {
      const w = wings[s.side > 0 ? 1 : 0];
      wingPoint(s.u, s.v, pt);
      pt.x *= s.side;
      pt.applyMatrix4(w.mesh.matrixWorld);
      // drift up and swirl gently around her
      const dx = pt.x - c.x, dz = pt.z - c.z;
      const dl = Math.hypot(dx, dz) + 1e-3;
      const swirl = 0.5 + rnd() * 0.6;
      const up = 0.35 + rnd() * 0.75;
      const out = 0.15 + rnd() * 0.35;
      this.p.pos[i * 3] = pt.x; this.p.pos[i * 3 + 1] = pt.y; this.p.pos[i * 3 + 2] = pt.z;
      this.p.vel[i * 3] = (dx / dl) * out - (dz / dl) * swirl + (rnd() - 0.5) * 0.3;
      this.p.vel[i * 3 + 1] = up;
      this.p.vel[i * 3 + 2] = (dz / dl) * out + (dx / dl) * swirl + (rnd() - 0.5) * 0.3;
      this.p.birth[i] = s.th * this.D;
      this.p.life[i] = 2.8 + rnd() * 2.8;
      this.p.size[i] = 0.03 + rnd() * rnd() * 0.12;
    });
    this.p.dirty();
    this.ready = true;
  }
  update(dissolve, character) {
    if (dissolve <= 0.0005) { this.ready = false; this.p.mesh.visible = false; return; }
    if (!this.ready) this.capture(character);
    this.p.mesh.visible = true;
    this.p.mat.uniforms.uClock.value = dissolve * this.D * 1.35;
  }
}

// Gold dust shed continuously from her (real time)
export class TrailDust {
  constructor(U) {
    this.p = new Points(U, 420, { goldMix: 0.8, gravity: [0, 0.06, 0], wobble: 0.35, twinkle: 0.4, seed: 17, drag: 0.6 });
    this.acc = 0;
  }
  update(time, dt, pos, rate, spread, reduced) {
    this.p.mat.uniforms.uClock.value = time;
    if (rate <= 0) return;
    this.acc += dt * rate * (reduced ? 0.4 : 1);
    const r = this.p.rnd;
    let any = false;
    while (this.acc > 1) {
      this.acc -= 1;
      this.p.emit(pos.x + (r() - 0.5) * spread, pos.y + (r() - 0.5) * spread, pos.z + (r() - 0.5) * spread,
        (r() - 0.5) * 0.4, 0.05 + r() * 0.3, (r() - 0.5) * 0.4, time, 1.6 + r() * 1.8, 0.02 + r() * 0.035);
      any = true;
    }
    if (any) this.p.dirty();
  }
}

// Burst of golden light when she makes a wish (real time)
export class WishBurst {
  constructor(U) {
    this.p = new Points(U, 900, { goldMix: 0.85, gravity: [0, -0.15, 0], wobble: 0.9, twinkle: 0.7, seed: 23, drag: 0.9 });
  }
  fire(time, at) {
    const r = this.p.rnd;
    for (let i = 0; i < this.p.count; i++) {
      const a = r() * TAU, el = r() * 0.9 + 0.35;
      const sp = 0.6 + r() * 2.6;
      this.p.emit(at.x + (r() - 0.5) * 0.15, at.y + r() * 0.1, at.z + (r() - 0.5) * 0.15,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp * 1.6 + 0.4, Math.sin(a) * Math.cos(el) * sp,
        time + r() * 0.5, 3 + r() * 4, 0.03 + r() * 0.06);
    }
    this.p.dirty();
  }
  update(time) { this.p.mat.uniforms.uClock.value = time; }
}

// Ambient motes floating around the camera
export function buildMotes(U, count = 500) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uGold: U.uGold, uOpacity: { value: 0.8 }, uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vA;
      void main() {
        vec3 box = vec3(40.0, 18.0, 40.0);
        vec3 p = position + vec3(sin(uTime * 0.2 + aSeed * 30.0) * 2.0, uTime * (0.15 + aSeed * 0.2), cos(uTime * 0.17 + aSeed * 20.0) * 2.0);
        p = mod(p - cameraPosition + box * 0.5, box) - box * 0.5 + cameraPosition;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp((0.025 + aSeed * 0.03) * uScale / max(d, 0.5), 0.0, 6.0);
        vA = (0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 50.0)) * smoothstep(1.0, 4.0, d) * (1.0 - smoothstep(16.0, 20.0, d));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold; uniform float uOpacity;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(uGold, vec3(1.0), 0.5) * a * vA * uOpacity, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const rnd = mulberry32(55);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd() - 0.5) * 40; pos[i * 3 + 1] = (rnd() - 0.5) * 18; pos[i * 3 + 2] = (rnd() - 0.5) * 40;
    seed[i] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 60;
  return { mesh: m, mat };
}

// Fireflies drifting around the twilight clearing (and garden)
export function buildFireflies(U, centre, radius, count, height = 2.5, bokehU = null) {
  const bk = !!bokehU;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uGold: U.uGold, uOpacity: { value: 0 }, uScale: { value: 300 }, ...(bokehU || {}) },
    defines: { BOKEH: bk ? 1 : 0 },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vA; varying float vE; varying float vB;
      ${bk ? BOKEH_VERT : ''}
      void main() {
        float t = uTime * (0.25 + aSeed * 0.35) + aSeed * 40.0;
        vec3 p = position + vec3(sin(t) * 1.8 + sin(t * 2.3) * 0.6, sin(t * 1.7) * 0.6, cos(t * 1.3) * 1.8);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float base = clamp(0.06 * uScale / max(-mv.z, 0.5), 1.5, 14.0);
        vE = 1.0; vB = 0.0;
        #if BOKEH
          gl_PointSize = min(bokehSize(gl_Position, -mv.z, base, vE, vB), 60.0);
        #else
          gl_PointSize = base;
        #endif
        vA = pow(0.5 + 0.5 * sin(uTime * (1.4 + aSeed * 2.4) + aSeed * 80.0), 2.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold; uniform float uOpacity;
      varying float vA; varying float vE; varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.15, 0.0, d);
        vec3 sharp = uGold * a * 0.8 + vec3(1.0, 0.95, 0.8) * core;
        vec3 bok = mix(uGold, vec3(1.0, 0.95, 0.8), 0.4) * smoothstep(0.5, 0.4, d) * 2.2 * min(vE * 2.0, 1.0);
        gl_FragColor = vec4(mix(sharp, bok, vB) * vA * uOpacity, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const rnd = mulberry32(77 + count);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * radius;
    const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
    pos[i * 3] = x; pos[i * 3 + 1] = heightAt(x, z) + 0.4 + rnd() * height; pos[i * 3 + 2] = z;
    seed[i] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 55;
  return { mesh: m, mat };
}

// ---------------------------------------------------------------------------
// Glowing stars representing her passions and dreams (World 3 summit)
export function buildPassionStars(U) {
  const group = new THREE.Group();
  const items = [];
  PASSION_STARS.forEach(([x, y, z, s], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#f6dca6', core: 0.9, pulse: 1, seed: i * 1.3, flare: 0.9 }));
    m.position.set(x, y, z);
    m.scale.setScalar(s * 6);
    m.renderOrder = 45;
    group.add(m);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#e8c7b8', core: 0, opacity: 0.35, pulse: 1, seed: i }));
    halo.position.copy(m.position);
    halo.scale.setScalar(s * 16);
    halo.renderOrder = 44;
    group.add(halo);
    items.push({ m, halo, base: new THREE.Vector3(x, y, z), seed: i });
  });
  // orbiting sparkles around the stars
  const sp = new Points(U, 600, { goldMix: 0.75, gravity: [0, 0, 0], wobble: 2.5, twinkle: 1, seed: 31 });
  const rnd = sp.rnd;
  for (let i = 0; i < sp.count; i++) {
    const st = PASSION_STARS[i % PASSION_STARS.length];
    const a = rnd() * TAU, r = 6 + rnd() * 40, e = (rnd() - 0.5) * 30;
    sp.emit(st[0] + Math.cos(a) * r, st[1] + e, st[2] + Math.sin(a) * r, 0, 0, 0, -1, 1e9, 0.12 + rnd() * 0.25);
  }
  sp.dirty();
  sp.mat.uniforms.uClock.value = 0;
  group.add(sp.mesh);
  return { group, items, sparkles: sp };
}

// ---------------------------------------------------------------------------
// The arc of stars rising from the cake across the sky (World 4)
export function buildStarArc(U, textMask = null) {
  const curve = new THREE.CatmullRomCurve3(STAR_ARC.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const len = curve.getLength();
  const pts = [], sv = [], wv = [];
  const N = 400;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push(curve.getPointAt(u)); sv.push(u * len); wv.push(lerp(0.12, 5.5, Math.pow(Math.sin(Math.min(u * 1.6, 1) * Math.PI * 0.5), 1.2)));
  }
  const mat = ribbonMaterial(U, { width: 0.5, tail: 80, floor: 0.24, minPix: 0.0012, near: [3, 16], textMask });
  const mesh = new THREE.Mesh(ribbonGeometry(pts, sv, wv), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 41;
  // stars that stay behind along the arc
  const stars = new Points(U, 1100, { goldMix: 0.55, gravity: [0, 0, 0], wobble: 0.0, twinkle: 1, seed: 47, textMask });
  const rnd = stars.rnd;
  for (let i = 0; i < stars.count; i++) {
    const u = Math.pow(rnd(), 0.9);
    const p = curve.getPointAt(u);
    const spread = lerp(0.3, 16, Math.pow(u, 0.6));
    stars.emit(p.x + (rnd() - 0.5) * spread, p.y + (rnd() - 0.5) * spread * 0.6, p.z + (rnd() - 0.5) * spread,
      0, 0, 0, u * len + rnd() * 6, 1e9, lerp(0.05, 1.6, Math.pow(u, 0.7)) * (0.4 + rnd() * rnd() * 2.2));
  }
  stars.dirty();
  return { mesh, mat, stars, len, curve };
}

// ---------------------------------------------------------------------------
// The small drooping flower that blooms under her care (World 2)
function petalTexture(wilted) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0); // v = 0 (base) at the bottom of the canvas
  if (wilted) {
    gr.addColorStop(0, '#9d93a8'); gr.addColorStop(0.45, '#bdb6c6'); gr.addColorStop(1, '#cfcad6');
  } else {
    gr.addColorStop(0, '#f19ab4'); gr.addColorStop(0.28, '#f8cdd9'); gr.addColorStop(0.62, '#fff1f2'); gr.addColorStop(1, '#fffbf7');
  }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  // fine veins
  g.strokeStyle = wilted ? 'rgba(120,110,130,0.18)' : 'rgba(225,140,170,0.16)';
  g.lineWidth = 1.2;
  for (let i = -3; i <= 3; i++) {
    g.beginPath(); g.moveTo(32, 128); g.quadraticCurveTo(32 + i * 6, 70, 32 + i * 9, 8); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
function petalGeometry(L, W, cup, bend) {
  const rows = 8, cols = 6;
  const pos = [], uv = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const shape = Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.08 + 0.92 * Math.pow(v, 0.72))), 0.75);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      const x = u * W * shape;
      const z = v * L - (j === rows ? 0.012 * L * Math.cos(u * Math.PI) : 0);
      const y = cup * u * u * W * shape * 2.2 + bend * v * v * L;
      pos.push(x, y, z);
      uv.push(i / cols, v);
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function leafGeometry(L, W) {
  const rows = 8, cols = 4;
  const pos = [], uv = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const shape = Math.sin(Math.PI * Math.min(0.999, 0.05 + 0.95 * v)) * (1 - 0.25 * v);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      pos.push(u * W * shape, Math.abs(u) * W * shape * 0.5 - v * v * L * 0.35, v * L);
      uv.push(i / cols, v);
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
export function buildHeroFlower(U, faceYaw = 0) {
  const g = new THREE.Group();
  const y0 = heightAt(FLOWER.x, FLOWER.z);
  g.position.set(FLOWER.x, y0, FLOWER.z);
  g.rotation.y = faceYaw; // local +z faces the viewer at the bloom
  g.scale.setScalar(1.5);
  const stemMat = toonMaterial(U, { color: '#5e8f45', shade: '#3f5f50', rim: 0.2, fogScale: 0.4 });
  const petalMat = toonMaterial(U, { map: petalTexture(true), map2: petalTexture(false), shade: '#b7a6cb', rim: 0.55, fogScale: 0.4, side: THREE.DoubleSide, satin: 0.6 });
  const centreMat = toonMaterial(U, { color: '#f3cf86', shade: '#c9965a', rim: 0.4, fogScale: 0.4, spec: 0.4 });
  const leafMat = toonMaterial(U, { color: '#6f9f4c', shade: '#3f5f50', rim: 0.25, fogScale: 0.4, side: THREE.DoubleSide });
  // segmented stem
  const segs = [];
  let parent = g;
  const segLen = 0.105;
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Group();
    s.position.y = i === 0 ? 0 : segLen;
    parent.add(s);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0062 - i * 0.0004, 0.0078 - i * 0.0004, segLen + 0.004, 7), stemMat);
    m.position.y = segLen / 2;
    s.add(m);
    segs.push(s);
    parent = s;
  }
  const headPivot = new THREE.Group();
  headPivot.position.y = segLen;
  parent.add(headPivot);
  // sepals (one merged mesh)
  const sepalGeo = petalGeometry(0.028, 0.014, 0.2, -0.3);
  const bake = (geo, mtx) => { const c = geo.clone(); c.applyMatrix4(mtx); return c; };
  const M4 = new THREE.Matrix4(), E = new THREE.Euler();
  const sepals = [];
  for (let i = 0; i < 5; i++) {
    E.set(0, (i / 5) * TAU + 0.3, 0); const a = new THREE.Matrix4().makeRotationFromEuler(E);
    E.set(-0.25, 0, 0); a.multiply(M4.makeRotationFromEuler(E));
    sepals.push(bake(sepalGeo, a));
  }
  headPivot.add(new THREE.Mesh(mergeGeometries(sepals), leafMat));
  // centre: a soft dome and a ring of stamens (one merged mesh)
  const centreParts = [bake(new THREE.SphereGeometry(0.019, 14, 10), new THREE.Matrix4().compose(new THREE.Vector3(0, 0.017, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.62, 1)))];
  const stGeo = new THREE.SphereGeometry(0.0042, 6, 4);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    centreParts.push(bake(stGeo, new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.017, 0.026, Math.sin(a) * 0.017)));
  }
  headPivot.add(new THREE.Mesh(mergeGeometries(centreParts), centreMat));
  // two layers of petals, each layer one instanced draw (every petal tilts open on its own)
  const petals = [];
  const outer = new THREE.InstancedMesh(petalGeometry(0.088, 0.05, 0.32, 0.18), petalMat, 8);
  const inner = new THREE.InstancedMesh(petalGeometry(0.064, 0.04, 0.42, 0.28), petalMat, 6);
  [outer, inner].forEach((m) => { m.frustumCulled = false; headPivot.add(m); });
  for (let i = 0; i < 8; i++) petals.push({ mesh: outer, k: i, a: (i / 8) * TAU, y: 0.012, layer: 0, i });
  for (let i = 0; i < 6; i++) petals.push({ mesh: inner, k: i, a: (i / 6) * TAU + 0.26, y: 0.018, layer: 1, i });
  const pM = new THREE.Matrix4(), pQ = new THREE.Quaternion(), pE = new THREE.Euler(0, 0, 0, 'YXZ'), pP = new THREE.Vector3(), pS = new THREE.Vector3(1, 1, 1);
  // leaves
  const leaves = [];
  const leafGeo = leafGeometry(0.13, 0.05);
  [[0, 0.04, 0.5], [1, 0.06, 0.5 + Math.PI * 0.9], [2, 0.03, 0.5 + Math.PI * 0.45]].forEach(([si, y, ry]) => {
    const lp = new THREE.Group();
    lp.position.y = y; lp.rotation.y = ry;
    segs[si].add(lp);
    lp.add(new THREE.Mesh(leafGeo, leafMat));
    leaves.push(lp);
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#f9dcae', core: 0.55, opacity: 0 }));
  glow.scale.setScalar(0.42);
  glow.position.y = 0.03;
  glow.renderOrder = 46;
  headPivot.add(glow);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#ffe6bd', core: 0.0, opacity: 0 }));
  flash.renderOrder = 47;
  headPivot.add(flash);
  // sparkles rising when it blooms (driven by bloom progress)
  const sp = new Points(U, 220, { goldMix: 0.85, gravity: [0, 0.05, 0], wobble: 0.25, twinkle: 0.8, seed: 61 });
  const rnd = sp.rnd;
  const headY = y0 + 0.78;
  for (let i = 0; i < 120; i++) {
    sp.emit(FLOWER.x + (rnd() - 0.5) * 0.3, headY + (rnd() - 0.5) * 0.12, FLOWER.z + (rnd() - 0.5) * 0.3,
      (rnd() - 0.5) * 0.22, 0.15 + rnd() * 0.35, (rnd() - 0.5) * 0.22, 3 + rnd() * 9, 3 + rnd() * 3, 0.012 + rnd() * 0.018);
  }
  // pollen burst: a ring of golden motes thrown outward as it opens
  for (let i = 120; i < 220; i++) {
    const a = rnd() * TAU, v = 0.5 + rnd() * 0.9;
    sp.emit(FLOWER.x, headY, FLOWER.z, Math.cos(a) * v, 0.25 + rnd() * 0.5, Math.sin(a) * v, 4.0 + rnd() * 0.8, 2.2 + rnd() * 2.2, 0.014 + rnd() * 0.02);
  }
  sp.dirty();
  return {
    group: g, sparkles: sp, headPivot, petalMat,
    update(bloom, time, clock) {
      const droop = 1 - bloom;
      // drooping (head hanging toward the viewer) → upright, face tilted to the viewer
      segs.forEach((s, i) => { s.rotation.x = droop * (0.1 + i * 0.15) + Math.sin(time * 1.3 + i) * 0.015; });
      headPivot.rotation.x = droop * 0.95 + bloom * 0.42;
      const open = smoothstep(0.2, 1, bloom);
      petals.forEach(({ mesh, k, a, y, layer, i }) => {
        const closed = layer === 0 ? -1.3 : -1.42;
        const opened = layer === 0 ? -0.2 : -0.62;
        const lag = layer === 0 ? 0 : 0.12;
        const o = smoothstep(0.2 + lag, 1, bloom);
        pE.set(lerp(closed, opened, o) + Math.sin(time * 1.1 + i + layer) * 0.03 * o, a, 0);
        mesh.setMatrixAt(k, pM.compose(pP.set(0, y, 0), pQ.setFromEuler(pE), pS));
      });
      outer.instanceMatrix.needsUpdate = true; inner.instanceMatrix.needsUpdate = true;
      leaves.forEach((l) => { l.rotation.x = lerp(0.85, 0.15, bloom); });
      petalMat.uniforms.uMapMix.value = smoothstep(0.1, 0.8, bloom);
      const pulse = 0.85 + 0.15 * Math.sin(time * 2.2);
      petalMat.uniforms.uEmissive.value.setRGB(0.11 * open * pulse, 0.075 * open * pulse, 0.06 * open * pulse);
      glow.material.uniforms.uOpacity.value = open * 0.42 * pulse;
      const fl = smoothstep(0.35, 0.62, bloom) * (1 - smoothstep(0.62, 1.0, bloom));
      flash.scale.setScalar(0.3 + fl * 1.4);
      flash.material.uniforms.uOpacity.value = fl * 0.85;
      flash.visible = fl > 0.01;
      sp.mat.uniforms.uClock.value = clock;
      sp.mesh.visible = clock > 0.01 && clock < 17.9;
    },
  };
}

// ---------------------------------------------------------------------------
// Birthday cake on a mossy stump with glowing "2" and "5" candles (World 4)
function glyphCurve(kind, s) {
  const V = (x, y) => new THREE.Vector3((x - 0.5) * s * 0.72, y * s, 0);
  const path = new THREE.CurvePath();
  if (kind === 2) {
    path.add(new THREE.CatmullRomCurve3([V(0.1, 0.72), V(0.26, 0.93), V(0.55, 0.99), V(0.82, 0.86), V(0.86, 0.64), V(0.66, 0.42), V(0.36, 0.2), V(0.1, 0.02)]));
    path.add(new THREE.LineCurve3(V(0.1, 0.02), V(0.92, 0.02)));
  } else {
    path.add(new THREE.LineCurve3(V(0.86, 0.98), V(0.25, 0.98)));
    path.add(new THREE.LineCurve3(V(0.25, 0.98), V(0.2, 0.57)));
    path.add(new THREE.CatmullRomCurve3([V(0.2, 0.57), V(0.46, 0.66), V(0.76, 0.6), V(0.9, 0.36), V(0.8, 0.11), V(0.5, 0.02), V(0.14, 0.1)]));
  }
  return path;
}
const _bv = new THREE.Vector3();
// Painted wood for the cake's tree stump: furrowed bark with a little moss at its foot, and
// a sawn top with growth rings, a dark pith, a bark rim and a couple of drying cracks
function stumpTextures() {
  const rnd = mulberry32(611);
  const bc = document.createElement('canvas'); bc.width = 256; bc.height = 128;
  const b = bc.getContext('2d');
  b.fillStyle = '#7a5b45'; b.fillRect(0, 0, 256, 128);
  // furrows: wavy vertical strokes, dark in the cracks, pale on the ridges
  for (let i = 0; i < 46; i++) {
    const x0 = rnd() * 256, w = 1.5 + rnd() * 3.5, dark = rnd() < 0.6;
    b.strokeStyle = dark ? `rgba(58,40,32,${0.45 + rnd() * 0.35})` : `rgba(160,124,94,${0.3 + rnd() * 0.3})`;
    b.lineWidth = w;
    b.beginPath();
    let x = x0;
    for (let y = -4; y <= 132; y += 8) { x += (rnd() - 0.5) * 3; if (y < 0) b.moveTo(x, y); else b.lineTo(x, y); }
    b.stroke();
    // (wrap seamlessly around the stump)
    if (x0 < 12 || x0 > 244) { b.save(); b.translate(x0 < 12 ? 256 : -256, 0); b.stroke(); b.restore(); }
  }
  // a darker, damp foot with moss creeping up it
  const gr = b.createLinearGradient(0, 128, 0, 80);
  gr.addColorStop(0, 'rgba(48,40,34,0.55)'); gr.addColorStop(1, 'rgba(48,40,34,0)');
  b.fillStyle = gr; b.fillRect(0, 80, 256, 48);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 256, y = 104 + rnd() * 24, r = 4 + rnd() * 10;
    b.fillStyle = `rgba(${96 + rnd() * 20 | 0},${128 + rnd() * 24 | 0},${70 + rnd() * 14 | 0},${0.35 + rnd() * 0.35})`;
    b.beginPath(); b.ellipse(x, y, r * 1.4, r * 0.7, 0, 0, Math.PI * 2); b.fill();
  }
  const bark = new THREE.CanvasTexture(bc);
  bark.wrapS = THREE.RepeatWrapping;
  bark.anisotropy = 4;
  const rc = document.createElement('canvas'); rc.width = 256; rc.height = 256;
  const r = rc.getContext('2d');
  r.fillStyle = '#c9a77e'; r.fillRect(0, 0, 256, 256);
  // growth rings: slightly wobbly circles, alternating light early wood and darker late wood
  for (let k = 0; k < 15; k++) {
    const rad = 6 + k * 8 + rnd() * 2;
    r.strokeStyle = `rgba(150,112,80,${0.35 + rnd() * 0.25})`;
    r.lineWidth = 1.2 + rnd() * 1.4;
    r.beginPath();
    for (let a = 0; a <= 64; a++) {
      const th = (a / 64) * Math.PI * 2, w = rad * (1 + Math.sin(th * 3 + k) * 0.025 + Math.sin(th * 7 + k * 2) * 0.012);
      const x = 128 + Math.cos(th) * w, y = 128 + Math.sin(th) * w;
      if (a === 0) r.moveTo(x, y); else r.lineTo(x, y);
    }
    r.stroke();
  }
  // the pith, two drying cracks and the bark rim
  r.fillStyle = 'rgba(120,86,60,0.8)'; r.beginPath(); r.arc(128, 128, 3.5, 0, Math.PI * 2); r.fill();
  r.strokeStyle = 'rgba(92,64,46,0.55)'; r.lineWidth = 1.6;
  for (const th of [0.7, 3.6]) { r.beginPath(); r.moveTo(128 + Math.cos(th) * 30, 128 + Math.sin(th) * 30); r.lineTo(128 + Math.cos(th + 0.05) * 118, 128 + Math.sin(th + 0.05) * 118); r.stroke(); }
  r.strokeStyle = '#6b4d3a'; r.lineWidth = 12; r.beginPath(); r.arc(128, 128, 127, 0, Math.PI * 2); r.stroke();
  r.strokeStyle = 'rgba(232,206,160,0.6)'; r.lineWidth = 2; r.beginPath(); r.arc(128, 128, 119, 0, Math.PI * 2); r.stroke();
  const rings = new THREE.CanvasTexture(rc);
  rings.anisotropy = 4;
  return { bark, rings };
}

export function buildCake(U) {
  const g = new THREE.Group();
  const y0 = heightAt(CAKE.x, CAKE.z);
  g.position.set(CAKE.x, y0, CAKE.z);
  const st = stumpTextures();
  const bark = toonMaterial(U, { color: '#7a5b45', shade: '#4a3a40', rim: 0.2, map: st.bark });
  const wood = toonMaterial(U, { color: '#c9a77e', shade: '#8e7468', rim: 0.2, map: st.rings });
  const moss = toonMaterial(U, { color: '#6c9a4c', shade: '#3e5c4c', rim: 0.2 });
  const frost = toonMaterial(U, { color: '#fbf5ea', shade: '#c9bfd8', rim: 0.35 });
  const gold = toonMaterial(U, { color: '#e9c98a', shade: '#a98a66', rim: 0.6 });
  const candle = toonMaterial(U, { color: '#eccb86', shade: '#b48d5e', rim: 0.6, emissive: '#2a1a06' });
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 24, 1, true), bark);
  stump.position.y = 0.25; g.add(stump);
  const sh = contactShadow(0.5, 1.3, 1.3);
  sh.position.y = 0.025; g.add(sh);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 32), wood);
  top.position.y = 0.505; g.add(top);
  const mossM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, TAU, 0, Math.PI / 2), moss);
  mossM.scale.set(1.2, 0.35, 0.8); mossM.position.set(0.22, 0.02, 0.12); g.add(mossM);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.014, 32), gold);
  plate.position.y = 0.525; g.add(plate);
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.13, 36), frost);
  t1.position.y = 0.598; g.add(t1);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.11, 36), frost);
  t2.position.y = 0.718; g.add(t2);
  // strawberry-pink glaze over each tier, running down the sides in drips
  const glaze = toonMaterial(U, { color: '#f4b6c6', shade: '#c98ea8', rim: 0.45, spec: 0.55, satin: 0.5, side: THREE.DoubleSide });
  const dripRnd = mulberry32(19);
  const dripGeo = (R, yTop, n) => {
    const cols = 360, pos = [], idx = [];
    const drips = [];
    for (let i = 0; i < n; i++) drips.push({ a: (i / n) * TAU + (dripRnd() - 0.5) * 0.25, w: 0.06 + dripRnd() * 0.04, l: 0.016 + dripRnd() * 0.04 });
    const lenAt = (a) => {
      let L = 0.008;
      for (const d of drips) {
        let da = Math.abs(((a - d.a + Math.PI) % TAU + TAU) % TAU - Math.PI) / d.w;
        if (da < 1) L = Math.max(L, 0.008 + d.l * Math.pow(1 - da * da, 0.28));
      }
      return L;
    };
    const rows = 4;
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * TAU;
      const L = lenAt(a);
      for (let j = 0; j <= rows; j++) {
        const f = j / rows;
        // a thin skin over the side; the drip ends swell a little
        const r = R + 0.003 + 0.004 * Math.pow(f, 3) * smoothstep(0.012, 0.03, L);
        pos.push(Math.cos(a) * r, yTop + 0.002 - L * f, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    // the glaze cap over the top, its rim rolling over the edge
    const capR = [0, 0.5, 0.85, 0.97, 1.0];
    const c0 = pos.length / 3;
    capR.forEach((k, j) => {
      for (let i = 0; i <= cols; i++) {
        const a = (i / cols) * TAU;
        const r = (R + 0.003) * k;
        pos.push(Math.cos(a) * r, yTop + 0.004 - (j === capR.length - 1 ? 0.002 : 0), Math.sin(a) * r);
      }
    });
    for (let j = 0; j < capR.length - 1; j++) for (let i = 0; i < cols; i++) {
      const a = c0 + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  g.add(new THREE.Mesh(mergeGeometries([dripGeo(0.17, 0.663, 15), dripGeo(0.118, 0.773, 11)]), glaze));
  // berries and little cream rosettes on the top tier
  const berryMat = toonMaterial(U, { color: '#d8445e', shade: '#8f2a49', rim: 0.5, spec: 0.7 });
  const creamMat = toonMaterial(U, { color: '#fff8ef', shade: '#d7c9dc', rim: 0.35 });
  const berries = [], rosettes = [];
  const ros = new THREE.ConeGeometry(0.016, 0.026, 7, 1);
  ros.translate(0, 0.013, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.2;
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 0.092, 0.777, Math.sin(a) * 0.092), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a * 3.0, 0)), new THREE.Vector3(1, 1, 1));
    rosettes.push(ros.clone().applyMatrix4(m4));
    if (i % 2 === 0) {
      const b = new THREE.IcosahedronGeometry(0.0125, 1);
      b.scale(1, 1.15, 1);
      b.translate(Math.cos(a + 0.35) * 0.1, 0.786, Math.sin(a + 0.35) * 0.1);
      berries.push(b);
    }
  }
  // lower tier: berries around the base
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.13;
    const b = new THREE.IcosahedronGeometry(0.013, 1);
    b.scale(1, 1.15, 1);
    b.translate(Math.cos(a) * 0.15, 0.674, Math.sin(a) * 0.15);
    berries.push(b);
  }
  g.add(new THREE.Mesh(mergeGeometries(berries), berryMat));
  g.add(new THREE.Mesh(mergeGeometries(rosettes), creamMat));
  // piping beads
  const beads = [];
  const rnd = mulberry32(5);
  const beadCols = ['#f2b9c8', '#c9b8ee', '#f6c9d3', '#b8a6e3'];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; beads.push({ x: Math.cos(a) * 0.168, y: 0.664, z: Math.sin(a) * 0.168, s: 0.013, c: beadCols[i % 2] }); }
  for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; beads.push({ x: Math.cos(a) * 0.17, y: 0.537, z: Math.sin(a) * 0.17, s: 0.012, c: beadCols[2 + (i % 2)] }); }
  for (let i = 0; i < 30; i++) { const a = (i / 30) * TAU; beads.push({ x: Math.cos(a) * 0.116, y: 0.774, z: Math.sin(a) * 0.116, s: 0.011, c: beadCols[(i % 2) * 2] }); }
  // tiny sugar flowers
  for (let i = 0; i < 7; i++) { const a = rnd() * TAU, r = 0.05 + rnd() * 0.05; beads.push({ x: Math.cos(a) * r, y: 0.776, z: Math.sin(a) * r, s: 0.016, c: '#fbe7ec' }); }
  const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foliageMaterial(U, { color: '#ffffff', shade: '#b9a8c8', sway: 0, fogScale: 0.5 }), beads.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  beads.forEach((b, i) => { m4.makeScale(b.s, b.s * 0.8, b.s); m4.setPosition(b.x, b.y, b.z); bm.setMatrixAt(i, m4); bm.setColorAt(i, col.set(b.c)); });
  g.add(bm);
  // numeral candles
  const flames = [];
  const glyphH = 0.165;
  [2, 5].forEach((k, i) => {
    const curve = glyphCurve(k, glyphH);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.0135, 8, false), candle);
    const holder = new THREE.Group();
    holder.position.set(i === 0 ? -0.06 : 0.06, 0.776, 0.02);
    holder.rotation.y = i === 0 ? 0.12 : -0.12;
    holder.add(tube);
    g.add(holder);
    const wickPos = new THREE.Vector3((0.55 - 0.5) * glyphH * 0.72, glyphH * 0.99 + 0.006, 0);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.014, 4), toonMaterial(U, { color: '#3a2a22' }));
    wick.position.copy(wickPos);
    holder.add(wick);
    const flame = new THREE.Group();
    flame.position.copy(wickPos); flame.position.y += 0.022;
    holder.add(flame);
    const fmMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    fmMat.color.setRGB(2.4, 2.0, 1.35);
    const fm = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), fmMat);
    fm.scale.set(0.8, 1.9, 0.8);
    flame.add(fm);
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#ffb766', core: 0.9, opacity: 1 }));
    fg.scale.setScalar(0.13);
    fg.renderOrder = 47;
    flame.add(fg);
    const fg2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(U, { color: '#ffcf8a', core: 0, opacity: 0.3 }));
    fg2.scale.setScalar(0.9);
    fg2.renderOrder = 46;
    flame.add(fg2);
    flames.push({ flame, fm, fg, fg2, seed: i * 3.1 });
  });
  // the cake itself (all but the stump it stands on), in a group of its own so it can appear
  // on the stump in a shimmer of light
  const cakeTop = new THREE.Group();
  cakeTop.position.y = 0.52;
  for (const o of g.children.slice()) if (o !== stump && o !== sh && o !== top && o !== mossM) { o.position.y -= 0.52; cakeTop.add(o); }
  g.add(cakeTop);
  // smoke wisps after the wish
  const smoke = new Points(U, 120, { color: '#d8d4dc', goldMix: 0.0, gravity: [0, 0.05, 0], wobble: 0.08, seed: 71 });
  smoke.mat.blending = THREE.NormalBlending;
  smoke.mat.fragmentShader = smoke.mat.fragmentShader.replace('gl_FragColor = vec4(col * (halo * 0.55 + core * 1.6) * vAlpha * uOpacity, 1.0);', 'gl_FragColor = vec4(col, halo * 0.35 * vAlpha * uOpacity);');
  g.add(smoke.mesh);
  const flameTop = new THREE.Vector3(0, 0.98, 0.02);
  return {
    group: g, flames, smoke, flameTop, cakeTop,
    worldFlame: () => g.localToWorld(flameTop.clone()),
    update(time, lit, reduced, blow = 0, her = null) {
      // (when she blows, the flames stream away from her, flickering hard, and go out)
      let bx = 0, bz = 0;
      if (blow > 0.001 && her) {
        const h = g.worldToLocal(_bv.copy(her));
        bx = flameTop.x - h.x; bz = flameTop.z - h.z;
        const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l;
      }
      flames.forEach((f, i) => {
        const fl = reduced ? 1 : 1 + Math.sin(time * 13 + f.seed) * 0.08 + Math.sin(time * 7.3 + f.seed * 2) * 0.06;
        const s = Math.max(lit, 0.0001);
        const k = blow * (1.05 + 0.25 * Math.sin(time * 41 + f.seed * 5));
        f.flame.rotation.set(bz * k, 0, -bx * k);
        f.flame.scale.set(s * (2 - fl) * (1 - 0.3 * blow), s * fl * (1 + 0.45 * blow), s * (2 - fl) * (1 - 0.3 * blow));
        f.flame.visible = lit > 0.01;
        f.fg.material.uniforms.uOpacity.value = lit;
        f.fg2.material.uniforms.uOpacity.value = lit * 0.45;
      });
      smoke.mat.uniforms.uClock.value = time;
    },
    puff(time) {
      const r = smoke.rnd;
      flames.forEach((f) => {
        const p = new THREE.Vector3(); f.flame.getWorldPosition(p);
        for (let k = 0; k < 40; k++) smoke.emit(p.x + (r() - 0.5) * 0.01, p.y, p.z + (r() - 0.5) * 0.01, (r() - 0.5) * 0.05, 0.08 + r() * 0.12, (r() - 0.5) * 0.05, time + r() * 1.2, 2.5 + r() * 2, 0.02 + r() * 0.03);
      });
      smoke.dirty();
    },
  };
}

// ---------------------------------------------------------------------------
// Glowing footprints that light up behind her on the mountain trail (World 3)
export function buildFootprints(U, path, s0, s1) {
  const steps = [];
  let side = 1;
  for (let s = s0; s < s1; s += 0.74) {
    const p = path.posAt(s);
    const d = path.dirAt(s, 1.5);
    const yaw = Math.atan2(d.x, d.z);
    const off = 0.1 * side;
    const x = p.x + Math.cos(yaw) * off, z = p.z - Math.sin(yaw) * off;
    steps.push([x, heightAt(x, z) + 0.16, z, yaw, s]);
    side = -side;
  }
  const base = new THREE.PlaneGeometry(0.17, 0.36);
  base.rotateX(-Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const n = steps.length;
  const ap = new Float32Array(n * 3), ay = new Float32Array(n), as = new Float32Array(n);
  steps.forEach(([x, y, z, yaw, s], i) => { ap[i * 3] = x; ap[i * 3 + 1] = y; ap[i * 3 + 2] = z; ay[i] = yaw; as[i] = s; });
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(ap, 3));
  g.setAttribute('aYaw', new THREE.InstancedBufferAttribute(ay, 1));
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(as, 1));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uGold: U.uGold, uTime: U.uTime, uStep: { value: 0 }, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute float aYaw; attribute float aS;
      uniform float uStep;
      varying vec2 vUv; varying float vG; varying float vS;
      void main() {
        vUv = uv; vS = aS;
        float c = cos(aYaw), s = sin(aYaw);
        vec3 p = vec3(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
        float age = uStep - aS;
        vG = smoothstep(-0.2, 0.5, age) * (0.28 + 0.95 * exp(-max(age, 0.0) / 14.0));
        gl_Position = projectionMatrix * viewMatrix * vec4(aPos + p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold; uniform float uAmt; uniform float uTime;
      varying vec2 vUv; varying float vG; varying float vS;
      void main() {
        vec2 c = (vUv - vec2(0.5, 0.45)) * vec2(2.0, 1.0);
        float sole = smoothstep(0.5, 0.2, length(c * vec2(1.0, 1.25)));
        float heel = smoothstep(0.32, 0.12, length((vUv - vec2(0.5, 0.15)) * vec2(2.0, 1.3)));
        float a = max(sole, heel);
        float tw = 0.85 + 0.15 * sin(uTime * 3.0 + vS * 3.7);
        vec3 col = mix(uGold, vec3(1.0, 0.97, 0.88), 0.4) * a * vG * uAmt * tw * 2.0;
        if (dot(col, vec3(1.0)) < 0.002) discard;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 35;
  return { mesh, mat, steps };
}

// Sparkles lifting from the garden as the ripple of light passes (World 2)
export function buildRippleSparkles(U, centre, count = 700) {
  const sp = new Points(U, count, { goldMix: 0.8, gravity: [0, 0.02, 0], wobble: 0.6, twinkle: 0.8, seed: 83 });
  const rnd = sp.rnd;
  for (let i = 0; i < count; i++) {
    const r = Math.pow(rnd(), 0.7) * 76, a = rnd() * TAU;
    const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
    sp.emit(x, heightAt(x, z) + 0.2 + rnd() * 0.5, z, (rnd() - 0.5) * 0.15, 0.35 + rnd() * 0.6, (rnd() - 0.5) * 0.15, r - 2 + rnd() * 3, 7 + rnd() * 8, 0.03 + rnd() * 0.05);
  }
  sp.dirty();
  return sp;
}

// ---------------------------------------------------------------------------
// Sunbeams: a few long, soft shafts of golden light slanting down out of the sky onto her and
// her flower as it blooms - a spotlight from the heavens. Each is an open tube, drawn added
// to the picture (no depth written): brightest down its middle (where we look through the
// most of it), fading toward its edges, high up where it begins and where it reaches the
// grass; motes of light drift down through it and it shimmers slowly.
export function buildSunRays(U, sunDir = [0.42, 0.74, 0.52]) {
  const g = new THREE.Group();
  const D = new THREE.Vector3(...sunDir).normalize();
  const gy = heightAt(FLOWER.x, FLOWER.z);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), D);
  const vert = /* glsl */ `
    varying vec3 vW; varying vec3 vN; varying vec2 vUv2;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv2 = uv;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const frag = /* glsl */ `
    uniform float uTime; uniform sampler2D uNoise; uniform float uAmt; uniform vec3 uCol; uniform float uSeed;
    varying vec3 vW; varying vec3 vN; varying vec2 vUv2;
    void main() {
      vec3 V = normalize(cameraPosition - vW);
      float core = pow(abs(dot(normalize(vN), V)), 2.4);
      // along it: from nothing high up, fullest low down, soft where it meets the grass
      float along = (1.0 - smoothstep(0.5, 1.0, vUv2.y)) * smoothstep(0.0, 0.025, vUv2.y) * mix(0.5, 1.0, smoothstep(0.02, 0.22, vUv2.y));
      // drifting motes and a slow shimmer
      float n1 = texture2D(uNoise, vec2(vUv2.x * 2.0 + uSeed, vUv2.y * 2.6 + uTime * 0.02 + uSeed)).r;
      float n2 = texture2D(uNoise, vec2(vUv2.x * 6.0 - uSeed, vUv2.y * 9.0 + uTime * 0.05)).g;
      float sh = 0.82 + 0.18 * sin(uTime * 0.7 + uSeed * 9.0);
      float a = core * along * (0.55 + 0.55 * n1) * (0.85 + 0.3 * smoothstep(0.6, 0.85, n2)) * sh * uAmt;
      // (and nothing up close: a beam passing right by the lens would fill the frame)
      // (and gentler seen close to: a soft haze of gold round her, not a glare)
      float dC = length(cameraPosition - vW);
      a *= smoothstep(0.8, 2.6, dC) * mix(0.25, 1.0, smoothstep(4.0, 12.0, dC));
      gl_FragColor = vec4(uCol * a, 1.0);
    }`;
  // [x offset, z offset, radius, strength] round her flower
  const beams = [[0.1, 0.2, 1.05, 0.85], [1.8, -1.1, 0.62, 0.7], [-1.7, 1.3, 0.75, 0.62], [3.0, 1.8, 0.5, 0.48], [-2.6, -2.1, 0.55, 0.45], [0.6, 3.2, 0.42, 0.4]];
  const L = 34;
  const mats = [];
  beams.forEach(([ox, oz, r, k], i) => {
    const geo = new THREE.CylinderGeometry(r * 1.35, r, L, 28, 1, true);
    geo.translate(0, L / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uNoise: U.uNoise, uAmt: { value: 0 }, uCol: { value: new THREE.Color('#ffcf73') }, uSeed: { value: i * 0.173 } },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    mat.userData.k = k;
    const m = new THREE.Mesh(geo, mat);
    const x = FLOWER.x + ox, z = FLOWER.z + oz;
    m.position.set(x, heightAt(x, z) - 0.15, z);
    m.quaternion.copy(q);
    m.frustumCulled = false;
    m.renderOrder = 48;
    m.userData.split = 'near';
    g.add(m);
    mats.push(mat);
  });
  g.visible = false;
  // the warm pool of light they make round her (the scene's point light, for a while)
  const lightPos = new THREE.Vector3(FLOWER.x, gy, FLOWER.z).addScaledVector(D, 2.4);
  const lightCol = new THREE.Color('#ffd78c');
  return {
    group: g, lightPos, lightCol,
    update(amt) {
      g.visible = amt > 0.001;
      for (const m of mats) m.uniforms.uAmt.value = amt * 0.42 * m.userData.k;
    },
  };
}
