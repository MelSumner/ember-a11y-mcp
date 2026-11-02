// Runs tests produced by generate_ember_a11y_tests inside a real Ember app: the HDS showcase
// (../design-system/showcase). Each case is generated through the MCP server over stdio, written
// into the showcase's tests/integration folder, and run with `ember test` in headless Chrome.
//
// Requirements: a clone of hashicorp/design-system next to this package, `pnpm install` and
// `pnpm build:packages` in it, Node >= 24 (HDS's engine requirement) and Chrome.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cases as allCases } from './showcase-cases.js';

// HDS_E2E_ONLY=tabs-hds,breadcrumb-native runs a subset (handy when debugging one case).
const only = process.env.HDS_E2E_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const cases = only?.length ? allCases.filter((c) => only.includes(c.id)) : allCases;

const entry = fileURLToPath(new URL('../../index.js', import.meta.url));
const SHOWCASE = process.env.HDS_SHOWCASE_DIR ?? fileURLToPath(new URL('../../../design-system/showcase', import.meta.url));
const OUT_DIR = join(SHOWCASE, 'tests/integration/ember-a11y-mcp-e2e');
const MODULE_PREFIX = 'ember-a11y-mcp e2e';
const nodeMajor = Number(process.versions.node.split('.')[0]);
const BUILT = join(SHOWCASE, '../packages/components/dist');

const skip =
  !existsSync(join(SHOWCASE, 'node_modules')) ? `no installed HDS showcase at ${SHOWCASE}` :
  !existsSync(BUILT) ? 'HDS packages are not built (run `pnpm build:packages` in the showcase)' :
  nodeMajor < 24 ? `HDS requires Node >= 24 (running ${process.versions.node})` :
  null;
// The dedicated CI job sets REQUIRE_HDS=1 so a missing install or build fails instead of skipping.
if (skip && process.env.REQUIRE_HDS) throw new Error(`HDS showcase suite cannot run: ${skip}`);
if (skip) console.warn(`[hds-showcase] skipped: ${skip}`);

const pascal = (id) => id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

/**
 * Parse TAP lines like `ok 3 Chrome 141.0 - [12 ms] - ember-a11y-mcp e2e | tabs-hds: passes axe-core audit`
 * into Map<caseId, Map<testName, { ok, diagnostics }>>. Diagnostics are the indented lines after a result.
 */
export function parseTap(output) {
  const results = new Map();
  const re = new RegExp(`^(not ok|ok) \\d+ .*?${MODULE_PREFIX} \\| ([\\w-]+): (.+?)\\s*$`);
  let current = null;
  for (const line of output.split('\n')) {
    const m = re.exec(line);
    if (m) {
      const [, status, id, name] = m;
      if (!results.has(id)) results.set(id, new Map());
      current = { ok: status === 'ok', diagnostics: '' };
      results.get(id).set(name, current);
    } else if (/^(ok|not ok) \d+/.test(line)) current = null;
    else if (current && /^\s/.test(line)) current.diagnostics += line + '\n';
  }
  return results;
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe.skipIf(skip)('generated tests run in the HDS showcase', () => {
  let results, output;

  beforeAll(async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe' });
    const client = new Client({ name: 'hds-e2e', version: '0.0.0' });
    await client.connect(transport);
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    try {
      for (const c of cases) {
        const r = await client.callTool({
          name: 'generate_ember_a11y_tests',
          arguments: {
            pattern: c.pattern,
            componentName: pascal(c.id),
            invocation: c.invocation,
            setupImport: 'showcase/tests/helpers',
            ...(c.importPath ? { importPath: c.importPath, namedExport: c.namedExport } : {}),
          },
        });
        const src = r.content.map((x) => x.text).join('\n');
        if (r.isError || !/^module\('/m.test(src)) throw new Error(`generator failed for ${c.id}:\n${src}`);
        writeFileSync(join(OUT_DIR, `${c.id}-test.gjs`), src.replace(/^module\('[^']*'/m, `module('${MODULE_PREFIX} | ${c.id}'`));
      }
    } finally {
      await client.close();
    }
    ({ out: output } = await run('pnpm', ['exec', 'ember', 'test', '--filter', MODULE_PREFIX, '--reporter', 'tap'], SHOWCASE));
    results = parseTap(output);
  });

  afterAll(() => {
    // The showcase is the user's clone; never leave generated files behind.
    rmSync(OUT_DIR, { recursive: true, force: true });
  });

  test('every generated module compiled and ran', () => {
    const missing = cases.filter((c) => !results.has(c.id)).map((c) => c.id);
    expect(missing, missing.length ? output.slice(-4000) : '').toEqual([]);
  });

  describe.each(cases)('$id', (c) => {
    test(c.fails ? `catches the defect in: ${c.fails.join(', ')}` : 'all generated checks pass', () => {
      const tests = results.get(c.id);
      expect(tests, `no results for ${c.id}`).toBeDefined();
      const failed = [...tests].filter(([, r]) => !r.ok);
      const details = failed.map(([name, r]) => `--- ${name}\n${r.diagnostics.slice(0, 3000)}`).join('\n');
      expect(failed.map(([name]) => name).sort(), details).toEqual([...(c.fails ?? [])].sort());
    });
  });
});
