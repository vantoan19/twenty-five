// Geometry for her: smooth "clay" shapes built from signed distance fields
// (head, hands, shoes) polygonised with surface nets, plus parametric pieces
// (torso, skirt, sleeves, limbs) and thick, rounded hair locks.
import * as THREE from 'three';
import { clamp, lerp, TAU, mulberry32 } from './math.js';

// ---------------------------------------------------------------------------
// SDF toolkit
export const smin = (a, b, k) => { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
export const smax = (a, b, k) => -smin(-a, -b, k);
export function sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
// tapered capsule (IQ's round cone)
export function sdRoundCone(x, y, z, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}
export function sdRoundBox(x, y, z, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// Naive surface nets: one vertex per surface cell, quads across sign changes.
// Normals from the field's gradient, winding fixed to agree with them.
export function surfaceNets(f, min, max, h, coarse = 4) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  // narrow band: a coarse pass first; fine samples far from the surface are interpolated
  const H = h * coarse;
  const cnx = Math.ceil((nx - 1) / coarse) + 2, cny = Math.ceil((ny - 1) / coarse) + 2, cnz = Math.ceil((nz - 1) / coarse) + 2;
  const C = new Float32Array(cnx * cny * cnz);
  let q = 0;
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) C[q++] = f(min[0] + i * H, min[1] + j * H, min[2] + k * H);
  const band = H * 1.6;
  const V = new Float32Array(nx * ny * nz);
  q = 0;
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h;
    const ck = Math.min(Math.floor(k / coarse), cnz - 2), wz = k / coarse - ck;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      const cj = Math.min(Math.floor(j / coarse), cny - 2), wy = j / coarse - cj;
      for (let i = 0; i < nx; i++) {
        const ci = Math.min(Math.floor(i / coarse), cnx - 2), wx = i / coarse - ci;
        const b = ci + cnx * (cj + cny * ck);
        const c00 = C[b] + (C[b + 1] - C[b]) * wx;
        const c10 = C[b + cnx] + (C[b + cnx + 1] - C[b + cnx]) * wx;
        const c01 = C[b + cnx * cny] + (C[b + cnx * cny + 1] - C[b + cnx * cny]) * wx;
        const c11 = C[b + cnx * cny + cnx] + (C[b + cnx * cny + cnx + 1] - C[b + cnx * cny + cnx]) * wx;
        const est = (c00 + (c10 - c00) * wy) + ((c01 + (c11 - c01) * wy) - (c00 + (c10 - c00) * wy)) * wz;
        V[q++] = Math.abs(est) > band ? est : f(min[0] + i * h, y, z);
      }
    }
  }
  const at = (i, j, k) => V[i + nx * (j + ny * k)];
  const cx = nx - 1, cy = ny - 1;
  const cellV = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const pos = [];
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) { const v = at(i + co[c][0], j + co[c][1], k + co[c][2]); cv[c] = v; if (v < 0) neg++; }
        if (neg === 0 || neg === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of E) {
          const va = cv[a], vb = cv[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += co[a][0] + (co[b][0] - co[a][0]) * t;
          sy += co[a][1] + (co[b][1] - co[a][1]) * t;
          sz += co[a][2] + (co[b][2] - co[a][2]) * t;
          n++;
        }
        cellV[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
      }
    }
  }
  const cell = (i, j, k) => cellV[i + cx * (j + cy * k)];
  const idx = [];
  const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < cy; j++) for (let i = 0; i < cx; i++) {
    if ((at(i, j, k) < 0) === (at(i + 1, j, k) < 0)) continue;
    quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k));
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < cy; j++) for (let i = 1; i < cx; i++) {
    if ((at(i, j, k) < 0) === (at(i, j + 1, k) < 0)) continue;
    quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1));
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    if ((at(i, j, k) < 0) === (at(i, j, k + 1) < 0)) continue;
    quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k));
  }
  // gradient normals
  const nv = pos.length / 3;
  const nor = new Float32Array(nv * 3);
  const e = h * 0.5;
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
    const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    nor[v * 3] = gx / l; nor[v * 3 + 1] = gy / l; nor[v * 3 + 2] = gz / l;
  }
  // make every triangle face along its vertices' normals
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const abx = pos[b * 3] - pos[a * 3], aby = pos[b * 3 + 1] - pos[a * 3 + 1], abz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const acx = pos[c * 3] - pos[a * 3], acy = pos[c * 3 + 1] - pos[a * 3 + 1], acz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    const mx = nor[a * 3] + nor[b * 3] + nor[c * 3], my = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], mz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
    if (fx * mx + fy * my + fz * mz < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Head: a soft rounded skull with full cheeks, a little chin and a button nose.
// Origin at the skull centre, +z forward. UVs: equirect from the centre
// (front of the face at u = 0.25, matching the painted face texture).
// HEAD: the shell the hair is laid on (the cranium sits just inside it)
export const HEAD = { rx: 0.112, ry: 0.121, rz: 0.108 };
// facial landmarks (skull space); the painted features and the glasses follow these
export const FACE = { eyeX: 0.041, eyeY: -0.002, browY: 0.031, noseY: -0.03, mouthY: -0.056, cheekX: 0.06, cheekY: -0.03 };
export function headField(x, y, z) {
  // a big round cranium
  let d = sdEllipsoid(x, y, z, 0, 0.012, -0.006, 0.112, 0.113, 0.106);
  // the face: round and soft, tapering to a small chin
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.026, 0.02, 0.094, 0.074, 0.088), 0.03);
  // full cheeks
  d = smin(d, sdEllipsoid(x, y, z, 0.046, -0.032, 0.05, 0.046, 0.04, 0.048), 0.024);
  d = smin(d, sdEllipsoid(x, y, z, -0.046, -0.032, 0.05, 0.046, 0.04, 0.048), 0.024);
  // little chin
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.072, 0.046, 0.03, 0.024, 0.03), 0.02);
  // button nose
  d = smin(d, sdEllipsoid(x, y, z, 0, FACE.noseY, 0.106, 0.0094, 0.0078, 0.0088), 0.009);
  return d;
}
// texture coordinates (0..1, v up) of a point on the front of the face
export function faceUV(x, y) {
  // matches the face material's per-pixel lookup: u = atan2(x, z) / 2pi + 0.5
  const z = faceZ(x, y);
  const r = Math.sqrt(x * x + y * y + z * z);
  return [Math.atan2(x, z) / TAU + 0.5, 1 - Math.acos(clamp(y / r, -1, 1)) / Math.PI];
}
export function headGeometry(freq = 11) {
  // a geodesic sphere shrink-wrapped onto the sculpted head: even, regular
  // facets (the toy "low-poly" look) and an exact silhouette
  const g = new THREE.IcosahedronGeometry(1, freq - 1);
  const p = g.attributes.position;
  const nor = g.attributes.normal;
  const e = 0.0008;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l; y /= l; z /= l;
    let lo = 0.0, hi = 0.2;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (headField(x * m, y * m, z * m) > 0) hi = m; else lo = m;
    }
    const r = (lo + hi) / 2;
    const px = x * r, py = y * r, pz = z * r;
    p.setXYZ(i, px, py, pz);
    // smooth normal from the field's gradient (the shader adds the facets)
    const gx = headField(px + e, py, pz) - headField(px - e, py, pz);
    const gy = headField(px, py + e, pz) - headField(px, py - e, pz);
    const gz = headField(px, py, pz + e) - headField(px, py, pz - e);
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    nor.setXYZ(i, gx / gl, gy / gl, gz / gl);
  }
  g.computeBoundingSphere();
  return g;
}
// distance from the skull centre to the face surface along +z at height y, x
export function faceZ(x, y) {
  let z = 0.2;
  for (let i = 0; i < 60; i++) { const d = headField(x, y, z); if (Math.abs(d) < 1e-5) break; z -= d; }
  return z;
}

// ---------------------------------------------------------------------------
// Hands: a soft palm with four slightly curled fingers and a thumb.
// Local frame: wrist at the origin, fingers toward -y, palm facing +x
// (mirror x for the other side), +z toward the thumb side.
export const FINGERS = (() => {
  const out = [];
  for (const fg of [{ z: -0.0198, len: 0.86 }, { z: -0.0066, len: 1.0 }, { z: 0.0066, len: 0.96 }, { z: 0.0194, len: 0.8 }]) {
    const k0 = [0.0, -0.063, fg.z];
    const l1 = 0.0275 * fg.len, l2 = 0.021 * fg.len, l3 = 0.0165 * fg.len;
    // gentle curl toward the palm (+x)
    const a1 = 0.18, a2 = 0.45, a3 = 0.7;
    const k1 = [k0[0] + Math.sin(a1) * l1, k0[1] - Math.cos(a1) * l1, k0[2] * 1.02];
    const k2 = [k1[0] + Math.sin(a2) * l2, k1[1] - Math.cos(a2) * l2, k1[2]];
    const k3 = [k2[0] + Math.sin(a3) * l3, k2[1] - Math.cos(a3) * l3, k2[2]];
    const c = [(k0[0] + k3[0]) / 2, (k0[1] + k3[1]) / 2, (k0[2] + k3[2]) / 2];
    const rad = Math.max(...[k0, k3].map((k) => Math.sqrt((k[0] - c[0]) ** 2 + (k[1] - c[1]) ** 2 + (k[2] - c[2]) ** 2))) + 0.012;
    out.push({ k0, k1, k2, k3, c, rad, r: 0.0058 });
  }
  return out;
})();
export function handField(x, y, z) {
  // a slim soft palm (a touch narrower and thinner), the back of the hand gently domed
  let d = sdRoundBox(x, y, z, 0, -0.035, 0, 0.0102, 0.0305, 0.0255, 0.0098);
  // wrist blend
  d = smin(d, sdRoundCone(x, y, z, 0, 0.012, 0, 0, -0.012, 0, 0.0158, 0.0162), 0.012);
  // slender fingers, apart from one another, tapering to soft round tips
  for (const F of FINGERS) {
    const dx = x - F.c[0], dy = y - F.c[1], dz = z - F.c[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) - F.rad > d + 0.01) continue;
    const { k0, k1, k2, k3, r } = F;
    let fd = sdRoundCone(x, y, z, k0[0], k0[1], k0[2], k1[0], k1[1], k1[2], r, r * 0.92);
    fd = smin(fd, sdRoundCone(x, y, z, k1[0], k1[1], k1[2], k2[0], k2[1], k2[2], r * 0.92, r * 0.84), 0.003);
    fd = smin(fd, sdRoundCone(x, y, z, k2[0], k2[1], k2[2], k3[0], k3[1], k3[2], r * 0.84, r * 0.74), 0.003);
    d = smin(d, fd, 0.0032);
  }
  // thumb: from the base of the palm, toward the fingers and the palm
  let td = sdRoundCone(x, y, z, 0.006, -0.018, 0.0235, 0.016, -0.04, 0.0295, 0.0088, 0.0072);
  td = smin(td, sdRoundCone(x, y, z, 0.016, -0.04, 0.0295, 0.0245, -0.059, 0.0235, 0.0072, 0.0062), 0.0035);
  d = smin(d, td, 0.007);
  return d;
}
const handCache = {};
export function handGeometry(side, h = 0.0021) {
  if (!handCache[h]) handCache[h] = surfaceNets(handField, [-0.022, -0.134, -0.036], [0.048, 0.024, 0.044], h);
  const g = handCache[h].clone();
  if (side < 0) {
    // mirror across x and keep the winding
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
    const ix = g.index.array;
    for (let t = 0; t < ix.length; t += 3) { const b = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = b; }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Shoes: little rounded ballet flats (toe toward +z, sole on y = 0)
export function shoeField(x, y, z) {
  let d = sdEllipsoid(x, y, z, 0, 0.02, 0.03, 0.036, 0.03, 0.085);
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.026, -0.04, 0.032, 0.034, 0.05), 0.02);
  // flat sole
  d = smax(d, -(y - 0.0), 0.004);
  // the opening on top, where the foot slips in
  d = smax(d, -sdEllipsoid(x, y, z, 0, 0.06, -0.02, 0.026, 0.026, 0.06), 0.006);
  return d;
}
export function shoeGeometry(h = 0.0028) {
  return surfaceNets(shoeField, [-0.042, -0.006, -0.1], [0.042, 0.06, 0.125], h);
}

// ---------------------------------------------------------------------------
// Torso (bodice): superelliptic rings from the waist (y = 0) up to the neck,
// a soft bust in front, a flatter back and sloping shoulders.
const TORSO_KEYS = [
  // y, half-width x, front z, back z
  [0.0, 0.09, 0.066, 0.064],
  [0.07, 0.093, 0.068, 0.066],
  [0.14, 0.103, 0.078, 0.068],
  [0.2, 0.111, 0.09, 0.07],
  [0.25, 0.116, 0.091, 0.072],
  [0.295, 0.122, 0.081, 0.073],
  [0.33, 0.128, 0.069, 0.071],
  [0.358, 0.12, 0.059, 0.065],
  [0.38, 0.094, 0.05, 0.053],
  [0.398, 0.06, 0.042, 0.044],
  [0.41, 0.0, 0.0, 0.0],
];
function torsoAt(y) {
  const K = TORSO_KEYS;
  if (y <= K[0][0]) return K[0];
  for (let i = 0; i < K.length - 1; i++) {
    if (y <= K[i + 1][0]) {
      const a = K[i], b = K[i + 1];
      let t = (y - a[0]) / (b[0] - a[0]);
      t = t * t * (3 - 2 * t);
      return [y, lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  }
  return K[K.length - 1];
}
// a band hugging the torso between two heights (sash, trims)
export function bandGeometry(y0, y1, grow, rows = 4, cols = 64) {
  const pos = [], idx = [];
  const e = 2.5;
  for (let j = 0; j <= rows; j++) {
    const y = lerp(y0, y1, j / rows);
    const [, rx, rzf, rzb] = torsoAt(Math.max(0, y));
    const bul = 1 + 0.06 * Math.sin((j / rows) * Math.PI);
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * (rx + grow) * bul;
      const z = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * ((s > 0 ? rzf : rzb) + grow) * bul;
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
export function torsoBack(y) { return torsoAt(y)[3]; }
// depth of the bodice's back surface at (x, y) (0 if outside its width)
export function torsoBackZ(x, y) {
  const [, rx, , rzb] = torsoAt(y);
  const e = 2.5;
  const k = Math.abs(x) / Math.max(rx, 1e-4);
  if (k >= 1) return 0;
  return rzb * Math.pow(1 - Math.pow(k, e), 1 / e);
}
// depth of the bodice's front surface at (x, y) (0 if outside its width)
export function torsoFrontZ(x, y) {
  const [, rx, rzf] = torsoAt(y);
  const e = 2.5;
  const k = Math.abs(x) / Math.max(rx, 1e-4);
  if (k >= 1) return 0;
  return rzf * Math.pow(1 - Math.pow(k, e), 1 / e);
}

// the dress's neckline height (mirrors neckY() in the bodice shader)
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function neckLineY(x, z) {
  const ax = Math.abs(x);
  const yf = 0.306 + 0.078 * sstep(0.0, 0.088, ax) - 0.004 * Math.exp(-ax * ax / 0.0002);
  const yb = 0.345 + 0.04 * sstep(0.0, 0.08, ax);
  return lerp(yb, yf, sstep(-0.03, 0.03, z));
}
export function torsoPoint(a, y, inset = 0) {
  const [, rx, rzf, rzb] = torsoAt(y);
  const c = Math.cos(a), s = Math.sin(a);
  const e = 2.5;
  return [
    Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * Math.max(rx - inset, 0),
    y,
    Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * Math.max((s > 0 ? rzf : rzb) - inset, 0),
  ];
}
// a soft ruffled frill along the neckline, falling outward over the bodice
export function necklineFrill(cols = 120, width = 0.02) {
  const pos = [], uv = [], ao = [], idx = [];
  const rows = 3;
  const P = [], N = [];
  for (let i = 0; i <= cols; i++) {
    const a = (i / cols) * TAU;
    let lo = 0.2, hi = 0.409;
    for (let k = 0; k < 32; k++) {
      const m = (lo + hi) / 2;
      const p = torsoPoint(a, m);
      if (m - neckLineY(p[0], p[2]) > 0) hi = m; else lo = m;
    }
    const y = (lo + hi) / 2;
    const p = torsoPoint(a, y);
    const q = torsoPoint(a, y - 0.004);
    const hx = Math.cos(a), hz = Math.sin(a);
    // outward, a little downward; the surface tangent going down is q - p
    const tx = q[0] - p[0], ty = q[1] - p[1], tz = q[2] - p[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    P.push(p);
    N.push([hx, tx / tl, hz, ty / tl]);
  }
  for (let i = 0; i <= cols; i++) {
    const [px, py, pz] = P[i];
    const [hx, , hz] = N[i];
    const hl = Math.hypot(hx, hz) || 1;
    const nx = hx / hl, nz = hz / hl;
    const u = i / cols;
    const wave = Math.sin(u * TAU * 34) ;
    // (across her back it lies flat and small: her hair covers it, and a full ruffle there
    // would poke out between the locks)
    const bk = sstep(-0.15, -0.6, Math.sin((i / cols) * TAU));
    for (let j = 0; j <= rows; j++) {
      const f = j / rows;
      const out = 0.0016 + (f * width * 0.5 + f * f * 0.005 * (0.5 + 0.5 * wave)) * (1 - 0.82 * bk);
      const down = (f * width * 0.8 - f * f * 0.003 * wave) * (1 - 0.6 * bk);
      pos.push(px + nx * out, py - down, pz + nz * out);
      uv.push(u, f);
      ao.push(0.82 + 0.18 * f + 0.06 * wave * f);
    }
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function torsoGeometry(rows = 34, cols = 56, inset = 0) {
  const pos = [], idx = [];
  const e = 2.5;
  for (let j = 0; j <= rows; j++) {
    const f = j / rows;
    const y = Math.sin(f * Math.PI * 0.5) * 0.41;
    const [, rx, rzf, rzb] = torsoAt(y);
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * Math.max(rx - inset, 0);
      const rz = (s > 0 ? rzf : rzb) - inset;
      const z = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * Math.max(rz, 0);
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Skirt: an A-line falling in soft folds from the waist (y = 1.02) to the floor,
// with a rolled hem. The shader adds the walk, wind and kneel on top.
// the skirt's radius by fraction from the waist (0) to the hem (1): a full little
// bell that flares quickly from the waist over a soft petticoat
export function skirtProfile(f) {
  const r0 = 0.098, r1 = 0.3;
  return r0 + (r1 - r0) * (1 - Math.pow(1 - f, 2.0)) + 0.016 * Math.sin(f * Math.PI);
}
export function skirtGeometry(rows = 40, cols = 96) {
  const rnd = mulberry32(77);
  const NF = 13;
  const fph = [], famp = [];
  for (let k = 0; k < NF; k++) { fph.push(rnd() * TAU); famp.push(0.7 + rnd() * 0.6); }
  const prof = skirtProfile;
  const pos = [], uv = [], ao = [], idx = [];
  const ringY = [], ringR = [];
  for (let j = 0; j <= rows; j++) {
    const f = j / rows;
    ringY.push(1.02 * (1 - f)); ringR.push(prof(f));
  }
  // rolled hem: curl under by ~1.5 cm
  const hemR = ringR[rows], hemY = 0;
  const extra = [[hemR + 0.004, 0.008], [hemR - 0.004, 0.016], [hemR - 0.016, 0.02]];
  const allY = ringY.concat(extra.map((e) => e[1])), allR = ringR.concat(extra.map((e) => e[0]));
  const nRows = allY.length - 1;
  for (let j = 0; j <= nRows; j++) {
    const f = Math.min(1, j / rows);
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * TAU;
      // folds deepen toward the hem; a few fall more boldly
      let fold = 0;
      for (let k = 0; k < NF; k++) fold += Math.sin(a * (k % 2 ? 9 : 7) + fph[k] + f * 0.6 * k) * famp[k];
      fold = (fold / NF) * 0.9 + Math.sin(a * 11 + 0.4) * 0.35;
      // finer pleats gathered at the waist, opening into soft folds
      const pleat = Math.sin(a * 22 + 0.3 * Math.sin(a * 3)) * (0.35 + 0.25 * Math.sin(a * 5 + 1.0));
      const fl = fold + pleat * (0.55 - 0.3 * f);
      const r = allR[j] * (1 + fl * (0.012 + 0.07 * Math.pow(f, 1.2)));
      pos.push(Math.sin(a) * r, j > rows ? allY[j] : allY[j], Math.cos(a) * r);
      uv.push(i / cols, f);
      // the inner valleys of the folds fall into soft shadow
      ao.push(1 - 0.55 * Math.pow(Math.max(0, Math.min(1, -fl / 0.9)), 0.8) * (0.35 + 0.65 * Math.pow(f, 0.6)));
    }
  }
  for (let j = 0; j < nRows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // a soft ruffle around the hem (a petticoat flounce), following the folds
  const foldAt = (a, f) => {
    let fold = 0;
    for (let k = 0; k < NF; k++) fold += Math.sin(a * (k % 2 ? 9 : 7) + fph[k] + f * 0.6 * k) * famp[k];
    fold = (fold / NF) * 0.9 + Math.sin(a * 11 + 0.4) * 0.35;
    const pleat = Math.sin(a * 22 + 0.3 * Math.sin(a * 3)) * (0.35 + 0.25 * Math.sin(a * 5 + 1.0));
    return fold + pleat * (0.55 - 0.3 * f);
  };
  const RC = Math.max(160, cols * 4), RR = 4;
  const r0i = pos.length / 3;
  for (let j = 0; j <= RR; j++) {
    const k = j / RR;
    const y = lerp(0.085, -0.006, k);
    const f = 1 - y / 1.02;
    for (let i = 0; i <= RC; i++) {
      const a = (i / RC) * TAU;
      const fl = foldAt(a, Math.min(1, f));
      const base = prof(Math.min(1, f)) * (1 + fl * (0.012 + 0.07 * Math.pow(Math.min(1, f), 1.2)));
      const ruff = 0.009 * Math.sin(a * 46) * Math.pow(k, 1.4);
      const r = base + 0.005 + 0.03 * Math.pow(k, 1.6) + ruff;
      const yy = y - (k === 1 ? 0.007 * Math.abs(Math.sin(a * 23)) : 0);
      pos.push(Math.sin(a) * r, yy, Math.cos(a) * r);
      uv.push(i / RC, f);
      ao.push(0.78 + 0.22 * k);
    }
  }
  for (let j = 0; j < RR; j++) for (let i = 0; i < RC; i++) {
    const a = r0i + j * (RC + 1) + i, b = a + 1, c = a + RC + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Puffed sleeve gathered into a band (origin at the shoulder joint, hanging -y)
export function sleeveGeometry(rows = 18, cols = 40) {
  const pos = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const f = j / rows;
    const y = 0.034 - f * 0.118;
    const bulge = Math.sin(Math.min(1, f * 1.12) * Math.PI);
    // gathered at the shoulder and into a band just above the elbow-length opening
    const base = lerp(0.04, 0.0488, f) + 0.028 * bulge;
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * TAU;
      // gathers: soft vertical pleats strongest at the band and the crown
      const pleat = Math.sin(a * 9) * 0.0035 * (0.4 + 0.6 * (1 - bulge));
      const r = Math.max(0.004, base + pleat);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Tapered, rounded limb segment from y = 0 down to y = -len
export function limbGeometry(len, r0, r1, segs = 10) {
  // a tapered capsule: round caps centred on the joints, so a bent elbow or
  // wrist stays seamless
  const pts = [];
  const cap = 3;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(Math.sin(a) * r0, 0.0001), Math.cos(a) * r0));
  }
  const n = 5;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector2(lerp(r0, r1, t) * (1 + 0.05 * Math.sin(t * Math.PI)), -t * len));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(Math.cos(a) * r1, 0.0001), -len - Math.sin(a) * r1));
  }
  pts.reverse();
  const g = new THREE.LatheGeometry(pts, segs);
  g.computeVertexNormals();
  return g;
}

// One continuous arm, shoulder to wrist, in the shoulder's frame (y down the arm): a round
// shoulder, the upper arm tapering to the elbow, the forearm tapering to a slim wrist under
// the hand. Extra rings round the elbow let it bend smoothly (the caller rotates each ring
// part of the way round the elbow, by aW)
export function armGeometry(L1, L2, r0, r1, r2, segs = 18) {
  const pts = [];
  const cap = 4;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(Math.sin(a) * r0, 0.0001), Math.cos(a) * r0));
  }
  const radius = (y) => {
    if (y >= -L1) { const t = -y / L1; return lerp(r0, r1, t) * (1 + 0.05 * Math.sin(t * Math.PI)); }
    const t = Math.min(1, (-y - L1) / L2); return lerp(r1, r2, t) * (1 + 0.06 * Math.sin(Math.min(1, t * 1.2) * Math.PI));
  };
  for (const t of [0.15, 0.3, 0.45, 0.6, 0.72, 0.82, 0.89, 0.94, 0.98]) pts.push(new THREE.Vector2(radius(-t * L1), -t * L1));
  for (const t of [0, 0.03, 0.07, 0.12, 0.19, 0.28, 0.4, 0.54, 0.68, 0.82, 0.93, 1]) pts.push(new THREE.Vector2(radius(-L1 - t * L2), -L1 - t * L2));
  for (let i = 1; i <= cap; i++) {
    const a = (i / cap) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(Math.cos(a) * r2, 0.0001), -L1 - L2 - Math.sin(a) * r2));
  }
  pts.reverse();
  const g = new THREE.LatheGeometry(pts, segs);
  g.computeVertexNormals();
  // how far each vertex turns with the forearm: none above the elbow, all of it a little
  // below, easing in between
  const p = g.attributes.position;
  const w = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = clamp((-L1 + 0.006 - y) / 0.046, 0, 1);
    w[i] = t * t * (3 - 2 * t);
  }
  g.userData = { w, pos0: Float32Array.from(p.array), nor0: Float32Array.from(g.attributes.normal.array), L1 };
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -(L1 + L2) * 0.5, 0), (L1 + L2) * 0.5 + 0.12);
  return g;
}

// ---------------------------------------------------------------------------
// Hair: thick, rounded locks (flattened tubes) swept along curves, with baked
// occlusion (darker underneath and toward the roots) and uv along the lock.
export function lockTube(pts, widths, thicks, outs, { segs = 10, tip = 'round', capRings = 4, reachK = 3.2, wisp = false, uvT = null, tw = 0 } = {}) {
  const n = pts.length;
  const pos = [], nor = [], uv = [], ao = [], idx = [], tan = [];
  const T = new THREE.Vector3(), O = new THREE.Vector3(), S = new THREE.Vector3(), P = new THREE.Vector3(), Nn = new THREE.Vector3(), C = new THREE.Vector3();
  const ring = (center, w, th, t, sc, push, along) => {
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      // a slightly squarish cross-section reads as a soft "clay" lock
      const c = Math.cos(a), s = Math.sin(a);
      const cc = Math.sign(c) * Math.pow(Math.abs(c), 0.8), ss = Math.sign(s) * Math.pow(Math.abs(s), 0.8);
      P.copy(center).addScaledVector(S, cc * w * sc).addScaledVector(O, ss * th * sc);
      Nn.copy(S).multiplyScalar(c / Math.max(w, 1e-4)).addScaledVector(O, s / Math.max(th, 1e-4)).normalize();
      if (along) Nn.multiplyScalar(Math.sqrt(Math.max(0, 1 - push * push))).addScaledVector(T, push).normalize();
      pos.push(P.x, P.y, P.z); nor.push(Nn.x, Nn.y, Nn.z);
      tan.push(T.x, T.y, T.z, wisp ? 1 : tw);
      const tt = uvT ? uvT[0] + (uvT[1] - uvT[0]) * t : t;
      uv.push((i / segs) * 0.3, tt);
      // underside and roots in shadow; the outer face catches light
      // (and darker toward its two edges, so neighbouring locks read as separate)
      ao.push((0.5 + 0.5 * (0.5 + 0.5 * s)) * (0.84 + 0.16 * Math.min(1, tt / 0.18)) * (1 - 0.34 * Math.pow(Math.abs(c), 5)));
    }
  };
  let rings = 0;
  for (let k = 0; k < n; k++) {
    if (k < n - 1) T.subVectors(pts[k + 1], pts[k]); else T.subVectors(pts[k], pts[k - 1]);
    T.normalize();
    O.copy(outs[k]).addScaledVector(T, -outs[k].dot(T)).normalize();
    S.crossVectors(T, O).normalize();
    ring(pts[k], widths[k] * 0.5, thicks[k] * 0.5, k / (n - 1), 1, 0, false);
    rings++;
  }
  // the tip closes the lock (no open end ever shows): a soft round cap, or a
  // short cone drawing the lock to a fine point
  if (tip) {
    const w = widths[n - 1] * 0.5, th = thicks[n - 1] * 0.5;
    const pointed = tip === 'point';
    const reach = pointed ? Math.min(Math.max(w, th) * reachK, 0.03) : Math.min(Math.max(w, th) * 0.9, 0.02);
    for (let j = 1; j <= capRings; j++) {
      const f = j / capRings;
      const b = f * Math.PI * 0.5;
      C.copy(pts[n - 1]).addScaledVector(T, (pointed ? f : Math.sin(b)) * reach);
      ring(C, w, th, 1, Math.max(pointed ? 1 - f : Math.cos(b), 0.001), pointed ? 0.3 * f : Math.sin(b), true);
      rings++;
    }
  }
  for (let k = 0; k < rings - 1; k++) for (let i = 0; i < segs; i++) {
    const a = k * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 4));
  g.setIndex(idx);
  return g;
}

export function mergeGeos(list) {
  let nv = 0, ni = 0;
  list.forEach((g) => { nv += g.attributes.position.count; ni += g.index.count; });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ao = new Float32Array(nv), idx = new Uint32Array(ni);
  const tan = new Float32Array(nv * 4);
  let vo = 0, io = 0;
  list.forEach((g) => {
    if (g.attributes.aTan) tan.set(g.attributes.aTan.array, vo * 4);
    else for (let k = 0; k < g.attributes.position.count; k++) tan[(vo + k) * 4 + 1] = -1;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.attributes.aAO) ao.set(g.attributes.aAO.array, vo); else ao.fill(1, vo, vo + g.attributes.position.count);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  out.setAttribute('aTan', new THREE.BufferAttribute(tan, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
