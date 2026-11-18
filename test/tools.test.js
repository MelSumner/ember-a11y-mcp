import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Preprocessor } from 'content-tag';
import {
  getAriaRole, getAriaAttribute, getHtmlElementRules, getHtmlElementInfo, getHtmlAamMapping, listApgPatterns, getApgPattern, getApgExample,
  searchGuidance, auditEmberTemplate, generateEmberA11yTests, toKeyEvent,
  getEmberExample, getWcagCriterion, listWcagCriteria, getWcagTechnique,
} from '../lib/tools.js';
import { apg, htmlStandard } from '../lib/data/index.js';

describe('spec lookups', () => {
  test('role, attribute and element lookups', () => {
    expect(getAriaRole({ role: 'tab' })).toMatch(/tablist/);
    expect(getAriaRole({ role: 'buton' })).toMatch(/button/);
    expect(getAriaAttribute({ attribute: 'aria-expanded' })).toMatch(/true/);
    expect(getHtmlElementRules({ element: 'button' })).toMatch(/button/);
  });

  test('dt lookup includes cross-spec role, naming and focus guidance', () => {
    const result = getHtmlElementRules({ element: 'dt' });
    expect(result).toMatch(/Allowed roles:\*\* listitem/);
    expect(result).toContain('HTML-AAM maps `<dt>` to the `term` role');
    expect(result).toContain('`aria-label` is allowed');
    expect(result).toContain('programmatic focus');
    expect(result).toContain('sequential Tab navigation');
  });

  test('HTML-AAM lookups include element, attribute and name-computation mappings', () => {
    expect(getHtmlAamMapping({ query: 'button' })).toMatch(/button.*role/s);
    expect(getHtmlAamMapping({ query: 'checked', kind: 'attribute' })).toMatch(/aria-checked.*true/s);
    expect(getHtmlAamMapping({ query: 'button', kind: 'computation' })).toMatch(/subtree/);
  });

  test('HTML Standard lookup answers dt focus and attribute questions locally', () => {
    const info = getHtmlElementInfo({ element: 'dt' });
    expect(info.length).toBeLessThan(2500);
    expect(info).toMatch(/<dt>/);
    expect(info).toMatch(/tabindex/);
    expect(info).toMatch(/platform conventions/);
    expect(info).toMatch(/Global HTML attributes:\*\* \d+ apply/);
    expect(info).not.toContain('accesskey, autocapitalize');
    expect(getHtmlElementInfo({ element: 'dt', includeGlobalAttributes: true })).toContain('accesskey');
    expect(getHtmlElementInfo({ element: 'dt', includeFocusDetails: true }).length).toBeGreaterThan(info.length + 5000);
    expect(getHtmlElementInfo({ element: 'dt', attribute: 'autofocus' })).toMatch(/valid HTML attribute/);
    expect(getHtmlElementInfo({ element: 'dt', attribute: 'href' })).toMatch(/No: `href`/);
  });

  test('HTML Standard lookup resolves every indexed element name', () => {
    for (const tag of htmlStandard().elements.flatMap((entry) => entry.tags)) {
      expect(getHtmlElementInfo({ element: tag }), tag).toContain(`# <${tag}>`);
    }
  });

  test('APG pattern, example and search', () => {
    expect(listApgPatterns()).toMatch(/tabs/);
    expect(getApgPattern({ pattern: 'tabs' })).toMatch(/Ember/);
    const ex = apg().examples[0].id;
    expect(getApgExample({ example: ex }).length).toBeGreaterThan(200);
    expect(searchGuidance({ query: 'focus trap modal dialog' })).toMatch(/dialog/i);
    expect(searchGuidance({ query: 'HTML-AAM input checkbox' })).toMatch(/get_html_aam_mapping/);
    expect(searchGuidance({ query: 'WHATWG HTML dt autofocus' })).toMatch(/get_html_element_info/);
  });
});

describe('WCAG 2.2', () => {
  test('criterion lookup by number, id and title', () => {
    const out = getWcagCriterion({ criterion: '4.1.2' });
    expect(out).toMatch(/^# 4\.1\.2 Name, Role, Value \(Level A\)/);
    expect(out).toMatch(/\*\*Goal:\*\*/);
    expect(out).toMatch(/`accessible-name`/);
    expect(out).toMatch(/ARIA14/);
    expect(getWcagCriterion({ criterion: 'target size' })).toMatch(/^# 2\.5\.8/);
    expect(getWcagCriterion({ criterion: '4.1.1' })).toMatch(/OBSOLETE/);
  });

  test('AA checklist excludes AAA and obsolete criteria', () => {
    const out = listWcagCriteria({});
    expect(out).toMatch(/^55 criteria/m);
    expect(out).not.toMatch(/\| 4\.1\.1 \|/);
    expect(out).not.toMatch(/\| AAA \|/);
  });

  test('technique lookup', () => {
    expect(getWcagTechnique({ technique: 'aria14' })).toMatch(/aria-label/);
    expect(getWcagTechnique({ technique: 'PDF1' })).toMatch(/Unknown/);
  });
});

describe('HDS Ember examples', () => {
  test('lists components and resolves APG patterns', () => {
    expect(getEmberExample({})).toMatch(/components\/tabs/);
    expect(getEmberExample({ pattern: 'tabs' })).toMatch(/^# Tabs — HDS/);
    expect(getEmberExample({ pattern: 'dialog-modal' })).toMatch(/^# Modal — HDS/);
    expect(getApgPattern({ pattern: 'tabs' })).toMatch(/Ember reference implementations \(HDS\)/);
  });

  test('accessibility and implementation views include attribution', () => {
    const a11y = getEmberExample({ component: 'tabs', kind: 'accessibility' });
    expect(a11y).toMatch(/Conformant/);
    expect(a11y).toMatch(/Left arrow/);
    const impl = getEmberExample({ component: 'tabs', kind: 'implementation', file: 'tab.gts', maxChars: 2000 });
    expect(impl).toMatch(/github\.com\/hashicorp\/design-system\/blob\/[0-9a-f]{40}\/.*tab\.gts/);
    expect(impl).toMatch(/MPL-2\.0/);
  });
});

describe('auditEmberTemplate', () => {
  test('audits inline source', () => {
    const r = auditEmberTemplate({ source: '<div {{on "click" this.go}}>Go</div>' });
    expect(r.findings.some((f) => f.ruleId === 'keyboard-accessible-click')).toBe(true);
    expect(r.text).toMatch(/1 errors?/);
  });

  test('audits files and rejects paths outside the root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ea11y-'));
    const prev = process.env.EMBER_A11Y_ROOT;
    try {
      writeFileSync(join(dir, 'a.hbs'), '<img src="x">');
      writeFileSync(join(dir, 'b.gjs'), '<template><button>ok</button></template>');
      process.env.EMBER_A11Y_ROOT = dir;
      const r = auditEmberTemplate({ path: '.' });
      expect(r.text).toMatch(/2 file/);
      expect(r.findings.map((f) => f.file)).toContain('a.hbs');
      expect(() => auditEmberTemplate({ path: '../' })).toThrow(/inside/);
      expect(() => auditEmberTemplate({})).toThrow(/source.*path/);
    } finally {
      if (prev === undefined) delete process.env.EMBER_A11Y_ROOT;
      else process.env.EMBER_A11Y_ROOT = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generateEmberA11yTests', () => {
  test('maps APG key labels', () => {
    expect(toKeyEvent('Shift + Tab')).toEqual({ key: 'Tab', mods: { shiftKey: true } });
    expect(toKeyEvent('Down Arrow')).toEqual({ key: 'ArrowDown', mods: {} });
    expect(toKeyEvent('Control + A')).toEqual({ key: 'A', mods: { ctrlKey: true } });
    expect(toKeyEvent('nonsense key')).toBeNull();
  });

  test('generated modules compile for every pattern', () => {
    const p = new Preprocessor();
    for (const { id } of apg().patterns) {
      const out = generateEmberA11yTests({ pattern: id });
      const code = out.match(/```(?:gjs|js)\n([\s\S]*?)```/)?.[1] ?? out;
      expect(code).toMatch(/a11yAudit/);
      expect(() => p.process(code)).not.toThrow();
    }
  });

  const importOf = (out) => out.split('\n').filter((l) => /^import .* from '(?!qunit|ember-qunit|@ember\/test-helpers|ember-a11y-testing)/.test(l));

  test('defaults: default import from a guessed path, rendered as <ComponentName />', () => {
    const out = generateEmberA11yTests({ pattern: 'tabs', componentName: 'MyTabList' });
    expect(importOf(out)).toEqual(["import MyTabList from 'my-app/components/my-tab-list'; // TODO: adjust path"]);
    expect(out).toMatch(/await render\(<template><MyTabList \/><\/template>\);/);
    expect(out).toMatch(/import \{ setupRenderingTest \} from 'ember-qunit';/);
    expect(out).toMatch(/const ROOT = '\[data-test-tabs\]';/);
  });

  test('importPath, namedExport and a multi-line invocation import every top-level component', () => {
    const invocation = '<HdsBreadcrumb>\n  <HdsBreadcrumbItem @text="Home" @route="index" />\n</HdsBreadcrumb>';
    const out = generateEmberA11yTests({
      pattern: 'breadcrumb', componentName: 'HdsBreadcrumb', namedExport: true, invocation,
      importPath: '@hashicorp/design-system-components/components',
    });
    expect(importOf(out)).toEqual(["import { HdsBreadcrumb, HdsBreadcrumbItem } from '@hashicorp/design-system-components/components';"]);
    expect(out).toContain('await render(<template>\n      <HdsBreadcrumb>\n        <HdsBreadcrumbItem');
    expect(() => new Preprocessor().process(out)).not.toThrow();
  });

  test('namedExport ignores yielded components like <T.Tab>', () => {
    const out = generateEmberA11yTests({
      pattern: 'tabs', componentName: 'HdsTabs', namedExport: true, importPath: '@hashicorp/design-system-components/components',
      invocation: '<HdsTabs as |T|><T.Tab>One</T.Tab><T.Panel>1</T.Panel></HdsTabs>',
    });
    expect(importOf(out)).toEqual(["import { HdsTabs } from '@hashicorp/design-system-components/components';"]);
  });

  test('plain HTML invocations need no component import', () => {
    const out = generateEmberA11yTests({ pattern: 'disclosure', invocation: '<details data-test-disclosure><summary>More</summary>Text</details>' });
    expect(importOf(out)).toEqual([]);
    expect(out).toContain('<template><details data-test-disclosure>');
  });

  test('setupImport and selector', () => {
    const out = generateEmberA11yTests({ pattern: 'switch', setupImport: 'my-app/tests/helpers', selector: '#prefs [role="group"]' });
    expect(out).toMatch(/import \{ setupRenderingTest \} from 'my-app\/tests\/helpers';/);
    expect(out).toContain(`const ROOT = '#prefs [role="group"]';`);
    expect(out).not.toMatch(/from 'ember-qunit'/);
  });
});
