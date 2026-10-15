import * as THREE from 'three';
import { makeNoiseData, makeNoiseTexture } from './noisetex.js';
import { makeSharedUniforms, skyMaterial, toonMaterial } from './shaders.js';
import { Post } from './post.js';
import { JourneyPath } from './path.js';
import { heightAt, normalAt, WP, FLOWER, CAKE, CLEARING, CLOUD_TOP, CLOUD_BASE, GARDEN, SPIRES } from './world.js';

import { buildTerrain, buildIslands, buildWater, buildSplat } from './terrain.js';
import { buildMountains, SEA_PEAKS, heroHeight, HERO } from './mountains.js';
import { Companions } from './companions.js';
import { buildVegetation, buildArch, buildClouds, decorateIslands, buildMist } from './nature.js';
import { Character, contactShadow } from './character.js';
import { Cat, catButterfly } from './cat.js';
import { Dog } from './dog.js';
import {
  buildTrail, WingDust, TrailDust, WishBurst, buildMotes, buildFireflies, buildPassionStars, buildStarArc,
  buildHeroFlower, buildCake, buildFootprints, buildRippleSparkles, Points, buildSunRays,
} from './effects.js';
import { makeTracks, CHAPTERS, CHAPTER_JUMP, BEATS, HEADING_KEYS, FACE_KEYS, POSE, PEAK_LOOK } from './timeline.js';
import { buildStringLights, SkyLanterns, ShootingStars, addIslandWaterfalls, buildButterflies, buildPetals, bokehUniforms } from './magic.js';
import { applyEnv } from './env.js';
import { Music } from './audio.js';
import { BloomBurst, TreePetals } from './burst.js';
import { clamp, lerp, smoothstep, DEG, TAU } from './math.js';
import { Story } from './story.js';

// the light under the closed sea of clouds (soft, cool shade)
const OVERCAST = { light: new THREE.Color(0.84, 0.88, 0.96), shade: new THREE.Color(0.9, 0.93, 1.0), fog: new THREE.Color('#b4c0cc') };

THREE.ColorManagement.enabled = false;

const DEFAULTS = {
  hair: '#231b1e', skin: '#f3c9ad', dress: '#f7f2e7', glasses: true, trail: '#f3d9a4', motion: 'auto', quality: 'auto', voice: '',
};

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}
function cleanOpts(o) {
  const out = {};
  for (const k in o) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
  return out;
}

export class Journey {
  constructor({ root, canvas, options = {} }) {
    this.root = root;
    this.canvas = canvas;
    this.opts = { ...DEFAULTS, ...cleanOpts(options) };
    this.disposed = false;
    this.paused = false;
    this.mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.updateReduced();
    this.quality = this.opts.quality === 'auto'
      ? ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 600 ? 'low' : 'high')
      : this.opts.quality;
    this.music = new Music();
    this.wished = false;
    // the narrated story (its lines hold the journey back until they have been read)
    this.story = new Story(this);
    this.hbPlayed = false;
    this.frameCount = 0;
    this.v = { charPos: new THREE.Vector3(), cam: new THREE.Vector3(), look: new THREE.Vector3(), tmp: new THREE.Vector3(), flow: new THREE.Vector3(), comp: new THREE.Vector3() };
    try {
      this.initRenderer();
    } catch (e) {
      this.fail(e);
      return;
    }
    this.build();
    this.bind();
    this.resize();
    this.warming = true;
    this.warmAsync();
    this.tTarget = this.readScroll();
    this.t = this.tTarget;
    this.tv = 0;
    this.time = 0;
    this.clock = performance.now();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  updateReduced() {
    const m = this.opts.motion;
    this.reduced = m === 'reduced' || (m !== 'full' && !!(this.mq && this.mq.matches));
    if (this.root) this.root.dataset.reduced = this.reduced ? 'true' : 'false';
  }

  fail(e) {
    this.root.dataset.webgl = 'off';
    // eslint-disable-next-line no-console
    console.warn('Journey: WebGL unavailable', e);
    this.failed = true;
    this.bindScrollOnly();
  }

  initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
    });
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.setClearColor(0x9fc0e0, 1);
    this.renderer = r;
    this.post = new Post(r, this.quality);
    this.canvas.addEventListener('webglcontextlost', this.onLost = (e) => { e.preventDefault(); this.paused = true; this.root.dataset.webgl = 'lost'; });
    // the browser gives the context back (e.g. after a phone wakes up): three.js rebuilds
    // its GPU resources on the next frame, so simply carry on
    this.canvas.addEventListener('webglcontextrestored', this.onRestored = () => { delete this.root.dataset.webgl; this.paused = false; this.clock = performance.now(); });
  }

  build() {
    const q = this.quality;
    this.noise = makeNoiseData(256);
    const U = makeSharedUniforms(makeNoiseTexture(this.noise));
    // (no anisotropic filtering: the painted brushwork is broad enough that it made no visible
    // difference, and the noise is sampled a dozen times per pixel)
    if (typeof window !== 'undefined' && window.__bjAniso) U.uNoise.value.anisotropy = window.__bjAniso;
    this.U = U;
    U.uGold.value.set(this.opts.trail);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.12, 9000);
    this.tracks = makeTracks();
    this.path = new JourneyPath();
    const wp = {};
    for (const k in WP) wp[k] = this.path.sAtIndex(WP[k]);
    this.wpS = wp;
    const kneelPos = this.path.posAt(wp.flower);
    this.flowerYaw = Math.atan2(FLOWER.x - kneelPos.x, FLOWER.z - kneelPos.z);

    // sky
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 40, 24), skyMaterial(U, { low: q === 'low' }));
    {
      const su = this.sky.material.uniforms;
      const m = su.uMoonDir.value;
      const right = new THREE.Vector3().crossVectors(m, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, m).normalize();
      // the lit edge faces down-left, toward the last light of the sunset
      su.uMoonCut.value.copy(m).addScaledVector(right, 0.016).addScaledVector(up, 0.012).normalize();
    }
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.envExtra = { edge: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), lift: new THREE.Color(), gain: new THREE.Color(1, 1, 1), sat: 1, vib: 0, contrast: 1, bloom: 0.7 };

    // land
    this.splat = buildSplat(this.path, wp);
    this.terrain = buildTerrain(U, this.splat, q);
    this.scene.add(this.terrain.group);
    this.water = buildWater(U);
    this.scene.add(this.water.group);
    this.rig = { charPos: new THREE.Vector3(), cam: new THREE.Vector3(), look: new THREE.Vector3() };
    const camPts = [], clearPts = [];
    for (let t = 0; t <= 1.0001; t += 0.0015) {
      const R = this.rigAt(t, this.rig);
      camPts.push([R.cam.x, R.cam.y, R.cam.z, R.look.x, R.look.y, R.look.z, t]);
      clearPts.push([R.cam.x, R.cam.y, R.cam.z], [R.charPos.x, R.charPos.y, R.charPos.z]);
    }
    const tm0 = performance.now();
    this.mountains = buildMountains(U, q, clearPts);
    this.buildMs = { mountains: Math.round(performance.now() - tm0) };
    this.scene.add(this.mountains.group);
    this.clouds = buildClouds(U, SEA_PEAKS, q, { soft: this.post.softPass ? this.post.soft : null, peakMesh: this.mountains.sea, peakHeight: this.mountains.seaHeight, heroHeight, valleyHeight: this.mountains.valleyHeight, clearPts, noise: this.noise });
    this.scene.add(this.clouds.group);
    // (the clouds over the valley live on after the sea of clouds is gone from view)
    this.scene.add(this.clouds.valley.root);
    // (the peaks learn where the sea's surface is)
    {
      const mu = this.mountains.mat.uniforms, su = this.clouds.seaMat.uniforms;
      mu.uCeil = su.uCeil; mu.uCeilRect = su.uCeilRect; mu.uZCut = su.uZCut; mu.uHole = su.uHole;
    }
    this.veg = buildVegetation(U, this.path, wp, q, camPts);
    this.scene.add(this.veg.group);
    this.arch = buildArch(U, this.path, wp);
    this.scene.add(this.arch);
    const camBloom = this.rigAt(0.452, this.rig).cam;
    this.flower = buildHeroFlower(U, Math.atan2(camBloom.x - FLOWER.x, camBloom.z - FLOWER.z));
    this.scene.add(this.flower.group);
    this.scene.add(this.flower.sparkles.mesh);
    // golden sunbeams down onto her and her flower as it blooms
    this.sunRays = buildSunRays(U);
    this.scene.add(this.sunRays.group);
    this.candleCol = U.uPointCol.value.clone();
    this.islands = buildIslands(U);
    decorateIslands(U, this.islands);
    this.scene.add(this.islands.group);
    this.passion = buildPassionStars(U);
    this.scene.add(this.passion.group);
    this.cake = buildCake(U);
    this.cakeTop = this.cake.cakeTop;
    this.scene.add(this.cake.group);
    this.mist = buildMist(U);
    this.scene.add(this.mist.mesh);

    // her
    this.char = new Character(U, { hair: this.opts.hair, skin: this.opts.skin, dress: this.opts.dress, quality: q });
    this.char.setLook({ glasses: this.opts.glasses !== false && this.opts.glasses !== 'false' });
    this.scene.add(this.char.root);
    this.shadow = contactShadow(0.4, 1.25, 0.95);
    this.scene.add(this.shadow);
    // her cat: waits in the meadow under her approach (where the camera sees it as she
    // glides down), then runs after her to where she lands
    this.cat = new Cat(U, { quality: q });
    this.scene.add(this.cat.group);
    // and her little dog, waiting beside it
    this.dog = new Dog(U, { quality: q });
    this.scene.add(this.dog.group);
    // a little butterfly that comes to rest on her hand now and then
    this.herFly = catButterfly(U, '#ffd27a', 1.45);
    this.scene.add(this.herFly.mesh);
    {
      const td = this.path.posAt(wp.touchdown);
      const hd = this.path.headingAt(wp.touchdown, 2.2);
      const rr = { charPos: new THREE.Vector3(), cam: new THREE.Vector3(), look: new THREE.Vector3() };
      const R = this.rigAt(0.256, rr);
      const lx = Math.cos(hd), lz = -Math.sin(hd);
      const side = ((R.cam.x - td.x) * lx + (R.cam.z - td.z) * lz) >= 0 ? 1 : -1;
      const sw = this.rigAt(0.246, rr).s;
      const pw = this.path.posAt(sw), hw = this.path.headingAt(sw, 10);
      const x = pw.x - Math.cos(hw) * side * 1.2, z = pw.z + Math.sin(hw) * side * 1.2;
      this.catWait = { x, z };
      // (the dog sits a little further out, a step along)
      this.dogWait = { x: pw.x - Math.cos(hw) * side * 1.78 + Math.sin(hw) * 0.28, z: pw.z + Math.sin(hw) * side * 1.78 + Math.cos(hw) * 0.28 };
      this.catCtx = { t: 0, time: 0, her: new THREE.Vector3(), herYaw: 0, fly: 1, walk: 0, kneel: 0, cam: new THREE.Vector3(), wait: this.catWait, flower: new THREE.Vector3(FLOWER.x, heightAt(FLOWER.x, FLOWER.z) + 0.3, FLOWER.z), cake: new THREE.Vector3(CAKE.x, heightAt(CAKE.x, CAKE.z), CAKE.z), burstAge: -1, wishAge: -1, reduced: false, night: 0 };
      this.dogCtx = { ...this.catCtx, her: new THREE.Vector3(), cam: new THREE.Vector3(), wait: this.dogWait };
    }
    this._up = new THREE.Vector3(0, 1, 0);
    this._nrm = new THREE.Vector3();

    // light
    this.trail = buildTrail(U, this.path, this.path.length);
    this.scene.add(this.trail.mesh);
    // screen boxes (NDC) of the final words: the arc of stars dims behind them
    this.textMaskU = { uMaskA: { value: new THREE.Vector4(9, 9, 9, 9) }, uMaskB: { value: new THREE.Vector4(9, 9, 9, 9) }, uMaskK: { value: 0 } };
    this.arc = buildStarArc(U, this.textMaskU);
    this.scene.add(this.arc.mesh);
    this.scene.add(this.arc.stars.mesh);
    this.wingDust = new WingDust(U, this.noise);
    this.scene.add(this.wingDust.p.mesh);
    this.dust = new TrailDust(U);
    this.scene.add(this.dust.p.mesh);
    this.burst = new WishBurst(U);
    this.scene.add(this.burst.p.mesh);
    this.motes = buildMotes(U, q === 'low' ? 260 : 520);
    this.scene.add(this.motes.mesh);
    const bokehU = bokehUniforms(this.post);
    this.ffClearing = buildFireflies(U, CLEARING, 24, 90, 3.2, bokehU);
    this.scene.add(this.ffClearing.mesh);
    this.ffGarden = buildFireflies(U, { x: GARDEN.x - 4, z: GARDEN.z - 20 }, 30, 40, 2.2, bokehU);
    this.scene.add(this.ffGarden.mesh);

    this.foot = buildFootprints(U, this.path, wp.trailStart + 2, wp.cake - 1);
    this.scene.add(this.foot.mesh);
    this.rippleSp = buildRippleSparkles(U, FLOWER, q === 'low' ? 400 : 800);
    this.scene.add(this.rippleSp.mesh);
    // the explosion of light, petals and colour as the little flower opens
    this.bloomBurst = new BloomBurst(U, { quality: q, head: new THREE.Vector3(FLOWER.x, heightAt(FLOWER.x, FLOWER.z) + 0.78, FLOWER.z) });
    this.scene.add(this.bloomBurst.group);
    this.treePetals = new TreePetals(U, this.veg.blossomTrees, q);
    this.scene.add(this.treePetals.mesh);

    // living details & extra magic
    const pathPts = [];
    for (let ss = wp.summit; ss <= Math.min(this.path.length, wp.cake + 6); ss += 0.5) { const pp = this.path.posAt(ss); pathPts.push([pp.x, pp.z]); }
    const pathDist = (x, z) => pathPts.reduce((m, [px, pz]) => Math.min(m, Math.hypot(x - px, z - pz)), 1e9);
    this.lights = buildStringLights(U, CAKE, pathDist, toonMaterial(U, { color: '#5a463c', shade: '#3a2e30', rim: 0.25, fogScale: 0.5 }), bokehU);
    this.scene.add(this.lights.group);
    this.lanterns = new SkyLanterns(U, q === 'low' ? 16 : 26, bokehU);
    this.scene.add(this.lanterns.group);
    this.shooting = new ShootingStars(U, 5);
    this.scene.add(this.shooting.mesh);
    this.falls = addIslandWaterfalls(U, this.islands);
    this.butterflies = buildButterflies(U, this.path, wp);
    this.scene.add(this.butterflies.mesh);
    // butterflies and fireflies that gather around her once the garden blooms
    this.companions = new Companions(U, { butterflies: q === 'low' ? 10 : 16, fireflies: q === 'low' ? 30 : 48, bokehU });
    this.scene.add(this.companions.flies.mesh);
    this.scene.add(this.companions.glow.mesh);
    U.uBloomC.value.set(FLOWER.x, heightAt(FLOWER.x, FLOWER.z), FLOWER.z);
    this.flowerTop = new THREE.Vector3(FLOWER.x, heightAt(FLOWER.x, FLOWER.z) + 0.45, FLOWER.z);
    this.petals = buildPetals(U, q === 'low' ? 140 : 260);
    this.scene.add(this.petals.mesh);
    this.stepMotes = new Points(U, 360, { goldMix: 0.9, gravity: [0, 0.08, 0], wobble: 0.3, twinkle: 0.5, seed: 97, drag: 0.8 });
    this.scene.add(this.stepMotes.mesh);
    this.lastStep = -1;

    // which vegetation chunks can be seen at each moment of the journey (the
    // camera is a pure function of t, so this is known ahead of time)
    this.scene.updateMatrixWorld(true);
    this.buildPVS(this.veg.chunks);

    this.pointMats = [this.rippleSp.mat, this.dust.p.mat, this.wingDust.p.mat, this.burst.p.mat, this.passion.sparkles.mat, this.arc.stars.mat, this.flower.sparkles.mat, this.cake.smoke.mat, this.motes.mat, this.ffClearing.mat, this.ffGarden.mat,
      this.lights.mat, this.lanterns.glowMat, this.petals.mat, this.stepMotes.mat, this.companions.glow.mat, ...this.bloomBurst.pointMats, this.cat.puff.mat, this.cat.fly.mat];
    this.pose = {};
    // late transparent effects (clouds and everything drawn after them) go to the
    // second pass, which can soften the clouds against the depth of the first
    if (this.post.softPass) {
      this.scene.traverse((o) => {
        const m = o.material;
        if (!m || o.renderOrder < 10) return;
        if (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent) o.layers.set(1);
      });
    }
    // near things at full resolution, far ones at half (the sky is always far)
    // (the far massifs and the peaks of the cloud sea never come within the split: the
    // camera keeps 56 m and more from them while they are on screen)
    this.post.prepareSplit(this.scene, { far: [this.sky, this.mountains.far, this.mountains.sea, ...this.clouds.veils], surfaces: [this.terrain.group, this.mountains.group, this.water.group, this.clouds.sea, this.mountains.hero] });
    this.orderOpaque();
  }

  // Opaque things in an order that lets the depth test turn hidden pixels away before they
  // are shaded: the near ground, the mountains, the far ground, the water, then everything
  // else, and the sky last of all (it only fills what is left). (Without this the order
  // followed material creation: the sky - every pixel - and the big mountains were shaded
  // first and then painted over. Tested and dropped: every opaque thing near to far, and
  // the plants before the ground - no faster here.)
  orderOpaque() {
    const rank = (o) => {
      const m = o.material;
      if (!m || Array.isArray(m) || m.transparent || o.renderOrder !== 0) return null;
      const u = m.uniforms || {};
      // the near ground, then the mountains, then the far ground (mostly hidden behind both:
      // drawn last, its hidden parts are turned away before shading), then the water
      if (u.uSplatOn && u.uSplatOn.value > 0.5) return -30;
      if (u.uTreeLine) return -20;
      if (o.userData.farGround) return -15;
      if (u.uWaterD) return -10;
      return null;
    };
    this.terrain.far.traverse((o) => { o.userData.farGround = true; });
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      const r = rank(o);
      if (r !== null) o.renderOrder = r;
    });
    this.sky.renderOrder = 100;
  }

  // Every shader is compiled behind the loader, without freezing the page: the browser builds
  // them in the background (several at once where it can), and the loader stays up until
  // they are all ready - then one draw of every world uploads the buffers and textures.
  async warmAsync() {
    const r = this.renderer;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    try {
      // every program is started at once (the driver links them side by side where it can)
      const P = this.post;
      const mats = r.compile(this.scene, this.camera);
      const keep = P.fs.material;
      for (const m of [P.mBlit, P.mBlur, P.mBright, P.mGauss, P.mFinal]) {
        if (!m) continue;
        P.fs.material = m;
        r.compile(P.fsScene, P.fsCam).forEach((x) => mats.add(x));
      }
      P.fs.material = keep;
      // then waited on one by one: polled where the browser can say "not yet" without
      // stopping; elsewhere each wait is short and the page gets a breath between them
      const gl = r.getContext();
      const par = gl.getExtension('KHR_parallel_shader_compile');
      const t0 = performance.now();
      for (const m of mats) {
        const prog = r.properties.get(m).currentProgram;
        if (!prog || !prog.program) continue;
        if (par) {
          while (!gl.getProgramParameter(prog.program, par.COMPLETION_STATUS_KHR) && performance.now() - t0 < 20000) await sleep(8);
        } else {
          gl.getProgramParameter(prog.program, gl.LINK_STATUS);
          await sleep(0);
        }
        if (this.disposed) return;
      }
    } catch (e) { /* compiled as the first frames come instead */ }
    if (this.disposed) return;
    try { this.warm(); } catch (e) { /* only the first-use hitches come back */ }
    this.warming = false;
    this.clock = performance.now();
  }

  // Draw every world once behind the loader, into a single pixel: every shader is compiled
  // and every buffer and texture uploaded now, so scrolling into a new world never stalls
  // (each first use is a visible hitch on a phone)
  warm() {
    const r = this.renderer, cam = this.camera, rt = this.post.sceneRT;
    // (soft particles read a depth texture that is not the one being drawn into)
    const sd = this.post.soft.tSceneDepth.value;
    if (this.post.depthCopy) this.post.soft.tSceneDepth.value = this.post.depthCopy.depthTexture;
    const saved = [];
    this.scene.traverse((o) => { saved.push(o, o.visible, o.frustumCulled); o.visible = true; o.frustumCulled = false; });
    const mask = cam.layers.mask;
    cam.layers.enableAll();
    // (both layers' targets: their formats differ on desktops, where the near one is MSAA)
    for (const t of this.quality === 'low' ? [rt] : [rt, this.post.farRT]) {
      const vp = t.viewport.clone(), sc = t.scissor.clone(), st = t.scissorTest;
      t.viewport.set(0, 0, 1, 1); t.scissor.set(0, 0, 1, 1); t.scissorTest = true;
      try {
        r.setRenderTarget(t);
        r.render(this.scene, cam);
      } catch (e) { /* a failed warm-up only costs the hitches back */ }
      t.viewport.copy(vp); t.scissor.copy(sc); t.scissorTest = st;
    }
    r.setRenderTarget(null);
    this.post.soft.tSceneDepth.value = sd;
    cam.layers.mask = mask;
    for (let i = 0; i < saved.length; i += 3) { saved[i].visible = saved[i + 1]; saved[i].frustumCulled = saved[i + 2]; }
  }

  // How far the bloom (or her walk) had reached a quarter, half, three quarters and a
  // whole growing time `d` ago, from a short history of where it was; never past where it
  // is now, so walking back leaves the flowers behind her grown
  growTrack(name, K, d) {
    const gh = this.growHist || (this.growHist = {});
    const h = gh[name] || (gh[name] = { t: [], k: [], o: { k: 0, a: 0, b: 0, c: 0, d: 0 } });
    const now = this.time;
    const settle = this.growSettle || (typeof window !== 'undefined' && window.__bjSettle);
    if (settle || (h.t.length && now < h.t[h.t.length - 1])) { h.t.length = 0; h.k.length = 0; }
    h.t.push(now); h.k.push(K);
    while (h.t.length > 2 && h.t[1] <= now - d) { h.t.shift(); h.k.shift(); }
    const T = h.t, KK = h.k;
    const at = (tt) => {
      if (tt <= T[0]) return KK[0];
      for (let i = 0; i < T.length - 1; i++) {
        if (T[i + 1] >= tt) return KK[i] + (KK[i + 1] - KK[i]) * ((tt - T[i]) / Math.max(T[i + 1] - T[i], 1e-6));
      }
      return KK[KK.length - 1];
    };
    const o = h.o;
    o.k = K;
    o.a = Math.min(at(now - d * 0.25), K);
    o.b = Math.min(at(now - d * 0.5), o.a);
    o.c = Math.min(at(now - d * 0.75), o.b);
    o.d = Math.min(at(now - d), o.c);
    return o;
  }

  buildPVS(chunks) {
    const NT = 480;
    const rig = { charPos: new THREE.Vector3(), cam: new THREE.Vector3(), look: new THREE.Vector3() };
    const cams = [];
    for (let i = 0; i < NT; i++) {
      const R = this.rigAt(i / (NT - 1), rig);
      const f = R.look.clone().sub(R.cam).normalize();
      const tf = Math.tan((R.fov * DEG) / 2);
      // widest the view can get: ultra-wide screens, and tall phones (vertical fov widens)
      const half = Math.max(Math.atan(tf * 2.4), Math.atan(tf * 1.8)) + 7 * DEG;
      cams.push({ x: R.cam.x, y: R.cam.y, z: R.cam.z, fx: f.x, fy: f.y, fz: f.z, half });
    }
    const c = new THREE.Vector3();
    for (const m of chunks) {
      if (!m.boundingSphere) m.computeBoundingSphere();
      c.copy(m.boundingSphere.center).applyMatrix4(m.matrixWorld);
      const r = m.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis();
      const maxD = m.userData.maxDist ?? 1e9;
      const vis = new Uint8Array(NT);
      for (let i = 0; i < NT; i++) {
        const k = cams[i];
        const dx = c.x - k.x, dy = c.y - k.y, dz = c.z - k.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d - r > maxD) continue;
        if (d <= r) { vis[i] = 1; continue; }
        const ang = Math.acos(clamp((dx * k.fx + dy * k.fy + dz * k.fz) / d, -1, 1));
        if (ang - Math.asin(Math.min(1, r / d)) <= k.half) vis[i] = 1;
      }
      const dil = new Uint8Array(NT);
      for (let i = 0; i < NT; i++) if (vis[i]) for (let o = -3; o <= 3; o++) { const q = i + o; if (q >= 0 && q < NT) dil[q] = 1; }
      m.userData.pvs = dil;
    }
    this.pvsN = NT;
  }

  // -------------------------------------------------------------------------
  bind() {
    this.onScroll = () => {
      const v = this.readScroll();
      // (the story only moves forward: scrolled back, the page returns to where it is)
      if (v < this.t - 0.0006 && !this.travel) {
        const r = this.root, max = r.scrollHeight - r.clientHeight;
        if (max > 0) r.scrollTop = this.t * max;
        this.tTarget = Math.max(this.tTarget, this.t);
        return;
      }
      this.tTarget = Math.max(v, this.t);
      this.lastInput = performance.now();
    };
    this.root.addEventListener('scroll', this.onScroll, { passive: true });
    // (the opening counts as a moment of attention: drawn at the full rate - which also lets
    // the quality ladder settle during the title, before the first scroll)
    this.lastInput = performance.now();
    this.onResize = () => this.resize();
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(this.canvas);
    }
    window.addEventListener('resize', this.onResize);
    this.onVis = () => { this.paused = document.hidden; this.clock = performance.now(); if (!document.hidden) this.lastInput = this.clock; };
    document.addEventListener('visibilitychange', this.onVis);
    if (window.IntersectionObserver) {
      this.io = new IntersectionObserver((ents) => {
        const e = ents[0];
        this.offscreen = e && !e.isIntersecting;
        this.clock = performance.now();
      });
      this.io.observe(this.root);
    }
    if (this.mq && this.mq.addEventListener) {
      this.onMq = () => this.updateReduced();
      this.mq.addEventListener('change', this.onMq);
    }
  }
  bindScrollOnly() {
    this.onScroll = () => { this.tTarget = this.readScroll(); this.t = this.tTarget; this.updateUI(); };
    this.root.addEventListener('scroll', this.onScroll, { passive: true });
    this.tTarget = this.t = this.readScroll();
    this.time = 0;
    this.queryDom();
    this.updateUI();
  }
  readScroll() {
    const r = this.root;
    const max = r.scrollHeight - r.clientHeight;
    return max > 0 ? clamp(r.scrollTop / max, 0, 1) : 0;
  }
  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth || this.root.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight || this.root.clientHeight);
    // The picture goes to the screen at the screen's own resolution (up to 2x; 2.5x on
    // phones): the final composite, its sharpening and the grain are always crisp. The 3D
    // scene is drawn at this.dpr, which adapt() settles on what the device holds; when that
    // is lower, the composite upscales it with sharpening (no blurry browser stretch).
    const dev = window.devicePixelRatio || 1;
    const lo = this.quality === 'low';
    this.maxDpr = this.forceOutDpr || Math.min(dev, lo ? 2.5 : 2);
    // (a computer starts as sharp as it sensibly can: the full 2x on most laptop screens, on
    // very large ones about 6.5 million pixels to begin with - the quality ladder climbs to
    // the screen's full density within a few seconds when frames come fast, and steps down
    // only if it must)
    const startDpr = lo ? 1.75 : Math.max(1.25, Math.min(2, Math.sqrt(6.5e6 / Math.max(1, w * h))));
    if (this.dpr === undefined) this.dpr = Math.min(this.maxDpr, startDpr);
    this.dpr = Math.min(this.dpr, this.maxDpr);
    // (phones keep the canvas at the scene's own resolution: on their dense screens a
    // separate upscale would cost more than it shows)
    this.outDpr = lo && !this.forceOutDpr ? this.dpr : this.maxDpr;
    this.renderer.setPixelRatio(this.outDpr);
    this.renderer.setSize(w, h, false);
    const pw = Math.round(w * this.dpr), ph = Math.round(h * this.dpr);
    this.post.setSize(pw, ph, this.dpr, Math.round(w * this.outDpr), Math.round(h * this.outDpr));
    this.camera.aspect = w / h;
    this.w = w; this.h = h;
    this.lastFov = -1;
    this.measureUI();
  }

  // -------------------------------------------------------------------------
  frame(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    // (the shaders are still being built behind the loader; then the first frame is being
    // finished - nothing more is queued until it is)
    if (this.warming || (this.readyFence && !this.pollReady())) { this.clock = now; return; }
    // Pace the drawing: on 120-144 Hz screens every other refresh is plenty; and while
    // nothing is moving (no scrolling, no bloom or wish playing out) a calm 30 frames a
    // second keeps a phone cool, so it does not slow itself down later. (A computer keeps
    // the full rate for a while longer while she is being read - the grass, butterflies and
    // her hair stay silky - and only settles to the calm pace when left alone.)
    const since = now - this.clock;
    if (since < 10.5) return;
    const calmAfter = this.quality === 'low' ? 2500 : 15000;
    const busy = now - (this.lastInput || 0) < calmAfter || Math.abs(this.tTarget - this.t) > 1e-4
      || (this.bloomBurst && this.bloomBurst.fired && this.bloomBurst.tau < 10)
      || (this.wished && this.time - this.wishTime < 16) || (this.cat && this.cat.active) || (this.dog && this.dog.active);
    if (!busy && since < 31) return;
    this.idle = !busy;
    const dt = clamp(since / 1000, 0, 0.2);
    this.clock = now;
    if (this.paused || this.offscreen) return;
    this.time += dt;
    this.frameCount++;
    this.stepT(dt);
    this.update(dt);
    this.render();
    this.adapt(dt);
    if (!this.root.dataset.ready) this.markReady();
  }
  // The loader lifts once the GPU has actually finished the first frame (not merely been
  // handed it): the last of the shader work then happens behind it, never as a stutter
  // in the first seconds of the story. (A fence, polled each frame - nothing waits on it.)
  markReady() {
    if (this.readyFence !== undefined) return;
    const gl = this.renderer.getContext();
    this.readyFence = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    this.readyT0 = performance.now();
    if (this.readyFence) gl.flush();
    else this.pollReady();
  }
  pollReady() {
    const gl = this.renderer.getContext();
    const f = this.readyFence;
    if (f && gl.getSyncParameter(f, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() - this.readyT0 < 15000) return false;
    if (f) gl.deleteSync(f);
    this.readyFence = null;
    this.readyFrame = this.frameCount;
    this.lastInput = performance.now();
    this.root.dataset.ready = '1';
    return true;
  }
  // The story's moments (she pets her cat and her dog; she rests on the mountain path): is one
  // on now - and how far into it (0..1, eased in and out; 'early': from as the journey slows
  // into it)
  momentOn(id) {
    const M = this.story && this.story.moments.find((m) => m.id === id);
    return !!M && M.at !== undefined && M.at > -1e8 && this.time < M.at + M.dur;
  }
  momentW(id, early = false) {
    const M = this.story && this.story.moments.find((m) => m.id === id);
    if (!M) return 0;
    const t = this.t, time = this.time;
    const past = 1 - smoothstep(M.t + 0.004, M.t + 0.012, t);
    if (M.at === undefined) return early ? smoothstep(M.t - 0.005, M.t, t) * past : 0;
    if (M.at < -1e8) return 0;
    const inW = early ? 1 : smoothstep(M.at, M.at + 1.6, time);
    const outW = 1 - smoothstep(M.at + M.dur - 1.2, M.at + M.dur + 0.6, time);
    return inW * outW * past;
  }
  // How fast the story may move (timeline per second): an unhurried walk at most - the whole
  // journey takes at least ~35 s however hard the page is flung (~45 s with its pauses) -
  // slower while a line of the story is up on screen, and slower again through the big
  // moments (the landing, the arch, the bloom, the summit, the cake)
  speedCap(t) {
    let line = 0;
    for (const [, a, b] of BEATS) line = Math.max(line, smoothstep(a, a + 0.015, t) * (1 - smoothstep(b - 0.015, b, t)));
    const pl = (a, b) => smoothstep(a - 0.01, a + 0.005, t) * (1 - smoothstep(b - 0.005, b + 0.01, t));
    const big = Math.max(pl(0.245, 0.275), pl(0.335, 0.385), pl(0.44, 0.47), pl(0.736, 0.778), pl(0.84, 0.875));
    // (and a little more slowly through the flight among the peaks: more ground per step;
    // slower still through the cloud over the valley)
    // (and slower still as she plunges through the sea of clouds: a breath inside the white)
    const fl = 0.2 * pl(0.012, 0.226) + 0.35 * pl(0.183, 0.197);
    // (up the mountain path, half the pace at most: the climb is slow and deliberate)
    const hill = pl(0.53, 0.738);
    return (1 / 34) * (1 - 0.35 * line) * (1 - 0.3 * big) * (1 - fl) * (1 - 0.5 * hill);
  }
  // where the closing words sit on screen (normalised device coordinates, a little margin
  // around them), so the arc of stars can pass behind them without speckling the letters
  updateTextMask(t) {
    const M = this.textMaskU;
    if (t < 0.9 || !this.root) { M.uMaskK.value = 0; return; }
    M.uMaskK.value = 0.82 * smoothstep(0.92, 0.95, t);
    // (the words only move while they fade in or settle: a layout read every third frame)
    if (this.frameCount % 3 && this._maskT !== undefined) return;
    this._maskT = t;
    if (!this._wishBtn || !this._wishBtn.isConnected) this._wishBtn = this.root.querySelector('.bj-wish-btn');
    this._maskEls = [this.story.captionEl(), this._wishBtn];
    const cr = this.canvas.getBoundingClientRect();
    if (cr.width < 1 || cr.height < 1) { M.uMaskK.value = 0; return; }
    const pad = 14;
    const box = (el, v, on) => {
      if (!el || !on) { v.set(9, 9, 9, 9); return; }
      const r = el.getBoundingClientRect();
      if (r.width < 1) { v.set(9, 9, 9, 9); return; }
      v.set(((r.left - pad - cr.left) / cr.width) * 2 - 1, 1 - ((r.bottom + pad - cr.top) / cr.height) * 2,
        ((r.right + pad - cr.left) / cr.width) * 2 - 1, 1 - ((r.top - pad - cr.top) / cr.height) * 2);
    };
    box(this._maskEls[0], M.uMaskA.value, true);
    box(this._maskEls[1], M.uMaskB.value, !this.wished && this.root.dataset.wish === 'ready');
  }
  stepT(dt) {
    const target = this.tTarget;
    if (this.jumpTo !== undefined) { this.t = this.jumpTo; this.tv = 0; this.jumpTo = undefined; return; }
    // (a chapter jump from the dots travels freely; scrolling keeps to the speed limit - and
    // to the story: a line being read holds the next one back, a moment holds the journey)
    const g = this.story.gate(this.t, this.time);
    const capG = Math.min(this.speedCap(this.t), g.cap);
    // (eased, so the journey never lurches from one pace to the next)
    this.capS = this.capS === undefined ? capG : capG < this.capS ? Math.max(capG, this.capS * Math.exp(-dt * 5)) : this.capS + (capG - this.capS) * (1 - Math.exp(-dt * 2.5));
    const cap = this.travel ? 1 : this.capS;
    if (this.reduced) {
      this.t += clamp((target - this.t) * (1 - Math.exp(-dt * 10)), -cap * dt, cap * dt);
      this.tv = 0;
    } else {
      const w = Math.abs(target - this.t) > 0.05 ? 2.4 : 4.6;
      const a = w * w * (target - this.t) - 2 * w * this.tv;
      this.tv = clamp(this.tv + a * dt, -cap, cap);
      this.t += this.tv * dt;
    }
    this.t = clamp(this.t, 0, 1);
    if (!this.travel && this.t > g.t) { this.t = g.t; this.tv = Math.min(this.tv, 0); }
    // (the journey waiting on the story, however far the page has been scrolled)
    this.held = !this.travel && this.t >= g.t - 1e-6 && target > this.t + 1e-5;
    if (this.travel && Math.abs(target - this.t) < 0.003) this.travel = false;
    if (!this.travel) this.governScroll();
  }
  // The page itself can't run far ahead of the story: scrolled faster than the speed limit,
  // it is held a little ahead (about two and a half seconds of travel, a screen or so), so
  // letting go never leaves a long stretch to catch up on - it just glides on and stops
  governScroll() {
    const L = Math.max(0.045, this.speedCap(this.t) * 2.5);
    const lead = this.tTarget - this.t;
    if (Math.abs(lead) <= L) return;
    const r = this.root, max = r.scrollHeight - r.clientHeight;
    if (max <= 0) return;
    const nt = clamp(this.t + Math.sign(lead) * L, 0, 1);
    this.tTarget = nt;
    r.scrollTop = nt * max;
  }
  adapt(dt) {
    // Adaptive quality: the sharpest picture the device holds smoothly. Every second or so
    // it looks at the frames: if many came late (a refresh or more behind), it makes things
    // lighter - first the costly effects (multisampling; then a lighter blur and bloom and a
    // coarser far layer), only then the resolution; if they all came on time for a while,
    // it goes back up the same ladder (resolution first). A one-off hitch (a tab switch, a
    // pause while something loads) is ignored, and a step that proved too slow is not
    // retried for a minute, so it never see-saws.
    // (idle frames are slow on purpose: they say nothing about what the device can do)
    if (this.idle) { this.ftWin = null; return; }
    // (the first second or so is loading: shaders, textures, fonts - not a measure of the GPU)
    if (this.readyFrame === undefined || this.frameCount - this.readyFrame < 45 || dt <= 0 || this.adaptOff) return;
    if (dt > 0.12) return;
    const win = this.ftWin || (this.ftWin = []);
    win.push(dt);
    const early = (this.adaptN || 0) < 4;
    if (win.length < (early ? 20 : 50)) return;
    this.ftWin = null;
    this.adaptN = (this.adaptN || 0) + 1;
    const srt = win.slice().sort((x, y) => x - y);
    // the frame interval when on time (frames come in whole screen refreshes)
    const vs = Math.max(1 / 250, srt[Math.floor(srt.length * 0.1)]);
    const late = win.filter((x) => x > vs * 1.45).length / win.length;
    const med = srt[srt.length >> 1];
    const lo = this.quality === 'low';
    const P = this.post;
    const dprMax = this.maxDpr || 1;
    // (on a computer, never below one pixel per CSS pixel unless it truly struggles)
    const floor = Math.min(dprMax, lo ? 1.25 : 1.0);
    const dprMin = Math.min(dprMax, lo ? 1.0 : 0.7);
    const now = this.time;
    const ceil = this.qCeil && now < this.qCeil.until ? this.qCeil : null;
    const blocked = (nd, nt) => !!ceil && nd >= ceil.dpr - 1e-3 && nt <= ceil.tier;
    let d = this.dpr, tier = lo ? 2 : (P.tier || 0);
    // (one bad window might be a burst of hitches - scrolling into somewhere new: it takes
    // two in a row, unless most frames are two or more refreshes late)
    // (and the aim is sixty frames a second at least: on a 120 or 144 Hz screen frames that
    // are all evenly slow - every third refresh, 40-48 a second - look "on time" to the late
    // count, so the typical frame itself must come within about 20 ms)
    const bad = late > 0.25 || med > 1 / 49;
    const hard = med > 1 / 26;
    this.badRuns = bad ? (this.badRuns || 0) + 1 : 0;
    if (bad && (hard || this.badRuns >= 2)) {
      // too slow: one step down the ladder
      this.badRuns = 0;
      if (tier < 2) tier++;
      else if (d > floor + 0.01) d = Math.max(floor, d - (hard ? Math.max(0.25, d * 0.2) : 0.15));
      else if (hard) d = Math.max(dprMin, d - 0.15);
      this.qCeil = { dpr: this.dpr, tier: lo ? 2 : (P.tier || 0), until: now + 60 };
      this.goodRuns = 0;
    } else if (bad) {
      this.goodRuns = 0;
    } else if (late < 0.06) {
      this.goodRuns = (this.goodRuns || 0) + 1;
      const fast = early && !this.qCeil;
      if (this.goodRuns >= (fast ? 1 : 3)) {
        this.goodRuns = 0;
        if (d < dprMax - 0.01) {
          const nd = Math.min(dprMax, d + (fast ? 0.25 : 0.1));
          if (!blocked(nd, tier)) d = nd;
        } else if (!lo && tier > 0) {
          if (!blocked(d, tier - 1)) tier--;
        }
      }
    } else this.goodRuns = 0;
    const tierChanged = !lo && tier !== (P.tier || 0);
    if (tierChanged) P.setTier(tier, d);
    if (Math.abs(d - this.dpr) > 0.01 || tierChanged) { this.dpr = d; this.resize(); }
  }

  sampleAngleKeys(keys, t, resolve) {
    if (t <= keys[0][0]) return { w: keys[0][1], yaw: resolve(keys[0][2]) };
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t <= b[0]) {
        const u = smoothstep(a[0], b[0], t);
        const ya = resolve(a[2]), yb = resolve(b[2]);
        // keep the angle from the side that has weight
        const yaw = a[1] < 0.01 ? yb : b[1] < 0.01 ? ya : lerpAngle(ya, yb, u);
        return { w: lerp(a[1], b[1], u), yaw };
      }
    }
    const l = keys[keys.length - 1];
    return { w: l[1], yaw: resolve(l[2]) };
  }

  // She notices her cat: between the story's own moments (on the grass after landing,
  // on the walks, whenever she stops), when it is close and in front of her she glances
  // down at it with a fond smile, her eyes following it as it plays
  lookAtCat(P, pos, yaw, t, dt) {
    let cat = this.cat;
    const L = this.catLook || (this.catLook = { w: 0, on: false, timer: 1.5, gx: 0, gy: 0 });
    P.fond = 0; P.gazeK = 0; P.clap = 0;
    if (!cat || dt <= 0) return;
    // (her dog showing off one of its tricks in front of her takes her eye instead, unless
    // the cat is up to something itself)
    const DA = this.dog && this.dog.A;
    const dogShow = DA && this.dog.group.visible && (DA.idle === 'spin' || DA.idle === 'dance' || DA.idle === 'bow' || DA.idle === 'roll') && !cat.A.idle;
    if (dogShow) { cat = this.dog; if (L.pet !== 'dog') { L.pet = 'dog'; L.on = true; L.timer = 2.2; } } else L.pet = 'cat';
    const A = cat.A;
    // (she laughs when it leaps back startled from the bursting flower)
    if ((A.startle || 0) > 0.3 && A.startleK > 0.5) P.laugh = Math.max(P.laugh || 0, 0.8 * A.startle);
    const free = P.fly < 0.05 && P.kneel < 0.02 && !this.reduced
      && ((t > 0.258 && t < 0.334) || (t > 0.506 && t < 0.732) || (t > 0.79 && t < 0.842)
        || (t > 0.846 && !this.wished && A.idle === 'leap'));
    const dx = A.x - pos.x, dz = A.z - pos.z, d = Math.hypot(dx, dz);
    const rel = ((Math.atan2(dx, dz) - yaw + Math.PI * 3) % TAU) - Math.PI;
    const can = free && cat.group.visible && d < 3 && Math.abs(rel) < 1.5;
    // looking for a while, then looking about, and back
    const sitting = A.mode === 'near' && A.sit > 0.5, playing = A.mode === 'greet' || A.mode === 'lap' || A.mode === 'weave';
    L.timer -= dt;
    if (L.timer <= 0) {
      L.on = !L.on;
      const r = Math.random();
      L.timer = L.on ? (sitting ? 3 + r * 1.5 : playing ? 2.2 + r : 1.1 + r * 0.6) : (sitting ? 1.8 + r * 1.2 : playing ? 1.0 + r : 4.5 + r * 3);
    }
    // (when it stands up to her she can't look anywhere else)
    if ((A.stand || 0) > 0.2) { L.on = true; L.timer = Math.max(L.timer, 1.2); }
    const goal = can && L.on ? 1 : 0;
    L.w += (goal - L.w) * (1 - Math.exp(-dt * (goal > L.w ? 3.2 : 2.4)));
    if (L.w < 0.003) return;
    const w = L.w;
    // the cat's face, from her eyes
    const down = Math.atan2(1.33 - lerp(0.38 * A.sit + 0.3 * (1 - A.sit), 0.52, A.stand || 0), Math.max(d, 0.3));
    const hy = clamp(rel, -0.9, 0.9) * 0.6, hp = clamp(down, 0, 1.0) * 0.5;
    P.headYaw += hy * w;
    P.headPitch += hp * w;
    P.headRoll += clamp(-rel, -0.5, 0.5) * 0.12 * w;
    // her eyes do the rest
    L.gx += (clamp((rel - hy) * 1.6, -1, 1) - L.gx) * (1 - Math.exp(-dt * 10));
    L.gy += (clamp(-(down - hp) * 1.4, -1, 0.2) - L.gy) * (1 - Math.exp(-dt * 10));
    P.gazeX = L.gx; P.gazeY = L.gy; P.gazeK = w;
    P.fond = 0.75 * w;
    // a little giggle when it rubs against her
    if (A.mode === 'weave') P.laugh = Math.max(P.laugh, 0.85 * w * smoothstep(0.3, 0.7, A.mt) * (1 - smoothstep(1.6, 2.3, A.mt)));
    // she laughs and claps when it pounces, smiles at a stretch or a yawn
    if (A.idle === 'pounce') {
      const f = this.time - A.g0;
      P.laugh = Math.max(P.laugh || 0, 0.9 * w * smoothstep(1.7, 1.9, f) * (1 - smoothstep(3.0, 3.5, f)));
      P.clap = Math.max(P.clap || 0, w * smoothstep(2.0, 2.15, f) * (1 - smoothstep(2.85, 3.05, f)));
    } else if (A.idle === 'leap') {
      // ("oh!" as it springs up after the butterfly, then a laugh and a clap)
      const f = this.time - A.g0;
      if (f > 2.6 && f < 2.65 && (this.ohT === undefined || this.time - this.ohT > 2)) this.ohT = this.time;
      P.laugh = Math.max(P.laugh || 0, 0.9 * w * smoothstep(3.2, 3.4, f) * (1 - smoothstep(4.3, 4.7, f)));
      P.clap = Math.max(P.clap || 0, w * smoothstep(3.45, 3.6, f) * (1 - smoothstep(4.2, 4.4, f)));
    } else if (A.idle === 'stretch' || A.idle === 'yawn' || A.idle === 'loaf' || A.idle === 'bow') P.fond = Math.max(P.fond, w);
    else if (A.idle === 'spin') {
      // (the dog chasing its tail: she laughs)
      const f = this.time - A.g0;
      P.laugh = Math.max(P.laugh || 0, 0.85 * w * smoothstep(0.3, 0.6, f) * (1 - smoothstep(1.6, 2.1, f)));
    } else if (A.idle === 'roll') {
      const f = this.time - A.g0;
      P.fond = Math.max(P.fond, w);
      P.laugh = Math.max(P.laugh || 0, 0.8 * w * smoothstep(0.5, 0.8, f) * (1 - smoothstep(1.7, 2.3, f)));
    }
    else if (A.idle === 'flop') {
      // (flopped over at her feet, belly up: a giggle, then a fond smile)
      const f = this.time - A.g0;
      P.fond = Math.max(P.fond, w);
      P.laugh = Math.max(P.laugh || 0, 0.8 * w * smoothstep(0.6, 0.9, f) * (1 - smoothstep(1.8, 2.4, f)));
    }
    // (after its antics she glances at us, as if to say "did you see that?")
    if (A.idle === 'pounce' && this.time - A.g0 > 3.0 && this.time - A.g0 < 3.1) this.glanceCamT = this.time;
    if (A.idle === 'leap' && this.time - A.g0 > 4.4 && this.time - A.g0 < 4.5) this.glanceCamT = this.time;
    if (A.idle === 'flop' && this.time - A.g0 > 2.4 && this.time - A.g0 < 2.5) this.glanceCamT = this.time;
    // and "aww": up on its hind legs at her skirt, her hands go to her chest, she laughs
    const su = (A.stand || 0) * w;
    if (su > 0.01) {
      P.clasp = Math.max(P.clasp, 0.85 * su);
      P.laugh = Math.max(P.laugh || 0, 0.75 * su);
      P.headRoll += clamp(-rel, -0.6, 0.6) * 0.18 * su;
      P.walkAmt *= 1 - su;
    }
  }

  // Her cat playing with the tails of her sash behind her: she looks back over her shoulder
  // (on the side we can see), down at it, and laughs as it bats at them
  lookBack(P, dt) {
    const A = this.cat && this.cat.A;
    const LB = this.lb || (this.lb = { w: 0, s: 1 });
    const B = A && A.idle === 'ribbon' ? A.rbx : null;
    const f = B && B.t1 ? this.time - B.t1 : -1;
    const goal = f > 0.9 && !this.reduced && P.kneel < 0.02 && P.fly < 0.05 ? 1 : 0;
    if (dt > 0) LB.w += (goal - LB.w) * (1 - Math.exp(-dt * (goal > LB.w ? 3 : 2.2)));
    if (B) LB.s = B.side;
    if (LB.w < 0.003) return;
    const w = LB.w, s = LB.s;
    P.torsoYaw += s * 0.46 * w;
    P.headYaw = lerp(P.headYaw, s * 0.8, w);
    P.headPitch = lerp(P.headPitch, 0.34, w);
    P.headRoll += s * 0.08 * w;
    P.gazeX = lerp(P.gazeK ? P.gazeX : 0, s * 0.95, w); P.gazeY = lerp(P.gazeK ? P.gazeY : 0, -0.6, w); P.gazeK = Math.max(P.gazeK || 0, w);
    P.fond = Math.max(P.fond || 0, w);
    P.laugh = Math.max(P.laugh || 0, 0.85 * w * (A ? A.rbUp || 0 : 0));
  }

  // A glance at us: after her cat has done something funny she looks round at the camera
  // with a smile (only when we are in front of her)
  glanceAtUs(P, pos, yaw) {
    const t0 = this.glanceCamT;
    if (t0 === undefined || this.reduced) return;
    const d = this.time - t0;
    if (d < 0 || d > 1.8) return;
    const cam = this.camera.position;
    const rel = ((Math.atan2(cam.x - pos.x, cam.z - pos.z) - yaw + Math.PI * 3) % TAU) - Math.PI;
    if (Math.abs(rel) > 1.25) return;
    const w = smoothstep(0, 0.35, d) * (1 - smoothstep(1.3, 1.8, d));
    const hy = clamp(rel, -0.8, 0.8) * 0.7;
    P.headYaw = lerp(P.headYaw, hy, w);
    P.headPitch = lerp(P.headPitch, -0.05, w);
    P.headRoll += 0.1 * w * Math.sign(rel || 1);
    P.gazeX = lerp(P.gazeK ? P.gazeX : 0, clamp((rel - hy) * 1.6, -1, 1), w); P.gazeY = lerp(P.gazeK ? P.gazeY : 0, 0.1, w); P.gazeK = Math.max(P.gazeK || 0, w);
    // (a smile with her eyes open: she is looking at us)
    P.fond = Math.max(P.fond || 0, w);
    // (and now and then a little peace sign for us, with the hand on our side)
    if (this.glancePeace !== t0) { this.glancePeace = t0; this.glancePeaceOn = Math.random() < 0.45; }
    // (none by her cake: there her hands are only raised for her wish)
    if (this.glancePeaceOn && this.t < 0.78) {
      P.peace = Math.max(P.peace || 0, smoothstep(0.12, 0.42, d) * (1 - smoothstep(1.25, 1.7, d)));
      P.peaceSide = rel >= 0 ? 1 : -1;
    }
  }

  // Petting her cat: when she has stopped between the story's moments and her cat has
  // been sitting with her a little while, she calls it close, kneels down and strokes its
  // head (it leans into her hand, eyes closed), then gets up again. Scrolling on ends it.
  updatePet(P, pos, yaw, t, dt) {
    const S = this.pet || (this.pet = { state: 'idle', w: 0, t0: 0, still: 0, last: -99, catSit: 0, px: pos.x, pz: pos.z, spot: new THREE.Vector3() });
    const cat = this.cat, time = this.time;
    const c = this.catCtx;
    P.stroke = 0; P.petArm = 0; P.strokeK = 1; P.boop = 0; P.beckon = 0; P.paw = 0; P.pawShake = 0;
    if (this.catCtx) { this.catCtx.boopT = -1; if (this.catCtx.paw) this.catCtx.paw.amt = 0; }
    if (!cat || dt <= 0) return;
    const A = cat.A;
    const moved = Math.hypot(pos.x - S.px, pos.z - S.pz);
    S.px = pos.x; S.pz = pos.z;
    // (still: she is standing where she is - while the story is being told, the page may
    // well be moving on behind it)
    S.still = moved < 0.002 ? S.still + dt : 0;
    const forced = this.momentOn('pet');
    const free = P.fly < 0.05 && this.kneelTL < 0.02 && !this.reduced && P.wingsVisible < 0.5 && !this.wished
      && (forced || (t > 0.3 && t < 0.334) || (t > 0.506 && t < 0.732) || (t > 0.79 && t < 0.842)) && S.still > 0.4;
    S.catSit = A.mode === 'near' && A.sit > 0.9 && !A.idle ? S.catSit + dt : 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    if (S.state === 'idle') {
      const gest = (this.gest && time - this.gest.t0 < 2.6) || (this.perchS && this.perchS.on);
      if (free && ((forced && S.still > 0.6) || (!gest && S.still > 1.6 && S.catSit > 2.5 && time - S.last > 14))) {
        S.state = 'call'; S.t0 = time;
        // in front of her, a little toward the camera so we see it past her
        const lx = Math.cos(yaw), lz = -Math.sin(yaw);
        S.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
        S.spot.set(pos.x + fx * 0.5 + lx * S.side * 0.24, pos.y, pos.z + fz * 0.5 + lz * S.side * 0.24);
      }
    } else if (S.state === 'call') {
      if (!free) S.state = 'rise';
      else if (A.mode === 'pet' && A.sit > 0.85 && Math.hypot(A.x - S.spot.x, A.z - S.spot.z) < 0.2) { S.state = 'pet'; S.t0 = time; }
      else if (time - S.t0 > (forced ? 10 : 6)) S.state = 'rise';
    } else if (S.state === 'pet') {
      // (now and then, a boop on the nose partway through)
      // (or she holds her hand out, palm up - "shake?" - and it puts its paw in it)
      if (S.boop === undefined) {
        const r = Math.random();
        S.boop = r < 0.4 ? S.t0 + 2.6 + Math.random() * 1.2 : -1;
        S.pawT = r >= 0.4 && r < 0.78 ? S.t0 + 2.3 + Math.random() * 0.8 : -1;
      }
      // (lingering a long while, she settles down with it instead of getting up: it curls up
      // in front of her and she strokes it slowly, until the page moves on)
      if (!free) S.state = 'rise';
      else if (forced) { /* (for as long as the moment lasts) */ }
      else if (time - S.t0 > 6.5) { if (S.still > 20) { S.state = 'cuddle'; S.t0 = time; } else S.state = 'rise'; }
    } else if (S.state === 'cuddle') {
      if (!free) S.state = 'rise';
    } else if (S.state === 'rise' && S.w < 0.02) {
      S.state = 'idle'; S.last = time; S.w = 0;
    }
    if (S.state !== 'pet') { S.boop = undefined; S.pawT = -1; }
    // calling it over: she bends a little and holds a hand out low, fingers beckoning
    const callK = S.state === 'call' ? smoothstep(0, 0.4, time - S.t0) : 0;
    S.callW = (S.callW || 0) + (callK - (S.callW || 0)) * (1 - Math.exp(-dt * 5));
    if (S.callW > 0.01) {
      P.beckon = S.callW; P.petSide = S.side || 1;
      P.lean += 0.12 * S.callW;
      P.headPitch += 0.18 * S.callW;
      P.headRoll += (S.side || 1) * 0.08 * S.callW;
      P.fond = Math.max(P.fond || 0, S.callW);
      P.walkAmt *= 1 - S.callW;
    }
    const goal = S.state === 'pet' || S.state === 'cuddle' ? 1 : 0;
    const rate = goal > S.w ? 1.5 : free ? 1.8 : 6;
    S.w += (goal - S.w) * (1 - Math.exp(-dt * rate));
    c.pet = S.state; c.petAmt = S.w; c.petSpot = S.spot;
    if (S.w < 0.002) return;
    const w = S.w * S.w * (3 - 2 * S.w);
    P.kneel = Math.max(P.kneel, 0.9 * w);
    P.petArm = smoothstep(0.3, 1, w); P.petSide = S.side || 1;
    P.headYaw += (S.side || 1) * 0.22 * w;
    P.walkAmt *= 1 - w;
    P.headPitch += 0.16 * w;
    P.fond = Math.max(P.fond || 0, w);
    P.gazeX = lerp(P.gazeK ? P.gazeX : 0, -0.2, w); P.gazeY = lerp(P.gazeK ? P.gazeY : 0, -0.75, w); P.gazeK = Math.max(P.gazeK || 0, w);
    P.stroke = S.state === 'pet' ? smoothstep(1.1, 1.8, time - S.t0) * w : 0;
    // the boop: reach in with one finger, a touch on its nose, back - and a giggle
    if (S.state === 'pet' && S.boop > 0) {
      const bd = time - S.boop;
      const bk = smoothstep(0, 0.35, bd) * (1 - smoothstep(0.62, 1.0, bd));
      P.boop = bk * w; P.stroke *= 1 - smoothstep(-0.2, 0.1, bd) * (1 - smoothstep(1.0, 1.4, bd));
      c.boopT = S.boop + 0.35;
      P.laugh = Math.max(P.laugh || 0, 0.85 * smoothstep(0.7, 0.9, bd) * (1 - smoothstep(1.6, 2.1, bd)));
    }
    // shake: her hand turns palm up and waits; its paw comes up into it; a little shake
    // up and down (she laughs); the paw down again, and back to stroking
    if (S.state === 'pet' && S.pawT > 0) {
      const pd = time - S.pawT;
      const hk = smoothstep(0, 0.45, pd) * (1 - smoothstep(2.4, 2.9, pd));
      const ck = smoothstep(0.5, 0.85, pd) * (1 - smoothstep(2.0, 2.35, pd));
      P.paw = hk * w;
      P.pawShake = smoothstep(0.9, 1.1, pd) * (1 - smoothstep(1.6, 1.8, pd));
      P.stroke *= 1 - smoothstep(-0.25, 0.1, pd) * (1 - smoothstep(2.5, 2.9, pd));
      const a = this.char.arms.find((x) => x.side === (S.side || 1));
      const hp = a.hand.localToWorld((this._pawV || (this._pawV = new THREE.Vector3())).set(0, -0.05, 0));
      const cp = c.paw || (c.paw = { x: 0, y: 0, z: 0, amt: 0, shake: 0 });
      cp.x = hp.x; cp.y = hp.y; cp.z = hp.z; cp.amt = ck * w; cp.shake = P.pawShake;
      P.laugh = Math.max(P.laugh || 0, 0.8 * smoothstep(1.0, 1.25, pd) * (1 - smoothstep(2.2, 2.6, pd)));
    }
    if (S.state === 'cuddle') {
      // slow strokes, a pause now and then; content, her eyes closing for a while
      const cd = time - S.t0;
      P.kneel = Math.max(P.kneel, w);
      P.stroke = w * (0.55 + 0.45 * Math.sin(cd * 0.4)) ; P.strokeK = 0.6;
      const doze = smoothstep(0.55, 0.9, Math.sin(cd * 0.23 - 1.2));
      P.smile = Math.max(P.smile, 0.9 * doze * w);
      P.headRoll += (S.side || 1) * 0.12 * w;
    }
  }

  // Little gestures while she waits between moments: now and then she tucks her hair
  // behind her ear (hand up to the side of her head, sliding back), head tipped a touch
  gestureFree(P, t) {
    return P.fly < 0.05 && this.kneelTL < 0.02 && !this.reduced && !this.wished
      && ((t > 0.258 && t < 0.334) || (t > 0.506 && t < 0.732) || (t > 0.79 && t < 0.842));
  }
  updateGestures(P, t, dt) {
    const G = this.gest || (this.gest = { next: 7, t0: -99, side: 1, kind: 'tuck', dur: 2.3 });
    const time = this.time;
    P.tuck = 0; P.tuckSweep = 0; P.spin = 0; P.spinV = 0; P.flare = 0;
    if (dt <= 0) return;
    const still = (this.pet ? this.pet.still : 0) > 1.2;
    const busy = (this.pet && this.pet.w > 0.02) || (this.catLook && this.catLook.w > 0.3) || (this.perchS && this.perchS.on) || (this.lb && this.lb.w > 0.05) || (this.cat && this.cat.A.idle === 'ribbon') || (this.reunion && this.reunion.state !== 'idle');
    const free = this.gestureFree(P, t) && still;
    if (G.t0 < 0 || time - G.t0 > G.dur + 0.1) {
      if (free && !busy && time > G.next) {
        G.t0 = time; G.side = Math.random() < 0.5 ? 1 : -1;
        // now and then, instead of tucking her hair, a happy little twirl (where there is
        // room: not by the flower or the cake, and with her cat not right at her feet)
        const cat = this.cat && this.cat.A;
        const roomy = !(t > 0.39 && t < 0.51) && t < 0.84 && !(cat && Math.hypot(cat.x - this.v.charPos.x, cat.z - this.v.charPos.z) < 0.55);
        G.kind = roomy && Math.random() < 0.4 ? 'twirl' : 'tuck';
        if (G.kind === 'twirl') this.twirlAt = { t0: time, side: G.side };
        G.dur = G.kind === 'twirl' ? 2.4 : 2.3;
        G.next = time + (G.kind === 'twirl' ? 14 : 10) + Math.random() * 8;
      }
    }
    const f = (time - G.t0) / G.dur;
    if (f < 0 || f > 1) return;
    // (ends at once if she has to move on)
    G.amt = free ? 1 : Math.max(0, (G.amt || 1) - dt * 4);
    if (G.kind === 'twirl') {
      // a twirl: up on her toes, arms lifting, once round with her skirt flaring out
      // (and her hair swinging after), settling back with a smile
      const env = smoothstep(0, 0.18, f) * (1 - smoothstep(0.82, 1, f)) * G.amt;
      if (env < 0.002) return;
      const u = smoothstep(0.12, 0.84, f);
      const du = 6 * Math.max(0, (f - 0.12) / 0.72) * (1 - Math.max(0, Math.min(1, (f - 0.12) / 0.72))) / 0.72;
      P.spin = G.side * u * Math.PI * 2 * G.amt;
      P.spinV = G.side * du * Math.PI * 2 / G.dur * G.amt;
      P.flare = Math.min(1, Math.abs(P.spinV) / 5) * G.side;
      P.armsOpen = Math.max(P.armsOpen, 0.42 * env);
      P.smile = Math.max(P.smile, env);
      P.laugh = Math.max(P.laugh || 0, 0.8 * smoothstep(0.25, 0.4, f) * (1 - smoothstep(0.7, 0.85, f)) * G.amt);
      P.headPitch -= 0.08 * env;
      // little steps round on the spot
      P.walkPhase += u * Math.PI * 3;
      P.walkAmt = Math.max(P.walkAmt * (1 - env), 0.5 * env * (1 - smoothstep(0.8, 0.95, f)));
      return;
    }
    const env = smoothstep(0, 0.3, f) * (1 - smoothstep(0.72, 1, f)) * G.amt;
    if (env < 0.002) return;
    P.tuck = env; P.tuckSide = G.side; P.tuckSweep = smoothstep(0.32, 0.72, f);
    P.headRoll += -G.side * 0.1 * env;
    P.headYaw += -G.side * 0.08 * env;
    P.fond = Math.max(P.fond || 0, 0.7 * env);
    P.walkAmt *= 1 - env;
  }

  // A butterfly comes to her: now and then, while she waits, a little golden butterfly
  // flutters down; she holds out her hand and it settles on her palm, slowly opening and
  // closing its wings while she watches it, smiling; then it lifts off and she follows it
  // with her eyes (her cat watches it too)
  updatePerch(P, pos, yaw, t, dt) {
    const S = this.perchS || (this.perchS = { on: false, t0: 0, next: 26, side: 1, w: 0 });
    const time = this.time;
    P.perch = 0;
    if (dt <= 0) return;
    const still = (this.pet ? this.pet.still : 0) > 2;
    const busy = (this.pet && this.pet.w > 0.02) || (this.gest && time - this.gest.t0 < this.gest.dur + 0.2) || (this.cat && (this.cat.A.idle === 'pounce' || this.cat.A.idle === 'leap' || this.cat.A.idle === 'ribbon' || this.cat.A.idle === 'beg')) || (this.reunion && this.reunion.state !== 'idle');
    const free = this.gestureFree(P, t) && still;
    if (!S.on && free && !busy && time > S.next) {
      S.on = true; S.t0 = time; S.next = time + 38 + Math.random() * 20; S.oh = false;
      // (the hand on the side we can see)
      const lx = Math.cos(yaw), lz = -Math.sin(yaw);
      S.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
      // it comes in from that side, high up
      S.from = new THREE.Vector3(pos.x + lx * S.side * 1.6 + Math.sin(yaw) * 0.6, pos.y + 2.2, pos.z + lz * S.side * 1.6 + Math.cos(yaw) * 0.6);
      S.away = new THREE.Vector3(lx * S.side * 0.6 + Math.sin(yaw) * 0.8, 0, lz * S.side * 0.6 + Math.cos(yaw) * 0.8);
    }
    if (!S.on) return;
    const d = time - S.t0;
    // (she lowers her hand at once if she has to move on)
    if (!free && d < 4.4) S.t0 = time - 4.4;
    if (d > 6.4) { S.on = false; return; }
    const arm = smoothstep(0.35, 1.2, d) * (1 - smoothstep(4.7, 5.7, d));
    P.perch = arm; P.perchSide = S.side;
    P.walkAmt *= 1 - arm;
    // look at it (from where her eyes are)
    const bp = this.herFly.pos;
    const hx = pos.x, hy = pos.y + 1.15, hz = pos.z;
    const rel = clamp(((Math.atan2(bp.x - hx, bp.z - hz) - yaw + Math.PI * 3) % TAU) - Math.PI, -1.2, 1.2);
    const down = Math.atan2(hy - bp.y, Math.max(Math.hypot(bp.x - hx, bp.z - hz), 0.15));
    const lw = smoothstep(0.1, 0.6, d) * (1 - smoothstep(5.8, 6.4, d));
    const hyaw = rel * 0.55, hp = clamp(down, -0.6, 1.0) * 0.55;
    P.headYaw = lerp(P.headYaw, hyaw, lw);
    P.headPitch = lerp(P.headPitch, hp, lw);
    P.headRoll += S.side * 0.1 * lw * smoothstep(1.6, 2.2, d);
    P.gazeX = lerp(P.gazeK ? P.gazeX : 0, clamp((rel - hyaw) * 1.6, -1, 1), lw);
    P.gazeY = lerp(P.gazeK ? P.gazeY : 0, clamp(-(down - hp) * 1.5, -1, 0.6), lw);
    P.gazeK = Math.max(P.gazeK || 0, lw);
    P.fond = Math.max(P.fond || 0, lw);
    // (as it settles on her hand: "oh!", then a little laugh)
    if (d >= 1.42 && !S.oh) { S.oh = true; this.ohT = time; }
    P.laugh = Math.max(P.laugh || 0, 0.7 * smoothstep(2.05, 2.3, d) * (1 - smoothstep(2.9, 3.4, d)));
  }
  flyPerch(time) {
    const S = this.perchS, bf = this.herFly;
    if (!S || !S.on) { bf.mesh.visible = false; return; }
    const d = time - S.t0;
    // the perch: just above her palm
    const a = this.char.arms.find((x) => x.side === S.side);
    const palm = a.hand.localToWorld((this._palm || (this._palm = new THREE.Vector3())).set(0, -0.045, 0));
    palm.y += 0.012;
    const p = bf.pos;
    bf.prev.copy(p);
    let rest = 0;
    if (d < 1.55) {
      // fluttering down toward her hand, wavering
      const e = smoothstep(0, 1.55, d), w = 1 - e;
      p.lerpVectors(S.from, palm, e);
      p.x += Math.sin(d * 8.3) * 0.12 * w; p.y += Math.sin(d * 6.1) * 0.1 * w + w * w * 0.3; p.z += Math.cos(d * 7.7) * 0.12 * w;
    } else if (d < 4.5) {
      rest = smoothstep(1.55, 1.75, d) * (1 - smoothstep(4.35, 4.5, d));
      p.copy(palm);
    } else {
      const u = d - 4.5;
      p.copy(palm).addScaledVector(S.away, u * 0.9);
      p.y += 1.3 * (1 - Math.exp(-u * 1.5)) + 0.25 * u + Math.sin(u * 10) * 0.04;
      p.x += Math.sin(u * 7) * 0.08; p.z += Math.cos(u * 6) * 0.08;
    }
    const u = bf.mat.uniforms;
    const vx = p.x - bf.prev.x, vz = p.z - bf.prev.z;
    if (rest < 0.5 && Math.hypot(vx, vz) > 1e-4) u.uYaw.value = Math.atan2(vx, vz);
    u.uPos.value.copy(p);
    const beat = (0.5 + 0.5 * Math.sin(time * 26)) * 1.25 + 0.08;
    const slow = 1.0 + 0.45 * Math.sin(time * 2.6);
    u.uFlap.value = lerp(beat, slow, rest);
    u.uAlpha.value = smoothstep(0, 0.2, d) * (1 - smoothstep(5.9, 6.4, d));
    bf.mesh.visible = u.uAlpha.value > 0.01;
  }

  // After her wish: she looks down at her cat, which comes to her feet; she kneels, it stands
  // up into her hands, and she lifts it up into her arms and holds it close (on the side we
  // can see, its face by her shoulder), both watching the lanterns rise
  updateHug(P, pos, yaw) {
    const H = this.hug || (this.hug = { state: 'idle', t0: 0, side: 1, d: 0, lift: 0, stand: 0, come: 0, chest: new THREE.Vector3(), yaw: 0, her: new THREE.Vector3() });
    P.hold = 0; P.holdLift = 0; P.kiss = 0; P.around = 0;
    // (the peace sign is only for her glances and her wink; the busier hands win)
    if ((P.peace || 0) > 0 && ((P.clap || 0) > 0.05 || (P.perch || 0) > 0.05 || (P.petArm || 0) > 0.05 || (P.tuck || 0) > 0.05 || (P.beckon || 0) > 0.05)) P.peace = 0;
    if (!this.wished || this.reduced || !this.cat) { H.state = 'idle'; H.lift = 0; return; }
    const time = this.time, wa = time - this.wishTime;
    if (H.state === 'idle') {
      if (wa < 5.2) return;
      H.state = 'on'; H.t0 = time;
      const lx = Math.cos(yaw), lz = -Math.sin(yaw);
      H.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
    }
    const d = time - H.t0;
    H.d = d; H.her.copy(pos); H.yaw = yaw;
    // her cat comes and sits at her feet (0 - 1.6), she kneels and reaches (1.6 - 2.6), it
    // stands up into her hands (2.3 - 2.8), she rises with it (2.8 - 4.0), and holds it
    H.come = 1;
    const kneel = smoothstep(1.6, 2.6, d) * (1 - smoothstep(2.9, 4.0, d));
    const reach = smoothstep(1.6, 2.5, d);
    H.stand = smoothstep(2.3, 2.75, d);
    H.lift = smoothstep(2.85, 3.9, d);
    P.kneel = Math.max(P.kneel, 0.9 * kneel);
    P.lean += 0.15 * kneel;
    P.hold = reach; P.holdSide = H.side; P.holdLift = H.lift;
    P.walkAmt = 0;
    // the wish pose gives way; she looks down at her cat, then up at the lanterns, her head
    // tipped against it
    const w0 = 1 - smoothstep(0, 1.2, d);
    P.wish *= w0;
    const down = smoothstep(0.2, 1.0, d) * (1 - smoothstep(3.6, 4.6, d));
    P.headPitch = lerp(P.headPitch, 0.42, down);
    P.headYaw = lerp(P.headYaw, 0, down);
    P.gazeX = 0; P.gazeY = lerp(0, -0.6, down); P.gazeK = down;
    const up = smoothstep(3.8, 5.0, d);
    P.headPitch -= 0.3 * up;
    P.headRoll += H.side * 0.2 * up;
    P.headYaw += H.side * 0.12 * up;
    // (holding it close she rocks it gently from side to side)
    const rock = H.lift * smoothstep(4.0, 5.5, d);
    P.torsoYaw += Math.sin(time * 1.5) * 0.08 * rock;
    P.headRoll += Math.sin(time * 1.5 + 0.6) * 0.05 * rock;
    P.smile = Math.max(P.smile, smoothstep(0.4, 1.0, d));
    P.fond = Math.max(P.fond || 0, smoothstep(0.4, 1.0, d) * (1 - up));
    P.laugh = Math.max(P.laugh || 0, 0.8 * smoothstep(3.2, 3.6, d) * (1 - smoothstep(4.2, 4.8, d)));
    // (and after a while she settles down in the grass, holding it)
    P.kneel = Math.max(P.kneel, 0.92 * smoothstep(14, 18, d));
  }
  hugPost(pos, yaw) {
    const H = this.hug && this.hug.state !== 'idle' ? this.hug : this.reunion && this.reunion.state !== 'idle' ? this.reunion : this.archHug;
    if (!H || H.state === 'idle') return;
    yaw = H.yaw;
    // where its chest goes: between her hands, a little up and back toward her
    const a = this.char.arms;
    const v = this._hp || (this._hp = new THREE.Vector3()), w = this._hq || (this._hq = new THREE.Vector3());
    a[0].hand.localToWorld(v.set(0, -0.045, 0));
    a[1].hand.localToWorld(w.set(0, -0.045, 0));
    H.chest.addVectors(v, w).multiplyScalar(0.5);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    H.chest.y += 0.05 * H.lift;
    // (held facing out, its chest is out in front of her hands, its back against her)
    const out = H.kind === 'arch' ? 0.13 : -0.035;
    H.chest.x += fx * out * H.lift; H.chest.z += fz * out * H.lift;
  }

  // Back on the ground: after its greeting laps she turns to it (toward us), kneels with her
  // arms open, and it comes into them; she gathers it up to her chest and hugs it, rocking,
  // her cheek on its head, eyes closed; then sets it down gently and gets up (once each
  // time she lands; at once if the page moves on)
  updateReunion(P, pos, yaw, t, dt) {
    const R = this.reunion || (this.reunion = { state: 'idle', kind: 'reunion', t0: 0, side: 1, d: 0, lift: 0, stand: 0, come: 1, chest: new THREE.Vector3(), yaw: 0, her: new THREE.Vector3(), done: false });
    const A = this.cat && this.cat.A, time = this.time;
    if (P.fly > 0.5) R.done = false;
    const still = this.pet ? this.pet.still : 0;
    const zone = false && t > 0.25 && t < 0.3 && P.fly < 0.05 && !this.reduced && !this.wished;
    if (R.state === 'idle') {
      if (!zone || R.done || !A || dt <= 0) return;
      const landedFor = this.landT !== undefined ? time - this.landT : 99;
      if (!(landedFor > 2.4 && still > 0.8 && A.mode === 'near' && !A.idle && Math.hypot(A.x - pos.x, A.z - pos.z) < 2.2)) return;
      R.state = 'on'; R.t0 = time; R.done = true; R.tRel = undefined;
      const lx = Math.cos(yaw), lz = -Math.sin(yaw);
      R.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
      // (turned far enough that we see her face and its, side on)
      const rel = Math.abs(((Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z) - yaw + Math.PI * 3) % TAU) - Math.PI);
      R.turn = clamp(rel - 0.72, 0.5, 2.1);
    }
    const d = time - R.t0;
    // (the page moves on: she lets it down at once, quickly)
    if (R.tRel === undefined && (!zone || still < 0.05)) { R.tRel = Math.min(d, 7.4); R.fast = true; }
    const tr = R.tRel !== undefined ? R.tRel : 7.4;
    const r = Math.max(0, d - tr) * (R.fast ? 2.4 : 1);
    const inn = (a, b) => smoothstep(a, b, Math.min(d, tr));
    if (r > 2.8) { R.state = 'idle'; R.lift = 0; R.stand = 0; return; }
    // turning toward us, so we see them both
    const spin = R.side * R.turn * inn(0, 1.0) * (1 - smoothstep(1.7, 2.7, r));
    this.char.root.rotation.y += spin;
    P.spin = spin;
    const face = yaw + spin;
    R.her.copy(pos); R.yaw = face; R.d = Math.min(d, tr) + (r > 0 ? 3 : 0);
    const kneel = 0.9 * inn(0.45, 1.35) * (1 - smoothstep(1.2, 2.2, r));
    const open = inn(0.5, 1.1) * (1 - inn(1.7, 2.2)) * (1 - smoothstep(0, 0.4, r));
    const reach = inn(1.6, 2.3) * (1 - smoothstep(0.9, 1.4, r));
    R.stand = inn(2.3, 2.75) * (1 - smoothstep(0.8, 1.15, r));
    R.lift = inn(2.85, 3.7) * (1 - smoothstep(0, 0.9, r));
    P.kneel = Math.max(P.kneel, kneel);
    P.lean += 0.12 * kneel;
    P.armsOpen = Math.max(P.armsOpen, 0.5 * open);
    P.hold = Math.max(P.hold, reach); P.holdSide = R.side; P.holdLift = R.lift;
    P.walkAmt = 0;
    // her face: smiling down at it; in the hug, eyes closed, her cheek tipped onto its head,
    // rocking it gently
    const w = inn(0.2, 0.8) * (1 - smoothstep(2.0, 2.8, r));
    const hugK = R.lift * smoothstep(3.6, 4.2, Math.min(d, tr + 0.6));
    P.headPitch = lerp(P.headPitch, 0.36 - 0.12 * hugK, w);
    P.headYaw = lerp(P.headYaw, 0, w);
    P.headRoll += R.side * 0.16 * hugK;
    P.gazeX = 0; P.gazeY = lerp(0, -0.6, w); P.gazeK = Math.max(P.gazeK || 0, w * (1 - hugK));
    P.torsoYaw += Math.sin(time * 1.5) * 0.08 * hugK;
    P.headRoll += Math.sin(time * 1.5 + 0.6) * 0.05 * hugK;
    P.fond = Math.max(P.fond || 0, w * (1 - hugK));
    P.smile = Math.max(P.smile, hugK, 0.6 * w);
    P.laugh = Math.max(P.laugh || 0, 0.7 * inn(2.9, 3.2) * (1 - inn(3.7, 4.1)));
    // (a kiss on the top of its head)
    const ku = Math.min(d, tr) - 5.0;
    const kiss = ku >= 0 && ku < 1.2 ? smoothstep(0, 0.25, ku) * (1 - smoothstep(0.85, 1.2, ku)) * hugK : 0;
    R.kiss = kiss; P.kiss = kiss;
    P.headPitch += 0.1 * kiss;
  }

  // Under the flower arch, lingering (where we see her face close): she bends down and
  // scoops her cat up, rises with it in her arms and holds it against her cheek, both looking
  // out at us, rocking it a little; she sets it down as soon as the page moves on
  updateArchHug(P, pos, yaw, t, dt) {
    const R = this.archHug || (this.archHug = { state: 'idle', kind: 'arch', t0: 0, side: 1, d: 0, lift: 0, stand: 0, come: 1, chest: new THREE.Vector3(), yaw: 0, her: new THREE.Vector3(), last: -99 });
    const A = this.cat && this.cat.A, time = this.time;
    const still = this.pet ? this.pet.still : 0;
    const zone = t > 0.34 && t < 0.384 && P.fly < 0.05 && !this.reduced && !this.wished;
    if (R.state === 'idle') {
      if (!zone || !A || dt <= 0 || time - R.last < 15) return;
      if (!(still > 3.2 && (A.mode === 'near' || A.mode === 'follow') && !A.idle && A.landed && Math.hypot(A.x - pos.x, A.z - pos.z) < 2.6)) return;
      R.state = 'on'; R.t0 = time; R.tRel = undefined; R.fast = false;
      const lx = Math.cos(yaw), lz = -Math.sin(yaw);
      R.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
    }
    const d = time - R.t0;
    if (R.tRel === undefined && (!zone || still < 0.05)) { R.tRel = d; R.fast = true; }
    const tr = R.tRel !== undefined ? R.tRel : 1e9;
    const r = Math.max(0, d - tr) * (R.fast ? 2.4 : 1);
    const inn = (a, b) => smoothstep(a, b, Math.min(d, tr));
    if (r > 2.4) { R.state = 'idle'; R.lift = 0; R.stand = 0; R.last = time; return; }
    R.her.copy(pos); R.yaw = yaw; R.d = Math.min(d, tr) + (r > 0 ? 3 : 0);
    const kneel = 0.9 * inn(0.6, 1.5) * (1 - inn(3.0, 4.1)) * (1 - smoothstep(0, 0.6, r));
    const reach = inn(1.5, 2.3) * (1 - smoothstep(0.5, 1.0, r));
    R.stand = inn(2.3, 2.75) * (1 - smoothstep(0.5, 0.9, r));
    R.lift = inn(2.85, 3.6) * (1 - smoothstep(0, 0.7, r));
    P.kneel = Math.max(P.kneel, kneel);
    P.lean += 0.15 * kneel;
    P.hold = Math.max(P.hold, reach); P.holdSide = R.side; P.holdLift = R.lift;
    P.walkAmt = 0;
    // looking down at it as she picks it up; then up at us, her cheek against its head
    const w = inn(0.1, 0.6) * (1 - smoothstep(1.4, 2.2, r));
    const up = smoothstep(3.9, 4.8, Math.min(d, tr + 0.6)) * R.lift;
    P.headPitch = lerp(P.headPitch, lerp(0.38, 0.05, up), w);
    P.headYaw = lerp(P.headYaw, R.side * 0.2 * up, w);
    P.headRoll += R.side * 0.2 * up;
    P.gazeX = lerp(P.gazeK ? P.gazeX : 0, 0, w); P.gazeY = lerp(P.gazeK ? P.gazeY : 0, -0.6 * (1 - up), w); P.gazeK = Math.max(P.gazeK || 0, w);
    P.torsoYaw += Math.sin(time * 1.3) * 0.05 * up;
    P.smile = Math.max(P.smile, up);
    P.fond = Math.max(P.fond || 0, w * (1 - up));
    P.laugh = Math.max(P.laugh || 0, 0.7 * inn(3.0, 3.3) * (1 - inn(3.9, 4.4)));
    // now and then she turns and gives it a little kiss on the head
    const kd = Math.min(d, tr) - 6.0;
    const ku = kd >= 0 ? kd % 6.5 : -1;
    const kiss = ku >= 0 && ku < 1.15 ? smoothstep(0, 0.25, ku) * (1 - smoothstep(0.8, 1.15, ku)) * up * (1 - smoothstep(0, 0.3, r)) : 0;
    R.kiss = kiss;
    P.kiss = kiss;
    P.headYaw += R.side * 0.32 * kiss; P.headPitch += 0.1 * kiss; P.headRoll += R.side * 0.04 * kiss;
  }

  // At the summit, lingering: she lowers her arms and sits down in the grass, looking out at
  // the view; her cat comes and sits pressed against her side (the side we see), and she
  // puts her arm round it; they watch together, her head tipped to it, now and then a slow
  // stroke down its back
  updateSummit(P, pos, yaw, t, dt) {
    const M = this.summit || (this.summit = { state: 'idle', t0: 0, w: 0, arm: 0, side: 1, spot: new THREE.Vector3() });
    const time = this.time, c = this.catCtx;
    const still = this.pet ? this.pet.still : 0;
    const zone = t > 0.742 && t < 0.776 && P.fly < 0.05 && !this.reduced && !this.wished;
    if (M.state === 'idle') {
      if (zone && still > 4.5 && this.cat && dt > 0) {
        M.state = 'on'; M.t0 = time;
        const lx = Math.cos(yaw), lz = -Math.sin(yaw);
        M.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
        M.spot.set(pos.x + lx * M.side * 0.29, pos.y, pos.z + lz * M.side * 0.29);
      }
    } else if (!zone || still < 0.05) M.state = 'idle';
    const on = M.state === 'on';
    if (dt > 0) M.w += ((on ? 1 : 0) - M.w) * (1 - Math.exp(-dt * (on ? 0.9 : 3.5)));
    // (its arm round it once it is sitting there)
    const A = this.cat && this.cat.A;
    const there = on && A && A.sit > 0.8 && Math.hypot(A.x - M.spot.x, A.z - M.spot.z) < 0.12 && M.w > 0.7;
    if (dt > 0) M.arm += ((there ? 1 : 0) - M.arm) * (1 - Math.exp(-dt * (there ? 1.3 : 4)));
    if (c) c.summitSit = on || M.w > 0.05 ? M : null;
    if (M.w < 0.003) return;
    const w = M.w * M.w * (3 - 2 * M.w);
    P.armsOpen *= 1 - smoothstep(0, 0.3, w);
    P.laugh = (P.laugh || 0) * (1 - smoothstep(0, 0.3, w));
    const k = smoothstep(0.2, 0.8, w);
    P.kneel = Math.max(P.kneel, 0.95 * k);
    P.walkAmt *= 1 - w;
    const a = M.arm * k;
    P.around = a; P.aroundSide = M.side;
    P.aroundStroke = smoothstep(0.55, 0.95, Math.sin((time - M.t0) * 0.33 - 1.2));
    // her head tipped onto its side of her, looking out; now and then down at it
    const down = smoothstep(0.6, 0.95, Math.sin((time - M.t0) * 0.21 + 0.4)) * a;
    P.headRoll = lerp(P.headRoll, -M.side * 0.2, a);
    P.headPitch = lerp(P.headPitch, lerp(-0.08, 0.3, down), k);
    P.headYaw = lerp(P.headYaw, M.side * 0.35 * down, k);
    P.fond = Math.max(P.fond || 0, k);
    P.smile = Math.max(P.smile, 0.7 * smoothstep(0.5, 0.9, Math.sin((time - M.t0) * 0.17 - 0.8)) * a);
  }

  // Blowing out her candles: she turns to the cake and leans in, cheeks puffed, and blows
  // (the flames bend away and go out), then straightens up to make her wish
  updateBlow(P, pos, yaw) {
    P.blow = 0; this.blowAmt = 0;
    if (!this.wished || !this.blowT) return;
    const d = this.time - this.wishTime;
    if (d < 0 || d > 1.6) return;
    const lean = smoothstep(0, 0.42, d) * (1 - smoothstep(1.0, 1.5, d));
    const blow = smoothstep(0.42, 0.52, d) * (1 - smoothstep(0.92, 1.08, d));
    const fp = this.cake.worldFlame();
    const rel = clamp(((Math.atan2(fp.x - pos.x, fp.z - pos.z) - yaw + Math.PI * 3) % TAU) - Math.PI, -1.3, 1.3);
    P.torsoYaw += rel * 0.42 * lean;
    P.headYaw += rel * 0.4 * lean;
    P.lean += 0.2 * lean;
    P.headPitch += 0.22 * lean;
    P.clasp = Math.max(P.clasp, 0.7 * lean);
    P.gazeX = 0; P.gazeY = -0.55; P.gazeK = lean;
    P.blow = blow;
    this.blowAmt = blow;
  }

  // Camera rig as a pure function of t (also used at build time to keep props clear of the lens)
  rigAt(t, out) {
    const tr = this.tracks;
    const s = this.path.sAtIndex(tr.wp.get(t));
    const fly = tr.pose('fly', t);
    const pos = this.path.posAt(s, out.charPos);
    const [dist, az, el, pivUp, lookAhead, lookUp, lookSide, fov, roll] = tr.cam.sample(t);
    const hk = this.sampleAngleKeys(HEADING_KEYS, t, (v) => (v === 'flower' ? this.flowerYaw : v));
    const camBase = this.path.headingAt(s, fly > 0.5 ? 26 : 10);
    const camYaw = lerpAngle(camBase, hk.yaw, hk.w);
    // she is a little shorter than the rig was first framed for: on the ground
    // the pivot and the look follow her height
    const hk2 = lerp(0.915, 1, fly);
    const px = pos.x, py = pos.y + pivUp * hk2, pz = pos.z;
    const azr = camYaw + az * DEG, elr = el * DEG;
    const cam = out.cam.set(px + Math.sin(azr) * Math.cos(elr) * dist, py + Math.sin(elr) * dist, pz + Math.cos(azr) * Math.cos(elr) * dist);
    const gh = heightAt(cam.x, cam.z);
    if (cam.y < gh + 0.9) cam.y = gh + 0.9;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    out.look.set(px + fx * lookAhead - fz * lookSide, py + lookUp * hk2, pz + fz * lookAhead + fx * lookSide);
    out.s = s; out.fly = fly; out.fov = fov; out.roll = roll; out.dist = dist;
    // circling a peak: the look pulled part of the way toward its snowy top
    {
      let w = 0, pk = 0;
      for (let i = 0; i < PEAK_LOOK.length - 1; i++) {
        const a = PEAK_LOOK[i], b = PEAK_LOOK[i + 1];
        if (t >= a[0] && t <= b[0]) { w = lerp(a[1], b[1], smoothstep(a[0], b[0], t)); pk = a[1] > b[1] ? a[2] : b[2]; break; }
      }
      if (w > 0.001) {
        const H = pk ? HERO.R : HERO.L;
        out.look.set(lerp(out.look.x, H.x, w), lerp(out.look.y, H.top - 22, w), lerp(out.look.z, H.z, w));
      }
    }
    // the opening: a camera fixed in the world holds the title shot while she flies in from
    // behind it, low over it and out ahead - then lets go, and the rig follows her
    const wc = tr.wcam.sample(t);
    const ww = clamp(wc[0], 0, 1);
    if (ww > 0.001) {
      const e = ww * ww * (3 - 2 * ww);
      out.cam.set(lerp(out.cam.x, wc[1], e), lerp(out.cam.y, wc[2], e), lerp(out.cam.z, wc[3], e));
      out.look.set(lerp(out.look.x, wc[4], e), lerp(out.look.y, wc[5], e), lerp(out.look.z, wc[6], e));
      out.fov = lerp(out.fov, wc[7], e); out.roll *= 1 - e;
      out.dist = lerp(dist, out.cam.distanceTo(pos), e);
    }
    return out;
  }

  update(dt) {
    const t = this.t, time = this.time, U = this.U, tr = this.tracks, red = this.reduced;
    U.uTime.value = time;
    applyEnv(tr.env(t), U, this.sky, this.envExtra);
    if (dt > 0) this.story.advance(t, time);

    // --- her position & pose ---
    const s = this.path.sAtIndex(tr.wp.get(t));
    this.s = s;
    const P = this.pose;
    for (const k in POSE) P[k] = tr.pose(k, t);
    const fly = P.fly;
    // (she only walks while she is actually moving: stopping on the way, she brings her
    // feet together and stands, rather than freezing mid-stride)
    // Her steps keep a walking pace: when the page is scrolled faster than she could walk,
    // her stride does not turn frantic - she glides, light on her feet, arms drifting back,
    // her skirt and hair streaming
    if (dt > 0) {
      const dsS = this.prevS === undefined ? 0 : s - this.prevS;
      const ds = Math.abs(dsS) / dt;
      this.sv = (this.sv || 0) + (Math.min(ds, 20) - (this.sv || 0)) * (1 - Math.exp(-dt * 8));
      const mk = smoothstep(0.04, 0.35, this.sv);
      this.walkK = (this.walkK ?? 1) + (mk - (this.walkK ?? 1)) * (1 - Math.exp(-dt * 7));
      const pace = this.sv < 1.3 ? this.sv : 1.3 + (this.sv - 1.3) * 0.1;
      this.wph = (this.wph ?? (s / 0.7) * Math.PI) + Math.sign(dsS) * (pace / 0.7) * Math.PI * dt;
    }
    this.prevS = s;
    P.walkPhase = this.wph ?? (s / 0.7) * Math.PI;
    P.walkAmt *= this.walkK ?? 1;
    P.glide = smoothstep(1.8, 4.5, this.sv || 0) * P.walkAmt * (1 - fly);
    // (walking on from the flower she has just made bloom, she skips for joy)
    P.skip = this.bloomBurst && this.bloomBurst.fired && !red ? smoothstep(0.508, 0.515, t) * (1 - smoothstep(0.538, 0.552, t)) * (1 - smoothstep(3.6, 5.2, this.sv || 0)) * P.walkAmt : 0;
    P.glide *= 1 - P.skip;
    // (quicker wingbeats on the climb and for the landing)
    P.flapSpeed = lerp(2.0, 4.2, smoothstep(0.226, 0.25, t)) + 1.0 * smoothstep(0.018, 0.03, t) * (1 - smoothstep(0.05, 0.062, t));
    P.torsoYaw = 0;
    const pos = this.path.posAt(s, this.v.charPos);
    const pathYaw = this.path.headingAt(s, fly > 0.5 ? 10 : 2.2);
    const face = this.sampleAngleKeys(FACE_KEYS, t, (v) => (v === 'flower' ? this.flowerYaw : v));
    const yaw = lerpAngle(pathYaw, face.yaw, face.w);
    const dir = this.path.dirAt(s, 5, this.v.tmp);
    const dive = Math.asin(clamp(-dir.y, -1, 1));
    const pitch = fly * (0.95 + dive * 0.55) + (1 - fly) * 0;
    const yawAhead = this.path.headingAt(Math.min(s + 25, this.path.length), 10);
    const turn = ((yawAhead - pathYaw + Math.PI * 3) % TAU) - Math.PI;
    // (banking into her turns: steeply round the summit)
    const bank = red ? 0 : clamp(-turn * 1.5, -0.7, 0.7) * fly;
    this.char.root.position.copy(pos);
    this.char.root.rotation.set(pitch, yaw, bank, 'YXZ');
    // resting on the mountain path, she turns and looks back down the way she has come
    {
      const w = this.momentW('rest', true);
      if (w > 0.001) {
        const b = this.path.posAt(Math.max(0, s - 7), this.v.comp);
        const rd = this.restDir || (this.restDir = new THREE.Vector2());
        if (!this._restSet || this.momentW('rest') < 0.02) { rd.set(b.x - pos.x, b.z - pos.z).normalize(); this._restSet = true; }
        const e = w * w * (3 - 2 * w);
        this.char.root.rotation.y = lerpAngle(yaw, Math.atan2(rd.x, rd.y), e);
      }
    }
    const bT = this.wished ? (this.blowT || 0) : 0;
    P.wish = this.wished ? smoothstep(this.wishTime + 0.6 + bT * 0.85, this.wishTime + 2.6 + bT * 0.85, time) : 0;
    this.kneelTL = P.kneel;
    // touching down: a soft dip at the knees, arms out a touch, the skirt puffing out
    if (this.prevFly !== undefined && this.prevFly > 0.06 && fly <= 0.06 && this.tv >= 0 && !red) this.landT = time;
    this.prevFly = fly;
    {
      const ld = this.landT !== undefined ? time - this.landT : 9;
      P.landDip = ld >= 0 && ld < 0.9 ? smoothstep(0, 0.12, ld) * (1 - smoothstep(0.18, 0.75, ld)) - 0.12 * Math.sin(Math.PI * smoothstep(0.45, 0.9, ld)) : 0;
    }
    P.peace = 0;
    {
      const lx = Math.cos(yaw), lz = -Math.sin(yaw);
      P.peaceSide = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1;
    }
    this.lookAtCat(P, pos, yaw, t, dt);
    this.lookBack(P, dt);
    this.glanceAtUs(P, pos, yaw);
    this.updatePet(P, pos, yaw, t, dt);
    this.updateGestures(P, t, dt);
    if (P.spin) this.char.root.rotation.y += P.spin;
    this.updateBlow(P, pos, yaw);
    this.updatePerch(P, pos, yaw, t, dt);
    this.updateHug(P, pos, yaw);
    this.updateReunion(P, pos, yaw, t, dt);
    this.updateArchHug(P, pos, yaw, t, dt);
    this.updateSummit(P, pos, yaw, t, dt);
    {
      const w = this.momentW('rest', true);
      if (w > 0.001) {
        const e = w * w * (3 - 2 * w);
        P.walkAmt *= 1 - e;
        P.headPitch = lerp(P.headPitch, 0.24, e);
        P.smile = Math.max(P.smile, 0.5 * e);
        P.fond = Math.max(P.fond || 0, 0.35 * e);
      }
    }
    // the birthday tune: she sways gently with it, smiling, eyes closed now and then; her cat
    // sings along at the end of each line
    {
      const S = this.song;
      let sing = 0, sway = 0;
      if (S && !red) {
        const d = time - S.t0;
        if (d > S.len + 1 || t < 0.84) this.song = null;
        else {
          const env = smoothstep(0, 0.8, d) * (1 - smoothstep(S.len - 0.4, S.len + 0.8, d));
          sway = env * (this.wished ? 0 : 1);
          for (const x of S.sing) { const u = time - x.t; if (u > -0.05 && u < x.d + 0.1) sing = Math.max(sing, smoothstep(-0.05, 0.08, u) * (1 - smoothstep(x.d - 0.1, x.d + 0.1, u))); }
          if (sway > 0.01) {
            const ph = (d / (S.beat * 2)) * Math.PI;
            P.headRoll += Math.sin(ph) * 0.07 * sway;
            P.torsoYaw += Math.sin(ph - 0.4) * 0.05 * sway;
            P.smile = Math.max(P.smile, 0.75 * sway);
          }
        }
      }
      if (this.catCtx) this.catCtx.sing = sing;
    }
    // (its sneeze by the flower makes her laugh)
    if (this.cat && this.cat.A.sneezeAt !== undefined && !red) {
      const sd = time - this.cat.A.sneezeAt;
      if (sd >= 0 && sd < 2) P.laugh = Math.max(P.laugh || 0, 0.85 * smoothstep(0.12, 0.3, sd) * (1 - smoothstep(1.2, 1.8, sd)));
    }
    // (her cheeks warm: kissed, cuddled, its fuss over her, caught looking at us)
    {
      const A = this.cat && this.cat.A;
      const ar = this.archHug && this.archHug.state !== 'idle' ? this.archHug : null, re = this.reunion && this.reunion.state !== 'idle' ? this.reunion : null;
      const gl = this.glanceCamT !== undefined ? time - this.glanceCamT : 9;
      P.blush = Math.max(P.kiss || 0, ar ? 0.6 * ar.lift : 0, re ? 0.7 * re.lift : 0, A ? 0.5 * (A.rub || 0) : 0, 0.7 * (P.boop || 0),
        gl >= 0 && gl < 2 ? 0.5 * smoothstep(0, 0.4, gl) * (1 - smoothstep(1.4, 2, gl)) : 0, this.hug && this.hug.state !== 'idle' ? 0.55 * this.hug.lift : 0, this.pet ? 0.3 * this.pet.w : 0);
    }
    // (and sometimes, giggling, she covers her mouth with her hand - the one we see)
    {
      const G = this.gig || (this.gig = { on: false, w: 0, side: -1 });
      const lg = P.laugh || 0;
      const busy = (P.hold || 0) > 0.05 || (P.petArm || 0) > 0.05 || (P.clap || 0) > 0.05 || (P.perch || 0) > 0.05 || (P.around || 0) > 0.05 || (P.tuck || 0) > 0.05
        || (P.beckon || 0) > 0.05 || (P.boop || 0) > 0.05 || (P.clasp || 0) > 0.3 || (P.armsOpen || 0) > 0.2 || (P.wish || 0) > 0.05 || (P.reach || 0) > 0.05 || (P.blow || 0) > 0.05 || P.fly > 0.05;
      if (!G.on && lg > 0.45 && !G.armed) { G.armed = true; G.on = !busy && !red && Math.random() < 0.6; if (G.on) { const lx = Math.cos(yaw), lz = -Math.sin(yaw); G.side = ((this.camera.position.x - pos.x) * lx + (this.camera.position.z - pos.z) * lz) >= 0 ? 1 : -1; } }
      if (lg < 0.2) { G.armed = false; G.on = false; }
      if (busy) G.on = false;
      if (dt > 0) G.w += ((G.on ? smoothstep(0.3, 0.6, lg) : 0) - G.w) * (1 - Math.exp(-dt * (G.on ? 9 : 6)));
      P.cover = G.w; P.coverSide = G.side;
    }
    // "oh!": a little gasp of delight (the flower bursting open, a butterfly landing on her
    // hand), then her smile again
    {
      const d = this.ohT !== undefined ? time - this.ohT : 9;
      // (the arch's "oh!" is a moment: if the page stops there, it gives way to her smile)
      const rest = this.pet ? this.pet.still : 0;
      const track = (P.oh || 0) * (1 - smoothstep(0.9, 1.7, rest));
      P.oh = Math.max(red ? 0 : track, !red && d >= 0 && d < 1.3 ? smoothstep(0, 0.1, d) * (1 - smoothstep(0.75, 1.2, d)) : 0);
      if (rest > 0.9 && t > 0.335 && t < 0.353) P.smile = Math.max(P.smile, smoothstep(0.9, 1.7, rest));
    }
    this.char.pose(P, time, red);
    this.flyPerch(time);
    this.hugPost(pos, yaw);
    // soft contact shadow on the ground beneath her
    const gy = heightAt(pos.x, pos.z);
    const above = pos.y - gy - (fly > 0.5 ? 0.95 : 0);
    const sh = this.shadow;
    sh.position.set(pos.x, gy + 0.03, pos.z);
    const nn = normalAt(pos.x, pos.z);
    sh.quaternion.setFromUnitVectors(this._up, this._nrm.set(nn[0], nn[1], nn[2]));
    sh.rotateY(yaw);
    const ks = 1 + P.kneel * 0.35;
    sh.scale.set(ks, 1, ks);
    sh.material.uniforms.uOpacity.value = 0.42 * smoothstep(5, 0.3, above);
    sh.visible = above < 5;

    // dress & hair flow: motion + wind
    const wind = U.uWind.value;
    const flow = this.v.flow.set(-dir.x, -dir.y + 0.15, -dir.z).multiplyScalar(0.22 * fly + 0.05 + 0.07 * (P.glide || 0));
    flow.x += Math.sin(time * 0.6) * 0.04 * wind;
    flow.z += 0.05 * wind;
    if (P.spinV) {
      // twirling: her hair swings out behind the turn
      const ry = this.char.root.rotation.y, w = P.spinV;
      flow.x += Math.cos(ry) * w * 0.022 - Math.sin(ry) * Math.abs(w) * 0.012;
      flow.z += -Math.sin(ry) * w * 0.022 - Math.cos(ry) * Math.abs(w) * 0.012;
      flow.y += Math.abs(w) * 0.008;
    }
    this.char.setFlow(flow, 1.0, lerp(1.0, 1.6, fly));

    // --- camera ---
    const R = this.rigAt(t, this.rig);
    const cam = R.cam, look = R.look, roll = R.roll, dist = R.dist;
    let fov = R.fov;
    if (this.debugCam) {
      // inspection camera orbiting her (dev only)
      const d = this.debugCam;
      if (d.pos) {
        cam.set(d.pos[0], d.pos[1], d.pos[2]);
        look.set(d.look[0], d.look[1], d.look[2]);
      } else {
        const yb = this.char.root.rotation.y + (d.az || 0) * DEG, el = (d.el || 0) * DEG, dd = d.dist || 2;
        look.set(pos.x, pos.y + (d.h ?? 1.5), pos.z);
        cam.set(look.x + Math.sin(yb) * Math.cos(el) * dd, look.y + Math.sin(el) * dd, look.z + Math.cos(yb) * Math.cos(el) * dd);
      }
      fov = d.fov || 30;
    }
    if (!this.debugCam) {
      // (a move to another shot of her: round her, not through her - the bearing, distance
      // and height eased separately - and never into the ground)
      const orbitTo = (cx, cy, cz, lx, ly, lz, f, w) => {
        const e = w * w * (3 - 2 * w);
        const ax = cam.x - pos.x, az = cam.z - pos.z, bx = cx - pos.x, bz = cz - pos.z;
        const a = lerpAngle(Math.atan2(ax, az), Math.atan2(bx, bz), e), r = lerp(Math.hypot(ax, az), Math.hypot(bx, bz), e);
        const nx = pos.x + Math.sin(a) * r, nz = pos.z + Math.cos(a) * r;
        cam.set(nx, Math.max(lerp(cam.y, cy, e), heightAt(nx, nz) + 0.6), nz);
        look.set(lerp(look.x, lx, e), lerp(look.y, ly, e), lerp(look.z, lz, e));
        fov = lerp(fov, f, e);
      };
      // petting her cat and her dog: in front of her, low, on the side they are on
      const wpet = this.momentW('pet');
      if (wpet > 0.001) {
        const sd = (this.pet && this.pet.side) || 1;
        const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
        const cx = pos.x + fx * 1.75 + lx * sd * 2.55, cz = pos.z + fz * 1.75 + lz * sd * 2.55;
        orbitTo(cx, Math.max(pos.y + 1.2, heightAt(cx, cz) + 0.8), cz, pos.x + fx * 0.32 + lx * sd * 0.12, pos.y + 0.8, pos.z + fz * 0.32 + lz * sd * 0.12, 40, wpet);
      }
      // resting on the path: behind her shoulder, looking down past her at the path and the
      // glowing footsteps she has left on it
      const w = this.momentW('rest');
      if (w > 0.001 && this.restDir) {
        const bx = this.restDir.x, bz = this.restDir.y, sx = -bz, sz = bx;
        // (on a tall, narrow phone screen she stands nearer the middle of the shot)
        const nar = smoothstep(1.2, 0.7, this.camera.aspect), cs = lerp(1.6, 0.45, nar), ls = lerp(0.8, -0.2, nar);
        const cx = pos.x - bx * 2.6 + sx * cs, cz = pos.z - bz * 2.6 + sz * cs;
        orbitTo(cx, Math.max(pos.y + 1.7, heightAt(cx, cz) + 1.1), cz, pos.x + bx * 9 + sx * ls, pos.y - 2.5, pos.z + bz * 9 + sz * ls, 48, w);
      }
      // close to her cake as its candles light: low beside it, across the candles to her
      const kc = tr.fx('cakeCam', t);
      if (kc > 0.001) {
        const C = this.cake.group.position, e = kc * kc * (3 - 2 * kc);
        cam.set(lerp(cam.x, C.x + 0.62, e), lerp(cam.y, C.y + 1.12, e), lerp(cam.z, C.z - 1.38, e));
        look.set(lerp(look.x, C.x - 0.2, e), lerp(look.y, C.y + 0.86, e), lerp(look.z, C.z + 0.25, e));
        fov = lerp(fov, 40, e);
      }
      // after her wish, slowly drawing back, leaving her there in her garden
      if (this.wished) {
        const k = smoothstep(this.wishTime + 8, this.wishTime + 48, time), e = k * k * (3 - 2 * k);
        if (e > 0) {
          const hx = cam.x - pos.x, hz = cam.z - pos.z, hl = Math.max(0.01, Math.hypot(hx, hz));
          cam.x += (hx / hl) * 5.5 * e; cam.z += (hz / hl) * 5.5 * e; cam.y += 2.8 * e;
          // (the shot lowers to her as it draws away: she stays in the picture, sitting in her
          // garden among the lanterns, rather than slipping out of it below)
          look.y = lerp(look.y, pos.y + 1.4, 0.85 * e);
        }
      }
    }
    // (keeping her in the picture in flight: where the shot leans away from her - toward the
    // peak she is circling - a tall, narrow phone screen, which sees far less to the sides,
    // would lose her; the shot turns back just far enough to hold her inside the frame, on a
    // soft knee, so nothing changes while she is comfortably in view)
    {
      const gate = this.debugCam ? 0 : smoothstep(0.05, 0.062, t) * smoothstep(0.3, 0.6, fly);
      if (gate > 0.001) {
        const asp = this.camera.aspect;
        const kf = asp < 1.25 ? Math.pow(1.25 / asp, 0.55) : 1;
        const hv = Math.atan(Math.tan((fov * DEG) / 2) * kf);
        const hh = Math.atan(Math.tan(hv) * asp);
        const soft = (d, lim) => {
          const kn = lim * 0.6, a = Math.abs(d);
          return a <= kn ? d : Math.sign(d) * (kn + (lim - kn) * (1 - Math.exp(-(a - kn) / (lim - kn))));
        };
        const vx = look.x - cam.x, vy = look.y - cam.y, vz = look.z - cam.z;
        const hx = pos.x - cam.x, hy = pos.y + 0.6 - cam.y, hz = pos.z - cam.z;
        const yawV = Math.atan2(vx, vz);
        let dyw = Math.atan2(hx, hz) - yawV;
        dyw = Math.atan2(Math.sin(dyw), Math.cos(dyw));
        const pitV = Math.atan2(vy, Math.hypot(vx, vz));
        const dp = Math.atan2(hy, Math.hypot(hx, hz)) - pitV;
        const ny = yawV + (dyw - soft(dyw, hh * 0.78)) * gate;
        const np = pitV + (dp - soft(dp, hv * 0.8)) * gate;
        const L = Math.hypot(vx, vy, vz);
        look.set(cam.x + Math.sin(ny) * Math.cos(np) * L, cam.y + Math.sin(np) * L, cam.z + Math.cos(ny) * Math.cos(np) * L);
      }
    }
    // gentle handheld drift when idle
    if (!red && !this.debugCam) {
      cam.x += Math.sin(time * 0.31) * 0.05 * Math.min(dist, 10) * 0.1;
      cam.y += Math.sin(time * 0.43) * 0.04 * Math.min(dist, 10) * 0.1;
    }
    this.camera.position.copy(cam);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look);
    if (!red && roll) this.camera.rotateZ(roll * DEG);
    const asp = this.camera.aspect;
    const k = asp < 1.25 ? Math.pow(1.25 / asp, 0.55) : 1;
    const fovV = (2 * Math.atan(Math.tan((fov * DEG) / 2) * k)) / DEG;
    if (Math.abs(fovV - this.lastFov) > 0.01) {
      this.camera.fov = fovV;
      this.camera.updateProjectionMatrix();
      this.lastFov = fovV;
      const scale = (this.h * this.dpr) / (2 * Math.tan((fovV * DEG) / 2));
      this.pointMats.forEach((m) => { if (m.uniforms.uScale) m.uniforms.uScale.value = scale; });
    }
    this.sky.position.copy(cam);
    this.shooting.update(time, this.camera, t > 0.87 && !red, this.wished ? this.wishTime : null);
    // her cat
    {
      const c = this.catCtx;
      c.t = t; c.time = time; c.her.copy(pos); c.herYaw = yaw; c.fly = fly; c.walk = P.walkAmt; c.kneel = this.kneelTL;
      c.cam.copy(cam); c.reduced = red; c.night = U.uNight.value;
      c.burstAge = this.bloomBurst.fired ? this.bloomBurst.tau : -1;
      c.wishAge = this.wished ? time - this.wishTime : -1;
      c.herFly = this.herFly.mesh.visible && this.perchS && this.perchS.on ? this.herFly.pos : null;
      c.hug = this.hug && this.hug.state !== 'idle' ? this.hug : this.reunion && this.reunion.state !== 'idle' ? this.reunion : this.archHug && this.archHug.state !== 'idle' ? this.archHug : null;
      c.twirl = this.twirlAt && time - this.twirlAt.t0 < 0.3 ? this.twirlAt : null;
      if (!c.ribbon) c.ribbon = [new THREE.Vector3(), new THREE.Vector3()];
      this.char.ribbonEnd(0, c.ribbon[0]); this.char.ribbonEnd(1, c.ribbon[1]);
      c.dog = this.dog.A; c.dogVisible = this.dog.group.visible;
      this.cat.update(dt, c);
      // her dog
      {
        const d = this.dogCtx;
        d.t = t; d.time = time; d.her.copy(pos); d.herYaw = yaw; d.fly = fly; d.walk = P.walkAmt; d.kneel = this.kneelTL;
        d.cam.copy(cam); d.reduced = red; d.night = U.uNight.value;
        d.burstAge = c.burstAge; d.wishAge = c.wishAge; d.herFly = c.herFly; d.hug = c.hug;
        d.summitSit = c.summitSit; d.cat = this.cat.A; d.catVisible = this.cat.group.visible;
        d.catPet = !!(this.pet && this.pet.w > 0.05);
        d.camera = this.camera;
        this.dog.update(dt, d);
      }
      // (a paw batting at a tail of her sash: it swings)
      {
        const h = this.cat.A.swatHit;
        if (h && h.id !== this.swatSeen) {
          this.swatSeen = h.id;
          // (the cat's left paw is on her left: that tail; knocked in, up and back)
          const sd = h.paw === 1 ? 1 : -1;
          this.char.swatRibbon(h.paw === 1 ? 1 : 0, -sd * (0.3 + Math.random() * 0.25), 0.12, -0.22 - Math.random() * 0.1);
        }
      }
      // (not drawn at all while it is out of the picture: the fur layers are not cheap)
      {
        const cam = this.camera;
        cam.updateMatrixWorld();
        const F = this._frus || (this._frus = new THREE.Frustum());
        const M = this._frusM || (this._frusM = new THREE.Matrix4());
        M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        F.setFromProjectionMatrix(M);
        const sph = this._catS || (this._catS = new THREE.Sphere(new THREE.Vector3(), 0.75));
        sph.center.copy(this.cat.mesh.position); sph.center.y += 0.25;
        this.cat.mesh.visible = F.intersectsSphere(sph);
        sph.center.copy(this.dog.mesh.position); sph.center.y += 0.25;
        this.dog.mesh.visible = F.intersectsSphere(sph);
      }
      // (the grass and flowers part around her and around her cat)
      {
        const A = this.cat.A, hk = 1 - smoothstep(0.02, 0.2, fly);
        U.uPush0.value.set(pos.x, pos.z, 0.5 + 0.25 * P.kneel, 0.15 * hk);
        const held = this.cat.P.held || 0;
        U.uPush1.value.set(A.x, A.z, 0.36, this.cat.group.visible ? 0.13 * (1 - held) : 0);
        const D = this.dog.A;
        U.uPush2.value.set(D.x, D.z, 0.34, this.dog.group.visible ? 0.12 * (1 - (this.dog.P.flop || 0) * 0.5) : 0);
      }
      // (rubbing against her it presses into her skirt, and drags it along a little)
      {
        const A = this.cat.A, r = A.rub || 0;
        if (r > 0.01) {
          const dx = A.x - pos.x, dz = A.z - pos.z, d = Math.max(Math.hypot(dx, dz), 1e-3);
          const vt = (A.vx * -dz + A.vz * dx) / d;
          this.char.setPush(A.x, A.z, 0.042 * r * smoothstep(0.5, 0.38, d), clamp(vt * 0.05, -0.03, 0.03) * r);
        } else this.char.setPush(0, 0, 0, 0);
      }
      // with the music on, its little voice: a mew when it meows, a purr while she strokes it
      if (this.music.on) {
        const A = this.cat.A;
        if (A.m0 !== undefined && A.m0 !== this.mewAt && time >= A.m0 && time - A.m0 < 0.3) { this.mewAt = A.m0; this.music.meow(A.yawn > 0.3 ? 1.3 : 1); }
        this.music.purr((A.mode === 'pet' && (c.petAmt || 0) > 0.6) || (A.rub || 0) > 0.6);
        if (A.sneezeAt !== undefined && A.sneezeAt !== this.sneezeHeard) { this.sneezeHeard = A.sneezeAt; this.music.sneeze(); }
        // and the dog's yips
        const D = this.dog.A;
        if (D.barks) for (const b0 of D.barks) { if (time >= b0 && time - b0 < 0.25 && !(this.yipped || []).includes(b0)) { (this.yipped = this.yipped || []).push(b0); if (this.yipped.length > 8) this.yipped.shift(); this.music.yip(); } }
      } else if (this.music.purrN) this.music.purr(false);
    }

    // --- effects ---
    const fxv = (n) => tr.fx(n, t);
    U.uWind.value = fxv('wind') * (red ? 0.4 : 1);
    U.uMist.value = fxv('mist');
    this.mist.mat.uniforms.uOpacity.value = fxv('mist');
    this.mist.mesh.visible = fxv('mist') > 0.01;
    // trail
    const tm = this.trail.mat.uniforms;
    tm.uHead.value = s + (fly > 0.5 ? 0.0 : -0.25);
    tm.uTail.value = fxv('trailTail');
    tm.uWidth.value = fxv('trailWidth');
    tm.uAhead.value = fxv('ahead');
    tm.uAheadEnd.value = this.wpS.cake;
    // dust shed from her
    const bodyC = this.v.tmp.copy(pos); bodyC.y += fly > 0.5 ? 0 : 0.9;
    this.dust.update(time, dt, bodyC, fxv('dust'), fly > 0.5 ? 0.9 : 0.5, red);
    // wings into gold
    this.wingDust.update(P.dissolve, this.char);
    // garden
    const bloom = fxv('bloom');
    this.flower.update(bloom, time, fxv('pollen'));
    // the burst fires once as the flower opens (scrolling forward through it), and is
    // undone when scrolling back before it
    const BT = 0.4612;
    const bb = this.bloomBurst;
    if (!bb.fired && this.prevT !== undefined && this.prevT < BT && t >= BT && t < 0.5) {
      bb.fire(time);
      this.ohT = time + 0.05;
      if (this.music.on) this.music.bloom();
    }
    if (bb.fired && t < 0.455) bb.reset();
    this.prevT = t;
    const bs = bb.update(time, this.camera, red);
    // the flower itself swells as it bursts, and springs back
    const pop = bb.fired ? Math.exp(-bs.tau * 3.2) * Math.sin(Math.min(bs.tau, 3) * 13) : 0;
    this.flower.headPivot.scale.setScalar(1 + 0.34 * pop * (red ? 0.4 : 1));
    // once it has fired, the shockwave is the burst's (real time); before, the scroll's
    U.uRipple.value.set(FLOWER.x, 0, FLOWER.z, bb.fired ? bs.R * 0.97 : fxv('ripple'));
    // (and the golden band is gone once she walks on, however quickly the page is scrolled)
    U.uRippleAmt.value = (bb.fired ? bs.A : fxv('rippleAmt')) * (1 - smoothstep(0.515, 0.55, t));
    // the bloom: the wave from the flower, then flowers wherever she walks
    const bloomR = Math.max(fxv('bloomR'), bs.R);
    U.uBloomR.value = bloomR;
    U.uWalkS.value = t > 0.5 ? s : -1e4;
    // each flower takes the same time to grow once the bloom reaches it (see GROW_GLSL)
    const gw = this.growTrack('wave', bloomR, 1.25), gk = this.growTrack('walk', U.uWalkS.value, 0.95);
    for (const m of this.veg.growMats) {
      const g = m.userData.growMode === 'wave' ? gw : gk;
      m.uniforms.uGrowKey.value = g.k;
      m.uniforms.uGK.value.set(g.a, g.b, g.c, g.d);
    }
    const cTarget = this.v.comp.set(pos.x, pos.y + (fly > 0.5 ? 0.2 : 0.75), pos.z);
    this.companions.update(dt, cTarget, this.flowerTop, fxv('companions'), fxv('flies') * (red ? 0.7 : 1), fxv('cfire'));
    // footsteps
    U.uStepS.value = s - this.wpS.trailStart;
    U.uFootAmt.value = fxv('foot');
    this.foot.mat.uniforms.uStep.value = s;
    // (glowing brighter as she rests and looks back at them)
    this.foot.mat.uniforms.uAmt.value = fxv('foot') * (1 + 1.4 * this.momentW('rest'));
    this.foot.mesh.visible = fxv('foot') > 0.01;
    const rip = fxv('ripple');
    this.rippleSp.mat.uniforms.uClock.value = rip;
    this.rippleSp.mesh.visible = !bb.fired && rip > 0.5 && fxv('rippleAmt') > 0.01;
    this.rippleSp.mat.uniforms.uOpacity.value = Math.min(1, fxv('rippleAmt') * 1.5);
    // islands bob
    const isl = fxv('islands');
    this.islands.group.visible = isl > 0.01;
    this.islands.mat.uniforms.uAmbAdd.value = lerp(0.24, 0.12, U.uNight.value);
    if (isl > 0.01) {
      this.islands.list.forEach((it) => {
        it.holder.position.y = it.base.y + Math.sin(time * 0.35 + it.phase) * (red ? 0.4 : 1.6);
        it.holder.rotation.y = Math.sin(time * 0.05 + it.phase) * 0.25;
      });
    }
    const pas = fxv('passion');
    this.passion.group.visible = pas > 0.01;
    this.passion.items.forEach((it) => {
      it.m.material.uniforms.uOpacity.value = pas;
      it.halo.material.uniforms.uOpacity.value = pas * 0.35;
      it.m.position.y = it.base.y + Math.sin(time * 0.5 + it.seed) * 1.5;
      it.halo.position.copy(it.m.position);
    });
    this.passion.sparkles.mat.uniforms.uOpacity.value = pas;
    this.passion.sparkles.mat.uniforms.uClock.value = 10;
    // star arc
    const arc = fxv('arc');
    const am = this.arc.mat.uniforms;
    am.uHead.value = arc * this.arc.len;
    am.uIntensity.value = fxv('arcFade') * 1.2;
    this.arc.mesh.visible = arc > 0.001;
    this.arc.stars.mat.uniforms.uClock.value = arc * this.arc.len;
    this.arc.stars.mesh.visible = arc > 0.001;
    this.arc.stars.mat.uniforms.uOpacity.value = 1 + (this.wished ? smoothstep(this.wishTime, this.wishTime + 2, time) * 0.6 : 0);
    if (arc > 0.001) this.updateTextMask(t);
    // cake & wish
    if (this.wished && t < 0.84) this.resetWish();
    const bT2 = this.blowT || 0;
    const lit = fxv('candles') * (this.wished ? 1 - smoothstep(this.wishTime + bT2 * 0.82, this.wishTime + (bT2 ? 0.98 : 0.7), time) : 1);
    this.cake.update(time, lit, red, this.blowAmt || 0, pos);
    {
      // (close to the candles, their glow drawn in: the numbers stay readable in the light)
      const kc = tr.fx('cakeCam', t);
      if (kc > 0.001) for (const f of this.cake.flames) { f.fg2.material.uniforms.uOpacity.value *= 1 - 0.65 * kc; f.fg.material.uniforms.uOpacity.value *= 1 - 0.35 * kc; }
    }
    const flamePos = this.cake.worldFlame();
    U.uPointPos.value.copy(flamePos);
    U.uPointAmt.value = fxv('candleLight') * lit * 0.55;
    U.uPointCol.value.copy(this.candleCol);
    {
      // the sunbeams at the bloom, and the warm light they pour round her
      const rays = fxv('rays') * (red ? 0.6 : 1);
      this.sunRays.update(rays);
      if (rays > 0.001 && U.uPointAmt.value < 0.001) {
        U.uPointPos.value.copy(this.sunRays.lightPos);
        U.uPointCol.value.copy(this.sunRays.lightCol);
        U.uPointAmt.value = 0.45 * rays;
      }
    }
    this.burst.update(time);
    this.ffClearing.mat.uniforms.uOpacity.value = fxv('fireflies');
    this.ffGarden.mat.uniforms.uOpacity.value = smoothstep(0.3, 0.42, t) * (1 - smoothstep(0.5, 0.56, t)) * 0.6;
    this.motes.mat.uniforms.uOpacity.value = fxv('motes') * (red ? 0.4 : 1);
    // string lights, butterflies, petals
    this.lights.set(fxv('lights'));
    this.butterflies.mesh.visible = t >= 0.27 && t <= 0.53;
    this.butterflies.mat.uniforms.uOpacity.value = 1;
    this.butterflies.mat.uniforms.uFlowerOn.value = smoothstep(0.462, 0.482, t) * (1 - smoothstep(0.51, 0.53, t));
    const pet = fxv('petals') * (red ? 0.5 : 1);
    this.petals.mat.uniforms.uOpacity.value = pet;
    this.petals.mesh.visible = pet > 0.01;
    // golden motes lifting from each footprint as it lights up
    this.stepMotes.mat.uniforms.uClock.value = time;
    const steps = this.foot.steps;
    if (fxv('foot') > 0.3 && steps.length) {
      let k = this.lastStep < 0 ? 0 : this.lastStep;
      while (k < steps.length - 1 && steps[k + 1][4] <= s) k++;
      while (k > 0 && steps[k][4] > s) k--;
      if (k !== this.lastStep && this.lastStep >= 0 && steps[k][4] <= s) {
        const st = steps[k], r = this.stepMotes.rnd;
        for (let i = 0; i < (red ? 2 : 6); i++) {
          this.stepMotes.emit(st[0] + (r() - 0.5) * 0.18, st[1] - 0.1 + r() * 0.05, st[2] + (r() - 0.5) * 0.3,
            (r() - 0.5) * 0.12, 0.18 + r() * 0.3, (r() - 0.5) * 0.12, time + r() * 0.25, 1.6 + r() * 1.6, 0.018 + r() * 0.02);
        }
        this.stepMotes.dirty();
      }
      this.lastStep = k;
    } else this.lastStep = -1;
    // (the birthday tune plays as his words begin - the narrator has fallen silent)
    if (this.music.on && !this.hbPlayed && t > 0.919 && t < 0.99) { this.hbPlayed = true; this.startSong(this.music.happyBirthday()); }
    if (t < 0.8) this.hbPlayed = false;
    // her cake: it appears beside her, in a shimmer of light, as her cat and dog come to her
    if (this.cakeTop) {
      const x = smoothstep(0.836, 0.847, t);
      const ob = x >= 1 ? 1 : 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
      this.cakeTop.visible = x > 0.002;
      this.cakeTop.scale.setScalar(Math.max(0.002, ob));
      if (t >= 0.8375 && !this.cakeShown) {
        this.cakeShown = true;
        const c = this.cake.group.position;
        this.burst.fire(time, this._cakeP || (this._cakeP = new THREE.Vector3()).set(c.x, c.y + 0.8, c.z));
        if (this.music.on) this.music.chime();
      }
      if (t < 0.83) this.cakeShown = false;
    }

    // --- visibility by world (keeps the frame cheap) ---
    const vis = (a, b) => t >= a && t <= b;
    // (the sea of clouds lies over the whole valley until it parts, after she has landed)
    this.clouds.group.visible = vis(0, 0.31);
    this.mountains.sea.visible = vis(0, 0.31);
    {
      // the clouds hanging under it: from when she dives into it until she is down in the
      // garden (faded out where they are off to the side)
      const V = this.clouds.valley, on = vis(0.17, 0.5);
      V.root.visible = on;
      V.mat.uniforms.uOpacity.value = 1 - smoothstep(0.47, 0.5, t);
      if (on) V.sort(this.camera);
    }
    this.mountains.hero.visible = vis(0, 0.3);
    if (this.clouds.group.visible) this.clouds.sprites.sort(this.camera);
    this.post.needSoftDepth = this.clouds.group.visible || this.clouds.valley.root.visible;
    // (seen from above its highest heaps, only the sea's upper faces can show: one pass with
    // the undersides skipped, instead of a pass for each side)
    if (this.clouds.group.visible && this.clouds.sea) {
      const S = this.clouds.sea, above = this.camera.position.y > S.userData.seaTop + 1;
      S.material.forceSinglePass = above;
      S.material.uniforms.uFrontOnly.value = above ? 1 : 0;
    }
    this.veg.groups.garden.visible = vis(0.14, 0.565);
    this.veg.groups.trail.visible = vis(0.24, 0.9);
    this.veg.groups.valley.visible = vis(0.12, 1);
    this.veg.groups.clearing.visible = vis(0.6, 1);
    this.veg.groups.bloomWave.visible = vis(0.456, 0.585);
    this.veg.groups.bloomWalk.visible = vis(0.5, 1);
    // (from high in the descent: far off the blades are sunk into the ground, and they rise
    // as she comes down, rather than the whole meadow's grass appearing at once)
    this.veg.groups.grassA.visible = vis(0.2, 0.585);
    this.veg.groups.grassB.visible = vis(0.5, 0.9);
    // precomputed visibility of the vegetation chunks along the camera's path
    // (and flowers that have not started to grow yet are skipped)
    const pi = Math.round(t * (this.pvsN - 1));
    for (const m of this.veg.chunks) {
      let on = this.debugCam || this.noPVS ? true : m.userData.pvs[pi] === 1;
      const gm = m.material.userData.growMode;
      if (on && gm) on = (gm === 'wave' ? bloomR : U.uWalkS.value) > m.userData.minKey;
      m.visible = on;
    }
    this.arch.visible = vis(0.16, 0.5);
    this.treePetals.update(time, smoothstep(0.15, 0.2, t) * (1 - smoothstep(0.54, 0.565, t)));
    this.flower.group.visible = vis(0.18, 0.62);
    this.ffGarden.mesh.visible = vis(0.3, 0.56);
    this.ffClearing.mesh.visible = vis(0.76, 1);
    this.cake.group.visible = vis(0.6, 1);

    // --- post ---
    const pu = this.post.uniforms, ps = this.post.shared, ex = this.envExtra;
    pu.uTime.value = time;
    // lens blur sized to the screen's short side (a tall phone screen would otherwise get
    // more than twice the softening a landscape one does)
    const short = Math.min(this.w, this.h);
    // (crisp edge to edge: no lens blur toward the frame edges; the background softens only
    // gently, and only in the close moments)
    ps.uEdge.value = 0;
    ps.uDofMax.value = 0.006 * short * this.dpr;
    ps.uDof.value = fxv('dof') * (red ? 0.5 : 1);
    const fy = 1.05 * (1 - fly);
    ps.uFocus.value = this.debugCam ? cam.distanceTo(look) : Math.max(0.5, Math.hypot(cam.x - pos.x, cam.y - (pos.y + fy), cam.z - pos.z));
    pu.uEdgeTint.value.copy(ex.edge);
    pu.uLift.value.copy(ex.lift); pu.uGain.value.copy(ex.gain);
    pu.uSat.value = ex.sat; pu.uVib.value = ex.vib; pu.uContrast.value = ex.contrast;
    pu.uBloom.value = ex.bloom * fxv('bloomBoost');
    pu.uWhite.value = 0;
    // --- the sea of clouds over the valley ---
    {
      const su = this.clouds.seaMat.uniforms, base = CLOUD_BASE + 4;
      // it parts once she has landed: a ragged opening over the meadow, widening until the
      // sky over the whole valley is clear (then the far remains fade from view)
      // (opening steadily over her first moments on the ground - the light pouring in - then
      // the rest of it melting away)
      const op = smoothstep(0.259, 0.29, t), op2 = smoothstep(0.29, 0.31, t);
      su.uHole.value.set(0, -640, op <= 0 ? -2000 : lerp(-260, 1300, op) + 2100 * op2, 340);
      su.uOpacity.value = 1 - smoothstep(0.296, 0.31, t);
      // passing down through it: everything but the nearest few metres melts into glowing
      // white, from just above its surface until well under its base
      let inDeck = 0;
      if (t > 0.1 && t < 0.25 && cam.y < base + 80 && cam.y > base - 40) {
        const top = this.clouds.seaTopAt(cam.x, cam.z, time);
        inDeck = smoothstep(top + 4, top - 9, cam.y) * smoothstep(base - 30, base - 6, cam.y);
      }
      this.inDeck = inDeck;
      // (the story's words step aside while all is white)
      const cl = inDeck > 0.25 ? '1' : '';
      if ((this.root.dataset.cloud || '') !== cl) { if (cl) this.root.dataset.cloud = cl; else delete this.root.dataset.cloud; }
      pu.uCloudIn.value = inDeck;
      pu.uCloudCol.value.copy(ex.cloudLit);
      // under the closed deck the valley lies in soft, cool shade; it brightens as it parts
      const oc = t < 0.15 ? 0 : smoothstep(base + 8, base - 40, cam.y) * (1 - smoothstep(0.262, 0.3, t));
      if (oc > 0) {
        U.uSunCol.value.multiplyScalar(1 - 0.5 * oc);
        U.uLightTint.value.lerp(OVERCAST.light, 0.55 * oc);
        U.uShadowTint.value.lerp(OVERCAST.shade, 0.35 * oc);
        U.uFogCol.value.lerp(OVERCAST.fog, 0.4 * oc);
        pu.uGain.value.multiplyScalar(1 - 0.07 * oc);
        pu.uSat.value *= 1 - 0.1 * oc;
        pu.uBloom.value *= 1 - 0.35 * oc;
      }
    }
    this.clouds.seaMat.uniforms.uLit.value.copy(this.envExtra.cloudLit);
    this.clouds.seaMat.uniforms.uShadeC.value.copy(this.envExtra.cloudShade);
    for (const v of this.clouds.veils) { v.material.uniforms.uLit.value.copy(this.envExtra.cloudLit); v.material.uniforms.uShadeC.value.copy(this.envExtra.cloudShade); }
    this.clouds.puffMat.uniforms.uLit.value.copy(this.envExtra.cloudLit);
    this.clouds.puffMat.uniforms.uShadeC.value.copy(this.envExtra.cloudShade);
    this.clouds.valley.mat.uniforms.uLit.value.copy(this.envExtra.cloudLit);
    this.clouds.valley.mat.uniforms.uShadeC.value.copy(this.envExtra.cloudShade);
    // flying through a cloud over the valley: a soft white veil while the camera is inside it
    if (this.clouds.valley.root.visible) {
      let fog = 0;
      for (const b of this.clouds.valley.clusters) {
        const dx = (cam.x - b.cx) / b.rx, dy = (cam.y - b.cy) / b.ry, dz = (cam.z - b.cz) / b.rz;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (r < 1) fog = Math.max(fog, (1 - smoothstep(0.45, 1.0, r)) * b.dense);
      }
      pu.uWhite.value = Math.max(pu.uWhite.value, fog * 0.8 * (red ? 0.5 : 1));
    }

    this.updateUI();
  }

  render() {
    this.U.uMSAA.value = this.post.sceneRT.samples > 0 ? 1 : 0;
    this.U.uPxK.value = 2 * Math.tan(this.camera.fov * Math.PI / 360) / Math.max(1, this.post.ph || 1);
    this.lastInfo = this.post.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  queryDom() {
    const r = this.root;
    const map = {};
    BEATS.forEach(([id, a, b], i) => { map[id] = { a, b, last: i === BEATS.length - 1 }; });
    this.beatEls = [];
    r.querySelectorAll('[data-beat]').forEach((el) => {
      const id = el.getAttribute('data-beat');
      if (map[id]) this.beatEls.push({ el, id, ...map[id], last: map[id].last, cache: {} });
    });
    this.progressEl = r.querySelector('[data-progress]');
    this.dotEls = Array.from(r.querySelectorAll('.bj-dot'));
    if (!this.story.dom || !this.story.dom.box.isConnected) this.story.bindDom(r);
    this._dotCh = -1;
    this.measureUI();
  }
  measureUI() {
    if (!this.progressEl) return;
    const track = this.progressEl.parentElement;
    this.progTravel = track ? Math.max(0, track.clientHeight - this.progressEl.clientHeight) : 0;
  }
  setVar(b, k, v) {
    const s = v.toFixed(3);
    if (b.cache[k] !== s) { b.cache[k] = s; b.el.style.setProperty(k, s); }
  }
  updateUI() {
    const t = this.t;
    if (!this.beatEls || (this.frameCount % 60 === 0 && this.beatEls.length && !this.beatEls[0].el.isConnected) || (this.beatEls.length === 0 && this.frameCount % 60 === 0)) this.queryDom();
    let scrim = 0;
    for (const b of this.beatEls) {
      const q = (t - b.a) / (b.b - b.a);
      let vin, vout;
      if (b.id === 'hero') {
        // (the title gives way as soon as the story sets off)
        const p = clamp(t / 0.0045, 0, 1);
        this.setVar(b, '--p', p);
        vin = 1; vout = smoothstep(0.35, 1, p);
      } else {
        vin = b.last ? smoothstep(0, 0.32, q) : smoothstep(0, 0.22, q);
        vout = b.last ? 0 : smoothstep(0.8, 1, q);
        this.setVar(b, '--split', smoothstep(0.1, 0.34, q) * (1 - vout));
      }
      this.setVar(b, '--in', vin);
      this.setVar(b, '--out', vout);
      const on = vin * (1 - vout) > 0.02 ? '1' : '0';
      if (b.cache.on !== on) { b.cache.on = on; b.el.setAttribute('data-on', on); b.el.setAttribute('aria-hidden', on === '1' ? 'false' : 'true'); }
      if (b.id !== 'hero') scrim = Math.max(scrim, vin * (1 - vout));
    }
    if (this.post) this.post.uniforms.uScrim.value = scrim * 0.5;
    if (this.progressEl) {
      const y = (t * (this.progTravel || 0)).toFixed(1);
      if (this._py !== y) { this._py = y; this.progressEl.style.transform = `translate3d(0, ${y}px, 0)`; }
    }
    const ch = t >= CHAPTERS[3] ? 3 : t >= CHAPTERS[2] ? 2 : t >= CHAPTERS[1] ? 1 : 0;
    const chs = String(ch);
    if (this.root.dataset.chapter !== chs) this.root.dataset.chapter = chs;
    if (this.dotEls && this._dotCh !== ch) {
      this._dotCh = ch;
      this.dotEls.forEach((d, i) => { if (i === ch) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
    }
    const wish = this.wished ? 'done' : this.story.wishReady || (this.failed && t > 0.955) ? 'ready' : '';
    if ((this.root.dataset.wish || '') !== wish) this.root.dataset.wish = wish;
    // (a soft scrim behind the story's words)
    if (this.post && this.story.shown) this.post.uniforms.uScrim.value = Math.max(this.post.uniforms.uScrim.value, 0.42);
  }

  // -------------------------------------------------------------------------
  // public API
  goToChapter(i) {
    // (the story is told in order: only back to its very beginning)
    if ((i | 0) !== 0) return;
    this.restart();
  }
  restart() {
    const r = this.root;
    const target = 0;
    this.story.reset(0);
    this.resetWish();
    this.hbPlayed = false;
    delete r.dataset.end;
    if (this.reduced || this.failed) { this.travel = true; this.setT(0); return; }
    clearTimeout(this._veilA); clearTimeout(this._veilB);
    r.dataset.veil = '1';
    this._veilA = setTimeout(() => {
      this.travel = true;
      this.setT(target);
      this._veilB = setTimeout(() => { delete r.dataset.veil; }, 260);
    }, 560);
  }
  // after the end: stay a while longer (the closing words go, the garden stays)
  stay() { this.root.dataset.end = 'stay'; }
  // the opening: begin the story with its voice and music (a click: sound may start)
  async begin() {
    const ok = this.music.on ? true : await this.music.start();
    this.root.dataset.sound = ok ? 'on' : 'off';
    this.story.setSound(ok, this.opts.voice);
    this.lastInput = performance.now();
    // (and the story sets off: the title gives way, the first words are told)
    if (this.t < 0.004) {
      const r = this.root, max = r.scrollHeight - r.clientHeight;
      this.tTarget = Math.max(this.tTarget, 0.03);
      if (max > 0) r.scrollTop = this.tTarget * max;
    }
    return ok;
  }
  _goToChapterOld(i) {
    const r = this.root;
    const max = r.scrollHeight - r.clientHeight;
    const target = CHAPTER_JUMP[clamp(i | 0, 0, 3)];
    // a long way (begin again from the end, or across two worlds): a soft veil of light
    // falls, the story is there, the veil lifts - rather than racing through everything
    if (Math.abs(target - this.t) > 0.35 && !this.reduced && !this.failed) {
      clearTimeout(this._veilA); clearTimeout(this._veilB);
      r.dataset.veil = '1';
      this._veilA = setTimeout(() => {
        this.travel = false;
        this.setT(target);
        this._veilB = setTimeout(() => { delete r.dataset.veil; }, 260);
      }, 560);
      return;
    }
    this.travel = true;
    r.scrollTo({ top: target * max, behavior: 'auto' });
    this.tTarget = target;
  }
  async toggleSound() {
    if (this.music.on) { this.music.stop(); this.story.setSound(false); this.root.dataset.sound = 'off'; return false; }
    const ok = await this.music.start();
    this.root.dataset.sound = ok ? 'on' : 'off';
    this.story.setSound(ok, this.opts.voice);
    if (ok && this.t > 0.919 && this.t < 0.99 && !this.hbPlayed) { this.hbPlayed = true; this.startSong(this.music.happyBirthday()); }
    return ok;
  }
  // the birthday tune is playing: her cat sings the end of each line, she sways along
  startSong(s) {
    if (!s) return;
    this.song = { t0: this.time, len: s.len, beat: s.beat, sing: s.sing.map((x) => ({ t: this.time + x.at, d: x.d })) };
  }
  makeWish() {
    if (this.wished || this.failed) { if (this.failed) { this.wished = true; this.root.dataset.wish = 'done'; } return; }
    this.wished = true;
    this.wishTime = this.time;
    // she leans in and blows out her candles first (at once, with reduced motion)
    this.blowT = this.reduced ? 0 : 1.0;
    const fp = this.cake.worldFlame();
    this.cake.puff(this.time + (this.blowT ? 0.92 : 0.4));
    this.burst.fire(this.time + (this.blowT ? 0.88 : 0.35), fp);
    this.lanterns.fire(this.time + this.blowT, this.char.root.position, this.char.root.rotation.y, CAKE);
    this.music.chime();
    this.root.dataset.wish = 'done';
    this.story.onWish(this.time);
  }
  resetWish() {
    this.wished = false;
    this.blowT = 0;
    this.root.dataset.wish = '';
    this.lanterns.reset();
  }
  setOptions(o) {
    const n = { ...this.opts, ...cleanOpts(o || {}) };
    const changed = (k) => n[k] !== this.opts[k];
    if (this.char) {
      const look = {};
      if (changed('hair')) look.hair = n.hair;
      if (changed('skin')) look.skin = n.skin;
      if (changed('dress')) look.dress = n.dress;
      if (changed('glasses')) look.glasses = n.glasses !== false && n.glasses !== 'false';
      if (Object.keys(look).length) this.char.setLook(look);
    }
    if (changed('trail') && this.U) this.U.uGold.value.set(n.trail);
    this.opts = n;
    if (changed('motion') || true) this.updateReduced();
  }
  setT(t) {
    t = clamp(t, 0, 1);
    // (a jump: the story picks up from there - what came before counts as told)
    this.story.reset(t);
    const r = this.root;
    const max = r.scrollHeight - r.clientHeight;
    r.scrollTop = t * max;
    this.tTarget = t;
    this.jumpTo = t;
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.root.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    if (this.mq && this.onMq) this.mq.removeEventListener('change', this.onMq);
    this.music.dispose();
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => {
            for (const k in m.uniforms || {}) { const v = m.uniforms[k].value; if (v && v.isTexture) v.dispose(); }
            m.dispose();
          });
        }
      });
    }
    if (this.cat) this.cat.mesh.skeleton.dispose();
    if (this.dog) this.dog.mesh.skeleton.dispose();
    if (this.post) this.post.dispose();
    if (this.renderer) { this.renderer.dispose(); }
  }
}
