import * as THREE from 'three';

// Cinematic post pipeline:
//  scene (MSAA, HDR, depth) -> half-res depth-aware lens blur (edge haze + focus on her)
//  -> quarter/eighth-res bloom -> composite with grading, haze, vignette, grain.

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COC = /* glsl */ `
  uniform float uNear, uFar, uEdge, uDof, uFocus, uDofMax;
  float linZ(float d) { return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
  float edgeR(vec2 uv) {
    vec2 c = uv - 0.5;
    float ell = length(c * vec2(1.0, 1.15)) * 1.414;
    // (only in the far corners, if at all: the frame stays crisp edge to edge)
    return uEdge * smoothstep(0.8, 1.25, ell);
  }
  // A wide clear zone: everything from the lens to a good way past her is in focus; only
  // the distant background softens, gently and gradually, and only in the close moments.
  float dofR(float z) {
    float band = max(2.5, uFocus * 0.9);
    float d = z - uFocus;
    float kb = clamp((d - band) / (uFocus * 4.0 + 20.0), 0.0, 1.0);
    float kf = clamp((-d - band) / (uFocus * 0.5 + 1.0), 0.0, 1.0);
    return uDofMax * uDof * max(kb, kf);
  }
  float cocZ(vec2 uv, float z) {
    // the sky dome (stars, moon) stays crisp
    float sky = step(6000.0, z);
    float near = 1.0 - smoothstep(uFocus + 1.0, uFocus * 1.8 + 4.0, z);
    return max(edgeR(uv) * (1.0 - near) * (1.0 - sky * 0.6), dofR(z) * (1.0 - sky));
  }`;

function fsMesh(mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

export class Post {
  constructor(renderer, quality) {
    this.r = renderer;
    this.quality = quality;
    const ext = renderer.extensions;
    this.hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const low = quality === 'low';
    this.low = low;
    this.useDepth = true;
    const depthTexture = new THREE.DepthTexture(4, 4);
    depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { type, samples: low ? 0 : 4, depthBuffer: true, depthTexture });
    const mk = () => new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.half = mk();
    this.q1 = mk(); this.q2 = mk(); this.e1 = mk(); this.e2 = mk();

    const shared = {
      uNear: { value: 0.12 }, uFar: { value: 9000 }, uEdge: { value: 12 }, uDof: { value: 0 }, uFocus: { value: 5 }, uDofMax: { value: 14 },
    };
    this.shared = shared;
    // Soft particles: transparent objects on layer 1 are drawn in a second pass
    // that can read the resolved depth of the first (only with an MSAA target,
    // where the depth texture is not attached to the framebuffer being drawn).
    this.softPass = !low && !ext.has('WEBGL_multisampled_render_to_texture');
    this.soft = { tSceneDepth: { value: depthTexture }, uSceneRes: { value: new THREE.Vector2(1, 1) }, uNear: shared.uNear, uFar: shared.uFar };
    // (without multisampling the depth texture is the very buffer being drawn into, which a
    // shader must not read at the same time: the soft pass then reads a copy of it)
    if (this.softPass) {
      const dc = new THREE.DepthTexture(4, 4);
      dc.type = THREE.UnsignedIntType;
      this.depthCopy = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, samples: 0, depthBuffer: true, depthTexture: dc });
    }

    this.mBlur = new THREE.ShaderMaterial({
      uniforms: { ...shared, tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTaps: { value: low ? 10 : 14 } },
      defines: low ? { TAPS: 10 } : { TAPS: 14, DYN_TAPS: 1 },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform int uTaps;
        varying vec2 vUv;
        ${COC}
        float cocAt(vec2 uv) { return cocZ(uv, linZ(texture2D(tDepth, uv).r)); }
        void main() {
          float z = linZ(texture2D(tDepth, vUv).r);
          float r = cocZ(vUv, z);
          vec3 acc = texture2D(tColor, vUv).rgb;
          float wsum = 1.0;
          if (r > 0.75) {
            // per-pixel rotation + radial jitter: point lights open into soft discs, not star patterns
            float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            float rot = ign * 6.2831853;
            #ifdef DYN_TAPS
              float nt = float(uTaps);
            #else
              float nt = float(TAPS);
            #endif
            for (int i = 0; i < TAPS; i++) {
              #ifdef DYN_TAPS
                if (i >= uTaps) break;
              #endif
              float fi = float(i);
              float rr = sqrt((fi + 0.15 + 0.7 * fract(ign + fi * 0.618034)) / nt) * r;
              float a = fi * 2.39996323 + rot;
              vec2 uv = vUv + vec2(cos(a), sin(a)) * rr / uRes;
              float tr = cocAt(uv);
              float w = smoothstep(rr - 2.0, rr + 0.5, tr);
              acc += texture2D(tColor, uv).rgb * w;
              wsum += w;
            }
          }
          // alpha: this texel's depth (log2), so the composite can upsample without
          // mixing across silhouettes (no half-res stair-steps along edges)
          gl_FragColor = vec4(acc / wsum, (log2(max(z, 0.07)) + 4.0) / 18.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.mBright = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: this.hdr ? 1.0 : 0.82 }, uKnee: { value: 0.35 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThresh, uKnee;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
          c += texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
          c += texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
          c += texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          c = min(c, vec3(8.0));
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - uThresh + uKnee, 0.0, 2.0 * uKnee);
          soft = soft * soft / (4.0 * uKnee + 1e-4);
          float contrib = max(soft, br - uThresh) / max(br, 1e-4);
          gl_FragColor = vec4(c * contrib, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.mGauss = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
          c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
          c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.mFinal = new THREE.ShaderMaterial({
      defines: low ? { LOW_Q: 1 } : {},
      uniforms: {
        ...shared,
        tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.35 }, uBloomW: { value: new THREE.Vector2(0.85, 0.75) }, uBlurOn: { value: 1 },
        uTime: { value: 0 }, uVig: { value: 0.22 }, uEdgeAmt: { value: 0.03 }, uEdgeTint: { value: new THREE.Color('#c7d9e8') },
        uScrim: { value: 0 }, uScrimCol: { value: new THREE.Color('#2a3446') },
        uWhite: { value: 0 }, uWhiteCol: { value: new THREE.Color('#f8f7f3') },
        uCloudIn: { value: 0 }, uCloudCol: { value: new THREE.Color('#fbfaf6') },
        uFade: { value: 0 }, uBloom: { value: 0.8 },
        uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color('#fff2d6') },
        uLift: { value: new THREE.Color(0, 0, 0) }, uGain: { value: new THREE.Color(1, 1, 1) },
        uSat: { value: 1.0 }, uVib: { value: 0.0 }, uContrast: { value: 1.0 }, uGrain: { value: 0.012 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth, tBlur, tBloomA, tBloomB;
        uniform vec2 uRes, uHalf, uBloomW;
        uniform float uTime, uVig, uEdgeAmt, uScrim, uWhite, uFade, uBloom, uSat, uVib, uContrast, uGrain, uFlash, uSharp, uBlurOn, uCloudIn;
        uniform vec3 uEdgeTint, uScrimCol, uWhiteCol, uLift, uGain, uFlashCol, uCloudCol;
        varying vec2 vUv;
        ${COC}
        float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vn3(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h31(i), h31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                     mix(mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0)), f.x), f.y), f.z);
        }
        vec3 softClip(vec3 c) {
          vec3 x = max(c - 0.86, 0.0);
          return min(c, vec3(0.86)) + 0.14 * (1.0 - exp(-x * 6.0));
        }
        // contrast-adaptive sharpening (after AMD's CAS): each pixel pushed away from its four
        // neighbours (one scene texel away), less where the local contrast is already high or
        // the colour is bright, so edges get crisper without halos. When the scene is drawn
        // below the screen's resolution this also restores the detail the upscale smears.
        vec3 casSample(vec2 uv) {
          vec3 c = texture2D(tColor, uv).rgb;
          if (uSharp <= 0.001) return c;
          vec2 px = 1.0 / uRes;
          vec3 a = texture2D(tColor, uv - vec2(0.0, px.y)).rgb;
          vec3 b = texture2D(tColor, uv - vec2(px.x, 0.0)).rgb;
          vec3 d = texture2D(tColor, uv + vec2(px.x, 0.0)).rgb;
          vec3 e = texture2D(tColor, uv + vec2(0.0, px.y)).rgb;
          vec3 mn = min(min(min(a, b), min(d, e)), c);
          vec3 mx = max(max(max(a, b), max(d, e)), c);
          vec3 amp = sqrt(clamp(min(mn, max(vec3(0.0), 1.0 - mx)) / max(mx, vec3(1e-4)), 0.0, 1.0));
          vec3 w = -amp / mix(8.0, 5.0, uSharp);
          return max((c + (a + b + d + e) * w) / (1.0 + 4.0 * w), vec3(0.0));
        }
        // gentle anti-aliasing (after FXAA): where the brightness changes across a pixel, a
        // few samples along the edge are blended - no stair-steps or crawling on thin blades,
        // branches and hair, and no harsh, brittle edges anywhere
        vec3 fxaaSample(vec2 uv) {
          vec2 px = 1.0 / uRes;
          vec3 rgbNW = texture2D(tColor, uv + vec2(-0.5, -0.5) * px).rgb;
          vec3 rgbNE = texture2D(tColor, uv + vec2(0.5, -0.5) * px).rgb;
          vec3 rgbSW = texture2D(tColor, uv + vec2(-0.5, 0.5) * px).rgb;
          vec3 rgbSE = texture2D(tColor, uv + vec2(0.5, 0.5) * px).rgb;
          vec3 rgbM = texture2D(tColor, uv).rgb;
          vec3 lw = vec3(0.299, 0.587, 0.114);
          float lNW = dot(min(rgbNW, vec3(2.0)), lw), lNE = dot(min(rgbNE, vec3(2.0)), lw);
          float lSW = dot(min(rgbSW, vec3(2.0)), lw), lSE = dot(min(rgbSE, vec3(2.0)), lw);
          float lM = dot(min(rgbM, vec3(2.0)), lw);
          float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
          float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
          float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
          float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
          dir = clamp(dir * rcpMin, vec2(-6.0), vec2(6.0)) * px;
          vec3 rgbA = 0.5 * (texture2D(tColor, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
          vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tColor, uv - dir * 0.5).rgb + texture2D(tColor, uv + dir * 0.5).rgb);
          float lB = dot(min(rgbB, vec3(2.0)), lw);
          vec3 aa = (lB < lMin || lB > lMax) ? rgbA : rgbB;
          // (and a breath of softness everywhere: the four half-pixel samples, faintly)
          return mix(aa, (rgbNW + rgbNE + rgbSW + rgbSE) * 0.25, 0.12);
        }
        void main() {
          vec3 sharp = uSharp > 0.001 ? casSample(vUv) : fxaaSample(vUv);
          vec3 col = sharp;
          // (no depth read at all while nothing in the frame is softened)
          float z = 1.0, rb = 0.0;
          if (uBlurOn > 0.5) { z = linZ(texture2D(tDepth, vUv).r); rb = cocZ(vUv, z); }
          if (rb > 0.5) {
            float big = smoothstep(1.9, 3.8, rb);
            if (big < 1.0) {
              // small radii soften at full resolution (no half-res stair-steps on fine
              // detail like hair); the half-res lens blur takes over for the big ones
              vec2 o = vec2(min(rb, 2.6) * 0.5) / uRes;
              vec3 s4 = texture2D(tColor, vUv + o).rgb + texture2D(tColor, vUv - o).rgb
                      + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb;
              col = mix(sharp, s4 * 0.25, smoothstep(0.5, 1.6, rb) * 0.8);
            }
            if (big > 0.0) {
              // depth-aware upsample: of the four nearest half-res texels, trust the
              // ones at this pixel's depth (silhouettes stay clean at full resolution)
              vec2 st = vUv * uHalf - 0.5;
              vec2 i0 = floor(st), fr = st - i0;
              vec4 t00 = texture2D(tBlur, (i0 + 0.5) / uHalf);
              vec4 t10 = texture2D(tBlur, (i0 + vec2(1.5, 0.5)) / uHalf);
              vec4 t01 = texture2D(tBlur, (i0 + vec2(0.5, 1.5)) / uHalf);
              vec4 t11 = texture2D(tBlur, (i0 + 1.5) / uHalf);
              vec4 w = vec4((1.0 - fr.x) * (1.0 - fr.y), fr.x * (1.0 - fr.y), (1.0 - fr.x) * fr.y, fr.x * fr.y);
              vec4 dz = vec4(t00.a, t10.a, t01.a, t11.a) * 18.0 - 4.0 - log2(max(z, 0.07));
              w *= exp(-dz * dz * 40.0) + 1e-4;
              vec3 bl = (t00.rgb * w.x + t10.rgb * w.y + t01.rgb * w.z + t11.rgb * w.w) / (w.x + w.y + w.z + w.w);
              col = mix(col, bl, big);
            }
          }

          vec2 c = vUv - 0.5;
          vec2 ca = c * vec2(uRes.x / uRes.y, 1.0);
          float ell = length(c * vec2(1.0, 1.15)) * 1.414;
          // inside the sea of clouds: everything but the nearest few metres melts into glowing
          // white, the cloud streaming past, outward from the middle of the frame, as she dives
          if (uCloudIn > 0.001) {
            float zc = linZ(texture2D(tDepth, vUv).r);
            float rr = length(ca);
            vec2 dd = ca / max(rr, 1e-3);
            float lr = log(rr + 0.04);
            float st = vn3(vec3(dd * 2.4, lr * 1.3 - uTime * 1.5)) * 0.6 + vn3(vec3(dd * 5.5 + 3.1, lr * 2.4 - uTime * 2.4)) * 0.4;
            st = mix(0.5, st, smoothstep(0.03, 0.2, rr));
            float k = 1.0 - exp(-zc * mix(0.01, 0.06, uCloudIn) * (0.7 + 0.6 * st));
            vec3 cw = uCloudCol * (0.9 + 0.13 * st);
            col = mix(col, cw, clamp(k * smoothstep(0.0, 0.4, uCloudIn) + uCloudIn * 0.1 * st, 0.0, 1.0));
          }
          // EverSwap-like atmospheric haze toward the frame edges
          col = mix(col, uEdgeTint, smoothstep(0.42, 1.05, ell) * uEdgeAmt);
          // gentle scrim behind centred text
          float sc = exp(-dot(ca * vec2(0.9, 1.6), ca * vec2(0.9, 1.6)) * 5.0);
          col = mix(col, col * 0.8 + uScrimCol * 0.07, sc * uScrim);
          // grade
          col = col * uGain + uLift * (1.0 - clamp(col, 0.0, 1.0));
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, uSat);
          // vibrance: the muted colours (greens in shade, the far slopes) gain the most, the
          // already rich ones (the deep blue overhead) hardly at all
          {
            float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
            float s = clamp((mx - mn) / max(mx, 1e-3), 0.0, 1.0);
            float l2 = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(l2), col, 1.0 + uVib * (1.0 - s) * (1.0 - s));
          }
          col = (col - 0.5) * uContrast + 0.5;
          // bloom
          #ifdef LOW_Q
            vec3 bloom = texture2D(tBloomA, vUv).rgb * 1.3;
          #else
            vec3 bloom = texture2D(tBloomA, vUv).rgb * uBloomW.x + texture2D(tBloomB, vUv).rgb * uBloomW.y;
          #endif
          col += bloom * uBloom;
          col *= 1.0 - smoothstep(0.55, 1.3, ell) * uVig;
          // (in a cloud: whitest round the edges of the frame, where it streams past - she, in
          // the middle, stays in sight)
          col = mix(col, uWhiteCol, uWhite * mix(0.7, 1.0, smoothstep(0.05, 0.62, length(ca))));
          // a burst of light (the flower blooming): brightest at the centre of the frame
          col += uFlashCol * uFlash * (1.0 - 0.45 * smoothstep(0.2, 1.1, ell));
          col = softClip(max(col, 0.0));
          col = mix(col, vec3(0.0), uFade);
          float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
          col += (g - 0.5) * uGrain;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    // Two resolutions: everything farther than splitD metres is drawn at half resolution
    // (it is hazy and softened by the lens anyway), then laid under the full-resolution
    // near layer, colour and depth, so near things stay crisp and the far scene costs a
    // quarter of the pixels. The far depth goes into the same depth buffer (a hair
    // closer), so a surface spanning both layers is never shaded twice up close.
    this.split = true;
    this.splitD = 50;
    this.farScale = 0.5;
    const farDepth = new THREE.DepthTexture(4, 4);
    farDepth.type = THREE.UnsignedIntType;
    this.farRT = new THREE.WebGLRenderTarget(4, 4, { type, samples: 0, depthBuffer: true, depthTexture: farDepth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.farCam = new THREE.PerspectiveCamera();
    this.mBlit = new THREE.ShaderMaterial({
      uniforms: { tFar: { value: this.farRT.texture }, tFarDepth: { value: farDepth }, uFN: { value: 50 }, uFF: { value: 9000 }, uN: { value: 0.12 }, uF: { value: 9000 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFar, tFarDepth; uniform float uFN, uFF, uN, uF;
        varying vec2 vUv;
        void main() {
          float df = texture2D(tFarDepth, vUv).r;
          // the far layer's distance, back into the main camera's depth, nudged closer
          float z = (uFN * uFF) / (uFF - df * (uFF - uFN));
          z *= 0.994;
          gl_FragDepth = df >= 0.999999 ? 1.0 : clamp((uF / (uF - uN)) * (1.0 - uN / z), 0.0, 1.0);
          gl_FragColor = vec4(texture2D(tFar, vUv).rgb, 1.0);
        }`,
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    });

    this.fsScene = new THREE.Scene();
    this.fs = fsMesh(this.mFinal);
    this.fsScene.add(this.fs);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.splitList = null;
    this._sph = new THREE.Sphere();
  }

  // Which layer each object is drawn in: 0 the far one only (the sky); 1 the near one only
  // (soft-edged effects, things without bounds); 2 both, each its own part (the big
  // surfaces: ground, mountains, water, the cloud sea); 3 whichever holds all of it (every
  // other object: drawn once, at half resolution only when wholly beyond the split)
  prepareSplit(scene, { far = [], surfaces = [] } = {}) {
    const F = new Set(far), S = new Set();
    surfaces.forEach((g) => g && g.traverse((o) => S.add(o)));
    const list = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      let kind;
      if (F.has(o) || o.userData.split === 'far') kind = 0;
      else if (S.has(o)) kind = 2;
      else if (o.userData.split === 'near' || (o.layers.mask & 2) || o.frustumCulled === false) kind = 1;
      else kind = 3;
      if (kind >= 2 && o.isMesh && !o.isInstancedMesh && o.geometry && !o.geometry.boundingBox) o.geometry.computeBoundingBox();
      list.push({ o, kind, v: true, beyond: false });
    });
    this.splitList = list;
  }
  // nearest distance from the camera to an object's bounds (0 if unknown or inside)
  nearDist(o, cam) {
    if (o.userData.nearDistFn) return o.userData.nearDistFn(cam.position);
    if (o.frustumCulled === false) return 0;
    // (big ground tiles: the distance to their box, not to a sphere around it - from high
    // up, a tile spread out below is far away even though its sphere would hold the camera)
    const g0 = o.geometry;
    if (!o.isInstancedMesh && g0 && g0.boundingBox && o.matrixWorld.elements[0] === 1 && o.matrixWorld.elements[5] === 1 && o.matrixWorld.elements[10] === 1) {
      const b = g0.boundingBox, e = o.matrixWorld.elements, p = cam.position;
      const dx = Math.max(b.min.x + e[12] - p.x, 0, p.x - b.max.x - e[12]);
      const dy = Math.max(b.min.y + e[13] - p.y, 0, p.y - b.max.y - e[13]);
      const dz = Math.max(b.min.z + e[14] - p.z, 0, p.z - b.max.z - e[14]);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    let s;
    if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); s = o.boundingSphere; }
    else { const g = o.geometry; if (!g) return 0; if (!g.boundingSphere) g.computeBoundingSphere(); s = g.boundingSphere; }
    if (!s) return 0;
    const w = this._sph.copy(s).applyMatrix4(o.matrixWorld);
    return Math.max(0, w.center.distanceTo(cam.position) - w.radius);
  }

  get uniforms() { return this.mFinal.uniforms; }

  // Effect tiers, the cheaper ones tried before the picture is made softer:
  // 0 everything (the far layer finer too); 1 no multisampling, the far layer at about one
  // pixel per CSS pixel; 2 also a lighter lens blur, one bloom level, the far layer at half.
  // (Multisampling is used up to one and a half pixels per CSS pixel - the common laptop
  // screens - where it visibly cleans the stair-steps off branches, stems and hair; at
  // higher densities the pixels themselves smooth the edges, and the samples are better
  // spent on resolution.)
  setTier(tier, dpr = this.dprNow || 1) {
    this.tier = tier;
    // (and not on very large pictures - a 5K screen drawn at 1.33x is 6.5 million pixels: four
    // samples each, in both layers, would be most of a gigabyte)
    const want = this.low || tier >= 1 || dpr > 1.6 || (this.pw || 0) * (this.ph || 0) > 5.2e6 ? 0 : 4;
    if (this.sceneRT.samples !== want) { this.sceneRT.samples = want; this.sceneRT.dispose(); }
    // (the distant layer too: mountain ridges and far treetops against the sky are the
    // longest, highest-contrast edges in the picture - unsmoothed they stair-step and crawl)
    if (this.farRT && this.farRT.samples !== want) { this.farRT.samples = want; this.farRT.dispose(); }
    this.mBlur.uniforms.uTaps.value = this.low || tier >= 2 ? 10 : 14;
    this.lean = this.low || tier >= 2;
    this.mFinal.uniforms.uBloomW.value.set(this.lean ? 1.3 : 0.85, this.lean ? 0 : 0.75);
  }

  setSize(pw, ph, dpr = 1, ow = pw, oh = ph) {
    this.pw = pw; this.ph = ph;
    this.dprNow = dpr;
    this.setTier(this.tier || 0, dpr);
    // the far layer: about one pixel per CSS pixel (at least half the near layer's, at most
    // all of it; coarser in the lightest tier)
    // (phones keep their own lighter far layer: about one pixel per CSS pixel, never more
    // than three quarters of the near layer)
    const ft = this.low ? -1 : this.tier;
    // (on a dense screen the distant scene - hazy hills, sky, mountains - at 1.6 pixels per CSS
    // pixel looks the same as at 2 and costs a third less)
    this.farScale = this.forceFar || (ft < 0 ? Math.min(0.75, Math.max(0.5, 1 / dpr)) : ft >= 2 ? Math.min(0.75, Math.max(0.5, 1 / dpr)) : ft >= 1 ? Math.min(1, Math.max(0.7, 1 / dpr)) : dpr >= 1.75 ? 0.8 : 1);
    // sharpen a little always, more when the scene is drawn below the screen's resolution
    // (phones draw below their very dense screens and leave the last stretch to the browser:
    // a firmer sharpening keeps petals, hair and lace crisp after it)
    const up = Math.max(1, ow / Math.max(1, pw));
    // (no sharpening: it made every blade and edge look brittle and harsh - a gentle
    // anti-aliasing instead, in the composite)
    this.mFinal.uniforms.uSharp.value = 0;
    this.sceneRT.setSize(pw, ph);
    const hw = Math.max(1, Math.round(pw / 2)), hh = Math.max(1, Math.round(ph / 2));
    const qw = Math.max(1, Math.round(pw / 4)), qh = Math.max(1, Math.round(ph / 4));
    const ew = Math.max(1, Math.round(pw / 8)), eh = Math.max(1, Math.round(ph / 8));
    this.half.setSize(hw, hh);
    this.q1.setSize(qw, qh); this.q2.setSize(qw, qh);
    this.e1.setSize(ew, eh); this.e2.setSize(ew, eh);
    this.mBlur.uniforms.uRes.value.set(pw, ph);
    this.mFinal.uniforms.uRes.value.set(pw, ph);
    this.mFinal.uniforms.uHalf.value.set(hw, hh);
    this.soft.uSceneRes.value.set(pw, ph);
    if (this.depthCopy) { this.depthCopy.setSize(pw, ph); this._dcInit = false; }
    this.farRT.setSize(Math.max(1, Math.round(pw * this.farScale)), Math.max(1, Math.round(ph * this.farScale)));
    this.mBright.uniforms.uTexel.value.set(1 / pw, 1 / ph);
    this.qTexel = new THREE.Vector2(1 / qw, 1 / qh);
    this.eTexel = new THREE.Vector2(1 / ew, 1 / eh);
  }

  // before the soft pass: the scene's depth so far, where the soft particles can read it
  softDepth() {
    if (!this.depthCopy || this.sceneRT.samples > 0) { this.soft.tSceneDepth.value = this.sceneRT.depthTexture; return; }
    // (only the clouds read it: while none are on screen, no copy of the depth each frame)
    if (this.needSoftDepth === false) return;
    const r = this.r;
    if (!this._dcInit) { r.setRenderTarget(this.depthCopy); this._dcInit = true; }
    r.copyTextureToTexture(this.sceneRT.depthTexture, this.depthCopy.depthTexture);
    r.setRenderTarget(this.sceneRT);
    this.soft.tSceneDepth.value = this.depthCopy.depthTexture;
  }

  pass(mat, target) {
    this.fs.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.fsScene, this.fsCam);
  }

  render(scene, camera) {
    const r = this.r;
    this.shared.uNear.value = camera.near; this.shared.uFar.value = camera.far;
    let info;
    const L = this.split ? this.splitList : null;
    if (L) {
      // --- far layer, half resolution, from splitD out ---
      const D = this.splitD, fc = this.farCam;
      camera.updateMatrixWorld();
      fc.position.copy(camera.position); fc.quaternion.copy(camera.quaternion);
      fc.fov = camera.fov; fc.aspect = camera.aspect; fc.zoom = camera.zoom;
      fc.near = D; fc.far = camera.far;
      fc.updateProjectionMatrix(); fc.updateMatrixWorld();
      fc.layers.set(0);
      for (const e of L) {
        e.v = e.o.visible;
        e.beyond = e.v && e.kind >= 2 ? this.nearDist(e.o, camera) > D : false;
        e.o.visible = e.v && (e.kind === 0 || e.kind === 2 || (e.kind === 3 && e.beyond));
      }
      r.setRenderTarget(this.farRT);
      r.render(scene, fc);
      info = { calls: r.info.render.calls, tris: r.info.render.triangles, pts: r.info.render.points };
      // --- the far layer laid down (colour and depth), then the near layer at full res ---
      const b = this.mBlit.uniforms;
      b.uFN.value = D; b.uFF.value = camera.far; b.uN.value = camera.near; b.uF.value = camera.far;
      this.fs.material = this.mBlit;
      r.setRenderTarget(this.sceneRT);
      r.render(this.fsScene, this.fsCam);
      for (const e of L) e.o.visible = e.v && e.kind !== 0 && !(e.kind >= 2 && e.beyond);
      const ac = r.autoClear;
      r.autoClear = false;
      if (this.softPass) {
        camera.layers.set(0);
        r.render(scene, camera);
        info.calls += r.info.render.calls; info.tris += r.info.render.triangles; info.pts += r.info.render.points;
        this.softDepth();
        camera.layers.set(1);
        r.render(scene, camera);
        camera.layers.set(0);
      } else {
        camera.layers.mask = 3;
        r.render(scene, camera);
      }
      r.autoClear = ac;
      info.calls += r.info.render.calls; info.tris += r.info.render.triangles; info.pts += r.info.render.points;
      for (const e of L) e.o.visible = e.v;
    } else if (this.softPass) {
      r.setRenderTarget(this.sceneRT);
      camera.layers.set(0);
      r.render(scene, camera);
      info = { calls: r.info.render.calls, tris: r.info.render.triangles, pts: r.info.render.points };
      const ac = r.autoClear;
      r.autoClear = false;
      this.softDepth();
      camera.layers.set(1);
      r.render(scene, camera);
      r.autoClear = ac;
      camera.layers.set(0);
      info.calls += r.info.render.calls; info.tris += r.info.render.triangles; info.pts += r.info.render.points;
    } else {
      r.setRenderTarget(this.sceneRT);
      camera.layers.mask = 3;
      r.render(scene, camera);
      info = { calls: r.info.render.calls, tris: r.info.render.triangles, pts: r.info.render.points };
    }
    const color = this.sceneRT.texture, depth = this.sceneRT.depthTexture;
    // lens blur (half res) - only when some part of the frame softens by more than the
    // composite's own small-radius blur covers (most of the journey is crisp: no pass at all)
    const sh = this.shared;
    const maxCoc = Math.max(sh.uEdge.value, sh.uDofMax.value * sh.uDof.value);
    this.blurOn = maxCoc > 1.9;
    this.mFinal.uniforms.uBlurOn.value = maxCoc > 0.5 ? 1 : 0;
    if (this.blurOn) {
      this.mBlur.uniforms.tColor.value = color;
      this.mBlur.uniforms.tDepth.value = depth;
      this.pass(this.mBlur, this.half);
    }
    // bloom
    this.mBright.uniforms.tColor.value = color;
    this.pass(this.mBright, this.q1);
    const g = this.mGauss.uniforms;
    g.tSrc.value = this.q1.texture; g.uDir.value.set(this.qTexel.x, 0); this.pass(this.mGauss, this.q2);
    g.tSrc.value = this.q2.texture; g.uDir.value.set(0, this.qTexel.y); this.pass(this.mGauss, this.q1);
    // (phones, or a struggling computer: the wide glow from the quarter-res one alone, two
    // passes fewer)
    if (!this.lean) {
      g.tSrc.value = this.q1.texture; g.uDir.value.set(this.eTexel.x * 1.4, 0); this.pass(this.mGauss, this.e1);
      g.tSrc.value = this.e1.texture; g.uDir.value.set(0, this.eTexel.y * 1.4); this.pass(this.mGauss, this.e2);
    }
    // composite
    const f = this.mFinal.uniforms;
    f.tColor.value = color; f.tDepth.value = depth; f.tBlur.value = this.half.texture;
    f.tBloomA.value = this.q1.texture; f.tBloomB.value = this.lean ? this.q1.texture : this.e2.texture;
    this.fs.material = this.mFinal;
    r.setRenderTarget(null);
    r.render(this.fsScene, this.fsCam);
    return info;
  }

  dispose() {
    [this.sceneRT, this.farRT, this.half, this.q1, this.q2, this.e1, this.e2, this.depthCopy].forEach((t) => t && t.dispose());
    [this.mBlur, this.mBright, this.mGauss, this.mFinal, this.mBlit].forEach((m) => m.dispose());
  }
}
