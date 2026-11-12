// Runs the MCP server exactly as an MCP client does: `node index.js` over stdio.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const entry = fileURLToPath(new URL('../../index.js', import.meta.url));
const pkg = (await import('../../package.json', { with: { type: 'json' } })).default;
const text = (r) => r.content.map((c) => c.text).join('\n');

let root, outside, client, stderr = '';

async function connect(env, cwd) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, ...env }, cwd, stderr: 'pipe' });
  transport.stderr?.on('data', (d) => (stderr += d));
  const c = new Client({ name: 'e2e', version: '0.0.0' });
  await c.connect(transport);
  return c;
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ea11y-root-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'ea11y-outside-')));
  mkdirSync(join(root, 'app/components'), { recursive: true });
  writeFileSync(join(root, 'app/components/card.hbs'), '<div {{on "click" this.open}}>Open</div>\n');
  writeFileSync(join(root, 'app/components/fine.gjs'), '<template><button type="button">Fine</button></template>\n');
  writeFileSync(join(outside, 'secret.hbs'), '<img src="secret.png">\n');
  symlinkSync(outside, join(root, 'escape'));
  client = await connect({ EMBER_A11Y_ROOT: root }, outside);
});

afterAll(async () => {
  await client?.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('MCP server over stdio', () => {
  test('initializes with name, version and capabilities', () => {
    expect(client.getServerVersion()).toEqual({ name: 'ember-a11y-mcp', version: pkg.version });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {}, resources: {} });
  });

  test('lists 18 tools, 2 prompts and 1 resource', async () => {
    expect((await client.listTools()).tools).toHaveLength(18);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['check_a11y_setup', 'build_accessible_component']);
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual(['ember-a11y://guide']);
  });

  test('audits a project directory relative to EMBER_A11Y_ROOT', async () => {
    const r = await client.callTool({ name: 'audit_ember_template', arguments: { path: 'app' } });
    expect(r.isError ?? false).toBe(false);
    expect(r.structuredContent.findings).toEqual([expect.objectContaining({ file: 'app/components/card.hbs', ruleId: 'keyboard-accessible-click' })]);
    expect(text(r)).toMatch(/2 file\(s\)/);
  });

  test('audit_project_setup runs relative to EMBER_A11Y_ROOT', async () => {
    const r = await client.callTool({ name: 'audit_project_setup', arguments: {} });
    expect(r.isError ?? false).toBe(false);
    expect(r.structuredContent.summary.fail).toBe(1);
    expect(text(r)).toMatch(/No readable package.json/);
  });

  test('refuses paths outside EMBER_A11Y_ROOT, including through symlinks', async () => {
    for (const path of ['..', outside, 'escape', 'escape/secret.hbs']) {
      const r = await client.callTool({ name: 'audit_ember_template', arguments: { path } });
      expect(r.isError, path).toBe(true);
      expect(text(r), path).toMatch(/must be inside/);
    }
  });

  test('does not follow symlinks out of the root when walking directories', async () => {
    const r = await client.callTool({ name: 'audit_ember_template', arguments: { path: '.' } });
    expect(r.isError ?? false).toBe(false);
    expect(r.structuredContent.findings.map((f) => f.file)).toEqual(['app/components/card.hbs']);
  });

  test('reports a missing path as a tool error', async () => {
    const r = await client.callTool({ name: 'audit_ember_template', arguments: { path: 'nope' } });
    expect(r.isError).toBe(true);
  });

  test('serves every data-backed tool from the shipped data files', async () => {
    const calls = {
      get_aria_role: { role: 'combobox' },
      get_apg_pattern: { pattern: 'combobox' },
      get_ember_example: { component: 'dropdown', kind: 'implementation', maxChars: 2000 },
      get_wcag_criterion: { criterion: '1.4.3' },
      generate_ember_a11y_tests: { pattern: 'combobox' },
    };
    for (const [name, args] of Object.entries(calls)) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError ?? false, name).toBe(false);
      expect(text(r).length, name).toBeGreaterThan(200);
    }
  });

  test('handles concurrent requests', async () => {
    const results = await Promise.all(['button', 'tab', 'dialog', 'slider', 'switch'].map((role) => client.callTool({ name: 'get_aria_role', arguments: { role } })));
    results.forEach((r, i) => expect(text(r)).toContain(['button', 'tab', 'dialog', 'slider', 'switch'][i]));
  });

  test('writes nothing but protocol messages to stdout', async () => {
    await client.callTool({ name: 'get_aria_role', arguments: { role: 'button' } });
    // Any stray console.log would corrupt the JSON-RPC stream and fail the calls above; stderr must stay quiet too.
    expect(stderr).toBe('');
  });

  test('defaults the audit root to the working directory', async () => {
    const env = { ...process.env };
    delete env.EMBER_A11Y_ROOT;
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env, cwd: root });
    const c = new Client({ name: 'e2e-cwd', version: '0.0.0' });
    await c.connect(transport);
    const r = await c.callTool({ name: 'audit_ember_template', arguments: { path: 'app/components/card.hbs' } });
    expect(r.structuredContent.findings).toHaveLength(1);
    await c.close();
  });

  test('exits when the client closes stdin', async () => {
    const c = await connect({ EMBER_A11Y_ROOT: root }, root);
    const transport = c.transport;
    const pid = transport.pid;
    await c.close();
    const alive = () => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    const deadline = Date.now() + 5000;
    while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(alive()).toBe(false);
  });
});
