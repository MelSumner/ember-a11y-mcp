#!/usr/bin/env node
// Builds data/*.json from local clones of the W3C source repositories (and HashiCorp Helios).
// Usage: node scripts/build-data/index.js [--sources <dir>] [--out <dir>] [--only aria,html-aria,apg,wcag,hds]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');

const { values } = parseArgs({
  options: {
    sources: { type: 'string', default: process.env.A11Y_SOURCES_DIR ?? resolve(projectRoot, '..') },
    only: { type: 'string' },
    out: { type: 'string', default: join(projectRoot, 'data') },
  },
});

const sourcesDir = resolve(values.sources);
const only = values.only ? new Set(values.only.split(',')) : null;
const outDir = resolve(values.out);
mkdirSync(outDir, { recursive: true });

const builders = {
  aria: async () => (await import('./aria.js')).buildAria({ sourceDir: join(sourcesDir, 'aria') }),
  'html-aria': async () =>
    (await import('./html-aria.js')).buildHtmlAria({ sourceDir: join(sourcesDir, 'html-aria') }),
  apg: async () => (await import('./apg.js')).buildApg({ sourceDir: join(sourcesDir, 'aria-practices') }),
  wcag: async () => (await import('./wcag.js')).buildWcag({ sourceDir: join(sourcesDir, 'wcag') }),
  hds: async () => (await import('./hds.js')).buildHds({ sourceDir: join(sourcesDir, 'design-system') }),
};

for (const [name, build] of Object.entries(builders)) {
  if (only && !only.has(name)) continue;
  const data = await build();
  const file = join(outDir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
