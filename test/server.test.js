import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

let client;
const text = (r) => r.content.map((c) => c.text).join('\n');
const call = (name, args = {}) => client.callTool({ name, arguments: args });

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
});
afterAll(() => client?.close());

describe('MCP server', () => {
  test('advertises all tools as read-only with input schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'audit_ember_template', 'audit_project_setup', 'generate_ember_a11y_tests', 'get_apg_example', 'get_apg_pattern', 'get_aria_attribute', 'get_aria_role',
      'get_ember_example', 'get_html_element_rules', 'get_related_files', 'get_wcag_criterion', 'get_wcag_technique', 'list_a11y_todos', 'list_apg_patterns', 'list_wcag_criteria', 'search_a11y_guidance',
    ]);
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    }
  });

  test.each([
    ['get_aria_role', { role: 'tab' }, /tablist/],
    ['get_aria_attribute', { attribute: 'aria-description' }, /allows it on any element/],
    ['get_html_element_rules', { element: 'a' }, /link/],
    ['list_apg_patterns', {}, /dialog-modal/],
    ['get_apg_pattern', { pattern: 'tabs' }, /Ember reference implementations/],
    ['get_apg_example', { example: 'tabs-manual' }, /Keyboard support/],
    ['get_ember_example', { pattern: 'tabs', kind: 'accessibility' }, /Conformant/],
    ['get_wcag_criterion', { criterion: '2.4.7' }, /Focus Visible \(Level AA\)/],
    ['list_wcag_criteria', { level: 'A' }, /Level A\)/],
    ['get_wcag_technique', { technique: 'H44' }, /label/],
    ['search_a11y_guidance', { query: 'skip link' }, /2\.4\.1/],
    ['generate_ember_a11y_tests', { pattern: 'disclosure' }, /a11yAudit/],
  ])('%s returns content', async (name, args, re) => {
    const r = await call(name, args);
    expect(r.isError ?? false).toBe(false);
    expect(text(r)).toMatch(re);
  });

  test('audit_ember_template returns structured findings', async () => {
    const r = await call('audit_ember_template', { source: '<template><img src="a.png"></template>', filename: 'x.gjs' });
    expect(r.structuredContent.findings).toEqual([expect.objectContaining({ ruleId: 'accessible-name', severity: 'error', line: 1, column: 11 })]);
  });

  test('tool errors are reported, not thrown', async () => {
    const r = await call('audit_ember_template', { path: '../../../etc' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/inside/);
  });

  test('invalid arguments are rejected by the schema', async () => {
    const r = await call('list_wcag_criteria', { level: 'AAAA' }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
    expect(r.isError).toBe(true);
  });

  test('resource and prompt', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('ember-a11y://guide');
    const res = await client.readResource({ uri: 'ember-a11y://guide' });
    expect(res.contents[0].text).toMatch(/unique-id/);
    const p = await client.getPrompt({ name: 'build_accessible_component', arguments: { pattern: 'tabs' } });
    expect(p.messages[0].content.text).toMatch(/get_ember_example[\s\S]*audit_ember_template[\s\S]*get_wcag_criterion/);
    const setup = await client.getPrompt({ name: 'check_a11y_setup', arguments: { path: 'packages/app' } });
    expect(setup.messages[0].content.text).toMatch(/audit_project_setup\(\{ path: "packages\/app" \}\)[\s\S]*until I confirm/);
  });

  test('instructions recommend audit_project_setup as the first step', () => {
    expect(client.getInstructions()).toMatch(/first step[\s\S]*audit_project_setup/);
  });
});
