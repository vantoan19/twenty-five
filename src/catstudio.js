// Dev-only cat studio: renders her cat (and optionally her, for scale) with the journey's
// materials, light and post pipeline. Not shipped.
import * as THREE from 'three';
import { makeNoiseData, makeNoiseTexture } from './noisetex.js';
import { makeSharedUniforms, skyMaterial, toonMaterial } from './shaders.js';
import { Post } from './post.js';
import { applyEnv } from './env.js';
import { makeTracks, POSE } from './timeline.js';
import { Character, contactShadow } from './character.js';
import { Cat } from './cat.js';
import { Dog } from './dog.js';
import { DEG } from './math.js';

THREE.ColorManagement.enabled = false;

export function mount(canvas, { quality = 'high' } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: true, stencil: false });
  r.outputColorSpace = THREE.LinearSRGBColorSpace;
  const post = new Post(r, quality);
  post.split = false;
  const U = makeSharedUniforms(makeNoiseTexture(makeNoiseData(256)));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 9000);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 40, 24), skyMaterial(U));
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  const extra = { edge: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), lift: new THREE.Color(), gain: new THREE.Color(1, 1, 1), sat: 1, contrast: 1, bloom: 0.7 };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), toonMaterial(U, { color: '#8fb865', shade: '#56804c', rim: 0, fogScale: 0.3 }));
  ground.geometry.rotateX(-Math.PI / 2);
  scene.add(ground);
  for (let i = 0; i < 7; i++) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), toonMaterial(U, { color: i % 2 ? '#76a85a' : '#5f9a52', shade: '#3f6a48', rim: 0.1, fogScale: 1 }));
    const a = (i / 7) * Math.PI * 2;
    h.position.set(Math.sin(a) * 26, -6, Math.cos(a) * 26);
    h.scale.set(10, 9, 10);
    scene.add(h);
  }
  const ch = new Character(U, { hair: '#231b1e', skin: '#f3c9ad', dress: '#f7f2e7', quality });
  ch.setLook({ glasses: true });
  scene.add(ch.root);
  const shadow = contactShadow(0.4, 1.25, 0.95);
  shadow.position.y = 0.03;
  scene.add(shadow);
  const cat = new Cat(U, { quality });
  scene.add(cat.group);
  const dog = new Dog(U, { quality });
  scene.add(dog.group);
  const tracks = makeTracks();
  const flow = new THREE.Vector3();
  const look = new THREE.Vector3();
  let W = 1, H = 1;

  function size(w, h) {
    W = w; H = h;
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render({ t = 0.3, view = {}, time = 2.0, pose = {}, env = null, dof = 0, her = true, herPos = [0, 0, 0], herYaw = 0, catPos = [0.7, 0, 0.3], catYaw = 0, cat: cp = {}, noDraw = false, showCat = true, dogPos = [-0.7, 0, 0.3], dogYaw = 0, dog: dp = {}, showDog = true } = {}) {
    U.uTime.value = time;
    applyEnv(tracks.env(env ?? t), U, sky, extra);
    const P = {};
    for (const k in POSE) P[k] = tracks.pose(k, t);
    P.walkPhase = 0; P.flapSpeed = 2; P.torsoYaw = 0;
    Object.assign(P, pose);
    ch.root.visible = her; shadow.visible = her;
    ch.root.position.set(herPos[0], herPos[1], herPos[2]);
    ch.root.rotation.set(0, herYaw, 0, 'YXZ');
    ch.pose(P, time, false);
    flow.set(0, 0.15, 0).multiplyScalar(0.05);
    ch.setFlow(flow, 1.0, 1.0);
    shadow.position.set(herPos[0], 0.03, herPos[2]);
    // the cat
    const CP = Object.assign(cat.defaultPose(), cp, { time });
    cat.pose(CP);
    cat.mesh.position.set(catPos[0], catPos[1], catPos[2]);
    cat.mesh.rotation.set(0, catYaw, 0, 'YXZ');
    cat.shadow.position.set(catPos[0], 0.02, catPos[2]);
    cat.shadow.rotation.set(0, catYaw, 0);
    cat.group.visible = showCat;
    // the dog
    const DP = Object.assign(dog.defaultPose(), dp, { time });
    dog.pose(DP);
    dog.mesh.position.set(dogPos[0], dogPos[1], dogPos[2]);
    dog.mesh.rotation.set(0, dogYaw, 0, 'YXZ');
    dog.shadow.position.set(dogPos[0], 0.02, dogPos[2]);
    dog.shadow.rotation.set(0, dogYaw, 0);
    dog.group.visible = showDog;
    if (noDraw) { scene.updateMatrixWorld(true); return P; }
    const yb = (view.az || 0) * DEG, el = (view.el || 0) * DEG, dd = view.dist || 2;
    if (view.pos) {
      camera.position.set(...view.pos);
      look.set(...view.look);
    } else {
      const c = view.at || [catPos[0], 0.3, catPos[2]];
      look.set(c[0], view.h ?? c[1], c[2]);
      camera.position.set(look.x + Math.sin(yb) * Math.cos(el) * dd, look.y + Math.sin(el) * dd, look.z + Math.cos(yb) * Math.cos(el) * dd);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.fov = view.fov || 30;
    camera.updateProjectionMatrix();
    const pu = post.uniforms, ps = post.shared;
    pu.uTime.value = time;
    ps.uEdge.value = 0.0135 * H;
    ps.uDofMax.value = 0.017 * H;
    ps.uDof.value = dof;
    ps.uFocus.value = camera.position.distanceTo(look);
    pu.uEdgeTint.value.copy(extra.edge);
    pu.uLift.value.copy(extra.lift); pu.uGain.value.copy(extra.gain);
    pu.uSat.value = extra.sat; pu.uContrast.value = extra.contrast;
    pu.uBloom.value = extra.bloom;
    pu.uWhite.value = 0;
    U.uMSAA.value = post.sceneRT.samples > 0 ? 1 : 0;
    U.uPxK.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, post.ph || 1);
    post.render(scene, camera);
  }
  return { size, render, ch, cat, dog, U, scene, camera, post };
}
