// Soft clouds from feathered, gently lit puffs: camera-facing sprites sorted
// back-to-front; with `soft` they fade where they meet the sea of clouds, the
// peaks or the ground (depth of the opaque pass).
import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { mulberry32, TAU } from './math.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 2x2 atlas, RGBA8: rg = normal.xy, b = density, a = coverage.
// Soft, feathered puffs: overlapping gaussian blobs with a gentle domed normal
// and wide misty edges (no crisp cauliflower outline).
function billowAtlas() {
  const S = 512, T = 256;
  const data = new Uint8Array(S * S * 4);
  const rnd = mulberry32(4711);
  const P = 64;
  const grid = new Float32Array(P * P).map(() => rnd());
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const at = (i, j) => grid[(((j % P) + P) % P) * P + (((i % P) + P) % P)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
  const D = new Float32Array(T * T);
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T;
    // gaussian blobs [cx, cy, sx, sy, w] in tile units (v = 0 at the bottom)
    const G = [];
    if (tile === 0) {
      G.push([0.5, 0.46, 0.17, 0.15, 1]);
      for (let k = 0; k < 4; k++) G.push([0.5 + (rnd() - 0.5) * 0.3, 0.5 + rnd() * 0.12, 0.09 + rnd() * 0.05, 0.08 + rnd() * 0.04, 0.6 + rnd() * 0.3]);
    } else if (tile === 1) {
      G.push([0.5, 0.45, 0.24, 0.12, 1]);
      for (let k = 0; k < 5; k++) G.push([0.28 + rnd() * 0.44, 0.47 + rnd() * 0.1, 0.08 + rnd() * 0.05, 0.07 + rnd() * 0.04, 0.55 + rnd() * 0.3]);
    } else if (tile === 2) {
      // stretched wisp
      G.push([0.5, 0.5, 0.28, 0.07, 0.9]);
      for (let k = 0; k < 4; k++) G.push([0.25 + rnd() * 0.5, 0.5 + (rnd() - 0.5) * 0.08, 0.1 + rnd() * 0.06, 0.04 + rnd() * 0.02, 0.5 + rnd() * 0.3]);
    } else {
      G.push([0.5, 0.48, 0.14, 0.13, 1]);
      for (let k = 0; k < 3; k++) G.push([0.5 + (rnd() - 0.5) * 0.22, 0.5 + rnd() * 0.1, 0.07 + rnd() * 0.04, 0.07 + rnd() * 0.03, 0.6 + rnd() * 0.3]);
    }
    let dmax = 0;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const u = (x + 0.5) / T, v = (y + 0.5) / T;
        let d = 0;
        for (const [cx, cy, sx, sy, w] of G) {
          const dx = (u - cx) / sx, dy = (v - cy) / sy;
          d += w * Math.exp(-0.5 * (dx * dx + dy * dy));
        }
        // soft internal variation and a little breakup toward the rim
        const n = fbm(u * 5 + tile * 3.1, v * 5 + tile * 1.7);
        d *= 0.8 + 0.4 * n;
        // keep away from the tile border (mip bleeding)
        const edge = Math.min(u, 1 - u, v, 1 - v);
        d *= sstep(0.0, 0.08, edge);
        D[y * T + x] = d;
        if (d > dmax) dmax = d;
      }
    }
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const v = (y + 0.5) / T;
        const d = D[y * T + x] / dmax;
        // gentle dome: height grows with density, normals stay soft
        const h = (k) => Math.sqrt(Math.max(0, k)) * 0.22;
        const xl = D[y * T + Math.max(0, x - 2)] / dmax, xr = D[y * T + Math.min(T - 1, x + 2)] / dmax;
        const yd = D[Math.max(0, y - 2) * T + x] / dmax, yu = D[Math.min(T - 1, y + 2) * T + x] / dmax;
        let nx = -(h(xr) - h(xl)) * T * 0.25, ny = -(h(yu) - h(yd)) * T * 0.25, nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        // wide, misty falloff; flatter, softer base
        const a = Math.pow(sstep(0.0, 0.78, d), 1.25) * (0.75 + 0.25 * sstep(0.1, 0.5, v));
        const i = ((oy + y) * S + (ox + x)) * 4;
        data[i] = Math.round((nx * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round(Math.min(1, d) * 255);
        data[i + 3] = Math.round(a * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  // (no anisotropic filtering: the sprites always face the camera, so it would only cost)
  t.needsUpdate = true;
  return t;
}

// The sprite's outline: an octagon around the round puff instead of a square - the empty
// corners (a sixth of every sprite, many layers deep in a cloud bank) are never drawn
function octagonGeometry() {
  const g = new THREE.BufferGeometry();
  const a = 0.5, b = 0.5 * Math.tan(Math.PI / 8);
  // (corners counter-clockwise from the right, facing +z like the plane it replaces; its
  // inscribed circle is the whole width of the sprite)
  const P = [a, -b, a, b, b, a, -b, a, -a, b, -a, -b, -b, -a, b, -a];
  const pos = new Float32Array(8 * 3);
  for (let i = 0; i < 8; i++) { pos[i * 3] = P[i * 2]; pos[i * 3 + 1] = P[i * 2 + 1]; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7]);
  return g;
}

export function cloudSpriteMaterial(U, soft) {
  const defines = {};
  const uniforms = {
    ...U,
    uAtlas: { value: billowAtlas() },
    uLit: { value: new THREE.Color('#fffdf7') },
    uShadeC: { value: new THREE.Color('#a9b5d8') },
    uOpacity: { value: 1 },
  };
  if (soft) {
    defines.SOFT = 1;
    uniforms.tSceneDepth = soft.tSceneDepth;
    uniforms.uSceneRes = soft.uSceneRes;
    uniforms.uNear = soft.uNear;
    uniforms.uFar = soft.uFar;
  }
  return new THREE.ShaderMaterial({
    defines,
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter; attribute vec4 aPar; // size, rotation, tile, height in cloud
      attribute float aShade;
      uniform float uTime;
      varying vec2 vUv; varying vec2 vRot; varying vec3 vW;
      varying float vH; varying float vShade; varying float vAlpha; varying float vViewZ; varying float vSize;
      void main() {
        float size = aPar.x;
        float ph = fract(aCenter.x * 0.0131 + aCenter.z * 0.0071 + aPar.y) * 6.2831853;
        // billows slowly breathe and turn, so the heap seems to boil
        float rot = aPar.y + sin(uTime * 0.035 + ph) * 0.07;
        float cs = cos(rot), sn = sin(rot);
        vec2 cr = position.xy;
        vec2 rc = vec2(cs * cr.x - sn * cr.y, sn * cr.x + cs * cr.y) * size * (1.0 + 0.025 * sin(uTime * 0.11 + ph * 2.0));
        vec3 c = aCenter + vec3(sin(uTime * 0.05 + ph) * 2.0, sin(uTime * 0.04 + ph * 1.7) * 0.6, cos(uTime * 0.045 + ph) * 2.0);
        vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 Up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 w = c + R * rc.x + Up * rc.y;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        vW = w;
        vViewZ = -mv.z;
        vAlpha = smoothstep(size * 0.15, size * 0.85, -mv.z);
        // (a puff the camera is right inside is not drawn at all: it would only cover the whole
        // screen, invisibly)
        if (vAlpha <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vRot = vec2(cs, sn);
        float tile = aPar.z;
        vUv = vec2(mod(tile, 2.0), floor(tile * 0.5)) * 0.5 + (cr + 0.5) * 0.5;
        vH = aPar.w; vShade = aShade; vSize = size;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform sampler2D uAtlas; uniform vec3 uLit, uShadeC; uniform float uOpacity;
      #ifdef SOFT
        uniform sampler2D tSceneDepth; uniform vec2 uSceneRes; uniform float uNear, uFar;
      #endif
      varying vec2 vUv; varying vec2 vRot; varying vec3 vW;
      varying float vH; varying float vShade; varying float vAlpha; varying float vViewZ; varying float vSize;
      void main() {
        // (two mips softer than the atlas: misty, feathered puffs)
        vec4 t = texture2D(uAtlas, vUv, 1.8);
        // (outside the puff: nothing to draw - the fraying below can at most double a trace
        // of coverage, which would still fall under the cut-off at the end)
        if (t.a < 0.015) discard;
        // the edges fray into wisps that drift with the wind (world-space noise, so each
        // puff's outline slowly changes)
        float wn = texture2D(uNoise, vW.xz * 0.012 + vec2(vW.y * 0.01, 0.0) + uTime * vec2(0.004, 0.0015)).g;
        float wn2 = texture2D(uNoise, vW.xy * 0.03 - uTime * vec2(0.006, 0.002)).b;
        float fray = (wn * 0.65 + wn2 * 0.35 - 0.5) * 0.9;
        // (only the soft rim frays: nothing is added outside the puff, so no sprite edge shows)
        float ta = clamp(t.a + fray * t.a * (1.0 - t.a) * 2.6, 0.0, 1.0);
        float a = ta * ta * (3.0 - 2.0 * ta) * 0.8 * vAlpha * uOpacity;
        #ifdef SOFT
          float sd = texture2D(tSceneDepth, gl_FragCoord.xy / uSceneRes).r;
          float sz = (uNear * uFar) / (uFar - sd * (uFar - uNear));
          a *= clamp((sz - vViewZ) / (vSize * 0.28), 0.0, 1.0);
        #endif
        if (a < 0.004) discard;
        // baked lobe normal -> world (sprite faces the camera)
        vec2 n2 = t.rg * 2.0 - 1.0;
        n2 = vec2(vRot.x * n2.x - vRot.y * n2.y, vRot.y * n2.x + vRot.x * n2.y);
        float nz = sqrt(max(1.0 - dot(n2, n2), 0.0));
        vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 Up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 B = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 N = normalize((R * n2.x + Up * n2.y) * 0.7 + B * nz);
        float ndl = dot(N, uSunDir);
        float dens = t.b;
        // soft light: the mass is bright on top and on the sunny side, never inky
        float hs = smoothstep(0.0, 1.0, vH * 0.75 + 0.25 + N.y * 0.1);
        float dl = smoothstep(-0.9, 0.9, ndl);
        float l = 0.3 + 0.7 * (hs * 0.55 + dl * 0.45);
        l = clamp(l * vShade, 0.0, 1.0);
        vec3 shade = mix(uShadeC, uLit, 0.38) * uShadowTint;
        vec3 col = mix(shade, uLit * uLightTint, l);
        // thin, misty edges let light through and read paler
        col = mix(col, uLit * uLightTint, (1.0 - dens) * 0.3);
        vec3 V = normalize(cameraPosition - vW);
        float back = pow(max(dot(-V, uSunDir), 0.0), 5.0);
        col += uSunCol * back * (1.0 - dens) * 0.5;
        col = applyFogK(col, vW, 0.75);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false,
  });
}

// clusters: [{ x, y, z, w, h, d, n, s }] (y = base of the heap) -> one sorted, instanced set
export class CloudSprites {
  // split: puffs wholly farther than this many metres go to a second mesh drawn in the
  // half-resolution far layer (only without soft edges, which need the near depth)
  constructor(U, clusters, { seed = 99, soft = null, split = 0 } = {}) {
    const rnd = mulberry32(seed);
    const items = [];
    clusters.forEach((cl) => {
      const bs = cl.s || cl.w * 0.42;
      for (let k = 0; k < cl.n; k++) {
        // cumulus: flat base, heaped top, the biggest billows in the middle
        const u = rnd() * 2 - 1, w = rnd() * 2 - 1;
        const core = 1 - u * u * 0.75 - w * w * 0.25;
        const hy = Math.pow(rnd(), 0.8) * cl.h * core;
        const size = bs * (0.6 + 0.5 * rnd()) * (0.7 + 0.45 * core);
        const x = cl.x + u * cl.w * 0.5;
        const z = cl.z + w * cl.d * 0.5;
        const y = cl.y + hy + size * 0.18;
        const tile = cl.wisp ? (rnd() < 0.6 ? 2 : 1) : (rnd() < 0.35 ? 1 : (rnd() < 0.75 ? 0 : 3));
        items.push({ x, y, z, size, rot: (rnd() - 0.5) * 0.7, tile, h: Math.min(1, hy / Math.max(1, cl.h) * 1.1 + (cl.lift || 0)), shade: 0.9 + rnd() * 0.16 });
      }
    });
    this.items = items;
    const n = items.length;
    this.mat = cloudSpriteMaterial(U, soft);
    const make = () => {
      const base = octagonGeometry();
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.attributes.position);
      const S = { center: new Float32Array(n * 3), par: new Float32Array(n * 4), shade: new Float32Array(n), geo: g };
      S.aCenter = new THREE.InstancedBufferAttribute(S.center, 3);
      S.aPar = new THREE.InstancedBufferAttribute(S.par, 4);
      S.aShade = new THREE.InstancedBufferAttribute(S.shade, 1);
      [S.aCenter, S.aPar, S.aShade].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aCenter', S.aCenter);
      g.setAttribute('aPar', S.aPar);
      g.setAttribute('aShade', S.aShade);
      g.instanceCount = n;
      S.mesh = new THREE.Mesh(g, this.mat);
      S.mesh.frustumCulled = false;
      S.mesh.renderOrder = 12;
      return S;
    };
    this.split = soft ? 0 : split;
    this.sets = [make()];
    this.mesh = this.sets[0].mesh;
    if (this.split > 0) {
      const far = make();
      far.mesh.userData.split = 'far';
      far.geo.instanceCount = 0;
      this.sets.push(far);
      // both live in one group so the scene can show / hide them together
      this.group = new THREE.Group();
      this.group.add(far.mesh, this.mesh);
    }
    this.root = this.group || this.mesh;
    this.order = new Uint32Array(n).map((_, i) => i);
    this.key = new Float32Array(n);
    this._p = new THREE.Vector3(1e9, 0, 0);
    this._f = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.write();
  }
  write() {
    const it = this.items, o = this.order, k = this.key, D = this.split;
    const cnt = [0, 0];
    for (let i = 0; i < o.length; i++) {
      const b = it[o[i]];
      // (back to front; the farthest, wholly past the split, go to the far layer)
      const si = D > 0 && k[o[i]] - b.size * 0.75 > D ? 1 : 0;
      const S = this.sets[si], j = cnt[si]++;
      S.center[j * 3] = b.x; S.center[j * 3 + 1] = b.y; S.center[j * 3 + 2] = b.z;
      S.par[j * 4] = b.size; S.par[j * 4 + 1] = b.rot; S.par[j * 4 + 2] = b.tile; S.par[j * 4 + 3] = b.h;
      S.shade[j] = b.shade;
    }
    this.sets.forEach((S, si) => {
      S.geo.instanceCount = cnt[si];
      S.aCenter.needsUpdate = true; S.aPar.needsUpdate = true; S.aShade.needsUpdate = true;
    });
  }
  // back-to-front along the view axis (billboards are parallel to the view plane)
  sort(camera) {
    camera.getWorldDirection(this._d);
    const p = camera.position;
    if (p.distanceToSquared(this._p) < 1 && this._d.dot(this._f) > 0.9995) return;
    this._p.copy(p); this._f.copy(this._d);
    const it = this.items, k = this.key, d = this._d;
    for (let i = 0; i < it.length; i++) {
      const b = it[i];
      k[i] = (b.x - p.x) * d.x + (b.y - p.y) * d.y + (b.z - p.z) * d.z;
    }
    if (!this._arr) this._arr = Array.from(this.order);
    const arr = this._arr;
    arr.sort((a, b) => k[b] - k[a]);
    this.order.set(arr);
    this.write();
  }
}
