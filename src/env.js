import * as THREE from 'three';
import { lerp, clamp } from './math.js';

// Time-of-day presets, from EverSwap's cobalt morning to a lavender twilight
const P = [
  { // 0 morning above the clouds
    skyTop: '#3d68bd', skyMid: '#72a0e4', skyHor: '#c6e7f7', below: '#a5bfd2',
    fog: '#a9c8e0', fogSun: '#eef2ec', fogDensity: 0.0006, fogHeight: 26, fogHF: 0.022, fogHAmt: 0.15,
    sunDir: [0.78, 0.52, -0.22], sunCol: '#fff1d6', amb: '#90b4da',
    shadow: [0.96, 1.0, 1.04], light: [1.05, 1.03, 0.95],
    cloudLit: '#fefcf6', cloudShade: '#b6c3e2', skyClouds: 0.5, stars: 0,
    edge: '#c8dbea', rim: '#fff4dc', sunGlow: 1, lift: [0.0, 0.0, 0.006], gain: [1.02, 1.02, 1.0], sat: 1.13, vib: 0.34, contrast: 1.05, bloom: 0.42,
  },
  { // 1 garden, warm late morning
    skyTop: '#4a7bcf', skyMid: '#80aae6', skyHor: '#d9eff2', below: '#bed3cf',
    fog: '#bdd3d2', fogSun: '#f6f2e4', fogDensity: 0.0006, fogHeight: 16, fogHF: 0.03, fogHAmt: 0.08,
    sunDir: [0.42, 0.74, 0.52], sunCol: '#fff4de', amb: '#a8c4dc',
    shadow: [0.95, 0.99, 1.05], light: [1.02, 1.04, 0.98],
    cloudLit: '#fffdf8', cloudShade: '#b9c6e0', skyClouds: 0.62, stars: 0,
    edge: '#d3e3e6', rim: '#fff4dc', sunGlow: 1, lift: [0.0, 0.002, 0.006], gain: [1.0, 1.02, 1.0], sat: 1.17, vib: 0.36, contrast: 1.06, bloom: 0.42,
  },
  { // 2 misty afternoon climb
    skyTop: '#6582c2', skyMid: '#a2b6da', skyHor: '#eee2cf', below: '#cfcdd6',
    fog: '#d3d1d9', fogSun: '#f6e7cf', fogDensity: 0.00085, fogHeight: 45, fogHF: 0.025, fogHAmt: 0.14,
    sunDir: [0.68, 0.52, 0.12], sunCol: '#ffe4ba', amb: '#b2b8d4',
    shadow: [0.95, 0.96, 1.06], light: [1.08, 1.02, 0.92],
    cloudLit: '#fff6ec', cloudShade: '#b9b8d2', skyClouds: 0.7, stars: 0,
    edge: '#d9d8e2', rim: '#ffe9c8', sunGlow: 1, lift: [0.004, 0.004, 0.012], gain: [1.02, 1.0, 0.98], sat: 1.13, vib: 0.3, contrast: 1.05, bloom: 0.55,
  },
  { // 3 sunset at the summit
    skyTop: '#3e4d92', skyMid: '#9b8cc4', skyHor: '#f8c79f', below: '#b8a6be',
    fog: '#b9a7c1', fogSun: '#ffd2a3', fogDensity: 0.00078, fogHeight: -40, fogHF: 0.012, fogHAmt: 0.42,
    sunDir: [0.08, 0.1, -1], sunCol: '#ffc788', amb: '#a99bc4',
    shadow: [0.8, 0.77, 0.98], light: [1.16, 0.99, 0.84],
    cloudLit: '#ffd9b8', cloudShade: '#8f86b6', skyClouds: 0.75, stars: 0.12,
    edge: '#d7c2cf', rim: '#ffd9a8', sunGlow: 1.3, lift: [0.018, 0.006, 0.026], gain: [1.05, 0.99, 0.95], sat: 1.12, vib: 0.24, contrast: 1.05, bloom: 0.75,
  },
  { // 4 twilight clearing
    skyTop: '#1e2558', skyMid: '#56508f', skyHor: '#e4a593', below: '#5e5788',
    fog: '#6a6192', fogSun: '#d99a90', fogDensity: 0.00085, fogHeight: -40, fogHF: 0.012, fogHAmt: 0.3,
    sunDir: [0.15, 0.09, -1], sunCol: '#efab8f', amb: '#6b6aa2',
    shadow: [0.64, 0.64, 0.9], light: [0.92, 0.84, 1.0],
    cloudLit: '#c99aa6', cloudShade: '#3c3a6c', skyClouds: 0.45, stars: 1,
    edge: '#4c4672', rim: '#ffcf9e', sunGlow: 0.7, lift: [0.02, 0.014, 0.04], gain: [1.03, 0.98, 1.02], sat: 1.1, vib: 0.18, contrast: 1.05, bloom: 0.9,
  },
];

const C = (h) => new THREE.Color(h);
const PRE = P.map((p) => ({
  ...p,
  skyTop: C(p.skyTop), skyMid: C(p.skyMid), skyHor: C(p.skyHor), below: C(p.below),
  fog: C(p.fog), fogSun: C(p.fogSun), sunCol: C(p.sunCol), amb: C(p.amb),
  cloudLit: C(p.cloudLit), cloudShade: C(p.cloudShade), edge: C(p.edge), rim: C(p.rim),
  sunDir: new THREE.Vector3(...p.sunDir).normalize(),
  shadow: new THREE.Color(...p.shadow), light: new THREE.Color(...p.light),
  lift: new THREE.Color(...p.lift), gain: new THREE.Color(...p.gain),
}));

const tmpV = new THREE.Vector3();
export function applyEnv(e, U, sky, extra) {
  const i = clamp(Math.floor(e), 0, PRE.length - 1);
  const j = Math.min(i + 1, PRE.length - 1);
  const f = clamp(e - i, 0, 1);
  const a = PRE[i], b = PRE[j];
  const col = (k, out) => out.copy(a[k]).lerp(b[k], f);
  const num = (k) => lerp(a[k], b[k], f);
  col('fog', U.uFogCol.value);
  col('fogSun', U.uFogSunCol.value);
  col('sunCol', U.uSunCol.value);
  col('amb', U.uAmb.value);
  col('shadow', U.uShadowTint.value);
  col('light', U.uLightTint.value);
  col('rim', U.uRimCol.value);
  U.uFogDensity.value = num('fogDensity');
  U.uFogHeight.value = num('fogHeight');
  U.uFogHeightFalloff.value = num('fogHF');
  U.uFogHeightAmt.value = num('fogHAmt');
  U.uSunDir.value.copy(tmpV.copy(a.sunDir).lerp(b.sunDir, f).normalize());
  U.uNight.value = num('stars');
  const su = sky.material.uniforms;
  col('skyTop', su.uTop.value);
  col('skyMid', su.uMid.value);
  col('skyHor', su.uHor.value);
  col('below', su.uBelow.value);
  col('cloudLit', su.uCloudLit.value);
  col('cloudShade', su.uCloudShade.value);
  su.uSkyClouds.value = num('skyClouds');
  su.uStars.value = num('stars');
  su.uSunGlow.value = num('sunGlow');
  if (extra) {
    col('edge', extra.edge);
    col('cloudLit', extra.cloudLit);
    col('cloudShade', extra.cloudShade);
    col('lift', extra.lift);
    col('gain', extra.gain);
    extra.sat = num('sat');
    extra.vib = num('vib');
    extra.contrast = num('contrast');
    extra.bloom = num('bloom');
  }
}
