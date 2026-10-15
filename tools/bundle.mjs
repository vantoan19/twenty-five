// Bundles the engine for the website (site/journey.min.js), locked to the host names in
// site.config.json: copied to another address, the story will not run there.
import fs from 'node:fs';
import { build } from 'esbuild';

const cfg = JSON.parse(fs.readFileSync('site.config.json', 'utf8'));
const hosts = cfg.hosts.map((h) => h.toLowerCase().split('').reverse().join(''));
await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'BirthdayJourney',
  outfile: 'site/journey.min.js',
  define: { __BJ_HOSTS__: JSON.stringify(hosts) },
  legalComments: 'none',
  banner: { js: '/* For You - (c) 2026 vantoan19. All rights reserved. Not to be copied, modified or re-hosted. */' },
  logLevel: 'warning',
});
console.log('site/journey.min.js built for', cfg.hosts.join(', '));
