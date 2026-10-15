// Builds the deployable page, site/index.html, from the artboard (the Claude Design canvas
// source in artboard/Main.dc.html): its styles and markup, with the engine
// (site/journey.min.js, from `npm run bundle`) and the narrator's voice (site/voice.js)
// beside it. The whole of site/ is a static website.
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('artboard/Main.dc.html'), 'utf8');
const helmet = src.match(/<helmet>([\s\S]*?)<\/helmet>/)[1];
let tpl = src.match(/<\/helmet>([\s\S]*?)<\/x-dc>/)[1];
tpl = tpl.replace(/\sref="\{\{[^}]*\}\}"/g, '');
tpl = tpl.replace(/onClick="\{\{\s*(\w+)\s*\}\}"/g, 'data-act="$1"');
if (/\{\{/.test(tpl)) throw new Error('unresolved hole in template');

const icon = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#3961b3"/><path d="M12 3.2 20.8 12 12 20.8 3.2 12Z" fill="none" stroke="#fffdf6" stroke-width="1.4"/><path d="M12 15.4c-2.2-1.5-3.5-2.7-3.5-4.1 0-1 .8-1.9 1.9-1.9.7 0 1.2.3 1.6.9.4-.6.9-.9 1.6-.9 1.1 0 1.9.9 1.9 1.9 0 1.4-1.3 2.6-3.5 4.1Z" fill="#f3d9a4"/></svg>');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>For You — The day you arrived</title>
<meta name="description" content="A little story, told for a 25th birthday.">
<meta name="theme-color" content="#3961b3">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
<meta name="copyright" content="(c) 2026 vantoan19. All rights reserved.">
<link rel="icon" href="data:image/svg+xml,${icon}">
${helmet.trim()}
<style>
/* (not for copying: no selecting or dragging the words and pictures, no long-press menus) */
html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
img,canvas,svg{-webkit-user-drag:none;user-drag:none}
@media print{body{display:none}}
</style>
<script src="./journey.min.js"></script>
</head>
<body>
${tpl.trim()}
<script>
(function () {
  var root = document.querySelector('[data-bj-root]');
  var canvas = root.querySelector('canvas');
  var params = new URLSearchParams(location.search);
  var engine = null;
  try {
    engine = BirthdayJourney.mount({ root: root, canvas: canvas, options: { quality: params.get('q') || 'auto', motion: params.get('motion') || 'auto', voice: './voice.js' } });
  } catch (e) {
    root.setAttribute('data-webgl', 'off');
  }
  window.__engine = engine;
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || !engine) return;
    var a = b.dataset.act;
    if (a === 'toggleSound') engine.toggleSound();
    else if (a === 'makeWish') engine.makeWish();
    else if (a === 'begin') engine.begin();
    else if (a === 'stay') engine.stay();
    else if (a === 'restart') engine.restart();
  });
  // (not for copying: no right-click menu, no dragging, selecting or copying, no saving,
  // printing or viewing the source from the keyboard)
  var stop = function (e) { e.preventDefault(); return false; };
  ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut'].forEach(function (k) { document.addEventListener(k, stop, { capture: true }); });
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === 'f12' || (mod && (k === 's' || k === 'u' || k === 'p' || k === 'c')) || (mod && (e.shiftKey || e.altKey) && (k === 'i' || k === 'j' || k === 'c'))) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });
  // (the story scrolls in its own frame: give it the keyboard straight away)
  try { root.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
})();
</script>
</body>
</html>
`;
fs.mkdirSync('site', { recursive: true });
fs.writeFileSync('site/index.html', html);
console.log('site/index.html written', html.length);
