import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apg = JSON.parse(readFileSync(new URL('../data/apg.json', import.meta.url), 'utf8'));
const pattern = (id) => apg.patterns.find((p) => p.id === id);
const example = (id) => apg.examples.find((e) => e.id === id);

describe('data/apg.json', () => {
  it('has source metadata and expected counts', () => {
    expect(apg.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(apg.patterns).toHaveLength(30);
    expect(apg.examples).toHaveLength(76);
    expect(apg.practices).toHaveLength(8);
    expect(apg.patterns.some((p) => p.id === 'patterns')).toBe(false);
  });

  it('extracts pattern keyboard interaction and roles', () => {
    const keys = pattern('tabs').keyboardInteraction.keys.flatMap((k) => k.keys);
    expect(keys).toEqual(expect.arrayContaining(['Tab', 'Right Arrow', 'Left Arrow', 'Home', 'End', 'Shift + F10']));
    expect(pattern('tabs').keyboardInteraction.keys.find((k) => k.keys[0] === 'Home').optional).toBe(true);
    expect(pattern('tabs').rolesStatesProperties.roles).toEqual(['tablist', 'tab', 'tabpanel']);
    expect(pattern('dialog-modal').rolesStatesProperties.roles).toContain('dialog');
    expect(pattern('grid').keyboardInteraction.keys.length).toBeGreaterThan(10);
  });

  it('extracts example keyboard and attribute tables with test ids', () => {
    const ex = example('tabs-automatic');
    expect(ex.keyboard.map((k) => k.testId)).toEqual(['key-tab', 'key-right-arrow', 'key-left-arrow', 'key-home', 'key-end']);
    expect(ex.attributes.length).toBeGreaterThanOrEqual(9);
    expect(ex.attributes.every((a) => a.testId && a.usage)).toBe(true);
    expect(ex.attributes[0]).toMatchObject({ role: 'tablist', attribute: null, element: 'div', testId: 'tablist-role' });
    expect(ex.scripts).toEqual(['content/patterns/tabs/examples/js/tabs-automatic.js']);
    expect(ex.regressionTest.file).toBe('test/tests/tabs_tabs-automatic.js');
    expect(ex.regressionTest.testNames.length).toBeGreaterThan(5);
  });

  it('keeps table groups for multi-part widgets', () => {
    const ex = example('combobox-autocomplete-list');
    expect(new Set(ex.keyboard.map((k) => k.group))).toEqual(new Set(['Textbox', 'Listbox Popup']));
    expect(new Set(ex.attributes.map((a) => a.group))).toEqual(new Set(['Textbox', 'Listbox Popup', 'Button']));
    expect(ex.keyboard.find((k) => k.testId === 'textbox-key-alt-down-arrow').keys).toEqual(['Alt + Down Arrow']);
  });

  it('is referentially consistent', () => {
    const patternIds = new Set(apg.patterns.map((p) => p.id));
    const exampleKeys = new Set(apg.examples.map((e) => `${e.patternId}/${e.id}`));
    for (const e of apg.examples) expect(patternIds.has(e.patternId), e.id).toBe(true);
    for (const p of apg.patterns) for (const id of p.exampleIds) expect(exampleKeys.has(`${p.id}/${id}`), id).toBe(true);
    expect(apg.examples.filter((e) => e.regressionTest).length).toBeGreaterThan(50);
  });

  it('is sorted by id', () => {
    for (const list of [apg.patterns, apg.examples, apg.practices]) {
      const ids = list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it('extracts practice sections', () => {
    const kbd = apg.practices.find((p) => p.id === 'keyboard-interface');
    const roving = kbd.sections.find((s) => s.id === 'kbd_roving_tabindex');
    expect(roving).toMatchObject({ level: 3 });
    expect(roving.text).toMatch(/tabindex/);
  });
});
