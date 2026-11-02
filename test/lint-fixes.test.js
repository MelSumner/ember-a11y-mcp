import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { applyFixes, fixFiles, lintTemplate } from '../lib/lint/index.js';

// Each row: [template, ruleId, expected `after` text of that rule's first finding]. `before`, when it matters, is checked separately.
const fixFor = (src, rule) => lintTemplate(src, { filename: 't.hbs', minSeverity: 'info' }).find((f) => f.ruleId === rule)?.fix;

const AFTER = [
  ['<img src="a.png">', 'accessible-name', '<img src="a.png" alt="Describe the image">'],
  ['<iframe src="x"></iframe>', 'accessible-name', '<iframe src="x" title="Describe the frame">'],
  ['<button></button>', 'accessible-name', '<button aria-label="Describe the action">'],
  ['<h2></h2>', 'accessible-name', '<h2>Heading text</h2>'],
  ['<input id="n" type="text">', 'accessible-name', '<label for="n">Label text</label>\n<input id="n" type="text">'],
  ['<input type="text">', 'accessible-name', '{{#let (unique-id) as |id|}}\n  <label for={{id}}>Label text</label>\n  <input type="text" id={{id}}>\n{{/let}}'],
  ['<div role="buton">x</div>', 'no-invalid-role', '<div role="button">'],
  ['<div role="">x</div>', 'no-invalid-role', '<div>'],
  ['<div aria-labeledby="x">x</div>', 'no-invalid-aria-attribute', '<div aria-labelledby="x">'],
  ['<div aria-atomic="TRUE">x</div>', 'aria-attribute-value', '<div aria-atomic="true">'],
  ['<div role="heading" aria-level="0">x</div>', 'aria-attribute-value', '<div role="heading" aria-level="1">'],
  ['<span aria-dropeffect="move">x</span>', 'no-deprecated-aria-attribute', '<span>'],
  ['<div role="checkbox" aria-label="x"></div>', 'aria-required-attributes', '<div role="checkbox" aria-label="x" aria-checked={{this.checked}}>'],
  ['<button role="button">x</button>', 'html-aria-allowed-role', '<button>'],
  ['<button aria-disabled="true" disabled>x</button>', 'native-aria-conflict', '<button disabled>'],
  ['<div aria-hidden="true"><button>x</button></div>', 'no-aria-hidden-on-focusable', '<div inert>'],
  ['<div role="presentation" aria-label="x">x</div>', 'presentation-role-conflict', '<div aria-label="x">'],
  ['<div tabindex="3">x</div>', 'no-positive-tabindex', '<div tabindex="0">'],
  ['<p tabindex="0">x</p>', 'no-noninteractive-tabindex', '<p>'],
  ['<input autofocus aria-label="x">', 'no-autofocus', '<input aria-label="x">'],
  ['<div role="tab">x</div>', 'aria-required-context', '<div role="tablist">\n  <div role="tab">…</div>\n</div>'],
  ['<ul role="menu"></ul>', 'aria-required-owned', '<ul role="menu">\n  <div role="menuitem">…</div>\n</ul>'],
  ['<div {{on "click" this.go}}>Go</div>', 'keyboard-accessible-click', '<button {{on "click" this.go}} type="button">…</button>'],
  ['<div role="button" {{on "click" this.go}}>Go</div>', 'prefer-native-element', '<button {{on "click" this.go}} type="button">…</button>'],
  ['<div role="button" {{on "click" this.go}} tabindex="0">Go</div>', 'keyboard-accessible-click', '<div role="button" {{on "click" this.go}} tabindex="0" {{on "keydown" this.handleKeydown}}>'],
  ['<div id="a"></div><button aria-describedby="a">x</button>', 'prefer-unique-id', '{{#let (unique-id) as |id|}}\n  <div id={{id}}></div>\n{{/let}}'],
];

describe('fix examples', () => {
  test.each(AFTER)('%s → %s', (src, rule, after) => {
    expect(fixFor(src, rule)?.after).toBe(after);
  });

  test('before is the offending source', () => {
    expect(fixFor('<div role="buton">x</div>', 'no-invalid-role').before).toBe('<div role="buton">');
  });

  test('multi-line open tags are collapsed onto one line', () => {
    const src = '<div\n  role="buton"\n  class="a"\n>x</div>';
    expect(fixFor(src, 'no-invalid-role')).toMatchObject({ before: '<div role="buton" class="a">', after: '<div role="button" class="a">' });
  });

  test('void elements are not given closing tags', () => {
    expect(fixFor('<label for="n">N</label><input id="n" type="text">', 'prefer-unique-id').after).not.toContain('</input>');
  });

  test('destructive actions get a confirmation example built from the handler and label', () => {
    const fix = fixFor('<button {{on "click" this.deleteItem}}>Delete</button>', 'destructive-action-confirmation');
    expect(fix.after).toContain('{{on "click" this.deleteItem}}>Yes, delete</button>');
    expect(fix.after).toContain('{{#if this.isConfirming}}');
    expect(fix.note).toContain('askToConfirm');
  });

  test('findings without a safe example carry no fix', () => {
    expect(fixFor('<div role="nonsense">x</div>', 'no-invalid-role')).toBeUndefined();
    expect(fixFor('<div role="tab" aria-label="x"></div>', 'aria-required-attributes')).toBeUndefined();
  });

  test('a fix that would change nothing is omitted', () => {
    expect(fixFor('<div aria-hidden="true" tabindex="0">x</div>', 'no-aria-hidden-on-focusable')?.after).toBe('<div inert tabindex="0">');
  });
});

const autofix = (src, filename = 't.hbs') => applyFixes(src, lintTemplate(src, { filename, minSeverity: 'info' }));

describe('applyFixes', () => {
  test.each([
    ['<div role="buton">x</div>', '<div role="button">x</div>'],
    ['<div aria-labeledby="x">x</div>', '<div aria-labelledby="x">x</div>'],
    ['<button role="button">x</button>', '<button>x</button>'],
    ['<div aria-atomic="TRUE" aria-live="polite">x</div>', '<div aria-atomic="true" aria-live="polite">x</div>'],
    ['<span aria-dropeffect="move">x</span>', '<span>x</span>'],
    ['<div tabindex="3">x</div>', '<div tabindex="0">x</div>'],
    ['<div role="">x</div>', '<div>x</div>'],
    ['<button\n  role="button"\n  class="a"\n>x</button>', '<button\n  class="a"\n>x</button>'],
    ['<button disabled aria-disabled="true">x</button>', '<button disabled>x</button>'],
  ])('%j', (src, expected) => {
    expect(autofix(src).text).toBe(expected);
  });

  test('judgement calls are never applied', () => {
    for (const src of ['<p tabindex="0">x</p>', '<input autofocus aria-label="x">', '<div aria-hidden="true"><button>x</button></div>', '<img src="a.png">', '<div role="button" aria-checked="true">x</div>']) {
      expect(autofix(src)).toEqual({ text: src, applied: 0 });
    }
  });

  test('positions inside <template> in .gjs files are mapped back to the file', () => {
    const src = 'import X from "x";\nexport default class A {\n  <template>\n    <div role="buton">x</div>\n  </template>\n}\n';
    expect(autofix(src, 't.gjs').text).toContain('    <div role="button">x</div>');
  });

  test('two fixes on one element both apply', () => {
    expect(autofix('<div role="buton" aria-labeledby="x">x</div>').text).toBe('<div role="button" aria-labelledby="x">x</div>');
  });
});

describe('fixFiles', () => {
  test('rewrites files in place and reports what changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11y-fix-'));
    try {
      writeFileSync(join(dir, 'a.hbs'), '<div role="buton">x</div>\n');
      writeFileSync(join(dir, 'b.hbs'), '<p>ok</p>\n');
      const fixed = fixFiles(['.'], { root: dir });
      expect([...fixed]).toEqual([{ file: 'a.hbs', applied: 1 }]);
      expect(fixed.skipped).toEqual([]);
      expect(readFileSync(join(dir, 'a.hbs'), 'utf8')).toBe('<div role="button">x</div>\n');
      expect([...fixFiles(['.'], { root: dir })]).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
