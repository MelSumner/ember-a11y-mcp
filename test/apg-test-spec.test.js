import { describe, expect, test } from 'vitest';
import { apgTestSpec, specRoles } from '../lib/apg-test-spec.js';
import { apg, getAttribute, getRole } from '../lib/data/index.js';

const patterns = apg().patterns;
const entries = Object.entries(apgTestSpec);
const allStates = (spec) => [...(spec.states ?? []), ...(spec.optionalStates ?? [])];

describe('apgTestSpec', () => {
  test('has exactly one spec per APG pattern', () => {
    expect(Object.keys(apgTestSpec).sort()).toEqual(patterns.map((p) => p.id).sort());
  });

  test.each(patterns.map((p) => [p.id, p]))('%s: covers every role APG lists for the pattern', (id, pattern) => {
    const roles = specRoles(apgTestSpec[id]);
    const missing = (pattern.rolesStatesProperties?.roles ?? []).filter((r) => !roles.includes(r));
    expect(missing).toEqual([]);
  });

  test.each(entries)('%s: every role is a concrete, non-deprecated ARIA 1.2 role', (id, spec) => {
    for (const role of [...specRoles(spec), ...allStates(spec).map((s) => s.role)]) {
      const r = getRole(role);
      expect(r, `${id}: ${role}`).toBeTruthy();
      expect(r.abstract, `${id}: ${role} is abstract`).toBe(false);
      expect(r.deprecated, `${id}: ${role} is deprecated`).toBe(false);
    }
  });

  test.each(entries)('%s: required groups are non-empty alternatives', (id, spec) => {
    expect(Array.isArray(spec.conditional)).toBe(true);
    for (const group of spec.required) {
      expect(group.length, id).toBeGreaterThan(0);
      expect(new Set(group).size, `${id}: duplicate role in ${group}`).toBe(group.length);
    }
  });

  test.each(entries.filter(([, s]) => allStates(s).length))('%s: states are supported by their role with valid values', (id, spec) => {
    for (const s of allStates(spec)) {
      const attr = getAttribute(s.attr);
      expect(attr, `${id}: ${s.attr}`).toBeTruthy();
      expect(getRole(s.role).supportedAttributes, `${id}: ${s.role} doesn't support ${s.attr}`).toContain(s.attr);
      if (s.values === 'number') {
        expect(attr.valueType, `${id}: ${s.attr}`).toBe('number');
      } else {
        const allowed = attr.values.map((v) => v.value);
        expect(s.values.filter((v) => !allowed.includes(v)), `${id}: ${s.attr} values`).toEqual([]);
      }
    }
    for (const s of spec.optionalStates ?? []) expect(s.why, `${id}: optional ${s.attr} needs a reason`).toBeTruthy();
  });
});
