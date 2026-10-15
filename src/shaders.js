import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared uniforms (one object; every material references the same values)
export function makeSharedUniforms(noiseTex) {
  return {
    uTime: { value: 0 },
    uNoise: { value: noiseTex },
    uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.5).normalize() },
    uSunCol: { value: new THREE.Color('#fff2d8') },
    uAmb: { value: new THREE.Color('#8fb3d9') },
    uShadowTint: { value: new THREE.Color(1, 1, 1) },
    uLightTint: { value: new THREE.Color(1, 1, 1) },
    uFogCol: { value: new THREE.Color('#9cb8cc') },
    uFogSunCol: { value: new THREE.Color('#e9eef0') },
    uFogDensity: { value: 0.0011 },
    uFogHeight: { value: 20 },
    uFogHeightFalloff: { value: 0.02 },
    uFogHeightAmt: { value: 0.3 },
    uMist: { value: 0 },
    uPointPos: { value: new THREE.Vector3() },
    uPointCol: { value: new THREE.Color('#ffb46a') },
    uPointAmt: { value: 0 },
    uRipple: { value: new THREE.Vector4(0, 0, 0, 0) },
    uRippleAmt: { value: 0 },
    // grass and flowers pushed aside around her feet, her cat and her dog: (x, z, radius, bend)
    uPush0: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPush1: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPush2: { value: new THREE.Vector4(0, 0, 1, 0) },
    uGold: { value: new THREE.Color('#f3d9a4') },
    uNight: { value: 0 },
    uWind: { value: 0.35 },
    uCharPos: { value: new THREE.Vector3() },
    uStepS: { value: 0 },
    uFootAmt: { value: 0 },
    // the bloom: radius of the wave from the flower, and how far she has walked since
    uBloomR: { value: 0 },
    uBloomC: { value: new THREE.Vector3() },
    uWalkS: { value: -1e4 },
    uRimCol: { value: new THREE.Color('#fff4dc') },
    // (1 while the scene is drawn multisampled: fur can then use partial cover)
    uMSAA: { value: 1 },
    // (metres across one pixel, per metre from the camera)
    uPxK: { value: 0.0013 },
    ...bloomKindUniforms(),
  };
}

// The kinds of flower in the bloom's drifts, as tables the shaders index (one lookup
// instead of a chain of comparisons): petal colours (mixed by a per-flower shade), eye
// colour, and shape (petals, how deep the gaps between them cut, how slim the petals
// are, eye radius). Sixteen slots, so the common kinds take several.
function bloomKindUniforms() {
  const K = {
    daisy: [[0.95, 0.93, 0.89], [0.95, 0.93, 0.89], [1.0, 0.7, 0.12], [13, 0.84, 1.7, 0.21]],
    cosmos: [[0.95, 0.32, 0.6], [0.97, 0.52, 0.74], [1.0, 0.78, 0.26], [8, 0.5, 0.75, 0.15]],
    buttercup: [[0.95, 0.72, 0.07], [1.0, 0.8, 0.1], [0.95, 0.5, 0.08], [5, 0.46, 0.5, 0.2]],
    poppy: [[0.97, 0.16, 0.13], [1.0, 0.36, 0.1], [0.24, 0.1, 0.08], [5, 0.24, 0.6, 0.19]],
    cornflower: [[0.26, 0.44, 0.97], [0.4, 0.58, 1.0], [0.96, 0.95, 1.0], [9, 0.56, 1.2, 0.14]],
    violet: [[0.54, 0.3, 0.94], [0.68, 0.46, 0.98], [1.0, 0.82, 0.26], [5, 0.42, 0.5, 0.17]],
    apricot: [[1.0, 0.5, 0.28], [1.0, 0.64, 0.42], [1.0, 0.8, 0.3], [5, 0.4, 0.5, 0.18]],
    magenta: [[0.86, 0.14, 0.5], [0.95, 0.3, 0.62], [1.0, 0.84, 0.36], [6, 0.45, 0.6, 0.17]],
    coreopsis: [[0.95, 0.78, 0.22], [1.0, 0.85, 0.26], [0.8, 0.34, 0.06], [10, 0.62, 1.0, 0.23]],
  };
  const slots = ['daisy', 'daisy', 'cosmos', 'cosmos', 'cosmos', 'buttercup', 'buttercup', 'poppy', 'poppy', 'cornflower', 'violet', 'violet', 'apricot', 'magenta', 'magenta', 'coreopsis'];
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  return {
    uKindA: { value: slots.map((k) => v3(K[k][0])) },
    uKindB: { value: slots.map((k) => v3(K[k][1])) },
    uKindE: { value: slots.map((k) => v3(K[k][2])) },
    uKindS: { value: slots.map((k) => new THREE.Vector4(...K[k][3])) },
  };
}

export const COMMON = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uShadowTint;
uniform vec3 uLightTint;
uniform vec3 uFogCol;
uniform vec3 uFogSunCol;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogHeightFalloff;
uniform float uFogHeightAmt;
uniform float uMist;
uniform vec3 uPointPos;
uniform vec3 uPointCol;
uniform float uPointAmt;
uniform vec4 uRipple;
uniform float uRippleAmt;
uniform vec3 uGold;
uniform float uNight;
uniform float uWind;

// C2-smooth texture lookup: removes bilinear kinks so thresholded noise has smooth edges
vec4 texSmooth(sampler2D t, vec2 uv) {
  vec2 p = uv * 256.0 + 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return texture2D(t, (i + f - 0.5) / 256.0);
}

vec3 applyFogK(vec3 col, vec3 P, float k) {
  vec3 V = P - cameraPosition;
  float d = length(V);
  float fog = 1.0 - exp(-pow(d * uFogDensity * k, 1.75));
  float hy = max(P.y - uFogHeight, 0.0);
  float hf = exp(-hy * uFogHeightFalloff) * uFogHeightAmt;
  hf *= 1.0 - exp(-d * 0.0045);
  if (uMist > 0.001) {
    float mistN = texture2D(uNoise, P.xz * 0.0035 + vec2(uTime * 0.0045, uTime * 0.0012)).r;
    hf *= mix(1.0, 0.25 + mistN * 1.5, uMist);
  }
  fog = clamp(fog + hf * (1.0 - fog) * k, 0.0, 1.0);
  float s = pow(max(dot(normalize(V), uSunDir), 0.0), 5.0);
  vec3 fc = mix(uFogCol, uFogSunCol, s);
  return mix(col, fc, fog);
}
vec3 applyFog(vec3 col, vec3 P) { return applyFogK(col, P, 1.0); }

vec3 pointLight(vec3 P, vec3 N) {
  if (uPointAmt <= 0.0) return vec3(0.0);
  vec3 Lv = uPointPos - P;
  float d = length(Lv);
  float att = uPointAmt / (1.0 + d * d * 0.55);
  float ndl = max(dot(N, Lv / max(d, 1e-3)), 0.0) * 0.75 + 0.25;
  return uPointCol * att * ndl;
}
`;

// The bloom's flowers grow in drifts: ragged patches a few metres across, each of one
// kind (white daisies, pink cosmos, buttercups, poppies, cornflowers...), with strays.
// Shared by the painted carpet, the little posies and the flower carpet so they agree.
// (needs uNoise declared first)
export const BLOOM_GLSL = /* glsl */ `
vec3 bloomHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
// x: the kind growing in the patch at xz, y: its shade, z: how full the patch is (the
// emptiest are left to strays), w: how far inside the patch (0 at its edge, 0.5 middle).
// w1, w2: the noise there, texSmooth(uNoise, xz * 0.027 + 0.71).rg and
// texture2D(uNoise, xz * 0.105 + 0.13).gb (the terrain has these to hand already)
vec4 bloomPatchW(vec2 xz, vec2 w1, vec2 w2) {
  // a turned grid, bent twice over so no patch keeps a corner
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * xz * 0.25 + (w1 - 0.5) * 2.4 + (w2 - 0.5) * 0.8;
  vec2 c = floor(q);
  vec2 f = q - c;
  vec3 h = bloomHash(c + 17.17);
  return vec4(h, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
}
vec4 bloomPatch(vec2 xz) {
  vec2 uv = (xz * 0.027 + 0.71) * 256.0 + 0.5;
  vec2 i = floor(uv), f = uv - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return bloomPatchW(xz, texture2D(uNoise, (i + f - 0.5) / 256.0).rg, texture2D(uNoise, xz * 0.105 + 0.13).gb);
}
// strays painted on the ground: white, pink, butter, lilac (h: any number, 0..1 cycles)
vec3 strayCol(float h) {
  h = fract(h);
  return h < 0.25 ? vec3(1.0, 0.97, 0.94) : h < 0.5 ? vec3(1.0, 0.5, 0.72) : h < 0.75 ? vec3(1.0, 0.86, 0.3) : vec3(0.72, 0.52, 1.0);
}
// petal colour, eye colour and shape of kind k (0..1; see bloomKindUniforms); v: its shade
uniform vec3 uKindA[16]; uniform vec3 uKindB[16]; uniform vec3 uKindE[16]; uniform vec4 uKindS[16];
void bloomKind(float k, float v, out vec3 pc, out vec3 ec, out vec4 sh) {
  int i = int(clamp(k, 0.0, 0.999) * 16.0);
  pc = mix(uKindA[i], uKindB[i], v); ec = uKindE[i]; sh = uKindS[i];
}
`;

// Growth on the clock: a plant takes the same time to rise and open after the bloom
// reaches it, however fast the bloom was travelling (or if she stops walking).
// uGrowKey: how far the bloom has reached now; uGK: how far it had reached a quarter,
// half, three quarters and a whole growing time ago. growX: -1 not yet reached, else
// growing time elapsed (0 at reach, 1 a whole growing time later, more after)
export const GROW_GLSL = /* glsl */ `
uniform float uGrowKey; uniform vec4 uGK;
float growX(float k) {
  if (k >= uGrowKey) return -1.0;
  if (k > uGK.x) return 0.25 * (uGrowKey - k) / max(uGrowKey - uGK.x, 1e-4);
  if (k > uGK.y) return 0.25 + 0.25 * (uGK.x - k) / max(uGK.x - uGK.y, 1e-4);
  if (k > uGK.z) return 0.5 + 0.25 * (uGK.y - k) / max(uGK.y - uGK.z, 1e-4);
  if (k > uGK.w) return 0.75 + 0.25 * (uGK.z - k) / max(uGK.z - uGK.w, 1e-4);
  return 1.0 + (uGK.w - k) * 0.4;
}
`;

// ---------------------------------------------------------------------------
// Painterly terrain (also used for spires, islands, rocks)
export const TERRAIN_PALETTE = {
  // (fresh, clear greens: the sunlit meadow a true spring green rather than a pale yellow-green)
  uG0: '#223c2e', uG1: '#2b5034', uG2: '#3f6e3c', uG3: '#4c8b3d', uG4: '#5ca345', uG5: '#7fbf55',
  uForest: '#1f3829', uForestL: '#2c5033',
  uRockD: '#38484a', uRockM: '#5b6a5f', uRockL: '#99a08a', uPeach: '#dca98a', uCream: '#e4dcae',
  uDirt: '#cdbb93', uDirtD: '#9a8862',
};

export function terrainMaterial(U, extra = {}) {
  const uniforms = { ...U };
  for (const k in TERRAIN_PALETTE) uniforms[k] = { value: new THREE.Color(TERRAIN_PALETTE[k]) };
  uniforms.uSplat = { value: extra.splat || null };
  uniforms.uSplatRect = { value: extra.splatRect || new THREE.Vector4(0, 0, 1, 1) };
  uniforms.uSplatOn = { value: extra.splat ? 1 : 0 };
  uniforms.uHiStart = { value: extra.hiStart ?? 150 };
  uniforms.uFlatGrass = { value: extra.flatGrass ?? 0 };
  uniforms.uRockBias = { value: extra.rockBias ?? 0 };
  uniforms.uAmbAdd = { value: extra.ambAdd ?? 0 };
  uniforms.uCanopy = { value: extra.canopy ?? 0 };
  uniforms.uPeachK = { value: extra.peach ?? 1 };
  uniforms.uSnowLine = { value: extra.snowLine ?? 1e5 };
  return new THREE.ShaderMaterial({
    defines: { ...(extra.karst ? { KARST: 1 } : {}), ...(extra.low ? { LOW_Q: 1 } : {}) },
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${BLOOM_GLSL}
      uniform vec3 uG0, uG1, uG2, uG3, uG4, uG5, uForest, uForestL;
      uniform vec3 uRockD, uRockM, uRockL, uPeach, uCream, uDirt, uDirtD;
      uniform sampler2D uSplat; uniform vec4 uSplatRect; uniform float uSplatOn;
      uniform float uHiStart; uniform float uFlatGrass; uniform float uRockBias; uniform float uAmbAdd; uniform float uCanopy; uniform float uPeachK; uniform float uSnowLine;
      uniform vec3 uCharPos; uniform float uStepS; uniform float uFootAmt;
      uniform float uBloomR; uniform vec3 uBloomC;
      varying vec3 vW; varying vec3 vN;
      vec3 hash32(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yxz + 33.33);
        return fract((p3.xxy + p3.yzz) * p3.zyx);
      }
      // little five-petalled blooms scattered on a jittered grid. x: cover (soft edged),
      // y: the eye, z: a random pick per bloom. Once a bloom is only a couple of pixels
      // wide it melts into its average tint, so the meadow never shimmers far away
      vec3 florets(vec2 p, float cell, float dens, float seed) {
        vec2 gp = p / cell;
        vec2 g = floor(gp);
        vec2 f = gp - g;
        vec3 h = hash32(g + seed);
        vec3 h2 = hash32(g.yx * 1.37 + seed * 1.7 + 19.19);
        float r = 0.12 + 0.09 * h.z;
        vec2 d = f - (0.26 + 0.48 * h.xy);
        float dl = length(d);
        float pet = r * (0.78 + 0.22 * cos(5.0 * atan(d.y, d.x) + h2.y * 6.283));
        float aa = length(fwidth(gp)) * 0.7 + 1e-4;
        float on = step(h2.x, dens);
        float m = (1.0 - smoothstep(pet - aa, pet + aa, dl)) * on;
        float eye = (1.0 - smoothstep(r * 0.3 - aa, r * 0.3 + aa, dl)) * on;
        float sub = smoothstep(0.07, 0.24, aa);
        return vec3(mix(m, dens * 5.0 * r * r, sub), eye * (1.0 - sub), h2.z);
      }
      // big painted blossoms for the bloomed meadow: up to three quarters of their cell
      // wide, five or six soft lobes and a golden eye (x cover, y eye, z random)
      vec3 bigBlooms(vec2 p, float cell, float dens, float seed) {
        vec2 gp = p / cell;
        vec2 g = floor(gp);
        vec2 f = gp - g;
        vec3 h = hash32(g + seed);
        vec3 h2 = hash32(g.yx * 1.91 + seed * 2.3 + 7.7);
        float r = 0.24 + 0.13 * h.z;
        vec2 d = f - (0.38 + 0.24 * h.xy);
        float dl = length(d);
        float lobes = h2.y < 0.5 ? 5.0 : 6.0;
        float pet = r * (0.72 + 0.28 * cos(lobes * atan(d.y, d.x) + h2.z * 6.283));
        float aa = length(fwidth(gp)) * 0.7 + 1e-4;
        float on = step(h2.x, dens);
        float m = (1.0 - smoothstep(pet - aa, pet + aa, dl)) * on;
        float eye = (1.0 - smoothstep(r * 0.27 - aa, r * 0.27 + aa, dl)) * on;
        float sub = smoothstep(0.07, 0.24, aa);
        return vec3(mix(m * (0.88 + 0.12 * smoothstep(pet, pet * 0.35, dl)), dens * 2.4 * r * r, sub), eye * (1.0 - sub), h2.z);
      }
      // the same, for specks too small to show petals: plain soft dots, cheaper
      float specks(vec2 p, float cell, float dens, float seed) {
        vec2 gp = p / cell;
        vec2 g = floor(gp);
        vec3 h = hash32(g + seed);
        float r = 0.07 + 0.06 * h.z;
        float dl = length(gp - g - (0.26 + 0.48 * h.xy));
        float aa = length(fwidth(gp)) * 0.7 + 1e-4;
        float m = (1.0 - smoothstep(r - aa, r + aa, dl)) * step(fract(h.x * 7.31 + h.y * 3.17), dens);
        return mix(m, dens * 3.0 * r * r, smoothstep(0.07, 0.24, aa));
      }
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 P = vW;
        float slope = clamp(1.0 - N.y, 0.0, 1.0);
        vec2 q = P.xz;
        slope = mix(slope, 0.0, uFlatGrass);
        vec4 nA = texSmooth(uNoise, q * 0.0016);
        vec4 nB = texSmooth(uNoise, q * 0.0063 + 0.37);
        vec4 nC = texSmooth(uNoise, q * 0.027 + 0.71);
        vec4 nD = texture2D(uNoise, q * 0.105 + 0.13);
        float camD = length(P - cameraPosition);
        // vertical brush strokes on the slopes (projected per facing axis; no
        // normal-amplified jumps); the flat meadow needs none
        float wx = N.x * N.x, wz = N.z * N.z, ws = wx + wz + 1e-4;
        float streak = 0.5;
        if (slope > 0.05) {
          float stA = texSmooth(uNoise, vec2(P.z * 0.052, P.y * 0.011)).g;
          float stB = texSmooth(uNoise, vec2(P.x * 0.052, P.y * 0.011 + 0.5)).g;
          streak = mix(0.5, (stA * wx + stB * wz) / ws, smoothstep(0.05, 0.13, slope));
        }

        float ndl = dot(N, uSunDir);
        float L = ndl * 0.55 + 0.47;
        float flatK = 1.0 - smoothstep(0.05, 0.3, slope);
        L += (nA.r - 0.5) * (0.52 + flatK * 0.25) + (nB.g - 0.5) * (0.30 + flatK * 0.2) + (streak - 0.5) * 0.30 * smoothstep(0.15, 0.6, slope);
        float e = (nC.b - 0.5) * 0.15 + (nD.b - 0.5) * 0.06;

        // dense tree canopy seen from afar: crowns catch light, gaps fall dark
        float canK = uCanopy * smoothstep(35.0, 140.0, camD) * (1.0 - uFlatGrass);
        if (canK > 0.0) {
          vec2 cq = vec2(P.x + P.z * 0.37, P.y + (P.z - P.x) * 0.21);
          float c1 = texture2D(uNoise, P.xz * 0.072 + vec2(P.y * 0.031, 0.0)).b;
          float c2 = texture2D(uNoise, cq * 0.055 + 0.41).b;
          float crowns = mix(c1, c2, smoothstep(0.2, 0.6, slope));
          L += (crowns - 0.5) * 0.36 * canK;
        }
        // (soft-edged bands: crisp painted steps up close made the hills look harsh far off)
        float bw = mix(0.15, 0.1, smoothstep(8.0, 60.0, camD));
        float b1 = smoothstep(0.24 + e, 0.24 + bw + e, L);
        float b2 = smoothstep(0.41 + e, 0.41 + bw + e, L);
        float b3 = smoothstep(0.57 + e, 0.57 + bw + e, L);
        float b4 = smoothstep(0.73 + e, 0.73 + bw + e, L);
        float b5 = smoothstep(0.90 + e, 0.90 + bw + e, L);
        vec3 grass = mix(uG0, uG1, b1);
        grass = mix(grass, uG2, b2);
        grass = mix(grass, uG3, b3);
        grass = mix(grass, uG4, b4);
        grass = mix(grass, uG5, b5);
        // brush tone variation inside bands
        grass *= 0.93 + nC.g * 0.14;
        // distant forest reads deeper and cooler
        grass = mix(grass, grass * vec3(0.8, 0.9, 0.84), canK * 0.55);

        // dark forest masses with jagged painted edges; they belong to the distance (up
        // close the meadow stays clean)
        float forest = 0.0;
        if (camD > 45.0 && uFlatGrass < 0.999) {
          float fm = texSmooth(uNoise, q * 0.0041 + vec2(0.21, 0.63)).g;
          forest = smoothstep(0.605, 0.625, fm + (nD.a - 0.5) * 0.17 + (nC.r - 0.5) * 0.09);
          forest *= smoothstep(0.62 + uRockBias, 0.30 + uRockBias * 0.6, slope) * (1.0 - smoothstep(uHiStart + 10.0, uHiStart + 110.0, P.y));
          forest *= (1.0 - uFlatGrass) * smoothstep(45.0, 120.0, camD);
        }
        vec3 fcol = mix(uForest, uForestL, smoothstep(0.5, 0.85, L) * 0.7);
        grass = mix(grass, fcol, forest * 0.92);

        // rock on steep faces
        float rockMask = smoothstep(0.40 + uRockBias, 0.56 + uRockBias, slope + (nB.r - 0.5) * 0.36 + (streak - 0.5) * 0.16);
        vec3 rock = mix(uRockD, uRockM, smoothstep(0.36 + e, 0.41 + e, L));
        rock = mix(rock, uRockL, smoothstep(0.60 + e, 0.66 + e, L));
        rock = mix(rock, uPeach, smoothstep(0.74 + e, 0.82 + e, L) * smoothstep(0.42, 0.72, nB.b) * uPeachK);
        rock *= 0.92 + streak * 0.16;
        #ifndef KARST
          // moss and turf creep over the rock: only the steepest faces and fresh scars stay
          // bare, so a hillside never shows a big flat plate of grey
          float mossR = smoothstep(0.42, 0.72, nC.g * 0.55 + nB.b * 0.45 + (0.66 - slope) * 0.8 + (streak - 0.5) * 0.3);
          rock = mix(rock, mix(grass, uForestL, 0.3) * mix(0.86, 1.0, smoothstep(0.4, 0.7, L)), mossR * 0.7);
        #endif
        #ifdef KARST
          // limestone towers: vegetation clings to all but the sheerest faces, where
          // bare rock shows in tall rain-streaked bands broken by planted ledges
          float bandA = texSmooth(uNoise, vec2(P.z * 0.017, P.y * 0.0035)).r;
          float bandB = texSmooth(uNoise, vec2(P.x * 0.017, P.y * 0.0035 + 0.5)).r;
          float band = (bandA * wx + bandB * wz) / ws;
          float sheer = smoothstep(0.6, 0.84, slope + (nB.r - 0.5) * 0.25);
          float ledge = smoothstep(0.5, 0.68, texSmooth(uNoise, vec2((P.x + P.z) * 0.0035, P.y * 0.03)).g);
          rockMask = sheer * smoothstep(0.52, 0.6, band + (nC.r - 0.5) * 0.12) * (1.0 - ledge * 0.9);
          // a canopy of clumped trees with dark gaps
          float cr1 = texture2D(uNoise, vec2(P.x + P.z * 0.6, P.y * 1.3 + (P.z - P.x) * 0.3) * 0.012).b;
          float cr2 = texture2D(uNoise, vec2(P.x - P.z * 0.4, P.y * 1.2) * 0.031 + 0.3).b;
          float crown = cr1 * 0.6 + cr2 * 0.4;
          // (lush: deep crowns, but sunlit tops in fresh greens - never a murky brown wall)
          vec3 veg = mix(mix(uForest, uForestL, 0.45), mix(grass, uForestL, 0.15), smoothstep(0.25, 0.7, crown + (L - 0.5) * 0.9));
          grass = mix(grass, veg, smoothstep(0.12, 0.45, slope) * 0.8);
          // pale limestone with dark rain stains
          rock = mix(rock, vec3(dot(rock, vec3(0.333))) * vec3(0.97, 0.99, 1.03) * 1.1, 0.45);
          float stain = smoothstep(0.55, 0.78, streak + (nD.g - 0.5) * 0.25);
          rock = mix(rock, rock * vec3(0.6, 0.64, 0.68), stain * 0.65);
        #endif
        vec3 col = mix(grass, rock, rockMask);

        // cream / ochre highlights high up
        float hi = smoothstep(uHiStart, uHiStart + 140.0, P.y + (nA.g - 0.5) * 120.0);
        // (green slopes stay green up to their crowns: only bare rock bleaches pale - no flat
        // cream plates on the grassy hills)
        hi *= mix(0.22, 1.0, rockMask);
        col = mix(col, mix(uCream, uPeach, nB.a * 0.55 * uPeachK), hi * smoothstep(0.55 + e, 0.61 + e, L) * 0.85);
        // snow on the high ridges (matches the alpine massifs)
        if (uSnowLine < 9e4) {
          float slA = uSnowLine + (nA.g - 0.5) * 90.0 + (nB.r - 0.5) * 34.0;
          float snowT = smoothstep(slA - 8.0, slA + 16.0, P.y) * smoothstep(0.7, 0.42, slope + (nC.b - 0.5) * 0.16 - (streak - 0.5) * 0.25);
          vec3 snc = mix(vec3(0.557, 0.643, 0.812), vec3(0.796, 0.843, 0.925), smoothstep(0.33 + e, 0.43 + e, L));
          snc = mix(snc, vec3(0.969, 0.973, 0.984), smoothstep(0.58 + e, 0.68 + e, L));
          col = mix(col, snc, snowT);
        }

        float pathMask = 0.0;
        float glowAdd = 0.0;
        if (uSplatOn > 0.5) {
          vec2 su = (P.xz - uSplatRect.xy) / uSplatRect.zw;
          if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
            vec4 sp = texture2D(uSplat, su);
            // (a ragged, organic edge: grass creeping in, bare patches out)
            float edgeN = nD.g - 0.5;
            #ifndef LOW_Q
              if (camD < 60.0) edgeN = mix(edgeN, (texture2D(uNoise, q * 0.37 + 0.17).b - 0.5) * 1.5, 0.4 * (1.0 - smoothstep(40.0, 60.0, camD)));
            #endif
            pathMask = smoothstep(0.36, 0.62, sp.r + edgeN * 0.3);
            float Ld = ndl * 0.5 + 0.5 + (nB.g - 0.5) * 0.2;
            vec3 dirt = mix(uDirtD, uDirt, smoothstep(0.3, 0.75, Ld));
            dirt *= 0.95 + nD.r * 0.1;
            col = mix(col, dirt, pathMask * (1.0 - rockMask * 0.6));
            col = mix(col, col * vec3(0.96, 1.07, 0.9) + vec3(0.015, 0.03, 0.0), sp.g * 0.7);
            col = mix(col, col * vec3(1.06, 0.93, 0.97) + vec3(0.07, 0.035, 0.055), sp.b * 0.6 * smoothstep(0.3, 0.7, nC.g));
            // tiny florets under the plants: buckwheat froth, garden specks
            float open = 1.0 - pathMask;
            // painted grass near the camera: fine strokes leaning with the breeze
            float nearG = (1.0 - smoothstep(5.0, 28.0, camD)) * open * (1.0 - rockMask);
            #ifdef LOW_Q
              nearG = 0.0;
            #endif
            if (nearG > 0.0) {
              vec2 sq = vec2(P.x * 0.9 + P.z * 0.35, P.z * 0.22 - P.x * 0.12);
              float strokes = texture2D(uNoise, sq * 1.7).g * 0.6 + texture2D(uNoise, sq * 4.3 + 0.5).r * 0.4;
              col *= 1.0 + (strokes - 0.5) * 0.24 * nearG;
              col = mix(col, col * vec3(1.0, 1.08, 0.9), smoothstep(0.6, 0.8, strokes) * 0.4 * nearG);
            }
            // clumps of tiny florets (froth of the buckwheat, specks in the garden); past a
            // few dozen metres they are only a faint tint, so skip the work
            if (camD < 48.0 && sp.b + sp.g > 0.02) {
              float clumpN = smoothstep(0.38, 0.72, texture2D(uNoise, P.xz * 0.22 + 0.71).g);
              float nearFade = mix(0.35, 1.0, smoothstep(2.0, 6.0, camD)) * (1.0 - smoothstep(40.0, 48.0, camD));
              if (sp.b > 0.02) {
                float sk = specks(P.xz, 0.11, 0.85 * sp.b * clumpN, 1.3);
                vec3 skc = mix(vec3(0.99, 0.92, 0.95), vec3(0.96, 0.76, 0.86), step(0.5, fract(P.x * 3.1 + P.z * 1.7)));
                col = mix(col, skc, sk * open * 0.75 * nearFade);
              }
              if (sp.g > 0.02) {
                vec3 gs = florets(P.xz + 0.37, 0.27, 0.55 * sp.g * mix(0.4, 1.0, clumpN), 5.9);
                vec3 gc = mix(vec3(0.99, 0.97, 0.9), vec3(0.74, 0.64, 0.93), step(0.5, gs.z));
                gc = mix(gc, vec3(0.98, 0.84, 0.45), step(0.8, gs.z));
                gc = mix(gc, vec3(0.98, 0.86, 0.5), gs.y * step(gs.z, 0.8));
                col = mix(col, gc, gs.x * open * 0.8 * (1.0 - smoothstep(40.0, 48.0, camD)));
              }
            }
            // glowing path behind her (World 3): sp.a encodes distance along the trail
            float sAlong = sp.a * 400.0;
            float onTrail = step(0.5, sp.a * 255.0);
            // flowers everywhere the bloom wave has reached, and wherever she has walked since
            float dB = length(P.xz - uBloomC.xz);
            float waveM = smoothstep(dB - 3.0, dB + 9.0, uBloomR);
            float walkM = smoothstep(sAlong - 4.0, sAlong + 1.0, uStepS) * onTrail * step(0.5, uBloomR);
            float bm = max(waveM, walkM) * (1.0 - pathMask);
            if (bm > 0.001) {
              // drifts: each patch of meadow is one kind of flower, with a few strays,
              // so it reads as patches of flowers rather than confetti
              vec4 pt = bloomPatchW(P.xz, nC.rg, nD.gb);
              float full = step(0.18, pt.z);
              float clumpy = smoothstep(0.3, 0.7, nC.b);
              vec3 pc, ec; vec4 sh;
              bloomKind(pt.x, pt.y, pc, ec, sh);
              if (camD < 46.0) {
                // a carpet of blossoms (strays in a few bright colours of their own)
                vec3 bb = bigBlooms(P.xz + 3.7, 0.36, 0.5 + 0.38 * clumpy, 13.1);
                vec3 cB = bb.z < 0.22 || full < 0.5 ? strayCol(bb.z * 4.5) : pc;
                col = mix(col, mix(cB, ec, bb.y * 0.9), bm * bb.x * 0.95);
                // and little florets between them
                vec3 fl = florets(P.xz, 0.31, 0.38 + 0.3 * clumpy, 3.1);
                vec3 cF = fl.z < 0.3 || full < 0.5 ? strayCol(fl.z * 3.3) : pc;
                col = mix(col, mix(cF, vec3(0.99, 0.86, 0.45), fl.y * 0.85), bm * fl.x * 0.92);
              } else {
                // (too small to draw one by one: their average)
                col = mix(col, pc, bm * (0.5 + 0.38 * clumpy) * 0.3);
              }
              // far away the flowers melt together: each patch washes the meadow with its
              // colour (soft at its edges, and only where flowers can grow)
              float farK = smoothstep(14.0, 45.0, camD) * (1.0 - smoothstep(70.0, 240.0, camD) * 0.45) * full * smoothstep(0.0, 0.3, pt.w) * (1.0 - smoothstep(0.1, 0.3, slope));
              col = mix(col, pc, bm * farK * 0.42);
              #ifndef LOW_Q
              if (camD < 40.0) col = mix(col, vec3(1.0, 0.97, 0.95), bm * specks(P.xz + 0.11, 0.16, 0.3, 8.3) * 0.7);
              #endif
              // the grass itself greens up and brightens where the bloom has passed
              col = mix(col, col * vec3(0.98, 1.08, 0.94) + vec3(0.01, 0.025, 0.0), bm * 0.6);
            }
            float behind = smoothstep(sAlong - 0.5, sAlong + 1.5, uStepS) * onTrail;
            float near = exp(-max(uStepS - sAlong, 0.0) / 18.0);
            float g = behind * (0.32 + 0.75 * near) * uFootAmt;
            // (softer close to the camera, where the walked path fills the bottom of the frame:
            // a warm glow there, never a white blaze)
            g *= mix(0.35, 1.0, smoothstep(3.0, 11.0, camD));
            float halo = smoothstep(0.04, 0.3, sp.r) * (1.0 - pathMask);
            glowAdd += pathMask * g * 0.72 + halo * g * 0.2;
          }
        }

        float lit = smoothstep(0.32, 0.66, L);
        col *= mix(uShadowTint, uLightTint, lit);
        col += uAmb * uAmbAdd * (1.0 - lit * 0.5);

        // the bloom racing through the garden: a soft band of gold where the flowers open
        if (uRippleAmt > 0.001) {
          float rd = length(P.xz - uRipple.xz);
          float rw = 0.55 + uRipple.w * 0.035;
          float ring = exp(-pow((rd - uRipple.w) / rw, 2.0));
          float wake = smoothstep(uRipple.w + 0.5, uRipple.w - 1.0, rd) * exp(-max(uRipple.w - rd, 0.0) / (2.0 + uRipple.w * 0.12));
          float inside = smoothstep(uRipple.w + 2.0, uRipple.w - 10.0, rd) * exp(-rd * 0.02);
          glowAdd += (ring * 0.4 + wake * 0.1 + inside * 0.02) * uRippleAmt * (0.65 + 0.35 * nD.g);
        }

        col += col * pointLight(P, N) * 1.6;
        col = applyFog(col, P);
        col += uGold * glowAdd;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: extra.side ?? THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------
export function skyMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uTop: { value: new THREE.Color('#3e66b8') },
    uMid: { value: new THREE.Color('#6f9be2') },
    uHor: { value: new THREE.Color('#bfe3f6') },
    uBelow: { value: new THREE.Color('#9cb8cc') },
    uStars: { value: 0 },
    // a crescent moon for the last night (direction + the offset disc that carves the crescent)
    uMoonDir: { value: new THREE.Vector3(0.572, 0.515, -0.638).normalize() },
    uMoonCut: { value: new THREE.Vector3(0.572, 0.515, -0.638).normalize() },
    uSkyClouds: { value: 0.6 },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudShade: { value: new THREE.Color('#b9c8e6') },
    uSunGlow: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    defines: opts.low ? { LOW_Q: 1 } : {},
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uTop, uMid, uHor, uBelow, uCloudLit, uCloudShade, uMoonDir, uMoonCut;
      uniform float uStars, uSkyClouds, uSunGlow;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.24, h));
        col = mix(col, uTop, smoothstep(0.2, 0.85, h));
        col = mix(col, uBelow, smoothstep(0.01, -0.12, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunCol * (pow(s, 600.0) * 0.9 + pow(s, 36.0) * 0.22 + pow(s, 5.0) * 0.12) * uSunGlow;
        // painterly high clouds
        vec2 sp = d.xz / max(h + 0.16, 0.04);
        float c1 = texture2D(uNoise, sp * 0.09 + vec2(uTime * 0.0025, 0.0)).r;
        float c2 = texture2D(uNoise, sp * 0.27 + vec2(uTime * 0.004, 0.31)).g;
        #ifdef LOW_Q
          float c3 = 0.5;
        #else
          float c3 = texture2D(uNoise, vec2(sp.x * 0.05, sp.y * 0.6) + vec2(uTime * 0.002, 0.0)).b;
        #endif
        float cl = smoothstep(0.55, 0.8, c1 * 0.62 + c2 * 0.3 + c3 * 0.2) * smoothstep(0.02, 0.16, h) * uSkyClouds;
        vec3 ccol = mix(uCloudShade, uCloudLit, smoothstep(0.35, 0.85, c2 + (s - 0.5) * 0.3));
        col = mix(col, ccol, cl * 0.8);
        // stars at dusk / night: a field of faint ones, fewer bright ones with a soft glow
        if (uStars > 0.001) {
          float hf = smoothstep(0.02, 0.26, h) * (1.0 - cl);
          float st = 0.0;
          {
            vec3 sd = d * 250.0;
            vec3 cell = floor(sd);
            float hs = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            if (hs > 0.972) {
              vec3 cp = cell + 0.5 + (vec3(fract(hs * 13.1), fract(hs * 71.7), fract(hs * 37.3)) - 0.5) * 0.6;
              float dist = length(sd - cp);
              float tw = 0.55 + 0.45 * sin(uTime * (0.8 + hs * 3.0) + hs * 100.0);
              st += smoothstep(0.34, 0.0, dist) * tw * 0.9;
            }
          }
          {
            vec3 sd = d * 110.0;
            vec3 cell = floor(sd);
            float hs = fract(sin(dot(cell + 17.0, vec3(39.346, 11.135, 83.155))) * 43758.5453);
            if (hs > 0.988) {
              vec3 cp = cell + 0.5 + (vec3(fract(hs * 23.1), fract(hs * 51.7), fract(hs * 7.3)) - 0.5) * 0.5;
              vec3 dv = sd - cp;
              float dist = length(dv);
              float tw = 0.65 + 0.35 * sin(uTime * (0.6 + hs * 2.0) + hs * 70.0);
              // a tiny four-point glint on the brightest
              float glint = (exp(-abs(dv.x) * 22.0) * exp(-abs(dv.y) * 3.0) + exp(-abs(dv.y) * 22.0) * exp(-abs(dv.x) * 3.0)) * 0.35;
              st += (smoothstep(0.22, 0.0, dist) * 2.2 + exp(-dist * 7.0) * 0.5 + glint) * tw;
            }
          }
          // a soft milky band across the sky
          vec3 bandN = normalize(vec3(0.62, 0.42, 0.66));
          float band = exp(-pow(dot(d, bandN) / 0.2, 2.0));
          float bn = texture2D(uNoise, d.xz * 1.3 + d.y * 0.6).r * 0.55 + texture2D(uNoise, vec2(d.x + d.y, d.z) * 3.3 + 0.4).g * 0.45;
          vec3 milky = vec3(0.66, 0.6, 0.92) * band * (0.35 + smoothstep(0.35, 0.85, bn)) * 0.16;
          col += (vec3(1.0, 0.95, 0.88) * st + milky) * uStars * hf;
          // a crescent moon with a soft halo
          float moon = smoothstep(0.45, 0.9, uStars);
          if (moon > 0.0) {
            float md = dot(d, uMoonDir);
            float disc = smoothstep(0.99975, 0.9998, md);
            float cut = smoothstep(0.99975, 0.9998, dot(d, uMoonCut));
            float crescent = clamp(disc - cut, 0.0, 1.0);
            float halo = pow(max(md, 0.0), 6000.0) * 0.35 + pow(max(md, 0.0), 500.0) * 0.1;
            col += (vec3(1.0, 0.95, 0.84) * crescent * 1.5 + vec3(0.8, 0.76, 1.0) * halo) * moon * smoothstep(0.02, 0.2, h);
          }
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Soft toon material for the character, cake and small props
export function toonMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uBase: { value: new THREE.Color(opts.color || '#ffffff') },
    uShade: { value: new THREE.Color(opts.shade || '#b7b4d0') },
    uRimAmt: { value: opts.rim ?? 0.35 },
    uFogScale: { value: opts.fogScale ?? 0.6 },
    uOpacity: { value: opts.opacity ?? 1 },
    uMap: { value: opts.map || null },
    // the face texture covers only the front of the head: (u0, v0, du, dv) in sphere uv
    uFaceRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMap2: { value: opts.map2 || opts.map || null },
    uMapMix: { value: 0 },
    uUseMap: { value: opts.map ? 1 : 0 },
    uEmissive: { value: new THREE.Color(opts.emissive || '#000000') },
    uRimCol: U.uRimCol,
    // dress / hair motion
    uFlow: { value: new THREE.Vector3(0, 0, 0) },
    uFlow2: { value: new THREE.Vector3(0, 0, 0) },
    uFlowAmt: { value: 0 },
    uRuffle: { value: opts.ruffle ?? 0 },
    uTopY: { value: opts.topY ?? 1 },
    uLen: { value: opts.len ?? 1 },
    uKneel: { value: 0 },
    uStride: { value: new THREE.Vector4() },
    // (her cat rubbing against her skirt: contact direction xz (skirt space), press, drag)
    uPush: { value: new THREE.Vector4() },
    uTwist: { value: 0 },
    uSoft: { value: opts.soft ?? 0.5 },
    // surface looks
    uSheen: { value: new THREE.Color(opts.sheen || '#7a5a55') },
    uRing: { value: opts.ring ?? 0 },
    uSpec: { value: opts.spec ?? 0 },
    uTrim: { value: new THREE.Color(opts.trim || '#e9cf9b') },
    uSatin: { value: opts.satin ?? 0 },
    // soft "clay" shading: analytic sphere occluders, skin subsurface
    uOcc: opts.occ || { value: [] },
    uSSS: { value: opts.sss ?? 0 },
    uSSSCol: { value: new THREE.Color(opts.sssCol || '#ff6a4d') },
    uAOK: { value: opts.aoK ?? 1 },
    uStrand: { value: opts.strand ?? 1 },
    // faceted "toy" shading: blend toward the flat face normal
    uFacet: { value: opts.facet ?? 0 },
    uTerm: { value: opts.term ?? 0 },
    // painted-in-shader eyes (her face): centres in face uv, uv per metre, half size,
    // where she looks, blink and happy squint
    uEyeC: { value: new THREE.Vector4(0.45, 0.5, 0.55, 0.5) },
    // her cheeks warming (a blush): centres in face uv, and how much
    uCheekC: { value: new THREE.Vector4(0.45, 0.45, 0.55, 0.45) },
    uBlush: { value: 0 },
    uEyeK: { value: new THREE.Vector2(1, 1) },
    uEyeR: { value: new THREE.Vector2(0.0101, 0.0146) },
    uGaze: { value: new THREE.Vector2(0, 0) },
    uBlink: { value: 0 },
    uHappy: { value: 0 },
    uWink: { value: 0 },
    uStar: { value: 0 },
    uEyeCol: { value: new THREE.Color(opts.eyeCol || '#6b3a24') },
    uSparkle: { value: opts.sparkle ?? 0 },
  };
  const deform = opts.deform || 'none';
  const clay = !!opts.clay;
  const nOcc = clay && opts.occ ? opts.occ.value.length : 0;
  return new THREE.ShaderMaterial({
    uniforms,
    defines: {
      DEFORM_SKIRT: deform === 'skirt' ? 1 : 0,
      DEFORM_HAIR: deform === 'hair' ? 1 : 0,
      HAIR: opts.hair ? 1 : 0,
      SATIN: opts.satin ? 1 : 0,
      NECKLINE: opts.neckline ? 1 : 0,
      PUFF: opts.puff ? 1 : 0,
      CHIFFON: opts.chiffon ? 1 : 0,
      CLAY: clay ? 1 : 0,
      N_OCC: Math.max(nOcc, 1),
      VAO: opts.vao ? 1 : 0,
      TRIM_UV: opts.trimUV ? 1 : 0,
      FACET: opts.facet ? 1 : 0,
      SPHERE_UV: opts.sphereUV ? 1 : 0,
      FACE_EYES: opts.eyes ? 1 : 0,
      EMBROIDER: opts.embroider ? 1 : 0,
      SPARKLE: opts.sparkle ? 1 : 0,
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uFlow; uniform vec3 uFlow2; uniform float uFlowAmt; uniform float uRuffle;
      uniform float uTopY; uniform float uLen; uniform float uKneel; uniform float uWind; uniform float uTwist; uniform vec4 uStride; uniform vec4 uPush;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vF; varying vec3 vLoc;
      #if VAO
        attribute float aAO;
        varying float vAO;
      #endif
      #if HAIR
        attribute vec4 aTan;
        varying vec4 vT;
      #endif
      void main() {
        vec3 p = position;
        vec3 n = normal;
        #if HAIR
          vec3 tg = aTan.xyz;
        #endif
        vF = 0.0;
        #if TRIM_UV
          vF = 0.89 + 0.09 * uv.y;
        #endif
        vLoc = position;
        #if VAO
          vAO = aAO;
        #endif
        #if DEFORM_SKIRT
          float f = clamp((uTopY - p.y) / uLen, 0.0, 1.0);
          vF = f;
          float ang = atan(p.z, p.x);
          // scalloped hem
          p.y += (abs(sin(ang * 8.0)) - 0.6) * 0.016 * smoothstep(0.93, 1.0, f);
          // kneeling: skirt pools outward and flattens
          float spread = 1.0 + uKneel * f * f * 0.42;
          p.xz *= spread;
          p.y = mix(p.y, uTopY - (uTopY - p.y) * 0.47, uKneel * smoothstep(0.0, 0.5, f));
          p.z += uKneel * f * f * 0.12;
          // soft folds, ruffles + flowing hem
          float folds = sin(ang * 11.0) * 0.006 * f;
          p.xz += normalize(p.xz + 1e-4) * folds;
          float wv = sin(ang * 7.0 + uTime * 2.1 + f * 3.0) * 0.6 + sin(ang * 3.0 - uTime * 1.3) * 0.4;
          p.xz += normalize(p.xz + 1e-4) * wv * 0.018 * f * f * (1.0 + uRuffle);
          p.y += sin(ang * 5.0 - uTime * 2.4) * 0.012 * f * f * (1.0 + uRuffle);
          p += uFlow * uFlowAmt * f * f * (0.85 + 0.15 * sin(uTime * 3.0 + ang * 2.0));
          // walking: each leg carries its side of the skirt along with its step (the hem
          // swishes), and the hem swings out against the sway of her hips
          float sideL = smoothstep(-0.07, 0.07, p.x);
          float stp = mix(uStride.y, uStride.x, sideL);
          float leg = 1.0 - 0.45 * smoothstep(0.02, 0.16, abs(abs(p.x) - 0.06));
          p.z += stp * f * f * leg;
          p.y += abs(stp) * 0.18 * f * f * smoothstep(0.0, 0.1, p.z) * leg;
          p.x += uStride.z * f * f;
          // twirling: the skirt flares out and up, the hem trailing the turn
          float fl = abs(uStride.w);
          if (fl > 0.001) {
            float tw = -sign(uStride.w) * fl * f * f * 0.5;
            float ct = cos(tw), stw = sin(tw);
            p.xz = vec2(ct * p.x - stw * p.z, stw * p.x + ct * p.z);
            p.xz *= 1.0 + fl * f * f * 0.5;
            p.y += fl * f * f * (0.1 + 0.015 * sin(ang * 6.0 + uTime * 9.0));
          }
          // her cat rubbing along her: the skirt pressed in where it leans, dragged a little
          // along with it
          if (uPush.z > 0.0005) {
            vec2 dr = normalize(p.xz + 1e-4);
            float g = smoothstep(0.62, 1.0, dot(dr, uPush.xy));
            float h = smoothstep(0.5, 0.8, f);
            p.xz -= dr * uPush.z * g * g * h;
            p.xz += vec2(-dr.y, dr.x) * uPush.w * g * h;
            p.y += uPush.z * 0.25 * g * h * smoothstep(0.85, 1.0, f);
          }
        #endif
        #if DEFORM_HAIR
          float f = clamp((uTopY - p.y) / uLen, 0.0, 1.0);
          vF = f;
          float sway = sin(uTime * 1.7 + p.x * 9.0 + f * 3.5) * 0.5 + sin(uTime * 2.9 + p.x * 5.0) * 0.3;
          p.x += sway * 0.022 * f * f * (0.6 + uWind);
          p.z += (sin(uTime * 1.3 + f * 2.0) * 0.012 - 0.01) * f * f * (0.6 + uWind);
          // (each side can swing on its own: uFlow2 for her left, x > 0)
          p += mix(uFlow, uFlow2, smoothstep(-0.02, 0.02, p.x)) * uFlowAmt * f * f;
          // counter-rotate the lower lengths so they rest on the shoulders when the head turns
          float tw = uTwist * smoothstep(0.04, 0.42, f);
          float tc = cos(tw), ts = sin(tw);
          p.xz = vec2(tc * p.x + ts * p.z, -ts * p.x + tc * p.z);
          n.xz = vec2(tc * n.x + ts * n.z, -ts * n.x + tc * n.z);
          #if HAIR
            tg.xz = vec2(tc * tg.x + ts * tg.z, -ts * tg.x + tc * tg.z);
          #endif
        #endif
        #ifdef USE_INSTANCING
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
        #else
          vec4 w = modelMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * n);
        #endif
        vW = w.xyz;
        vUv = uv;
        #if HAIR
          vT = vec4(mat3(modelMatrix) * tg, aTan.w);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      #if HAIR
        varying vec4 vT;
      #endif
      uniform vec3 uBase, uShade, uEmissive, uRimCol, uSheen, uTrim;
      uniform float uRimAmt, uFogScale, uOpacity, uUseMap, uMapMix, uSoft, uRing, uSpec, uSatin;
      uniform sampler2D uMap; uniform sampler2D uMap2; uniform vec4 uFaceRect;
      uniform float uSSS, uAOK, uStrand, uFacet, uTerm; uniform vec3 uSSSCol; uniform float uSparkle;
      #if FACE_EYES
        uniform vec4 uEyeC; uniform vec2 uEyeK; uniform vec2 uEyeR; uniform vec2 uGaze;
        uniform vec4 uCheekC; uniform float uBlush;
        uniform float uBlink, uHappy, uWink, uStar; uniform vec3 uEyeCol;
        float cover(float d, float pw) { return clamp(0.5 - d / pw, 0.0, 1.0); }
        // one eye, in its own frame (1 = its half size; x > 0 toward her temple).
        // Glossy bead eye with a warm iris glow and two catchlights, a lash line with a
        // little flick, her smiling lower lid, a smooth blink and happy squint arcs.
        void eye(inout vec3 col, vec2 e, float side, float pw, float lit, float hap, float bl) {
          vec2 g = uGaze * vec2(0.26 * side, 0.15);
          vec2 q = e - g;
          // the lid edge: an arch when open, a soft curve down when the eye closes
          float lidY = mix(1.0, -0.38, bl);
          float lidC = mix(0.15, -0.27, bl);
          float yLid = lidY + lidC * (1.0 - min(e.x * e.x, 1.0));
          // the bead
          float aDot = cover(length(q) - 1.0, pw);
          // cheeks lift a soft lower lid into it (more when she smiles)
          vec2 cc = (e - vec2(0.0, mix(-1.32, -0.55, smoothstep(0.0, 0.55, hap)))) / vec2(1.75, 0.68);
          float dCut = (length(cc) - 1.0) * 0.68;
          aDot *= 1.0 - cover(dCut, pw);
          aDot *= cover(e.y - yLid, pw);
          aDot *= 1.0 - smoothstep(0.42, 0.56, hap);
          if (aDot > 0.0) {
            vec3 ec = mix(vec3(0.06, 0.035, 0.03), uEyeCol, smoothstep(-0.2, -1.0, q.y) * 0.85);
            float rr = length(q);
            // pupil, and the iris glowing warm along its lower rim
            ec = mix(ec, vec3(0.025, 0.015, 0.014), cover(length(q - vec2(0.0, 0.08)) - 0.4, pw) * 0.75);
            ec = mix(ec, uEyeCol * 1.7 + vec3(0.06, 0.03, 0.02), smoothstep(0.5, 0.95, rr) * smoothstep(-0.05, -0.75, q.y) * 0.6);
            // fine radial fibres in the iris, and a darker ring round its edge
            float fib = sin(atan(q.y, q.x) * 23.0) * 0.5 + 0.5;
            ec *= 1.0 + (fib - 0.5) * 0.22 * smoothstep(0.42, 0.62, rr) * (1.0 - smoothstep(0.86, 0.96, rr));
            ec = mix(ec, ec * 0.5, smoothstep(0.84, 0.98, rr) * 0.7);
            col = mix(col, ec * lit, aDot);
            // catchlights: a big soft one up toward the light, a small one below
            float h1 = (length((q - vec2(-0.3 * side, 0.37)) / vec2(0.29, 0.34)) - 1.0) * 0.3;
            float h2 = length(q - vec2(0.31 * side, -0.33)) - 0.13;
            float aH = max(cover(h1, pw), cover(h2, pw) * 0.85) * aDot;
            col = mix(col, vec3(1.0, 0.99, 0.97) * mix(0.95, 1.08, lit), aH);
            // at magic moments a little four-pointed star twinkles in her eyes
            if (uStar > 0.0) {
              vec2 sq = q - vec2(-0.3 * side, 0.37);
              float rs = 0.5 + 0.12 * sin(uTime * 5.0 + side);
              float cs = cos(uTime * 0.8), sn = sin(uTime * 0.8);
              sq = mat2(cs, -sn, sn, cs) * sq / rs;
              float star = max(exp(-abs(sq.x) * 9.0 - abs(sq.y) * 1.6), exp(-abs(sq.y) * 9.0 - abs(sq.x) * 1.6)) * smoothstep(1.0, 0.2, length(sq));
              col += vec3(1.0, 0.97, 0.9) * star * uStar * aDot * 0.9;
            }
          }
          // a soft rosy "smile bag" under the eye (aegyo-sal)
          float bag = smoothstep(0.0, 0.05, dCut) * (1.0 - smoothstep(0.05, 0.2, dCut)) * smoothstep(1.25, 0.5, abs(e.x)) * step(e.y, -0.2);
          col = mix(col, col * vec3(1.05, 0.97, 0.97) + vec3(0.04, 0.012, 0.016), bag * (0.45 + 0.4 * hap) * (1.0 - bl));
          // lash line along the lid edge, thinning toward the inner corner, with a flick
          vec3 lash = vec3(0.085, 0.052, 0.05) * mix(0.9, 1.05, lit);
          float th = mix(0.085, 0.14, bl) * smoothstep(-1.1, -0.45, e.x);
          float dL = max(abs(e.y - yLid - mix(0.06, 0.0, bl)) - th, abs(e.x) - 1.0);
          vec2 f0 = vec2(0.93, lidY + 0.05), f1 = vec2(1.26, lidY + mix(0.27, -0.08, bl));
          vec2 fp = e - f0, fd = f1 - f0;
          float ft = clamp(dot(fp, fd) / dot(fd, fd), 0.0, 1.0);
          float dF = length(fp - fd * ft) - mix(0.08, 0.02, ft);
          float aLash = max(cover(dL, pw), cover(dF, pw)) * (1.0 - smoothstep(0.42, 0.56, hap));
          col = mix(col, lash, aLash);
          // a soft crease above the lid (stronger toward the outer corner), and a hint of
          // lower lashes at the outer corner - only while the eye is open
          float open1 = (1.0 - bl) * (1.0 - smoothstep(0.3, 0.5, hap));
          float yCr = yLid + 0.27 + 0.07 * (1.0 - min(e.x * e.x, 1.0));
          float dCr = max(abs(e.y - yCr) - 0.022, max(-0.5 - e.x, e.x - 1.0));
          col = mix(col, col * vec3(0.74, 0.6, 0.58), cover(dCr, pw) * smoothstep(-0.5, 0.45, e.x) * 0.42 * open1);
          float dLo = max(abs(length(e) - 1.1) - 0.028, -e.y - 0.0);
          float aLo = cover(abs(length(e) - 1.1) - 0.028, pw) * smoothstep(-0.25, -0.55, e.y) * smoothstep(0.25, 0.62, e.x) * (1.0 - smoothstep(0.9, 1.05, e.x));
          col = mix(col, lash, aLo * 0.5 * open1);
          // happy closed eyes: soft arches, two little lashes flicking out from the outer end
          vec2 hc = (e - vec2(0.0, -0.5)) / vec2(1.12, 0.82);
          float dA = max(abs(length(hc) - 1.0) * 0.82 - 0.15, -(e.y + 0.12));
          {
            vec2 g0 = e - vec2(0.95, -0.06), gd = vec2(0.34, 0.1);
            float gt = clamp(dot(g0, gd) / dot(gd, gd), 0.0, 1.0);
            dA = min(dA, length(g0 - gd * gt) - mix(0.075, 0.016, gt));
            vec2 h0 = e - vec2(0.97, -0.14), hd = vec2(0.27, -0.2);
            float ht = clamp(dot(h0, hd) / dot(hd, hd), 0.0, 1.0);
            dA = min(dA, length(h0 - hd * ht) - mix(0.065, 0.014, ht));
          }
          col = mix(col, lash, cover(dA, pw) * smoothstep(0.46, 0.6, hap));
        }
      #endif
      #if CLAY
        uniform vec4 uOcc[N_OCC];
        // soft contact shadow from the body's main volumes (analytic sphere occlusion)
        float occlusion(vec3 P, vec3 N) {
          float occ = 0.0;
          for (int i = 0; i < N_OCC; i++) {
            vec4 s = uOcc[i];
            if (s.w <= 0.0) continue;
            vec3 d = s.xyz - P;
            float l = length(d);
            float nl = dot(N, d / l);
            float k = s.w / l;
            occ += clamp(nl, 0.0, 1.0) * k * k * smoothstep(s.w * 0.98, s.w * 1.3, l);
          }
          return clamp(1.0 - occ * 0.85, 0.3, 1.0);
        }
      #endif
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vF; varying vec3 vLoc;
      #if VAO
        varying float vAO;
      #endif
      float neckY(vec3 p) {
        float ax = abs(p.x);
        float yf = 0.306 + 0.078 * smoothstep(0.0, 0.088, ax) - 0.004 * exp(-ax * ax / 0.0002);
        float yb = 0.345 + 0.04 * smoothstep(0.0, 0.08, ax);
        return mix(yb, yf, smoothstep(-0.03, 0.03, p.z));
      }
      void main() {
        #if NECKLINE
          float ny = neckY(vLoc);
          if (vLoc.y > ny) discard;
        #endif
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        #if FACET
          vec3 Nf = normalize(cross(dFdx(vW), dFdy(vW)));
          if (dot(Nf, N) < 0.0) Nf = -Nf;
          N = normalize(mix(N, Nf, uFacet));
        #endif
        vec3 V = normalize(cameraPosition - vW);
        vec3 Ld = uSunDir;
        #if CLAY
          // a portrait key: the sun's direction pulled toward the camera's upper left,
          // so her face and body always show their form
          vec3 cR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 cU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 cB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          Ld = normalize(mix(uSunDir, normalize(-cR * 0.62 + cU * 0.55 + cB * 0.56), 0.62));
        #endif
        vec3 H = normalize(V + Ld);
        float ndl = dot(N, Ld);
        float l = smoothstep(-0.25, 0.25 + uSoft * 0.2, ndl);
        vec3 base = uBase;
        if (uUseMap > 0.5) {
          #if SPHERE_UV
            // exact equirect lookup around the mesh origin (the seam sits at the back)
            vec3 q = normalize(vLoc);
            vec2 suv = vec2(atan(q.x, q.z) / 6.2831853 + 0.5, 1.0 - acos(clamp(q.y, -1.0, 1.0)) / 3.14159265);
            suv = (suv - uFaceRect.xy) / uFaceRect.zw;
            vec4 m = mix(texture2D(uMap, suv), texture2D(uMap2, suv), uMapMix);
          #else
            vec4 m = mix(texture2D(uMap, vUv), texture2D(uMap2, vUv), uMapMix);
          #endif
          base = m.rgb;
        }
        #if EMBROIDER
        {
          // the skirt blushes to a pale lilac-pink toward the hem
          base = mix(base, base * vec3(0.97, 0.9, 1.0), smoothstep(0.35, 1.0, vUv.y) * 0.32);
          // fine gathers falling from the waistband, softening into the folds (faded out
          // where they would shimmer)
          {
            float ga = vUv.x * 6.2831853;
            float p1 = ga * 46.0 + 0.7 * sin(ga * 5.0) + vUv.y * 2.5, p2 = ga * 97.0 + 1.6 * sin(ga * 7.0);
            float gk = (1.0 - smoothstep(0.02, 0.45, vUv.y));
            float a1 = 1.0 - smoothstep(0.7, 1.6, fwidth(p1)), a2 = 1.0 - smoothstep(0.7, 1.6, fwidth(p2));
            base *= 1.0 - (0.07 * (0.5 + 0.5 * sin(p1)) * a1 + 0.03 * (0.5 + 0.5 * sin(p2)) * a2) * gk;
          }
          // a band of tiny embroidered flowers on a winding vine above the hem
          float NC = 30.0;
          float uc = vUv.x * NC;
          float kc = floor(uc);
          vec2 p = vec2((fract(uc) - 0.5) * 0.057, (vUv.y - (0.838 + 0.024 * sin(kc * 2.39))) * 0.75);
          // pixel size from the continuous coordinates (the cells jump at their borders)
          float pw = max(length(vec2(fwidth(uc) * 0.057, fwidth(vUv.y) * 0.75)), 1e-5);
          float vy = (vUv.y - (0.858 + 0.016 * sin(vUv.x * NC * 3.14159265))) * 0.75;
          float vine = clamp(0.5 - (abs(vy) - 0.0012) / pw, 0.0, 1.0);
          // a leaf either side of each flower
          vec2 lp = vec2(abs(p.x) - 0.017, p.y - 0.0028 * sign(p.x));
          lp = mat2(0.8, -0.6, 0.6, 0.8) * lp;
          float leaf = clamp(0.5 - (length(lp / vec2(0.007, 0.003)) - 1.0) * 0.003 / pw, 0.0, 1.0);
          float pr = length(p);
          float petal = 0.0105 * (0.7 + 0.3 * cos(5.0 * atan(p.y, p.x) + kc * 1.7));
          float fl = clamp(0.5 - (pr - petal) / pw, 0.0, 1.0);
          float ce = clamp(0.5 - (pr - 0.003) / pw, 0.0, 1.0);
          float m3 = mod(kc, 3.0);
          vec3 fcol = m3 < 1.0 ? vec3(0.96, 0.74, 0.82) : (m3 < 2.0 ? vec3(0.8, 0.74, 0.96) : vec3(0.97, 0.88, 0.62));
          // the stitching fades away where the eye could not resolve it
          float vis = 1.0 - smoothstep(0.0016, 0.005, pw);
          base = mix(base, vec3(0.7, 0.82, 0.66), max(vine, leaf) * (1.0 - fl) * 0.85 * vis);
          base = mix(base, fcol, fl * vis);
          base = mix(base, vec3(0.99, 0.84, 0.46), ce * vis);
          base = mix(base, base * vec3(0.99, 0.97, 1.0), (1.0 - vis) * smoothstep(0.81, 0.83, vUv.y) * (1.0 - smoothstep(0.875, 0.895, vUv.y)));
        }
        #endif
        #if PUFF
        {
          // a puff sleeve gathered at the crown and into its band: soft creases fanning out
          // from both ends, fading where it billows
          float a = atan(vLoc.z, vLoc.x);
          float f = clamp((0.034 - vLoc.y) / 0.118, 0.0, 1.0);
          float bul = sin(min(1.0, f * 1.12) * 3.14159265);
          float gk = pow(1.0 - bul, 1.5);
          float pl = sin(a * 15.0 + 0.7 * sin(a * 4.0 + 1.0) + f * 1.6);
          float pl2 = sin(a * 31.0 + 1.3 * sin(a * 5.0));
          base *= 1.0 - (0.075 * (0.5 + 0.5 * pl) + 0.03 * (0.5 + 0.5 * pl2)) * (0.25 + 0.75 * gk);
        }
        #endif
        #if NECKLINE
        {
          // a vine of tiny embroidered flowers following her neckline down each side of the
          // V (the same flowers as on her hem), clear of the pendant in the middle
          float ax = abs(vLoc.x);
          float frontK = smoothstep(0.004, 0.03, vLoc.z);
          vec2 pp = vec2(ax, vLoc.y);
          float pw = max(length(fwidth(pp)), 1e-5);
          float vis = (1.0 - smoothstep(0.0008, 0.0024, pw)) * frontK;
          // (only in the band where it runs)
          if (vis > 0.001 && ax < 0.096 && abs(vLoc.y - neckY(vec3(ax, 0.0, 1.0)) + 0.026) < 0.0085) {
            float wob = 0.0018 * sin(ax * 260.0);
            float yv = neckY(vec3(ax, 0.0, 1.0)) - 0.026 + wob;
            float span = smoothstep(0.008, 0.016, ax) * (1.0 - smoothstep(0.078, 0.086, ax));
            float vine = clamp(0.5 - (abs(vLoc.y - yv) - 0.0007) / pw, 0.0, 1.0) * span;
            float cell = 0.0185;
            float kx = clamp(floor((ax - 0.02) / cell + 0.5), 0.0, 3.0);
            float fx = 0.02 + kx * cell;
            vec2 fc = vec2(fx, neckY(vec3(fx, 0.0, 1.0)) - 0.026 + 0.0018 * sin(fx * 260.0));
            vec2 d = pp - fc;
            float r = length(d);
            float petal = 0.0047 * (0.66 + 0.34 * cos(5.0 * atan(d.y, d.x) + kx * 1.3));
            float fl = clamp(0.5 - (r - petal) / pw, 0.0, 1.0);
            float ce = clamp(0.5 - (r - 0.0014) / pw, 0.0, 1.0);
            // a leaf either side of each flower, along the vine
            vec2 ld = vec2(abs(d.x) - 0.0078, d.y - 0.0016 * sign(d.x));
            ld = mat2(0.85, -0.53, 0.53, 0.85) * ld;
            float leaf = clamp(0.5 - (length(ld / vec2(0.0034, 0.0015)) - 1.0) * 0.0015 / pw, 0.0, 1.0);
            float m3 = mod(kx, 3.0);
            vec3 fcol = m3 < 1.0 ? vec3(0.95, 0.6, 0.72) : (m3 < 2.0 ? vec3(0.74, 0.64, 0.95) : vec3(0.97, 0.83, 0.48));
            base = mix(base, vec3(0.56, 0.75, 0.55), max(vine * 0.75, leaf) * (1.0 - fl) * vis);
            base = mix(base, fcol, fl * vis);
            base = mix(base, vec3(0.99, 0.84, 0.46), ce * vis);
          }
        }
        #endif
        #if HAIR
          // combed strands, fine and coarse
          float sn = texture2D(uNoise, vec2(vUv.x * 3.0, vUv.y * 0.25)).g;
          float strand = (sin(vUv.x * 140.0 + sn * 9.0) * 0.6 + sin(vUv.x * 330.0 + sn * 21.0) * 0.4) * 0.5 + 0.5;
          base *= 1.0 + (0.2 * strand - 0.14) * uStrand;
          // the ends of the long locks break into finer strands of different lengths
          if (vT.w > 0.5) {
            // (two sizes of lock, each tapering to a point, ending at different lengths -
            // the longest toward the middle of a lock)
            float sx = vUv.x * 44.0;
            float sid = floor(sx), sf = fract(sx) - 0.5;
            float hl = fract(sin(sid * 91.7 + 7.3) * 43758.5453);
            float sx2 = vUv.x * 120.0;
            float sid2 = floor(sx2), sf2 = fract(sx2) - 0.5;
            float hl2 = fract(sin(sid2 * 57.3 + 1.9) * 43758.5453);
            float tip = 0.84 + 0.15 * hl - 0.075 * abs(sf) * 2.0;
            float tip2 = 0.9 + 0.1 * hl2 - 0.05 * abs(sf2) * 2.0;
            if (vUv.y > max(tip, tip2 * step(0.55, hl2))) discard;
          }
        #endif
        vec3 shade = uShade * uShadowTint;
        #if CLAY
          // wide, soft terminator; occlusion from the body's volumes and baked crevices
          float ao = occlusion(vW, N);
          #if VAO
            ao *= mix(1.0, vAO, uAOK);
          #endif
          l = smoothstep(-0.55 + 0.3 * uTerm, 0.8 - 0.12 * uTerm, ndl);
          vec3 col = base * mix(shade, uLightTint * 1.05, l * mix(0.55, 1.0, ao));
          col *= mix(0.58, 1.0, ao);
          // sky fill from above, warm bounce from below
          col += base * mix(vec3(0.05, 0.045, 0.04), uAmb * 0.12, N.y * 0.5 + 0.5) * ao;
          // light scattering under the skin near the shadow edge
          float sss = smoothstep(-0.45, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.55, ndl));
          col += base * uSSSCol * sss * uSSS * (0.4 + 0.6 * ao);
          float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
          col += uRimCol * rim * uRimAmt * (0.45 + 0.55 * l) * ao;
        #else
          vec3 col = base * mix(shade, uLightTint * 1.03, l);
          col += base * uAmb * 0.06;
          float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
          col += uRimCol * rim * uRimAmt * (0.6 + 0.4 * l);
        #endif
        #if FACE_EYES
        {
          vec3 qe = normalize(vLoc);
          vec2 fuv = vec2(atan(qe.x, qe.z) / 6.2831853 + 0.5, 1.0 - acos(clamp(qe.y, -1.0, 1.0)) / 3.14159265);
          vec2 sc = uEyeK * uEyeR;
          vec2 fw = fwidth(fuv) / sc;
          float pw = max(max(fw.x, fw.y), 1e-4) * 1.2;
          float lit = mix(0.8, 1.04, l);
          vec2 eR = (fuv - uEyeC.zw) / sc;
          vec2 eL = (fuv - uEyeC.xy) / sc;
          // a wink: one eye squeezes into a happy arc, the other stays open
          float hapR = mix(uHappy, 1.0, uWink), hapL = mix(uHappy, 0.0, uWink);
          float blW = uBlink * (1.0 - uWink);
          if (dot(eR, eR) < 9.0) eye(col, eR, 1.0, pw, lit, hapR, blW);
          if (dot(eL, eL) < 9.0) eye(col, vec2(-eL.x, eL.y), -1.0, pw, lit, hapL, blW);
          // a blush rising in her cheeks
          if (uBlush > 0.003) {
            vec2 bs = uEyeK * vec2(0.03, 0.019);
            vec2 bR = (fuv - uCheekC.zw) / bs, bL = (fuv - uCheekC.xy) / bs;
            float bl = exp(-dot(bR, bR)) + exp(-dot(bL, bL));
            col = mix(col, col * vec3(1.03, 0.68, 0.7), clamp(bl, 0.0, 1.0) * uBlush * 0.68);
          }
        }
        #endif
        #if HAIR
          // soft sheen + a glossy "angel ring": a crisp band with little notches, taken
          // from the smooth normal so it runs clean across the facets
          vec3 Ns = normalize(vN);
          if (!gl_FrontFacing) Ns = -Ns;
          float ringC = 0.52 + 0.035 * sin(atan(Ns.x, Ns.z) * 18.0) + (strand - 0.5) * 0.03;
          float ring = smoothstep(0.075, 0.035, abs(Ns.y - ringC)) * smoothstep(0.1, 0.45, dot(Ns, V)) * uRing;
          // light running along the strands (Kajiya-Kay): a tight bright band and a softer
          // warm one, each wavering with the strands
          vec3 Th = normalize(vT.xyz + 1e-4);
          float shf = (strand - 0.5) * 0.35 + (sn - 0.5) * 0.3;
          vec3 T1 = normalize(Th + Ns * (0.1 + shf)), T2 = normalize(Th + Ns * (-0.14 + shf));
          float d1 = dot(T1, H), d2 = dot(T2, H);
          float k1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 110.0), k2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 24.0);
          float vis = smoothstep(-0.25, 0.3, ndl);
          // (the thin see-through wisps over her forehead shine less: dark strands, not silver)
          float thinK = vT.w > 0.1 && vT.w < 0.5 ? 0.4 : 1.0;
          col += uLightTint * (vec3(1.0, 0.97, 0.98) * k1 * 0.5 + uSheen * k2 * 0.38) * vis * (0.55 + 0.45 * strand) * thinK;
          col += mix(uSheen, vec3(1.0, 0.94, 0.95), 0.25) * ring * 0.45 * (0.45 + 0.55 * l) * uLightTint * thinK;
        #endif
        #if SATIN
          float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 1.6);
          float satin = pow(max(dot(N, H), 0.0), 10.0);
          col += uLightTint * (fres * 0.08 + satin * 0.14) * uSatin;
          // light glowing through the fabric when she is backlit
          float back = pow(max(dot(-V, uSunDir), 0.0), 3.0) * (0.25 + 0.75 * vF);
          col += uSunCol * back * 0.28 * uSatin;
          // delicate hem trim
          col = mix(col, uTrim * mix(shade, uLightTint * 1.05, l), smoothstep(0.962, 0.975, vF) * 0.5);
        #endif
        col += uLightTint * pow(max(dot(N, H), 0.0), 60.0) * uSpec;
        #if SPARKLE
        {
          // glitter woven into the fabric: tiny points that twinkle as she moves
          vec3 sp = vLoc * 70.0;
          vec3 cid = floor(sp);
          vec3 hh = fract(sin(vec3(dot(cid, vec3(127.1, 311.7, 74.7)), dot(cid, vec3(269.5, 183.3, 246.1)), dot(cid, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          float sd = length(fract(sp) - 0.5 - (hh - 0.5) * 0.5);
          float spx = length(fwidth(sp));
          float tw = pow(max(sin(uTime * (1.3 + hh.x * 2.5) + hh.y * 40.0 + dot(V, vec3(7.0, 5.0, 3.0))), 0.0), 10.0);
          float dens = 0.8;
          #if EMBROIDER
            dens = mix(0.86, 0.62, smoothstep(0.45, 0.95, vUv.y));
          #endif
          float spk = step(dens, hh.z) * (1.0 - smoothstep(0.035, 0.035 + spx * 0.75, sd)) * tw * (1.0 - smoothstep(0.3, 0.75, spx));
          col += mix(uLightTint, vec3(1.0, 0.92, 0.75), hh.x) * spk * 1.7 * uSparkle;
        }
        #endif
        col += base * pointLight(vW, N) * 1.4;
        col += uEmissive;
        #if NECKLINE
          // delicate piping along the neckline
          col = mix(col, uTrim * mix(shade, uLightTint, l) * 1.05, smoothstep(ny - 0.0055, ny - 0.002, vLoc.y) * 0.85);
        #endif
        float alpha = uOpacity;
        #if CHIFFON
          float fr = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 1.4);
          alpha = uOpacity * (0.38 + 0.62 * fr);
          col = mix(col, uLightTint * 1.08, fr * 0.22);
        #endif
        col = applyFogK(col, vW, uFogScale);
        gl_FragColor = vec4(col, alpha);
      }`,
    side: opts.side ?? THREE.FrontSide,
    transparent: (opts.opacity ?? 1) < 1 || !!opts.transparent,
  });
}

// ---------------------------------------------------------------------------
// Instanced foliage (flowers, grass, shrubs, trees) with wind + ripple glow
export function foliageMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uBase: { value: new THREE.Color(opts.color || '#ffffff') },
    uShade: { value: new THREE.Color(opts.shade || '#7f8fa8') },
    uSway: { value: opts.sway ?? 1 },
    uGlowAmt: { value: opts.glow ?? 1 },
    uPaint: { value: opts.paint ?? 0 },
    uEmit: { value: opts.emit ?? 0 },
    uFogScale: { value: opts.fogScale ?? 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWind; uniform float uSway;
      uniform vec4 uRipple; uniform float uRippleAmt; uniform sampler2D uNoise;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vGlow; varying float vH;
      void main() {
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
        float sw = sin(uTime * 1.5 + ph) * 0.6 + sin(uTime * 2.6 + ph * 1.7) * 0.3;
        float rd = length(ipos.xz - uRipple.xz);
        float ring = exp(-pow((rd - uRipple.w) / (0.9 + uRipple.w * 0.04), 2.0)) * uRippleAmt;
        float pop = 1.0 + ring * 0.24;
        p *= pop;
        vec4 w = modelMatrix * im * vec4(p, 1.0);
        float bendAmt = uWind * uSway * h * h * scaleY * scaleY;
        // the same gusts as in the meadow, rolling downwind: everything leans and shivers in them
        vec2 wd = vec2(0.943, 0.333);
        vec2 gq = ipos.xz * 0.019 - wd * uTime * 0.15;
        float gust = smoothstep(0.4, 0.85, texture2D(uNoise, gq).r) * clamp(uWind * 1.6, 0.0, 1.0);
        float fl = sin(uTime * 6.1 + ph * 2.9) * 0.6 + sin(uTime * 9.7 + ph * 4.1) * 0.4;
        w.xz += wd * (0.25 + gust * 1.1 + fl * gust * 0.2) * bendAmt * 0.16;
        w.x += sw * bendAmt * 0.16 * (1.0 + gust * 0.5);
        w.z += cos(uTime * 1.2 + ph) * bendAmt * 0.09;
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vGlow = ring * 0.55 + smoothstep(uRipple.w + 1.0, uRipple.w - 3.0, rd) * 0.07 * uRippleAmt;
        vH = h;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uBase, uShade; uniform float uGlowAmt, uPaint, uEmit, uFogScale;
      varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vGlow; varying float vH;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float ndl = dot(N, uSunDir);
        float n = texture2D(uNoise, vW.xz * 0.05 + vW.y * 0.03).g;
        float l = smoothstep(-0.2 + (n - 0.5) * uPaint, 0.3 + (n - 0.5) * uPaint, ndl);
        vec3 base = uBase * vCol;
        vec3 col = base * mix(uShade * uShadowTint, uLightTint * 1.04, l);
        col *= 0.92 + n * 0.16 * uPaint;
        col += uGold * vGlow * 0.9 * uGlowAmt;
        col += base * uEmit * (0.35 + 0.65 * uNight);
        col += base * pointLight(vW, N) * 1.4;
        col = applyFogK(col, vW, uFogScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: opts.side ?? THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
export function waterMaterial(U) {
  const uniforms = {
    ...U,
    uWaterD: { value: new THREE.Color('#2c6872') },
    uWaterL: { value: new THREE.Color('#5aa0a6') },
    uWaterHi: { value: new THREE.Color('#d2ece6') },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uWaterD, uWaterL, uWaterHi;
      varying vec3 vW;
      void main() {
        vec2 q = vW.xz;
        // the valley river runs along z, the canyon river along x: currents stream downstream
        vec2 fq = vW.y < -40.0 ? vec2(q.y, q.x) : q;
        float n1 = texture2D(uNoise, q * 0.012 + vec2(uTime * 0.006, uTime * 0.002)).g;
        float n2 = texture2D(uNoise, vec2(fq.x * 0.09, fq.y * 0.022 - uTime * 0.05)).b;
        float n3 = texture2D(uNoise, vec2(fq.x * 0.16 + 0.3, fq.y * 0.05 - uTime * 0.09)).r;
        vec3 col = mix(uWaterD, uWaterL, smoothstep(0.3, 0.75, n1));
        // long soft current lines, and small bright glints riding them
        col = mix(col, mix(uWaterL, uWaterHi, 0.35), smoothstep(0.5, 0.72, n2) * 0.35);
        col = mix(col, uWaterHi, smoothstep(0.7, 0.78, n2 * 0.6 + n3 * 0.4) * 0.6);
        vec3 V = normalize(cameraPosition - vW);
        float fr = pow(1.0 - max(V.y, 0.0), 4.0);
        col = mix(col, uFogSunCol, fr * 0.35);
        col *= mix(uShadowTint, uLightTint, 0.7);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Where the sea of clouds thins out over the head of the valley: 1 over the open sea, 0 over
// the open valley. A broad, soft fade (no holes punched through it) whose edge wanders in
// long fingers of mist reaching down the valley. (needs uNoise, uTime and uZCut declared)
const SEA_FADE = /* glsl */ `
  float seaFade(vec2 q, float reach) {
    float big = texture2D(uNoise, q * 0.0011 + vec2(0.37, 0.11)).r;
    float fing = texture2D(uNoise, vec2(q.x * 0.0046, q.y * 0.0015) + vec2(0.13 + uTime * 0.0003, 0.61)).r;
    float zc = q.y + (big - 0.5) * 130.0 + (fing - 0.5) * 120.0 + reach;
    float corridor = smoothstep(uZCut.y, uZCut.x, zc) * (1.0 - smoothstep(260.0, 520.0, abs(q.x + (big - 0.5) * 160.0)));
    // the clouds parting over the valley once she has landed: a ragged opening round uHole.xy
    // (radius uHole.z, soft edge uHole.w) that widens until the sky over the valley is clear
    float fr = texture2D(uNoise, q * 0.0062 + vec2(0.71, 0.29 + uTime * 0.0004)).g;
    float hd = length(q - uHole.xy) + (big - 0.5) * 170.0 + (fr - 0.5) * 120.0 - reach;
    float hole = 1.0 - smoothstep(uHole.z - uHole.w, uHole.z, hd);
    return 1.0 - max(corridor, hole);
  }`;

// The sea of clouds' surface, shared by the sea itself and the peaks that rise out of it
// (so they melt into the cloud exactly where it laps against them). Needs uNoise, uTime,
// uZCut, uCeil, uCeilRect declared.
export const SEA_SURFACE_GLSL = /* glsl */ `
  ${SEA_FADE}
  float cloudH(vec2 q) {
    vec2 d = vec2(uTime * 0.7, uTime * 0.25);
    // rounded cumulus domes, big and small (the peaks of smooth noise, the gaps between them
    // flattened), over great slow swells: a deep, thick, soft sea
    float a = texture2D(uNoise, (q + d) * 0.003).r;
    float b = texture2D(uNoise, (q + d) * 0.0088 + 0.31).g;
    float c = texture2D(uNoise, (q + d * 0.6) * 0.0009 + 0.57).r;
    // (and deepest out in front of the opening view: the peaks rise out of thick banks of it)
    float open = smoothstep(200.0, 430.0, q.y) * (1.0 - smoothstep(380.0, 720.0, abs(q.x)));
    return pow(smoothstep(0.12, 0.95, a), 1.3) * 26.0 + pow(b, 1.5) * 8.0 + smoothstep(0.22, 0.85, c) * 9.0 + open * 18.0;
  }
  // (a soft ceiling: the heaps round off under it rather than being cut flat)
  float ceilAt(vec2 q, float base) {
    if (uCeilRect.z <= 0.0) return 1e4;
    return texture2D(uCeil, (q - uCeilRect.xy) * uCeilRect.zw).r * 255.0 + 120.0 - base;
  }
  float softCeil(float h, float c) {
    float k = 9.0;
    float m = max(k - abs(h - c), 0.0) / k;
    return min(h, c) - m * m * k * 0.25;
  }
  float ceilH(vec2 q, float h, float base) { return softCeil(h, ceilAt(q, base)); }
  // the height of the sea's surface above its base at q
  float seaH(vec2 q, float base) {
    float k = mix(0.3, 1.0, seaFade(q, 0.0));
    return ceilH(q, cloudH(q) * k, base);
  }`;

// Veils of mist drifting low over the sea of clouds: big, soft, slowly drifting banks, so
// the sea reads as a deep, hazy, dreamy layer rather than one surface, and the peaks melt
// into it. Drawn only in the distant layer: it is gone within fifty metres of the camera
// (no edge where the camera passes through it).
export function mistVeilMaterial(U, { seed = 0, amount = 0.5 } = {}) {
  const uniforms = {
    ...U,
    uLit: { value: new THREE.Color('#fdfaf3') },
    uShadeC: { value: new THREE.Color('#a9b6d9') },
    uZCut: { value: new THREE.Vector2(-9000, -8900) },
    uHole: { value: new THREE.Vector4(0, -640, -2000, 320) },
    uOpacity: { value: 1 },
    uAmount: { value: amount },
    uSeed: { value: seed },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uLit, uShadeC; uniform vec2 uZCut; uniform vec4 uHole; uniform float uOpacity, uAmount, uSeed;
      varying vec3 vW;
      ${SEA_FADE}
      void main() {
        vec2 q = vW.xz;
        float d = length(cameraPosition - vW);
        // (a little further down the valley than the sea itself: the last wisps trail after it)
        float f = seaFade(q, 45.0);
        float n1 = texture2D(uNoise, q * 0.0014 + vec2(uSeed + uTime * 0.0009, uSeed * 0.7 + uTime * 0.0003)).r;
        float n2 = texture2D(uNoise, q * 0.0047 + vec2(uSeed * 1.3 - uTime * 0.0014, 0.3)).g;
        float m = n1 * 0.72 + n2 * 0.28;
        float a = smoothstep(0.36, 0.74, m) * uAmount * f;
        a *= smoothstep(55.0, 140.0, d);
        // (seen edge-on, far off, a flat veil would pile up into a grey sheet over the sea:
        // it thins away toward the horizon, where the sea's own haze takes over)
        float el = abs(cameraPosition.y - vW.y) / max(d, 1.0);
        a *= smoothstep(0.02, 0.2, el) * (1.0 - smoothstep(900.0, 1500.0, d));
        a *= uOpacity;
        if (a < 0.004) discard;
        vec3 V = normalize(cameraPosition - vW);
        // pale and luminous, the faintest blue in its thinner reaches, glowing toward the sun
        vec3 col = mix(mix(uShadeC, uLit, 0.82) * uShadowTint, uLit * uLightTint, smoothstep(0.4, 0.8, m));
        col += uSunCol * pow(max(dot(-V, uSunDir), 0.0), 4.0) * 0.16;
        col = applyFogK(col, vW, 0.55);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Sea of clouds: a softly displaced, slowly drifting surface of broad, gentle heaps
export function cloudSeaMaterial(U) {
  const uniforms = {
    ...U,
    uLit: { value: new THREE.Color('#fdfaf3') },
    uShadeC: { value: new THREE.Color('#a9b6d9') },
    // (a corridor where the sea thins out down the valley - none now: it covers the valley
    // whole, and parts over it later, round uHole)
    uZCut: { value: new THREE.Vector2(-9000, -8900) },
    uHole: { value: new THREE.Vector4(0, -640, -2000, 320) },
    uOpacity: { value: 1 },
    // 1 while the camera is above the highest heaps: only upper faces can show
    uFrontOnly: { value: 0 },
    // the highest the sea may rise (metres, from the camera's and her path - set by the scene):
    // the deep sea never swallows the camera or her
    uCeil: { value: null },
    uCeilRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uNoise; uniform vec2 uZCut; uniform vec4 uHole;
      uniform sampler2D uCeil; uniform vec4 uCeilRect;
      varying vec3 vW; varying vec3 vN; varying float vH; varying float vFade; varying float vK; varying float vCeil; varying float vBase;
      ${SEA_SURFACE_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float f = seaFade(w.xz, 0.0);
        vK = mix(0.3, 1.0, f); vCeil = min(ceilAt(w.xz, w.y), 400.0); vBase = w.y;
        // (the heaps settle as the sea thins into mist)
        float h = seaH(w.xz, w.y);
        // broad, soft normals (a wide step smooths the relief)
        float e = 9.0;
        float hx = seaH(w.xz + vec2(e, 0.0), w.y) - h;
        float hz = seaH(w.xz + vec2(0.0, e), w.y) - h;
        vN = normalize(vec3(-hx, e, -hz));
        w.y += h;
        vH = h; vW = w.xyz; vFade = f;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uLit, uShadeC; uniform vec2 uZCut; uniform vec4 uHole; uniform float uOpacity; uniform float uFrontOnly;
      uniform sampler2D uCeil; uniform vec4 uCeilRect;
      varying vec3 vW; varying vec3 vN; varying float vH; varying float vFade; varying float vK; varying float vCeil; varying float vBase;
      ${SEA_SURFACE_GLSL}
      void main() {
        if (uFrontOnly > 0.5 && !gl_FrontFacing) discard;
        // thinning into a veil over the head of the valley, softly mottled as it goes (never
        // holed through: no spots of ground showing through a solid sea)
        float mot = texture2D(uNoise, vW.xz * 0.0052 + vec2(uTime * 0.0012, 0.27)).r;
        float thin = 1.0 - vFade;
        float a = smoothstep(0.0, 1.0, vFade + (mot - 0.5) * 0.7 * vFade * thin * 4.0 * 0.5);
        a *= uOpacity;
        if (a < 0.008) discard;
        // the domes' light worked out per pixel from the height itself: smooth, round shading
        // however coarse the mesh (no facets)
        vec3 N = normalize(vN);
        float hP = vH;
        // (far off the mesh's own normals do: its facets are smaller than a pixel there)
        if (length(cameraPosition - vW) < 650.0) {
          float e = 5.0;
          float h0 = softCeil(cloudH(vW.xz) * vK, vCeil);
          float hx = softCeil(cloudH(vW.xz + vec2(e, 0.0)) * vK, vCeil) - h0;
          float hz = softCeil(cloudH(vW.xz + vec2(0.0, e)) * vK, vCeil) - h0;
          N = normalize(vec3(-hx, e, -hz));
          hP = h0;
        }
        float n2 = texture2D(uNoise, vW.xz * 0.011 + 0.5).b;
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        // soft, even light on broad heaps: a gentle, luminous, misty sea - bright domes, the
        // faintest blue in the creases between them, a soft brightness close by
        float shape = smoothstep(2.0, 34.0, hP);
        float sun = smoothstep(-0.75, 1.0, dot(N, uSunDir));
        float l = 0.5 + sun * 0.26 + shape * 0.2 + (n2 - 0.5) * 0.03;
        l = mix(l, 0.84, (1.0 - smoothstep(15.0, 120.0, dist)) * 0.5);
        vec2 bq = vW.xz + vec2(uTime * 0.7, uTime * 0.25);
        float b1 = texSmooth(uNoise, bq * 0.0105).r, b2 = texSmooth(uNoise, bq * 0.026 + 0.37).g;
        float bx1 = texSmooth(uNoise, (bq + vec2(4.0, 0.0)) * 0.0105).r, bz1 = texSmooth(uNoise, (bq + vec2(0.0, 4.0)) * 0.0105).r;
        float bx2 = texSmooth(uNoise, (bq + vec2(4.0, 0.0)) * 0.026 + 0.37).g, bz2 = texSmooth(uNoise, (bq + vec2(0.0, 4.0)) * 0.026 + 0.37).g;
        vec3 Nb = normalize(vec3(-((bx1 - b1) * 30.0 + (bx2 - b2) * 14.0), 4.0, -((bz1 - b1) * 30.0 + (bz2 - b2) * 14.0)));
        float bl = smoothstep(-0.6, 1.0, dot(normalize(N + Nb * 1.4), uSunDir));
        float dome = smoothstep(0.35, 0.8, b1 * 0.65 + b2 * 0.35);
        float near = 1.0 - smoothstep(40.0, 260.0, dist);
        l = mix(l, l * (0.86 + 0.2 * bl) + dome * 0.06, (0.3 + 0.5 * (1.0 - near * 0.5)) * vFade);
        vec3 col = mix(uShadeC * uShadowTint, uLit * uLightTint, clamp(l, 0.0, 1.0));
        if (!gl_FrontFacing) {
          // the deck seen from beneath: a soft grey ceiling, darkest under its thickest heaps,
          // gently mottled, paler where it thins (where the light comes through as it parts)
          float thick = smoothstep(4.0, 42.0, hP);
          float mott = b1 * 0.6 + b2 * 0.4;
          float lu = 0.6 - thick * 0.22 + (mott - 0.5) * 0.16 + thin * 0.35;
          col = mix(uShadeC * uShadowTint * 0.86, uLit * uLightTint, clamp(lu, 0.0, 1.0));
        }
        // (where it thins: paler, an even, luminous mist)
        col = mix(col, mix(uShadeC, uLit, 0.8) * uLightTint, thin * 0.6);
        float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 3.0);
        col += uSunCol * rim * 0.1;
        // sunlight soaking through the sea when looking toward the sun: a soft glow over it
        float fwd = max(dot(-V, uSunDir), 0.0);
        col += uSunCol * (pow(fwd, 6.0) * shape * 0.16 + pow(fwd, 2.5) * 0.08);
        // far off, the sea melts into a bright haze (pale light, not grey fog)
        float hz = 1.0 - exp(-dist * 0.0009);
        col = mix(col, mix(uFogCol, uLit * uLightTint, 0.5), hz * 0.45);
        col = applyFogK(col, vW, 0.6);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

// Puffy sculpted clouds
export function puffMaterial(U) {
  const uniforms = {
    ...U,
    uLit: { value: new THREE.Color('#fffdf7') },
    uShadeC: { value: new THREE.Color('#a9b5d8') },
    uOpacity: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        #ifdef USE_INSTANCING
          w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uLit, uShadeC; uniform float uOpacity;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float n = texture2D(uNoise, vW.xz * 0.02 + vW.y * 0.01).g;
        float l = smoothstep(-0.45, 0.6, dot(N, uSunDir) * 0.8 + (n - 0.5) * 0.3 + N.y * 0.45);
        vec3 col = mix(uShadeC * uShadowTint, uLit * uLightTint, l);
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
        col += uSunCol * rim * 0.14;
        col = applyFogK(col, vW, 0.8);
        gl_FragColor = vec4(col, uOpacity);
      }`,
    transparent: true,
    depthWrite: true,
  });
}

// ---------------------------------------------------------------------------
// Glowing ribbon (camera-facing), used for the golden trail and the star arc
export function ribbonMaterial(U, opts = {}) {
  const uniforms = {
    uTime: U.uTime,
    uNoise: U.uNoise,
    uGold: U.uGold,
    uWidth: { value: opts.width ?? 0.3 },
    uMinPix: { value: opts.minPix ?? 0.0022 },
    uHead: { value: 0 },
    uTail: { value: opts.tail ?? 60 },
    uFloor: { value: opts.floor ?? 0.16 },
    uAhead: { value: 0 },
    uAheadEnd: { value: 0 },
    uIntensity: { value: 1 },
    uStart: { value: 0 },
    uNear: { value: new THREE.Vector2(...(opts.near || [2.5, 14])) },
    ...(opts.textMask || {}),
  };
  return new THREE.ShaderMaterial({
    defines: opts.textMask ? { TEXTMASK: 1 } : {},
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aTangent; attribute float aSide; attribute float aS; attribute float aW;
      uniform float uWidth; uniform float uMinPix;
      varying float vS; varying float vSide; varying float vDist; varying float vMask;
      #ifdef TEXTMASK
        uniform vec4 uMaskA, uMaskB; uniform float uMaskK;
        // (the arc of stars dims where it passes behind the words on screen)
        float boxK(vec2 n, vec4 b) {
          return smoothstep(b.x - 0.06, b.x, n.x) * (1.0 - smoothstep(b.z, b.z + 0.06, n.x)) * smoothstep(b.y - 0.06, b.y, n.y) * (1.0 - smoothstep(b.w, b.w + 0.06, n.y));
        }
        float textMask(vec4 cp) {
          vec2 n = cp.xy / max(cp.w, 1e-4);
          return 1.0 - max(boxK(n, uMaskA), boxK(n, uMaskB)) * uMaskK;
        }
      #endif
      void main() {
        vec3 c = position;
        vec3 view = normalize(cameraPosition - c);
        vec3 side = normalize(cross(aTangent, view) + vec3(1e-5));
        float dist = length(cameraPosition - c);
        float w = max(uWidth * aW, dist * uMinPix);
        vec3 p = c + side * aSide * w;
        vS = aS; vSide = aSide; vDist = dist;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vMask = 1.0;
        #ifdef TEXTMASK
          vMask = textMask(gl_Position);
        #endif
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uNoise; uniform vec3 uGold;
      uniform float uHead, uTail, uFloor, uAhead, uAheadEnd, uIntensity, uStart;
      uniform vec2 uNear;
      varying float vS; varying float vSide; varying float vDist; varying float vMask;
      void main() {
        float x = vSide;
        float core = exp(-x * x * 26.0);
        float glow = exp(-x * x * 3.2) * (1.0 - x * x);
        float behind = uHead - vS;
        float I = 0.0;
        if (vS >= uStart && behind >= 0.0) I = exp(-behind / uTail) * (1.0 - uFloor) + uFloor;
        // fade-in of the newest segment right at the head
        I *= smoothstep(-0.5, 2.5, behind);
        // guiding trail ahead of her (World 4)
        if (behind < 0.0 && vS < uAheadEnd) {
          float flow = texture2D(uNoise, vec2(vS * 0.03 - uTime * 0.12, 0.37)).r;
          I = max(I, uAhead * (0.35 + 0.65 * smoothstep(0.45, 0.75, flow)));
        }
        I *= smoothstep(uNear.x, uNear.y, vDist);
        if (I < 0.003) discard;
        float sp = texture2D(uNoise, vec2(vS * 0.045 - uTime * 0.22, x * 0.2 + 0.5)).g;
        vec3 col = mix(uGold * 1.1, vec3(1.0, 0.98, 0.92), core * 0.85) * (glow * 0.75 + core * 0.95);
        col *= I * uIntensity * (0.75 + 0.5 * sp) * 1.55 * vMask;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Additive glowing points. Attributes: position(start), aVel, aBirth, aLife, aSize, aSeed
export function pointsMaterial(U, opts = {}) {
  const uniforms = {
    uTime: U.uTime,
    uClock: { value: 0 },
    uGold: U.uGold,
    uColor: { value: new THREE.Color(opts.color || '#ffffff') },
    uGoldMix: { value: opts.goldMix ?? 0.7 },
    uScale: { value: 300 },
    uGravity: { value: new THREE.Vector3(...(opts.gravity || [0, 0.4, 0])) },
    uMatrix: { value: new THREE.Matrix4() },
    uUseMatrix: { value: opts.useMatrix ? 1 : 0 },
    uOpacity: { value: 1 },
    uWobble: { value: opts.wobble ?? 0.6 },
    uTwinkle: { value: opts.twinkle ?? 0 },
    uDrag: { value: opts.drag ?? 0.0 },
    ...(opts.textMask || {}),
  };
  return new THREE.ShaderMaterial({
    defines: opts.textMask ? { TEXTMASK: 1 } : {},
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aVel; attribute float aBirth; attribute float aLife; attribute float aSize; attribute float aSeed;
      uniform float uClock; uniform float uTime; uniform float uScale; uniform vec3 uGravity;
      #ifdef TEXTMASK
        uniform vec4 uMaskA, uMaskB; uniform float uMaskK;
        // (the arc of stars dims where it passes behind the words on screen)
        float boxK(vec2 n, vec4 b) {
          return smoothstep(b.x - 0.06, b.x, n.x) * (1.0 - smoothstep(b.z, b.z + 0.06, n.x)) * smoothstep(b.y - 0.06, b.y, n.y) * (1.0 - smoothstep(b.w, b.w + 0.06, n.y));
        }
        float textMask(vec4 cp) {
          vec2 n = cp.xy / max(cp.w, 1e-4);
          return 1.0 - max(boxK(n, uMaskA), boxK(n, uMaskB)) * uMaskK;
        }
      #endif
      uniform mat4 uMatrix; uniform float uUseMatrix; uniform float uWobble; uniform float uTwinkle; uniform float uDrag;
      varying float vAlpha; varying float vSeed;
      void main() {
        float age = uClock - aBirth;
        vSeed = aSeed;
        if (age < 0.0 || age > aLife) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
        bool persist = aLife > 1e8;
        float k = persist ? 0.0 : age / aLife;
        vec3 start = position;
        if (uUseMatrix > 0.5) start = (uMatrix * vec4(position, 1.0)).xyz;
        float dragAge = uDrag > 0.0 ? (1.0 - exp(-uDrag * age)) / uDrag : age;
        vec3 p = persist ? start : start + aVel * dragAge + 0.5 * uGravity * age * age;
        float wt = persist ? uTime * 0.25 : age;
        float wk = persist ? 1.0 : k;
        p += vec3(sin(wt * 1.7 + aSeed * 40.0), sin(wt * 1.3 + aSeed * 17.0) * 0.6, cos(wt * 1.5 + aSeed * 23.0)) * uWobble * wk;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = mix(1.0, 0.55 + 0.45 * sin(uTime * (2.0 + aSeed * 5.0) + aSeed * 60.0), uTwinkle);
        gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 64.0) * (1.0 - k * 0.4);
        float fin = persist ? smoothstep(0.0, 3.0, age) : smoothstep(0.0, 0.12, k);
        float fout = persist ? 1.0 : 1.0 - smoothstep(0.6, 1.0, k);
        vAlpha = fin * fout * tw;
        #ifdef TEXTMASK
          vAlpha *= textMask(gl_Position);
        #endif
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold; uniform vec3 uColor; uniform float uGoldMix; uniform float uOpacity;
      varying float vAlpha; varying float vSeed;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float core = smoothstep(0.22, 0.0, d);
        float halo = smoothstep(0.5, 0.0, d);
        vec3 col = mix(uColor, uGold, uGoldMix * (0.6 + 0.4 * fract(vSeed * 7.3)));
        col = mix(col, vec3(1.0, 0.99, 0.95), core * 0.8);
        gl_FragColor = vec4(col * (halo * 0.55 + core * 1.6) * vAlpha * uOpacity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// Soft glow sprite (billboard) material
export function glowMaterial(U, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uColor: { value: new THREE.Color(opts.color || '#f3d9a4') },
      uOpacity: { value: opts.opacity ?? 1 },
      uCore: { value: opts.core ?? 0.6 },
      uPulse: { value: opts.pulse ?? 0 },
      uSeed: { value: opts.seed ?? 0 },
      uFlare: { value: opts.flare ?? 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
        mv.xy += position.xy * scale;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity; uniform float uCore; uniform float uPulse; uniform float uSeed; uniform float uFlare;
      varying vec2 vUv;
      void main() {
        vec2 c = (vUv - 0.5) * 2.0;
        float d = length(c);
        float halo = pow(max(1.0 - d, 0.0), 2.2);
        float core = smoothstep(0.18, 0.0, d) * uCore;
        float p = 1.0 + uPulse * 0.25 * sin(uTime * 1.6 + uSeed * 10.0);
        float fl = (exp(-abs(c.y) * 60.0) * max(1.0 - abs(c.x), 0.0) + exp(-abs(c.x) * 60.0) * max(1.0 - abs(c.y), 0.0)) * uFlare;
        vec3 col = mix(uColor, vec3(1.0, 0.99, 0.95), core) * (halo * 0.8 + core) * p + mix(uColor, vec3(1.0), 0.6) * fl * p;
        gl_FragColor = vec4(col * uOpacity * 1.35, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// Final pass: EverSwap-style lens blur at the edges, haze, vignette, grain
export function postMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uBlur: { value: 14 },
      uVig: { value: 0.22 },
      uTime: { value: 0 },
      uWhite: { value: 0 },
      uWhiteCol: { value: new THREE.Color('#f4f3f0') },
      uEdgeTint: { value: new THREE.Color('#c7d9e8') },
      uEdgeAmt: { value: 0.22 },
      uScrim: { value: 0 },
      uScrimCol: { value: new THREE.Color('#2a3446') },
      uFade: { value: 0 },
      uSat: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene; uniform vec2 uRes; uniform float uBlur, uVig, uTime, uWhite, uEdgeAmt, uScrim, uFade, uSat;
      uniform vec3 uWhiteCol, uEdgeTint, uScrimCol;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        vec2 ca = c * vec2(uRes.x / uRes.y, 1.0);
        float d = length(ca);
        float ell = length(c * vec2(1.0, 1.15)) * 1.414;
        float r = uBlur * smoothstep(0.26, 0.98, ell);
        vec3 col;
        if (r < 0.6) {
          col = texture2D(tScene, vUv).rgb;
        } else {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 18; i++) {
            float fi = float(i);
            float rr = sqrt((fi + 0.5) / 18.0) * r;
            float a = fi * 2.39996323 + uTime * 0.0;
            acc += texture2D(tScene, vUv + vec2(cos(a), sin(a)) * rr / uRes).rgb;
          }
          col = acc / 18.0;
        }
        col = mix(col, uEdgeTint, smoothstep(0.42, 1.05, ell) * uEdgeAmt);
        col *= 1.0 - smoothstep(0.55, 1.3, ell) * uVig;
        // gentle scrim behind centred text
        float sc = exp(-dot(ca * vec2(0.9, 1.6), ca * vec2(0.9, 1.6)) * 5.0);
        col = mix(col, col * 0.78 + uScrimCol * 0.08, sc * uScrim);
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, uSat);
        col = mix(col, uWhiteCol, uWhite);
        col = mix(col, vec3(0.0), uFade);
        float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * 0.022;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}
