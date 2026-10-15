// The bloom's flower carpet: tens of thousands of little flowers that spring up out of
// the grass and open as the bloom reaches them, in drifts of one kind (white daisies,
// pink cosmos, buttercups, poppies, cornflowers...) with strays among them.
// Each flower is only a slender stem and a head that turns toward the viewer, its
// petals drawn in the shader: a few triangles where a modelled flower takes dozens,
// so the meadow can be carpeted with them, and every one shows its face.
import * as THREE from 'three';
import { mulberry32, TAU } from './math.js';
import { COMMON, BLOOM_GLSL, GROW_GLSL } from './shaders.js';

// a cluster of `n` flowers rising from one spot. Per vertex: aC = (corner x, corner y,
// part: 0 stem, 1 head), aF = (root offset x, height, root offset z, which flower)
export function blossomGeometry(seed = 1, n = 3, spread = 0.2, stems = true) {
  const rnd = mulberry32(seed * 71 + 5);
  const pos = [], ac = [], af = [], idx = [];
  const a0 = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + (rnd() - 0.5) * 1.2;
    const r = i === 0 ? rnd() * spread * 0.2 : spread * (0.5 + rnd() * 0.5);
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const hf = i === 0 ? 1 : 0.6 + rnd() * 0.4;
    // (positions only bound the cluster; the shader places every vertex)
    // far away (where the stems could never be seen) the heads alone
    if (stems) {
      const b = pos.length / 3;
      for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(ox, cy * 0.45 * hf, oz); ac.push(cx, cy, 0); af.push(ox, hf, oz, i); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const b = pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(ox + cx * 0.12, 0.45 * hf + cy * 0.12, oz); ac.push(cx, cy, 1); af.push(ox, hf, oz, i); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(ac, 3));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(af, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius += 0.25;
  return g;
}

export function blossomMaterial(U, opts = {}) {
  const lowQ = !!opts.lowQ;
  const uniforms = {
    ...U,
    uStem: { value: new THREE.Color(opts.stem || '#4e8a38') },
    uShade: { value: new THREE.Color(opts.shade || '#8f8fb8') },
    uGrowKey: { value: -1e4 },
    uGK: { value: new THREE.Vector4(-1e4, -1e4, -1e4, -1e4) },
    // how far each head turns toward the viewer (0: its own way, 1: square on)
    uFace: { value: opts.face ?? 0.68 },
    uSize: { value: opts.size ?? 1 },
    uFogScale: { value: opts.fogScale ?? 1 },
  };
  return new THREE.ShaderMaterial({
    defines: { ...(opts.grow ? { GROW: 1 } : {}), ...(lowQ ? { LOW_Q: 1 } : {}) },
    uniforms,
    vertexShader: /* glsl */ `
      ${COMMON}
      ${BLOOM_GLSL}
      ${GROW_GLSL}
      uniform vec3 uStem, uShade;
      uniform float uFace, uSize;
      attribute vec3 aC; attribute vec4 aF;
      #ifdef GROW
        attribute float aKey;
      #endif
      uniform float uFogScale;
      varying vec2 vUV; varying vec3 vCol; varying vec3 vEye; varying vec4 vShape;
      varying vec3 vLit; varying vec3 vOpen; varying float vGlow; varying vec4 vFog;
      vec4 hash42(vec2 p) {
        vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
        p4 += dot(p4, p4.wzxy + 33.33);
        return fract((p4.xxyz + p4.yzzw) * p4.zywx);
      }
      void main() {
        mat4 im = instanceMatrix;
        vec3 ipos = (modelMatrix * im[3]).xyz;
        float sc = length(im[0].xyz) * uSize;
        vec3 off = mat3(modelMatrix) * mat3(im) * vec3(aF.x, 0.0, aF.z);
        vec3 root = ipos + off;
        vec4 h1 = hash42(ipos.xz * 1.37 + aF.w * 3.71);
        vec4 h2 = hash42(ipos.zx * 0.91 + h1.xy * 7.0 + aF.w * 1.3);
        // --- growing: the stem shoots up (a touch past its height and back), the bud
        // swells and a beat later bursts open, its petals unfurling
        float xs = 3.0;
        #ifdef GROW
          float gx = growX(aKey);
          if (gx < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          xs = max(gx - h1.w * 0.32, 0.0) * 1.3;
        #endif
        float rise = xs > 0.0 ? 1.0 - exp(-xs * 6.5) * cos(xs * 8.0) : 0.0;
        float bud = smoothstep(0.04, 0.3, xs);
        float open = smoothstep(0.28, 0.85, xs);
        float swell = 1.0 + 0.24 * sin(open * 3.14159);
        // --- stem
        float H = sc * aF.y * (0.27 + 0.15 * h1.x) * rise;
        vec2 lean = (h1.yz - 0.5) * 0.36 + off.xz / max(sc, 1e-3) * 1.4;
        float ph = dot(root.xz, vec2(0.13, 0.17));
        float gust = sin(uTime * 0.7 + root.x * 0.06 + root.z * 0.045) * 0.5 + 0.5;
        float sw = sin(uTime * 1.6 + ph + h1.x * 2.0) * 0.55 + sin(uTime * 2.7 + ph * 1.7) * 0.25 + gust * 0.6;
        vec2 wind = vec2(sw * 0.12, (cos(uTime * 1.3 + ph) * 0.4 + gust * 0.3) * 0.08) * uWind * 2.4 * (0.5 + gust * 0.7);
        vec3 top = root + vec3((lean.x * 0.3 + wind.x) * H, H, (lean.y * 0.3 + wind.y) * H);
        // the shockwave blows them back as it passes; behind it they spring upright again
        float rd = length(root.xz - uRipple.xz);
        float ring = exp(-pow((rd - uRipple.w) / (0.9 + uRipple.w * 0.04), 2.0)) * uRippleAmt;
        if (uRippleAmt > 0.0) {
          vec2 away = (root.xz - uRipple.xz) / max(rd, 0.01);
          float behind = uRipple.w - rd;
          float front = exp(-pow((rd - uRipple.w + 0.4) / (1.3 + uRipple.w * 0.025), 2.0));
          float wob = behind > 0.0 ? exp(-behind * 0.2) * sin(behind * 0.8) : 0.0;
          top.xz += away * (front * 0.5 - wob * 0.2) * min(uRippleAmt, 1.0) * H;
        }
        // --- head: faces its own way, turned most of the way toward the viewer
        float R = sc * (0.05 + 0.032 * h2.x) * bud * mix(0.45, 1.0, open) * swell;
        vec3 n0 = normalize(vec3((h2.y - 0.5) * 1.3, 1.0, (h2.z - 0.5) * 1.3));
        vec3 hc = top + n0 * R * 0.12;
        vec3 toC = cameraPosition - hc;
        float dC = length(toC);
        toC /= max(dC, 1e-3);
        vec3 n = normalize(mix(n0, toC, uFace));
        // square to the screen's horizontal, so the petals never spin as the camera moves
        vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 ax = normalize(cr - n * dot(cr, n));
        vec3 ay = cross(n, ax);
        vec3 p;
        // (the head's quad hugs the petals: a hair of margin for the soft edge)
        vUV = aC.xy * 1.06;
        if (aC.z > 0.5) {
          p = hc + (ax * aC.x + ay * aC.y) * R * 1.06;
        } else {
          // a slim ribbon from the root to the head, edge-on never
          vec3 b = hc - n * R * 0.05 - vec3(0.0, R * 0.2, 0.0);
          vec3 mid = mix(root, b, aC.y);
          vec3 sd = cross(b - root, cameraPosition - mid);
          sd /= max(length(sd), 1e-5);
          // far away a stem would only shimmer
          float wd = sc * 0.0056 * (1.0 - 0.4 * aC.y) * (1.0 - smoothstep(26.0, 42.0, dC));
          p = mid + sd * aC.x * wd;
        }
        // fog once per vertex (as applyFogK, which the petals are too small to need per pixel)
        {
          vec3 V = p - cameraPosition;
          float d = length(V);
          float fog = 1.0 - exp(-pow(d * uFogDensity * uFogScale, 1.75));
          float hf = exp(-max(p.y - uFogHeight, 0.0) * uFogHeightFalloff) * uFogHeightAmt * (1.0 - exp(-d * 0.0045));
          if (uMist > 0.001) hf *= mix(1.0, 0.25 + texture2D(uNoise, p.xz * 0.0035 + vec2(uTime * 0.0045, uTime * 0.0012)).r * 1.5, uMist);
          fog = clamp(fog + hf * (1.0 - fog) * uFogScale, 0.0, 1.0);
          vFog = vec4(mix(uFogCol, uFogSunCol, pow(max(dot(V / max(d, 1e-3), uSunDir), 0.0), 5.0)), fog);
        }
        // --- colour: the kind of its patch of meadow, or a stray
        vec4 pt = bloomPatch(root.xz);
        vec3 pc, ec; vec4 sh;
        bloomKind(h1.x < 0.22 || pt.z < 0.18 ? h2.w : pt.x, fract(h1.y * 5.3 + pt.y * 0.4), pc, ec, sh);
        vCol = pc; vEye = ec; vShape = sh;
        vOpen = vec3(aC.z, open, h2.x * 6.2832 + (1.0 - open) * 1.7);
        // --- light (flat heads: once per vertex)
        float l = smoothstep(-0.25, 0.6, dot(n0, uSunDir));
        float ao = aC.z > 0.5 ? 1.0 : mix(0.55, 1.0, aC.y);
        vec3 lit = uShade * uShadowTint * (1.0 - l) + uLightTint * 0.97 * l;
        lit *= mix(0.78, 1.0, ao);
        // petals glow when the sun shines through them
        lit += uSunCol * pow(max(dot(-toC, uSunDir), 0.0), 3.0) * 0.2 * aC.z;
        // (a little quieter at night, so they glimmer rather than shine)
        lit *= 1.0 - 0.18 * uNight;
        lit += pointLight(hc, n) * 1.4;
        vLit = lit;
        // a soft shimmer as each one opens, and the shockwave's gold
        vGlow = ring * 0.25 + exp(-abs(xs - 0.55) * 7.0) * smoothstep(0.2, 0.4, xs) * 0.08 * aC.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uStem;
      varying vec2 vUV; varying vec3 vCol; varying vec3 vEye; varying vec4 vShape;
      varying vec3 vLit; varying vec3 vOpen; varying float vGlow; varying vec4 vFog;
      void main() {
        vec3 c;
        float alpha = 1.0;
        if (vOpen.x < 0.5) {
          c = uStem;
        } else {
          // petals: n lobes around a golden eye; a closed bud is a plain round knot
          float open = vOpen.y;
          float r = length(vUV);
          float f = abs(cos((atan(vUV.y, vUV.x) + vOpen.z) * vShape.x * 0.5));
          float depth = vShape.y * open;
          float edge = (1.0 - depth * (1.0 - pow(f, vShape.z))) * mix(0.55, 1.0, open);
          float aa = max(fwidth(r), 1e-4) * 0.85;
          alpha = clamp(0.5 - (r - edge) / aa, 0.0, 1.0);
          #ifdef LOW_Q
            if (alpha < 0.5) discard;
            alpha = 1.0;
          #else
            if (alpha < 0.01) discard;
          #endif
          float t = clamp(r / max(edge, 1e-3), 0.0, 1.0);
          // a deeper heart fading to pale, glowing tips; shaded where the petals part
          c = vCol * mix(0.78, 1.0, smoothstep(0.12, 0.95, t));
          c = mix(c, vec3(1.0), smoothstep(0.7, 1.0, t) * 0.04);
          c *= mix(1.0, mix(0.76, 1.0, smoothstep(0.0, 0.55, f)), depth);
          // a bud is a darker knot of its colour, greener at the base
          c = mix(mix(vCol * 0.72, uStem, 0.3 * (1.0 - t)), c, smoothstep(0.0, 0.45, open));
          // the eye, a little domed
          float er = vShape.w * mix(1.6, 1.0, open);
          float eye = (1.0 - smoothstep(er - aa, er + aa, r)) * smoothstep(0.1, 0.5, open);
          c = mix(c, vEye * (1.12 - 0.3 * r / max(er, 1e-3)), eye);
        }
        vec3 col = c * vLit + uGold * vGlow;
        gl_FragColor = vec4(mix(col, vFog.rgb, vFog.a), alpha);
      }`,
    side: THREE.DoubleSide,
    alphaToCoverage: !lowQ,
  });
}
