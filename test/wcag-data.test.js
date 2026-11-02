import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wcag = JSON.parse(readFileSync(new URL('../data/wcag.json', import.meta.url), 'utf8'));
const sc = (num) => wcag.successCriteria.find((s) => s.num === num);

describe('data/wcag.json', () => {
  it('has source metadata and all 87 success criteria (including obsolete 4.1.1)', () => {
    expect(wcag.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(wcag.principles).toHaveLength(4);
    expect(wcag.principles.flatMap((p) => p.guidelines)).toHaveLength(13);
    expect(wcag.successCriteria).toHaveLength(87);
    expect(wcag.successCriteria.filter((s) => !s.obsolete)).toHaveLength(86);
  });

  it('takes normative text from the WCAG 2.2 Recommendation tag', () => {
    expect(wcag.source).toMatchObject({ ref: 'WCAG22-20241212', status: 'W3C Recommendation 12 December 2024' });
    expect(wcag.source.refCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('drops the editorial "New" badge from SC text', () => {
    const added = wcag.successCriteria.filter((s) => s.version === '2.2' && !s.obsolete);
    expect(added).toHaveLength(9);
    for (const s of added) expect(s.text).not.toMatch(/^New\b/);
    expect(sc('2.4.12').text).toMatch(/^When a user interface component receives keyboard focus/);
  });

  it('records level, version and obsolescence', () => {
    expect(sc('1.4.3')).toMatchObject({ id: 'contrast-minimum', level: 'AA', version: '2.0', obsolete: false });
    expect(sc('2.5.8')).toMatchObject({ id: 'target-size-minimum', level: 'AA', version: '2.2' });
    expect(sc('4.1.1')).toMatchObject({ id: 'parsing', obsolete: true, formerLevel: 'A' });
    expect(sc('1.4.3').text).toMatch(/Logotypes/);
    expect(sc('2.5.8').understanding.brief.goal).toBeTruthy();
  });

  it('numbers success criteria sequentially within each guideline', () => {
    for (const g of wcag.principles.flatMap((p) => p.guidelines)) {
      const nums = wcag.successCriteria.filter((s) => s.guideline === g.num).map((s) => s.num);
      expect(nums.length).toBeGreaterThan(0);
      expect(nums).toEqual(nums.map((_, i) => `${g.num}.${i + 1}`));
    }
  });

  it('resolves associated techniques and ACT rules for 4.1.2', () => {
    const nrv = sc('4.1.2');
    const sufficient = nrv.techniques.sufficient.flatMap((s) => s.techniques);
    expect(sufficient.find((t) => t.id === 'ARIA14')?.title).toMatch(/aria-label/);
    expect(sufficient.find((t) => t.id === 'G108')?.using.map((t) => t.id)).toContain('H91');
    expect(nrv.actRules.length).toBeGreaterThan(0);
    expect(wcag.actRules.filter((r) => nrv.actRules.includes(r.id)).every((r) => r.url.startsWith('https://www.w3.org/WAI/'))).toBe(true);
  });

  it('extracts technique details', () => {
    const t = wcag.techniques.ARIA14;
    expect(t).toMatchObject({ technology: 'aria', url: 'https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA14' });
    expect(t.description).toMatch(/aria-label/);
    expect(t.examples.length).toBeGreaterThan(0);
    expect(t.examples[0].code[0]).toMatch(/aria-label/);
    expect(t.successCriteria).toContain('4.1.2');
    // Ids come from filenames: F112's markup wrongly claims "F47".
    expect(wcag.techniques.F112.successCriteria).toEqual(['2.2.2']);
    expect(wcag.techniques.F70).toMatchObject({ obsolete: true, obsoleteSince: '2.2' });
  });
});
