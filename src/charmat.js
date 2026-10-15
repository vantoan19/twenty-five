// Character materials: skin (with a planar-projected painted face), strand
// hair cards (Kajiya-Kay highlights), and the dress cloth variants.
import * as THREE from 'three';
import { COMMON } from './shaders.js';

// ---------------------------------------------------------------------------
// Skin. When `face` is given, a painted decal is projected from the front of
// the head (object space): uv = (p.xy - rect.xy) / rect.zw.
export function skinMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uBase: { value: new THREE.Color(opts.color || '#f2cdb5') },
    uShade: { value: new THREE.Color(opts.shade || '#d9a8a2') },
    uFace: { value: opts.face || null },
    uFace2: { value: opts.face2 || opts.face || null },
    uFaceMix: { value: 0 },
    uFaceRect: { value: opts.faceRect || new THREE.Vector4(0, 0, 1, 1) },
    uFogScale: { value: opts.fogScale ?? 0.5 },
    uRimCol: U.uRimCol,
  };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { FACE: opts.face ? 1 : 0 },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vLN;
      void main() {
        vec3 transformed = position;
        vec3 objectNormal = normal;
        vL = position; vLN = normal;
        vec4 w = modelMatrix * vec4(transformed, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * objectNormal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uBase, uShade, uRimCol;
      uniform sampler2D uFace, uFace2; uniform float uFaceMix; uniform vec4 uFaceRect; uniform float uFogScale;
      varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vLN;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 base = uBase;
        float paint = 0.0;
        #if FACE
          vec2 fuv = (vL.xy - uFaceRect.xy) / uFaceRect.zw;
          float fm = smoothstep(0.05, 0.35, normalize(vLN).z) * step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
          vec4 f = mix(texture2D(uFace, fuv), texture2D(uFace2, fuv), uFaceMix);
          paint = f.a * fm;
          base = mix(base, f.rgb, paint);
        #endif
        float ndl = dot(N, uSunDir);
        float wrap = (ndl + 0.4) / 1.4;
        float l = smoothstep(0.0, 0.85, wrap);
        vec3 lit = mix(uShade * uShadowTint, uLightTint * 1.04, l);
        vec3 col = base * lit + base * uAmb * 0.07;
        // warm light bleeding through at the terminator (subsurface hint)
        float sss = smoothstep(-0.25, 0.15, ndl) * (1.0 - smoothstep(0.15, 0.6, ndl));
        col += base * vec3(0.42, 0.1, 0.06) * sss * 0.3 * (1.0 - paint * 0.6);
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        col += uRimCol * rim * 0.2 * (0.45 + 0.55 * l);
        vec3 H = normalize(V + uSunDir);
        col += uLightTint * pow(max(dot(N, H), 0.0), 48.0) * 0.05 * (1.0 - paint);
        col += base * pointLight(vW, N) * 1.3;
        col = applyFogK(col, vW, uFogScale);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Hair cards: alpha-to-coverage strands with anisotropic (Kajiya-Kay) sheen.
// Geometry attributes: aTan (vec3, root->tip), aF (0 root .. 1 tip), aSeed.
export function hairMaterial(U, opts = {}) {
  const uniforms = {
    ...U,
    uBase: { value: new THREE.Color(opts.color || '#231b1e') },
    uShade: { value: new THREE.Color(opts.shade || '#5d5468') },
    uSpec1: { value: new THREE.Color(opts.spec1 || '#fff1e2') },
    uSpec2: { value: new THREE.Color(opts.spec2 || '#9a6e5c') },
    uTex: { value: opts.tex || null },
    uUseTex: { value: opts.tex ? 1 : 0 },
    uFlow: { value: new THREE.Vector3() },
    uFlowAmt: { value: 0 },
    uTwist: { value: 0 },
    uSway: { value: opts.sway ?? 1 },
    uFogScale: { value: opts.fogScale ?? 0.5 },
    uRimCol: U.uRimCol,
    uAlphaCut: { value: opts.alphaCut ?? 0.38 },
    uTilt: { value: 0 },
    uPivot: { value: opts.pivot || new THREE.Vector3() },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { DEFORM: opts.deform ? 1 : 0, HAIR_OPAQUE: opts.opaque ? 1 : 0 },
    vertexShader: /* glsl */ `
      attribute vec3 aTan; attribute float aF; attribute float aSeed;
      uniform float uTime; uniform vec3 uFlow; uniform float uFlowAmt; uniform float uTwist; uniform float uWind; uniform float uSway;
      uniform float uTilt; uniform vec3 uPivot;
      varying vec3 vW; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vF; varying float vSeed;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        vec3 tg = aTan;
        float f = aF;
        #if DEFORM
          float k = f * f;
          float ph = aSeed * 6.2831;
          float sw = sin(uTime * 1.6 + ph + f * 3.2) * 0.55 + sin(uTime * 2.7 + ph * 1.7) * 0.3;
          p.x += sw * 0.02 * k * (0.5 + uWind) * uSway;
          p.z += (sin(uTime * 1.25 + ph + f * 2.0) * 0.012 - 0.008) * k * (0.5 + uWind) * uSway;
          p += uFlow * uFlowAmt * k;
          // lengths hang with gravity when the head tilts
          float tl = uTilt * smoothstep(0.1, 0.42, f);
          float cl = cos(tl), sl = sin(tl);
          vec3 q = p - uPivot;
          q.yz = vec2(cl * q.y - sl * q.z, sl * q.y + cl * q.z);
          p = q + uPivot;
          n.yz = vec2(cl * n.y - sl * n.z, sl * n.y + cl * n.z);
          tg.yz = vec2(cl * tg.y - sl * tg.z, sl * tg.y + cl * tg.z);
          float tw = uTwist * smoothstep(0.08, 0.5, f);
          float tc = cos(tw), ts = sin(tw);
          p.xz = vec2(tc * p.x + ts * p.z, -ts * p.x + tc * p.z);
          n.xz = vec2(tc * n.x + ts * n.z, -ts * n.x + tc * n.z);
          tg.xz = vec2(tc * tg.x + ts * tg.z, -ts * tg.x + tc * tg.z);
        #endif
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * n);
        vT = normalize(mat3(modelMatrix) * tg);
        vUv = uv; vF = f; vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uBase, uShade, uSpec1, uSpec2, uRimCol;
      uniform sampler2D uTex; uniform float uUseTex; uniform float uFogScale; uniform float uAlphaCut;
      varying vec3 vW; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vF; varying float vSeed;
      void main() {
        vec4 tx = uUseTex > 0.5 ? texture2D(uTex, vUv) : vec4(0.8, 0.5, 0.5, 1.0);
        float a = tx.a;
        #if HAIR_OPAQUE
          a = 1.0;
        #else
          if (a < 0.02) discard;
        #endif
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 T = normalize(vT);
        vec3 V = normalize(cameraPosition - vW);
        vec3 H = normalize(uSunDir + V);
        float strand = tx.r;
        vec3 base = uBase * (0.88 + 0.55 * strand) + vec3(0.012, 0.007, 0.004);
        float ndl = dot(N, uSunDir);
        float l = smoothstep(-0.35, 0.65, ndl);
        vec3 col = base * mix(uShade * uShadowTint, uLightTint * 1.05, l) + base * uAmb * 0.12;
        // Kajiya-Kay: a tight white highlight and a softer warm one shifted toward the tips
        float sh = tx.g - 0.5;
        vec3 T1 = normalize(T + N * (0.1 + sh * 0.35));
        vec3 T2 = normalize(T + N * (-0.14 + sh * 0.35));
        float d1 = dot(T1, H), d2 = dot(T2, H);
        float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 80.0);
        float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 20.0) * smoothstep(0.3, 0.75, tx.b);
        float vis = smoothstep(-0.2, 0.3, ndl);
        col += uSpec1 * uLightTint * s1 * 0.5 * vis;
        col += uSpec2 * uLightTint * s2 * 0.42 * vis;
        float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 3.0);
        col += uRimCol * rim * 0.16 * (0.4 + 0.6 * l);
        col += base * pointLight(vW, N) * 1.2;
        col = applyFogK(col, vW, uFogScale);
        #if HAIR_OPAQUE
          gl_FragColor = vec4(col, 1.0);
        #else
          gl_FragColor = vec4(col, smoothstep(uAlphaCut - 0.25, uAlphaCut + 0.25, a));
        #endif
      }`,
    side: THREE.DoubleSide,
    alphaToCoverage: !opts.opaque,
    transparent: false,
  });
}

// Grayscale strand texture: r = brightness, g = highlight shift, b = sheen mask, a = coverage
export function strandTexture(seed = 7, opts = {}) {
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = opts.count || 260;
  const tipMin = opts.tipMin ?? 0.8;
  for (let i = 0; i < n; i++) {
    const x0 = rnd() * W;
    // fewer strands near the card edges: soft, separated borders
    const e = Math.min(x0, W - x0) / (W * 0.5);
    if (rnd() > 0.25 + 0.75 * Math.pow(e, 0.6)) continue;
    const len = H * (tipMin + rnd() * (1 - tipMin));
    const w = 1.2 + rnd() * 2.6;
    const br = Math.floor(120 + rnd() * 135);
    const shift = Math.floor(rnd() * 255);
    const sheen = Math.floor(80 + rnd() * 175);
    const wav = (rnd() - 0.5) * 6, ph = rnd() * 6.28;
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, `rgba(${br},${shift},${sheen},1)`);
    grad.addColorStop(0.82, `rgba(${br},${shift},${sheen},0.95)`);
    grad.addColorStop(1, `rgba(${br},${shift},${sheen},0)`);
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.beginPath();
    for (let y = 0; y <= len; y += 16) {
      const x = x0 + Math.sin(y * 0.012 + ph) * wav;
      if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  // solid core so the card body reads as hair mass
  if (opts.core === false) {
    const t0 = new THREE.CanvasTexture(c);
    t0.wrapS = THREE.RepeatWrapping; t0.wrapT = THREE.ClampToEdgeWrapping; t0.anisotropy = 8;
    return t0;
  }
  const core = g.createLinearGradient(0, 0, W, 0);
  core.addColorStop(0, 'rgba(150,128,160,0)');
  core.addColorStop(0.22, 'rgba(150,128,160,0.92)');
  core.addColorStop(0.78, 'rgba(150,128,160,0.92)');
  core.addColorStop(1, 'rgba(150,128,160,0)');
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = core;
  g.fillRect(0, 0, W, H * (opts.coreLen ?? 0.78));
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}
