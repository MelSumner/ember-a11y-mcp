import { getRole, htmlAria, htmlAriaRowsForTag, isNextAriaRole } from '../data/index.js';

export const UNKNOWN = Symbol('unknown');

const literal = (node) =>
  node && ['StringLiteral', 'NumberLiteral', 'BooleanLiteral'].includes(node.type) ? String(node.value) : null;

/** Normalize an AttrNode value into { kind, value, possibleValues }. */
function attrValue(valueNode) {
  if (valueNode.type === 'TextNode') return { kind: 'static', value: valueNode.chars };
  if (valueNode.type === 'MustacheStatement') {
    const lit = literal(valueNode.path);
    if (lit !== null) return { kind: 'static', value: lit };
    // {{if cond "a" "b"}} / {{unless cond "a"}} — collect the literal branches.
    const helper = valueNode.path?.original;
    if ((helper === 'if' || helper === 'unless') && valueNode.params.length >= 2) {
      const branches = valueNode.params.slice(1).map(literal);
      if (branches.every((b) => b !== null)) return { kind: 'dynamic', value: null, possibleValues: branches };
    }
    return { kind: 'dynamic', value: null };
  }
  if (valueNode.type === 'ConcatStatement') {
    if (valueNode.parts.every((p) => p.type === 'TextNode'))
      return { kind: 'static', value: valueNode.parts.map((p) => p.chars).join('') };
    return { kind: 'dynamic', value: null };
  }
  return { kind: 'dynamic', value: null };
}

export function classifyTag(tag) {
  if (tag.startsWith(':')) return 'named-block';
  if (/^[A-Z@]/.test(tag) || tag.includes('.') || tag.includes('::') || tag.startsWith('this')) return 'component';
  if (tag.includes('-')) return 'custom';
  return 'html';
}

export class El {
  constructor(node, parent, ctx) {
    this.node = node;
    this.tag = node.tag;
    this.lowerTag = node.tag.toLowerCase();
    this.kind = classifyTag(node.tag);
    this.parent = parent;
    this.ctx = ctx;
    this.children = [];
    this.content = [];
    this.attrs = new Map();
    this.hasSplattributes = false;
    for (const a of node.attributes) {
      if (a.name === '...attributes') {
        this.hasSplattributes = true;
        continue;
      }
      if (a.name.startsWith('@')) continue;
      this.attrs.set(a.name.toLowerCase(), { name: a.name.toLowerCase(), node: a, ...attrValue(a.value) });
    }
    this.modifiers = node.modifiers.map((m) => ({
      name: m.path?.original ?? '',
      params: m.params.map(literal),
      node: m,
    }));
  }

  has(name) {
    return this.attrs.has(name);
  }
  get(name) {
    return this.attrs.get(name) ?? null;
  }
  /** Static string value, '' for valueless, null if absent, UNKNOWN if dynamic. */
  value(name) {
    const a = this.attrs.get(name);
    if (!a) return null;
    return a.kind === 'static' ? a.value : UNKNOWN;
  }
  get isHtml() {
    return this.kind === 'html' || this.kind === 'custom';
  }
  get snippet() {
    const s = this.node.openTag?.asString?.() ?? `<${this.tag}>`;
    const one = s.replace(/\s+/g, ' ');
    return one.length > 160 ? one.slice(0, 157) + '…' : one;
  }
  get loc() {
    return this.node.loc;
  }
  /** @args on component invocations: [{ name: '@text', node, value: string|null, path: string|null }] */
  args() {
    return this.node.attributes
      .filter((a) => a.name.startsWith('@'))
      .map((a) => ({ name: a.name, node: a, value: a.value.type === 'TextNode' ? a.value.chars : null, path: a.value.type === 'TextNode' ? null : pathText(a.value) }));
  }
  ariaAttrs() {
    return [...this.attrs.values()].filter((a) => a.name.startsWith('aria-'));
  }
  eventNames() {
    const names = new Set();
    for (const m of this.modifiers) {
      if (m.name === 'on' && m.params[0]) names.add(m.params[0].toLowerCase());
      if (m.name === 'action') names.add('click');
    }
    for (const a of this.attrs.values()) if (/^on[a-z]+$/.test(a.name)) names.add(a.name.slice(2));
    return names;
  }
  ancestors() {
    const out = [];
    for (let p = this.parent; p; p = p.parent) out.push(p);
    return out;
  }
}

/** Best-effort source text for a path, mustache or sub-expression: this.x, @onX, (fn this.remove item) → "fn this.remove". */
export function pathText(node) {
  if (!node) return '';
  if (node.type === 'PathExpression') return node.original;
  if (node.type === 'MustacheStatement' || node.type === 'SubExpression') return [pathText(node.path), ...node.params.map(pathText)].filter(Boolean).join(' ');
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'ConcatStatement') return node.parts.map((p) => (p.type === 'TextNode' ? p.chars : pathText(p))).join('');
  return '';
}

/**
 * Build an element tree from a glimmer AST. Block statements ({{#if}}, {{#each}}) are
 * transparent for structure but make text content "unknown" for name computation.
 */
export function buildTree(ast, { script = '', templateSource = '', routeTemplate = false } = {}) {
  const all = [];
  const roots = [];
  // script: JavaScript of the component (gjs/gts file, or co-located .js/.ts for .hbs) for rules that need handler bodies.
  // routeTemplate: app/templates/x.{hbs,gjs,gts} (not a component), which renders once per page.
  const ctx = { ids: new Map(), hasDynamicIds: false, labelsFor: new Map(), all, yields: [], script, templateSource, routeTemplate };

  const visit = (nodes, parent, inBlock, contentSink, conditions = [], bindings = []) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'ElementNode': {
          const el = new El(node, parent, ctx);
          el.inBlock = inBlock || Boolean(parent?.inBlock);
          el.conditions = conditions;
          el.bindings = bindings;
          all.push(el);
          (parent ? parent.children : roots).push(el);
          contentSink?.push({ type: 'element', el });
          visit(node.children, el, false, el.content, conditions, [...bindings, ...node.blockParams]);
          break;
        }
        case 'TextNode':
          contentSink?.push({ type: 'text', text: node.chars });
          break;
        case 'MustacheStatement': {
          const lit = literal(node.path);
          const isYield = node.path?.original === 'yield';
          if (isYield) {
            const to = node.hash.pairs.find(({ key }) => key === 'to');
            ctx.yields.push({ name: to ? (to.value.type === 'StringLiteral' ? to.value.value : null) : 'default', parent, conditions });
          }
          contentSink?.push(lit !== null ? { type: 'text', text: lit } : { type: isYield ? 'yield' : 'dynamic' });
          break;
        }
        case 'BlockStatement': {
          contentSink?.push({ type: 'dynamic', block: true });
          // Source text of the block's condition, e.g. "this.isConfirming" for {{#if this.isConfirming}}.
          const cond = node.params?.[0] ? `${node.path?.original ?? ''} ${pathText(node.params[0])}` : node.path?.original ?? '';
          visit(node.program?.body ?? [], parent, true, null, [...conditions, cond], [...bindings, ...(node.program?.blockParams ?? [])]);
          visit(node.inverse?.body ?? [], parent, true, null, [...conditions, `else ${cond}`], [...bindings, ...(node.inverse?.blockParams ?? [])]);
          break;
        }
        default:
          break;
      }
    }
  };
  visit(ast.body, null, false, null);

  for (const el of all) {
    const id = el.get('id');
    if (id?.kind === 'static' && id.value) ctx.ids.set(id.value, el);
    else if (id) ctx.hasDynamicIds = true;
    if (el.lowerTag === 'label') {
      const f = el.get('for');
      if (f?.kind === 'static') ctx.labelsFor.set(f.value, el);
      else if (f) ctx.hasDynamicIds = true;
    } else if (!el.isHtml && /Label$/.test(el.tag)) {
      // HDS <F.Label @controlId="x"> renders <label for="x"> (hds/form/label/index.gts).
      const c = el.args().find((a) => a.name === '@controlId');
      if (c?.value) ctx.labelsFor.set(c.value, el);
      else if (c) ctx.hasDynamicIds = true;
    }
  }
  return { roots, all, ctx };
}

// ---------------------------------------------------------------------------
// Roles

export function roleTokens(el) {
  const a = el.get('role');
  if (!a) return { status: 'none', tokens: [] };
  if (a.kind !== 'static') {
    return { status: 'dynamic', tokens: [], possibleValues: a.possibleValues };
  }
  const tokens = a.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return { status: 'static', tokens };
}

/** The first token that is a valid, non-abstract ARIA 1.2 role (fallback-role semantics). */
export function explicitRole(el) {
  const { status, tokens } = roleTokens(el);
  if (status === 'dynamic') return UNKNOWN;
  if (status === 'none') return null;
  for (const t of tokens) {
    const r = getRole(t);
    if (r && !r.abstract) return t;
    if (isNextAriaRole(t)) continue;
  }
  return null;
}

const hasAuthorName = (el) => ['aria-label', 'aria-labelledby', 'title'].some((n) => el.has(n));

/** Find the html-aria table row describing this element, null if none, UNKNOWN if undecidable. */
export function matchRow(el) {
  if (!el.isHtml) return null;
  const rows = htmlAriaRowsForTag(el.lowerTag);
  if (!rows.length) return null;
  if (rows.length === 1 && !rows[0].match.attrs && !rows[0].match.inputTypes) return rows[0];

  if (el.lowerTag === 'input') {
    let type = el.value('type');
    if (type === UNKNOWN) return UNKNOWN;
    type = (type ?? '').trim().toLowerCase();
    if (!htmlAria().knownInputTypes.includes(type)) type = '';
    const listState = el.has('list');
    return (
      rows.find(
        (r) => r.match.inputTypes?.includes(type) && (r.match.attrs?.list === undefined || r.match.attrs.list === listState),
      ) ?? null
    );
  }
  if (el.lowerTag === 'img') {
    const alt = el.value('alt');
    const presentational = ['none', 'presentation'].includes(el.value('role')?.trim?.().toLowerCase());
    const noName = (alt === '' || (alt === null && presentational)) && !hasAuthorName(el);
    return rows.find((r) => r.id === (noName ? 'el-img-no-name' : 'el-img'));
  }
  if (el.lowerTag === 'select') {
    const size = el.value('size');
    if (size === UNKNOWN || el.get('multiple')?.kind === 'dynamic') return UNKNOWN;
    const listbox = el.has('multiple') || (size !== null && Number(size) > 1);
    return rows.find((r) => r.id === (listbox ? 'el-select-multiple-or-size-greater-1' : 'el-select'));
  }
  for (const r of rows) {
    const conds = Object.entries(r.match.attrs ?? {});
    if (conds.every(([name, cond]) => (cond === true ? el.has(name) : cond === false ? !el.has(name) : true))) return r;
  }
  return null;
}

const SECTIONING = new Set(['article', 'aside', 'main', 'nav', 'section']);
const SECTIONING_ROLES = new Set(['article', 'complementary', 'main', 'navigation', 'region']);

/** Implicit ARIA role, refined by context where the template allows; UNKNOWN when undecidable. */
export function implicitRole(el, row = matchRow(el)) {
  if (row === UNKNOWN) return UNKNOWN;
  if (!row) return null;
  switch (row.id) {
    case 'el-header':
    case 'el-footer': {
      const scoped = el.ancestors().some((a) => SECTIONING.has(a.lowerTag) || SECTIONING_ROLES.has(explicitRole(a)));
      return scoped ? 'generic' : row.implicitRole;
    }
    case 'el-section':
      return hasAuthorName(el) ? 'region' : 'generic';
    case 'el-li': {
      const p = el.parent;
      if (!p) return 'listitem';
      const pr = effectiveRole(p);
      return pr === 'list' || pr === UNKNOWN ? 'listitem' : 'generic';
    }
    case 'el-td': {
      const table = el.ancestors().find((x) => x.lowerTag === 'table');
      const tr = table ? explicitRole(table) : null;
      if (tr === UNKNOWN) return UNKNOWN;
      return tr === 'grid' || tr === 'treegrid' ? 'gridcell' : row.implicitRole;
    }
    case 'el-autonomous-custom-element':
    case 'el-form-associated-custom-element':
      return UNKNOWN;
    default:
      return row.implicitRole ?? null;
  }
}

export function effectiveRole(el) {
  if (!el.isHtml) return UNKNOWN;
  const explicit = explicitRole(el);
  if (explicit === UNKNOWN) return UNKNOWN;
  if (explicit) {
    // Presentational role conflict resolution: focusable elements or global ARIA keep their implicit role.
    if ((explicit === 'none' || explicit === 'presentation') && (isFocusable(el) || hasGlobalAria(el))) return implicitRole(el);
    return explicit;
  }
  return implicitRole(el);
}

function hasGlobalAria(el) {
  return el.ariaAttrs().some((a) => ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-live', 'aria-owns', 'aria-controls', 'aria-details', 'aria-keyshortcuts', 'aria-roledescription'].includes(a.name));
}

// ---------------------------------------------------------------------------
// Focus

const NATIVE_FOCUSABLE = new Set(['button', 'select', 'textarea', 'iframe', 'summary']);

export function isDisabled(el) {
  return ['button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option'].includes(el.lowerTag) && el.get('disabled')?.kind === 'static';
}

/** true / false / UNKNOWN — whether the element is in the sequential tab order. */
export function isTabbable(el) {
  if (!el.isHtml) return UNKNOWN;
  const tabindex = el.value('tabindex');
  if (tabindex === UNKNOWN) return UNKNOWN;
  if (tabindex !== null && tabindex.trim() !== '' && !Number.isNaN(Number(tabindex))) return Number(tabindex) >= 0;
  if (isDisabled(el)) return false;
  if (el.get('disabled')?.kind === 'dynamic') return UNKNOWN;
  if (NATIVE_FOCUSABLE.has(el.lowerTag)) return true;
  if ((el.lowerTag === 'a' || el.lowerTag === 'area') && el.has('href')) return true;
  if (el.lowerTag === 'input') return el.value('type') !== 'hidden';
  if ((el.lowerTag === 'audio' || el.lowerTag === 'video') && el.has('controls')) return true;
  const ce = el.value('contenteditable');
  if (ce !== null && ce !== UNKNOWN && ce !== 'false') return true;
  return false;
}

export function isFocusable(el) {
  const t = isTabbable(el);
  if (t === true) return true;
  const tabindex = el.value('tabindex');
  return tabindex !== null && tabindex !== UNKNOWN && tabindex.trim() !== '' && !Number.isNaN(Number(tabindex));
}

const INTERACTIVE_TAGS = new Set(['button', 'select', 'textarea', 'summary', 'details', 'option', 'label', 'input']);

export function isNativelyInteractive(el) {
  if (INTERACTIVE_TAGS.has(el.lowerTag)) return !(el.lowerTag === 'input' && el.value('type') === 'hidden');
  if ((el.lowerTag === 'a' || el.lowerTag === 'area') && el.has('href')) return true;
  if ((el.lowerTag === 'audio' || el.lowerTag === 'video') && el.has('controls')) return true;
  return false;
}
