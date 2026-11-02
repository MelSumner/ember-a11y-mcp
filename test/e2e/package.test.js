// Packs the project, installs the tarball into a fresh project and runs both published binaries.
// This catches files missing from package.json "files", broken bin shebangs and undeclared dependencies.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const projectDir = fileURLToPath(new URL('../..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let work, app, packed;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'ea11y-pack-'));
  packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', work], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0];
  app = join(work, 'app');
  mkdirSync(join(app, 'app/components'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  writeFileSync(join(app, 'app/components/bad.gts'), '<template><img src="logo.png"><span role="buton">x</span></template>\n');
  execFileSync(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', join(work, packed.filename)], { cwd: app, stdio: 'ignore' });
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

const bin = (name) => join(app, 'node_modules/.bin', name);

describe('published package', () => {
  test('contains runtime files and data, but no tests or build scripts', () => {
    const files = packed.files.map((f) => f.path);
    for (const f of ['index.js', 'bin/ember-a11y-lint.js', 'lib/tools.js', 'lib/lint/rules.js', 'test-support/focus.js', 'LICENSE', 'NOTICE.md', 'README.md']) expect(files).toContain(f);
    for (const d of ['aria', 'html-aria', 'apg', 'wcag', 'hds']) expect(files).toContain(`data/${d}.json`);
    expect(files.filter((f) => /^(test|scripts|coverage)\//.test(f) || f.startsWith('vitest'))).toEqual([]);
  });

  test('installs only the declared runtime dependencies', () => {
    const installed = readdirSync(join(app, 'node_modules'));
    expect(installed).not.toContain('vitest');
    expect(installed).not.toContain('cheerio');
  });

  test('ember-a11y-lint runs from node_modules/.bin', () => {
    const r = spawnSync(bin('ember-a11y-lint'), ['--format', 'json'], { cwd: app, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const ids = JSON.parse(r.stdout).results.flatMap((x) => x.findings.map((f) => f.ruleId));
    expect(ids).toEqual(expect.arrayContaining(['accessible-name', 'no-invalid-role']));
  });

  test('ember-a11y-mcp starts over stdio and audits the consumer app', async () => {
    const transport = new StdioClientTransport({ command: bin('ember-a11y-mcp'), args: [], cwd: app, env: { ...process.env, EMBER_A11Y_ROOT: app } });
    const client = new Client({ name: 'e2e-pack', version: '0.0.0' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(16);
      const r = await client.callTool({ name: 'audit_ember_template', arguments: { path: 'app' } });
      expect(r.structuredContent.findings.length).toBeGreaterThanOrEqual(2);
      const setup = await client.callTool({ name: 'audit_project_setup', arguments: {} });
      expect(setup.structuredContent.project).toMatchObject({ name: 'consumer', ember: false });
      const ex = await client.callTool({ name: 'get_ember_example', arguments: { pattern: 'tabs' } });
      expect(ex.isError ?? false).toBe(false);
    } finally {
      await client.close();
    }
  });
});
