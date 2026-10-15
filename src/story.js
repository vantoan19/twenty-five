// The narrated story. One line of the script at a time: read aloud by the narrator (a gentle
// old woman telling a fairy tale) and shown on screen word by word as she reads it. Each line
// holds the journey back until it has been read and a breath taken after it, so however fast
// the page is scrolled nothing of the story is lost - and the story only ever moves forward.
import { clamp } from './math.js';

// How long each recorded line lasts (seconds of speech)
export const VOICE_DUR = {
  n01: 2.196, n02: 4.133, n03: 2.239, n04: 2.138, n05: 3.418, n06: 2.246, n07: 1.971, n08: 2.402, n09: 1.695,
  n10: 1.849, n11: 2.162, n12: 3.155, n13: 2.457, n14: 1.793, n15: 2.509, n16: 1.998, n17: 2.392, n18: 3.564,
  n19: 1.224, n20: 2.214, n21: 1.914, n22: 2.514, n23: 1.905, n24: 1.904, n25: 2.607, n26: 2.284, n27: 2.568,
  n28: 1.898, n29: 1.771, n30: 1.708, n31: 2.135, n32: 2.039, n33: 1.652, n34: 1.633, n35: 1.507, n36: 1.621,
  n37: 1.559, n38: 3.034, n39: 2.821, n40: 1.831, n41: 1.807, n42: 3.038, n43: 2.777, n44: 2.214,
};

// The script: [id, kind, t, text]
//  kind  c: a chapter's title card ("label|title")   n: the narrator's line (read aloud)
//        m: his own words (no voice: they are his)    a: after her wish (his words too)
//  t     where on the journey the line begins (the world's timeline, see timeline.js); lines
//        at the same t follow one another while the journey waits there
export const SCRIPT = [
  // Chapter One - An angel arrives (over the sea of clouds; she flies past us and away
  // round the peaks; down through the clouds into the valley)
  ['c1', 'c', 0.0046, 'Chapter One|An angel arrives'],
  ['n01', 'n', 0.0075, 'Let me tell you a little story.'],
  ['n02', 'n', 0.013, 'It began twenty-five years ago, on the sixteenth of October.'],
  ['n03', 'n', 0.0235, 'An angel came down from the sky.'],
  ['n04', 'n', 0.058, 'She didn’t know what was waiting for her.'],
  ['n05', 'n', 0.11, 'But something about this world made her want to stay.'],
  ['n06', 'n', 0.233, 'And so, on October 16…'],
  ['n07', 'n', 0.2515, 'The world became a little brighter.'],
  // Chapter Two - The beauty she brings (her wings melt away; her cat and her dog; the
  // flower; the meadow blooming after her)
  ['c2', 'c', 0.266, 'Chapter Two|The beauty she brings'],
  ['n08', 'n', 0.274, 'She left heaven to live here with us.'],
  ['n09', 'n', 0.2845, 'And we’re so lucky she did.'],
  ['n10', 'n', 0.2925, 'There was so much to love about her.'],
  ['n11', 'n', 0.2925, 'The way she smiled at little things.'],
  ['n12', 'n', 0.2925, 'The way she always had time for a small friend.'],
  ['n13', 'n', 0.404, 'And when someone needed her, she listened.'],
  ['n14', 'n', 0.414, 'She cared about how they felt.'],
  ['n15', 'n', 0.424, 'Sometimes, just being there was enough.'],
  ['n16', 'n', 0.434, 'She made people feel less alone.'],
  ['n17', 'n', 0.47, 'She didn’t always notice the difference she made.'],
  ['n18', 'n', 0.488, 'But to someone, an ordinary day felt a little better…'],
  ['n19', 'n', 0.506, 'Because she was there.'],
  // Chapter Three - The light she carries (up the misty mountain path, her footprints
  // glowing; a rest, looking back; the summit at sunset)
  ['c3', 'c', 0.526, 'Chapter Three|The light she carries'],
  ['n20', 'n', 0.545, 'Life wasn’t always easy for her.'],
  ['n21', 'n', 0.556, 'Some days, she felt tired.'],
  ['n22', 'n', 0.567, 'Some days, she wasn’t sure she could do it.'],
  ['n23', 'n', 0.585, 'But there were things she cared about.'],
  ['n24', 'n', 0.597, 'Dreams she wanted to follow.'],
  ['n25', 'n', 0.609, 'So she tried, even when it was hard.'],
  ['n26', 'n', 0.622, 'And every little step mattered.'],
  ['n27', 'n', 0.6545, 'I wonder if she knows how far she’s come.'],
  ['n28', 'n', 0.6545, 'Or how proud someone is of her.'],
  ['n29', 'n', 0.6545, 'Not just on the good days.'],
  ['n30', 'n', 0.6545, 'On the difficult ones, too.'],
  ['n31', 'n', 0.738, 'There was still so much ahead of her.'],
  ['n32', 'n', 0.748, 'But for a moment, she could rest.'],
  ['n33', 'n', 0.756, 'Feel the sun on her face.'],
  ['n34', 'n', 0.764, 'And be proud of herself, too.'],
  ['n35', 'n', 0.772, 'Look how far you’ve come.'],
  // Chapter Four - A wish for you (the meadow at dusk, the lights coming on; her cake;
  // his words; her wish)
  ['c4', 'c', 0.78, 'Chapter Four|A wish for you'],
  ['n36', 'n', 0.79, 'And now, here she is.'],
  ['n37', 'n', 0.8, 'Twenty-five years old.'],
  ['n38', 'n', 0.81, 'With more places to see, more people to meet…'],
  ['n39', 'n', 0.824, 'And dreams she hasn’t even thought of yet.'],
  ['n40', 'n', 0.849, 'But tonight is just for her.'],
  ['n41', 'n', 0.858, 'There’s nothing she needs to do.'],
  ['n42', 'n', 0.867, 'She can simply be here, with those who love her.'],
  ['n43', 'n', 0.877, 'Today, let yourself be loved a little extra.'],
  ['n44', 'n', 0.905, 'And someone has a few words for you.'],
  ['m1', 'm', 0.92, 'Happy 25th birthday, my love.'],
  ['m2', 'm', 0.934, 'I hope this year brings you lots of reasons to smile.'],
  ['m3', 'm', 0.948, 'I hope you get a little closer to the things you dream of.'],
  ['m4', 'm', 0.962, 'And when things feel hard, I hope you remember…'],
  ['m5', 'm', 0.976, 'You don’t have to face them alone.'],
  ['a1', 'a', 2, 'I’m so glad you’re here.'],
  ['a2', 'a', 2, 'And so lucky I get to love you.'],
];

// Moments the journey stops for while something happens (seconds, at the least): she pets
// her cat and her dog; she rests on the mountain path and looks back
export const MOMENTS = [
  { id: 'pet', t: 0.2925, dur: 11.5 },
  { id: 'rest', t: 0.6545, dur: 11.5 },
];

const PAUSE = 1.3;       // a breath after each line read aloud
const CARD = 2.7;        // a chapter's title card
const words = (s) => s.split(/\s+/).filter(Boolean);
// (his words have no voice: they stay up long enough to be read, slowly)
const readTime = (s) => Math.max(2.6, 1.0 + words(s).length * 0.38);

// ---------------------------------------------------------------------------
// The narrator's voice: every line in one recording, decoded once, each played on its own
// (the music softens under her voice)
class Narrator {
  constructor(music) {
    this.music = music;
    this.state = 'idle';
    this.buf = null; this.table = null; this.src = null; this.gain = null;
  }
  load(url) {
    if (this.state !== 'idle' || !url || typeof document === 'undefined') return;
    this.state = 'loading';
    const done = () => this.decode();
    if (window.__bjVoice) { done(); return; }
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = done;
    s.onerror = () => { this.state = 'failed'; };
    document.head.appendChild(s);
  }
  async decode() {
    const V = window.__bjVoice;
    const ctx = this.music.ensure();
    if (!V || !ctx) { this.state = 'failed'; return; }
    this.table = V.t;
    try {
      const bin = atob(V.a);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      this.buf = await new Promise((res, rej) => ctx.decodeAudioData(u8.buffer, res, rej));
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.92;
      this.gain.connect(ctx.destination);
      this.state = 'ready';
      if (this.pending) { const p = this.pending; this.pending = null; if (performance.now() - p.at < 1500) this.play(p.id); }
    } catch (e) {
      this.state = 'failed';
    }
  }
  play(id, into = 0) {
    if (this.state !== 'ready') { if (this.state === 'loading') this.pending = { id, at: performance.now() }; return 0; }
    const e = this.table && this.table[id];
    const ctx = this.music.ctx;
    if (!e || !ctx) return 0;
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.buf;
    src.connect(this.gain);
    const [start, dur] = e;
    // (a hair early and a little after: the recording has silence round every line)
    const off = Math.max(0, start - 0.05 + into), len = Math.max(0.1, dur + 0.25 - into);
    src.start(ctx.currentTime + 0.02, off, len);
    this.src = src;
    this.music.duck(true);
    src.onended = () => { if (this.src === src) { this.src = null; this.music.duck(false); } };
    return len;
  }
  stop() {
    if (this.src) { try { this.src.onended = null; this.src.stop(); } catch (e) { /* already done */ } this.src = null; this.music.duck(false); }
  }
}

// ---------------------------------------------------------------------------
export class Story {
  constructor(j) {
    this.j = j;
    this.voice = new Narrator(j.music);
    this.sound = false;
    this.lines = SCRIPT.map(([id, k, t, text]) => ({ id, k, t, text, dur: 0 }));
    this.moments = MOMENTS.map((m) => ({ ...m, at: undefined }));
    this.setDurations();
    this.reset(0);
    this.capS = 1;
  }
  setDurations() {
    for (const L of this.lines) {
      if (L.k === 'c') L.dur = CARD;
      else if (L.k === 'n') L.dur = (VOICE_DUR[L.id] || readTime(L.text)) + PAUSE;
      else L.dur = readTime(L.text) + 1.0;
    }
  }
  // (re)arm the story from t (lines before it count as told)
  reset(t = 0) {
    this.idx = 0;
    for (const L of this.lines) { L.on = false; L.done = L.k !== 'a' && L.t < t - 1e-6; L.t0 = 0; L.end = 0; }
    while (this.idx < this.lines.length && this.lines[this.idx].done) this.idx++;
    this.cur = null; this.card = null; this.shown = null;
    for (const M of this.moments) M.at = M.t < t - 1e-6 ? -1e9 : undefined;
    this.wishReady = false; this.afterAt = undefined; this.endAt = undefined;
    this.voice.stop();
    if (this.dom) { for (const s of this.dom.slots) { s.dataset.show = '0'; } this.dom.card.dataset.show = '0'; }
  }
  // The page's own copy of the script (it can be edited there) and the places it is shown
  bindDom(root) {
    if (!root || typeof document === 'undefined') return;
    let box = root.querySelector('.bj-script');
    if (!box) {
      box = document.createElement('div');
      box.className = 'bj-script';
      box.setAttribute('aria-live', 'polite');
      (root.querySelector('.bj-stage') || root).appendChild(box);
    }
    const slots = Array.from(box.querySelectorAll('.bj-cap'));
    while (slots.length < 2) { const p = document.createElement('p'); p.className = 'bj-cap'; box.appendChild(p); slots.push(p); }
    let card = root.querySelector('.bj-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'bj-card';
      card.innerHTML = '<span class="bj-card-k"></span><span class="bj-card-t"></span>';
      (root.querySelector('.bj-stage') || root).appendChild(card);
    }
    const tpl = root.querySelector('template[data-script]');
    if (tpl) {
      const by = {};
      (tpl.content || tpl).querySelectorAll('[data-id]').forEach((el) => { by[el.getAttribute('data-id')] = el.textContent.trim(); });
      for (const L of this.lines) if (by[L.id]) L.text = by[L.id];
      this.setDurations();
    }
    this.dom = { root, box, slots, card, si: 0 };
  }
  // The furthest the journey may go now, and how fast (timeline per second): a line being
  // read keeps the next one back - the journey flows on toward it so as to reach it just as
  // this one has been read (a breath after it) - and a moment holds it where it is
  gate(t, time) {
    let gT = 1, cap = Infinity;
    const L = this.cur, N = this.lines[this.idx];
    if (L && time < L.end && N && N.k !== 'a') {
      gT = Math.min(gT, N.t);
      cap = Math.min(cap, Math.max(0, N.t - t) / Math.max(0.3, L.end - time));
    }
    for (const M of this.moments) {
      if (M.at === undefined) {
        // (easing to a stop as it comes up to it)
        if (M.t > t) cap = Math.min(cap, Math.max(0.0006, (M.t - t) * 1.8));
      } else if (time < M.at + M.dur) {
        gT = Math.min(gT, M.t);
        cap = 0;
      }
    }
    return { t: gT, cap };
  }
  // the journey is at t: begin the lines it has reached (each in turn), keep the words on
  // screen while they are read and a little after
  advance(t, time) {
    for (const M of this.moments) if (M.at === undefined && t >= M.t - 2e-5) M.at = time;
    for (;;) {
      const N = this.lines[this.idx];
      if (!N || N.k === 'a' || t < N.t - 1e-6) break;
      if (this.cur && time < this.cur.end) break;
      this.begin(N, time);
      this.idx++;
    }
    // after her wish, his last words, one and then the other
    if (this.afterAt !== undefined) {
      const N = this.lines[this.idx];
      if (N && N.k === 'a' && time >= this.afterAt && (!this.cur || time >= this.cur.end)) { this.begin(N, time); this.idx++; }
      if (this.endAt === undefined && this.idx >= this.lines.length && this.cur && time >= this.cur.end - 1.0) this.endAt = time + 1.2;
    }
    // the wish: once his words have all been read
    const last = this.lines.find((L) => L.id === 'm5');
    if (!this.wishReady && last && last.on && time > last.end + 0.2 && t > 0.975) this.wishReady = true;
    // what is on screen
    this.updateDom(t, time);
  }
  begin(L, time) {
    if (this.cur && this.cur !== L) this.cur.done = true;
    L.on = true; L.t0 = time; L.end = time + L.dur;
    this.cur = L;
    if (L.k === 'c') { this.card = L; this.cardEnd = L.end; return; }
    if (L.k === 'n' && this.sound) this.voice.play(L.id);
  }
  onWish(time) { this.afterAt = time + 3.4; }
  // sound on/off (on: from the line being read, if it has only just begun)
  setSound(on, url) {
    this.sound = on;
    if (!on) { this.voice.stop(); return; }
    if (url) this.voice.load(url);
    const L = this.cur, time = this.j.time;
    if (L && L.k === 'n' && time - L.t0 < 1.2) this.voice.play(L.id, Math.max(0, time - L.t0 - 0.15));
  }
  // ---------------------------------------------------------------------------
  updateDom(t, time) {
    const D = this.dom;
    if (!D) return;
    // the line: shown from when it begins until the next one does - or, if the journey rests
    // (or flies on a long way before the next), a while after it has been read
    const L = this.cur && this.cur.k !== 'c' ? this.cur : null;
    let want = null;
    if (L && (L.k === 'm' || L.k === 'a' || time < L.end + 1.6 || (time < L.end + 6 && t < L.t + 0.012))) want = L;
    // (his last words stay while the wish is waiting, and go as she makes it)
    if (L && L.id === 'm5' && this.j.wished) want = null;
    if (want !== this.shown) {
      const old = D.slots[D.si];
      if (this.shown) { old.dataset.show = '0'; old.setAttribute('aria-hidden', 'true'); }
      this.shown = want;
      if (want) {
        D.si = (D.si + 1) % D.slots.length;
        const el = D.slots[D.si];
        const ws = words(want.text);
        const span = Math.max(0.6, (want.k === 'n' ? (VOICE_DUR[want.id] || 2) : Math.min(2.4, want.dur * 0.4)) * 0.82);
        const step = clamp(span / Math.max(1, ws.length), 0.1, 0.34);
        el.innerHTML = ws.map((w, i) => `<span class="cw" style="--d:${(0.08 + i * step).toFixed(2)}s">${w.replace(/</g, '&lt;')}</span>`).join(' ');
        el.dataset.kind = want.k;
        el.dataset.show = '0';
        void el.offsetWidth;
        el.dataset.show = '1';
        el.setAttribute('aria-hidden', 'false');
      }
    }
    // the chapter card
    const cOn = this.card && time < this.cardEnd ? '1' : '0';
    if (this.card && D.card._id !== this.card.id) {
      D.card._id = this.card.id;
      const [k, ti] = this.card.text.split('|');
      D.card.querySelector('.bj-card-k').textContent = k || '';
      D.card.querySelector('.bj-card-t').textContent = ti || '';
    }
    if (D.card.dataset.show !== cOn) D.card.dataset.show = cOn;
    const end = this.endAt !== undefined && time >= this.endAt ? '1' : '';
    if ((D.root.dataset.end || '') !== end && D.root.dataset.end !== 'stay') D.root.dataset.end = end;
  }
  // how much of the picture the words cover (for the soft scrim behind them)
  scrim() { return this.shown ? 1 : 0; }
  captionEl() { return this.dom && this.shown ? this.dom.slots[this.dom.si] : null; }
}
