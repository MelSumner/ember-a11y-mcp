// Before/after examples attached to findings. Each builder returns { before, after, note? } built from the
// offending element's own source, so the example can be applied almost verbatim. Builders may return null.
import { getAttribute, getRole } from '../data/index.js';

const clean = (s) => s.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ');
const fix = (before, after, note, edits) => (before === after ? null : { before, after, ...(note ? { note } : {}), ...(edits ? { edits } : {}) });

/** Source edit in template-local coordinates; `remove` also swallows the whitespace before the range. */
const editFor = (node, text, remove = false) => ({ start: { line: node.loc.start.line, column: node.loc.start.column }, end: { line: node.loc.end.line, column: node.loc.end.column }, text, ...(remove ? { remove: true } : {}) });

/** Marks a fix as safe to apply automatically (--fix): it keeps behaviour and meaning, so no judgement is needed. */
export const safe = (f) => (f?.edits ? { ...f, safe: true } : f);

export const openTag = (el) => clean(el.node.openTag?.asString?.() ?? `<${el.tag}>`).replace(/\s+(\/?>)$/, '$1');
const attrSource = (el, name) => {
  const n = el.get(name)?.node;
  return n?.loc?.asString?.().trim() ?? null;
};
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const closeFor = (tag) => (VOID.has(tag.toLowerCase()) ? '' : `</${tag}>`);
const closeTag = (el) => closeFor(el.tag);
const hasContent = (el) => el.content.some((c) => c.type !== 'text' || c.text.trim());
const body = (el) => (hasContent(el) ? '…' : '');

/** Text of the open tag with one attribute replaced (or appended when absent), or removed when `next` is null. */
function editAttr(el, name, next) {
  const tag = openTag(el);
  const src = attrSource(el, name);
  if (src) {
    const flat = clean(src);
    return (next === null ? tag.replace(` ${flat}`, '') : tag.replace(flat, next)).replace(/ >$/, '>');
  }
  if (next === null) return tag;
  return insert(tag, next);
}

/** Append source text to the end of the attribute list, before block params or the closing bracket. */
function insert(tag, text) {
  const m = tag.match(/^(.*?)(\s+as\s+\|[^|]*\|)?\s*(\/?>)$/s);
  if (!m) return tag;
  return `${m[1]} ${text}${m[2] ?? ''}${m[3] === '/>' ? ' />' : '>'}`;
}

export function removeAttr(el, name) {
  const node = el.get(name)?.node;
  return fix(openTag(el), editAttr(el, name, null), undefined, node ? [editFor(node, '', true)] : undefined);
}

export function setAttr(el, name, value) {
  const node = el.get(name)?.node;
  const text = `${name}="${value}"`;
  return fix(openTag(el), editAttr(el, name, text), undefined, node ? [editFor(node, text)] : undefined);
}

export function replaceAttr(el, from, nextSource) {
  const node = el.get(from)?.node;
  return fix(openTag(el), editAttr(el, from, nextSource), undefined, node ? [editFor(node, nextSource)] : undefined);
}

export function addAttr(el, source, note) {
  return fix(openTag(el), insert(openTag(el), source), note);
}

export function renameAttr(el, from, to) {
  const src = attrSource(el, from);
  if (!src) return null;
  const renamed = src.replace(/^[^=\s]+/, to);
  return fix(openTag(el), openTag(el).replace(clean(src), clean(renamed)), undefined, [editFor(el.get(from).node, renamed)]);
}

export function replaceRoleToken(el, from, to) {
  const v = el.value('role');
  if (typeof v !== 'string') return null;
  const tokens = v.trim().split(/\s+/).map((t) => (t.toLowerCase() === from ? to : t));
  return setAttr(el, 'role', tokens.join(' '));
}

/** Same element after swapping the tag name and changing attributes: shown with content elided. */
export function swapTag(el, tag, { drop = [], add = [] } = {}) {
  let t = openTag(el);
  for (const name of drop) {
    const src = attrSource(el, name);
    if (src) t = t.replace(` ${clean(src)}`, '');
  }
  t = t.replace(/^<\S+/, `<${tag}`);
  for (const a of add) t = insert(t, a);
  const body_ = body(el);
  return fix(`${openTag(el)}${body_}${closeTag(el)}`, `${t}${body_}${closeFor(tag)}`);
}

/** Example markup for a required attribute, shaped by its ARIA value type. */
export function requiredAttributeSource(role, attr) {
  const def = getAttribute(attr);
  const camel = attr.replace(/^aria-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const tokens = def?.values?.map((v) => v.value).filter((v) => v !== 'undefined') ?? [];
  switch (def?.valueType) {
    case 'true-false':
    case 'true-false-undefined':
      return `${attr}={{if this.${camel} "true" "false"}}`;
    case 'tristate':
      return `${attr}={{this.${camel}}}`; // "true" | "false" | "mixed"
    case 'integer':
      return `${attr}="${role === 'heading' ? 2 : 1}"`;
    case 'number':
      return `${attr}={{this.value}}`;
    case 'idref':
    case 'idref_list':
      return `${attr}={{id}}`;
    default:
      return tokens.length ? `${attr}="${tokens[0]}"` : `${attr}={{this.${camel}}}`;
  }
}

export function requiredAttribute(el, role, attr) {
  const ids = ['idref', 'idref_list'].includes(getAttribute(attr)?.valueType);
  return addAttr(el, requiredAttributeSource(role, attr), ids ? 'Generate the id with {{#let (unique-id) as |id|}} and put id={{id}} on the referenced element.' : 'Keep the value in sync with component state.');
}

const LABELLED_BY_LET = (control, label, id) => `{{#let (unique-id) as |${id}|}}\n  <label for={{${id}}}>${label}</label>\n  ${control}\n{{/let}}`;

/** Visible label for a form control. */
export function labelControl(el) {
  const staticId = el.value('id');
  const base = openTag(el);
  if (staticId && staticId !== '' && typeof staticId === 'string')
    return fix(base, `<label for="${staticId}">Label text</label>\n${base}`);
  const control = insert(base.replace(/\s+id=\S+/, ''), 'id={{id}}');
  const selfClosed = /\/>$/.test(base) || el.lowerTag === 'input';
  return fix(base, LABELLED_BY_LET(control + (selfClosed ? '' : `${body(el)}${closeTag(el)}`), 'Label text', 'id'));
}

/** Name an element that has no text, using aria-label. */
export function nameWithAriaLabel(el, label = 'Describe the action') {
  return addAttr(el, `aria-label="${label}"`);
}

export function nameWithText(el, text = 'Heading text') {
  return fix(`${openTag(el)}${closeTag(el)}`, `${openTag(el)}${text}${closeTag(el)}`);
}

export function wrapInContext(el, contextRole) {
  return fix(`${openTag(el)}${body(el)}${closeTag(el)}`, `<div role="${contextRole}">\n  ${openTag(el)}${body(el)}${closeTag(el)}\n</div>`);
}

export function populateOwner(el, role) {
  const def = getRole(role);
  const owned = def?.requiredOwnedElements?.find((o) => !o.via?.length) ?? def?.requiredOwnedElements?.[0];
  if (!owned) return null;
  const child = `<div role="${owned.role}">…</div>`;
  const inner = owned.via?.length ? owned.via.reduceRight((acc, v) => `<div role="${v}">${acc}</div>`, child) : child;
  return fix(`${openTag(el)}${closeTag(el)}`, `${openTag(el)}\n  ${inner}\n${closeTag(el)}`);
}

/** Swap a clickable non-interactive element for a native button. */
export function toButton(el) {
  const drop = ['role', 'tabindex'];
  return swapTag(el, 'button', { drop, add: el.has('type') ? [] : ['type="button"'] });
}

export function addKeyboardHandler(el) {
  return addAttr(el, '{{on "keydown" this.handleKeydown}}', 'Activate on Enter (and Space for role="button"); better still, use a native <button>.');
}

export function wrapInListItem(el) {
  const html = `${openTag(el)}${body(el)}${closeTag(el)}`;
  return fix(html, `<li>${html}</li>`);
}

export function removeModifier(el, name) {
  const m = el.modifiers.find((x) => x.name === name);
  const src = m?.node?.loc?.asString?.();
  if (!src) return null;
  return fix(openTag(el), openTag(el).replace(` ${clean(src)}`, ''));
}

export function uniqueId(el) {
  const id = el.value('id');
  const tag = openTag(el);
  const swapped = tag.replace(attrSource(el, 'id') ?? '', 'id={{id}}');
  return fix(tag, `{{#let (unique-id) as |id|}}\n  ${swapped}${body(el)}${closeTag(el)}\n{{/let}}`, `Update anything that references id="${id}" (for, aria-labelledby, aria-controls…) to use {{id}} inside the same block.`);
}

export function confirmDestructive(el, { handler, label }) {
  const name = handler ?? 'this.delete';
  const text = label || 'Delete';
  const before = `${openTag(el)}${text || body(el)}${closeTag(el)}`;
  const after = [
    '{{#if this.isConfirming}}',
    `  <p id="confirm-message">Are you sure you want to ${text.toLowerCase()}? This cannot be undone.</p>`,
    `  <button type="button" {{on "click" ${name}}}>Yes, ${text.toLowerCase()}</button>`,
    '  <button type="button" {{on "click" this.cancelConfirm}}>Cancel</button>',
    '{{else}}',
    '  <button type="button" {{on "click" this.askToConfirm}}>' + text + '</button>',
    '{{/if}}',
  ].join('\n');
  return { before, after, note: 'askToConfirm sets isConfirming = true and moves focus to the confirm step; cancelConfirm resets it. A modal (<HdsModal>) or an Undo also satisfies this rule.' };
}
