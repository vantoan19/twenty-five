// Gentle generative score: a slow warm pad with music-box notes.
// Starts only after an explicit click on the music pill.
const F = {
  Bb2: 116.54, D3: 146.83, F3: 174.61, A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0,
  A4: 440.0, Bb4: 466.16, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, Bb5: 932.33, C6: 1046.5,
};
const CHORDS = [
  { pad: [F.F3, F.A3, F.C4, F.E4, F.G4], bells: [F.F5, F.A5, F.C5, F.G5, F.E5] },
  { pad: [F.A3, F.C4, F.E4, F.G4], bells: [F.A5, F.E5, F.C5, F.G5] },
  { pad: [F.D3, F.F3, F.A3, F.C4, F.E4], bells: [F.D5, F.F5, F.A5, F.E5, F.C5] },
  { pad: [F.Bb2, F.D3, F.F3, F.A3, F.E4], bells: [F.D5, F.F5, F.A5, F.Bb4, F.C5] },
];
const HB = [
  ['C5', 0.75], ['C5', 0.25], ['D5', 1], ['C5', 1], ['F5', 1], ['E5', 2],
  ['C5', 0.75], ['C5', 0.25], ['D5', 1], ['C5', 1], ['G5', 1], ['F5', 2],
  ['C5', 0.75], ['C5', 0.25], ['C6', 1], ['A5', 1], ['F5', 1], ['E5', 1], ['D5', 2.4],
  ['Bb5', 0.75], ['Bb5', 0.25], ['A5', 1], ['F5', 1], ['G5', 1], ['F5', 2.6],
];

export let MEOW_GAIN = 0.12, PURR_GAIN = 0.3;
export function setVoiceGains(m, p) { MEOW_GAIN = m; PURR_GAIN = p; }

export class Music {
  constructor() { this.ctx = null; this.on = false; this.timer = null; this.ci = 0; }
  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(3.4);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.5;
    this.dry = ctx.createGain(); this.dry.gain.value = 0.75;
    this.master.connect(this.dry); this.dry.connect(comp);
    this.master.connect(this.verb); this.verb.connect(this.wet); this.wet.connect(comp);
    comp.connect(ctx.destination);
    return true;
  }
  _impulse(sec) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * sec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }
  async start() {
    if (!this.ctx && !this._init()) return false;
    try { await this.ctx.resume(); } catch (e) { return false; }
    this.on = true;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.ducked ? 0.28 : 0.5, now + 2.5);
    this._loop();
    return true;
  }
  // the audio context alone (for the narrator's voice), made on the same click
  ensure() { if (!this.ctx) this._init(); return this.ctx; }
  // softer while the story is being read aloud
  duck(on) {
    this.ducked = on;
    if (!this.ctx || !this.on) return;
    const now = this.ctx.currentTime, g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? 0.28 : 0.5, now + (on ? 0.5 : 1.8));
  }
  stop() {
    if (!this.ctx) return;
    this.on = false;
    clearTimeout(this.timer);
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 1.2);
  }
  _loop() {
    if (!this.on) return;
    const dur = 7.2;
    const t0 = this.ctx.currentTime + 0.05;
    const ch = CHORDS[this.ci % CHORDS.length];
    this.ci++;
    ch.pad.forEach((f, i) => this._pad(f, t0 + i * 0.08, dur + 2.5, 0.05 / Math.sqrt(ch.pad.length)));
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = ch.bells[Math.floor(Math.random() * ch.bells.length)];
      this.bell(f, t0 + 0.6 + Math.random() * (dur - 1.5), 0.05 + Math.random() * 0.04);
    }
    this.timer = setTimeout(() => this._loop(), dur * 1000);
  }
  _pad(freq, t0, dur, amp) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 2.4);
    g.gain.setValueAtTime(amp, t0 + dur - 2.6);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4;
    g.connect(lp); lp.connect(this.master);
    [[-6, 'triangle'], [5, 'sine']].forEach(([det, type]) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = det;
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.1);
    });
  }
  bell(freq, t0, amp = 0.07) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 2.2);
    g.connect(this.master);
    [[1, 1], [2.005, 0.32], [3.01, 0.12]].forEach(([m, a]) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain(); og.gain.value = a;
      o.type = 'sine'; o.frequency.value = freq * m;
      o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + 2.3);
    });
  }
  // (her cat sings the last note of each line with the bells - "...to you" - a mew held on
  // the note; returns when, from now, and how long)
  happyBirthday() {
    if (!this.on) return null;
    const now = this.ctx.currentTime;
    let t = now + 0.3;
    const beat = 0.5, sing = [];
    HB.forEach(([n, d], i) => {
      this.bell(F[n], t, 0.085);
      if (i === 5 || i === 11 || i === 18 || i === 24) {
        const dur = Math.min(d * beat, 1.15);
        this._meow(this.ctx, this.master, t + 0.02, dur / 0.5, F[n]);
        sing.push({ at: t - now, d: dur });
      }
      t += d * beat;
    });
    return { sing, len: t - now, beat };
  }
  chime() {
    if (!this.on) return;
    const t = this.ctx.currentTime + 0.02;
    [F.F5, F.A5, F.C6, F.F5 * 2].forEach((f, i) => this.bell(f, t + i * 0.11, 0.06));
  }
  // the flower blooming: a soft low swell, a breath of air rushing out, and a shower of
  // bells cascading up
  bloom() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    // low swell
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(F.F3 / 2, t); o.frequency.exponentialRampToValueAtTime(F.F3, t + 0.6);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.12, t + 0.06); og.gain.exponentialRampToValueAtTime(0.0005, t + 2.4);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 2.5);
    // a cascade of bells
    const notes = [F.F5, F.A5, F.C6, F.E5 * 2, F.G5, F.A5 * 2, F.C6 * 2, F.F5 * 2];
    notes.forEach((f, i) => this.bell(f, t + 0.05 + i * 0.07 + Math.random() * 0.02, 0.045 - i * 0.003));
  }
  // her cat: a soft little "mew" (a buzzy voice through two moving vowel formants: i-a-o,
  // the pitch rising then falling) - only with the music on
  meow(k = 1) {
    if (!this.on || !this.ctx) return;
    this._meow(this.ctx, this.master, this.ctx.currentTime + 0.01, k);
  }
  _meow(ctx, out, t, k = 1, note = 0) {
    const d = 0.5 * k;
    const p0 = note || 560 * (0.94 + 0.12 * Math.random());
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(note ? p0 * 0.9 : p0, t);
    if (note) {
      // (sung: sliding up onto the note and holding it, falling away at the end)
      o.frequency.linearRampToValueAtTime(p0, t + 0.12);
      o.frequency.setValueAtTime(p0, t + d * 0.75);
      o.frequency.linearRampToValueAtTime(p0 * 0.86, t + d);
    } else {
      o.frequency.linearRampToValueAtTime(p0 * 1.36, t + d * 0.35);
      o.frequency.linearRampToValueAtTime(p0 * 0.84, t + d);
    }
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = note ? 5.5 : 7; lg.gain.value = note ? 9 : 8; lfo.connect(lg); lg.connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(560, t); f1.frequency.linearRampToValueAtTime(980, t + d * 0.4); f1.frequency.linearRampToValueAtTime(620, t + d);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7;
    f2.frequency.setValueAtTime(2200, t); f2.frequency.linearRampToValueAtTime(1350, t + d * 0.5); f2.frequency.linearRampToValueAtTime(950, t + d);
    const g = ctx.createGain(), g2 = ctx.createGain();
    const A = MEOW_GAIN;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + 0.05);
    g.gain.setValueAtTime(A, t + d * 0.62); g.gain.exponentialRampToValueAtTime(A * 0.004, t + d + 0.09);
    g2.gain.value = 0.55;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g2); g2.connect(g); g.connect(out);
    o.start(t); lfo.start(t); o.stop(t + d + 0.12); lfo.stop(t + d + 0.12);
  }
  // the little dog's yip: a short bright bark, the pitch snapping down (a breath of noise at
  // its start for the bite of it)
  yip(k = 1) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01, d = 0.13 * k;
    const p0 = 1050 * (0.93 + 0.14 * Math.random());
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(p0 * 0.82, t);
    o.frequency.linearRampToValueAtTime(p0, t + d * 0.18);
    o.frequency.exponentialRampToValueAtTime(p0 * 0.6, t + d);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4;
    f1.frequency.setValueAtTime(1300, t); f1.frequency.linearRampToValueAtTime(950, t + d);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 6; f2.frequency.value = 2700;
    const g = ctx.createGain(), g2 = ctx.createGain();
    const A = MEOW_GAIN * 0.85;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + 0.012);
    g.gain.setValueAtTime(A, t + d * 0.45); g.gain.exponentialRampToValueAtTime(A * 0.003, t + d + 0.05);
    g2.gain.value = 0.5;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g2); g2.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + d + 0.07);
    const len = Math.floor(ctx.sampleRate * 0.04), buf = ctx.createBuffer(1, len, ctx.sampleRate), nd = buf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.value = 2400;
    const ng = ctx.createGain(); ng.gain.value = A * 0.5;
    src.connect(bp); bp.connect(ng); ng.connect(this.master);
    src.start(t);
  }
  // a tiny sneeze: a breath in, then a short bright "tchi" (filtered noise) - only with the
  // music on
  sneeze() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01, A = MEOW_GAIN * 0.9;
    const len = Math.floor(ctx.sampleRate * 0.5), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(1400, t); bp.frequency.linearRampToValueAtTime(2200, t + 0.18); bp.frequency.setValueAtTime(4200, t + 0.2); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A * 0.12, t + 0.17);
    g.gain.linearRampToValueAtTime(A * 1.1, t + 0.205); g.gain.exponentialRampToValueAtTime(A * 0.004, t + 0.36);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.42);
  }
  // and its purr while she strokes it: a soft rumble (filtered noise, pulsing ~26 times a
  // second), swelling and easing with its breath
  purr(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (on && this.on && !this.purrN) {
      const n = this._purrNodes(ctx, this.master);
      n.out.gain.setValueAtTime(0, now); n.out.gain.linearRampToValueAtTime(PURR_GAIN, now + 0.9);
      this.purrN = n;
    } else if ((!on || !this.on) && this.purrN) {
      const n = this.purrN; this.purrN = null;
      n.out.gain.cancelScheduledValues(now); n.out.gain.setValueAtTime(n.out.gain.value, now);
      n.out.gain.linearRampToValueAtTime(0, now + 0.7);
      setTimeout(() => { try { n.src.stop(); n.lfo.stop(); n.br.stop(); } catch (e) { /* ignore */ } }, 900);
    }
  }
  _purrNodes(ctx, dest) {
    const len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.7;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 26;
    const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    // (breathing in and out)
    const breath = ctx.createGain(); breath.gain.value = 0.7;
    const br = ctx.createOscillator(); br.frequency.value = 0.55;
    const bg = ctx.createGain(); bg.gain.value = 0.3; br.connect(bg); bg.connect(breath.gain);
    const out = ctx.createGain(); out.gain.value = 0;
    src.connect(lp); lp.connect(am); am.connect(breath); breath.connect(out); out.connect(dest);
    src.start(); lfo.start(); br.start();
    return { src, lfo, br, out };
  }
  dispose() {
    this.purr(false);
    this.stop();
    if (this.ctx) setTimeout(() => { try { this.ctx.close(); } catch (e) { /* ignore */ } }, 1500);
  }
}
