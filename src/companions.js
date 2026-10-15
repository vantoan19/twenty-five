// Little companions that gather around her once the garden blooms: butterflies
// circling her and fireflies drifting close, following as she walks on.
import * as THREE from 'three';
import { COMMON } from './shaders.js';
import { BOKEH_VERT } from './magic.js';
import { mulberry32, TAU } from './math.js';

// Positions are computed on the GPU around a smoothed centre that trails her.
export class Companions {
  constructor(U, { butterflies = 14, fireflies = 46, bokehU = null } = {}) {
    this.centre = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.inited = false;
    const shared = {
      uCentre: { value: new THREE.Vector3() },
      uFrom: { value: new THREE.Vector3() },
      uAppear: { value: 0 },
    };
    this.shared = shared;
    this.flies = this.buildButterflies(U, butterflies, shared);
    this.glow = this.buildFireflies(U, fireflies, shared, bokehU);
  }

  buildButterflies(U, n, shared) {
    const rnd = mulberry32(5150);
    const cols = ['#9ec5f0', '#c9a5e8', '#f6c08f', '#f5df7a', '#fff6ee', '#f2a7c0', '#b9d9f5', '#ffd1e0'];
    const base = new THREE.PlaneGeometry(2, 1, 2, 1);
    base.rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const ao = new Float32Array(n * 4), ap = new Float32Array(n * 4), acol = new Float32Array(n * 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // orbit radius, height, angular speed (signed), phase
      ao.set([0.55 + rnd() * 1.6, 0.35 + rnd() * 1.6, (0.45 + rnd() * 0.55) * (rnd() < 0.5 ? -1 : 1), rnd() * TAU], i * 4);
      // seed, size, appear delay, wobble
      ap.set([rnd(), 1.5 + rnd() * 0.8, rnd() * 0.7, 0.2 + rnd() * 0.35], i * 4);
      col.set(cols[i % cols.length]); acol.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(ao, 4));
    g.setAttribute('aPar', new THREE.InstancedBufferAttribute(ap, 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(acol, 3));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, ...shared, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aOrbit; attribute vec4 aPar; attribute vec3 aCol;
        uniform float uTime; uniform vec3 uCentre, uFrom; uniform float uAppear;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vA;
        void main() {
          float seed = aPar.x, sc = aPar.y, delay = aPar.z, wob = aPar.w;
          float r = aOrbit.x, hy = aOrbit.y, sp = aOrbit.z, ph = aOrbit.w;
          float t = uTime * sp + ph;
          // a loose, wandering orbit around her
          vec3 orbit = vec3(cos(t) * r + sin(t * 2.7 + seed * 9.0) * wob,
                            hy + sin(uTime * 1.3 + seed * 20.0) * 0.18 + sin(t * 3.1) * 0.08,
                            sin(t) * r * 0.85 + cos(t * 2.1 + seed * 5.0) * wob);
          // they rise out of the flower, then gather around her
          float k = smoothstep(delay, delay + 0.3, uAppear);
          vec3 start = uFrom + vec3(sin(seed * 31.0) * 0.3, 0.2 + seed * 0.3, cos(seed * 17.0) * 0.3);
          vec3 c = mix(start, uCentre + orbit, k * k * (3.0 - 2.0 * k));
          vec3 vel = vec3(-sin(t) * r * sp, 0.0, cos(t) * r * 0.85 * sp);
          float yaw = atan(vel.x, vel.z);
          float flap = (0.5 + 0.5 * sin(uTime * (13.0 + seed * 6.0) + seed * 60.0)) * 1.25 + 0.08;
          vec3 p = position * vec3(0.08, 1.0, 0.072) * sc;
          float side = sign(position.x + 1e-4);
          float ax = abs(p.x);
          p = vec3(side * ax * cos(flap), ax * sin(flap), p.z);
          p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
          vec3 w = c + p;
          vW = w; vUv = uv; vCol = aCol;
          vA = smoothstep(delay, delay + 0.08, uAppear);
          if (vA < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        uniform float uOpacity;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vA;
        void main() {
          vec2 q = vec2(abs(vUv.x - 0.5) * 2.0, 1.0 - vUv.y);
          float fore = length((q - vec2(0.55, 0.66)) * vec2(1.0, 1.25));
          float hind = length((q - vec2(0.45, 0.3)) * vec2(1.15, 1.4));
          float shape = min(fore - 0.42, hind - 0.32);
          if (shape > 0.0 || q.x < 0.04 || vA * uOpacity < 0.01) discard;
          vec3 col = vCol;
          col = mix(col, col * 0.6, smoothstep(-0.07, 0.0, shape));
          col = mix(col, vec3(1.0), smoothstep(0.07, 0.0, length(q - vec2(0.62, 0.72))) * 0.6);
          col *= mix(uShadowTint, uLightTint, 0.8) * 1.06;
          // a faint glow so they read at dusk
          col += vCol * uNight * 0.35;
          col = applyFogK(col, vW, 0.6);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    return { mesh, mat };
  }

  buildFireflies(U, n, shared, bokehU) {
    const rnd = mulberry32(6161);
    const bk = !!bokehU;
    const pos = new Float32Array(n * 3), par = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = 0.5 + Math.sqrt(rnd()) * 2.8;
      pos.set([Math.cos(a) * r, 0.2 + rnd() * 2.3, Math.sin(a) * r], i * 3);
      par.set([rnd(), rnd() * 0.8, 0.6 + rnd() * 0.8, rnd()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPar', new THREE.BufferAttribute(par, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uGold: U.uGold, uNight: U.uNight, ...shared, uOpacity: { value: 1 }, uScale: { value: 300 }, ...(bokehU || {}) },
      defines: { BOKEH: bk ? 1 : 0 },
      vertexShader: /* glsl */ `
        attribute vec4 aPar;
        uniform float uTime; uniform float uScale; uniform vec3 uCentre, uFrom; uniform float uAppear;
        varying float vA; varying float vE; varying float vB;
        ${bk ? BOKEH_VERT : ''}
        void main() {
          float seed = aPar.x, delay = aPar.y, sp = aPar.z;
          float t = uTime * (0.3 + seed * 0.35) * sp + seed * 40.0;
          vec3 drift = vec3(sin(t) * 0.7 + sin(t * 2.3) * 0.25, sin(t * 1.7) * 0.35, cos(t * 1.3) * 0.7);
          float k = smoothstep(delay, delay + 0.25, uAppear);
          vec3 p = mix(uFrom + position * 0.15, uCentre + position + drift, k);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float base = clamp(0.055 * uScale / max(-mv.z, 0.4), 1.5, 14.0);
          vE = 1.0; vB = 0.0;
          #if BOKEH
            gl_PointSize = min(bokehSize(gl_Position, -mv.z, base, vE, vB), 52.0);
          #else
            gl_PointSize = base;
          #endif
          vA = pow(0.5 + 0.5 * sin(uTime * (1.3 + seed * 2.2) + seed * 80.0), 2.0) * smoothstep(delay, delay + 0.1, uAppear);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uGold; uniform float uOpacity; uniform float uNight;
        varying float vA; varying float vE; varying float vB;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          float core = smoothstep(0.15, 0.0, d);
          vec3 tint = mix(uGold, vec3(0.86, 1.0, 0.62), 0.35);
          vec3 sharp = tint * a * 0.8 + vec3(1.0, 0.97, 0.82) * core;
          vec3 bok = mix(tint, vec3(1.0, 0.95, 0.8), 0.4) * smoothstep(0.5, 0.4, d) * 2.2 * min(vE * 2.0, 1.0);
          gl_FragColor = vec4(mix(sharp, bok, vB) * vA * uOpacity * (0.55 + 0.6 * uNight), 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 56;
    return { mesh, mat };
  }

  // centre: her body position this frame; appear: 0..1 over the bloom moment
  update(dt, target, from, appear, flyOpacity, glowOpacity) {
    if (!this.inited) { this.centre.copy(target); this.inited = true; }
    // a soft spring so the swarm lags a little behind her and swings as she turns
    const k = 1 - Math.exp(-dt * 2.2);
    this.centre.lerp(target, k);
    if (this.centre.distanceToSquared(target) > 400) this.centre.copy(target);
    this.shared.uCentre.value.copy(this.centre);
    this.shared.uFrom.value.copy(from);
    this.shared.uAppear.value = appear;
    this.flies.mat.uniforms.uOpacity.value = flyOpacity;
    this.flies.mesh.visible = appear > 0.001 && flyOpacity > 0.01;
    this.glow.mat.uniforms.uOpacity.value = glowOpacity;
    this.glow.mesh.visible = appear > 0.001 && glowOpacity > 0.01;
  }
}
