// Builds a plain HTML test page from the artboard so the engine + markup can be
// exercised locally (outside the Design canvas runtime).
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('artboard/Main.dc.html'), 'utf8');
const helmet = src.match(/<helmet>([\s\S]*?)<\/helmet>/)[1];
let tpl = src.match(/<\/helmet>([\s\S]*?)<\/x-dc>/)[1];
tpl = tpl.replace(/\sref="\{\{[^}]*\}\}"/g, '');
tpl = tpl.replace(/onClick="\{\{\s*(\w+)\s*\}\}"/g, 'data-act="$1"');
if (/\{\{/.test(tpl)) throw new Error('unresolved hole in template');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>harness</title>
${helmet}
<script src="../dist/journey.js"></script>
</head><body>
${tpl}
<script>
const root = document.querySelector('[data-bj-root]');
const canvas = root.querySelector('canvas');
const params = new URLSearchParams(location.search);
const engine = BirthdayJourney.mount({ root, canvas, options: { quality: params.get('q') || 'high', motion: params.get('motion') || 'auto', voice: './voice.js' } });
window.__engine = engine;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'toggleSound') engine.toggleSound();
  else if (a === 'makeWish') engine.makeWish();
  else if (a === 'begin') engine.begin();
  else if (a === 'stay') engine.stay();
  else if (a === 'restart') engine.restart();
  else if (a.startsWith('go')) engine.goToChapter(+a.slice(2));
});
if (params.has('t')) requestAnimationFrame(() => engine.setT(parseFloat(params.get('t'))));
</script>
</body></html>`;
fs.mkdirSync('harness', { recursive: true });
fs.writeFileSync('harness/index.html', html);
console.log('harness written', html.length);
