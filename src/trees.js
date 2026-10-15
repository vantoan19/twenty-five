// Painterly trees: layered drooping spruces, clumped broadleaf and blossom
// crowns, flame cypresses and bushes. Unit-height geometries for instancing,
// with baked ambient occlusion (aAO) and crown-blended normals so each clump
// reads as a soft ball inside one rounded mass.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, TAU, clamp } from './math.js';
import { COMMON } from './shaders.js';

// --- tiny mesh builder --------------------------------------------------------
class Builder {
  constructor() { this.p = []; this.n = []; this.h = []; this.ao = []; this.i = []; this.cl = []; this.curCl = 0.5; }
  // curCl: a random value per leaf clump (the shader varies each clump's tone with it)
  v(x, y, z, nx, ny, nz, head, ao) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z); this.n.push(nx / l, ny / l, nz / l); this.h.push(head); this.ao.push(ao); this.cl.push(this.curCl);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  add(geo, head, aoFn, nrmFn) {
    const g = geo.index ? geo : geo;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const base = this.p.length / 3;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      let nx = nor.getX(k), ny = nor.getY(k), nz = nor.getZ(k);
      if (nrmFn) [nx, ny, nz] = nrmFn(x, y, z, nx, ny, nz);
      this.v(x, y, z, nx, ny, nz, head, aoFn ? aoFn(x, y, z) : 1);
    }
    if (g.index) { const ix = g.index.array; for (let k = 0; k < ix.length; k++) this.i.push(base + ix[k]); }
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aHead', new THREE.Float32BufferAttribute(this.h, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setAttribute('aCl', new THREE.Float32BufferAttribute(this.cl, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// lumpy sphere (shared vertices, so jitter keeps it closed)
function lump(r, detail, seed, amt = 0.18) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const rnd = mulberry32(seed);
  const pos = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) { k = 1 + (rnd() - 0.5) * amt * 2; map.set(key, k); }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function trunk(B, r0, r1, h, seg = 6, x = 0, z = 0, lean = [0, 0]) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) + x + lean[0] * t * h);
    pos.setZ(i, pos.getZ(i) + z + lean[1] * t * h);
  }
  g.computeVertexNormals();
  B.add(g, 0, (px, py) => 0.55 + 0.45 * clamp(py / h, 0, 1));
}

// --- spruce: drooping, jagged tiers ------------------------------------------
export function spruceGeometry(seed = 1, tiers = 10, M = 20) {
  const rnd = mulberry32(seed * 13 + 1);
  const B = new Builder();
  trunk(B, 0.04, 0.018, 0.45, 6);
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const r = 0.31 * Math.pow(1 - f * 0.9, 1.0) * (0.9 + rnd() * 0.2);
    const top = 0.17 + f * 0.79 + 0.05;
    const h = 0.15 * (1 - f * 0.4);
    const droop = r * (0.3 + rnd() * 0.14);
    const rot = rnd() * TAU;
    const tilt = [(rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.05];
    const apex = B.v(tilt[0] * 0.3, top, tilt[1] * 0.3, 0, 1, 0, 1, 0.38 + f * 0.3);
    const under = B.v(0, top - h - droop * 0.4, 0, 0, -1, 0, 1, 0.16);
    const rim = [];
    for (let k = 0; k < M; k++) {
      const a = rot + (k / M) * TAU + (rnd() - 0.5) * 0.1;
      // branch tips of uneven length between deep notches
      const tip = k % 2 === 0;
      const rr = r * (tip ? 0.92 + rnd() * 0.3 : 0.55 + rnd() * 0.12);
      const x = Math.cos(a) * rr + tilt[0] * rr, z = Math.sin(a) * rr + tilt[1] * rr;
      const y = top - h - droop * (tip ? 1 : 0.5) * (0.8 + rnd() * 0.4);
      const nx = Math.cos(a), nz = Math.sin(a);
      rim.push(B.v(x, y, z, nx * 0.8, 0.85, nz * 0.8, 1, tip ? 1 : 0.62));
    }
    for (let k = 0; k < M; k++) {
      const a = rim[k], b = rim[(k + 1) % M];
      B.tri(apex, b, a);
      B.tri(under, a, b);
    }
  }
  const lead = new THREE.ConeGeometry(0.025, 0.1, 5, 1, true);
  lead.translate(0, 1.0, 0);
  B.add(lead, 1, () => 0.9);
  return B.build();
}

// --- broadleaf / blossom: clumps inside a rounded crown ----------------------
export function crownTreeGeometry(seed = 1, { clumps = 10, crown = [0.36, 0.3, 0.36], cy = 0.66, trunkH = 0.5, detail = 1, lumpAmt = 0.2, branches = 3 } = {}) {
  const rnd = mulberry32(seed * 7 + 3);
  const B = new Builder();
  trunk(B, 0.055, 0.03, trunkH, 7, 0, 0, [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08]);
  // a few limbs reaching into the crown
  for (let k = 0; k < branches; k++) {
    const a = rnd() * TAU, len = 0.22 + rnd() * 0.1;
    const g = new THREE.CylinderGeometry(0.012, 0.025, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateZ(0.7 + rnd() * 0.3);
    g.rotateY(a);
    g.translate(0, trunkH * (0.7 + rnd() * 0.2), 0);
    g.computeVertexNormals();
    B.add(g, 0, () => 0.6);
  }
  const C = new THREE.Vector3(0, cy, 0);
  const [rx, ry, rz] = crown;
  const pts = [];
  // clumps on and just inside the crown surface, more of them up top
  for (let k = 0; k < clumps; k++) {
    let x, y, z;
    for (let tries = 0; tries < 20; tries++) {
      const u = rnd() * 2 - 1, a = rnd() * TAU;
      const s = Math.sqrt(1 - u * u);
      const d = 0.55 + rnd() * 0.35;
      x = Math.cos(a) * s * rx * d; y = u * ry * d; z = Math.sin(a) * s * rz * d;
      if (y > -ry * 0.55 && pts.every((p) => Math.hypot(p[0] - x, p[1] - y, p[2] - z) > 0.09)) break;
    }
    pts.push([x, y, z]);
  }
  // one core clump fills the middle
  pts.push([0, 0, 0]);
  const up = Math.max(rx, ry, rz);
  pts.forEach(([x, y, z], k) => {
    const core = k === pts.length - 1;
    const r = core ? Math.min(rx, ry) * 0.8 : (0.12 + rnd() * 0.07) * (up / 0.36);
    const g = lump(r, detail, seed * 31 + k, lumpAmt);
    const ox = C.x + x, oy = C.y + y, oz = C.z + z;
    g.translate(ox, oy, oz);
    B.add(g, 1,
      // occlusion: darker toward the crown's heart and underside
      (px, py, pz) => {
        const dx = (px - C.x) / rx, dy = (py - C.y) / ry, dz = (pz - C.z) / rz;
        const out = Math.min(1, Math.hypot(dx, dy, dz));
        return clamp(0.25 + out * 0.6 + dy * 0.22, 0.15, 1);
      },
      // normals: each clump a smooth ball, leaning to the crown's overall shape
      (px, py, pz) => {
        let sx = px - ox, sy = py - oy, sz = pz - oz;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const cx = (px - C.x) / (rx * rx), cyy = (py - C.y) / (ry * ry), cz = (pz - C.z) / (rz * rz);
        const l = Math.hypot(cx, cyy, cz) || 1;
        return [(sx / sl) * 0.55 + (cx / l) * 0.45, (sy / sl) * 0.55 + (cyy / l) * 0.45, (sz / sl) * 0.55 + (cz / l) * 0.45];
      });
  });
  return B.build();
}

// --- puffy tree: an organic trunk with a root flare and limbs, under a crown of many
// soft leafy clumps, each with bumps of leaves on it -------------------------------
// (unit height; detail 2 clumps for the few trees seen up close, 1 elsewhere)
export function puffyTreeGeometry(seed = 1, { clumps = 22, crown = [0.4, 0.3, 0.4], cy = 0.64, trunkH = 0.5, detail = 1, bump = 0.16, branches = 4, clumpR = [0.1, 0.16] } = {}) {
  const rnd = mulberry32(seed * 7 + 3);
  const B = new Builder();
  // trunk: rings up a gently curving axis, flared and ridged at the roots
  const seg = 9, rings = 7;
  const bend = [(rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06];
  const axis = (y) => [bend[0] * Math.sin((y / trunkH) * Math.PI * 0.9), bend[1] * Math.sin((y / trunkH) * Math.PI * 0.9)];
  const tb = B.p.length / 3;
  for (let j = 0; j <= rings; j++) {
    const f = j / rings, y = f * (trunkH + 0.06);
    const [ax, az] = axis(y);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const flare = 1 + 0.9 * Math.exp(-y / 0.045) * (0.65 + 0.35 * Math.max(0, Math.cos(a * 4 + seed)));
      const r = (0.05 - 0.024 * f) * flare;
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
      B.v(x, y, z, Math.cos(a), 0.15, Math.sin(a), 0, 0.5 + 0.45 * f);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = tb + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    B.tri(a, c, b); B.tri(b, c, d);
  }
  // limbs reaching up into the crown
  for (let k = 0; k < branches; k++) {
    const a = (k / branches) * TAU + rnd() * 0.8, len = 0.2 + rnd() * 0.12;
    const g = new THREE.CylinderGeometry(0.01, 0.022, len, 6, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateZ(0.55 + rnd() * 0.35);
    g.rotateY(a);
    const y0 = trunkH * (0.62 + rnd() * 0.25), [ax, az] = axis(y0);
    g.translate(ax, y0, az);
    g.computeVertexNormals();
    B.add(g, 0, () => 0.55);
  }
  // crown: clumps spread evenly over the crown's surface (spherical Fibonacci), a few
  // inside to fill it, more weight on the upper side
  const C = new THREE.Vector3(0, cy, 0);
  const [rx, ry, rz] = crown;
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < clumps; k++) {
    const u = 1 - (k + 0.5) / clumps * 1.7;            // upper 85% of the sphere
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const a = k * golden + rnd() * 0.4;
    const d = 0.72 + rnd() * 0.22;
    pts.push([Math.cos(a) * s * rx * d, u * ry * d, Math.sin(a) * s * rz * d]);
  }
  pts.push([0, -ry * 0.05, 0], [rx * 0.3, ry * 0.15, -rz * 0.25], [-rx * 0.3, ry * 0.1, rz * 0.25]);
  const ph = [rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9];
  pts.forEach(([x, y, z], k) => {
    const inner = k >= clumps;
    const r = inner ? Math.min(rx, ry) * 0.62 : clumpR[0] + rnd() * (clumpR[1] - clumpR[0]);
    // indexed, so the leafy bumps get smooth normals
    const g0 = new THREE.IcosahedronGeometry(1, detail);
    g0.deleteAttribute('uv'); g0.deleteAttribute('normal');
    const g = mergeVertices(g0, 1e-4);
    const pos = g.attributes.position;
    // shared vertices get the same bump (the icosphere is not indexed)
    const ox = C.x + x, oy = C.y + y, oz = C.z + z;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i);
      // leafy bumps: two octaves of smooth waves over the clump
      const b1 = Math.sin(dx * 5.1 + ph[0] + k) * Math.sin(dy * 5.3 + ph[1]) * Math.sin(dz * 4.9 + ph[2] + k * 0.7);
      const b2 = Math.sin(dx * 9.7 + ph[3]) * Math.sin(dy * 10.3 + ph[4] + k) * Math.sin(dz * 9.1 + ph[5]);
      const kk = r * (1 + bump * (0.65 * b1 + 0.35 * b2)) * (dy < 0 ? 0.85 + 0.15 * (1 + dy) : 1);
      pos.setXYZ(i, ox + dx * kk, oy + dy * kk * 0.92, oz + dz * kk);
    }
    g.computeVertexNormals();
    B.curCl = rnd();
    B.add(g, 1,
      // occlusion: darker toward the crown's heart and underside
      (px, py, pz) => {
        const ex = (px - C.x) / rx, ey = (py - C.y) / ry, ez = (pz - C.z) / rz;
        const out = Math.min(1, Math.hypot(ex, ey, ez));
        return clamp(0.22 + out * 0.62 + ey * 0.22, 0.12, 1);
      },
      // normals: leafy relief, the clump's ball and the crown's overall shape
      (px, py, pz, nx, ny, nz) => {
        let sx = px - ox, sy = py - oy, sz = pz - oz;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const cx = (px - C.x) / (rx * rx), cyy = (py - C.y) / (ry * ry), cz = (pz - C.z) / (rz * rz);
        const l = Math.hypot(cx, cyy, cz) || 1;
        return [nx * 0.35 + (sx / sl) * 0.3 + (cx / l) * 0.35, ny * 0.35 + (sy / sl) * 0.3 + (cyy / l) * 0.35, nz * 0.35 + (sz / sl) * 0.3 + (cz / l) * 0.35];
      });
    B.curCl = 0.5;
  });
  return B.build();
}

// --- cypress: a slim flame of stacked clumps ---------------------------------
export function cypressGeometry2(seed = 5) {
  const rnd = mulberry32(seed);
  const B = new Builder();
  trunk(B, 0.03, 0.02, 0.15, 5);
  const n = 7;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    const r = 0.13 * Math.sin(Math.PI * (0.18 + f * 0.8)) + 0.03;
    const g = lump(r, 1, seed * 11 + k, 0.22);
    g.scale(1, 1.5, 1);
    const ox = (rnd() - 0.5) * 0.03, oy = 0.14 + f * 0.8, oz = (rnd() - 0.5) * 0.03;
    g.translate(ox, oy, oz);
    B.add(g, 1, (px, py, pz) => clamp(0.45 + Math.hypot(px, pz) * 3.2 + (py - 0.5) * 0.3, 0.2, 1),
      (px, py, pz) => {
        const sx = px - ox, sy = (py - oy) / 1.5, sz = pz - oz;
        const sl = Math.hypot(sx, sy, sz) || 1;
        return [(sx / sl) * 0.7 + px * 2, (sy / sl) * 0.7 + (py - 0.55) * 0.5, (sz / sl) * 0.7 + pz * 2];
      });
  }
  return B.build();
}

// --- bush: low clumps ----------------------------------------------------------
export function bushGeometry(seed = 3, detail = 0) {
  const rnd = mulberry32(seed);
  const B = new Builder();
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rnd() * 0.6, d = k === 0 ? 0 : 0.28 + rnd() * 0.12;
    const r = k === 0 ? 0.42 : 0.26 + rnd() * 0.1;
    const g = lump(r, detail, seed * 5 + k, 0.16);
    g.scale(1, 0.8, 1);
    const ox = Math.cos(a) * d, oy = r * 0.55, oz = Math.sin(a) * d;
    g.translate(ox, oy, oz);
    B.add(g, 1, (px, py, pz) => clamp(0.3 + py * 1.1 + Math.hypot(px, pz) * 0.5, 0.2, 1),
      (px, py, pz) => {
        const sx = px - ox, sy = (py - oy) / 0.8, sz = pz - oz;
        const sl = Math.hypot(sx, sy, sz) || 1;
        return [(sx / sl) * 0.65 + px * 0.6, (sy / sl) * 0.65 + (py - 0.2) * 0.6, (sz / sl) * 0.65 + pz * 0.6];
      });
  }
  return B.build();
}

// --- material ------------------------------------------------------------------
export function treeMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uBase: { value: new THREE.Color(opts.color || '#ffffff') },
    uStem: { value: new THREE.Color(opts.stem || '#5a4636') },
    uShade: { value: new THREE.Color(opts.shade || '#5b6f78') },
    uSway: { value: opts.sway ?? 0.25 },
    uFleck: { value: opts.fleck ?? 0.5 },
    uBloom: { value: opts.bloom ?? 0 },
    uEmit: { value: opts.emit ?? 0 },
    uLift: { value: opts.lift ?? 0.3 },
    uFogScale: { value: opts.fogScale ?? 1 },
    uBlossomA: { value: new THREE.Color(opts.blossomA || '#f4a6c2') },
    uBlossomB: { value: new THREE.Color(opts.blossomB || '#fbd0de') },
  };
  return new THREE.ShaderMaterial({
    defines: { ...(opts.bloomKey ? { BLOOM_KEY: 1 } : {}), ...(opts.needles ? { NEEDLES: 1 } : {}) },
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWind; uniform float uSway;
      uniform vec4 uRipple; uniform float uRippleAmt; uniform vec3 uStem;
      uniform float uBloomR; uniform vec3 uBloomC; uniform float uWalkS;
      uniform sampler2D uNoise;
      attribute float aHead; attribute float aAO; attribute float aCl;
      #ifdef BLOOM_KEY
        attribute float aKey;
      #endif
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vAO; varying float vHead; varying vec3 vL; varying float vGlow;
      varying float vBlossom; varying float vHue; varying float vCl;
      void main() {
        vCl = aCl;
        vec3 p = position;
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        vec3 ipos = (modelMatrix * im[3]).xyz;
        float scaleY = length(im[1].xyz);
        float h = max(p.y, 0.0);
        float ph = dot(ipos.xz, vec2(0.13, 0.17));
        // the bloom reaches this tree: by the wave from the flower, or as she walks past
        float dw = length(ipos.xz - uBloomC.xz);
        float bl = smoothstep(dw - 4.0, dw + 10.0, uBloomR);
        #ifdef BLOOM_KEY
          bl = max(bl, smoothstep(aKey - 14.0, aKey - 2.0, uWalkS));
        #endif
        vBlossom = bl;
        vHue = fract(sin(dot(ipos.xz, vec2(12.9898, 78.233))) * 43758.5453);
        // a joyful swell of the crown as it bursts into flower
        p += normal * sin(bl * 3.14159) * 0.075 * aHead;
        vec4 w = modelMatrix * im * vec4(p, 1.0);
        // the bloom's shockwave shakes the crown as it rolls past
        float rdT = length(ipos.xz - uRipple.xz);
        float hitT = exp(-pow((rdT - uRipple.w) / (2.5 + uRipple.w * 0.03), 2.0)) * min(uRippleAmt, 1.0);
        float behindT = uRipple.w - rdT;
        float wobT = behindT > 0.0 ? exp(-behindT * 0.12) * sin(behindT * 0.55) * min(uRippleAmt, 1.0) : 0.0;
        vec2 awayT = (ipos.xz - uRipple.xz) / max(rdT, 0.01);
        w.xz += awayT * (hitT - wobT * 0.4) * h * h * scaleY * 0.05;
        // crowns lean and breathe in the wind, more at the top
        float sw = sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 1.7 + ph * 1.3) * 0.25 + sin(uTime * 4.1 + p.x * 9.0 + p.z * 7.0 + ph) * 0.12 * aHead;
        float bend = uWind * uSway * h * h * scaleY;
        w.x += sw * bend * 0.05;
        w.z += cos(uTime * 0.8 + ph) * bend * 0.03;
        // gusts (the same patches of stronger wind that roll over the meadow): the crown
        // leans downwind and its leaves shiver
        {
          vec2 wd = vec2(0.943, 0.333);
          vec2 gq = ipos.xz * 0.019 - wd * uTime * 0.15;
          float gust = smoothstep(0.4, 0.85, texture2D(uNoise, gq).r) * clamp(uWind * 1.6, 0.0, 1.0);
          w.xz += wd * gust * bend * (0.05 + 0.012 * sin(uTime * 3.3 + ph * 2.0));
          // (a function of position only, so faces that share a corner move together)
          w.xz += vec2(sin(uTime * 9.0 + p.y * 7.0 + p.x * 5.0 + ph), cos(uTime * 8.1 + p.x * 6.0 + p.z * 5.0 + ph)) * gust * 0.006 * aHead * scaleY;
        }
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        #ifdef USE_INSTANCING_COLOR
          vCol = mix(uStem, instanceColor, aHead);
        #else
          vCol = mix(uStem, vec3(1.0), aHead);
        #endif
        vAO = aAO; vHead = aHead;
        vL = p * 3.0 + vec3(ph * 3.1, 0.0, ph * 1.7);
        float rd = length(ipos.xz - uRipple.xz);
        vGlow = exp(-pow((rd - uRipple.w) / (0.9 + uRipple.w * 0.04), 2.0)) * uRippleAmt * 0.45;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uBase, uShade; uniform float uFleck, uBloom, uEmit, uLift, uFogScale;
      uniform vec3 uBlossomA, uBlossomB;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vAO; varying float vHead; varying vec3 vL; varying float vGlow;
      varying float vBlossom; varying float vHue; varying float vCl;
      // little five-petalled flowers on a 3D cell grid (object space): x cover, y the
      // flower's own random, z its heart
      vec3 blooms(vec3 q, float dens, float px) {
        vec3 c = floor(q);
        vec3 f = fract(q) - 0.5;
        vec3 h = fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
        vec3 d3 = f - (h - 0.5) * 0.3;
        float d = length(d3);
        // petals: a five-lobed outline around the axis the flower faces
        float a = atan(d3.y, d3.x + d3.z * 0.7);
        float rr = (0.27 + 0.08 * h.z) * (0.78 + 0.22 * cos(5.0 * a + h.y * 6.28));
        float crisp = smoothstep(0.75, 0.3, px);
        float m = mix(dens * 0.55, smoothstep(rr + 0.04 + 0.05 * px, rr - 0.02 - 0.05 * px, d), crisp) * step(h.x, dens);
        float heart = smoothstep(0.09, 0.05, d) * crisp;
        return vec3(m, h.y, heart);
      }
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSunDir);
        // leafy flecks in object space (stay put as the tree sways)
        float n1 = texture2D(uNoise, vL.xz * 0.9 + vL.y * 0.7).g;
        float n2 = texture2D(uNoise, vL.xy * 2.1 + vL.z * 0.5 + 0.3).b;
        float fl = (n1 * 0.6 + n2 * 0.4 - 0.5) * uFleck * vHead;
        float l = smoothstep(-0.35, 0.5, ndl + fl * 0.9) * mix(0.5, 1.0, vAO);
        l = clamp(l + fl * 0.25, 0.0, 1.0);
        vec3 base = uBase * vCol;
        // each leaf clump a slightly different tone (painterly variety)
        base *= mix(1.0, 0.9 + 0.2 * vCl, vHead);
        base = mix(base, base * vec3(1.04, 1.0, 0.92), (vCl - 0.5) * 0.6 * vHead);
        vec3 col = base * mix(uShade * uShadowTint * (0.55 + 0.45 * vAO), uLightTint * 1.06, l);
        // a soft band of light on the tops of the clumps
        col += base * uLightTint * smoothstep(0.5, 0.85, ndl + fl * 0.4) * 0.14 * vHead * vAO;
        // sunlit tips catch a warm, yellow-green light
        col += base * uSunCol * uLift * smoothstep(0.35, 0.9, ndl + fl * 0.5) * vAO * vAO * vHead;
        // blossom flecks: brighter petals catching the light
        col = mix(col, col * 1.18 + vec3(0.05, 0.04, 0.045), smoothstep(0.62, 0.72, n2) * uBloom * vHead);
        // burst of blossom over the crown once the bloom has reached it: round flowers
        // scattered through the foliage (cells in object space), fading to a tint far away
        #ifdef NEEDLES
        // conifers do not flower: the bloom passing just freshens their tips
        col = mix(col, col * vec3(1.04, 1.12, 1.0) + vec3(0.01, 0.025, 0.005), vBlossom * vHead * smoothstep(0.4, 0.9, vAO) * 0.8);
        #else
        if (vBlossom > 0.001) {
          // the crown bursts into flower: clusters of little five-petalled blossoms
          // (blossom trees are smothered in them; green trees get a scattering)
          vec3 q = vL * 4.6;
          float px = length(fwidth(q));
          float dens = mix(0.22, 0.85, uBloom) * vBlossom * smoothstep(0.2, 0.55, vAO);
          vec3 b1 = blooms(q, dens, px);
          vec3 b2 = blooms(q * 1.7 + 0.37, dens * 0.8, px * 1.7);
          vec3 b = b1.x >= b2.x ? b1 : b2;
          vec3 bc = mix(uBlossomA, uBlossomB, step(0.5, b.y));
          bc = mix(bc, vec3(1.0, 0.98, 0.97), step(0.82, b.y) * 0.9);
          bc = mix(bc, vec3(1.0, 0.82, 0.4), b.z * 0.85);
          vec3 blc = bc * mix(uShade * uShadowTint * 1.25, uLightTint * 1.1, smoothstep(-0.5, 0.6, ndl)) * mix(0.72, 1.0, vAO);
          col = mix(col, blc, b.x * vHead);
        }
        #endif
        // sky fill from above, light through the leaves when backlit
        col += base * vec3(0.035, 0.05, 0.08) * max(N.y, 0.0) * vHead;
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        col += base * uSunCol * back * 0.3 * vHead * (0.35 + 0.65 * vAO);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += uSunCol * rim * 0.07 * vAO * vHead * smoothstep(-0.2, 0.5, ndl);
        col += uGold * vGlow * 0.9;
        col += base * uEmit * (0.35 + 0.65 * uNight);
        col += base * pointLight(vW, N) * 1.4;
        col = applyFogK(col, vW, uFogScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}
