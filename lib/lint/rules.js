import {
  aria,
  getAttribute,
  getRole,
  isNextAriaAttribute,
  isNextAriaRole,
  isWidgetRole,
  suggest,
  HTML_ARIA_URL,
} from '../data/index.js';
import {
  UNKNOWN,
  effectiveRole,
  explicitRole,
  implicitRole,
  isFocusable,
  isNativelyInteractive,
  isTabbable,
  matchRow,
  roleTokens,
} from './model.js';
import { destructiveActionConfirmation } from './destructive.js';
import * as F from './fixes.js';

const WCAG = {
  '1.1.1': 'WCAG 1.1.1 Non-text Content (A)',
  '1.3.1': 'WCAG 1.3.1 Info and Relationships (A)',
  '2.1.1': 'WCAG 2.1.1 Keyboard (A)',
  '2.4.3': 'WCAG 2.4.3 Focus Order (A)',
  '2.4.4': 'WCAG 2.4.4 Link Purpose (In Context) (A)',
  '2.4.6': 'WCAG 2.4.6 Headings and Labels (AA)',
  '3.2.1': 'WCAG 3.2.1 On Focus (A)',
  '3.3.2': 'WCAG 3.3.2 Labels or Instructions (A)',
  '3.3.4': 'WCAG 3.3.4 Error Prevention (Legal, Financial, Data) (AA)',
  '3.3.6': 'WCAG 3.3.6 Error Prevention (All) (AAA)',
  '4.1.2': 'WCAG 4.1.2 Name, Role, Value (A)',
};

const roleUrl = (r) => getRole(r)?.url;
const attrUrl = (a) => getAttribute(a)?.url;
const NO_ARIA_FIRST = 'https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/';
const isHtmlEl = (el) => el.isHtml;
const forEachPossible = (attr, fn) => {
  if (attr.kind === 'static') fn(attr.value);
  else (attr.possibleValues ?? []).forEach(fn);
};

// ---------------------------------------------------------------------------

const noInvalidRole = {
  id: 'no-invalid-role',
  description: 'role must contain valid, non-abstract WAI-ARIA 1.2 role tokens.',
  wcag: ['4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    const attr = el.get('role');
    if (!attr) return;
    forEachPossible(attr, (raw) => {
      const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) {
        report({ node: attr.node, severity: 'error', message: 'Empty role attribute.', help: 'Remove the role attribute or provide a valid role.', fix: () => F.safe(F.removeAttr(el, 'role')) });
        return;
      }
      tokens.forEach((t, i) => {
        const role = getRole(t);
        if (role?.abstract) {
          report({ node: attr.node, severity: 'error', message: `"${t}" is an abstract role and must not be used by authors.`, help: `Use a concrete subclass: ${role.subclassRoles.join(', ')}.`, references: [role.url] });
        } else if (!role && isNextAriaRole(t)) {
          report({ node: attr.node, severity: i === tokens.length - 1 ? 'warning' : 'info', message: `"${t}" is defined in ARIA 1.3 (draft), not ARIA 1.2.`, help: `Provide an ARIA 1.2 fallback role after it, e.g. role="${t} <fallback>".` });
        } else if (!role) {
          const s = suggest(t, Object.keys(aria().roles).filter((r) => !aria().roles[r].abstract));
          report({ node: attr.node, severity: 'error', message: `"${t}" is not a valid WAI-ARIA 1.2 role.${s ? ` Did you mean "${s}"?` : ''}`, help: 'Only the first valid role token is used; invalid tokens are ignored by browsers.', references: ['https://www.w3.org/TR/wai-aria-1.2/#role_definitions'], fix: s ? () => F.safe(F.replaceRoleToken(el, t, s)) : undefined });
        }
      });
    });
  },
};

const noDeprecatedRole = {
  id: 'no-deprecated-role',
  description: 'Do not use roles deprecated in WAI-ARIA 1.2 / DPUB-ARIA.',
  wcag: ['4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    const attr = el.get('role');
    if (!attr) return;
    forEachPossible(attr, (raw) => {
      for (const t of raw.trim().toLowerCase().split(/\s+/)) {
        const role = getRole(t);
        if (role?.deprecated) {
          const alt = { directory: 'list', 'doc-biblioentry': 'listitem', 'doc-endnote': 'listitem' }[t];
          report({ node: attr.node, severity: 'warning', message: `Role "${t}" is deprecated.`, help: alt ? `Use role="${alt}" instead.` : 'Use a non-deprecated role.', references: [role.url], fix: alt ? () => F.safe(F.replaceRoleToken(el, t, alt)) : undefined });
        }
      }
    });
  },
};

// Project policy: allowed on any element, even though it is only defined in ARIA 1.3.
export const ALWAYS_ALLOWED_ATTRIBUTES = new Set(['aria-description']);

const noInvalidAriaAttribute = {
  id: 'no-invalid-aria-attribute',
  description: 'aria-* attributes must be defined in WAI-ARIA 1.2.',
  wcag: ['4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    for (const a of el.ariaAttrs()) {
      if (getAttribute(a.name) || ALWAYS_ALLOWED_ATTRIBUTES.has(a.name)) continue;
      if (isNextAriaAttribute(a.name)) {
        report({ node: a.node, severity: 'warning', message: `${a.name} is an ARIA 1.3 (draft) attribute and is not part of ARIA 1.2.`, help: 'Support varies; make sure the information is also available another way.' });
        continue;
      }
      const s = suggest(a.name, Object.keys(aria().attributes));
      report({ node: a.node, severity: 'error', message: `${a.name} is not a valid ARIA attribute.${s ? ` Did you mean ${s}?` : ''}`, help: 'Unknown aria-* attributes are ignored by assistive technologies.', references: ['https://www.w3.org/TR/wai-aria-1.2/#state_prop_def'], fix: s ? () => F.safe(F.renameAttr(el, a.name, s)) : undefined });
    }
  },
};

// Smallest valid value of integer attributes (WAI-ARIA 1.2): -1 means "unknown", 0 is allowed only for rowspan.
const INTEGER_MINIMUM = { 'aria-level': 1, 'aria-posinset': 1, 'aria-colindex': 1, 'aria-rowindex': 1, 'aria-colspan': 1, 'aria-rowspan': 0, 'aria-setsize': -1, 'aria-colcount': -1, 'aria-rowcount': -1 };

// HTML-ARIA: authors SHOULD use lowercase for token values; browsers treat them case-insensitively.
const CASE_INSENSITIVE_TYPES = new Set(['true-false', 'tristate', 'true-false-undefined', 'token', 'token_list']);

function validateValue(def, value) {
  const v = value.trim();
  const tokens = def.values?.map((x) => x.value) ?? [];
  switch (def.valueType) {
    case 'true-false':
      return ['true', 'false'].includes(v.toLowerCase()) ? null : 'must be "true" or "false"';
    case 'tristate':
    case 'true-false-undefined':
    case 'token':
      if (!tokens.length) return null;
      return tokens.includes(v.toLowerCase()) ? null : `must be one of: ${tokens.join(', ')}`;
    case 'token_list':
      return v.split(/\s+/).every((t) => tokens.includes(t.toLowerCase())) && v ? null : `must be a space-separated list of: ${tokens.join(', ')}`;
    case 'integer': {
      if (!/^-?\d+$/.test(v)) return 'must be an integer';
      const min = INTEGER_MINIMUM[def.name];
      return min === undefined || Number(v) >= min ? null : `must be an integer greater than or equal to ${min}`;
    }
    case 'number':
      return v !== '' && Number.isFinite(Number(v)) ? null : 'must be a number';
    case 'idref':
      return v && !/\s/.test(v) ? null : 'must be a single element id';
    case 'idref_list':
      return v ? null : 'must be a space-separated list of element ids';
    case 'string':
      return v ? null : 'should not be empty';
    default:
      return null;
  }
}

const ariaAttributeValue = {
  id: 'aria-attribute-value',
  description: 'aria-* attribute values must match the type defined by WAI-ARIA 1.2.',
  wcag: ['4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    for (const a of el.ariaAttrs()) {
      const def = getAttribute(a.name);
      if (!def) continue;
      forEachPossible(a, (value) => {
        const problem = validateValue(def, value);
        if (!problem && CASE_INSENSITIVE_TYPES.has(def.valueType) && value.trim() !== value.trim().toLowerCase())
          report({ node: a.node, severity: 'warning', message: `${a.name}="${value}" should use lowercase.`, help: 'Browsers treat ARIA token values case-insensitively, but not every assistive technology does. Use lowercase values.', references: [HTML_ARIA_URL], fix: a.kind === 'static' ? () => F.safe(F.setAttr(el, a.name, value.trim().toLowerCase())) : undefined });
        if (problem)
          report({ node: a.node, severity: def.valueType === 'string' ? 'warning' : 'error', message: `${a.name}="${value}" is invalid: value ${problem}.`, help: `${a.name} has value type ${def.valueType}${def.defaultValue ? ` (default "${def.defaultValue}")` : ''}.`, references: [def.url], fix: a.kind === 'static' && def.valueType === 'integer' && INTEGER_MINIMUM[a.name] !== undefined && /^-?\d+$/.test(value.trim()) ? () => F.setAttr(el, a.name, Math.max(Number(value), INTEGER_MINIMUM[a.name])) : undefined });
      });
    }
  },
};

const noDeprecatedAriaAttribute = {
  id: 'no-deprecated-aria-attribute',
  description: 'Do not use ARIA attributes deprecated in WAI-ARIA 1.2.',
  wcag: ['4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    for (const a of el.ariaAttrs()) {
      const def = getAttribute(a.name);
      if (def?.deprecated)
        report({ node: a.node, severity: 'warning', message: `${a.name} is deprecated in WAI-ARIA 1.1+ and is not supported by assistive technologies.`, help: 'Remove it. Convey drag-and-drop state with instructions and live regions, and provide a non-drag alternative (WCAG 2.5.7).', references: [def.url], fix: () => F.safe(F.removeAttr(el, a.name)) });
    }
  },
};

// ---------------------------------------------------------------------------

/** Attributes valid for an element given its role (explicit or html-aria implicit). */
function supportedFor(el, role, row, explicit) {
  const set = new Set(getRole(role)?.supportedAttributes ?? []);
  if (!explicit && row && row !== UNKNOWN) {
    for (const r of row.ariaRoles ?? []) for (const a of getRole(r)?.supportedAttributes ?? []) set.add(a);
    for (const a of row.additionalAttributes ?? []) set.add(a);
  }
  return set;
}

const ROW_TREEGRID_ONLY = ['aria-expanded', 'aria-level', 'aria-posinset', 'aria-setsize'];

/** Nearest ancestor role, skipping generic/none and the given pass-through roles. */
function nearestRole(el, skip = []) {
  for (let p = el.parent; p; p = p.parent) {
    const r = effectiveRole(p);
    if (r === UNKNOWN) return UNKNOWN;
    if (!r || ['generic', 'none', 'presentation', ...skip].includes(r)) continue;
    return r;
  }
  return null;
}

const ariaRoleAttributes = {
  id: 'aria-role-attributes',
  description: 'aria-* attributes must be supported and not prohibited for the element role.',
  wcag: ['4.1.2'],
  check(el, report) {
    const attrs = el.ariaAttrs().filter((a) => getAttribute(a.name));
    if (!attrs.length) return;
    const row = matchRow(el);
    if (row && row !== UNKNOWN && row.ariaPolicy !== 'global-and-role') return; // handled by html-aria-no-aria
    const explicit = explicitRole(el);
    if (explicit === UNKNOWN) return;
    if (!explicit && roleTokens(el).tokens.length) return; // an unrecognised role is reported by no-invalid-role; don't fall back to the implicit role
    const role = explicit || implicitRole(el, row);
    const namingProhibited = !explicit && row && row !== UNKNOWN && row.namingProhibited && el.kind !== 'custom';

    for (const a of attrs) {
      const def = getAttribute(a.name);
      const isNaming = a.name === 'aria-label' || a.name === 'aria-labelledby';
      if (namingProhibited && isNaming) {
        report({ node: a.node, severity: 'error', message: `${a.name} is prohibited on <${el.lowerTag}> without a role; it will not be announced reliably.`, help: `Give the element an appropriate role that supports naming, use visible text, or move the label to an interactive element.`, references: [row.url, 'https://www.w3.org/TR/wai-aria-1.2/#prohibitedattributes'] });
        continue;
      }
      if (!role || role === UNKNOWN) continue;
      const roleDef = getRole(role);
      if (!roleDef) continue;
      if (roleDef.prohibitedAttributes.includes(a.name)) {
        report({ node: a.node, severity: 'error', message: `${a.name} is prohibited on role "${role}"${explicit ? '' : ` (implicit role of <${el.lowerTag}>)`}.`, help: isNaming ? 'Elements with this role cannot be named. Use visible text, or a role that supports naming.' : `Remove ${a.name}.`, references: [roleDef.url], fix: isNaming ? undefined : () => F.removeAttr(el, a.name) });
        continue;
      }
      if (role === 'row' && ROW_TREEGRID_ONLY.includes(a.name)) {
        const container = nearestRole(el, ['rowgroup']);
        if (container === 'table' || container === 'grid') {
          report({ node: a.node, severity: 'error', message: `${a.name} must not be used on a row inside a ${container}; it is only valid for rows in a treegrid.`, help: 'Remove it, or use role="treegrid" if rows are expandable/hierarchical.', references: [roleDef.url], fix: () => F.removeAttr(el, a.name) });
          continue;
        }
      }
      if (def.globalDeprecated && !roleDef.supportedAttributes.includes(a.name)) {
        report({ node: a.node, severity: 'warning', message: `${a.name} is deprecated as a global attribute in ARIA 1.2 and is not supported on role "${role}".`, help: `Only use ${a.name} on roles that support it: ${def.usedInRoles.slice(0, 12).join(', ')}${def.usedInRoles.length > 12 ? '…' : ''}.`, references: [def.url] });
        continue;
      }
      if (def.global) continue;
      if (!supportedFor(el, role, row, Boolean(explicit)).has(a.name)) {
        report({ node: a.node, severity: 'error', message: `${a.name} is not supported by role "${role}"${explicit ? '' : ` (implicit role of <${el.lowerTag}>)`}.`, help: `${a.name} is used by: ${def.usedInRoles.join(', ')}.`, references: [def.url, roleDef.url], fix: () => F.removeAttr(el, a.name) });
      }
    }
  },
};

// Native HTML features that satisfy a role's required state.
const NATIVE_SATISFIES = {
  'aria-checked': (el) => el.lowerTag === 'input' && (['checkbox', 'radio'].includes(el.value('type')) || el.value('type') === UNKNOWN),
  'aria-level': (el) => /^h[1-6]$/.test(el.lowerTag),
  'aria-valuenow': (el) => (el.lowerTag === 'input' && el.value('type') === 'range') || ['progress', 'meter'].includes(el.lowerTag),
  'aria-selected': (el) => el.lowerTag === 'option',
  'aria-expanded': (el) => el.lowerTag === 'select',
  'aria-controls': (el) => el.lowerTag === 'select',
};

const ariaRequiredAttributes = {
  id: 'aria-required-attributes',
  description: 'Elements with an explicit role must have the states/properties required by that role.',
  wcag: ['4.1.2'],
  check(el, report) {
    const role = explicitRole(el);
    if (!role || role === UNKNOWN) return;
    const def = getRole(role);
    for (const attr of def.requiredAttributes) {
      if (el.has(attr) || NATIVE_SATISFIES[attr]?.(el)) continue;
      const cond = def.requiredAttributeConditions?.[attr];
      if (cond === 'if focusable' && !isFocusable(el)) continue;
      const inherited = !def.localRequiredAttributes.includes(attr);
      // ARIA 1.3 drops the aria-selected requirement for option/treeitem; most implementations only set it on the selected item.
      const lenient = attr === 'aria-selected' && (role === 'option' || role === 'treeitem');
      const severity = el.hasSplattributes || lenient ? 'warning' : 'error';
      const values = getAttribute(attr)?.values?.map((v) => v.value).filter((v) => v !== 'undefined');
      report({ severity, message: `role="${role}" requires ${attr}${cond ? ` (${cond})` : ''}.${inherited ? ` (Inherited from ${def.superclassChain.find((r) => getRole(r)?.localRequiredAttributes.includes(attr)) ?? 'a superclass'}.)` : ''}${el.hasSplattributes ? ' It may be supplied via ...attributes.' : ''}`, help: `${lenient ? 'ARIA 1.2 requires it (ARIA 1.3 relaxes this); set aria-selected="false" on unselected items for best compatibility. ' : ''}Add ${attr}${values?.length ? ` (${values.join(' | ')})` : ''} and keep it in sync with component state, e.g. ${F.requiredAttributeSource(role, attr)}.`, references: [def.url, attrUrl(attr)], fix: () => F.requiredAttribute(el, role, attr) });
    }
  },
};

// ---------------------------------------------------------------------------

/**
 * Rows like li and div only restrict roles in a specific context (li in a list, div in dl).
 * Returns true when that restricted context applies, false when any role is allowed, UNKNOWN otherwise.
 */
function restrictedContext(el, row) {
  const p = el.parent;
  if (row.id === 'el-li') {
    if (!p) return UNKNOWN;
    const pr = effectiveRole(p);
    return pr === UNKNOWN ? UNKNOWN : pr === 'list';
  }
  if (row.id === 'el-div') return p ? p.lowerTag === 'dl' : UNKNOWN;
  if (row.id === 'el-summary') return p ? p.lowerTag === 'details' : UNKNOWN;
  return UNKNOWN;
}

const htmlAriaAllowedRole = {
  id: 'html-aria-allowed-role',
  description: 'Explicit roles must be allowed on the HTML element (ARIA in HTML).',
  wcag: ['4.1.2'],
  check(el, report) {
    const role = explicitRole(el);
    if (!role || role === UNKNOWN) return;
    const row = matchRow(el);
    if (!row || row === UNKNOWN) return;
    const attr = el.get('role');
    const implicit = implicitRole(el, row);
    const base = { node: attr.node, references: [row.url] };
    if (row.rolePolicy === 'none') {
      if (row.id === 'el-summary' && restrictedContext(el, row) !== true) return; // only the summary of a <details> takes no role
      report({ ...base, severity: 'error', message: `No role is allowed on <${row.element}>.`, help: 'Remove the role attribute.', fix: () => F.removeAttr(el, 'role') });
      return;
    }
    if (row.id === 'el-img-no-name' && !el.has('alt')) return; // <img role="presentation"> without alt is equivalent to alt=""
    if (role === 'list' && ['ul', 'ol'].includes(el.lowerTag)) {
      report({ ...base, severity: 'info', message: `role="list" on <${el.lowerTag}> is redundant, unless it restores list semantics that Safari/VoiceOver drops for lists styled with list-style: none.`, help: 'Keep it if the list is unstyled (list-style: none) and should be announced as a list.' });
      return;
    }
    if (role === implicit) {
      report({ ...base, severity: 'warning', message: `Redundant role: <${row.element}> already has role "${role}".`, help: 'Remove the role attribute; native semantics already provide it.', fix: () => F.safe(F.removeAttr(el, 'role')) });
      return;
    }
    if (row.notRecommendedRoles.includes(role)) {
      report({ ...base, severity: 'warning', message: `Authors are NOT RECOMMENDED to set role="${role}" on <${row.element}>.`, help: role === 'region' ? 'Give the section an accessible name (aria-labelledby) instead; a named <section> is already a region.' : 'Remove the role attribute; native semantics already provide it.', fix: () => F.removeAttr(el, 'role') });
      return;
    }
    if (row.shouldNotRoles.includes(role)) {
      report({ ...base, severity: 'warning', message: `Authors SHOULD NOT use role="${role}" on <${row.element}>.`, help: (row.notes ?? []).join(' ') || 'Use a different element.', fix: () => F.removeAttr(el, 'role') });
      return;
    }
    if (row.rolePolicy === 'any' && !row.contextFallbackPolicy) return;
    if (row.allowedRoles.includes(role)) return;
    if (row.contextFallbackPolicy) {
      const restricted = restrictedContext(el, row);
      if (restricted !== true) return;
    } else if (row.rolePolicy === 'any') return;
    const severity = 'error';
    report({ ...base, severity, message: `role="${role}" is not allowed on <${row.element}>.`, help: row.allowedRoles.length ? `Allowed roles: ${row.allowedRoles.join(', ')}. Otherwise use an element whose native semantics match.` : 'Use an element whose native semantics match.' });
  },
};

const htmlAriaNoAria = {
  id: 'html-aria-no-aria-attributes',
  description: 'Some elements must not have role or aria-* attributes (or only aria-hidden).',
  wcag: ['4.1.2'],
  check(el, report) {
    const row = matchRow(el);
    if (!row || row === UNKNOWN || row.ariaPolicy === 'global-and-role') return;
    for (const a of el.ariaAttrs()) {
      if ((row.ariaPolicy === 'hidden-only' && a.name === 'aria-hidden') || ALWAYS_ALLOWED_ATTRIBUTES.has(a.name)) continue;
      report({ node: a.node, severity: 'error', message: `${a.name} is not allowed on <${row.element}>${row.ariaPolicy === 'hidden-only' ? ' (only aria-hidden is allowed)' : ''}.`, help: row.id === 'el-img-no-name' ? 'An img with alt="" is decorative. Give it meaningful alt text if it conveys information.' : 'Remove the attribute.', references: [row.url], fix: () => F.removeAttr(el, a.name) });
    }
  },
};

const htmlAriaAttributeRules = {
  id: 'html-aria-attribute-rules',
  description: 'ARIA in HTML MUST NOT / SHOULD NOT rules for aria-* on specific elements.',
  wcag: ['4.1.2'],
  check(el, report) {
    const row = matchRow(el);
    if (!row || row === UNKNOWN) return;
    for (const rule of row.attributeRules ?? []) {
      for (const { name, value } of rule.attributes) {
        const a = el.get(name);
        if (!a) continue;
        if (value !== null && !(a.kind === 'static' ? a.value === value : a.possibleValues?.includes(value) ?? true)) continue;
        report({ node: a.node, severity: rule.level === 'must-not' ? 'error' : 'warning', message: `Authors ${rule.level === 'must-not' ? 'MUST NOT' : 'SHOULD NOT'} use ${name}${value ? `="${value}"` : ''} on <${row.element}>.`, help: 'The native HTML feature already exposes this state; use it instead.', references: [row.url], fix: () => F.removeAttr(el, name) });
      }
    }
  },
};

const DISABLEABLE = new Set(['button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option']);
const READONLY_OK = (el) => el.lowerTag === 'textarea' || (el.lowerTag === 'input' && !['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'submit', 'reset', 'button', 'image'].includes(el.value('type')));
const REQUIRED_OK = (el) => ['select', 'textarea'].includes(el.lowerTag) || (el.lowerTag === 'input' && !['range', 'color', 'hidden', 'submit', 'reset', 'button', 'image'].includes(el.value('type')));

const nativeAriaConflict = {
  id: 'native-aria-conflict',
  description: 'Prefer native HTML attributes over equivalent aria-* attributes, and never let them disagree.',
  wcag: ['4.1.2'],
  check(el, report) {
    const ref = `${HTML_ARIA_URL}#docconformance-attr`;
    const pair = (ariaName, nativeName, applies) => {
      const a = el.get(ariaName);
      if (!a || !applies(el)) return;
      const hasNative = el.has(nativeName);
      const v = a.kind === 'static' ? a.value.trim() : null;
      if (hasNative && v === 'false') {
        report({ node: a.node, severity: 'error', message: `${ariaName}="false" contradicts the native ${nativeName} attribute.`, help: `Remove ${ariaName}; bind ${nativeName}={{this.flag}} instead.`, references: [ref], fix: () => F.removeAttr(el, ariaName) });
      } else if (hasNative) {
        report({ node: a.node, severity: 'warning', message: `${ariaName} is redundant with the native ${nativeName} attribute.`, help: `Remove ${ariaName}; the native attribute already exposes the state.`, references: [ref], fix: () => F.safe(F.removeAttr(el, ariaName)) });
      } else {
        report({ node: a.node, severity: 'warning', message: `Use the native ${nativeName} attribute instead of ${ariaName} on <${el.lowerTag}>.`, help: `Native ${nativeName} also changes behavior (e.g. focus, form validation); ${ariaName} only changes what is announced.${ariaName === 'aria-disabled' ? ' Exception: aria-disabled is fine when you intentionally keep a disabled control focusable.' : ''}`, references: [ref], fix: () => (v === 'true' ? F.replaceAttr(el, ariaName, nativeName) : v === null ? F.renameAttr(el, ariaName, nativeName) : null) });
      }
    };
    pair('aria-disabled', 'disabled', (e) => DISABLEABLE.has(e.lowerTag) && (e.has('disabled') || e.get('aria-disabled')?.value === 'false'));
    pair('aria-readonly', 'readonly', READONLY_OK);
    pair('aria-required', 'required', REQUIRED_OK);
    pair('aria-placeholder', 'placeholder', (e) => ['input', 'textarea'].includes(e.lowerTag));

    const hidden = el.get('aria-hidden');
    if (hidden && el.has('hidden')) {
      const until = el.value('hidden') === 'until-found';
      report({ node: hidden.node, severity: until ? 'error' : 'warning', message: until ? 'aria-hidden="true" must not be used with hidden="until-found".' : 'aria-hidden is redundant on an element with the hidden attribute.', help: 'Remove aria-hidden.', references: [ref], fix: () => F.removeAttr(el, 'aria-hidden') });
    }
    if (el.get('aria-readonly')?.value === 'true' && el.has('contenteditable') && el.value('contenteditable') !== 'false') {
      report({ node: el.get('aria-readonly').node, severity: 'error', message: 'aria-readonly="true" must not be used on a contenteditable element.', help: 'Set contenteditable="false" instead.', references: [ref] });
    }
    for (const [ariaName, nativeName] of [['aria-colspan', 'colspan'], ['aria-rowspan', 'rowspan']]) {
      const a = el.get(ariaName);
      if (!a || !el.has(nativeName) || !['td', 'th'].includes(el.lowerTag)) continue;
      const differ = a.kind === 'static' && el.value(nativeName) !== UNKNOWN && a.value.trim() !== el.value(nativeName).trim();
      report({ node: a.node, severity: differ ? 'error' : 'warning', message: differ ? `${ariaName} disagrees with ${nativeName}.` : `${ariaName} is redundant with ${nativeName}.`, help: `Remove ${ariaName}.`, references: [ref], fix: () => F.removeAttr(el, ariaName) });
    }
    for (const [ariaName, nativeName] of [['aria-valuemin', 'min'], ['aria-valuemax', 'max']]) {
      const a = el.get(ariaName);
      if (a && el.has(nativeName) && ['input', 'meter', 'progress'].includes(el.lowerTag))
        report({ node: a.node, severity: 'error', message: `${ariaName} must not be used together with the native ${nativeName} attribute.`, help: `Remove ${ariaName}.`, references: [ref], fix: () => F.removeAttr(el, ariaName) });
    }
  },
};

// ---------------------------------------------------------------------------

// Components known to render a focusable element (built-ins and HDS).
const FOCUSABLE_COMPONENT = /^(LinkTo|link-to|Input|Textarea)$|^Hds::(Button|Link::(Standalone|Inline)|Dropdown|Copy::(Button|Snippet)|Pagination|Tabs|Accordion|Form::(TextInput|Textarea|Select|Checkbox|Radio|Toggle|MaskedInput|FileInput|Key))/;

const noAriaHiddenOnFocusable = {
  id: 'no-aria-hidden-on-focusable',
  description: 'aria-hidden="true" content must not be focusable.',
  wcag: ['4.1.2', '1.3.1'],
  check(el, report) {
    const a = el.get('aria-hidden');
    if (!a || el.value('aria-hidden') !== 'true') return;
    if (isTabbable(el) === true) {
      report({ node: a.node, severity: 'error', message: 'Focusable element has aria-hidden="true"; keyboard users can reach content screen reader users cannot perceive.', help: 'Remove aria-hidden, or remove the element from the tab order (disabled, inert, or tabindex="-1" when appropriate).', references: [attrUrl('aria-hidden')], fix: () => F.replaceAttr(el, 'aria-hidden', 'inert') });
      return;
    }
    const focusable = [];
    const components = [];
    const walk = (node) => node.children.forEach((c) => {
      if (c.isHtml && isTabbable(c) === true) focusable.push(c);
      else if (!c.isHtml && FOCUSABLE_COMPONENT.test(c.tag)) components.push(c);
      walk(c);
    });
    walk(el);
    for (const c of components)
      report({ el: c, severity: 'warning', message: `<${c.tag}> renders a focusable element inside an aria-hidden="true" subtree.`, help: 'Use the inert attribute on the container to hide it from everyone, or remove aria-hidden.', references: [attrUrl('aria-hidden')], fix: () => F.replaceAttr(el, 'aria-hidden', 'inert') });
    for (const c of focusable)
      report({ el: c, severity: 'error', message: `Focusable <${c.lowerTag}> is inside an aria-hidden="true" subtree.`, help: 'Use the inert attribute on the container to hide it from everyone, or remove aria-hidden.', references: [attrUrl('aria-hidden')], fix: () => F.replaceAttr(el, 'aria-hidden', 'inert') });
  },
};

const PRESENTATIONAL_GLOBALS = ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-live', 'aria-owns', 'aria-controls', 'aria-details', 'aria-keyshortcuts', 'aria-roledescription', 'aria-errormessage', 'aria-flowto'];

const presentationRoleConflict = {
  id: 'presentation-role-conflict',
  description: 'role="none"/"presentation" is ignored on focusable elements or ones with global ARIA attributes.',
  wcag: ['4.1.2'],
  check(el, report) {
    const role = explicitRole(el);
    if (role !== 'none' && role !== 'presentation') return;
    const reasons = [];
    if (isFocusable(el)) reasons.push('it is focusable');
    const globals = el.ariaAttrs().map((a) => a.name).filter((n) => PRESENTATIONAL_GLOBALS.includes(n));
    if (globals.length) reasons.push(`it has ${globals.join(', ')}`);
    if (reasons.length)
      report({ node: el.get('role').node, severity: 'error', message: `role="${role}" will be ignored because ${reasons.join(' and ')}.`, help: 'Browsers expose the native role instead (presentational role conflict resolution). Remove the role or the conflicting attributes.', references: ['https://www.w3.org/TR/wai-aria-1.2/#conflict_resolution_presentation_none'], fix: () => F.removeAttr(el, 'role') });
  },
};

// ---------------------------------------------------------------------------
// Accessible names

/** true | false | UNKNOWN — whether element content yields a non-empty name. */
function contentHasName(el) {
  let unknown = false;
  const walk = (content) => {
    for (const c of content) {
      if (c.type === 'text') {
        if (c.text.trim()) return true;
      } else if (c.type === 'dynamic' || c.type === 'yield') {
        unknown = true;
      } else if (c.type === 'element') {
        const e = c.el;
        if (!e.isHtml) {
          unknown = true;
          continue;
        }
        if (e.value('aria-hidden') === 'true' || e.has('hidden')) continue;
        if (e.has('aria-label') || e.has('aria-labelledby')) return true;
        if (e.lowerTag === 'img' || (e.lowerTag === 'input' && e.value('type') === 'image')) {
          const alt = e.value('alt');
          if (alt === UNKNOWN || (alt && alt.trim())) return true;
          continue;
        }
        if (e.lowerTag === 'svg') {
          if (e.children.some((k) => k.lowerTag === 'title')) return true;
          continue;
        }
        if (walk(e.content)) return true;
      }
    }
    return false;
  };
  return walk(el.content) ? true : unknown ? UNKNOWN : false;
}

function attrNonEmpty(el, name) {
  const v = el.value(name);
  if (v === null) return false;
  return v === UNKNOWN || v.trim() !== '';
}

const LABELABLE_INPUT_EXCLUDE = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

function hasLabelElement(el) {
  if (el.ancestors().some((a) => a.lowerTag === 'label')) return true;
  const id = el.value('id');
  if (id === UNKNOWN) return UNKNOWN;
  if (id && el.ctx.labelsFor.has(id)) return true;
  if (id && el.ctx.hasDynamicIds) return UNKNOWN;
  if (id) return 'elsewhere';
  return false;
}

// Browsers use placeholder as a last-resort name (HTML-AAM), but it disappears on input and is not a label (WCAG 3.3.2).
function placeholderOnly(el, has) {
  return has === false && attrNonEmpty(el, 'placeholder') ? 'placeholder' : has;
}

function nameCheck(el) {
  // Returns { needed: bool, how: string, has: true|false|UNKNOWN|'elsewhere', role }
  if (el.ariaAttrs().some((a) => a.name === 'aria-labelledby' || a.name === 'aria-label') && (attrNonEmpty(el, 'aria-labelledby') || attrNonEmpty(el, 'aria-label'))) return null;
  const explicit = explicitRole(el);
  if (explicit === UNKNOWN) return null;
  const tag = el.lowerTag;
  const titled = attrNonEmpty(el, 'title');

  if (!explicit) {
    if (tag === 'img') {
      if (!el.has('alt')) return { has: titled || false, missingAlt: true, role: 'img', wcag: ['1.1.1'] };
      return null;
    }
    if (tag === 'iframe') return { has: titled, role: 'iframe', how: 'a title attribute describing the frame', wcag: ['4.1.2'] };
    if (tag === 'input') {
      const type = el.value('type');
      if (type === UNKNOWN) return null;
      const t = (type ?? 'text').toLowerCase();
      if (t === 'hidden' || t === 'submit' || t === 'reset') return null;
      if (t === 'image') return { has: attrNonEmpty(el, 'alt') || titled, role: 'button', how: 'an alt attribute', wcag: ['1.1.1', '4.1.2'] };
      if (t === 'button') return { has: attrNonEmpty(el, 'value') || titled, role: 'button', how: 'a value attribute', wcag: ['4.1.2'] };
      if (LABELABLE_INPUT_EXCLUDE.has(t)) return null;
      const label = hasLabelElement(el);
      return { has: placeholderOnly(el, titled || label), role: 'form control', how: 'a <label>', wcag: ['4.1.2', '3.3.2', '1.3.1'] };
    }
    if (tag === 'select' || tag === 'textarea') {
      const label = hasLabelElement(el);
      return { has: tag === 'textarea' ? placeholderOnly(el, titled || label) : titled || label, role: 'form control', how: 'a <label>', wcag: ['4.1.2', '3.3.2', '1.3.1'] };
    }
    if (tag === 'button' || (tag === 'a' && el.has('href')) || /^h[1-6]$/.test(tag) || tag === 'summary') {
      const c = contentHasName(el);
      return { has: c === true || titled || (c === UNKNOWN ? UNKNOWN : false), role: tag === 'a' ? 'link' : /^h/.test(tag) ? 'heading' : 'button', how: 'text content', wcag: tag === 'a' ? ['2.4.4', '4.1.2'] : /^h/.test(tag) ? ['2.4.6', '1.3.1'] : ['4.1.2'] };
    }
    if (tag === 'area' && el.has('href')) return { has: attrNonEmpty(el, 'alt'), role: 'link', how: 'an alt attribute', wcag: ['1.1.1', '2.4.4'] };
    if (tag === 'object') return { has: titled || contentHasName(el), role: 'object', how: 'fallback text content, a title attribute, or aria-label', wcag: ['1.1.1'] };
    if (tag === 'dialog') return { has: titled, role: 'dialog', how: 'aria-labelledby pointing at the dialog heading', wcag: ['4.1.2'] };
    return null;
  }

  const def = getRole(explicit);
  if (!def?.nameRequired) return null;
  if (tag === 'img' && attrNonEmpty(el, 'alt')) return null;
  if (tag === 'svg' && el.children.some((k) => k.lowerTag === 'title' && contentHasName(k) !== false)) return null;
  if (['input', 'select', 'textarea'].includes(tag)) {
    const label = hasLabelElement(el);
    if (label !== false) return { has: label, role: explicit, how: 'a <label>', wcag: ['4.1.2'] };
  }
  if (def.nameFrom.includes('contents')) {
    const c = contentHasName(el);
    return { has: c === true || titled || (c === UNKNOWN ? UNKNOWN : false), role: explicit, how: 'text content, aria-label or aria-labelledby', wcag: ['4.1.2'] };
  }
  return { has: titled, role: explicit, how: 'aria-label or aria-labelledby', wcag: ['4.1.2'] };
}

function nameFix(el, r) {
  const tag = el.lowerTag;
  if (r.component) return F.addAttr(el, '@text="Describe the action"', 'Icon-only buttons still need @text; HDS hides it visually.');
  if (!el.isHtml && /^(LinkTo|link-to)$/.test(el.tag)) return F.nameWithAriaLabel(el, 'Describe the destination');
  if (tag === 'area') return F.addAttr(el, 'alt="Describe the link target"');
  if (tag === 'object') return F.addAttr(el, 'title="Describe the content"');
  if (r.has === 'elsewhere' || r.how === 'a <label>') return F.labelControl(el);
  if (tag === 'iframe') return F.addAttr(el, 'title="Describe the frame"');
  if (/^h[1-6]$/.test(tag) || tag === 'summary') return F.nameWithText(el, tag === 'summary' ? 'Summary text' : 'Heading text');
  if (tag === 'dialog') return F.addAttr(el, 'aria-labelledby="dialog-title"', 'Point it at the dialog\'s heading, e.g. <h2 id="dialog-title">Title</h2>.');
  if (tag === 'input') return F.addAttr(el, r.how === 'an alt attribute' ? 'alt="Describe the action"' : 'value="Describe the action"');
  if (tag === 'a') return F.nameWithAriaLabel(el, 'Describe the destination');
  return F.nameWithAriaLabel(el);
}

const NAME_FROM_TEXT_ARG = /^Hds::(Button|Link::Standalone)$/;

/** Built-in and HDS components whose accessible name comes from content, @text or a label. */
function componentNameCheck(el) {
  if (el.ariaAttrs().some((a) => (a.name === 'aria-labelledby' || a.name === 'aria-label') && attrNonEmpty(el, a.name))) return null;
  const titled = attrNonEmpty(el, 'title');
  if (/^(LinkTo|link-to)$/.test(el.tag)) {
    const c = contentHasName(el);
    return { has: c === true || titled || (c === UNKNOWN ? UNKNOWN : false), role: 'link', how: 'link text, aria-label or aria-labelledby', wcag: ['2.4.4', '4.1.2'] };
  }
  if (NAME_FROM_TEXT_ARG.test(el.tag)) {
    const text = el.args().find((a) => a.name === '@text');
    const has = !text ? false : text.value === null ? UNKNOWN : text.value.trim() !== '';
    return { has, role: el.tag.endsWith('Button') ? 'button' : 'link', how: '@text (also the accessible name of icon-only buttons)', wcag: ['4.1.2'], component: true };
  }
  if (/^(Input|Textarea)$/.test(el.tag)) {
    const typeArg = el.args().find((a) => a.name === '@type');
    const type = typeArg ? (typeArg.value ?? UNKNOWN) : el.value('type');
    if (type === UNKNOWN || ['hidden', 'submit', 'reset', 'button', 'image'].includes(String(type).toLowerCase())) return null;
    return { has: placeholderOnly(el, titled || hasLabelElement(el)), role: 'form control', how: 'a <label>', wcag: ['4.1.2', '3.3.2', '1.3.1'] };
  }
  return null;
}

const accessibleName = {
  id: 'accessible-name',
  description: 'Interactive elements, images, frames and roles that require a name must have an accessible name.',
  wcag: ['4.1.2', '1.1.1', '2.4.4', '3.3.2'],
  appliesToComponents: true,
  check(el, report) {
    if (el.value('aria-hidden') === 'true' || el.has('hidden')) return;
    if (!el.isHtml && el.ancestors().some((p) => p.value('aria-hidden') === 'true')) return;
    const r = el.isHtml ? nameCheck(el) : componentNameCheck(el);
    const tagName = el.isHtml ? el.lowerTag : el.tag;
    if (!r || r.has === true || r.has === UNKNOWN) return;
    const soft = r.has === 'elsewhere' || el.hasSplattributes;
    if (r.has === 'placeholder') {
      // Policy, stricter than HTML-AAM's placeholder fallback: a placeholder is never a label.
      // With ...attributes the caller may pass aria-label or aria-labelledby, so only warn.
      report({ severity: el.hasSplattributes ? 'warning' : 'error', message: `<${tagName}> is labelled only by its placeholder.`, help: `Add a visible <label>. A placeholder should show an example of the expected data, not label the field; it also disappears while typing and is often low contrast. Note: failing placeholder-only labels is an explicit policy of this ruleset, stricter than the browser's accessible-name fallback.${el.hasSplattributes ? ' Callers may pass a label via ...attributes; document that they must.' : ''}`, references: ['https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html'], wcag: ['3.3.2'], fix: () => F.labelControl(el) });
      return;
    }
    if (r.missingAlt) {
      report({ severity: 'error', message: '<img> is missing an alt attribute.', help: `Add alt="description" for informative images, or alt="" for decorative ones.${el.hasSplattributes ? ' ...attributes doesn\'t guarantee that callers pass alt, so add one here, e.g. <img alt="" ...attributes>.' : ''}`, references: [`${HTML_ARIA_URL}#el-img`], wcag: r.wcag, fix: () => F.addAttr(el, 'alt="Describe the image"', 'Use alt="" instead when the image is purely decorative.') });
      return;
    }
    report({
      severity: soft ? 'warning' : 'error',
      message: r.has === 'elsewhere' ? `<${tagName}> has an id but no matching <label for> in this template.` : `<${tagName}>${r.role ? ` (${r.role})` : ''} has no accessible name.`,
      help: `Provide ${r.how}.${el.hasSplattributes ? ' A name may also be passed via ...attributes; document that callers must provide it.' : ''}${r.how === 'a <label>' ? ' In Ember, generate ids with {{unique-id}} (or guidFor) and use <label for={{id}}>.' : ''}`,
      references: [roleUrl(r.role) ?? 'https://www.w3.org/TR/accname-1.2/'].filter(Boolean),
      wcag: r.wcag,
      fix: () => nameFix(el, r),
    });
  },
};

// ---------------------------------------------------------------------------
// Structure

const INTERMEDIATE_ROLES = new Set(['group', 'rowgroup']);

const ariaRequiredContext = {
  id: 'aria-required-context',
  description: 'Roles with a required context must be owned by an element with one of those roles.',
  wcag: ['1.3.1'],
  check(el, report) {
    const role = explicitRole(el);
    if (!role || role === UNKNOWN) return;
    const def = getRole(role);
    if (!def.requiredContextRoles.length || el.has('aria-owns')) return;
    let allowed = new Set(def.requiredContextRoles.map((c) => c.role));
    let via = null;
    for (let p = el.parent; p; p = p.parent) {
      const pr = effectiveRole(p);
      if (pr === UNKNOWN) return;
      if (!pr || TRANSPARENT_ROLES.has(pr) || (via && (pr === role || INTERMEDIATE_ROLES.has(pr)))) continue;
      if (allowed.has(pr)) {
        // group/rowgroup only count when they are themselves inside one of the other context roles.
        const outer = [...allowed].filter((r) => !INTERMEDIATE_ROLES.has(r));
        if (!INTERMEDIATE_ROLES.has(pr) || !outer.length || via) return;
        via = pr;
        allowed = new Set(outer);
        continue;
      }
      report({ severity: 'error', message: `role="${role}" must be contained by ${[...allowed].map((r) => `"${r}"`).join(' or ')}${via ? ` (its "${via}" is not inside one)` : ''}, but the nearest ancestor role is "${pr}".`, help: `Wrap it in an element with role ${[...allowed].join(' / ')}.`, references: [def.url], fix: via ? undefined : () => F.wrapInContext(el, [...allowed][0]) });
      return;
    }
    report({ severity: 'info', message: `role="${role}" is at the template root${via ? ` (inside "${via}")` : ''}; it must be rendered inside ${[...allowed].join(' / ')}.`, help: 'Make sure the parent template/component provides the required context role.', references: [def.url], fix: via ? undefined : () => F.wrapInContext(el, [...allowed][0]) });
  },
};

const TRANSPARENT_ROLES = new Set(['generic', 'none', 'presentation']);

function ownedRoles(el, out) {
  for (const c of el.content) {
    if (c.type === 'dynamic' || c.type === 'yield') return UNKNOWN;
    if (c.type !== 'element') continue;
    const r = effectiveRole(c.el);
    if (r === UNKNOWN) return UNKNOWN;
    if (c.el.value('aria-hidden') === 'true') continue;
    if (!r || TRANSPARENT_ROLES.has(r)) {
      if (ownedRoles(c.el, out) === UNKNOWN) return UNKNOWN;
      continue;
    }
    out.push({ role: r, el: c.el });
  }
  return out;
}

const ariaRequiredOwned = {
  id: 'aria-required-owned',
  description: 'Roles with required owned elements may only own elements with the listed roles.',
  wcag: ['1.3.1'],
  check(el, report) {
    const role = explicitRole(el);
    if (!role || role === UNKNOWN) return;
    const def = getRole(role);
    if (!def.requiredOwnedElements.length || el.has('aria-owns') || el.value('aria-busy') === 'true') return;
    const owned = ownedRoles(el, []);
    if (owned === UNKNOWN) return;
    const allowed = new Set(def.requiredOwnedElements.flatMap((o) => [o.role, ...(o.via ?? [])]));
    if (role === 'menu' || role === 'menubar') allowed.add('separator'); // used by every APG menu example
    const listed = [...new Set(def.requiredOwnedElements.map((o) => (o.via ? `${o.via.join(' → ')} → ${o.role}` : o.role)))];
    if (!owned.length) {
      report({ severity: 'error', message: `role="${role}" has no owned elements; it requires ${listed.join(', ')}.`, help: 'Populate it, or set aria-busy="true" while loading.', references: [def.url], fix: () => F.populateOwner(el, role) });
      return;
    }
    const viaRoles = new Set(def.requiredOwnedElements.flatMap((o) => o.via ?? []));
    const leafRoles = new Set(def.requiredOwnedElements.map((o) => o.role));
    for (const o of owned.filter((x) => viaRoles.has(x.role))) {
      const inner = ownedRoles(o.el, []);
      if (inner === UNKNOWN) continue;
      if (!inner.length)
        report({ el: o.el, severity: 'error', message: `role="${o.role}" inside role="${role}" owns no ${[...leafRoles].join(' / ')} elements.`, help: 'Put the owned items inside the group, or remove the empty group.', references: [def.url] });
      for (const i of inner)
        if (!leafRoles.has(i.role))
          report({ el: i.el, severity: 'error', message: `role="${o.role}" inside role="${role}" may only contain ${[...leafRoles].join(', ')}, not "${i.role}".`, help: 'Fix the child role, or move the element out of the group.', references: [def.url] });
    }
    for (const o of owned)
      if (!allowed.has(o.role))
        report({ el: o.el, severity: 'error', message: `role="${role}" may not own an element with role "${o.role}"; allowed: ${listed.join(', ')}.`, help: 'Fix the child role, or move the element outside this container.', references: [def.url] });
  },
};

// ---------------------------------------------------------------------------
// Keyboard / focus

const NATIVE_FOR_ROLE = {
  button: '<button type="button">',
  link: '<a href>',
  checkbox: '<input type="checkbox">',
  radio: '<input type="radio">',
  switch: '<button aria-pressed> or <input type="checkbox" role="switch">',
  textbox: '<input> or <textarea>',
  searchbox: '<input type="search">',
  slider: '<input type="range">',
  spinbutton: '<input type="number">',
  combobox: '<select> (or <input list>)',
  listbox: '<select multiple> or <select size>',
  heading: '<h1>–<h6>',
  list: '<ul>/<ol>',
  listitem: '<li>',
  img: '<img alt>',
  dialog: '<dialog>',
  table: '<table>',
  navigation: '<nav>',
  main: '<main>',
  banner: '<header>',
  contentinfo: '<footer>',
  complementary: '<aside>',
  form: '<form>',
  progressbar: '<progress>',
  meter: '<meter>',
  separator: '<hr>',
  group: '<fieldset>',
  article: '<article>',
  region: '<section aria-labelledby>',
  figure: '<figure>',
  paragraph: '<p>',
};

const noClickOnNonInteractive = {
  id: 'keyboard-accessible-click',
  description: 'Click handlers must be on elements that are focusable and keyboard operable.',
  wcag: ['2.1.1', '4.1.2'],
  check(el, report) {
    const events = el.eventNames();
    if (!events.has('click') && !events.has('mousedown') && !events.has('mouseup')) return;
    // Pointer tracking (drag, text selection) rather than an action.
    if (events.has('mousemove') || events.has('pointermove')) return;
    const href = el.value('href');
    if (el.lowerTag === 'a' && !explicitRole(el) && typeof href === 'string' && /^\s*(#|javascript:)/i.test(href)) {
      report({ severity: 'warning', message: `<a href="${href.trim().slice(0, 20)}"> with a click handler is a button in disguise.`, help: 'It is announced as a link, Space does not activate it, and "#" jumps to the top of the page. Use <button type="button"> for actions.', references: [NO_ARIA_FIRST], fix: () => F.swapTag(el, 'button', { drop: ['href'], add: ['type="button"'] }) });
      return;
    }
    if (isNativelyInteractive(el)) return;
    const role = effectiveRole(el);
    if (role === UNKNOWN) return;
    if (el.lowerTag === 'a' && !el.has('href') && !explicitRole(el)) {
      report({ severity: 'error', message: '<a> without href has a click handler; it is not focusable or announced as a link.', help: 'Use <button type="button"> for actions, or <a href> / <LinkTo> for navigation.', references: [NO_ARIA_FIRST], fix: () => F.swapTag(el, 'button', { add: ['type="button"'] }) });
      return;
    }
    const iconLike = ['i', 'svg'].includes(el.lowerTag) || /(^|[\s_-])(icon|fa|fas|far|fab|glyphicon|material-icons)([\s_-]|$)/i.test(typeof el.value('class') === 'string' ? el.value('class') : '');
    if ((!role || role === 'generic') && iconLike && !el.content.some((c) => c.type === 'text' && c.text.trim())) {
      report({ severity: 'error', message: `Icon <${el.lowerTag}> has a click handler but is not focusable or announced as a button.`, help: 'Use <button type="button" aria-label="…"> around the icon; keyboard and screen reader users cannot operate it otherwise.', references: [NO_ARIA_FIRST], fix: () => F.swapTag(el, 'button', { drop: ['role', 'tabindex'], add: ['type="button"', 'aria-label="Describe the action"'] }) });
      return;
    }
    if ((!role || role === 'generic') && !el.content.some((c) => c.type !== 'text' || c.text.trim())) {
      report({ severity: 'warning', message: `Empty <${el.lowerTag}> has a click handler (backdrop/overlay?).`, help: 'Pointer-only shortcuts are OK only if an equivalent keyboard path exists (e.g. Escape or a visible close button). Consider aria-hidden="true" on the overlay.', references: [NO_ARIA_FIRST] });
      return;
    }
    if (!role || !isWidgetRole(role)) {
      report({ severity: 'error', message: `<${el.lowerTag}> has a click handler but is not interactive${role ? ` (role "${role}")` : ''}.`, help: 'Use <button type="button"> (or <a href>/<LinkTo> for navigation). If a custom widget is truly needed, add a widget role, tabindex="0" and Enter/Space key handling.', references: [NO_ARIA_FIRST], fix: () => F.toButton(el) });
      return;
    }
    const tabbable = isTabbable(el);
    if (tabbable === false && el.value('tabindex') === null) {
      report({ severity: 'error', message: `role="${role}" element with a click handler is not focusable.`, help: 'Add tabindex="0" (or tabindex="-1" when focus is managed with roving tabindex / aria-activedescendant).', references: [roleUrl(role)], fix: () => F.addAttr(el, 'tabindex="0"') });
    }
    if (!['keydown', 'keyup', 'keypress'].some((k) => events.has(k))) {
      report({ severity: 'warning', message: `role="${role}" element handles clicks but no keyboard events.`, help: `Handle Enter/Space with {{on "keydown" this.onKeydown}} (see the APG pattern for "${role}"), or use ${NATIVE_FOR_ROLE[role] ?? 'a native element'} which does this for free.`, references: [roleUrl(role)], fix: () => F.addKeyboardHandler(el) });
    }
  },
};

// Elements that must not contain other interactive elements: roles whose children are presentational (ARIA),
// links (HTML forbids interactive content in <a>), Link/Button components, and HTML elements with a click handler.
const CONTROL_COMPONENT = /(LinkTo|Link|Link(::)?(Inline|Standalone)|Button)$/;
const handlesClick = (el) => {
  const e = el.eventNames();
  return (e.has('click') || e.has('mousedown') || e.has('mouseup')) && !e.has('mousemove') && !e.has('pointermove');
};
const isOuterControl = (el) => {
  if (el.lowerTag === 'label' || el.lowerTag === 'details') return false;
  // A click listener on a component invocation says nothing about its root element (often a container using event delegation).
  if (!el.isHtml) return CONTROL_COMPONENT.test(el.tag);
  const role = effectiveRole(el);
  if (role && role !== UNKNOWN && (getRole(role)?.childrenPresentational || role === 'link' || role === 'menuitem')) return true;
  return el.lowerTag === 'summary' || handlesClick(el);
};
const isInnerControl = (el) => {
  if (!el.isHtml) return CONTROL_COMPONENT.test(el.tag) || handlesClick(el);
  if (isNativelyInteractive(el) || handlesClick(el)) return true;
  const role = explicitRole(el);
  if (role && role !== UNKNOWN && isWidgetRole(role)) return true;
  const t = el.value('tabindex');
  return typeof t === 'string' && t.trim() !== '' && Number(t) >= 0;
};
const describe = (el) => (el.isHtml ? `<${el.lowerTag}${explicitRole(el) && explicitRole(el) !== UNKNOWN ? ` role="${explicitRole(el)}"` : ''}>` : `<${el.tag}>`);

const noNestedInteractive = {
  id: 'no-nested-interactive',
  description: 'Interactive elements must not contain other interactive elements.',
  wcag: ['4.1.2', '2.1.1'],
  appliesToComponents: true,
  check(el, report) {
    if (!isInnerControl(el)) return;
    const outer = el.ancestors().find(isOuterControl);
    if (!outer) return;
    report({ severity: 'error', message: `${describe(el)} is nested inside interactive ${describe(outer)} (line ${outer.node.loc.start.line}).`, help: 'Nested controls are not exposed reliably (ARIA "children presentational"; HTML forbids interactive content inside <a> and <button>), and a click on the inner one also triggers the outer one. Make them siblings, e.g. put the row or card action on its own button or link next to the inner control.', references: ['https://www.w3.org/TR/wai-aria-1.2/#childrenArePresentational', `${HTML_ARIA_URL}#el-button`] });
  },
};

const listChildren = {
  id: 'list-children',
  description: '<ul>, <ol> and <menu> may only contain <li> (and script/template) children.',
  wcag: ['1.3.1'],
  check(el, report) {
    if (!['ul', 'ol', 'menu'].includes(el.lowerTag)) return;
    const role = explicitRole(el);
    if (role === UNKNOWN || (role && role !== 'list')) return;
    for (const c of el.children) {
      if (c.kind !== 'html' || ['li', 'script', 'template'].includes(c.lowerTag)) continue;
      const cr = explicitRole(c);
      if (cr === 'listitem' || cr === UNKNOWN) continue;
      report({ el: c, severity: 'warning', message: `<${c.lowerTag}> is not allowed directly inside <${el.lowerTag}>; only <li> is.`, help: 'Wrap it in an <li>, or move it out of the list. Other direct children break list semantics (item counts, "list of N items") for screen readers.', references: [`${HTML_ARIA_URL}#el-${el.lowerTag}`], fix: () => F.wrapInListItem(c) });
    }
  },
};

const noPositiveTabindex = {
  id: 'no-positive-tabindex',
  description: 'tabindex must not be greater than 0.',
  wcag: ['2.4.3'],
  appliesToComponents: true,
  check(el, report) {
    const a = el.get('tabindex');
    if (!a) return;
    forEachPossible(a, (v) => {
      if (Number(v) > 0)
        report({ node: a.node, severity: 'error', message: `tabindex="${v}" creates a confusing focus order.`, help: 'Use tabindex="0" and order elements in the DOM, or tabindex="-1" for programmatic focus.', references: ['https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html'], fix: a.kind === 'static' ? () => F.safe(F.setAttr(el, 'tabindex', '0')) : undefined });
    });
  },
};

const noNoninteractiveTabindex = {
  id: 'no-noninteractive-tabindex',
  description: 'Avoid putting non-interactive elements in the tab order.',
  wcag: ['2.4.3'],
  check(el, report) {
    const v = el.value('tabindex');
    if (v === null || v === UNKNOWN || Number(v) < 0 || Number.isNaN(Number(v))) return;
    if (isNativelyInteractive(el)) return;
    const role = effectiveRole(el);
    if (role === UNKNOWN || (role && isWidgetRole(role))) return;
    if (['region', 'group', 'tabpanel', 'dialog', 'alertdialog', 'application', 'document', 'log', 'marquee', 'status', 'timer'].includes(role)) return;
    report({ node: el.get('tabindex').node, severity: 'warning', message: `Non-interactive <${el.lowerTag}>${role ? ` (role "${role}")` : ''} is in the tab order.`, help: 'Remove tabindex, or give it an interactive role and keyboard behavior. Scrollable regions are fine with role="region" and an accessible name.', references: [NO_ARIA_FIRST], fix: () => F.removeAttr(el, 'tabindex') });
  },
};

const isModal = (p) => p.lowerTag === 'dialog' || explicitRole(p) === 'dialog' || explicitRole(p) === 'alertdialog' || (!p.isHtml && /modal|dialog|flyout|drawer/i.test(p.tag));
const isFormField = (el) => {
  if (el.isHtml) return el.lowerTag === 'select' || el.lowerTag === 'textarea' || (el.lowerTag === 'input' && !['hidden', 'button', 'submit', 'reset', 'image'].includes(String(el.value('type')).toLowerCase()));
  return /(Input|Select|Textarea|TextArea|Field|Checkbox|Radio|Toggle|Combobox|Picker)(Base|Group)?$/.test(el.tag);
};
// First field in source order inside the modal. Fields in a block nested inside the modal ({{#if}}, {{#each}}) may not render, so they don't count as "before".
const firstFieldIn = (modal, target) => {
  const stack = [...modal.children].reverse();
  while (stack.length) {
    const n = stack.pop();
    if (n === target) return target;
    if (isFormField(n) && !target.ancestors().includes(n) && n.conditions.length === modal.conditions.length) return n;
    stack.push(...[...n.children].reverse());
  }
  return target;
};
const isButton = (el) => el.lowerTag === 'button' || explicitRole(el) === 'button' || (el.lowerTag === 'input' && ['button', 'submit', 'reset'].includes(String(el.value('type')).toLowerCase())) || (!el.isHtml && /Button$/.test(el.tag));
const hasField = (n) => n.children.some((c) => isFormField(c) || hasField(c));

const noAutofocus = {
  id: 'no-autofocus',
  description: 'Avoid autofocus; it can disorient screen reader and magnifier users. In a modal, autofocus the first form field.',
  // Not 3.2.1 On Focus: that SC is about a component initiating a change of context when it receives focus.
  wcag: ['2.4.3'],
  appliesToComponents: true,
  check(el, report) {
    const a = el.get('autofocus') ?? el.modifiers.find((m) => m.name === 'autofocus');
    if (!a || el.lowerTag === 'dialog') return;
    const fix = () => (el.has('autofocus') ? F.removeAttr(el, 'autofocus') : F.removeModifier(el, 'autofocus'));
    const modal = el.ancestors().find(isModal);
    if (!modal) return report({ node: a.node, severity: 'warning', message: 'autofocus moves focus unexpectedly on render.', help: 'Move focus deliberately with a modifier only when the user triggered the change. Inside a modal, autofocus the first form field.', fix });
    if (!isFormField(el)) {
      // APG dialog pattern: a confirmation with no fields may focus its least destructive action.
      if (isButton(el) && !hasField(modal)) return;
      return report({ node: a.node, severity: 'warning', message: `autofocus on <${el.tag}> inside a modal; only the first form field should be autofocused.`, help: isButton(el) ? 'This modal has form fields, so autofocus the first field instead. Autofocusing the least destructive button is only for modals without fields.' : 'Put autofocus on the first form field in the modal. If the modal has no form, remove autofocus and let the modal set initial focus (HDS modals focus the Dismiss button).', fix });
    }
    // A field inside {{#if}}/{{#each}} within the modal is revealed later (often by the user's choice), so it isn't competing for initial focus.
    if (el.conditions.length > modal.conditions.length) return;
    const first = firstFieldIn(modal, el);
    if (first !== el) report({ node: a.node, severity: 'warning', message: `autofocus is on a later field in the modal; the first field (<${first.tag}>, line ${first.node.loc.start.line}) should get it.`, help: 'Move autofocus to the first form field so focus order starts at the top of the form.', fix });
  },
};

// ---------------------------------------------------------------------------
// IDs

/** True when the element is inside either branch of an {{#if}} or {{#unless}}. */
const isConditional = (el) => (el.conditions ?? []).some((c) => /^(else )?(if|unless)\b/.test(c));

const noDuplicateId = {
  id: 'no-duplicate-id',
  description: 'Static ids must be unique within a template.',
  wcag: ['1.3.1', '4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    const id = el.value('id');
    if (!id || id === UNKNOWN) return;
    // Owner decision: never flag when either copy is conditional, since whether both render depends on runtime state.
    if (isConditional(el)) return;
    const first = el.ctx.all.slice(0, el.ctx.all.indexOf(el)).find((o) => o.value('id') === id && !isConditional(o));
    if (first)
      report({ node: el.get('id').node, severity: el.inBlock || first.inBlock ? 'warning' : 'error', message: `Duplicate id "${id}".`, help: 'IDREF attributes (for, aria-labelledby, aria-describedby…) resolve to the first match only. Use {{unique-id}}.', fix: () => F.uniqueId(el) });
  },
};

const IDREF_ATTRS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'aria-details', 'aria-flowto'];

/** Names of the for/aria-* attributes in this template whose static value lists `id`. */
function idReferrers(ctx, id) {
  const names = new Set();
  for (const o of ctx.all)
    for (const name of ['for', ...IDREF_ATTRS]) {
      const a = o.get(name);
      if (a?.kind === 'static' && a.value.trim().split(/\s+/).includes(id)) names.add(name);
    }
  return [...names];
}

// Only ids that something in the template points at matter for accessibility: if the template repeats,
// for/aria-* resolve to the first copy. Route templates render once per page, except inside {{#each}}.
const preferUniqueId = {
  id: 'prefer-unique-id',
  description: 'Hard-coded ids that for/aria-* point at break when the template renders more than once; generate them.',
  wcag: ['1.3.1', '4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    const a = el.get('id');
    if (a?.kind !== 'static' || !a.value.trim()) return;
    if (el.ctx.routeTemplate && !(el.conditions ?? []).some((c) => /^(else )?each\b/.test(c))) return;
    const referrers = idReferrers(el.ctx, a.value.trim());
    if (!referrers.length) return;
    report({ node: a.node, severity: 'info', message: `Static id="${a.value}" is referenced by ${referrers.join(', ')}; it will collide if this template renders more than once.`, help: 'Use {{#let (unique-id) as |id|}} … id={{id}} … {{/let}} (Ember 5.2+) or guidFor(this), and point the referencing attributes at {{id}}.', fix: () => F.uniqueId(el) });
  },
};

const idrefExists = {
  id: 'aria-idref-exists',
  description: 'IDREF attributes should point at ids present in the template.',
  wcag: ['1.3.1', '4.1.2'],
  appliesToComponents: true,
  check(el, report) {
    if (el.ctx.hasDynamicIds) return;
    for (const name of ['for', ...IDREF_ATTRS]) {
      const a = el.get(name);
      if (a?.kind !== 'static') continue;
      if (name === 'for' && el.lowerTag !== 'label') continue;
      const missing = a.value.trim().split(/\s+/).filter((id) => id && !el.ctx.ids.has(id));
      if (name === 'aria-controls' && explicitRole(el) === 'combobox') {
        const popupType = el.value('aria-haspopup');
        const POPUP_ROLES = ['listbox', 'tree', 'grid', 'dialog'];
        const expected = POPUP_ROLES.includes(popupType) ? [popupType] : POPUP_ROLES;
        for (const id of a.value.trim().split(/\s+/)) {
          const target = el.ctx.ids.get(id);
          const tr = target && effectiveRole(target);
          if (target && tr !== UNKNOWN && !expected.includes(tr))
            report({ node: a.node, severity: 'error', message: `Combobox popup #${id} has role "${tr ?? 'none'}"; expected ${expected.join(' / ')}.`, help: 'aria-controls must reference the popup element, and its role must match aria-haspopup (default listbox).', references: [roleUrl('combobox')] });
        }
      }
      if (missing.length)
        report({ node: a.node, severity: 'warning', message: `${name} references id${missing.length > 1 ? 's' : ''} not found in this template: ${missing.join(', ')}.`, help: 'Make sure the target exists in the rendered page, ideally in the same component, using a generated id.' });
    }
  },
};

const preferNativeElement = {
  id: 'prefer-native-element',
  description: 'Prefer native HTML elements to ARIA roles on generic elements.',
  wcag: ['4.1.2'],
  check(el, report) {
    const role = explicitRole(el);
    if (!role || role === UNKNOWN || !['div', 'span', 'a', 'p', 'i', 'b'].includes(el.lowerTag)) return;
    const native = NATIVE_FOR_ROLE[role];
    if (native)
      report({ node: el.get('role').node, severity: 'info', message: `role="${role}" on <${el.lowerTag}>; ${native} provides this natively.`, help: 'Native elements bring keyboard support, focus, states and form behavior for free ("No ARIA is better than bad ARIA").', references: [NO_ARIA_FIRST], fix: role === 'button' ? () => F.swapTag(el, 'button', { drop: ['role'], add: el.has('type') ? [] : ['type="button"'] }) : role === 'link' && el.lowerTag !== 'a' ? () => F.swapTag(el, 'a', { drop: ['role'], add: el.has('href') ? [] : ['href="…"'] }) : role === 'link' ? () => F.removeAttr(el, 'role') : undefined });
  },
};

export const rules = [
  noInvalidRole,
  noDeprecatedRole,
  noInvalidAriaAttribute,
  ariaAttributeValue,
  noDeprecatedAriaAttribute,
  ariaRoleAttributes,
  ariaRequiredAttributes,
  htmlAriaAllowedRole,
  htmlAriaNoAria,
  htmlAriaAttributeRules,
  nativeAriaConflict,
  noAriaHiddenOnFocusable,
  presentationRoleConflict,
  accessibleName,
  ariaRequiredContext,
  ariaRequiredOwned,
  noClickOnNonInteractive,
  noNestedInteractive,
  listChildren,
  noPositiveTabindex,
  noNoninteractiveTabindex,
  noAutofocus,
  noDuplicateId,
  idrefExists,
  preferUniqueId,
  preferNativeElement,
  destructiveActionConfirmation,
].map((r) => ({ ...r, wcag: r.wcag.map((w) => WCAG[w] ?? w) }));

export { WCAG, roleTokens };
