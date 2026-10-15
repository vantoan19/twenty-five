import * as THREE from 'three';
import { heightAt, normalAt, GARDEN, ARCH, FLOWER, CLEARING, CAKE, ISLANDS, CLOUD_TOP, CLOUD_BASE, valleyRiverX, FLIGHT } from './world.js';
import { mulberry32, TAU, clamp, smoothstep, lerp } from './math.js';
import { foliageMaterial, cloudSeaMaterial, mistVeilMaterial, terrainMaterial } from './shaders.js';
import { heroHeight, HERO } from './mountains.js';
import { CloudSprites } from './clouds.js';
import { sampleNoise } from './noisetex.js';
import { spruceGeometry, crownTreeGeometry, puffyTreeGeometry, cypressGeometry2, bushGeometry, treeMaterial } from './trees.js';
import { meadowMaterial, grassClumpGeometry, buckwheatGeometry2, daisyGeometry, cosmosGeometry, lavenderGeometry, forgetMeNotGeometry, cupFlowerGeometry, posyGeometry } from './meadow.js';
import { mergeGeometries } from './terrain.js';
import { blossomGeometry, blossomMaterial } from './blossoms.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// geometry helpers
function toIndexed(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
function withHead(g, head) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n).fill(head);
  g.setAttribute('aHead', new THREE.BufferAttribute(a, 1));
  return g;
}
function mergeWithAttr(geos) {
  // merge position/normal/aHead (+index)
  let nv = 0, ni = 0;
  geos.forEach((g) => { toIndexed(g); nv += g.attributes.position.count; ni += g.index.count; });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), head = new Float32Array(nv), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  geos.forEach((g) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.aHead) head.set(g.attributes.aHead.array, vo);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aHead', new THREE.BufferAttribute(head, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
function jitter(g, amt, seed, smooth = true) {
  if (g.index) g = g.toNonIndexed();
  const rnd = mulberry32(seed);
  const p = g.attributes.position;
  // consistent displacement for shared positions
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) { d = [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt, (rnd() - 0.5) * amt]; map.set(key, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  if (smooth) {
    g.deleteAttribute('normal');
    if (g.attributes.uv) g.deleteAttribute('uv');
    const m = mergeVertices(g, 1e-3);
    m.computeVertexNormals();
    return m;
  }
  g.computeVertexNormals();
  return g;
}

// Unit-height plant geometries --------------------------------------------
export function firGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.25, 5); trunk.translate(0, 0.12, 0);
  parts.push(withHead(trunk, 0));
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const r = 0.36 * (1 - f * 0.68), h = 0.42 * (1 - f * 0.3);
    const c = new THREE.ConeGeometry(r, h, 7, 1);
    c.translate(0, 0.2 + f * 0.62 + h / 2, 0);
    parts.push(withHead(jitter(c, 0.03, 11 + i), 1));
  }
  return mergeWithAttr(parts);
}
export function roundTreeGeometry(seed = 1) {
  const trunk = new THREE.CylinderGeometry(0.03, 0.05, 0.5, 5); trunk.translate(0, 0.25, 0);
  const canopy = new THREE.IcosahedronGeometry(0.3, 1); canopy.scale(1, 0.85, 1); canopy.translate(0, 0.68, 0);
  const c2 = new THREE.IcosahedronGeometry(0.2, 1); c2.translate(0.16, 0.6, 0.06);
  const c3 = new THREE.IcosahedronGeometry(0.19, 1); c3.translate(-0.14, 0.62, -0.08);
  return mergeWithAttr([withHead(trunk, 0), withHead(jitter(canopy, 0.06, seed), 1), withHead(jitter(c2, 0.05, seed + 1), 1), withHead(jitter(c3, 0.05, seed + 2), 1)]);
}
export function cypressGeometry() {
  const trunk = new THREE.CylinderGeometry(0.02, 0.035, 0.15, 5); trunk.translate(0, 0.07, 0);
  const body = new THREE.IcosahedronGeometry(0.5, 1); body.scale(0.22, 1, 0.22); body.translate(0, 0.55, 0);
  return mergeWithAttr([withHead(trunk, 0), withHead(jitter(body, 0.025, 5), 1)]);
}
export function shrubGeometry(seed = 3) {
  const a = new THREE.IcosahedronGeometry(0.5, 1); a.scale(1, 0.75, 1); a.translate(0, 0.3, 0);
  const b = new THREE.IcosahedronGeometry(0.34, 1); b.translate(0.35, 0.22, 0.1);
  const c = new THREE.IcosahedronGeometry(0.3, 1); c.translate(-0.3, 0.2, -0.15);
  return mergeWithAttr([withHead(jitter(a, 0.1, seed), 1), withHead(jitter(b, 0.08, seed + 1), 1), withHead(jitter(c, 0.08, seed + 2), 1)]);
}
export function flowerGeometry(petals = 5) {
  // stem: two crossed thin quads
  const parts = [];
  for (let k = 0; k < 2; k++) {
    const s = new THREE.PlaneGeometry(0.012, 0.32, 1, 2);
    s.translate(0, 0.16, 0); s.rotateY(k * Math.PI / 2);
    parts.push(withHead(s, 0));
  }
  // petals: a little star cup
  const pos = [];
  const cy = 0.32;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU;
    const a1 = a - 0.42, a2 = a + 0.42;
    const r = 0.055;
    pos.push(0, cy, 0, Math.cos(a1) * r * 0.55, cy + 0.012, Math.sin(a1) * r * 0.55, Math.cos(a) * r, cy + 0.022, Math.sin(a) * r);
    pos.push(0, cy, 0, Math.cos(a) * r, cy + 0.022, Math.sin(a) * r, Math.cos(a2) * r * 0.55, cy + 0.012, Math.sin(a2) * r * 0.55);
  }
  const head = new THREE.BufferGeometry();
  head.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  head.computeVertexNormals();
  const n = head.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.4, 1, n.getZ(i) * 0.4);
  parts.push(withHead(head, 1));
  const bud = new THREE.TetrahedronGeometry(0.02, 0); bud.translate(0, cy + 0.02, 0);
  parts.push(withHead(bud, 0.55));
  return mergeWithAttr(parts);
}
export function buckwheatGeometry() {
  const parts = [];
  const rnd = mulberry32(77);
  for (let k = 0; k < 4; k++) {
    const h = 0.36 + rnd() * 0.26;
    const st = new THREE.PlaneGeometry(0.012, h, 1, 1);
    const lean = (rnd() - 0.5) * 0.5, rot = rnd() * TAU;
    st.translate(0, h / 2, 0); st.rotateZ(lean); st.rotateY(rot);
    parts.push(withHead(st, 0));
    if (k < 2) {
      const lf = new THREE.CircleGeometry(0.05, 4);
      lf.scale(1, 1.25, 1); lf.rotateX(-1.1); lf.translate(0, h * 0.45, 0.03); lf.rotateZ(lean * 0.5); lf.rotateY(rot + 1.3);
      parts.push(withHead(lf, 0));
    }
    const tip = new THREE.Vector3(0, h, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), lean).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    for (let j = 0; j < 5; j++) {
      const bl = new THREE.TetrahedronGeometry(0.03 + rnd() * 0.014, 0);
      bl.translate(tip.x + (rnd() - 0.5) * 0.09, tip.y + (rnd() - 0.6) * 0.08, tip.z + (rnd() - 0.5) * 0.09);
      parts.push(withHead(bl, 1));
    }
  }
  return mergeWithAttr(parts);
}
export function grassGeometry() {
  const pos = [];
  const rnd = mulberry32(5);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * TAU, lean = 0.15 + rnd() * 0.25, h = 0.28 + rnd() * 0.22, w = 0.03;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * w, pz = dx * w;
    const tx = dx * lean * h, tz = dz * lean * h;
    pos.push(px, 0, pz, -px, 0, -pz, tx, h, tz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return mergeWithAttr([withHead(g, 1)]);
}
export function rockGeometry(seed) {
  // a weathered boulder: rounded, a little flattened, settled into the ground (its top
  // takes moss and grass from the terrain shading)
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  g.scale(1, 0.62, 0.85);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.12) p.setY(i, -0.12 + (p.getY(i) + 0.12) * 0.3);
  return jitter(g, 0.14, seed, true);
}

// Foliage material variant that tints only the "head" vertices with instance color
export function plantMaterial(U, opts) {
  const m = foliageMaterial(U, opts);
  m.uniforms.uStem = { value: new THREE.Color(opts.stem || '#4f7a3a') };
  m.vertexShader = m.vertexShader
    .replace('varying vec3 vW;', 'attribute float aHead; uniform vec3 uStem; varying vec3 vW;')
    .replace('vCol = instanceColor;', 'vCol = mix(uStem, instanceColor, aHead);')
    .replace('vCol = vec3(1.0);', 'vCol = mix(uStem, vec3(1.0), aHead);');
  return m;
}

// ---------------------------------------------------------------------------
// Scatter helper with a spatial grid to keep plants off the walking path
export class PathGrid {
  constructor(path, s0, s1, cell = 4) {
    this.cell = cell; this.map = new Map();
    for (let s = s0; s <= s1; s += 0.7) {
      const p = path.posAt(s);
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(p.x, p.z);
    }
  }
  dist(x, z) {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = 1e9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.map.get(`${cx + i},${cz + j}`);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const d = (arr[k] - x) ** 2 + (arr[k + 1] - z) ** 2;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }
}

// chunk = { cell, maxDist, reg }: split the instances into spatial cells, each
// its own InstancedMesh with a tight bounding sphere, so whatever is behind or
// far from the camera is skipped (app.js precomputes, along the camera's path,
// which chunks can be seen at each moment)
function instanced(geo, mat, items, colorFn, keyFn, chunk) {
  if (chunk && items.length > 40) {
    const cells = new Map();
    for (const it of items) {
      const k = Math.floor(it.x / chunk.cell) + ',' + Math.floor(it.z / chunk.cell);
      let a = cells.get(k);
      if (!a) cells.set(k, (a = []));
      a.push(it);
    }
    if (cells.size > 1) {
      const g = new THREE.Group();
      // merge tiny cells into a neighbour-free leftover chunk to save draw calls
      const small = [];
      for (const part of cells.values()) {
        if (part.length < 12) { small.push(...part); continue; }
        const m = instanced(geo, mat, part, colorFn, keyFn);
        m.userData.maxDist = chunk.maxDist;
        chunk.reg.push(m);
        g.add(m);
      }
      if (small.length) {
        const m = instanced(geo, mat, small, colorFn, keyFn);
        m.userData.maxDist = chunk.maxDist;
        chunk.reg.push(m);
        g.add(m);
      }
      return g;
    }
  }
  let minKey = -1e9;
  if (keyFn) {
    // a per-instance key (bloom distance or path position) needs its own geometry
    geo = geo.clone();
    const k = new Float32Array(items.length);
    minKey = 1e9;
    items.forEach((it, i) => { k[i] = keyFn(it); minKey = Math.min(minKey, k[i]); });
    geo.setAttribute('aKey', new THREE.InstancedBufferAttribute(k, 1));
  }
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    e.set(it.tx || 0, it.ry || 0, it.tz || 0);
    q.setFromEuler(e);
    s.set(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s);
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (colorFn) { colorFn(it, col); mesh.setColorAt(i, col); }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData.minKey = minKey;
  return mesh;
}
export { instanced };
// a few shapes of each kind, so neighbours never look cloned
function splitMesh(list, geos, mat, grp, keyFn, chunk) {
  geos.forEach((g, k) => {
    const part = list.filter((_, i) => i % geos.length === k);
    if (part.length) grp.add(instanced(g, mat, part, (it, c) => c.set(it.c), keyFn, chunk));
  });
}

const PAL = {
  lavender: ['#b8a6e3', '#c9b8ee', '#a796d8'],
  ivory: ['#fbf6ea', '#f3ead6', '#fffaf0'],
  blush: ['#f2b9c8', '#f6c9d3', '#eaa6b9'],
  sky: ['#a9c9ee', '#bcd6f3'],
  gold: ['#f3d9a4', '#efcf8a'],
  buck: ['#f9d3e0', '#f4bccf', '#fde4ec', '#f0aec6', '#fff1f5'],
};
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

// ---------------------------------------------------------------------------
export function buildVegetation(U, path, wp, quality, camPts = []) {
  const group = new THREE.Group();
  // keep tall plants out of the camera's way
  const camGrid = new Map();
  camPts.forEach(([x, y, z]) => {
    const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
    if (!camGrid.has(k)) camGrid.set(k, []);
    camGrid.get(k).push(x, y, z);
  });
  const nearCam = (x, z, r, top) => {
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    const gy = heightAt(x, z);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = camGrid.get(`${cx + i},${cz + j}`);
      if (!a) continue;
      for (let k = 0; k < a.length; k += 3) {
        if (a[k + 1] > gy + top + 2) continue;
        if ((a[k] - x) ** 2 + (a[k + 2] - z) ** 2 < r * r) return true;
      }
    }
    return false;
  };
  // distance from each spot to the nearest camera position over the whole journey
  // (the camera is known ahead of time): plants it never comes near get a simpler shape
  const CF = { x0: -330, z0: -1070, step: 4 };
  CF.nx = Math.ceil(680 / CF.step); CF.nz = Math.ceil(1020 / CF.step);
  CF.d = new Float32Array(CF.nx * CF.nz).fill(1e9);
  const CR = 80;
  camPts.forEach(([x, y, z]) => {
    const dy = y - heightAt(x, z);
    if (dy > CR) return;
    const i0 = Math.max(0, Math.floor((x - CR - CF.x0) / CF.step)), i1 = Math.min(CF.nx - 1, Math.ceil((x + CR - CF.x0) / CF.step));
    const j0 = Math.max(0, Math.floor((z - CR - CF.z0) / CF.step)), j1 = Math.min(CF.nz - 1, Math.ceil((z + CR - CF.z0) / CF.step));
    for (let j = j0; j <= j1; j++) {
      const cz = CF.z0 + j * CF.step - z;
      for (let i = i0; i <= i1; i++) {
        const cx = CF.x0 + i * CF.step - x;
        const d2 = cx * cx + cz * cz + dy * dy;
        const k = j * CF.nx + i;
        if (d2 < CF.d[k]) CF.d[k] = d2;
      }
    }
  });
  const camDist = (x, z) => {
    const i = Math.round((x - CF.x0) / CF.step), j = Math.round((z - CF.z0) / CF.step);
    if (i < 0 || j < 0 || i >= CF.nx || j >= CF.nz) return 1e9;
    return Math.sqrt(CF.d[j * CF.nx + i]) - CF.step * 0.75;
  };
  // how close the camera comes to each spot while looking its way, over a stretch of the
  // journey (where the flower carpet is worth planting thickly)
  const viewDist = (t0, t1, maxR = 72) => {
    const G = { x0: -330, z0: -1070, step: 2 };
    G.nx = Math.ceil(680 / G.step); G.nz = Math.ceil(1020 / G.step);
    const D = new Float32Array(G.nx * G.nz).fill(1e9);
    for (const c of camPts) {
      if (c.length < 7 || c[6] < t0 || c[6] > t1) continue;
      const [x, y, z, lx, , lz] = c;
      let fx = lx - x, fz = lz - z;
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const dy = Math.max(y - heightAt(x, z), 0);
      const i0 = Math.max(0, Math.floor((x - maxR - G.x0) / G.step)), i1 = Math.min(G.nx - 1, Math.ceil((x + maxR - G.x0) / G.step));
      const j0 = Math.max(0, Math.floor((z - maxR - G.z0) / G.step)), j1 = Math.min(G.nz - 1, Math.ceil((z + maxR - G.z0) / G.step));
      for (let j = j0; j <= j1; j++) {
        const cz = G.z0 + j * G.step - z;
        for (let i = i0; i <= i1; i++) {
          const cx = G.x0 + i * G.step - x;
          const h = Math.hypot(cx, cz);
          if (h > maxR) continue;
          // only what lies ahead of the lens (a wide cone; anything right below it counts)
          if (h > 4 && (cx * fx + cz * fz) / h < 0.3) continue;
          const d = Math.hypot(h, dy);
          const k = j * G.nx + i;
          if (d < D[k]) D[k] = d;
        }
      }
    }
    return (x, z) => {
      const i = Math.round((x - G.x0) / G.step), j = Math.round((z - G.z0) / G.step);
      if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return 1e9;
      return D[j * G.nx + i];
    };
  };
  // the camera's line of sight at each moment: a tree that would stand in the middle of
  // the frame close to the camera is left out (it would hide her and the words)
  const views = camPts.filter((c) => c.length >= 6).map(([x, y, z, lx, ly, lz]) => {
    const dx = lx - x, dy = ly - y, dz = lz - z, l = Math.hypot(dx, dy, dz) || 1;
    return [x, y, z, dx / l, dy / l, dz / l];
  });
  const blocked = [];
  const blocksView = (x, y, z, h, r, cone = 0.13, maxD = 42) => {
    const hit = sightHit(x, y, z, h, r, cone, maxD);
    if (hit) blocked.push([Math.round(x), Math.round(z), Math.round(h)]);
    return hit;
  };
  function sightHit(x, y, z, h, r, cone, maxD) {
    for (const v of views) {
      if (Math.abs(x - v[0]) > maxD + r || Math.abs(z - v[2]) > maxD + r) continue;
      for (const k of [0.25, 0.5, 0.75]) {
        const vx = x - v[0], vy = y + h * k - v[1], vz = z - v[2];
        const f = vx * v[3] + vy * v[4] + vz * v[5];
        if (f < 0.5 || f > maxD) continue;
        const lat = Math.sqrt(Math.max(vx * vx + vy * vy + vz * vz - f * f, 0));
        if (lat - r < f * cone) return true;
      }
    }
    return false;
  }
  // near: a few full shapes; far (never closer than lodDist): one simple shape
  const noLod = typeof window !== 'undefined' && window.__bjNoLOD;
  const plant = (list, geos, lodGeo, lodDist, mat, grp, keyFn, chunkNear, chunkFar, farSink) => {
    if (noLod) lodGeo = null;
    if (quality === 'low' && !keyFn) geos = geos.slice(0, Math.min(geos.length, 2));
    // phones: the simple shapes take over sooner
    if (quality === 'low') lodDist *= 0.65;
    const near = [], far = farSink || [];
    for (const it of list) (lodGeo && camDist(it.x, it.z) > lodDist ? far : near).push(it);
    splitMesh(near, geos, mat, grp, keyFn, chunkNear);
    if (!farSink && far.length) grp.add(instanced(lodGeo, mat, far, (it, c) => c.set(it.c), keyFn, chunkFar));
  };
  // far away, daisies, buttercups, cosmos and forget-me-nots read alike: one
  // simple shape tinted per kind
  const farFlowers = (sink, mat, grp, keyFn, chunkFar) => { if (sink.length) grp.add(instanced(LOD.flower, mat, sink, (it, c) => c.set(it.c), keyFn, chunkFar)); };

  const q = quality === 'low' ? 0.55 : 1;
  const qf = quality === 'low' ? 0.4 : 1;   // flowers
  const qg = quality === 'low' ? 0.32 : 1;   // grass
  const LOD = {
    flower: daisyGeometry(41, { petals: 8, leaves: 0, ring: 4 }),
    lavender: lavenderGeometry(41, { stems: 4, buds: 3, leaves: 1 }),
    buck: buckwheatGeometry2(41, { stems: 2, racemes: 2, florets: 6 }),
    grass: grassClumpGeometry(41, 5, 2),
    fir: spruceGeometry(41, 6, 12),
    round: crownTreeGeometry(41, { detail: 0, clumps: 6 }),
  };
  const rnd = mulberry32(2024);
  const grid = new PathGrid(path, wp.touchdown - 6, wp.cake + 4);
  const groups = { garden: new THREE.Group(), trail: new THREE.Group(), clearing: new THREE.Group(), valley: new THREE.Group(), bloomWave: new THREE.Group(), bloomWalk: new THREE.Group(), grassA: new THREE.Group(), grassB: new THREE.Group() };
  const chunks = [];
  // phones: bigger chunks and a single shape per kind keep the draw count down
  const lowQ = quality === 'low';
  const C = (cell, maxDist) => ({ cell: cell * (lowQ ? 1.7 : 1), maxDist, reg: chunks });
  Object.values(groups).forEach((g) => group.add(g));

  const ground = (x, z) => heightAt(x, z);
  const slopeOK = (x, z, max) => normalAt(x, z)[1] > max;
  // where along her walk (after the flower) each spot is passed; far spots never
  const walkPts = [];
  for (let s = wp.flower; s <= wp.cake + 6; s += 1) { const p = path.posAt(s); walkPts.push([p.x, p.z, s]); }
  const walkKey = (x, z, reach = 45) => {
    let best = 1e9, bs = 1e6;
    for (const [px, pz, s] of walkPts) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < best) { best = d; bs = s; } }
    return Math.sqrt(best) < reach ? bs : 1e6;
  };
  const treeKey = (it) => walkKey(it.x, it.z);

  // --- buckwheat meadow around the landing (her Ha Giang fields) ---
  const buck = [];
  for (let i = 0; i < 2600 * qf; i++) {
    // denser near the path, where the camera walks with her
    const a = rnd() * TAU, r = Math.pow(rnd(), 0.62) * 46;
    const x = 12 + Math.cos(a) * r * 1.15, z = -592 + Math.sin(a) * r * 0.9;
    const dp = grid.dist(x, z);
    if (dp < 1.3) continue;
    if (dp > 9 && rnd() < 0.35) continue;
    buck.push({ x, y: ground(x, z) - 0.02, z, s: 0.95 + rnd() * 0.8, ry: rnd() * TAU, c: pick(rnd, PAL.buck) });
  }
  const buckMat = meadowMaterial(U, { low: lowQ, stem: '#b85d72', leaf: '#5d8c43', shade: '#9b8fb0', sway: 1.3, trans: 0.45, root: 0.55 });
  plant(buck, lowQ
    ? [buckwheatGeometry2(1, { racemes: 2, florets: 6 }), buckwheatGeometry2(2, { racemes: 2, florets: 6 })]
    : [buckwheatGeometry2(1), buckwheatGeometry2(2), buckwheatGeometry2(3)], LOD.buck, 16, buckMat, groups.garden);

  // --- garden flowers: beds of daisies, cosmos, lavender, buttercups, forget-me-nots ---
  const FL = { daisy: [], cosmos: [], lavender: [], gold: [], sky: [] };
  const KIND = { ivory: 'daisy', blush: 'cosmos', lavender: 'lavender', gold: 'gold', sky: 'sky' };
  const COLS = {
    daisy: ['#fffdf6', '#fbf6ea', '#fff8f0'],
    cosmos: ['#f2a7c3', '#f7c6d6', '#e98aad', '#fbe3ea', '#f4b3cb'],
    lavender: ['#9d86d6', '#a893df', '#8f78c9', '#b39ee6'],
    gold: ['#f6d36b', '#f3c34f', '#f8de8a'],
    sky: ['#8fb6ec', '#a9c9f2', '#9cbcf0'],
  };
  const addFlower = (kind, x, z, s) => FL[kind].push({ x, y: ground(x, z), z, s, ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.2, c: pick(rnd, COLS[kind]) });
  const beds = [
    [-13, -606, 8, 'lavender'], [15, -604, 8, 'ivory'], [-18, -620, 9, 'blush'], [18, -622, 10, 'lavender'],
    [-20, -640, 10, 'ivory'], [16, -642, 9, 'blush'], [-17, -662, 7, 'lavender'], [10, -662, 9, 'ivory'],
    [-22, -677, 9, 'blush'], [14, -680, 9, 'lavender'], [-31, -630, 8, 'gold'], [29, -634, 8, 'sky'],
    [-3, -674, 6, 'ivory'], [33, -655, 9, 'ivory'], [-35, -652, 9, 'lavender'], [26, -668, 7, 'blush'],
  ];
  beds.forEach(([bx, bz, br, palName]) => {
    const n = Math.round(br * br * 4.6 * qf);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * br;
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r * 0.85;
      if (grid.dist(x, z) < 1.4) continue;
      if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 1.3) continue;
      const pal = rnd() < 0.14 ? pick(rnd, ['lavender', 'ivory', 'blush']) : palName;
      addFlower(KIND[pal], x, z, (pal === 'lavender' ? 1.3 : 1.05) + rnd() * 0.9);
    }
  });
  // a soft ring of blooms around the little drooping flower
  for (let i = 0; i < 300 * qf; i++) {
    const a = rnd() * TAU, r = 1.3 + Math.pow(rnd(), 0.8) * 7;
    const x = FLOWER.x + Math.cos(a) * r, z = FLOWER.z + Math.sin(a) * r;
    if (grid.dist(x, z) < 0.9) continue;
    addFlower(pick(rnd, ['daisy', 'daisy', 'lavender', 'cosmos', 'sky']), x, z, 0.9 + rnd() * 0.7);
  }
  // borders along the garden path and the lower trail
  for (let i = 0; i < 1900 * qf; i++) {
    const s = wp.touchdown + rnd() * (wp.trailStart + 60 - wp.touchdown);
    const p = path.posAt(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 1.25 + Math.pow(rnd(), 1.5) * 6;
    const d = path.dirAt(s);
    const x = p.x + -d.z * off * side, z = p.z + d.x * off * side;
    if (grid.dist(x, z) < 1.15) continue;
    addFlower(pick(rnd, ['daisy', 'daisy', 'cosmos', 'lavender', 'sky', 'gold']), x, z, 0.85 + rnd() * 0.75);
  }
  const flowerMat = meadowMaterial(U, { low: lowQ, stem: '#5b8a3c', leaf: '#5f8f42', centre: '#f2c14e', shade: '#8f8fb8', sway: 1.5 });
  const lavMat = meadowMaterial(U, { low: lowQ, stem: '#7f9c78', leaf: '#8ba585', centre: '#f2c14e', shade: '#8f8fb8', sway: 1.4 });
  const gFar = [];
  plant(FL.daisy, [daisyGeometry(1), daisyGeometry(2, { heads: 2 }), daisyGeometry(3)], LOD.flower, 18, flowerMat, groups.garden, undefined, undefined, undefined, gFar);
  plant(FL.gold, [daisyGeometry(4, { petals: 10, size: 0.8 }), daisyGeometry(5, { heads: 2, petals: 9, size: 0.75 })], LOD.flower, 18, flowerMat, groups.garden, undefined, undefined, undefined, gFar);
  plant(FL.cosmos, [cosmosGeometry(1), cosmosGeometry(2)], LOD.flower, 18, flowerMat, groups.garden, undefined, undefined, undefined, gFar);
  plant(FL.sky, [forgetMeNotGeometry(1), forgetMeNotGeometry(2)], LOD.flower, 18, flowerMat, groups.garden, undefined, undefined, undefined, gFar);
  farFlowers(gFar, flowerMat, groups.garden);
  plant(FL.lavender, [lavenderGeometry(1), lavenderGeometry(2)], LOD.lavender, 18, lavMat, groups.garden);

  // --- the bloom: flowers rising with the wave from the little flower, then wherever she walks ---
  const KINDS = ['daisy', 'daisy', 'cosmos', 'buck', 'sky', 'gold', 'lavender', 'cosmos', 'cup', 'cup', 'daisy'];
  const BCOLS = { ...COLS, buck: PAL.buck, cup: ['#ff9aae', '#ffb08f', '#ff87ad', '#ffd36e', '#fff1f1', '#f98fa6', '#ffc2d4'] };
  const wave = { daisy: [], cosmos: [], buck: [], sky: [], gold: [], lavender: [], cup: [], posy: [] };
  const trailF = { daisy: [], cosmos: [], buck: [], sky: [], gold: [], lavender: [], cup: [], posy: [] };
  // the bloom spreads over the meadow around the flower, not the whole valley
  const WAVE_R = 46;
  const rs = mulberry32(911);
  for (let i = 0; i < (lowQ ? 700 : 1600); i++) {
    const near = i % 8 < 5;
    const a = rnd() * TAU, r = near ? 1.4 + Math.sqrt(rnd()) * 30 : 30 + Math.sqrt(rnd()) * (WAVE_R - 30);
    const x = FLOWER.x + Math.cos(a) * r, z = FLOWER.z + Math.sin(a) * r;
    if (grid.dist(x, z) < 1.15) continue;
    if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 1.2) continue;
    if (Math.abs(x - valleyRiverX(z)) < 12) continue;
    if (!slopeOK(x, z, 0.8)) continue;
    if (nearCam(x, z, 1.6, 0.8)) continue;
    const kind = pick(rnd, KINDS);
    const big = near ? 1.45 : 1.2;
    wave[kind].push({ x, y: ground(x, z) - 0.01, z, s: big * ((kind === 'lavender' ? 1.15 : 1.0) + rnd() * 0.7), ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.2, c: pick(rnd, BCOLS[kind]), key: r + rnd() * 6 });
  }
  // little posies of mixed colours: the bulk of the bloom (a few times more flowers
  // than the single plants, at a fraction of the cost each)
  for (let i = 0; i < (lowQ ? 2000 : 6000); i++) {
    const near = i % 10 < 6;
    const a = rnd() * TAU, r = near ? 1.3 + Math.sqrt(rnd()) * 34 : 34 + Math.sqrt(rnd()) * (WAVE_R - 34);
    const x = FLOWER.x + Math.cos(a) * r, z = FLOWER.z + Math.sin(a) * r;
    if (grid.dist(x, z) < 1.0) continue;
    if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 1.1) continue;
    if (Math.abs(x - valleyRiverX(z)) < 12) continue;
    if (!slopeOK(x, z, 0.8)) continue;
    if (nearCam(x, z, 1.2, 0.6)) continue;
    const it = { x, y: ground(x, z) - 0.01, z, s: (near ? 1.4 : 1.2) * (0.85 + rnd() * 0.5), ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.25, c: '#ffffff', key: r + rnd() * 5 };
    // the flower carpet covers the meadow; these modelled posies stay only where the
    // camera comes close enough to see them as more than dots
    if (camDist(x, z) > 16 || rs() < (lowQ ? 0.6 : 0.42)) continue;
    wave.posy.push(it);
  }
  for (let i = 0; i < (lowQ ? 900 : 2400); i++) {
    const s = wp.flower + 1 + rnd() * (wp.cake - wp.flower - 1);
    const p = path.posAt(s); const d = path.dirAt(s);
    const off = (rnd() < 0.5 ? -1 : 1) * (0.95 + Math.pow(rnd(), 1.4) * 3.4);
    const x = p.x - d.z * off + (rnd() - 0.5) * 0.6, z = p.z + d.x * off + (rnd() - 0.5) * 0.6;
    if (grid.dist(x, z) < 0.9) continue;
    if (Math.hypot(x - CAKE.x, z - CAKE.z) < 2.2) continue;
    if (z < -872 && x > -75 && x < 10) continue;
    if (nearCam(x, z, 1.3, 0.8)) continue;
    const kind = pick(rnd, KINDS);
    trailF[kind].push({ x, y: ground(x, z) - 0.01, z, s: (kind === 'lavender' ? 1.2 : 1.0) + rnd() * 0.75, ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.2, c: pick(rnd, BCOLS[kind]), key: s + (rnd() - 0.35) * 2.5 });
  }
  // wherever she walks: posies all along both sides of her path, opening as she passes
  // (the farther from the path, the later, so the bloom spreads out from her)
  for (let i = 0; i < (lowQ ? 2500 : 8000); i++) {
    const s = wp.flower + 1 + rnd() * (wp.cake - wp.flower - 1);
    const p = path.posAt(s); const d = path.dirAt(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = side * (0.85 + Math.pow(rnd(), 1.5) * 6.5);
    const x = p.x - d.z * off + (rnd() - 0.5) * 0.5, z = p.z + d.x * off + (rnd() - 0.5) * 0.5;
    if (grid.dist(x, z) < 0.8) continue;
    if (Math.hypot(x - CAKE.x, z - CAKE.z) < 2.2) continue;
    if (z < -872 && x > -75 && x < 10) continue;
    if (!slopeOK(x, z, 0.7)) continue;
    if (nearCam(x, z, 1.2, 0.6)) continue;
    const it = { x, y: ground(x, z) - 0.01, z, s: 1.0 + rnd() * 0.55, ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.25, c: '#ffffff', key: s + (rnd() - 0.4) * 1.6 + Math.abs(off) * 0.3 };
    if (Math.abs(off) > 3.4 || rs() < (lowQ ? 0.55 : 0.38)) continue;
    trailF.posy.push(it);
  }
  // and little flowers springing up from her footsteps, just behind her
  for (let s = wp.flower + 1.5; s < wp.cake - 1; s += lowQ ? 1.1 : 0.7) {
    const p = path.posAt(s); const d = path.dirAt(s);
    const side = Math.round(s / 0.7) % 2 ? 1 : -1;
    const off = side * (0.3 + rnd() * 0.25);
    const x = p.x - d.z * off, z = p.z + d.x * off;
    if (Math.hypot(x - CAKE.x, z - CAKE.z) < 2.2) continue;
    if (nearCam(x, z, 1.0, 0.5)) continue;
    trailF.posy.push({ x, y: ground(x, z) - 0.01, z, s: 0.55 + rnd() * 0.25, ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.2, c: '#ffffff', key: s + 0.5 });
  }
  // --- the flower carpet (blossoms.js): clusters of little flowers, thickest wherever
  // the camera looks during the bloom and along her walk, bigger where it stays far ---
  const rb = mulberry32(5150);
  const carpet = { wave: [], walk: [] };
  const vdWave = viewDist(0.456, 0.585), vdWalk = viewDist(0.5, 1.0);
  const keepAt = (vd, near, fall, floor) => (vd < near ? 1 : Math.max(floor, Math.exp(-(vd - near) / fall)));
  const nWave = lowQ ? 3000 : 9000;
  for (let i = 0; i < nWave * 12 && carpet.wave.length < nWave; i++) {
    const a = rb() * TAU, r = 0.9 + Math.sqrt(rb()) * (WAVE_R - 0.9);
    const x = FLOWER.x + Math.cos(a) * r, z = FLOWER.z + Math.sin(a) * r;
    const vd = vdWave(x, z);
    if (vd > 72 || rb() > keepAt(vd, 9, 15, 0.03)) continue;
    if (grid.dist(x, z) < 0.7) continue;
    if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 0.85) continue;
    if (Math.abs(x - valleyRiverX(z)) < 12) continue;
    if (!slopeOK(x, z, 0.74)) continue;
    if (nearCam(x, z, 0.7, 0.45)) continue;
    carpet.wave.push({ x, y: ground(x, z) - 0.01, z, s: (0.92 + rb() * 0.42) * (1 + Math.min(Math.max(vd - 10, 0) / 22, 1.6)), ry: rb() * TAU, key: r + rb() * 2.5 });
  }
  const nWalk = lowQ ? 4000 : 11000;
  for (let i = 0; i < nWalk * 5 && carpet.walk.length < nWalk; i++) {
    const s = wp.flower + 0.6 + rb() * (wp.cake - wp.flower - 0.6);
    const p = path.posAt(s), d = path.dirAt(s);
    const off = (rb() < 0.5 ? -1 : 1) * (0.6 + Math.pow(rb(), 1.7) * 5.0);
    const x = p.x - d.z * off + (rb() - 0.5) * 0.4, z = p.z + d.x * off + (rb() - 0.5) * 0.4;
    const vd = vdWalk(x, z);
    if (vd > 50 || rb() > keepAt(vd, 10, 12, 0.02)) continue;
    if (grid.dist(x, z) < 0.6) continue;
    if (Math.hypot(x - CAKE.x, z - CAKE.z) < 2.0) continue;
    if (z < -872 && x > -75 && x < 10) continue;
    if (!slopeOK(x, z, 0.7)) continue;
    if (nearCam(x, z, 0.7, 0.45)) continue;
    carpet.walk.push({ x, y: ground(x, z) - 0.01, z, s: (0.88 + rb() * 0.4) * (1 + Math.min(Math.max(vd - 10, 0) / 22, 1.2)), ry: rb() * TAU, key: s + (rb() - 0.45) * 1.0 + Math.abs(off) * 0.2 });
  }
  // and springing from her footsteps, just behind her
  for (let s = wp.flower + 1.0; s < wp.cake - 0.8; s += 0.37) {
    const p = path.posAt(s), d = path.dirAt(s);
    const off = (Math.round(s / 0.37) % 2 ? 1 : -1) * (0.24 + rb() * 0.3);
    const x = p.x - d.z * off, z = p.z + d.x * off;
    if (Math.hypot(x - CAKE.x, z - CAKE.z) < 2.0) continue;
    carpet.walk.push({ x, y: ground(x, z) - 0.01, z, s: 0.6 + rb() * 0.22, ry: rb() * TAU, key: s + 0.25 + rb() * 0.3 });
  }

  const growMats = [];
  const mk = (opts) => { const m = meadowMaterial(U, { low: lowQ, ...opts }); growMats.push(m); return m; };
  const plantSet = (set, growW, mode, grp, ch, chFar) => {
    const fm = mk({ stem: '#5b8a3c', leaf: '#5f8f42', centre: '#f2c14e', shade: '#8f8fb8', sway: 1.5, grow: true, growW });
    const lm = mk({ stem: '#7f9c78', leaf: '#8ba585', centre: '#f2c14e', shade: '#8f8fb8', sway: 1.4, grow: true, growW });
    const bm = mk({ stem: '#b0475a', leaf: '#5d8c43', shade: '#9b8fb0', sway: 1.3, trans: 0.45, root: 0.55, grow: true, growW });
    const pm = mk({ stem: '#5b8a3c', leaf: '#5f8f42', centre: '#f6c94e', shade: '#8f8fb8', sway: 1.6, trans: 0.4, grow: true, growW, multi: true });
    [fm, lm, bm, pm].forEach((m) => { m.userData.growMode = mode; });
    const key = (it) => it.key;
    const far = [];
    plant(set.daisy, [daisyGeometry(22, { heads: 2, round: true, petals: 8 })], LOD.flower, 20, fm, grp, key, ch, chFar, far);
    plant(set.cup, lowQ ? [cupFlowerGeometry(21)] : [cupFlowerGeometry(21), cupFlowerGeometry(22, { petals: 5 })], LOD.flower, 20, fm, grp, key, ch, chFar, far);
    plant(set.gold, [daisyGeometry(23, { petals: 10, size: 0.8 })], LOD.flower, 20, fm, grp, key, ch, chFar, far);
    plant(set.cosmos, [cosmosGeometry(21)], LOD.flower, 20, fm, grp, key, ch, chFar, far);
    plant(set.sky, [forgetMeNotGeometry(21)], LOD.flower, 20, fm, grp, key, ch, chFar, far);
    farFlowers(far, fm, grp, key, chFar);
    plant(set.lavender, [lavenderGeometry(21)], LOD.lavender, 20, lm, grp, key, ch, chFar);
    plant(set.buck, [buckwheatGeometry2(21)], LOD.buck, 20, bm, grp, key, ch, chFar);
    plant(set.posy, posyGeos, posyFar, 22, pm, grp, key, ch, chFar);
  };
  const posyGeos = lowQ
    ? [posyGeometry(31, { heads: 3, style: 'kite' })]
    : [posyGeometry(31, { heads: 3 }), posyGeometry(33, { heads: 2, size: 1.15, h: 0.34 })];
  const posyFar = posyGeometry(34, { heads: 3, style: 'wedge', leaves: 0 });
  plantSet(wave, 7, 'wave', groups.bloomWave, C(56, 130), C(110, 150));
  plantSet(trailF, 3.5, 'walk', groups.bloomWalk, C(64, 130), C(120, 150));
  const blGeo = blossomGeometry(1, 3, 0.2), blGeoFar = blossomGeometry(1, 3, 0.2, false);
  const carpetMat = (mode) => { const m = blossomMaterial(U, { grow: true, lowQ }); m.userData.growMode = mode; growMats.push(m); return m; };
  const plantCarpet = (list, vd, mode, grp, cNear, cFar) => {
    const mat = carpetMat(mode);
    const near = list.filter((it) => vd(it.x, it.z) < 34), far = list.filter((it) => vd(it.x, it.z) >= 34);
    if (near.length) grp.add(instanced(blGeo, mat, near, null, (it) => it.key, cNear));
    if (far.length) grp.add(instanced(blGeoFar, mat, far, null, (it) => it.key, cFar));
  };
  plantCarpet(carpet.wave, vdWave, 'wave', groups.bloomWave, C(40, 70), C(64, 100));
  plantCarpet(carpet.walk, vdWalk, 'walk', groups.bloomWalk, C(44, 70), C(64, 100));

  // --- a dense carpet of grass along her walk ---
  const grass = [];
  const greens = ['#5f9a43', '#72ac4c', '#4f8a3c', '#82b85a', '#68a447', '#8cc05f'];
  for (let i = 0; i < 15000 * qg; i++) {
    const s = wp.touchdown - 30 + rnd() * (wp.cake + 30 - (wp.touchdown - 30));
    const p = path.posAt(s);
    const d = path.dirAt(s);
    const off = (rnd() - 0.5) * 2 * (1.4 + Math.pow(rnd(), 1.6) * 16);
    const x = p.x - d.z * off + (rnd() - 0.5) * 2, z = p.z + d.x * off + (rnd() - 0.5) * 2;
    if (grid.dist(x, z) < 1.05) continue;
    if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 1.4) continue;
    if (!slopeOK(x, z, 0.72)) continue;
    const nearF = Math.hypot(x - FLOWER.x, z - FLOWER.z) < 9 ? 0.7 : 1;
    grass.push({ x, y: ground(x, z) - 0.03, z, s: (0.5 + rnd() * 0.6) * nearF, ry: rnd() * TAU, c: pick(rnd, greens), ps: s });
  }
  // and a thicker fringe right beside the path, where the camera walks with her
  for (let i = 0; i < 9000 * qg; i++) {
    const s = wp.touchdown + rnd() * (wp.cake + 4 - wp.touchdown);
    const p = path.posAt(s);
    const d = path.dirAt(s);
    const off = (rnd() < 0.5 ? -1 : 1) * (1.15 + Math.pow(rnd(), 1.3) * 4.5);
    const x = p.x - d.z * off + (rnd() - 0.5) * 0.8, z = p.z + d.x * off + (rnd() - 0.5) * 0.8;
    if (grid.dist(x, z) < 1.05) continue;
    if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 1.4) continue;
    if (!slopeOK(x, z, 0.72)) continue;
    grass.push({ x, y: ground(x, z) - 0.03, z, s: 0.42 + rnd() * 0.5, ry: rnd() * TAU, c: pick(rnd, greens), ps: s });
  }
  const grassMat = meadowMaterial(U, { low: lowQ, stem: '#447a38', leaf: '#4f8f40', shade: '#4d6a55', sway: 2.0, root: 0.52, trans: 0.5, grass: true, tip: '#c8e58e', tipAmt: 0.26 });
  // the garden stretch and the climb are on screen at different times
  const cut = wp.trailStart + 8;
  const grassGeos = quality === 'low'
    ? [grassClumpGeometry(1, 7, 2), grassClumpGeometry(2, 7, 2)]
    : [grassClumpGeometry(1, 9, 2), grassClumpGeometry(2, 8, 2), grassClumpGeometry(3, 9, 2)];
  plant(grass.filter((g) => g.ps < cut), grassGeos, LOD.grass, 14, grassMat, groups.grassA, undefined, C(44, 95), C(100, 95));
  plant(grass.filter((g) => g.ps >= cut - 16), grassGeos.map((g) => g.clone()), LOD.grass.clone(), 14, grassMat, groups.grassB, undefined, C(44, 95), C(100, 95));

  // --- trees ---
  const firs = [], rounds = [], blossoms = [], cypress = [], shrubs = [], clearingTrees = [];
  const firGreens = ['#2b4b37', '#30553a', '#274536', '#365e3f'];
  // trail mountain & valley edges
  for (let i = 0; i < 300 * q; i++) {
    const x = -170 + rnd() * 250, z = -700 - rnd() * 175;
    const dp = grid.dist(x, z);
    if (dp < 5) continue;
    if (!slopeOK(x, z, 0.62)) continue;
    // keep the cliff edge & summit view open
    if (z < -846 && x > -75 && x < 10) continue;
    if (Math.hypot(x - CLEARING.x, z - CLEARING.z) < 13) continue;
    if (z < -870) continue;
    const fs = 7 + rnd() * 9;
    if (nearCam(x, z, 6 + fs * 0.25, fs)) continue;
    const ry = rnd() * TAU, c = pick(rnd, firGreens);
    const y = ground(x, z) - 0.3;
    if (blocksView(x, y, z, fs, fs * 0.25)) continue;
    firs.push({ x, y, z, s: fs, ry, c });
  }
  // clearing ring (World 4)
  for (let i = 0; i < 30; i++) {
    const a = Math.PI * (0.02 + rnd() * 0.96);
    const r = 17 + rnd() * 14;
    const x = CLEARING.x + Math.cos(a) * r * 1.2;
    const z = CLEARING.z + Math.sin(a) * r * 0.8 + 3;
    if (grid.dist(x, z) < 5) continue;
    const fs = 6 + rnd() * 6;
    if (nearCam(x, z, 7 + fs * 0.25, fs)) continue;
    const ct = { x, y: ground(x, z) - 0.3, z, s: fs, ry: rnd() * TAU, c: pick(rnd, firGreens) };
    if (blocksView(x, ct.y, z, fs, fs * 0.25)) continue;
    firs.push(ct);
    clearingTrees.push(ct);
  }
  // her flight down into the valley: no tree stands in her way (or brushes her wings)
  const lowFlight = [];
  for (let sf = 0; sf <= wp.touchdown; sf += 1) { const pf = path.posAt(sf); if (pf.y < 70) lowFlight.push([pf.x, pf.y, pf.z]); }
  const inHerWay = (x, z, top, r) => {
    for (const [px, py, pz] of lowFlight) if (py < top + 6 && (px - x) ** 2 + (pz - z) ** 2 < (r + 13) ** 2) return true;
    return false;
  };
  // valley (seen from the flight) & meadow edges
  for (let i = 0; i < 300 * q; i++) {
    const x = -260 + rnd() * 520, z = -300 - rnd() * 360;
    if (grid.dist(x, z) < 8) continue;
    // (not where the ridge comes down: the trees would stand inside it)
    if (heroHeight(x, z) > ground(x, z) - 4) continue;
    const g = Math.hypot((x - GARDEN.x) / GARDEN.rx, (z - GARDEN.z) / GARDEN.rz);
    if (g < 0.92) continue;
    if (Math.abs(x - valleyRiverX(z)) < 16) continue;
    if (!slopeOK(x, z, 0.7)) continue;
    const t = rnd();
    const it = { x, y: ground(x, z) - 0.3, z, s: 8 + rnd() * 10, ry: rnd() * TAU, c: pick(rnd, firGreens) };
    if (nearCam(x, z, 9, it.s)) continue;
    if (inHerWay(x, z, it.y + it.s, it.s * 0.32)) continue;
    const rc = t < 0.6 ? null : pick(rnd, ['#4f7d3f', '#5f8c45', '#456f3a']);
    if (blocksView(x, it.y, z, it.s, it.s * 0.27)) continue;
    if (rc === null) firs.push(it); else rounds.push({ ...it, c: rc });
  }
  // garden blossom trees and cypress
  const gTrees = [[-28, -606], [30, -616], [-34, -646], [32, -652], [-24, -684], [26, -680], [40, -598], [-40, -624]];
  gTrees.forEach(([x, z], i) => {
    if (nearCam(x, z, 5, 7)) return;
    blossoms.push({ x, y: ground(x, z) - 0.2, z, s: 5.5 + rnd() * 2.5, ry: rnd() * TAU, c: pick(rnd, ['#f3b9cd', '#f6c8d7', '#eeb0c6', '#f8d3df']) });
  });
  [[-9, -598], [18, -596], [-20, -672], [20, -660], [-38, -666], [44, -640]].forEach(([x, z]) => {
    if (nearCam(x, z, 4, 6)) return;
    cypress.push({ x, y: ground(x, z) - 0.2, z, s: 4.2 + rnd() * 2, ry: rnd() * TAU, c: pick(rnd, ['#3a6440', '#2f5638']) });
  });
  // shrubs
  for (let i = 0; i < 220 * q; i++) {
    const s = wp.touchdown + rnd() * (wp.cake - wp.touchdown);
    const p = path.posAt(s); const d = path.dirAt(s);
    const off = (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 14);
    const x = p.x - d.z * off, z = p.z + d.x * off;
    if (grid.dist(x, z) < 2.4) continue;
    if (!slopeOK(x, z, 0.65)) continue;
    if (z < -846 && x > -75 && x < 10) continue;
    if (nearCam(x, z, 5.5, 2.5)) continue;
    shrubs.push({ x, y: ground(x, z) - 0.15, z, s: 0.9 + rnd() * 1.6, ry: rnd() * TAU, c: pick(rnd, ['#4b7a3d', '#5a8a45', '#3f6b39', '#6b9a4a']) });
  }
  for (let i = 0; i < 70 * q; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd());
    const x = GARDEN.x + Math.cos(a) * r * GARDEN.rx * 0.85, z = GARDEN.z + Math.sin(a) * r * GARDEN.rz * 0.8;
    if (grid.dist(x, z) < 2.6) continue;
    if (Math.hypot(x - FLOWER.x, z - FLOWER.z) < 4) continue;
    shrubs.push({ x, y: ground(x, z) - 0.1, z, s: 0.7 + rnd() * 0.9, ry: rnd() * TAU, c: pick(rnd, ['#c9b3e6', '#e9b7c6', '#6f9a4a', '#b8a6e3', '#f3dde3', '#5f8c45']) });
  }
  const treeMat = treeMaterial(U, { stem: '#5a4636', shade: '#4f6470', sway: 0.25, fleck: 0.6, bloomKey: true });
  const firMat = treeMaterial(U, { stem: '#5a4636', shade: '#4f6470', sway: 0.25, fleck: 0.6, bloomKey: true, needles: true });
  const blossomMat = treeMaterial(U, { stem: '#6b5040', shade: '#a493b8', sway: 0.25, fleck: 0.5, bloom: 1, bloomKey: true, blossomA: '#fff2f6', blossomB: '#ee8fb2' });
  const bushMat = treeMaterial(U, { stem: '#5a4636', shade: '#56697a', sway: 0.5, fleck: 0.5, bloomKey: true });
  plant(firs, [spruceGeometry(1, 10), spruceGeometry(2, 9), spruceGeometry(3, 11)], LOD.fir, 60, firMat, groups.valley, treeKey, C(120, 1e9), C(200, 1e9));
  plant(rounds, [puffyTreeGeometry(3, { clumps: 16, detail: 1, bump: 0.2 }), puffyTreeGeometry(4, { clumps: 15, crown: [0.4, 0.28, 0.38], detail: 1, bump: 0.2 })], LOD.round, 60, treeMat, groups.valley, treeKey, C(120, 1e9), C(200, 1e9));
  // the garden's blossom trees are seen up close: finer, leafier crowns
  const bd = quality === 'low' ? 1 : 2;
  splitMesh(blossoms, [puffyTreeGeometry(9, { clumps: 22, crown: [0.44, 0.31, 0.44], cy: 0.62, detail: bd, bump: 0.12 }), puffyTreeGeometry(10, { clumps: 20, crown: [0.4, 0.33, 0.42], cy: 0.64, detail: bd, bump: 0.12 })], blossomMat, groups.garden, treeKey);
  splitMesh(cypress, [cypressGeometry2(5), cypressGeometry2(6)], treeMat, groups.garden, treeKey);
  splitMesh(shrubs, [bushGeometry(4), bushGeometry(7)], bushMat, groups.trail, treeKey, C(70, 260));

  // --- trail rocks ---
  const rocks = [];
  for (let i = 0; i < 220 * q; i++) {
    const s = wp.trailStart + rnd() * (wp.cake - wp.trailStart);
    const p = path.posAt(s); const d = path.dirAt(s);
    const off = (rnd() < 0.5 ? -1 : 1) * (1.3 + rnd() * 3.5);
    const x = p.x - d.z * off, z = p.z + d.x * off;
    if (grid.dist(x, z) < 1.2) continue;
    rocks.push({ x, y: ground(x, z) - 0.1, z, s: 0.25 + rnd() * 0.9, ry: rnd() * TAU, tx: (rnd() - 0.5) * 0.4 });
  }
  const rockMat = terrainMaterial(U, { hiStart: 9999 });
  // trail stones: paler, warmer stone than the mountain faces so they don't read as holes
  rockMat.uniforms.uRockD.value.set('#5a605d');
  rockMat.uniforms.uRockM.value.set('#7f857b');
  rockMat.uniforms.uRockL.value.set('#b7b7a5');
  const rockMesh = instanced(rockGeometry(9), rockMat, rocks, undefined, undefined, C(60, 140));
  groups.trail.add(rockMesh);

  // --- clearing flowers (glow softly at twilight) ---
  const cflowers = [];
  for (let i = 0; i < 520 * q; i++) {
    const a = rnd() * TAU, r = 2 + Math.sqrt(rnd()) * (CLEARING.r - 4);
    const x = CLEARING.x + Math.cos(a) * r, z = CLEARING.z + Math.sin(a) * r * 0.75;
    if (grid.dist(x, z) < 1.4) continue;
    if (Math.hypot(x - CAKE.x, z - CAKE.z) < 2.2) continue;
    if (z < -872) continue;
    cflowers.push({ x, y: ground(x, z), z, s: 0.9 + rnd() * 0.8, ry: rnd() * TAU, c: pick(rnd, PAL[pick(rnd, ['lavender', 'lavender', 'ivory', 'gold', 'blush'])]) });
  }
  const cMat = meadowMaterial(U, { low: lowQ, stem: '#4f7a3a', leaf: '#557f40', centre: '#f6cf6a', shade: '#8f8fb8', sway: 1.4, emit: 0.35 });
  splitMesh(cflowers, [daisyGeometry(7), cosmosGeometry(7), daisyGeometry(8, { heads: 2 })], cMat, groups.clearing);

  return { group, groups, chunks, clearingTrees, growMats, blocked, blossomTrees: blossoms, mats: { buckMat, flowerMat, lavMat, grassMat, treeMat, firMat, blossomMat, bushMat, cMat } };
}

// ---------------------------------------------------------------------------
// The flowered arch the angel walks through into the garden
export function buildArch(U, path, wp) {
  const g = new THREE.Group();
  const y0 = heightAt(ARCH.x, ARCH.z);
  const hd = path.headingAt(path.sAtIndex(wp.arch));
  g.position.set(ARCH.x, y0, ARCH.z);
  g.rotation.y = hd;
  const woodMat = plantMaterial(U, { color: '#ffffff', stem: '#f2ece0', shade: '#b7b2c8', sway: 0, paint: 0.3 });
  const parts = [];
  const tor = new THREE.TorusGeometry(1.75, 0.07, 6, 22, Math.PI); tor.rotateY(Math.PI / 2); tor.translate(0, 2.0, 0);
  parts.push(withHead(tor, 0));
  for (const s of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.07, 0.08, 2.0, 6); post.translate(0, 1.0, s * 1.75);
    parts.push(withHead(post, 0));
  }
  g.add(new THREE.Mesh(mergeWithAttr(parts), woodMat));
  // blossoms along the arch
  const rnd = mulberry32(31);
  const items = [];
  for (let i = 0; i < 260; i++) {
    let x, y, z;
    const t = rnd();
    if (t < 0.6) {
      const a = rnd() * Math.PI;
      y = 2.0 + Math.sin(a) * 1.75; z = Math.cos(a) * 1.75;
    } else {
      z = (rnd() < 0.5 ? -1 : 1) * 1.75; y = rnd() * 2.0;
    }
    x = (rnd() - 0.5) * 0.25; y += (rnd() - 0.5) * 0.18; z += (rnd() - 0.5) * 0.18;
    items.push({ x, y, z, s: 0.045 + rnd() * 0.05, c: pick(rnd, [...PAL.blush, ...PAL.ivory, ...PAL.lavender, '#7fae5a', '#6a9a4a']) });
  }
  const bMat = foliageMaterial(U, { color: '#ffffff', shade: '#a59ac0', sway: 0 });
  const bl = instanced(new THREE.IcosahedronGeometry(1, 0), bMat, items, (it, c) => c.set(it.c));
  g.add(bl);
  return g;
}

// ---------------------------------------------------------------------------
// Sea of clouds + sculpted puffs
export function buildClouds(U, peaks, quality, { soft = null, peakMesh = null, peakHeight = null, heroHeight = null, valleyHeight = null, clearPts = null, noise = null } = {}) {
  const group = new THREE.Group();
  // the sea: a displaced, drifting surface
  const lo = quality === 'low';
  const seaGeo = new THREE.PlaneGeometry(3600, 2900, lo ? 120 : 200, lo ? 97 : 161);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = cloudSeaMaterial(U);
  // the sea is deep: it may rise no higher than some metres under the camera and her, all
  // along the way above it (a ceiling over the sea, a soft cone round every point of their
  // path) - until the dive: there she plunges into it, and through it
  let ceil = null;
  if (clearPts && clearPts.length) {
    const X0 = -1800, Z0 = 120 - 1450, W = 3600, D = 2900, NX = 256, NZ = 208;
    const cx = W / (NX - 1), cz = D / (NZ - 1);
    const F = new Float32Array(NX * NZ).fill(1e9);
    const top = CLOUD_BASE + 4 + 62, drop = 16, flat = 26, slope = 0.85;
    for (const [px, py, pz] of clearPts) {
      if (py < CLOUD_BASE + 20 || py > top + drop + 40 || pz < -240) continue;
      const reach = flat + Math.max(0, (top + 4 - (py - drop)) / slope);
      const i0 = Math.max(0, Math.floor((px - reach - X0) / cx)), i1 = Math.min(NX - 1, Math.ceil((px + reach - X0) / cx));
      const j0 = Math.max(0, Math.floor((pz - reach - Z0) / cz)), j1 = Math.min(NZ - 1, Math.ceil((pz + reach - Z0) / cz));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(X0 + i * cx - px, Z0 + j * cz - pz);
        const c = py - drop + Math.max(0, d - flat) * slope;
        const k = j * NX + i;
        if (c < F[k]) F[k] = c;
      }
    }
    const data = new Uint8Array(NX * NZ * 4);
    for (let k = 0; k < NX * NZ; k++) {
      const v = Math.max(0, Math.min(255, Math.round(F[k] - 120)));
      data[k * 4] = v; data[k * 4 + 1] = v; data[k * 4 + 2] = v; data[k * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    seaMat.uniforms.uCeil.value = tex;
    // (texel centres at the grid points)
    seaMat.uniforms.uCeilRect.value.set(X0 - cx * 0.5, Z0 - cz * 0.5, 1 / (cx * NX), 1 / (cz * NZ));
    ceil = { data, X0, Z0, cx, cz, NX, NZ };
  }
  // the height of the sea's surface at (x, z) as the shaders have it (while it lies whole over
  // the valley): for the white-out as the camera passes down through it
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const ceilAt = (x, z) => {
    if (!ceil) return 1e4;
    const { data, X0, Z0, cx, cz, NX, NZ } = ceil;
    const fx = Math.min(NX - 1, Math.max(0, (x - X0) / cx)), fz = Math.min(NZ - 1, Math.max(0, (z - Z0) / cz));
    const i0 = Math.floor(fx), j0 = Math.floor(fz), i1 = Math.min(NX - 1, i0 + 1), j1 = Math.min(NZ - 1, j0 + 1), u = fx - i0, v = fz - j0;
    const g = (i, j) => data[(j * NX + i) * 4];
    return ((g(i0, j0) * (1 - u) + g(i1, j0) * u) * (1 - v) + (g(i0, j1) * (1 - u) + g(i1, j1) * u) * v) + 120 - (CLOUD_BASE + 4);
  };
  const seaTopAt = (x, z, time) => {
    if (!noise) return CLOUD_BASE + 4 + 30;
    const dx = time * 0.7, dz = time * 0.25;
    const a = sampleNoise(noise, (x + dx) * 0.003, (z + dz) * 0.003, 0);
    const b = sampleNoise(noise, (x + dx) * 0.0088 + 0.31, (z + dz) * 0.0088 + 0.31, 1);
    const c = sampleNoise(noise, (x + dx * 0.6) * 0.0009 + 0.57, (z + dz * 0.6) * 0.0009 + 0.57, 0);
    const open = ss(200, 430, z) * (1 - ss(380, 720, Math.abs(x)));
    const h = Math.pow(ss(0.12, 0.95, a), 1.3) * 26 + Math.pow(b, 1.5) * 8 + ss(0.22, 0.85, c) * 9 + open * 18;
    const cl = ceilAt(x, z), kk = 9, m = Math.max(kk - Math.abs(h - cl), 0) / kk;
    return CLOUD_BASE + 4 + Math.min(h, cl) - m * m * kk * 0.25;
  };
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.set(0, CLOUD_BASE + 4, 120);
  sea.frustumCulled = false;
  sea.renderOrder = 3;
  // (how near the sea comes: the camera's height above its highest heaps - from well above
  // it, the sea is drawn only in the distant layer)
  const seaTop = CLOUD_BASE + 4 + 62;
  sea.userData.nearDistFn = (p) => Math.max(0, p.y - seaTop, (CLOUD_BASE + 4 - 2) - p.y);
  sea.userData.seaTop = seaTop;
  group.add(sea);
  // veils of mist drifting over it (two at different heights, so they slide over each
  // other as the camera moves: depth and haze; one on low quality)
  const veils = [];
  // (one, low, just over the cloud tops: higher up a flat veil cut a hard line across the
  // peaks it passed through)
  // (none now: a flat veil over the sea let the peaks show through it, ghostly and thin -
  // the sea is deep and the peaks melt into it at its surface instead)
  [].forEach(([y, seed, amount]) => {
    const vg = new THREE.PlaneGeometry(4400, 3600, 1, 1);
    vg.rotateX(-Math.PI / 2);
    const v = new THREE.Mesh(vg, mistVeilMaterial(U, { seed, amount: lo ? amount * 1.25 : amount }));
    v.position.set(0, y, 150);
    v.frustumCulled = false;
    v.renderOrder = 4;
    group.add(v);
    veils.push(v);
  });

  // billowy cumulus: free-floating heaps, collars around the peaks, heaps on the sea
  const rnd = mulberry32(99);
  // fewer, larger, softer puffs (they overlap less, so they cost less to draw)
  const k = lo ? 0.42 : 0.75;
  const big = lo ? 1.2 : 1.12;
  const clusters = [];
  const puffs = [
    [70, 208, 160, 15], [-74, 200, 76, 18], [46, 222, 14, 11], [-96, 228, -6, 14], [16, 194, -112, 17],
    [-70, 190, -128, 12], [126, 198, -56, 21], [-150, 212, 186, 24], [164, 216, 246, 22], [-34, 236, 256, 13],
    [74, 126, -306, 15], [-66, 110, -334, 13], [96, 92, -424, 17], [-116, 118, -466, 21], [146, 128, -526, 19],
    [-36, 146, -546, 11], [66, 156, -626, 15], [-170, 148, -706, 23], [210, 170, -760, 26], [-260, 176, -820, 30],
  ];
  // rock rising above height y anywhere within m of (x, z)?
  const rockAbove = (x, z, y, m) => {
    if (!peakHeight && !heroHeight) return false;
    for (const [ox, oz] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m], [m * 0.7, m * 0.7], [-m * 0.7, -m * 0.7], [m * 0.7, -m * 0.7], [-m * 0.7, m * 0.7]]) {
      if (peakHeight && peakHeight(x + ox, z + oz) > y) return true;
      if (heroHeight && heroHeight(x + ox, z + oz) > y) return true;
    }
    return false;
  };
  puffs.forEach(([x, y, z, s]) => {
    if (rockAbove(x, z, y - s * 1.2, s * 1.6)) return;
    // (about half of them drawn out into flat, wind-combed wisps rather than round puffs)
    const hw = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    const wsp = hw < 0.5;
    clusters.push({ x, y: y - s * 0.4, z, w: s * (wsp ? 4.2 : 3.2), h: s * (wsp ? 0.45 : 0.8), d: s * (wsp ? 1.6 : 2.0), n: Math.max(2, Math.round(Math.min(12, 5 + s * 0.3) * k)), s: s * 2.2 * big, wisp: wsp });
  });
  // collars where the peaks pierce the sea (radius measured from the rock itself)
  const near = peaks.filter(([, z]) => z > -400 && z < 760);
  const NB = 14;
  const radii = peakMesh ? spireRadii(peakMesh, near, CLOUD_TOP - 10, CLOUD_TOP + 4, NB) : null;
  near.forEach(([x, z, apex, r], si) => {
    const far = Math.hypot(x, z - 250) > 520;
    for (let b = 0; b < NB; b++) {
      if (rnd() < 0.45) continue;
      const R = radii ? radii[si][b] : 0;
      if (R <= 0) continue;
      const a = ((b + 0.5) / NB) * TAU + (rnd() - 0.5) * 0.3;
      const s = (far ? 44 : 32) + rnd() * 14;
      const d = R + s * 0.1;
      clusters.push({ x: x + Math.cos(a) * d, y: CLOUD_TOP - 10 + rnd() * 5, z: z + Math.sin(a) * d, w: s * 2.2, h: s * 0.4, d: s * 1.2, n: Math.max(1, Math.round(2 * k)), s: s * big, lift: 0.25, wisp: rnd() < 0.62 });
    }
  });
  // and around the two peaks she circles, where they rise out of the sea: soft collars and
  // wisps, so the rock melts into the cloud (none on the side of the ridge she follows down)
  if (heroHeight) {
    const rh = mulberry32(4242);
    for (const H of [HERO.L, HERO.R]) {
      const nb = 16;
      for (let b = 0; b < nb; b++) {
        if (rh() < 0.3) continue;
        const a = ((b + 0.5) / nb) * TAU + (rh() - 0.5) * 0.3;
        const ca = Math.cos(a), sa = Math.sin(a);
        let R = 0;
        for (let r = 16; r < 180; r += 4) if (heroHeight(H.x + ca * r, H.z + sa * r) < CLOUD_TOP - 6) { R = r; break; }
        if (!R) continue;
        const s = 30 + rh() * 14;
        const x = H.x + ca * (R + s * 0.15), z = H.z + sa * (R + s * 0.15);
        if (z < -100) continue;
        clusters.push({ x, y: CLOUD_TOP - 11 + rh() * 5, z, w: s * 2.2, h: s * 0.4, d: s * 1.2, n: Math.max(1, Math.round(2 * k)), s: s * big, lift: 0.25, wisp: rh() < 0.6 });
      }
    }
  }
  // heaps riding on the sea, thinning out over the dive
  const inRock = (x, z, m) => rockAbove(x, z, CLOUD_TOP - 6, m);
  for (let i = 0, made = 0; i < 700 && made < 110 * k; i++) {
    const x = (rnd() - 0.5) * 900, z = -250 + rnd() * 1000;
    const s = 46 + rnd() * 34;
    if (inRock(x, z, s * 0.5)) continue;
    clusters.push({ x, y: CLOUD_TOP - 8 + rnd() * 8, z, w: s * 2.4, h: s * 0.5, d: s * 1.7, n: Math.max(2, Math.round(3.4 * k)), s: s * big, lift: 0.35, wisp: rnd() < 0.2 });
    made++;
  }
  // a denser field of heaps along the corridor between the ranges (where she plunges at its
  // far end), so the camera looks down a valley of billows
  const CORR = [[0, 300], [-4, 205], [-16, 110], [-30, 20], [-38, -70], [-32, -160], [-16, -240], [4, -315]];
  const pathX = (z) => {
    for (let i = 0; i < CORR.length - 1; i++) {
      const [x0, z0] = CORR[i], [x1, z1] = CORR[i + 1];
      if (z <= z0 && z >= z1) return x0 + (x1 - x0) * ((z0 - z) / (z0 - z1));
    }
    return 0;
  };
  for (let i = 0, made = 0; i < 300 && made < 26 * k; i++) {
    const z = -270 + rnd() * 420;
    const off = (rnd() < 0.5 ? -1 : 1) * (26 + rnd() * 130);
    const x = pathX(z) + off;
    const s = 34 + rnd() * 22;
    if (inRock(x, z, s * 0.5)) continue;
    clusters.push({ x, y: CLOUD_TOP - 13 + rnd() * 4, z, w: s * 2.2, h: s * 0.35, d: s * 1.5, n: Math.max(1, Math.round(3 * k)), s: s * big, lift: 0.3, wisp: rnd() < 0.35 });
    made++;
  }
  // (none in her way: a heap whose puffs would come within ~22 m of her flight is left out)
  const FS = [];
  for (let i = 0; i < FLIGHT.length - 1; i++) {
    const a = FLIGHT[i], b = FLIGHT[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 5));
    for (let k = 0; k < n; k++) FS.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, a[2] + (b[2] - a[2]) * k / n]);
  }
  const inWay = (c) => {
    const s = c.s || c.w * 0.42;
    const hx = c.w * 0.5 + s * 0.35, hz = c.d * 0.5 + s * 0.35, y0 = c.y - s * 0.2, y1 = c.y + c.h + s * 0.45;
    for (const [px, py, pz] of FS) {
      if (pz < -250) continue;
      const dx = Math.max(0, Math.abs(px - c.x) - hx), dz = Math.max(0, Math.abs(pz - c.z) - hz);
      const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
      if (dx * dx + dy * dy + dz * dz < 22 * 22) return true;
    }
    return false;
  };
  for (let i = clusters.length - 1; i >= 0; i--) if (inWay(clusters[i])) clusters.splice(i, 1);
  const sprites = new CloudSprites(U, clusters, { seed: 7, soft, split: 50 });

  // --- clouds under the sea of clouds: ragged heaps hanging from its base over the head of
  // the valley (seen as she comes out beneath it, and from the meadow until it parts), wisps
  // trailing from it, and one lying low over the meadow ---
  const vr = mulberry32(5150);
  const solid = (x, z) => Math.max(heightAt(x, z), heroHeight ? heroHeight(x, z) : -1e9, valleyHeight ? valleyHeight(x, z) : -1e9, peakHeight ? peakHeight(x, z) : -1e9);
  // (a point on her flight: fractional index along the key points)
  const fp = (u) => {
    const i = Math.min(FLIGHT.length - 2, Math.floor(u)), f = u - i, a = FLIGHT[i], b = FLIGHT[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  // a heap's cloud body, for keeping heaps out of the way and for the veil inside them
  const body = (c) => {
    const sz = c.s || c.w * 0.42;
    return { cx: c.x, cy: c.y + c.h * 0.5 + sz * 0.15, cz: c.z, rx: c.w * 0.5 + sz * 0.3, ry: c.h * 0.5 + sz * 0.32, rz: c.d * 0.5 + sz * 0.3 };
  };
  const inBody = (b, x, y, z, pad) => {
    const dx = (x - b.cx) / (b.rx + pad), dy = (y - b.cy) / (b.ry + pad), dz = (z - b.cz) / (b.rz + pad);
    return dx * dx + dy * dy + dz * dz < 1;
  };
  const vClusters = [];
  const camPath = clearPts || [];
  const clearOfPath = (c, pad) => {
    const b = body(c);
    for (const [px, py, pz] of camPath) if (inBody(b, px, py, pz, pad)) return false;
    for (const [px, py, pz] of FS) if (inBody(b, px, py, pz, pad)) return false;
    return true;
  };
  // (a wisp may lean on the mountainside - the cloud softens where it meets the rock - but
  // not stand inside it)
  const clearOfRock = (c) => {
    for (const [ox, oz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) if (solid(c.x + ox * c.w, c.z + oz * c.d) > c.y - 4) return false;
    return true;
  };
  // tatters of cloud trailing just under the deck's base where she comes out of it (the
  // camera slips past them as the white thins)
  for (let i = 0, made = 0; i < 400 && made < (lo ? 4 : 6); i++) {
    const p = fp(19.2 + vr() * 1.6);
    const side = vr() < 0.5 ? -1 : 1;
    const x = p[0] + side * (26 + vr() * 60), z = p[2] + (vr() - 0.5) * 50;
    const c = { x, y: 131 + vr() * 12, z, w: 80 + vr() * 60, h: 6 + vr() * 5, d: 28 + vr() * 18, n: 4, s: 30 * big, lift: 0.5, wisp: true, dense: 0.25 };
    if (!clearOfRock(c) || !clearOfPath(c, 6)) continue;
    vClusters.push(c);
    made++;
  }
  const valley = new CloudSprites(U, vClusters, { seed: 11, soft, split: 50 });
  valley.clusters = vClusters.map((c) => ({ ...body(c), dense: c.dense || 0.6 }));
  group.add(sprites.root);
  return { group, sea, seaMat, veils, sprites, puffMat: sprites.mat, valley, seaTopAt };
}

// Widest extent of the rock around each peak, per angular bucket, within a height band
function spireRadii(mesh, list, yLo, yHi, nb) {
  const pos = mesh.geometry.attributes.position;
  const out = list.map(() => new Float32Array(nb));
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yLo || y > yHi) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    for (let k = 0; k < list.length; k++) {
      const [sx, sz, , r] = list[k];
      const dx = x - sx, dz = z - sz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r * 2) continue;
      const b = Math.floor((((Math.atan2(dz, dx) / TAU) % 1) + 1) % 1 * nb) % nb;
      const d = Math.sqrt(d2);
      if (d > out[k][b]) out[k][b] = d;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decorations for the floating gardens (children of each island holder)
export function decorateIslands(U, islands) {
  // islands are seen from afar: simple flowers, a little sparser
  const flowerGeo = daisyGeometry(11, { heads: 2, petals: 8, leaves: 0, ring: 4 });
  const treeGeo = crownTreeGeometry(5);
  const firGeo = spruceGeometry(4, 9);
  const fMat = meadowMaterial(U, { stem: '#5b8a3c', leaf: '#5f8f42', centre: '#f2c14e', shade: '#8f8fb8', sway: 1.2, emit: 0.25 });
  const tMat = treeMaterial(U, { stem: '#5a4636', shade: '#7a7aa0', sway: 0.2, fleck: 0.5 });
  islands.list.forEach((isl, k) => {
    const rnd = mulberry32(500 + k);
    const R = isl.R;
    const fl = [];
    for (let i = 0; i < Math.round(R * R * 1.15); i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * R * 0.85;
      fl.push({ x: Math.cos(a) * r, y: R * 0.03, z: Math.sin(a) * r, s: (1.4 + rnd()) * Math.max(1, R / 10), ry: rnd() * TAU, c: pick(rnd, PAL[pick(rnd, ['lavender', 'ivory', 'blush', 'gold'])]) });
    }
    isl.holder.add(instanced(flowerGeo, fMat, fl, (it, c) => c.set(it.c)));
    const tr = [];
    const nt = 1 + Math.floor(R / 7);
    for (let i = 0; i < nt; i++) {
      const a = rnd() * TAU, r = rnd() * R * 0.55;
      tr.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, s: R * (0.45 + rnd() * 0.35), ry: rnd() * TAU, c: pick(rnd, ['#f5d2dc', '#fbe7ec', '#5f8c45', '#efc0cf']) });
    }
    isl.holder.add(instanced(treeGeo, tMat, tr, (it, c) => c.set(it.c)));
    if (R > 15) {
      const fr = [];
      for (let i = 0; i < 4; i++) {
        const a = rnd() * TAU, r = R * (0.5 + rnd() * 0.3);
        fr.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, s: R * (0.35 + rnd() * 0.25), ry: rnd() * TAU, c: pick(rnd, ['#2f5638', '#36603b']) });
      }
      isl.holder.add(instanced(firGeo, tMat, fr, (it, c) => c.set(it.c)));
    }
  });
  return { fMat, tMat };
}

// ---------------------------------------------------------------------------
// Drifting mist veils for the mountain trail
export function buildMist(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uNoise: U.uNoise, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#eef0f4') } },
    vertexShader: /* glsl */ `
      attribute vec3 aOffset; attribute float aSize; attribute float aSeed;
      uniform float uTime;
      varying vec2 vUv; varying float vSeed; varying float vNear;
      void main() {
        vUv = uv; vSeed = aSeed;
        vec3 c = aOffset;
        c.x += mod(uTime * (1.5 + aSeed * 2.0) + aSeed * 200.0, 240.0) - 120.0;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        // banks of mist lie off in the distance; the air around her stays clear
        vNear = smoothstep(12.0, 42.0, -mv.z);
        mv.xy += position.xy * aSize * vec2(1.8, 0.7);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform float uOpacity; uniform vec3 uColor; uniform float uTime;
      varying vec2 vUv; varying float vSeed; varying float vNear;
      void main() {
        vec2 c = vUv - 0.5;
        float d = length(c * vec2(1.0, 1.3)) * 2.0;
        float n = texture2D(uNoise, vUv * 0.7 + vec2(vSeed * 3.1 + uTime * 0.01, vSeed)).r;
        float a = smoothstep(1.0, 0.1, d) * smoothstep(0.25, 0.7, n) * uOpacity * vNear;
        gl_FragColor = vec4(uColor, a * 0.38);
      }`,
    transparent: true, depthWrite: false,
  });
  const rnd = mulberry32(8);
  const N = 34;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const off = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = -120 + rnd() * 160, z = -700 - rnd() * 170;
    off[i * 3] = x; off[i * 3 + 1] = heightAt(x, z) + 4 + rnd() * 16; off[i * 3 + 2] = z;
    size[i] = 22 + rnd() * 30; seed[i] = rnd();
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.instanceCount = N;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return { mesh, mat };
}
