// Rebuilds data/*.json from the sibling source clones and checks the committed files are exactly what
// the pipeline produces. A failure means either the extractors changed or a clone moved: run `pnpm build:data`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const projectDir = fileURLToPath(new URL('../..', import.meta.url));
const sources = process.env.A11Y_SOURCES_DIR ?? join(projectDir, '..');
const DATASETS = { aria: 'aria', 'html-aam': 'aria', 'html-aria': 'html-aria', apg: 'aria-practices', wcag: 'wcag', hds: 'design-system' };
const available = Object.keys(DATASETS).filter((d) => existsSync(join(sources, DATASETS[d], '.git')));
// CI clones every source; a missing one must fail rather than silently shrink the suite.
if (process.env.CI && available.length !== Object.keys(DATASETS).length) throw new Error(`source clones missing: ${Object.keys(DATASETS).filter((d) => !available.includes(d))}`);
let out, log;

beforeAll(() => {
  if (!available.length) return;
  out = mkdtempSync(join(tmpdir(), 'ea11y-data-'));
  log = execFileSync(process.execPath, ['scripts/build-data/index.js', '--sources', sources, '--out', out, '--only', available.join(',')], {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
});
afterAll(() => out && rmSync(out, { recursive: true, force: true }));

describe.skipIf(!available.length)('data build pipeline', () => {
  test.each(available)('%s.json is reproducible from its source clone', (name) => {
    expect(log).toContain(`${name}.json`);
    const built = readFileSync(join(out, `${name}.json`), 'utf8');
    const committed = readFileSync(join(projectDir, 'data', `${name}.json`), 'utf8');
    expect(built === committed, `data/${name}.json is stale; run pnpm build:data --only ${name}`).toBe(true);
  });

  test.each(available)('%s.json records the commit of its source clone', (name) => {
    const head = execFileSync('git', ['-C', join(sources, DATASETS[name]), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const { source } = JSON.parse(readFileSync(join(out, `${name}.json`), 'utf8'));
    expect(JSON.stringify(source)).toMatch(new RegExp(head.slice(0, 7)));
  });
});
