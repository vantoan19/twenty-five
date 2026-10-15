// Layout of the four connected worlds and the shared terrain height function.
// Forward is -Z. Units are metres; the character is ~1.65 m tall.
import { makeSimplex, fbm, ridged, smoothstep, clamp, lerp } from './math.js';

const sA = makeSimplex(11);
const sB = makeSimplex(23);
const sC = makeSimplex(37);

export const WATER_VALLEY = 1.0;
export const WATER_CANYON = -94;
export const CLOUD_TOP = 182;
export const CLOUD_BASE = 146;

// Trail mountain (a ridge running along x, climbed from +z)
const MX = -45;      // ridge centre x
const ZB = -690;     // foot of the climb (garden level)
const ZT = -838;     // top edge of the climb
const ZE = -876;     // cliff edge (canyon side)
const ZF = -968;     // canyon floor reached
const TOP = 101;     // added above the valley floor

export const GARDEN = { x: 0, z: -628, rx: 64, rz: 78 };
export const FLOWER = { x: -5.04, z: -658.96 };
export const ARCH = { x: 4.6, z: -611.5 };
export const CAKE = { x: -96.6, z: -859.3 };
export const CLEARING = { x: -96, z: -855, r: 26 };

// The World 1 river: x as a function of z (cosine-interpolated knots)
const VR = [
  [-60, -380], [-150, -265], [-260, -150], [-360, -60], [-440, 30], [-520, 112], [-600, 190], [-700, 290], [-820, 420],
];
export function valleyRiverX(z) {
  if (z >= VR[0][0]) return VR[0][1];
  for (let i = 0; i < VR.length - 1; i++) {
    const a = VR[i], b = VR[i + 1];
    if (z >= b[0]) {
      const u = (z - a[0]) / (b[0] - a[0]);
      const w = (1 - Math.cos(u * Math.PI)) / 2;
      return a[1] + (b[1] - a[1]) * w;
    }
  }
  return VR[VR.length - 1][1];
}
export function canyonRiverZ(x) {
  return -1165 + 105 * Math.sin(x * 0.0041 + 0.6) + 32 * Math.sin(x * 0.013 + 1.7);
}

function gardenMask(x, z) {
  const dx = (x - GARDEN.x) / GARDEN.rx, dz = (z - GARDEN.z) / GARDEN.rz;
  const d = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(0.62, 1.0, d);
}

// Cone karst (Ha Giang): a field of rounded, jostling peaks.
function hash2(i, j) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function karstLayer(x, z, cell, seed) {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
  let best = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const cx = gx + i, cz = gz + j;
    const r1 = hash2(cx * 3 + seed, cz), r2 = hash2(cx, cz * 5 - seed), r3 = hash2(cx + 71 + seed, cz - 13);
    const px = (cx + 0.15 + 0.7 * r1) * cell, pz = (cz + 0.15 + 0.7 * r2) * cell;
    const rad = cell * (0.62 + 0.4 * r3);
    const d = Math.hypot(x - px, z - pz) / rad;
    if (d < 1) {
      const dome = Math.pow(1 - Math.pow(d, 2.0), 0.85);
      best = Math.max(best, (0.5 + 0.5 * r3) * dome);
    }
  }
  return best;
}
export function karst(x, z) {
  // big domes, smaller ones jostling between them, gentle undulation
  const a = karstLayer(x + 13.0, z - 7.0, 150, 3);
  const b = karstLayer(x - 41.0, z + 23.0, 82, 11) * 0.62;
  return Math.max(a, b) * 0.9 + fbm(sC, x * 0.004, z * 0.004, 2) * 0.08;
}

export function heightAt(x, z) {
  // valley floor with soft undulation
  let h = 7.5 + fbm(sA, x * 0.0052, z * 0.0052, 3) * 5.5;
  // rolling hills off the path
  const ax = Math.abs(x);
  h += Math.max(0, fbm(sB, x * 0.0026 + 3.1, z * 0.0026, 3)) * 26 * smoothstep(50, 170, ax);

  // side mountains rise away from the corridor
  const side = smoothstep(85, 440, ax);
  if (side > 0) {
    // alpine foothills: sharp ridgelines and V valleys
    const r = ridged(sA, x * 0.0026 + 7.3, z * 0.0026 - 2.1, 4) * 0.85 + 0.15 * (fbm(sC, x * 0.004, z * 0.004, 2) * 0.5 + 0.5);
    // lower ranges under the cloud sea; taller toward the canyon
    const amp = lerp(115, 195, smoothstep(-260, -720, z));
    h += side * (22 + r * amp * smoothstep(0.05, 1, side));
  }

  // trail mountain
  const lat = 1 - smoothstep(105, 235, Math.abs(x - MX));
  if (lat > 0 && z < ZB + 12) {
    let m;
    if (z > ZT) {
      const p = clamp((z - ZT) / (ZB - ZT), 0, 1);
      // concave lower slope, rounder shoulder near the top
      m = TOP * (1 - smoothstep(0, 1, Math.pow(p, 0.85)));
      m += fbm(sC, x * 0.03, z * 0.03, 2) * 3.0 * p * (1 - p) * 4;
    } else {
      m = TOP + fbm(sC, x * 0.02, z * 0.02, 2) * 1.6;
    }
    // slight rise on the ridge's outer shoulders
    m += smoothstep(60, 140, Math.abs(x - MX)) * 18 * (z < ZT ? 1 : 0.5);
    h = Math.max(h, 7.5 + m * lat);
  }

  // canyon beyond the cliff
  if (z < ZE) {
    const c = smoothstep(ZE, ZF, z);
    let floor = -90 + fbm(sB, x * 0.006, z * 0.006, 3) * 5;
    const wall = smoothstep(-1430, -1740, z);
    floor += wall * (110 + ridged(sB, x * 0.0031 + 1.9, z * 0.0031, 4) * 360);
    // gentle slopes near the cliff foot
    floor += (1 - smoothstep(ZF - 10, ZF - 120, z)) * 30 * c;
    // river channel on the canyon floor
    const dr = Math.abs(z - canyonRiverZ(x));
    floor = lerp(WATER_CANYON - 5, floor, smoothstep(8, 30, dr) * (1 - wall) + wall);
    // craggy cliff face
    const crag = (ridged(sC, x * 0.02, z * 0.02 + 5.0, 3) - 0.5) * 42 * c * (1 - c) * 4;
    h = lerp(h, floor, c) + crag;
  }

  // valley river (World 1)
  if (z < -100 && z > -900) {
    const d = Math.abs(x - valleyRiverX(z));
    if (d < 40) {
      const bank = smoothstep(7, 26, d);
      h = Math.min(h, lerp(WATER_VALLEY - 3.2, h, bank));
    }
  }

  // garden & meadow flattening
  const g = gardenMask(x, z);
  if (g > 0) h = lerp(h, 8.2 + fbm(sC, x * 0.02, z * 0.02, 2) * 0.9, g);

  // keep the land above the valley water except where carved
  return h;
}

// Analytic-ish normal from the heightfield (for placing props)
export function normalAt(x, z, e = 1.5) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

// ---------------------------------------------------------------------------
// Character path. Flight keys carry explicit y; walking keys sit on the ground.
// The index of each key is used by the timeline (fractional indices allowed).
export const FLIGHT = [
  // she comes up from behind and below the camera (which is already gliding forward), past
  // its lower right, and flies out ahead toward the first peak...
  [20, 222, 500],
  [-1.5, 231.9, 418.5],
  [-20.6, 233, 368.2],
  [-70.6, 237, 281.6],
  // ...swings round the left-hand side of it, banking in toward the rock, close along its
  // flank (the peak on her right), out round its far shoulder...
  [-120.6, 238, 195],
  [-129.7, 237, 166.1],
  [-125.8, 236, 136.1],
  [-109.5, 235, 110.5],
  [-80.2, 234, 93.0],
  // ...straight across to the second, and round it the other way (the peak on her left)...
  [12.5, 232, 65],
  [105.2, 231, 37.0],
  [134.5, 231, 19.5],
  [150.8, 230, -6.1],
  [153.9, 230, -42.2],
  // ...then skims along the flank of the long ridge running on from it, the sea of clouds
  // below on her right, and dives down the mountainside, through the thinning edge of the
  // clouds, into the valley, to land
  [148, 229, -80],
  [140, 224, -130],
  [132, 216, -180],
  [125, 205, -230],
  [118, 186, -270],
  [112, 166, -305],
  [104, 136, -340],
  [92, 104, -375],
  [76, 74, -408],
  [50, 40, -450],
  [25, 21, -505],
  [11.5, 11.4, -565],
];
export const WALK = [
  [9.6, -582],   // 26 touchdown
  [7.6, -596],   // 27
  [5.0, -611],   // 28 arch
  [0.4, -628],   // 29
  [-3.0, -645],  // 30
  [-5.45, -658.55],// 31 flower (kneel here)
  [-8.0, -674],  // 32
  [-13.0, -691], // 33 trail start
  [-28.0, -706], // 34
  [-60.0, -719], // 35 switchback
  [-44.0, -735], // 36
  [-8.0, -750],  // 37 switchback
  [-24.0, -768], // 38
  [-60.0, -784], // 39 switchback
  [-44.0, -801], // 40
  [-22.0, -818], // 41
  [-26.0, -834], // 42 top edge
  [-31.0, -862], // 43 summit view
  [-50.0, -860], // 44
  [-72.0, -857], // 45
  [-97.35, -858.55], // 46 beside the cake
];
export const WP = {
  touchdown: 26, arch: 28, flower: 31, trailStart: 33, summitEdge: 42, summit: 43, cake: 46,
};

// Spires: [x, z, apexY, baseRadius, seed]
export const SPIRES = [
  // around the cloud sea (World 1)
  [80, -218, 386, 112, 1],
  [-132, -58, 334, 98, 2],
  [-64, 168, 272, 78, 3],
  [124, 92, 304, 88, 4],
  [-262, 42, 306, 108, 5],
  [292, -36, 326, 116, 6],
  [-226, -262, 266, 100, 7],
  [236, -338, 290, 106, 8],
  [-430, 196, 286, 120, 9],
  [436, 214, 296, 124, 10],
  [-384, -118, 256, 110, 11],
  [388, -196, 312, 120, 12],
  [-170, 420, 330, 120, 13],
  [210, 470, 352, 124, 14],
  [10, 640, 400, 150, 15],
  [-560, -10, 300, 140, 16],
  [580, 40, 320, 150, 17],
  // flanking the valley and garden
  [-292, -478, 262, 104, 18],
  [276, -520, 248, 100, 19],
  [-250, -706, 284, 110, 20],
  [262, -772, 306, 120, 21],
  [-420, -620, 300, 130, 22],
  [440, -650, 320, 140, 23],
  // canyon far wall (karst towers)
  [-520, -1540, 330, 120, 24],
  [-300, -1600, 420, 130, 25],
  [-90, -1660, 470, 140, 26],
  [150, -1580, 380, 120, 27],
  [380, -1640, 460, 150, 28],
  [620, -1560, 360, 130, 29],
  [-760, -1520, 380, 140, 30],
  [820, -1620, 420, 160, 31],
  [-220, -1860, 520, 170, 32],
  [260, -1900, 540, 180, 33],
  [40, -2060, 560, 200, 34],
  // canyon side walls
  [-700, -1120, 300, 140, 35],
  [720, -1180, 320, 150, 36],
];

// Floating gardens over the canyon: [x, y, z, radius, seed]
export const ISLANDS = [
  [16, 116, -936, 8.5, 1],
  [-84, 142, -994, 13, 2],
  [62, 166, -1064, 17, 3],
  [-22, 96, -1112, 11, 4],
  [-168, 188, -1150, 23, 5],
  [156, 128, -1206, 19, 6],
  [-56, 220, -1310, 29, 7],
  [270, 204, -1356, 25, 8],
];
// Glowing "passion" stars: [x, y, z, size]
export const PASSION_STARS = [
  [-38, 152, -962, 3.2],
  [34, 134, -1004, 2.6],
  [-114, 176, -1044, 3.6],
  [104, 192, -1102, 4.0],
  [-12, 236, -1186, 4.6],
  [-226, 244, -1252, 5.2],
  [206, 254, -1282, 5.4],
];
// The final arc of stars rises from the cake across the canyon sky
export const STAR_ARC = [
  [-96.6, 109.75, -859.3],
  [-98.5, 121, -872],
  [-110, 146, -902],
  [-122, 176, -940],
  [-108, 204, -972],
  [-72, 220, -988],
  [-30, 214, -992],
  [6, 190, -986],
  [28, 156, -975],
  [38, 118, -962],
  [40, 88, -952],
];
