import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (n) => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
const aria = load('aria');
const htmlStandard = load('html-standard');
const htmlAam = load('html-aam');
const htmlAria = load('html-aria');
const role = (r) => aria.roles[r];
const el = (id) => htmlAria.elements.find((e) => e.id === id);

describe('data/aria.json (WAI-ARIA 1.2 REC + DPUB 1.1 + Graphics 1.0)', () => {
  it('is pinned to the ARIA 1.2 recommendation', () => {
    expect(aria.source.version).toBe('1.2');
    expect(aria.source.ref).toBe('origin/2023-06_REC');
    expect(aria.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(aria.attributes)).toHaveLength(48);
    expect(Object.keys(aria.roles).length).toBeGreaterThan(130);
  });

  it('keeps ARIA 1.3 additions out of the baseline', () => {
    expect(aria.roles.mark).toBeUndefined();
    expect(aria.attributes['aria-description']).toBeUndefined();
    expect(aria.notInBaseline.attributes).toContain('aria-description');
    expect(aria.notInBaseline.roles).toContain('mark');
  });

  it('resolves inheritance for required, supported and prohibited attributes', () => {
    expect(role('combobox').requiredAttributes).toEqual(expect.arrayContaining(['aria-controls', 'aria-expanded']));
    expect(role('menuitemradio').requiredAttributes).toContain('aria-checked');
    expect(role('checkbox').requiredAttributes).toContain('aria-checked');
    expect(role('tab').supportedAttributes).toEqual(expect.arrayContaining(['aria-selected', 'aria-label', 'aria-describedby']));
    expect(role('generic').prohibitedAttributes).toEqual(expect.arrayContaining(['aria-label', 'aria-labelledby', 'aria-roledescription']));
    expect(role('presentation').prohibitedAttributes).toEqual(['aria-label', 'aria-labelledby']);
    expect(role('button').superclassChain).toContain('widget');
  });

  it('extracts naming, context and ownership', () => {
    expect(role('img').nameFrom).toEqual(['author']);
    expect(role('button').nameFrom).toEqual(expect.arrayContaining(['author', 'contents']));
    expect(role('dialog').nameRequired).toBe(true);
    expect(role('generic').nameProhibited).toBe(true);
    expect(role('tab').requiredContextRoles).toEqual([{ role: 'tablist' }]);
    expect(role('listbox').requiredOwnedElements).toEqual(expect.arrayContaining([{ role: 'option', via: ['group'] }, { role: 'option' }]));
    expect(role('button').childrenPresentational).toBe(true);
  });

  it('extracts value types, values and deprecations', () => {
    const checked = aria.attributes['aria-checked'];
    expect(checked.valueType).toBe('tristate');
    expect(checked.values.map((v) => v.value)).toEqual(expect.arrayContaining(['true', 'false', 'mixed']));
    expect(aria.attributes['aria-labelledby'].valueType).toBe('idref_list');
    expect(aria.attributes['aria-grabbed'].deprecated).toBeTruthy();
    expect(role('directory').deprecated).toBeTruthy();
    expect(role('doc-chapter').module).toBe('dpub');
    expect(role('graphics-document').module).toBe('graphics');
  });

  it('pins Graphics ARIA to a fixed commit, not HEAD', () => {
    expect(aria.source.modules.graphics.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(aria.source.modules.graphics.commit).toBe(aria.source.modules.graphics.ref);
  });

  it('lists the roles that support each deprecated global attribute', () => {
    for (const name of ['aria-disabled', 'aria-errormessage', 'aria-haspopup', 'aria-invalid']) {
      expect(aria.attributes[name].globalDeprecated).toBe(true);
      expect(aria.attributes[name].usedInRoles.length).toBeGreaterThan(0);
    }
    expect(aria.attributes['aria-disabled'].usedInRoles).toEqual(expect.arrayContaining(['button', 'checkbox']));
    expect(aria.attributes['aria-disabled'].usedInRoles).not.toContain('img');
    expect(aria.attributes['aria-haspopup'].usedInRoles).toContain('combobox');
    expect(aria.attributes['aria-label'].usedInRoles).toEqual([]);
  });
});

describe('data/html-aria.json (ARIA in HTML)', () => {

  describe('data/html-aam.json (HTML Accessibility API Mappings)', () => {
    it('records its pinned W3C source and extracts element, attribute, and name data', () => {
      expect(htmlAam.source.version).toBe('1.0');
      expect(htmlAam.source.status).toBe('W3C Working Draft');
      expect(htmlAam.source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(htmlAam.elementMappings.length).toBeGreaterThan(140);
      expect(htmlAam.attributeMappings.length).toBeGreaterThan(150);
      expect(htmlAam.nameComputations.length).toBeGreaterThan(15);
      expect(htmlAam.elementMappings.find((entry) => entry.name === 'button').rows).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'wai-aria-1.2', value: '`button` role' })]),
      );
      expect(htmlAam.attributeMappings.find((entry) => entry.name === 'checked').rows).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'WAI-ARIA-1.2', value: '`aria-checked`="true"' })]),
      );
    });
  });
  it('has rows for every element with source metadata', () => {
    expect(htmlAria.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(htmlAria.elements.length).toBeGreaterThan(120);
    expect(htmlAria.elements.every((e) => e.id && e.url && e.ariaPolicy)).toBe(true);
  });

  it('captures implicit and allowed roles', () => {
    expect(el('el-button').implicitRole).toBe('button');
    expect(el('el-button').allowedRoles).toEqual(expect.arrayContaining(['tab', 'menuitem', 'switch']));
    expect(el('el-button').allowedRoles).not.toContain('heading');
    expect(el('el-img').notRecommendedRoles).toContain('img');
    expect(el('el-li').implicitRole).toBe('listitem');
  });

  it('captures aria policies', () => {
    expect(el('el-br').ariaPolicy).not.toBe('global-and-role');
    expect(el('el-button').ariaPolicy).toBe('global-and-role');
  });
});

describe('data/html-standard.json (WHATWG HTML Living Standard)', () => {
  it('records source digests and extracts element and content-attribute indexes', () => {
    expect(htmlStandard.source.lastUpdated).toMatch(/^\d{1,2} \w+ \d{4}$/);
    expect(htmlStandard.source.indexDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(htmlStandard.source.focusDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(htmlStandard.elements.length).toBeGreaterThan(100);
    expect(htmlStandard.attributes.length).toBeGreaterThan(250);
    expect(htmlStandard.attributes).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'data-*', global: true })]));
    expect(htmlStandard.elements.find((entry) => entry.tags.includes('dt'))).toMatchObject({
      attributes: ['globals'],
      url: expect.stringContaining('#the-dt-element'),
    });
    expect(htmlStandard.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'autofocus', global: true }),
        expect.objectContaining({ name: 'onfocus', global: true }),
      ]),
    );
    expect(htmlStandard.focus.text).toMatch(/negative integer[\s\S]*focusable/i);
  });
});
