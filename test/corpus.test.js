// Regression tests against real-world corpora checked out next to this package.
// Each suite is skipped when its corpus is absent (e.g. in a standalone checkout).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { lintFiles, summarize } from '../lib/lint/index.js';
import { scoreValidatorFile, validatorFiles } from './support/validator-oracle.js';

const sibling = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const validatorDir = sibling('aria/validator-tests');
const hdsDir = sibling('design-system/packages/components/src');

describe.skipIf(!existsSync(validatorDir) && !process.env.CI)('w3c/aria validator-tests', () => {
  const results = validatorFiles(validatorDir).map(scoreValidatorFile);
  const name = (r) => r.file.split('/').pop().replace(/\.html$/, '');
  const fails = results.flatMap((r) => r.fail.map((f) => ({ ...f, id: `${name(r)} ${f.label}` })));

  // Accepted misses: the linter treats `title` as a valid (if weak) accessible name.
  const KNOWN_MISSES = ['img-role-must-have-name #img-2'];

  // "pass" elements in validator-tests are valid only for the property under test; these fire
  // other, legitimate errors (empty popups, unnamed empty headings, missing aria-checked).
  const KNOWN_FALSE_POSITIVES = {
    'aria-required-owned': 3,
    'accessible-name': 3,
    'aria-required-attributes': 16,
  };

  test('every file parses', () => {
    expect(results.filter((r) => r.parseError).map((r) => r.file)).toEqual([]);
  });

  test('detects every marked failure except known misses', () => {
    expect(fails.length).toBeGreaterThanOrEqual(53);
    expect(fails.filter((f) => !f.detected).map((f) => f.id)).toEqual(KNOWN_MISSES);
  });

  test('does not add errors on passing elements beyond the known baseline', () => {
    const counts = {};
    for (const r of results) for (const p of r.pass) for (const id of p.falsePositives) counts[id] = (counts[id] ?? 0) + 1;
    expect(counts).toEqual(KNOWN_FALSE_POSITIVES);
  });
});

describe.skipIf(!existsSync(hdsDir) && !process.env.CI)('HashiCorp Design System components', () => {
  const results = lintFiles([hdsDir], { root: hdsDir });

  test('lints the whole component library', () => {
    expect(results.length).toBeGreaterThan(200);
  });

  test('errors are limited to reviewed true positives', () => {
    const errors = results.flatMap((r) => r.findings.filter((f) => f.severity === 'error').map((f) => `${r.file} ${f.ruleId}`));
    expect(errors).toEqual([
      'components/hds/advanced-table/index.gts accessible-name', // role=grid without a name
      'components/hds/code-block/index.gts aria-role-attributes', // <pre tabindex aria-label> has no role
      'components/hds/code-block/index.gts aria-role-attributes',
    ]);
  });

  test('warnings do not regress', () => {
    expect(summarize(results).warning).toBeLessThanOrEqual(8);
  });
});
