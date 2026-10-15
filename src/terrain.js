import * as THREE from 'three';
import { heightAt, SPIRES, ISLANDS, WATER_VALLEY, WATER_CANYON, GARDEN, CLEARING, canyonRiverZ } from './world.js';
import { mulberry32, smoothstep, TAU, clamp, makeSimplex } from './math.js';
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
import { terrainMaterial, waterMaterial, COMMON } from './shaders.js';

function gridGeometry(x0, x1, z0, z1, step, heightFn) {
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      H[j * nx + i] = heightFn(x, z);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step, z = z0 + j * step;
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      const il = Math.max(i - 2, 0), ir = Math.min(i + 2, nx - 1), jd = Math.max(j - 2, 0), ju = Math.min(j + 2, nz - 1);
      const hl = H[j * nx + il], hr = H[j * nx + ir];
      const hd = H[jd * nx + i], hu = H[ju * nx + i];
      const dx = (ir - il) * step, dz = (ju - jd) * step;
      let a = -(hr - hl) / dx, b = 1, c = -(hu - hd) / dz;
      const l = Math.hypot(a, b, c);
      nor[k * 3] = a / l; nor[k * 3 + 1] = b / l; nor[k * 3 + 2] = c / l;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // split each quad along its flatter diagonal (fewer creases on curved slopes)
      const dad = Math.abs(H[a] - H[d]), dbc = Math.abs(H[b] - H[c]);
      if (dbc < dad) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
      else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// The same grid cut into tiles that share their border vertices (so shading is
// seamless), letting the renderer skip whatever is out of view
function gridTiles(x0, x1, z0, z1, step, heightFn, tilesX, tilesZ) {
  const full = gridGeometry(x0, x1, z0, z1, step, heightFn);
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const P = full.attributes.position.array, N = full.attributes.normal.array;
  const out = [];
  for (let tz = 0; tz < tilesZ; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const i0 = Math.floor(((nx - 1) * tx) / tilesX), i1 = Math.floor(((nx - 1) * (tx + 1)) / tilesX);
      const j0 = Math.floor(((nz - 1) * tz) / tilesZ), j1 = Math.floor(((nz - 1) * (tz + 1)) / tilesZ);
      const w = i1 - i0 + 1, h = j1 - j0 + 1;
      const pos = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const src = ((j0 + j) * nx + (i0 + i)) * 3, dst = (j * w + i) * 3;
        pos[dst] = P[src]; pos[dst + 1] = P[src + 1]; pos[dst + 2] = P[src + 2];
        nor[dst] = N[src]; nor[dst + 1] = N[src + 1]; nor[dst + 2] = N[src + 2];
      }
      const idx = new Uint32Array((w - 1) * (h - 1) * 6);
      let t = 0;
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        const dad = Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]), dbc = Math.abs(pos[b * 3 + 1] - pos[c * 3 + 1]);
        if (dbc < dad) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
        else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.push(g);
    }
  }
  return out;
}

// Near detailed terrain region (camera often close to the ground here)
export const NEAR = { x0: -300, x1: 300, z0: -1032, z1: -96 };

export function buildTerrain(U, splat, quality) {
  const group = new THREE.Group();
  const nearStep = quality === 'low' ? 3.6 : 2.4;
  const farStep = quality === 'low' ? 22 : 16;
  const splatRect = new THREE.Vector4(splat.rect.x0, splat.rect.z0, splat.rect.x1 - splat.rect.x0, splat.rect.z1 - splat.rect.z0);
  const mat = terrainMaterial(U, { splat: splat.texture, splatRect, canopy: 0.75, low: quality === 'low' });
  const near = new THREE.Group();
  gridTiles(NEAR.x0, NEAR.x1, NEAR.z0, NEAR.z1, nearStep, heightAt, 4, 6).forEach((g) => near.add(new THREE.Mesh(g, mat)));
  group.add(near);

  // Far terrain: sink the part hidden under the near mesh so they never fight
  const inset = farStep * 1.5;
  const farFn = (x, z) => {
    const h = heightAt(x, z);
    const inX = x > NEAR.x0 + inset && x < NEAR.x1 - inset;
    const inZ = z > NEAR.z0 + inset && z < NEAR.z1 - inset;
    return inX && inZ ? h - 60 : h;
  };
  const farMat = terrainMaterial(U, { canopy: 1, snowLine: 450 });
  const far = new THREE.Group();
  gridTiles(-1800, 1800, -2800, 960, farStep, farFn, 4, 4).forEach((g) => far.add(new THREE.Mesh(g, farMat)));
  group.add(far);

  return { group, near, far, mat, farMat };
}

// ---------------------------------------------------------------------------
// Sculpted karst towers (EverSwap-like painted peaks, Ha Giang-like forms):
// domed tops, lobed cross-sections, vertical gullies, vegetated ledges and a
// sheer limestone face on one side.
function spireGeometry(apexY, baseR, seed, baseY, detail = 1) {
  const rnd = mulberry32(seed * 977 + 13);
  const nz = makeSimplex(seed * 31 + 5);
  const radial = Math.round(48 * detail), rings = Math.round(42 * detail);
  const H = apexY - baseY;
  const leanX = (rnd() - 0.5) * 0.3 * baseR, leanZ = (rnd() - 0.5) * 0.3 * baseR;
  const pe = 1.8 + rnd() * 1.2;            // how domed the top is
  const pt = 0.5 + rnd() * 0.25;
  const taper = 0.22 + rnd() * 0.22;
  const nFl = 7 + Math.floor(rnd() * 6);   // gullies
  const cliffA = rnd() * TAU, cliffW = 0.45 + rnd() * 0.35, cliffAmt = 0.08 + rnd() * 0.1;
  const ledges = [];
  for (let k = 0; k < 4; k++) ledges.push([0.18 + rnd() * 0.6, 0.012 + rnd() * 0.012, 0.03 + rnd() * 0.03]);
  const pos = [];
  for (let j = 0; j <= rings; j++) {
    const f = j / rings;
    const prof = Math.pow(Math.max(0, 1 - Math.pow(f, pe)), pt) * (1 - taper * f);
    const y0 = baseY + H * f;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      let r = baseR * prof;
      // lobed, irregular cross-section that wanders with height
      r *= 1 + 0.21 * nz(ca * 1.1 + seed, sa * 1.1 + f * 1.4) + 0.09 * nz(ca * 2.7 + f * 3.0, sa * 2.7 - seed) + 0.035 * nz(ca * 6.0 + f * 8.0, sa * 6.0 + seed);
      // vertical gullies
      const fl = Math.pow(Math.abs(Math.sin(a * nFl * 0.5 + 0.9 * nz(f * 2.2, ca + 3))), 3.5);
      r *= 1 - 0.1 * fl * smooth(0.04, 0.3, f) * (1 - smooth(0.85, 1, f));
      // knobbly crown: a few sub-summits instead of one smooth dome
      const crownK = smooth(0.6, 0.95, f);
      r *= 1 + 0.12 * crownK * nz(ca * 2.2 + 11, sa * 2.2 + f * 2.0);
      // ledges with a soft lip
      for (const [lf, lw, la] of ledges) r *= 1 + la * Math.exp(-Math.pow((f - lf) / lw, 2)) - la * 0.6 * Math.exp(-Math.pow((f - lf - lw * 1.8) / lw, 2));
      // a sheer face on one side
      let da = Math.abs(a - cliffA); da = Math.min(da, TAU - da);
      r *= 1 - cliffAmt * smooth(cliffW, 0, da) * smooth(0.08, 0.3, f) * (1 - smooth(0.75, 0.95, f));
      if (j === rings) r = 0;
      const jit = j > 0 && j < rings ? nz(ca * 4 + f * 9, sa * 4) * H * 0.006 + H * 0.03 * crownK * nz(ca * 1.6 + 5, sa * 1.6 - 3) : 0;
      pos.push(ca * r + leanX * f * f, y0 + jit, sa * r + leanZ * f * f);
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * radial + i, b = j * radial + ((i + 1) % radial);
      const c = (j + 1) * radial + i, d = (j + 1) * radial + ((i + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mergeGeometries(geos) {
  let nv = 0, ni = 0;
  geos.forEach((g) => {
    if (!g.index) {
      const n = g.attributes.position.count;
      const ix = new Uint32Array(n);
      for (let i = 0; i < n; i++) ix[i] = i;
      g.setIndex(new THREE.BufferAttribute(ix, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    nv += g.attributes.position.count; ni += g.index.count;
  });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  geos.forEach((g) => {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
export { mergeGeometries };

export function buildSpires(U) {
  const geos = [];
  SPIRES.forEach(([x, z, apex, r, seed]) => {
    const rnd = mulberry32(seed * 31 + 7);
    const ground = heightAt(x, z);
    const baseY = Math.min(ground, apex - 60) - 50;
    // far towers need fewer facets
    const far = Math.hypot(x, z + 600) > 1100;
    const main = spireGeometry(apex, r, seed, baseY, far ? 0.6 : 1);
    main.translate(x, 0, z);
    geos.push(main);
    // a cluster of smaller domes sharing the base (fengcong karst)
    const shoulders = 1 + Math.floor(rnd() * 2.4);
    for (let k = 0; k < shoulders; k++) {
      const a = rnd() * TAU, d = r * (0.5 + rnd() * 0.45);
      const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
      const sh = baseY + (apex - baseY) * (0.38 + rnd() * 0.3);
      const g = spireGeometry(sh, r * (0.45 + rnd() * 0.25), seed * 10 + k, baseY, far ? 0.45 : 0.7);
      g.translate(sx, 0, sz);
      geos.push(g);
    }
  });
  const geo = mergeGeometries(geos);
  const mat = terrainMaterial(U, { hiStart: 320, rockBias: 0.24, ambAdd: 0.06, canopy: 1, peach: 0.25, karst: true });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

// ---------------------------------------------------------------------------
// Floating gardens: a grassy table of rock with a rounded, stratified belly, a few
// hanging spurs of stone beneath it and vines trailing over the lip.
// attributes: aD depth down the island (0 top .. 1 lowest point), aK 1 on vines,
// aV distance along a vine (0 at the lip)
function islandGeometry(R, seed, avoidA = null) {
  const rnd = mulberry32(seed * 131 + 5);
  const nz = makeSimplex(seed * 7 + 3);
  const parts = [];
  const part = () => { const P = { pos: [], d: [], k: [], v: [], idx: [] }; parts.push(P); return P; };
  const radial = 36, rings = 14;
  const bowl = R * (0.85 + rnd() * 0.25);
  const rimR = [];
  for (let i = 0; i < radial; i++) {
    const a = (i / radial) * TAU;
    rimR.push(R * (0.95 + 0.14 * nz(Math.cos(a) * 1.3 + 4, Math.sin(a) * 1.3 + 9)));
  }
  const rimAt = (a) => { const f = (((a / TAU) % 1) + 1) % 1 * radial; const i = Math.floor(f), t = f - i; return rimR[i % radial] * (1 - t) + rimR[(i + 1) % radial] * t; };
  // stone spurs hanging under the belly: one main point, a few smaller ones
  const spurs = [];
  const ns = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < ns; k++) {
    const a = rnd() * TAU, off = k === 0 ? rnd() * 0.1 : 0.22 + rnd() * 0.16;
    spurs.push({ x: Math.cos(a) * off * R, z: Math.sin(a) * off * R, r: R * (k === 0 ? 0.4 : 0.17 + rnd() * 0.1), L: R * (k === 0 ? 0.8 + rnd() * 0.4 : 0.3 + rnd() * 0.4), top: -bowl * (k === 0 ? 0.5 : 0.6), seed: k });
  }
  const depth = Math.max(...spurs.map((sp) => -sp.top + sp.L));
  const dOf = (y) => clamp(-y / (depth + R * 0.4), 0, 1);

  // the table and belly (a closed surface of revolution)
  const B = part();
  B.pos.push(0, R * 0.07, 0); B.d.push(0); B.k.push(0); B.v.push(0);
  for (let j = 0; j <= rings; j++) {
    const f = j / rings;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * TAU;
      let r, y;
      if (j === 0) { r = rimR[i] * 0.97; y = R * 0.03 + nz(Math.cos(a) * 1.5, Math.sin(a) * 1.5 + 1.7) * R * 0.02; }
      else if (j === 1) { r = rimR[i] * 1.03; y = -R * 0.06; }
      else {
        const g = (j - 1) / (rings - 1);
        // full and rounded, closing quickly near the bottom
        r = rimR[i] * Math.pow(Math.max(0, 1 - Math.pow(g, 1.7)), 0.75);
        // boulders and ledges (none right under the lip, where the falls pour past)
        const lump = nz(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2 + g * 3.5) * 0.15 + nz(Math.cos(a) * 3.4 + g * 8.0, Math.sin(a) * 3.4 + seed) * 0.07;
        r *= 1 + lump * smooth(0.0, 0.25, g) - 0.04 * (1 - smooth(0.0, 0.2, g));
        r *= 1 + 0.03 * Math.sin(g * 30 + nz(Math.cos(a) * 2 + 7, Math.sin(a) * 2 + g * 2) * 3);
        y = -R * 0.06 - (bowl - R * 0.06) * Math.pow(g, 0.9);
        if (j === rings) r = 0;
      }
      B.pos.push(Math.cos(a) * r, y, Math.sin(a) * r); B.d.push(dOf(y)); B.k.push(0); B.v.push(0);
    }
  }
  for (let i = 0; i < radial; i++) B.idx.push(0, 1 + ((i + 1) % radial), 1 + i);
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = 1 + j * radial + i, b = 1 + j * radial + ((i + 1) % radial);
      const c = 1 + (j + 1) * radial + i, d = 1 + (j + 1) * radial + ((i + 1) % radial);
      B.idx.push(a, b, c, b, d, c);
    }
  }

  // spurs: spindles (closed at both ends), lumpy, leaning a little
  let tip = [0, -depth, 0];
  spurs.forEach((sp) => {
    const S = part();
    const rad = 12, rr = 9;
    const lean = [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3];
    S.pos.push(sp.x, sp.top + sp.r * 0.6, sp.z); S.d.push(dOf(sp.top)); S.k.push(0); S.v.push(0);
    for (let j = 1; j <= rr; j++) {
      const t = j / rr;
      for (let i = 0; i < rad; i++) {
        const a = (i / rad) * TAU;
        let r = sp.r * Math.sin(Math.min(t / 0.22, 1) * Math.PI * 0.5) * Math.pow(1 - t, 0.85);
        r *= 1 + nz(Math.cos(a) * 1.8 + sp.seed * 5 + seed, Math.sin(a) * 1.8 + t * 3) * 0.22;
        const y = sp.top - sp.L * t;
        const x = sp.x + Math.cos(a) * r + lean[0] * sp.L * t * t, z = sp.z + Math.sin(a) * r + lean[1] * sp.L * t * t;
        S.pos.push(x, y, z); S.d.push(dOf(y)); S.k.push(0); S.v.push(0);
        if (j === rr && i === 0 && sp.seed === 0) tip = [sp.x + lean[0] * sp.L, y, sp.z + lean[1] * sp.L];
      }
    }
    for (let i = 0; i < rad; i++) S.idx.push(0, 1 + ((i + 1) % rad), 1 + i);
    for (let j = 0; j < rr - 1; j++) {
      for (let i = 0; i < rad; i++) {
        const a = 1 + j * rad + i, b = 1 + j * rad + ((i + 1) % rad);
        const c = 1 + (j + 1) * rad + i, d = 1 + (j + 1) * rad + ((i + 1) % rad);
        S.idx.push(a, b, c, b, d, c);
      }
    }
  });

  // vines trailing over the lip (two crossed ribbons each, both faces)
  const nv = Math.round(9 + R * 0.45);
  for (let k = 0; k < nv; k++) {
    const a = rnd() * TAU;
    const L = R * (rnd() < 0.3 ? 0.35 + rnd() * 0.3 : 0.1 + rnd() * 0.2);
    if (avoidA !== null) { let da = Math.abs(a - avoidA) % TAU; da = Math.min(da, TAU - da); if (da < 0.3) continue; }
    const r0 = rimAt(a) * 1.035;
    const w0 = 0.22 + R * 0.018;
    const segs = 6;
    const ox = Math.cos(a), oz = Math.sin(a);
    const px = -oz, pz = ox;
    for (const [ux, uz] of [[px, pz], [ox * 0.8 + px * 0.2, oz * 0.8 + pz * 0.2]]) {
      // each face is its own strip so both get proper normals
      for (const face of [1, -1]) {
        const V = part();
        for (let j = 0; j <= segs; j++) {
          const t = j / segs;
          const out = r0 + R * 0.02 * Math.sin(t * Math.PI);
          const cx = ox * out, cz = oz * out, cy = -R * 0.045 - L * t;
          const w = w0 * (1 - 0.55 * t);
          for (const sd of [-1, 1]) {
            V.pos.push(cx + ux * w * 0.5 * sd, cy, cz + uz * w * 0.5 * sd);
            V.d.push(0.02); V.k.push(1); V.v.push(t * L / R);
          }
        }
        for (let j = 0; j < segs; j++) {
          const q = j * 2;
          if (face > 0) V.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
          else V.idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        }
      }
    }
  }

  // join the parts (normals per part)
  let nvt = 0, nit = 0;
  const geos = parts.map((P) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
    g.setIndex(P.idx);
    g.computeVertexNormals();
    nvt += P.pos.length / 3; nit += P.idx.length;
    return g;
  });
  const pos = new Float32Array(nvt * 3), nor = new Float32Array(nvt * 3), dd = new Float32Array(nvt), kk = new Float32Array(nvt), vv = new Float32Array(nvt), idx = new Uint32Array(nit);
  let vo = 0, io = 0;
  parts.forEach((P, n) => {
    const g = geos[n];
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    dd.set(P.d, vo); kk.set(P.k, vo); vv.set(P.v, vo);
    for (let i = 0; i < P.idx.length; i++) idx[io + i] = P.idx[i] + vo;
    vo += P.pos.length / 3; io += P.idx.length;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dd, 1));
  g.setAttribute('aK', new THREE.BufferAttribute(kk, 1));
  g.setAttribute('aV', new THREE.BufferAttribute(vv, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.userData.depth = depth;
  g.userData.tip = tip;
  return g;
}

// Floating islands: lush tops over layered rock that warms from sand to dusty
// rose to violet toward the point, with a soft glow seeping from below at night
function islandMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uRock1: { value: new THREE.Color('#d6b48f') },
      uRock2: { value: new THREE.Color('#ad7d92') },
      uRock3: { value: new THREE.Color('#5d4f86') },
      uGrassD: { value: new THREE.Color('#3d6b3c') },
      uGrassL: { value: new THREE.Color('#93c25d') },
      uGlowCol: { value: new THREE.Color('#bba6ff') },
      uAmbAdd: { value: 0.2 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aD; attribute float aK; attribute float aV;
      varying vec3 vW; varying vec3 vN; varying float vD; varying float vK; varying float vV;
      void main() {
        vec3 p = position;
        // vines sway a little, more toward their ends
        float sw = aK * aV * aV;
        p.x += sin(uTime * 0.8 + position.z * 0.15 + position.y * 0.3) * sw * 1.6;
        p.z += cos(uTime * 0.65 + position.x * 0.15) * sw * 1.1;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vD = aD; vK = aK; vV = aV;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uRock1, uRock2, uRock3, uGrassD, uGrassL, uGlowCol, uRimCol; uniform float uAmbAdd;
      varying vec3 vW; varying vec3 vN; varying float vD; varying float vK; varying float vV;
      void main() {
        vec3 N = normalize(vN);
        vec3 Nf = normalize(cross(dFdx(vW), dFdy(vW)));
        if (dot(Nf, N) < 0.0) Nf = -Nf;
        N = normalize(mix(N, Nf, 0.6));
        float ndl = dot(N, uSunDir);
        float l = smoothstep(-0.35, 0.6, ndl);
        float n = texture2D(uNoise, vW.xz * 0.045 + vW.y * 0.01).r;
        vec3 V = normalize(cameraPosition - vW);
        vec3 col;
        if (vK > 0.5) {
          // trailing vines: deep green, lighter leaves catching the light, a few blossoms
          float lv = smoothstep(-0.6, 0.8, abs(ndl)) * (1.0 - vV * 0.5);
          float leaf = texture2D(uNoise, vec2(vV * 6.0, vW.x * 0.05 + vW.z * 0.05)).g;
          vec3 base = mix(uGrassD * 0.75, uGrassL * 0.9, smoothstep(0.3, 0.8, leaf) * 0.7);
          base = mix(base, vec3(0.95, 0.72, 0.84), step(0.78, fract(leaf * 23.0)) * 0.6);
          col = base * mix(uShadowTint * 0.8, uLightTint, lv);
          col += base * uAmb * uAmbAdd;
          col += uGlowCol * 0.05 * uNight;
        } else {
          // grass on top, with moss draping a little way down the sides in strips
          float strip = texture2D(uNoise, vW.xz * 0.06 + 0.37).g;
          float drape = 0.03 + 0.1 * smoothstep(0.4, 0.75, strip);
          float top = smoothstep(0.3, 0.65, N.y) * (1.0 - smoothstep(0.03, 0.09, vD + (n - 0.5) * 0.03));
          float moss = (1.0 - smoothstep(drape - 0.02, drape + 0.02, vD)) * smoothstep(-0.2, 0.2, N.y + 0.5);
          // layered strata, softer than before, with a few darker ledges
          float band = fract(vD * 6.5 + n * 0.7);
          vec3 rock = mix(uRock1, uRock2, smoothstep(0.02, 0.5, vD + (n - 0.5) * 0.1));
          rock = mix(rock, uRock3, smoothstep(0.42, 0.95, vD));
          rock *= 0.92 + 0.1 * smoothstep(0.15, 0.22, band) - 0.08 * smoothstep(0.78, 0.92, band);
          // rain-streaks run down the stone
          float streak = texture2D(uNoise, vec2((vW.x + vW.z) * 0.08, vW.y * 0.006)).b;
          rock *= 0.94 + 0.1 * smoothstep(0.4, 0.75, streak);
          vec3 grass = mix(uGrassD, uGrassL, smoothstep(0.2, 0.9, l + (n - 0.5) * 0.3));
          vec3 mossC = mix(uGrassD * 0.85, mix(uGrassD, uGrassL, 0.45), smoothstep(0.2, 0.8, l));
          vec3 base = mix(rock, mossC, moss * 0.9);
          base = mix(base, grass, top);
          col = base * mix(uShadowTint * 0.85, uLightTint * 1.02, l);
          col += base * uAmb * uAmbAdd;
          // magic seeping from the underside, strongest at the points and at night
          float glow = smoothstep(0.5, 1.0, vD) * (0.3 + 0.7 * uNight);
          col += uGlowCol * glow * (0.22 + 0.08 * sin(uTime * 1.3 + vW.x * 0.1));
        }
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += uRimCol * rim * 0.3;
        col = applyFogK(col, vW, 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// glowing crystals hanging under an island (faceted prisms)
function crystalGeometry(R, seed, tip) {
  const rnd = mulberry32(seed * 71 + 9);
  const parts = [];
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const L = R * (0.18 + rnd() * 0.3);
    const w = L * (0.16 + rnd() * 0.08);
    const g = new THREE.CylinderGeometry(w * 0.15, w, L, 6, 1);
    g.translate(0, -L / 2, 0);
    // a short faceted cap at the root
    const a = rnd() * TAU, r = R * (0.05 + rnd() * 0.22);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(tip[0] + Math.cos(a) * r, tip[1] * (0.55 + rnd() * 0.3) + R * 0.02, tip[2] + Math.sin(a) * r),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.6, rnd() * TAU, (rnd() - 0.5) * 0.6)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    parts.push(g.toNonIndexed());
  }
  const pos = [];
  parts.forEach((p) => pos.push(...p.attributes.position.array));
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
function crystalMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uA: { value: new THREE.Color('#a9e2ff') }, uB: { value: new THREE.Color('#d8b6ff') } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uA, uB;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
        vec3 V = normalize(cameraPosition - vW);
        if (dot(N, V) < 0.0) N = -N;
        float f = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        float facet = 0.5 + 0.5 * dot(N, normalize(vec3(0.3, 0.8, 0.5)));
        vec3 col = mix(uA, uB, facet) * (0.55 + 0.6 * facet) + f * 0.6;
        // they glow brighter as night falls
        col *= 0.75 + 0.9 * uNight + 0.1 * sin(uTime * 2.0 + vW.y);
        col = applyFogK(col, vW, 0.7);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function buildIslands(U) {
  const group = new THREE.Group();
  const mat = islandMaterial(U);
  const cMat = crystalMaterial(U);
  const list = [];
  ISLANDS.forEach(([x, y, z, R, seed], k) => {
    // keep vines clear of the falls that pour from the big ones (see addIslandWaterfalls)
    const g = islandGeometry(R, seed, R >= 17 ? Math.PI * 0.5 + (k % 2 ? 0.35 : -0.3) : null);
    const m = new THREE.Mesh(g, mat);
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.add(m);
    holder.add(new THREE.Mesh(crystalGeometry(R, seed, g.userData.tip), cMat));
    group.add(holder);
    list.push({ holder, base: new THREE.Vector3(x, y, z), R, seed, phase: seed * 1.7 });
  });
  return { group, list, mat, cMat };
}

// ---------------------------------------------------------------------------
export function buildWater(U) {
  const group = new THREE.Group();
  const mat = waterMaterial(U);
  const v = new THREE.Mesh(new THREE.PlaneGeometry(1500, 830, 1, 1), mat);
  v.rotation.x = -Math.PI / 2;
  v.position.set(0, WATER_VALLEY, -470);
  group.add(v);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(3600, 900, 1, 1), mat);
  c.rotation.x = -Math.PI / 2;
  c.position.set(0, WATER_CANYON, -1340);
  group.add(c);
  return { group, mat };
}

// ---------------------------------------------------------------------------
// Splat texture: paths, garden lushness, buckwheat blush, distance-along-trail
export function buildSplat(path, waypoints) {
  const rect = { x0: -170, x1: 110, z0: -900, z1: -555 };
  const ppm = 2; // pixels per metre
  const W = Math.round((rect.x1 - rect.x0) * ppm), Hh = Math.round((rect.z1 - rect.z0) * ppm);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = Hh; return c; };
  const cv = mk(), cs = mk();
  const ctx = cv.getContext('2d'), cts = cs.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, Hh);
  cts.fillStyle = '#000'; cts.fillRect(0, 0, W, Hh);
  const X = (x) => (x - rect.x0) * ppm, Z = (z) => (z - rect.z0) * ppm;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  cts.lineCap = 'round'; cts.lineJoin = 'round';

  // garden lushness (G) & buckwheat meadow (B)
  ctx.globalCompositeOperation = 'lighter';
  const blob = (x, z, r, col) => {
    const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * ppm);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X(x), Z(z), r * ppm, 0, TAU); ctx.fill();
  };
  blob(GARDEN.x - 4, GARDEN.z - 18, 46, 'rgba(0,200,0,1)');
  blob(GARDEN.x + 18, GARDEN.z + 18, 30, 'rgba(0,140,0,1)');
  blob(12, -590, 42, 'rgba(0,0,230,1)');
  blob(-14, -604, 26, 'rgba(0,0,160,1)');
  blob(CLEARING.x, CLEARING.z, CLEARING.r, 'rgba(0,120,0,1)');

  // paths (R): garden path wider, mountain trail narrower
  const sTouch = waypoints.touchdown, sTrail = waypoints.trailStart, sEnd = waypoints.cake;
  const drawRange = (s0, s1, width, alpha) => {
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.lineWidth = width * ppm;
    ctx.beginPath();
    for (let s = s0; s <= s1; s += 0.75) {
      const p = path.posAt(s, _v);
      if (s === s0) ctx.moveTo(X(p.x), Z(p.z)); else ctx.lineTo(X(p.x), Z(p.z));
    }
    ctx.stroke();
  };
  drawRange(sTouch + 4, sTrail, 3.6, 0.35);
  drawRange(sTouch + 6, sTrail, 2.2, 1);
  const sSummit = waypoints.summit + 2;
  drawRange(sTrail, sSummit, 3.4, 0.22);
  drawRange(sTrail, sSummit, 1.45, 1);

  // distance along the trail (alpha channel in the final texture)
  const sSpan = 400;
  for (let s = sTrail; s < sEnd; s += 1.0) {
    const p0 = path.posAt(s, _v), x0 = X(p0.x), z0 = Z(p0.z);
    const p1 = path.posAt(s + 1.2, _v), x1 = X(p1.x), z1 = Z(p1.z);
    const v = clamp(Math.round(((s - sTrail) / sSpan) * 255), 1, 255);
    cts.strokeStyle = `rgb(${v},${v},${v})`;
    cts.lineWidth = 7.5 * ppm;
    cts.beginPath(); cts.moveTo(x0, z0); cts.lineTo(x1, z1); cts.stroke();
  }

  const a = ctx.getImageData(0, 0, W, Hh).data;
  const b = cts.getImageData(0, 0, W, Hh).data;
  // soften the path edges over a couple of texels: a hard edge, filtered and thresholded,
  // shows the texel grid as a sawtooth along the path; a smooth ramp gives a clean, curving
  // edge (the shader roughens it with noise)
  {
    const tmp = new Float32Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) tmp[i] = a[i * 4];
    const t2 = new Float32Array(W * Hh);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < Hh; y++) {
        const r = y * W;
        for (let x = 0; x < W; x++) t2[r + x] = (tmp[r + Math.max(x - 1, 0)] + tmp[r + x] * 2 + tmp[r + Math.min(x + 1, W - 1)]) * 0.25;
      }
      for (let y = 0; y < Hh; y++) {
        const r = y * W, ru = Math.max(y - 1, 0) * W, rd = Math.min(y + 1, Hh - 1) * W;
        for (let x = 0; x < W; x++) tmp[r + x] = (t2[ru + x] + t2[r + x] * 2 + t2[rd + x]) * 0.25;
      }
    }
    for (let i = 0; i < W * Hh; i++) a[i * 4] = Math.round(tmp[i]);
  }
  const out = new Uint8Array(W * Hh * 4);
  for (let i = 0; i < W * Hh; i++) {
    out[i * 4] = a[i * 4];
    out[i * 4 + 1] = a[i * 4 + 1];
    out[i * 4 + 2] = a[i * 4 + 2];
    out[i * 4 + 3] = b[i * 4];
  }
  const tex = new THREE.DataTexture(out, W, Hh, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { texture: tex, rect, sTrail, sSpan };
}
const _v = new THREE.Vector3();
