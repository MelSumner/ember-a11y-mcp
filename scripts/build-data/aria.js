import * as cheerio from 'cheerio';
import { readSource, commitOf, originUrl, collapse, toText } from './util.js';

export const ARIA_12_REF = 'origin/2023-06_REC';
const DPUB_REF = 'REC-dpub-1.1';
// w3c/aria has no Graphics ARIA 1.0 REC tag. This is the last content change to graphics-aria/index.html
// (2018-06-08, on the monorepo_history--graphics-aria branch) before the Recommendation.
export const GRAPHICS_REF = '865172e404d0edd298f7056c49bf02074dcc37d0';

const SPEC_URLS = {
  core: 'https://www.w3.org/TR/wai-aria-1.2/',
  dpub: 'https://www.w3.org/TR/dpub-aria-1.1/',
  graphics: 'https://www.w3.org/TR/graphics-aria-1.0/',
};

const refNames = ($, el) =>
  $(el)
    .find('rref, pref, sref')
    .toArray()
    .map((n) => collapse($(n).attr('title') || $(n).text()));

/** Map attribute -> qualifier such as "if focusable" found right after a reference. */
function conditions($, cell) {
  const out = {};
  $(cell)
    .find('pref, sref')
    .each((_, n) => {
      const next = n.nextSibling;
      const m = next && next.type === 'text' && /^\s*\(([^)]+)\)/.exec(next.data);
      if (m) out[collapse($(n).text())] = collapse(m[1]);
    });
  return out;
}

const flag = (text) => {
  const t = collapse(text).toLowerCase();
  if (t.startsWith('true')) return true;
  if (t.startsWith('false')) return false;
  return null;
};

/** Parse "Required Owned Elements"/"Required Context Role" cells, preserving `group → option` chains. */
function parseRoleChains($, cell) {
  return $(cell)
    .find('li')
    .toArray()
    .map((li) => {
      const roles = $(li)
        .find('rref')
        .toArray()
        .map((n) => collapse($(n).text()));
      return roles.length > 1 ? { role: roles[roles.length - 1], via: roles.slice(0, -1) } : { role: roles[0] };
    })
    .filter((c) => c.role)
    .concat(
      $(cell).find('li').length
        ? []
        : refNames($, cell).map((role) => ({ role })),
    );
}

function parseRoles(html, module) {
  const $ = cheerio.load(html, { xml: false });
  const roles = {};
  $('div.role').each((_, div) => {
    const $d = $(div);
    const name = collapse($d.find('rdef').first().attr('title') || $d.find('rdef').first().text());
    if (!name) return;
    const cell = (cls) => $d.find(`td.${cls}`).first();
    const props = (cls) => {
      const c = cell(cls);
      return c.length ? refNames($, c) : [];
    };
    const nameFromText = collapse(cell('role-namefrom').text()).toLowerCase();
    const nameFrom = ['author', 'contents', 'prohibited', 'encapsulation', 'legend'].filter((k) =>
      nameFromText.includes(k),
    );
    const description = toText($, $d.find('.role-description').first());
    roles[name] = {
      name,
      module,
      abstract: flag(cell('role-abstract').text()) === true,
      superclassRoles: props('role-parent'),
      baseConcepts: collapse(cell('role-base').text()) || null,
      relatedConcepts: collapse(cell('role-related').text()) || null,
      requiredContextRoles: parseRoleChains($, cell('role-scope')),
      requiredOwnedElements: parseRoleChains($, cell('role-mustcontain')),
      localRequiredAttributes: props('role-required-properties'),
      requiredAttributeConditions: conditions($, cell('role-required-properties')),
      localSupportedAttributes: props('role-properties'),
      localProhibitedAttributes: props('role-disallowed'),
      nameFrom,
      ownNameRequired: flag(cell('role-namerequired').text()),
      ownChildrenPresentational: flag(cell('role-childpresentational').text()),
      implicitValues: collapse(cell('implicit-values').text()) || null,
      deprecated: $d.hasClass('deprecated') || /\bdeprecated\b/i.test(description),
      description,
      url: SPEC_URLS[module] + '#' + name,
    };
  });
  return roles;
}

function parseAttributes(html) {
  const $ = cheerio.load(html);
  const attrs = {};
  $('div.state, div.property').each((_, div) => {
    const $d = $(div);
    const kind = $d.hasClass('state') ? 'state' : 'property';
    const name = collapse($d.find('sdef, pdef').first().text());
    if (!name) return;
    const valueCell = $d.find('td.state-value, td.property-value').first();
    const typeHref = valueCell.find('a').attr('href') ?? '';
    const valueType = typeHref.replace('#valuetype_', '') || collapse(valueCell.text());
    const applicability = collapse($d.find('td.state-applicability, td.property-applicability').first().text());
    const values = [];
    let defaultValue = null;
    $d.find('table.value-descriptions tbody tr').each((_, tr) => {
      const th = $(tr).find('.value-name');
      const raw = collapse(th.text());
      const value = raw.replace(/\s*\(default\)\s*$/i, '');
      const isDefault = th.find('.default').length > 0 || /\(default\)/i.test(raw);
      if (isDefault) defaultValue = value;
      values.push({ value, description: collapse($(tr).find('.value-description').text()), default: isDefault });
    });
    let global = false;
    let globalDeprecated = false;
    let globalExceptProhibited = false;
    if (/^All elements of the base markup/.test(applicability)) {
      global = true;
      globalExceptProhibited = /except/.test(applicability);
    } else if (/Use as a global deprecated/.test(applicability)) {
      global = true;
      globalDeprecated = true;
    }
    const description = toText($, $d.find(`.${kind}-description`).first());
    attrs[name] = {
      name,
      kind,
      valueType,
      values: values.length ? values : undefined,
      defaultValue,
      global,
      globalDeprecated,
      globalExceptProhibited,
      deprecated: $d.hasClass('deprecated'),
      usedInRoles: [],
      description,
      url: SPEC_URLS.core + '#' + name,
    };
  });
  return attrs;
}

function resolveInheritance(roles, attributes) {
  const cache = new Map();
  const resolve = (name, stack = []) => {
    if (cache.has(name)) return cache.get(name);
    const role = roles[name];
    if (!role || stack.includes(name)) return { supported: new Set(), required: new Set(), prohibited: new Set() };
    const acc = { supported: new Set(), required: new Set(), prohibited: new Set(), ancestors: new Set(), conditions: {} };
    for (const parent of role.superclassRoles) {
      const p = resolve(parent, [...stack, name]);
      Object.assign(acc.conditions, p.conditions);
      p.supported.forEach((a) => acc.supported.add(a));
      p.required.forEach((a) => acc.required.add(a));
      p.prohibited.forEach((a) => acc.prohibited.add(a));
      acc.ancestors.add(parent);
      (p.ancestors ?? []).forEach((a) => acc.ancestors.add(a));
    }
    role.localSupportedAttributes.forEach((a) => acc.supported.add(a));
    role.localRequiredAttributes.forEach((a) => {
      acc.supported.add(a);
      acc.required.add(a);
      delete acc.conditions[a];
    });
    Object.assign(acc.conditions, role.requiredAttributeConditions);
    role.localProhibitedAttributes.forEach((a) => {
      acc.prohibited.add(a);
      acc.supported.delete(a);
      acc.required.delete(a);
    });
    cache.set(name, acc);
    return acc;
  };
  const inheritFlag = (name, key, stack = []) => {
    const role = roles[name];
    if (!role || stack.includes(name)) return null;
    if (role[key] !== null) return role[key];
    for (const parent of role.superclassRoles) {
      const v = inheritFlag(parent, key, [...stack, name]);
      if (v !== null) return v;
    }
    return null;
  };

  const globals = Object.values(attributes).filter((a) => a.global);
  for (const role of Object.values(roles)) {
    const r = resolve(role.name);
    // Global states/properties apply to every role unless prohibited (roletype carries them in the spec).
    for (const g of globals) if (!g.globalDeprecated && !r.prohibited.has(g.name)) r.supported.add(g.name);
    role.superclassChain = [...r.ancestors];
    role.requiredAttributes = [...r.required].sort();
    role.requiredAttributeConditions = Object.fromEntries(
      Object.entries(r.conditions ?? {}).filter(([a]) => r.required.has(a)),
    );
    role.supportedAttributes = [...r.supported].sort();
    role.prohibitedAttributes = [...r.prohibited].sort();
    role.nameRequired = inheritFlag(role.name, 'ownNameRequired') === true;
    role.childrenPresentational = inheritFlag(role.name, 'ownChildrenPresentational') === true;
    role.nameProhibited = role.nameFrom.includes('prohibited');
    delete role.ownNameRequired;
    delete role.ownChildrenPresentational;
  }
  for (const role of Object.values(roles)) {
    role.subclassRoles = Object.values(roles)
      .filter((r) => r.superclassRoles.includes(role.name))
      .map((r) => r.name)
      .sort();
    if (role.abstract) continue;
    for (const a of role.supportedAttributes) {
      // Deprecated globals (e.g. aria-disabled) are only supported where a role lists them, so record those roles.
      if (attributes[a] && (!attributes[a].global || attributes[a].globalDeprecated)) attributes[a].usedInRoles.push(role.name);
    }
  }
  for (const a of Object.values(attributes)) a.usedInRoles.sort();
}

export function buildAria({ sourceDir }) {
  const coreHtml = readSource(sourceDir, 'index.html', ARIA_12_REF);
  const roles = parseRoles(coreHtml, 'core');
  const attributes = parseAttributes(coreHtml);
  // `none` is defined as a synonym of `presentation`; its own table is empty.
  const { name: _n, description: _d, url: _u, ...presentationTraits } = roles.presentation;
  roles.none = { ...roles.none, ...presentationTraits, synonymOf: 'presentation' };
  roles.presentation.synonymOf = 'none';

  const dpubRoles = parseRoles(readSource(sourceDir, 'dpub-aria/index.html', DPUB_REF), 'dpub');
  const graphicsRoles = parseRoles(readSource(sourceDir, 'graphics-aria/index.html', GRAPHICS_REF), 'graphics');
  const allRoles = { ...roles };
  for (const r of [...Object.values(dpubRoles), ...Object.values(graphicsRoles)]) {
    if (!allRoles[r.name]) allRoles[r.name] = r;
  }
  resolveInheritance(allRoles, attributes);

  // Names present in the ARIA 1.3 editor's draft but not in 1.2, so tools can say
  // "not in the ARIA 1.2 baseline" instead of "invalid".
  const nextHtml = readSource(sourceDir, 'index.html');
  const $n = cheerio.load(nextHtml);
  const nextRoles = $n('div.role rdef')
    .toArray()
    .map((n) => collapse($n(n).text()))
    .filter((n) => n && !allRoles[n]);
  const nextAttributes = $n('div.state sdef, div.property pdef')
    .toArray()
    .map((n) => collapse($n(n).text()))
    .filter((n) => n && !attributes[n]);

  return {
    source: {
      name: 'Accessible Rich Internet Applications (WAI-ARIA) 1.2',
      version: '1.2',
      status: 'W3C Recommendation 06 June 2023',
      url: SPEC_URLS.core,
      repo: originUrl(sourceDir),
      ref: ARIA_12_REF,
      commit: commitOf(sourceDir, ARIA_12_REF),
      modules: {
        dpub: { name: 'Digital Publishing WAI-ARIA Module 1.1', url: SPEC_URLS.dpub, ref: DPUB_REF, commit: commitOf(sourceDir, DPUB_REF) },
        graphics: { name: 'WAI-ARIA Graphics Module 1.0', url: SPEC_URLS.graphics, ref: GRAPHICS_REF, commit: commitOf(sourceDir, GRAPHICS_REF) },
      },
      // HEAD of the clone (the ARIA 1.3 editor's draft) is read only for `notInBaseline`.
      editorsDraft: { ref: 'HEAD', commit: commitOf(sourceDir) },
      license: 'W3C Document License',
      licenseUrl: 'https://www.w3.org/copyright/document-license-2023/',
    },
    roles: sortObject(allRoles),
    attributes: sortObject(attributes),
    globalAttributes: Object.values(attributes)
      .filter((a) => a.global)
      .map((a) => a.name)
      .sort(),
    synonyms: { presentation: 'none', none: 'presentation' },
    notInBaseline: {
      note: 'Present in the WAI-ARIA 1.3 editor\'s draft but not in the 1.2 Recommendation.',
      commit: commitOf(sourceDir),
      roles: [...new Set(nextRoles)].sort(),
      attributes: [...new Set(nextAttributes)].sort(),
    },
  };
}

function sortObject(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}
