import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hds = JSON.parse(readFileSync(new URL('../data/hds.json', import.meta.url), 'utf8'));
const apg = JSON.parse(readFileSync(new URL('../data/apg.json', import.meta.url), 'utf8'));
const doc = (id) => hds.docs.find((d) => d.id === id);
const allSnippets = hds.docs.flatMap((d) => [...d.snippets, ...(d.accessibility?.snippets ?? [])]);

// Accessibility partials that intentionally carry no conformance rating:
// data-visualization defers to IBM Carbon; disabled-patterns and table-multi-select are guidance-only patterns.
const NO_CONFORMANCE = ['patterns/data-visualization', 'patterns/disabled-patterns', 'patterns/table-multi-select'];

describe('data/hds.json', () => {
  it('has source metadata and expected counts', () => {
    expect(hds.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(hds.source.license).toBe('MPL-2.0');
    expect(hds.source.githubBlobBase).toBe(`https://github.com/hashicorp/design-system/blob/${hds.source.commit}/`);
    expect(hds.docs.length).toBeGreaterThanOrEqual(65);
    expect(hds.docs.length).toBeLessThanOrEqual(80);
    expect(hds.docs.some((d) => d.id.includes('carbon-theme'))).toBe(false);
    expect(hds.docs.map((d) => d.id)).toEqual(hds.docs.map((d) => d.id).sort());
  });

  it('has a conformance rating for every accessibility partial except known exceptions', () => {
    const missing = hds.docs.filter((d) => d.accessibility && !d.accessibility.conformance.length).map((d) => d.id);
    expect(missing.sort()).toEqual(NO_CONFORMANCE);
    for (const d of hds.docs.filter((x) => x.accessibility))
      for (const c of d.accessibility.conformance)
        expect(['conformant', 'conditionally-conformant', 'not-conformant']).toContain(c.rating);
  });

  it('extracts keyboard navigation and WCAG criteria', () => {
    const tabs = doc('components/tabs').accessibility;
    const keys = tabs.keyboard.flatMap((k) => k.keys);
    expect(keys).toEqual(expect.arrayContaining(['Tab', 'Spacebar', 'Enter', 'Left arrow', 'Right arrow']));
    const arrows = tabs.keyboard.find((k) => k.keys.includes('Left arrow'));
    expect(arrows.description).toBe('Move between tabs');
    expect(arrows.note).toMatch(/first tab/);
    expect(tabs.wcag).toContain('2.1.1');
    expect(tabs.text).toContain('WCAG: 1.3.1');
    expect(tabs.text).not.toMatch(/<Doc::|<Hds::|!\[|!!!/);

    const at = doc('components/table/advanced-table').accessibility.keyboard;
    expect(at.find((k) => k.keys[0] === 'Fn + Left arrow')).toMatchObject({ group: 'Navigation Mode' });
    expect(at.some((k) => k.keys.includes('Right arrow') && k.group === 'Resizing columns')).toBe(true);
  });

  it('extracts sub-component conformance', () => {
    const toggle = doc('components/form/toggle').accessibility;
    expect(toggle.conformance).toContainEqual(
      expect.objectContaining({ subject: 'Form::Toggle::Base', rating: 'conditionally-conformant' }),
    );
    expect(toggle.knownIssues).toMatch(/screen reader/);
    expect(doc('overrides/power-select').accessibility.conformance[0].rating).toBe('not-conformant');
    expect(doc('components/stepper/indicator').accessibility.conformance[0].rating).toBe('not-conformant');
  });

  it('has valid snippets and implementation files', () => {
    expect(allSnippets.length).toBeGreaterThan(400);
    for (const s of allSnippets) {
      expect(s.url.startsWith(hds.source.githubBlobBase), s.path).toBe(true);
      expect(s.path).toMatch(/\.gts$/);
      expect(s.path).not.toContain('.classic.');
    }
    expect(doc('components/icon').accessibility.snippets.map((s) => s.name)).toEqual(['icon-in-button', 'icon-in-header']);

    const impl = doc('components/tabs').implementation;
    expect(impl.dir).toBe('packages/components/src/components/hds/tabs');
    expect(impl.files.map((f) => f.path)).toContain('packages/components/src/components/hds/tabs/tab.gts');
    expect(doc('components/tooltip').implementation.files.map((f) => f.path)).toContain(
      'packages/components/src/modifiers/hds-tooltip.ts',
    );
    for (const d of hds.docs.filter((x) => x.implementation)) {
      const files = d.implementation.files;
      expect(files.map((f) => f.path)).toEqual(files.map((f) => f.path).sort());
      expect(files.reduce((n, f) => n + (f.code?.length ?? 0), 0)).toBeLessThanOrEqual(80000);
      for (const f of files) {
        expect(f.path).toMatch(/\.(gts|ts)$/);
        expect(f.path).not.toMatch(/(\.d\.ts|\/types\.ts)$/);
        if (f.code) expect(f.code.length).toBeLessThanOrEqual(20000);
      }
    }
  });

  it('maps docs to valid APG patterns', () => {
    const apgIds = new Set(apg.patterns.map((p) => p.id));
    for (const [pattern, ids] of Object.entries(hds.apgIndex)) {
      expect(apgIds.has(pattern), pattern).toBe(true);
      for (const id of ids) expect(doc(id).apgPatterns).toContain(pattern);
    }
    expect(hds.apgIndex.tabs).toContain('components/tabs');
    expect(hds.apgIndex.switch).toEqual(['components/form/toggle']);
    expect(doc('components/badge').apgPatterns).toEqual([]);
  });
});
