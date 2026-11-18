import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { collectFiles, lintFiles, lintTemplate } from '../lib/lint/index.js';

const lint = (src, filename = 't.hbs') => lintTemplate(src, { filename, minSeverity: 'info' });
const hits = (src, rule, filename) => lint(src, filename).filter((f) => f.ruleId === rule);
const sev = (src, rule) => hits(src, rule).map((f) => f.severity);

describe('roles and attributes', () => {
  test('invalid, abstract, deprecated and ARIA 1.3 roles', () => {
    expect(hits('<div role="buton">x</div>', 'no-invalid-role')[0].message).toMatch(/Did you mean "button"/);
    expect(sev('<div role="widget"></div>', 'no-invalid-role')).toEqual(['error']);
    expect(sev('<div role="mark">x</div>', 'no-invalid-role')).toEqual(['warning']);
    expect(sev('<div role="mark generic">x</div>', 'no-invalid-role')).toEqual(['info']);
    expect(sev('<div role="directory"></div>', 'no-deprecated-role')).toEqual(['warning']);
    expect(hits('<div role={{if @a "tab" "bogus"}}></div>', 'no-invalid-role')).toHaveLength(1);
    expect(hits('<Foo role="tabz" />', 'no-invalid-role')).toHaveLength(1);
  });

  test('invalid attribute names and values', () => {
    expect(hits('<div aria-labeledby="a"></div>', 'no-invalid-aria-attribute')[0].message).toMatch(/aria-labelledby/);
    expect(sev('<div aria-braillelabel="x">y</div>', 'no-invalid-aria-attribute')).toEqual(['warning']);
    for (const src of ['<input aria-description="x" aria-label="y">', '<span role="presentation" aria-description="x"></span>', '<br aria-description="x">', '<HdsButton aria-description="x" />'])
      expect(lint(src).filter((f) => f.severity !== 'info')).toEqual([]);
    expect(sev('<button aria-pressed="yes">x</button>', 'aria-attribute-value')).toEqual(['error']);
    expect(hits('<button aria-pressed="mixed">x</button>', 'aria-attribute-value')).toHaveLength(0);
    expect(hits('<button aria-expanded={{if @open "true" "flase"}}>x</button>', 'aria-attribute-value')).toHaveLength(1);
    expect(hits('<button aria-expanded={{this.open}}>x</button>', 'aria-attribute-value')).toHaveLength(0);
    expect(sev('<div role="button" aria-grabbed="true">x</div>', 'no-deprecated-aria-attribute')).toEqual(['warning']);
  });

  test('prohibited and unsupported attributes', () => {
    expect(sev('<div aria-label="x">text</div>', 'aria-role-attributes')).toEqual(['error']);
    expect(sev('<span role="generic" aria-roledescription="x"></span>', 'aria-role-attributes')).toEqual(['error']);
    // ARIA 1.2 only prohibits naming on presentation, not aria-roledescription
    expect(hits('<span role="presentation" aria-roledescription="x"></span>', 'aria-role-attributes')).toHaveLength(0);
    expect(sev('<div role="img" aria-label="x" aria-checked="true"></div>', 'aria-role-attributes')).toEqual(['error']);
    expect(sev('<div role="button" aria-invalid="true">x</div>', 'aria-role-attributes')).toEqual(['warning']);
    expect(hits('<nav aria-label="Main"></nav>', 'aria-role-attributes')).toHaveLength(0);
    expect(hits('<input type="checkbox" aria-required="true">', 'aria-role-attributes')).toHaveLength(0);
    // custom elements may set their own role internally
    expect(hits('<cds-header aria-label="HashiCorp"></cds-header>', 'aria-role-attributes')).toHaveLength(0);
  });

  test('row attributes only valid in treegrid', () => {
    expect(hits('<div role="grid"><div role="row" aria-expanded="true"><div role="gridcell">x</div></div></div>', 'aria-role-attributes')).toHaveLength(1);
    expect(hits('<div role="treegrid"><div role="row" aria-expanded="true"><div role="gridcell">x</div></div></div>', 'aria-role-attributes')).toHaveLength(0);
  });

  test('required attributes, native and conditional exemptions', () => {
    expect(sev('<div role="checkbox" tabindex="0">x</div>', 'aria-required-attributes')).toEqual(['error']);
    expect(sev('<div role="menuitemradio">x</div>', 'aria-required-attributes')).toEqual(['error']);
    expect(sev('<div role="option">x</div>', 'aria-required-attributes')).toEqual(['warning']);
    expect(sev('<div role="checkbox" ...attributes>x</div>', 'aria-required-attributes')).toEqual(['warning']);
    expect(hits('<input type="checkbox" role="switch">', 'aria-required-attributes')).toHaveLength(0);
    expect(hits('<h2 role="heading">x</h2>', 'aria-required-attributes')).toHaveLength(0);
    expect(hits('<div role="separator"></div>', 'aria-required-attributes')).toHaveLength(0);
    expect(hits('<div role="separator" tabindex="0"></div>', 'aria-required-attributes')).toHaveLength(1);
  });
});

describe('ARIA in HTML', () => {
  test('allowed roles', () => {
    expect(sev('<button role="button">x</button>', 'html-aria-allowed-role')).toEqual(['warning']);
    expect(sev('<a href="/" role="heading" aria-level="2">x</a>', 'html-aria-allowed-role')).toEqual(['error']);
    expect(sev('<input type="date" role="textbox">', 'html-aria-allowed-role')).toEqual(['error']);
    expect(hits('<a href="/" role="menuitem">x</a>', 'html-aria-allowed-role')).toHaveLength(0);
    expect(sev('<ul role="list"><li>x</li></ul>', 'html-aria-allowed-role')).toEqual(['info']);
  });

  test('li roles depend on the parent list', () => {
    expect(hits('<ul role="menu"><li role="none"><button role="menuitem">x</button></li></ul>', 'html-aria-allowed-role')).toHaveLength(0);
    expect(hits('<li role="presentation">x</li>', 'html-aria-allowed-role')).toHaveLength(0);
    expect(sev('<ul><li role="tab">x</li></ul>', 'html-aria-allowed-role')).toEqual(['error']);
  });

  test('elements that allow no aria and MUST NOT rules', () => {
    expect(sev('<br aria-label="x">', 'html-aria-no-aria-attributes')).toEqual(['error']);
    expect(sev('<style aria-hidden="true"></style>', 'html-aria-no-aria-attributes')).toEqual(['error']);
    expect(hits('<img src="a.png" alt="" aria-hidden="true">', 'html-aria-no-aria-attributes')).toHaveLength(0);
    // html-aria: alt="" plus another name is treated as a named img
    expect(hits('<img src="a.png" alt="" aria-label="x">', 'html-aria-no-aria-attributes')).toHaveLength(0);
    expect(sev('<input type="checkbox" aria-checked="true">', 'html-aria-attribute-rules')).toEqual(['error']);
  });

  test('native attribute conflicts', () => {
    expect(sev('<button disabled aria-disabled="false">x</button>', 'native-aria-conflict')).toEqual(['error']);
    expect(sev('<button disabled aria-disabled="true">x</button>', 'native-aria-conflict')).toEqual(['warning']);
    expect(hits('<button aria-disabled="true">x</button>', 'native-aria-conflict')).toHaveLength(0);
    expect(sev('<input aria-required="true" aria-label="x">', 'native-aria-conflict')).toEqual(['warning']);
    expect(sev('<input type="range" min="0" aria-valuemin="0" aria-label="x">', 'native-aria-conflict')).toEqual(['error']);
  });
});

describe('names, focus and keyboard', () => {
  test('accessible names', () => {
    expect(sev('<button></button>', 'accessible-name')).toEqual(['error']);
    expect(sev('<button><svg aria-hidden="true"></svg></button>', 'accessible-name')).toEqual(['error']);
    expect(hits('<button>{{t "save"}}</button>', 'accessible-name')).toHaveLength(0);
    expect(hits('<button><FlightIcon @name="x" /></button>', 'accessible-name')).toHaveLength(0);
    expect(hits('<button aria-label="Close"><svg></svg></button>', 'accessible-name')).toHaveLength(0);
    expect(hits('<a href="/"><img src="l.png" alt="Home"></a>', 'accessible-name')).toHaveLength(0);
    expect(sev('<img src="a.png">', 'accessible-name')).toEqual(['error']);
    expect(sev('<iframe src="/x"></iframe>', 'accessible-name')).toEqual(['error']);
    expect(sev('<div role="dialog">x</div>', 'accessible-name')).toEqual(['error']);
    expect(sev('<dialog ...attributes>x</dialog>', 'accessible-name')).toEqual(['warning']);
  });

  test('form labels', () => {
    expect(sev('<input type="text">', 'accessible-name')).toEqual(['error']);
    expect(hits('<label>Name <input type="text"></label>', 'accessible-name')).toHaveLength(0);
    expect(hits('<label for="n">Name</label><input id="n">', 'accessible-name')).toHaveLength(0);
    expect(sev('<input id="n">', 'accessible-name')).toEqual(['warning']);
    expect(hits('{{#let (unique-id) as |id|}}<label for={{id}}>N</label><input id={{id}}>{{/let}}', 'accessible-name')).toHaveLength(0);
    expect(hits('<input type="submit">', 'accessible-name')).toHaveLength(0);
    expect(hits('<input type="hidden">', 'accessible-name')).toHaveLength(0);
  });

  test('aria-hidden on focusable content', () => {
    expect(sev('<button aria-hidden="true">x</button>', 'no-aria-hidden-on-focusable')).toEqual(['error']);
    expect(sev('<div aria-hidden="true"><a href="/">x</a></div>', 'no-aria-hidden-on-focusable')).toEqual(['error']);
    expect(hits('<div aria-hidden="true"><a href="/" tabindex="-1">x</a></div>', 'no-aria-hidden-on-focusable')).toHaveLength(0);
  });

  test('presentational role conflicts', () => {
    expect(sev('<button role="presentation">x</button>', 'presentation-role-conflict')).toEqual(['error']);
    expect(hits('<table role="presentation"><tr><td>x</td></tr></table>', 'presentation-role-conflict')).toHaveLength(0);
  });

  test('click handlers need keyboard access', () => {
    expect(sev('<div {{on "click" this.go}}>Go</div>', 'keyboard-accessible-click')).toEqual(['error']);
    expect(sev('<a {{on "click" this.go}}>Go</a>', 'keyboard-accessible-click')).toEqual(['error']);
    expect(sev('<div role="button" {{on "click" this.go}}>Go</div>', 'keyboard-accessible-click')).toEqual(['error', 'warning']);
    expect(hits('<div role="button" tabindex="0" {{on "click" this.go}} {{on "keydown" this.key}}>Go</div>', 'keyboard-accessible-click')).toHaveLength(0);
    expect(hits('<button type="button" {{on "click" this.go}}>Go</button>', 'keyboard-accessible-click')).toHaveLength(0);
    expect(sev('<div class="overlay" {{on "click" this.close}} />', 'keyboard-accessible-click')).toEqual(['warning']);
  });

  test('tabindex and autofocus', () => {
    expect(sev('<button tabindex="2">x</button>', 'no-positive-tabindex')).toEqual(['error']);
    expect(sev('<div tabindex="0">x</div>', 'no-noninteractive-tabindex')).toEqual(['warning']);
    expect(hits('<div role="region" aria-label="Log" tabindex="0">x</div>', 'no-noninteractive-tabindex')).toHaveLength(0);
    expect(sev('<input autofocus aria-label="x">', 'no-autofocus')).toEqual(['warning']);
    expect(hits('<HdsModal as |M|><M.Body><input autofocus aria-label="x"></M.Body></HdsModal>', 'no-autofocus')).toHaveLength(0);
  });
});

describe('structure and ids', () => {
  test('required context', () => {
    expect(sev('<ul><li role="option">x</li></ul>', 'aria-required-context')).toEqual(['error']);
    expect(hits('<div role="listbox" aria-label="x"><div role="option" aria-selected="false">x</div></div>', 'aria-required-context')).toHaveLength(0);
    expect(hits('<div role="tree" aria-label="x"><div role="treeitem" aria-selected="false">a<div role="group"><div role="treeitem" aria-selected="false">b</div></div></div></div>', 'aria-required-context')).toHaveLength(0);
    expect(sev('<div role="option" aria-selected="false">x</div>', 'aria-required-context')).toEqual(['info']);
    expect(sev('<div role="list"><div role="group"><div role="menuitem">x</div></div></div>', 'aria-required-context')).toEqual(['error']);
  });

  test('required owned elements', () => {
    expect(sev('<div role="tablist"><button>x</button></div>', 'aria-required-owned')).toEqual(['error']);
    expect(sev('<div role="list"></div>', 'aria-required-owned')).toEqual(['error']);
    expect(hits('<div role="list">{{#each @items as |i|}}<div role="listitem">{{i}}</div>{{/each}}</div>', 'aria-required-owned')).toHaveLength(0);
    expect(hits('<ul role="menu"><li role="none"><button role="menuitem">x</button></li></ul>', 'aria-required-owned')).toHaveLength(0);
    expect(sev('<div role="listbox" aria-label="x"><div role="group"><div role="button">x</div></div></div>', 'aria-required-owned')).toEqual(['error']);
  });

  test('ids', () => {
    expect(sev('<p id="a">x</p><p id="a">y</p>', 'no-duplicate-id')).toEqual(['error']);
    expect(sev('<button aria-describedby="nope">x</button>', 'aria-idref-exists')).toEqual(['warning']);
    expect(hits('<p id="d">hint</p><button aria-describedby="d">x</button>', 'aria-idref-exists')).toHaveLength(0);
    expect(sev('<input role="combobox" aria-expanded="false" aria-controls="p" aria-label="x"><div id="p" role="alert"></div>', 'aria-idref-exists')).toEqual(['error']);
  });
});

describe('engine', () => {
  test('gjs/gts positions map to the source file', () => {
    const src = `import Component from '@glimmer/component';\n\nexport default class X extends Component {\n  <template>\n    <div {{on "click" this.go}}>x</div>\n  </template>\n}\n\nconst Y = <template><img src="a"></template>;\n`;
    const out = lint(src, 'x.gts');
    const click = out.find((f) => f.ruleId === 'keyboard-accessible-click');
    expect([click.line, click.column]).toEqual([5, 5]);
    const img = out.find((f) => f.ruleId === 'accessible-name');
    expect([img.line, img.column]).toEqual([9, 21]);
  });

  test('inline disable comments and rule overrides', () => {
    expect(hits('{{! ember-a11y-disable-next-line accessible-name }}\n<button></button>', 'accessible-name')).toHaveLength(0);
    expect(hits('{{!-- ember-a11y-disable --}}\n<button></button>', 'accessible-name')).toHaveLength(0);
    expect(lintTemplate('<button></button>', { rules: { 'accessible-name': 'off' } })).toHaveLength(0);
    expect(lintTemplate('<button></button>', { rules: { 'accessible-name': 'info' } })[0].severity).toBe('info');
  });

  test('ember-a11y-disable lasts until the matching ember-a11y-enable; unmatched disables are reported', () => {
    const src = (enable) => `<button></button>\n{{! ember-a11y-disable accessible-name no-autofocus }}\n<button></button>\n<input autofocus aria-label="x">\n${enable}\n<button></button>\n<input autofocus aria-label="y">`;
    const lines = (out, id) => out.filter((f) => f.ruleId === id).map((f) => f.line);
    const both = lint(src('{{! ember-a11y-enable accessible-name no-autofocus }}'));
    expect(lines(both, 'accessible-name')).toEqual([1, 6]);
    expect(lines(both, 'no-autofocus')).toEqual([7]);
    expect(lines(both, 'unmatched-disable')).toEqual([]);
    const one = lint(src('{{! ember-a11y-enable accessible-name }}'));
    expect(lines(one, 'accessible-name')).toEqual([1, 6]);
    expect(lines(one, 'no-autofocus')).toEqual([]);
    expect(one.find((f) => f.ruleId === 'unmatched-disable')).toMatchObject({ severity: 'warning', line: 2, column: 1, message: expect.stringMatching(/for no-autofocus has no matching/) });
    expect(lines(lint(src('{{!-- ember-a11y-enable --}}')), 'unmatched-disable')).toEqual([]);
    const all = lint('{{! ember-a11y-disable }}\n<button></button>\n{{! ember-a11y-enable accessible-name }}\n<button></button>');
    expect(lines(all, 'accessible-name')).toEqual([]);
    expect(all.find((f) => f.ruleId === 'unmatched-disable').message).toMatch(/for all rules/);
  });

  // Same inputs and results as running ember-template-lint 7.9.3 with template-lint-disable.
  test.each([
    ['in an opening tag: that element only', '<div tabindex="1" {{! ember-a11y-disable no-positive-tabindex }}>\n  <span tabindex="2">child</span>\n</div>\n<span tabindex="3">after</span>', [2, 4], null],
    ['-disable-tree in an opening tag: element and descendants', '<div tabindex="1" {{! ember-a11y-disable-tree no-positive-tabindex }}>\n  <span tabindex="2">child</span>\n</div>\n<span tabindex="3">after</span>', [4], null],
    ['in an element body: until the element closes', '<section>\n  {{! ember-a11y-disable no-positive-tabindex }}\n  <span tabindex="1">sibling</span>\n</section>\n<span tabindex="2">after parent closes</span>', [5], /until <\/section> closes on line 4/],
    ['at the top level: rest of the file', '{{! ember-a11y-disable no-positive-tabindex }}\n<span tabindex="1">a</span>\n<section><span tabindex="2">b</span></section>\n<span tabindex="3">c</span>', [], /rest of the file/],
    ['inside a block: rest of the file', '{{#if x}}\n  {{! ember-a11y-disable no-positive-tabindex }}\n  <span tabindex="1">in block</span>\n{{/if}}\n<span tabindex="2">after block</span>', [], /rest of the file/],
  ])('disable scope %s', (_, src, flagged, unmatched) => {
    const out = lint(src);
    expect(out.filter((f) => f.ruleId === 'no-positive-tabindex').map((f) => f.line)).toEqual(flagged);
    const u = out.filter((f) => f.ruleId === 'unmatched-disable');
    if (unmatched) expect(u).toMatchObject([{ message: expect.stringMatching(unmatched) }]);
    else expect(u).toEqual([]);
  });

  test('disable-next-line only suppresses the named rules, on any line of a multi-line element', () => {
    const multi = '{{! ember-a11y-disable-next-line no-positive-tabindex }}\n<div\n  class="x"\n  tabindex="3"\n>hi</div>';
    expect(hits(multi, 'no-positive-tabindex')).toHaveLength(0);
    expect(hits(multi, 'no-noninteractive-tabindex')).toHaveLength(1);
    const nested = '{{! ember-a11y-disable-next-line accessible-name }}\n<div>\n  <button></button>\n</div>';
    expect(hits(nested, 'accessible-name')).toHaveLength(1);
  });

  test('parse errors are reported, not thrown', () => {
    const out = lint('<div><span></div>');
    expect(out[0].ruleId).toBe('parse-error');
    const js = lint('const a = ;\n<template><button></button></template>', 'x.gjs');
    expect(js).toHaveLength(1);
    expect(js[0]).toMatchObject({ ruleId: 'parse-error', line: 1, column: 11, message: 'Template could not be parsed: JavaScript syntax error: Expression expected' });
  });

  test('role and attribute names that match Object.prototype keys do not crash', () => {
    expect(hits('<div role="constructor">x</div>', 'no-invalid-role')).toHaveLength(1);
    expect(hits('<div role="__proto__" aria-constructor="x" aria-tostring="y">x</div>', 'no-invalid-aria-attribute')).toHaveLength(2);
  });

  test('named blocks and components are skipped for html rules', () => {
    expect(lint('<Foo as |f|><:header>x</:header></Foo>').filter((f) => f.severity !== 'info')).toHaveLength(0);
  });

  test('nested-interactive checks the named yield and the custom Link implementation', () => {
    const root = mkdtempSync(join(tmpdir(), 'named-block-'));
    try {
      mkdirSync(join(root, 'app/components'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"name":"example-app"}');
      const file = (name) => join(root, 'app/components', name);
      writeFileSync(file('example.hbs'), '<CardButton><:editLink><Link /></:editLink></CardButton>');
      const run = (filename = 'example.hbs') => lintFiles([file(filename)], { root })[0].findings
        .filter((f) => f.ruleId === 'no-nested-interactive');

      expect(run()).toMatchObject([{ severity: 'info', message: expect.stringContaining('<:editLink>') }]);

      writeFileSync(file('card-button.hbs'), '<button>Open</button>{{yield to="editLink"}}');
      writeFileSync(file('link.hbs'), '<a href="/edit">Edit</a>');
      expect(run()).toEqual([]);

      writeFileSync(file('card-button.hbs'), '<button>{{yield to="editLink"}}</button>');
      expect(run()).toMatchObject([{ severity: 'error', message: expect.stringContaining('app/components/card-button.hbs') }]);

      writeFileSync(file('link.hbs'), '<span>{{yield}}</span>');
      expect(run()).toEqual([]);

      writeFileSync(file('example.gjs'), `import Card from './card-button.hbs';\nimport Link from './action.gjs';\n<template><Card><:editLink><Link /></:editLink></Card></template>`);
      writeFileSync(file('action.gjs'), '<template><a href="/edit">Edit</a></template>');
      expect(run('example.gjs')).toMatchObject([{ severity: 'error', message: expect.stringContaining('app/components/action.gjs') }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('file walk skips dangling links, loops and links outside the walked path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walk-'));
    try {
      mkdirSync(join(dir, 'outside'));
      writeFileSync(join(dir, 'outside/secret.hbs'), '<img>');
      mkdirSync(join(dir, 'app/components'), { recursive: true });
      writeFileSync(join(dir, 'app/components/a.hbs'), '<img>');
      symlinkSync(join(dir, 'missing'), join(dir, 'app/dangling'));
      symlinkSync('..', join(dir, 'app/components/loop'));
      symlinkSync(join(dir, 'outside'), join(dir, 'app/out'));
      symlinkSync('a.hbs', join(dir, 'app/components/b.hbs'));
      expect(collectFiles(['app'], dir).map((f) => relative(dir, f))).toEqual(['app/components/a.hbs', 'app/components/b.hbs']);
      const results = lintFiles(['app'], { root: dir });
      expect(results).toHaveLength(2);
      expect(() => collectFiles(['nope'], dir)).toThrow(/Path not found: nope/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('placeholder-only labels', () => {
  test('are a 3.3.2 error by explicit policy', () => {
    const [f] = hits('<input placeholder="Search">', 'accessible-name');
    expect(f.severity).toBe('error');
    expect(f.message).toMatch(/only by its placeholder/);
    expect(f.help).toMatch(/example of the expected data/);
    expect(f.help).toMatch(/explicit policy of this ruleset/);
    expect(sev('<textarea placeholder="Notes"></textarea>', 'accessible-name')).toEqual(['error']);
    expect(hits('<label>Search <input placeholder="e.g. vault"></label>', 'accessible-name')).toHaveLength(0);
  });
});

describe('destructive-action-confirmation', () => {
  const R = 'destructive-action-confirmation';
  const gjs = (body, tpl) => `import Component from '@glimmer/component';\nexport default class X extends Component {\n  ${body}\n  <template>${tpl}</template>\n}`;
  const dac = (src, filename = 'x.gjs') => hits(src, R, filename).map((f) => f.severity);

  test('flags unconfirmed destructive actions', () => {
    expect(dac(gjs('@action deleteItem() { this.args.item.destroyRecord(); }', '<button type="button" {{on "click" this.deleteItem}}>Delete</button>'))).toEqual(['warning']);
    expect(dac('<template><Hds::Button @text="Delete project" @color="critical" {{on "click" this.deleteProject}} /></template>')).toEqual(['warning']);
    expect(dac('<template><button type="button" {{on "click" this.hide}}>Don\'t show this again</button></template>')).toEqual(['warning']);
    expect(dac(gjs('deleteTask = task(async () => { await this.item.destroyRecord(); });', '<button type="button" {{on "click" (perform this.deleteTask)}}>Delete</button>'))).toEqual(['warning']);
    expect(dac(gjs('@action deleteAccount(e) { e.preventDefault(); this.api.del(); }', '<form {{on "submit" this.deleteAccount}}><button type="submit">Delete account</button></form>'))).toEqual(['warning']);
  });

  test('permanently dismissing an alert needs confirmation; a plain dismiss does not', () => {
    const [f] = hits(gjs("@action dismissPermanently() { localStorage.setItem('hide', '1'); }", '<HdsAlert @type="inline" @onDismiss={{this.dismissPermanently}} as |A|><A.Title>New</A.Title></HdsAlert>'), R, 'x.gjs');
    expect(f.severity).toBe('warning');
    expect(f.message).toMatch(/dismiss.*HdsAlert/);
    expect(f.wcag[0]).toMatch(/3\.3\.4/);
    expect(dac(gjs('@action close() { this.visible = false; }', '<HdsAlert @type="inline" @onDismiss={{this.close}} as |A|><A.Title>New</A.Title></HdsAlert>'))).toEqual([]);
  });

  test('accepts every confirmation variation', () => {
    const ok = [
      // native confirm, in the handler or inline
      gjs("@action deleteItem() { if (window.confirm('Delete?')) this.item.destroyRecord(); }", '<button type="button" {{on "click" this.deleteItem}}>Delete</button>'),
      '<template><button type="submit" onclick="return confirm(\'Delete?\')">Delete</button></template>',
      // inline confirmation by condition name, and by armed state
      gjs('@action ask() { this.isConfirming = true; } @action reallyDelete() { this.item.destroyRecord(); }', '{{#if this.isConfirming}}<p>Are you sure?</p><button type="button" {{on "click" this.reallyDelete}}>Delete</button>{{else}}<button type="button" {{on "click" this.ask}}>Delete</button>{{/if}}'),
      gjs('@action startDel() { this.deleting = true; } @action doIt() { this.item.destroyRecord(); }', '{{#if this.deleting}}<button type="button" {{on "click" this.doIt}}>Yes, delete</button>{{/if}}<button type="button" {{on "click" this.startDel}}>Delete</button>'),
      // modal: HdsModal, <dialog>, alertdialog, showModal()
      gjs('@action open() { this.show = true; } @action destroyIt() { this.item.destroyRecord(); }', '<HdsButton @text="Delete" @color="critical" {{on "click" this.open}} />{{#if this.show}}<HdsModal as |M|><M.Footer><HdsButton @text="Delete" @color="critical" {{on "click" this.destroyIt}} /></M.Footer></HdsModal>{{/if}}'),
      '<template><dialog aria-labelledby="h"><h2 id="h">Delete?</h2><button type="button" {{on "click" this.deleteItem}}>Delete</button></dialog></template>',
      '<template><div role="alertdialog" aria-label="Confirm"><button type="button" {{on "click" this.deleteItem}}>Delete</button></div></template>',
      gjs("@action deleteItem() { document.getElementById('c').showModal(); }", '<button type="button" {{on "click" this.deleteItem}}>Delete</button>'),
      // confirm-named handlers, undo, navigation, opening UI
      '<template><button type="button" {{on "click" this.confirmDelete}}>Delete</button><button type="button" {{on "click" this.openDeleteModal}}>Delete</button></template>',
      gjs("@action deleteItem() { this.item.deleted = true; this.toast.show({ text: 'Deleted', action: 'Undo' }); }", '<button type="button" {{on "click" this.deleteItem}}>Delete</button>'),
      '<template><LinkTo @route="item.delete">Delete</LinkTo><a href="/delete">Delete</a></template>',
      '<template><button type="button" {{on "click" T.openFlyout}}>Deactivated on destroy</button></template>',
    ];
    for (const src of ok) expect(dac(src), src).toEqual([]);
  });

  test('lower confidence cases are info', () => {
    expect(dac('<template><button type="button" {{on "click" @onDelete}}>Delete</button></template>')).toEqual(['info']);
    expect(dac(gjs('@action remove(item) { item.destroyRecord(); }', '{{#each this.items as |item|}}<button type="button" {{on "click" (fn this.remove item)}}>Remove {{item.name}}</button>{{/each}}'))).toEqual(['info']);
    expect(dac('<template><HdsForm as |F|><R.DeleteRowButton @onClick={{this.onDeleteRowClick}} /></HdsForm></template>')).toEqual(['info']);
  });

  test('reads the co-located class for .hbs templates', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'dac-'));
    const tpl = '<button type="button" {{on "click" this.deleteItem}}>Delete</button>';
    writeFileSync(join(dir, 'a.hbs'), tpl);
    writeFileSync(join(dir, 'a.js'), "export default class A { @action deleteItem() { if (confirm('Sure?')) this.item.destroyRecord(); } }");
    writeFileSync(join(dir, 'b.hbs'), tpl);
    writeFileSync(join(dir, 'b.js'), 'export default class B { @action deleteItem() { this.item.destroyRecord(); } }');
    expect(dac(tpl, join(dir, 'a.hbs'))).toEqual([]);
    expect(dac(tpl, join(dir, 'b.hbs'))).toEqual(['warning']);
  });
});
