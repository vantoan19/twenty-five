import { Journey } from './app.js';

// Built for the website, the engine only runs where the story lives: copied to another
// address (or loaded from one), it says so and stays dark. __BJ_HOSTS__ is set at build time
// (see tools/bundle.mjs): the host names it may run on, each written backwards; one that
// starts with "*" allows any host name ending with the rest. Not set (the Claude Design
// canvas build) - no lock.
/* global __BJ_HOSTS__ */
function hereOk() {
  if (typeof __BJ_HOSTS__ === 'undefined') return true;
  const h = String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
  return __BJ_HOSTS__.some((r) => {
    const p = r.split('').reverse().join('');
    return p.charAt(0) === '*' ? h.endsWith(p.slice(1)) : h === p;
  });
}
function notHere(root, canvas) {
  if (canvas) canvas.style.display = 'none';
  if (root && typeof document !== 'undefined') {
    root.setAttribute('data-webgl', 'off');
    const m = document.createElement('div');
    m.textContent = 'This story is not available here.';
    m.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:300 22px/1.4 Georgia,serif;color:#fffdf6;background:linear-gradient(180deg,#3961b3,#6c98df);z-index:99';
    root.appendChild(m);
  }
  const no = () => {};
  return { setOptions: no, toggleSound: no, makeWish: no, begin: no, restart: no, stay: no, goToChapter: no, setT: no, dispose: no };
}

// Mount API used by the artboard's logic class.
export function mount({ root, canvas, options }) {
  if (!hereOk()) return notHere(root, canvas);
  const j = new Journey({ root, canvas, options });
  return {
    setOptions: (o) => j.setOptions(o),
    toggleSound: () => j.toggleSound(),
    makeWish: () => j.makeWish(),
    begin: () => j.begin(),
    restart: () => j.restart(),
    stay: () => j.stay(),
    goToChapter: (i) => j.goToChapter(i),
    setT: (t) => j.setT(t),
    dispose: () => j.dispose(),
    _j: j,
  };
}
export const version = '1.0.0';
