// Scroll choreography. Everything is a pure function of t in [0, 1] (the story only moves
// forward, held back by its narrator - see story.js).
import { Track, keyed } from './math.js';

// Chapter starts (World 1..4)
export const CHAPTERS = [0.0, 0.262, 0.522, 0.776];
export const CHAPTER_JUMP = [0.0, 0.268, 0.528, 0.79];

// Character progress as fractional waypoint index (see world.js FLIGHT/WALK)
export const WP_KEYS = [
  // (behind the camera as it starts to glide forward), then up past its lower right and away
  [0.000, 0.00],
  [0.0220, 1.00],
  [0.0276, 2.00],
  [0.0432, 3.00],
  // round the left-hand peak, close along its flank
  [0.0634, 4.00],
  [0.0698, 5.00],
  [0.0762, 6.00],
  [0.0819, 7.00],
  [0.0878, 8.00],
  // across, and round the second
  [0.1066, 9.00],
  [0.1253, 10.00],
  [0.1312, 11.00],
  [0.1364, 12.00],
  [0.1426, 13.00],
  // along the ridge's flank, then down the mountainside into the valley
  [0.1490, 14.00],
  [0.1574, 15.00],
  [0.1656, 16.00],
  [0.1733, 17.00],
  [0.1797, 18.00],
  [0.1855, 19.00],
  [0.1920, 20.00],
  [0.1988, 21.00],
  [0.2055, 22.00],
  [0.2144, 23.00],
  [0.2260, 24.05],
  [0.243, 25.35],
  [0.256, 26.00], // touchdown
  [0.292, 26.00], // wings dissolve
  [0.316, 27.05],
  [0.348, 28.55], // through the arch, smile
  [0.378, 30.25],
  [0.396, 31.00], // at the flower
  [0.500, 31.00], // kneel, bloom, ripple; she rises in place
  [0.514, 31.45], // and walks on
  [0.540, 33.00], // trail begins
  [0.578, 35.10],
  [0.616, 37.25],
  [0.654, 39.30],
  [0.692, 41.10],
  [0.716, 42.30],
  [0.736, 43.00], // summit view
  [0.778, 43.00],
  [0.800, 44.10],
  [0.826, 45.40],
  [0.846, 46.00], // beside the cake
  [1.000, 46.00],
];

// Camera rig: [t, dist, az(deg), el(deg), pivotUp, lookAhead, lookUp, lookSide, fov, roll(deg)]
// az is measured from the direction she is travelling (180 = behind her).
export const CAM_KEYS = [
  // (the opening is the world camera below, gliding forward; the rig takes over as she
  // pulls out ahead of it)
  [0.000, 150, 180, 3.0, 0.0, 160, 74, 0, 42, 0],
  [0.028, 55, 180, 4.0, 0.0, 70, 12, 0, 44, 0],
  [0.040, 26, 178, 5.0, 0.0, 40, 8, 0, 46, -1],
  [0.052, 16, 174, 6.0, 0.1, 26, 5, 1, 48, -4],
  // swinging round the first peak close along its flank (the rock on her right): close
  // behind her, a touch to the outside, banking into the turn with her
  [0.062, 12.5, 168, 6.0, 0.1, 22, 3, 3, 52, -12],
  [0.075, 12, 166, 6.0, 0.1, 22, 3, 3, 53, -16],
  [0.087, 12.5, 168, 6.0, 0.1, 22, 3, 2, 52, -12],
  // across, levelling out, then leaning into the second
  [0.098, 15, 180, 7.0, 0.1, 26, 4, 0, 50, 0],
  [0.114, 14, 186, 7.0, 0.1, 24, 4, -1, 50, 6],
  // round the second (the rock on her left)
  [0.126, 12.5, 192, 6.0, 0.1, 22, 3, -3, 52, 12],
  [0.135, 12, 194, 6.0, 0.1, 22, 3, -3, 53, 16],
  [0.144, 12.5, 192, 6.5, 0.1, 22, 3, -2, 52, 10],
  // along the ridge's flank: the wall of the mountain on the left, the sea of clouds below
  [0.154, 13, 188, 8.0, 0.1, 26, 2, -1, 51, 4],
  [0.168, 13, 186, 9.0, 0.1, 28, 0, 0, 51, 2],
  // down the mountainside: higher, looking down past her into the valley
  [0.182, 12.5, 182, 14, 0.0, 30, -8, 0, 52, 0],
  [0.196, 12.5, 180, 18, 0.0, 30, -12, 0, 53, 0],
  [0.206, 13, 174, 16, 0.0, 28, -10, 0, 51, 0],
  [0.214, 15, 160, 14, 0.0, 28, -9, 0, 49, -1],
  [0.226, 17, 124, 9, 0.2, 14, 0, 0, 43, 0],
  [0.243, 9.5, 112, 6, 0.8, 3, 1.2, 0, 41, 0],
  [0.256, 7.2, 110, 5.5, 1.0, 1.0, 1.3, 0, 40, 0],
  // (low, looking up past her as the clouds part overhead and the light pours in)
  [0.274, 5.8, 128, -1.5, 1.15, 0.8, 2.6, 0, 46, 0],
  [0.292, 6.4, 150, 2.0, 1.1, 1.0, 1.8, 0, 43, 0],
  [0.312, 6.2, 168, 9.0, 1.1, 2.0, 1.0, 0, 40, 0],
  [0.330, 4.2, 110, 6.0, 1.4, 0.4, 0.6, 0, 38, 0],
  // (under the arch: wide enough to take in all of her, the arch of flowers round her and the
  // garden beyond - not just her face)
  [0.348, 4.9, 32, 5.0, 1.1, 0.0, 0.25, 0, 44, 0],
  [0.366, 5.1, 22, 4.5, 1.1, 0.0, 0.25, 0, 44, 0],
  [0.382, 4.6, 112, 9.0, 1.2, 1.0, 0.7, 0, 38, 0],
  // (kneeling at the flower: her, the flower, her cat and dog and a good piece of the meadow)
  [0.398, 5.4, 80, 8.0, 0.75, 0.4, 0.45, 0, 44, 0],
  [0.418, 4.6, 66, 7.0, 0.6, 0.3, 0.4, 0, 44, 0],
  [0.440, 4.3, 58, 6.5, 0.58, 0.3, 0.42, 0, 44, 0],
  [0.458, 5.0, 70, 10.0, 0.6, 0.3, 0.6, 0, 44, 0],
  [0.480, 12, 92, 15, 0.7, 0.0, 1.6, 0, 44, 0],
  [0.500, 19, 112, 17, 0.7, 2.0, 2.8, 0, 46, 0],
  [0.520, 12, 150, 13, 1.0, 4.0, 2.2, 0, 44, 0],
  [0.540, 8.0, 172, 11, 1.1, 5.0, 1.8, 0, 44, 0],
  [0.566, 9.0, 186, 10, 1.1, 6.0, 2.4, 0, 46, 0],
  [0.592, 8.0, 150, 8, 1.1, 4.0, 2.0, 0, 46, 0],
  [0.618, 9.5, 150, 12, 1.1, 4.0, 2.4, 0, 46, 0],
  [0.640, 7.5, 40, 16, 1.0, -2.0, 1.6, 0, 46, 0],
  [0.668, 7.0, 18, 15, 1.0, -3.0, 1.5, 0, 46, 0],
  [0.692, 7.5, 120, 10, 1.1, 4.0, 2.0, 0, 46, 0],
  [0.716, 8.0, 180, 12, 1.2, 40, -3, 0, 50, 0],
  [0.738, 9.5, 184, 19, 1.2, 230, -52, 0, 56, 0],
  [0.760, 11, 188, 18, 1.2, 250, -50, 0, 58, 0],
  [0.780, 10.5, 182, 14, 1.2, 180, -30, 0, 56, 0],
  [0.800, 8.5, 172, 11, 1.1, 12, 2.0, 0, 50, 0],
  [0.824, 6.5, 150, 10, 1.0, 4.0, 1.5, 0, 46, 0],
  [0.846, 4.2, 58, 7, 0.85, 0.45, 1.05, 0.45, 42, 0],
  [0.868, 3.7, 36, 5, 0.8, 0.45, 1.0, 0.4, 42, 0],
  [0.890, 5.2, 95, 7, 1.0, 0.3, 1.0, 0.0, 46, 0],
  [0.912, 6.4, 140, 7, 1.1, 2.0, 2.0, 0.6, 50, 0],
  [0.936, 6.6, 156, 5, 1.1, 10, 5.0, 1.5, 54, 0],
  [0.960, 6.6, 160, 3.5, 1.0, 22, 9.0, 4.0, 58, 0],
  [1.000, 6.8, 162, 3.0, 1.0, 26, 10.0, 4.6, 58, 0],
];

// The opening shot, in world space: [t, weight, camX, camY, camZ, lookX, lookY, lookZ, fov].
// From the title view the camera glides forward toward the peaks; she comes up from behind
// it and overtakes it at its lower right, out ahead; then it lets go (weight to 0) and the
// rig follows her.
export const WCAM_KEYS = [
  [0.000, 1, 0, 233.85, 449.8, 0, 300, 140, 42],
  // (already gliding forward, slowly at first, toward the first peak; she comes up past it)
  [0.010, 1, -1.5, 234.0, 444.0, -3, 297, 135, 42],
  [0.020, 1, -4.9, 234.4, 430.4, -14, 264, 130, 42.5],
  [0.028, 0.85, -9.0, 234.9, 413.0, -32, 274, 150, 43],
  [0.036, 0.45, -14.5, 235.6, 392.0, -55, 258, 190, 44],
  [0.044, 0, -21, 236.5, 368, -80, 248, 230, 45],
];

// (A pull of the look toward a peak's top: [t, weight, peak (0 left, 1 right)] - unused now
// that she swings close round their flanks rather than circling them)
export const PEAK_LOOK = [
  [0.000, 0, 0], [1.000, 0, 0],
];

// Camera heading: blend toward a fixed world heading (radians) — keeps the
// camera calm on the switchbacks and frames the canyon views.
export const HEADING_KEYS = [
  // [t, blend, fixedHeading]
  [0.000, 0, Math.PI],
  [0.392, 0, Math.PI],
  [0.406, 1, 'flower'],
  [0.456, 1, 'flower'],
  [0.474, 0, Math.PI],
  [0.520, 0, Math.PI],
  [0.548, 1, Math.PI],
  [0.778, 1, Math.PI],
  [0.800, 0, Math.PI],
  [0.846, 1, Math.PI],
  [1.000, 1, Math.PI],
];

// Where she faces: [t, weight, absolute yaw] (yaw = atan2(dx, dz)); 0 weight = along the path
export const FACE_KEYS = [
  [0.000, 0, 0],
  [0.396, 0, 0],
  [0.404, 1, 'flower'],
  [0.494, 1, 'flower'],
  [0.51, 0, 0],
  [0.726, 0, 0],
  [0.742, 1, Math.PI],
  [0.776, 1, Math.PI],
  [0.792, 0, 0],
  [0.838, 0, 0],
  [0.852, 1, Math.PI],
  [1.000, 1, Math.PI],
];

// Pose keys (scalar)
export const POSE = {
  fly: [[0, 1], [0.236, 1], [0.256, 0]],
  // (wings swept back in the dive)
  wingSpread: [[0, 0.92], [0.03, 1.0], [0.172, 1.0], [0.182, 0.82], [0.206, 0.82], [0.22, 0.98], [0.236, 1], [0.256, 1], [0.27, 1]],
  // (beating harder as she climbs to the peaks, still in the glide down the ridge)
  flap: [[0, 0.22], [0.016, 0.42], [0.034, 0.5], [0.05, 0.32], [0.062, 0.16], [0.09, 0.3], [0.104, 0.3], [0.122, 0.16], [0.15, 0.2], [0.172, 0.08], [0.182, 0.04], [0.206, 0.05], [0.222, 0.25], [0.236, 0.5], [0.252, 0.12], [0.26, 0]],
  dissolve: [[0, 0], [0.262, 0], [0.292, 1]],
  balance: [[0, 0], [0.24, 0], [0.254, 0.7], [0.27, 0.35], [0.29, 0]],
  lean: [[0, 0.0], [0.02, -0.06], [0.05, 0.0], [0.15, 0.02], [0.172, 0.08], [0.184, 0.16], [0.206, 0.12], [0.222, 0.06], [0.25, -0.06], [0.262, 0.0]],
  kneel: [[0, 0], [0.4, 0], [0.418, 1], [0.484, 1], [0.5, 0]],
  reach: [[0, 0], [0.42, 0], [0.438, 1], [0.47, 1], [0.484, 0]],
  smile: [[0, 0], [0.338, 0], [0.352, 1], [0.372, 1], [0.384, 0], [0.444, 0], [0.458, 1], [0.49, 1], [0.5, 0], [0.846, 0], [0.86, 1], [1, 1]],
  headYaw: [[0, 0], [0.336, 0], [0.35, 0.45], [0.37, 0.45], [0.384, 0], [0.404, 0], [0.422, 0.4], [0.468, 0.4], [0.49, 0], [0.84, 0], [0.86, 0.3], [0.9, 0.0], [1, 0]],
  headPitch: [[0, 0], [0.04, 0.06], [0.1, 0.02], [0.16, 0.0], [0.172, -0.06], [0.184, -0.12], [0.204, -0.1], [0.214, -0.05], [0.25, 0], [0.334, 0], [0.342, -0.16], [0.35, -0.05], [0.358, 0], [0.4, 0], [0.42, 0.28], [0.47, 0.2], [0.486, 0.12], [0.5, -0.05], [0.512, 0], [0.72, 0], [0.74, -0.16], [0.776, -0.12], [0.8, 0], [0.846, 0.2], [0.89, 0.2], [0.93, -0.12], [1, -0.14]],
  armsOpen: [[0, 0], [0.736, 0], [0.75, 0.55], [0.772, 0.55], [0.786, 0]],
  laugh: [[0, 0], [0.742, 0], [0.752, 1], [0.772, 1], [0.784, 0]],
  headRoll: [[0, 0], [0.338, 0], [0.354, 0.17], [0.372, 0.17], [0.386, 0], [0.454, 0], [0.464, -0.1], [0.49, -0.1], [0.5, 0], [0.742, 0], [0.754, -0.1], [0.772, -0.1], [0.786, 0], [0.846, 0], [0.864, 0.13], [0.93, 0.13], [0.95, 0.04], [1, 0.04]],
  clasp: [[0, 0], [0.85, 0], [0.866, 1], [1, 1]],
  aura: [[0, 0.75], [0.24, 0.75], [0.262, 0.55], [0.276, 0.85], [0.296, 0.22], [0.5, 0.2], [0.78, 0.3], [1, 0.35]],
  walkAmt: [[0, 0], [0.26, 0], [0.292, 0], [0.3, 1], [0.392, 1], [0.398, 0], [0.5, 0], [0.51, 1], [0.734, 1], [0.74, 0], [0.778, 0], [0.786, 1], [0.84, 1], [0.848, 0]],
  // (gone once they have melted away - she is free to kneel to her cat and dog straight after)
  wingsVisible: [[0, 1], [0.292, 1], [0.2922, 0]],
  // walking in under the flower arch she looks up at it: "oh!" - then smiles at us
  oh: [[0, 0], [0.335, 0], [0.341, 1], [0.346, 1], [0.353, 0]],
  // she winks once at us as she settles by her cake
  winkZone: [[0, 0], [0.855, 0], [0.858, 1], [0.869, 1], [0.872, 0]],
  // stars in her eyes as the flower stirs
  sparkle: [[0, 0], [0.438, 0], [0.448, 1], [0.458, 1], [0.466, 0]],
};

// Environment preset index over t (0 morning, 1 garden, 2 misty afternoon, 3 sunset, 4 twilight)
export const ENV_KEYS = [[0, 0], [0.236, 0], [0.31, 1], [0.5, 1], [0.58, 2], [0.68, 2.45], [0.742, 3.0], [0.79, 3.45], [0.85, 4], [1, 4]];

export const FX = {
  bloom: [[0, 0], [0.438, 0], [0.462, 1]],
  pollen: [[0, 0], [0.438, 0], [0.462, 6], [0.56, 18]],
  ripple: [[0, 0], [0.458, 0], [0.508, 78]],
  bloomR: [[0, 0], [0.458, 0], [0.508, 36], [0.522, 48]],
  companions: [[0, 0], [0.462, 0], [0.5, 1]],
  flies: [[0, 1], [0.84, 1], [0.88, 0]],
  cfire: [[0, 0.55], [0.6, 0.6], [0.78, 0.85], [0.86, 1], [1, 1]],
  rippleAmt: [[0, 0], [0.452, 0], [0.462, 1], [0.5, 0.8], [0.52, 0]],
  foot: [[0, 0], [0.53, 0], [0.56, 1], [0.79, 1], [0.84, 0.35]],
  mist: [[0, 0], [0.5, 0], [0.56, 1], [0.69, 1], [0.74, 0.25], [0.8, 0]],
  wind: [[0, 0.5], [0.5, 0.55], [0.56, 0.95], [0.7, 0.95], [0.76, 0.6], [1, 0.45]],
  passion: [[0, 0], [0.69, 0], [0.736, 1], [0.79, 1], [0.86, 0.45], [1, 0.4]],
  islands: [[0, 0], [0.6, 0], [0.62, 1]],
  ahead: [[0, 0], [0.78, 0], [0.8, 1], [0.84, 1], [0.852, 0]],
  arc: [[0, 0], [0.862, 0], [0.946, 1]],
  arcFade: [[0, 1], [0.946, 1], [0.99, 0.35]],
  // (her candles light as we come close to her cake, just before his words)
  candles: [[0, 0.0], [0.887, 0.0], [0.9, 1]],
  candleLight: [[0, 0], [0.887, 0], [0.905, 1]],
  // close to her cake as its candles light, then back out to her for his words
  cakeCam: [[0, 0], [0.879, 0], [0.896, 1], [0.913, 1], [0.93, 0]],
  fireflies: [[0, 0], [0.79, 0], [0.86, 1]],
  lights: [[0, 0], [0.79, 0], [0.845, 1]],
  petals: [[0, 0], [0.27, 0], [0.31, 1], [0.47, 1], [0.5, 1.25], [0.74, 1], [0.8, 0.5], [0.86, 0]],
  motes: [[0, 0.7], [0.25, 0.9], [0.5, 0.8], [0.75, 0.6], [1, 0.9]],
  // (a little longer and broader through the mountains: her ribbon of light curls round
  // the peak tops behind her)
  trailTail: [[0, 110], [0.05, 200], [0.16, 200], [0.2, 120], [0.24, 90], [0.27, 40], [1, 40]],
  trailWidth: [[0, 0.16], [0.03, 0.26], [0.16, 0.26], [0.2, 0.18], [0.24, 0.16], [1, 0.16]],
  dust: [[0, 26], [0.25, 26], [0.27, 8], [1, 8]],
  edgeBlur: [[0, 1], [1, 1]],
  // depth of field focus on her in the close moments
  dof: [[0, 0], [0.235, 0], [0.252, 0.12], [0.3, 0.08], [0.316, 0.06], [0.336, 0.16], [0.374, 0.16], [0.388, 0.1], [0.404, 0.16], [0.458, 0.16], [0.476, 0.05], [0.52, 0.04], [0.6, 0.05], [0.7, 0.05], [0.72, 0.04], [0.8, 0.05], [0.84, 0.32], [0.89, 0.32], [0.93, 0.08], [1, 0.08]],
  bloomBoost: [[0, 1], [0.24, 1], [0.27, 1.15], [0.3, 1], [0.44, 1], [0.46, 0.92], [0.5, 1], [1, 1]],
  // golden sunbeams slanting down onto her and her flower as it blooms (a spotlight from the sky)
  rays: [[0, 0], [0.416, 0], [0.44, 1], [0.506, 1], [0.532, 0]],
};

// Text beats: [id, tIn, tOut]. The last one holds to the end.
// (the story's own words are told line by line - see story.js; these are the title and the
// place of her wish)
export const BEATS = [
  ['hero', -0.02, 0.03],
  ['w4b', 0.96, 1.0],
];

export function makeTracks() {
  return {
    wp: new Track(WP_KEYS),
    cam: new Track(CAM_KEYS),
    wcam: new Track(WCAM_KEYS),
    pose: (name, t) => keyed(POSE[name], t),
    fx: (name, t) => keyed(FX[name], t),
    env: (t) => keyed(ENV_KEYS, t),
  };
}
