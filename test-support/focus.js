// Focus visibility checks for browser tests (WCAG 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured).
// Browser-only, no dependencies. Use it in Ember acceptance or rendering tests:
//
//   import { a11yFocusAudit } from 'ember-a11y-mcp/test-support/focus.js';
//   await visit('/settings');
//   await a11yFocusAudit();
//
// It focuses every tabbable element and compares computed styles before and after focus on the
// element, its ::before/::after (and ::file-selector-button), its labels, its next sibling, its aria-activedescendant target and
// up to three ancestors (:focus-within). Without a screenshot it can't judge contrast or size, so
// color-only changes are reported as weak, and a person should still review those.

const STRONG = ['outline', 'box-shadow', 'border', 'text-decoration', 'background-image'];
const PROPS = [
  'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'box-shadow',
  ...['top', 'right', 'bottom', 'left'].flatMap((s) => [`border-${s}-style`, `border-${s}-width`, `border-${s}-color`]),
  'background-color', 'background-image', 'color', 'text-decoration-line', 'text-decoration-color', 'text-decoration-thickness',
  'font-weight', 'opacity', 'transform', 'filter',
];
const PSEUDO_PROPS = [...PROPS, 'content', 'display', 'visibility', 'width', 'height'];
// iframes are left out: focus moves into the frame's document, so audit the frame's content separately.
const TABBABLE = [
  'a[href]', 'area[href]', 'button', 'input:not([type="hidden" i])', 'select', 'textarea', 'summary',
  '[tabindex]', '[contenteditable]:not([contenteditable="false" i])', 'audio[controls]', 'video[controls]',
].join(',');

const transparent = (c) => c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function snapshot(el, pseudo, props) {
  const cs = getComputedStyle(el, pseudo);
  return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
}

function family(prop) {
  if (prop.startsWith('outline')) return 'outline';
  if (prop.startsWith('border')) return 'border';
  if (prop.startsWith('text-decoration')) return 'text-decoration';
  return prop;
}

/** Whether a changed property is something you can actually see. */
function visibleChange(prop, snap) {
  if (prop.startsWith('outline')) return snap['outline-style'] !== 'none' && parseFloat(snap['outline-width']) > 0 && !transparent(snap['outline-color']);
  if (prop === 'box-shadow') return snap['box-shadow'] !== 'none';
  if (prop.startsWith('border')) {
    const side = prop.split('-')[1];
    return snap[`border-${side}-style`] !== 'none' && parseFloat(snap[`border-${side}-width`]) > 0 && !transparent(snap[`border-${side}-color`]);
  }
  if (prop === 'text-decoration-line') return snap[prop] !== 'none';
  return true;
}

function describe(el) {
  if (!el) return '(none)';
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
  const text = (el.getAttribute('aria-label') ?? el.textContent ?? el.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `<${el.tagName.toLowerCase()}${id}${cls}>${text ? ` "${text}"` : ''}`;
}

function isVisible(el) {
  if (el.closest('[inert]')) return false;
  if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true });
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
}

function defaultRoot() {
  return document.querySelector('#ember-testing') ?? document.body;
}

/** Tabbable elements under `root`, in sequential focus order (positive tabindex first). */
export function tabbableElements(root = defaultRoot()) {
  const els = [...root.querySelectorAll(TABBABLE)].filter((el) => {
    if (el.tabIndex < 0 || el.disabled || !isVisible(el)) return false;
    if (el.matches('summary') && el.parentElement?.tagName !== 'DETAILS') return false;
    // Only the checked radio of a named group (or the first, if none is checked) is in the tab order.
    if (el.type === 'radio' && el.name) {
      const group = [...(el.form ?? root).querySelectorAll(`input[type="radio" i][name="${CSS.escape(el.name)}"]`)].filter((r) => !r.disabled);
      return el === (group.find((r) => r.checked) ?? group[0]);
    }
    return true;
  });
  const positive = els.filter((el) => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...els.filter((el) => el.tabIndex === 0)];
}

function watched(el) {
  const list = [{ on: 'element', el }];
  const ad = el.getAttribute('aria-activedescendant');
  if (ad && document.getElementById(ad)) list.push({ on: 'aria-activedescendant', el: document.getElementById(ad) });
  for (const label of el.labels ?? []) if (!label.contains(el)) list.push({ on: 'label', el: label });
  if (el.nextElementSibling) list.push({ on: 'next sibling', el: el.nextElementSibling });
  for (let a = el.parentElement, i = 0; a && i < 3 && a !== document.body; a = a.parentElement, i++) list.push({ on: `ancestor ${i + 1}`, el: a });
  return list;
}

function snapshotAll(list) {
  return list.map(({ el }) => ({
    self: snapshot(el, null, PROPS),
    before: snapshot(el, '::before', PSEUDO_PROPS),
    after: snapshot(el, '::after', PSEUDO_PROPS),
    // File inputs often draw their focus ring on the "Choose file" button.
    ...(el.matches('input[type="file" i]') ? { 'file-selector-button': snapshot(el, '::file-selector-button', PROPS) } : {}),
  }));
}

const tiny = (el) => {
  const r = el.getBoundingClientRect();
  return r.width < 2 || r.height < 2;
};

/** null if any part of `el` is on top at its center or corners, otherwise why it isn't. */
function obscured(el) {
  const r = el.getBoundingClientRect();
  const points = [[(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.left + 1, r.top + 1], [r.right - 1, r.top + 1], [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1]];
  const hits = points.map(([x, y]) => document.elementFromPoint(x, y));
  if (hits.some((h) => h && (h === el || el.contains(h) || h.contains(el)))) return null;
  const by = hits.find(Boolean);
  return by ? `covered by ${describe(by)}` : 'outside the viewport';
}

/**
 * Focus `element` and report how the page's appearance changes.
 * @returns {Promise<{element, description, focused, focusVisible, visible, weak, changes, obscured}>}
 */
export async function focusIndicator(element) {
  const style = document.createElement('style');
  // Smooth scrolling would leave the element mid-scroll when we check whether it's covered.
  style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}';
  document.head.append(style);
  const previous = document.activeElement;
  try {
    previous?.blur?.();
    await nextFrame();
    const list = watched(element);
    const before = snapshotAll(list);
    element.focus({ focusVisible: true });
    await nextFrame();
    const after = snapshotAll(list);
    const focused = document.activeElement === element || element.contains(document.activeElement);

    const changes = [];
    list.forEach(({ on }, i) => {
      for (const part of Object.keys(after[i])) {
        const a = before[i][part];
        const b = after[i][part];
        const pseudo = part !== 'self';
        if ((part === 'before' || part === 'after') && a.content === 'none' && b.content === 'none') continue;
        for (const prop of Object.keys(b)) {
          if (a[prop] === b[prop] || (!pseudo && !visibleChange(prop, b))) continue;
          changes.push({ on: pseudo ? `${on}::${part}` : on, property: prop, before: a[prop], after: b[prop] });
        }
      }
    });
    const strong = changes.some((c) => c.on.includes('::') || STRONG.includes(family(c.property)));
    // A visually hidden control (e.g. a custom checkbox) shows focus on its label or sibling instead.
    const target = tiny(element) ? list.find((w) => w.on !== 'element' && !w.on.startsWith('ancestor') && changes.some((c) => c.on.startsWith(w.on)))?.el : element;
    return {
      element,
      description: describe(element),
      focused,
      focusVisible: focused && element.matches(':focus-visible'),
      visible: focused && changes.length > 0,
      weak: changes.length > 0 && !strong,
      changes,
      obscured: focused && target ? obscured(target) : null,
    };
  } finally {
    style.remove();
    element.blur();
    if (previous && previous !== document.body) previous.focus?.();
  }
}

/**
 * Check every tabbable element under `root`. `exclude` is a selector for elements to skip.
 * @returns {Promise<{results, skipped, failures, warnings}>}
 */
export async function auditFocusVisible({ root = defaultRoot(), exclude } = {}) {
  const results = [];
  const skipped = [];
  for (const el of tabbableElements(root)) {
    if (exclude && el.closest(exclude)) continue;
    // Focusing earlier elements can hide later ones (e.g. a menu that closes on focusout), as it would with Tab.
    if (!el.isConnected || !isVisible(el)) {
      skipped.push({ element: el, description: describe(el), reason: 'hidden after focusing an earlier element' });
      continue;
    }
    results.push(await focusIndicator(el));
  }
  return {
    results,
    skipped,
    failures: results.filter((r) => !r.visible || r.obscured),
    warnings: results.filter((r) => r.visible && !r.obscured && r.weak),
  };
}

function problem(r) {
  if (!r.focused) return 'did not receive focus';
  if (!r.visible) return 'no visible focus indicator (2.4.7 Focus Visible)';
  if (r.obscured) return `focused element is hidden, ${r.obscured} (2.4.11 Focus Not Obscured)`;
  return `only ${[...new Set(r.changes.map((c) => c.property))].join(', ')} change on focus; check the change has 3:1 contrast (1.4.11)`;
}

/**
 * Throw if any tabbable element under `root` has no visible focus indicator or is fully hidden when focused.
 * `strict: true` also fails color-only indicators. Resolves to `{ warnings }` (color-only indicators to review).
 */
export async function a11yFocusAudit({ root, exclude, strict = false } = {}) {
  const { failures, warnings } = await auditFocusVisible({ root, exclude });
  const bad = strict ? [...failures, ...warnings] : failures;
  if (bad.length) throw new Error(`Focus audit found ${bad.length} problem(s):\n${bad.map((r) => `  - ${r.description}: ${problem(r)}`).join('\n')}`);
  return { warnings: warnings.map((r) => `${r.description}: ${problem(r)}`) };
}

/** Throw unless `target` (an element or selector) shows a visible, unobscured focus indicator. */
export async function assertFocusVisible(target, { strict = false } = {}) {
  const el = typeof target === 'string' ? (defaultRoot().querySelector(target) ?? document.querySelector(target)) : target;
  if (!el) throw new Error(`assertFocusVisible: no element matches ${target}`);
  const r = await focusIndicator(el);
  if (!r.visible || r.obscured || (strict && r.weak)) throw new Error(`${r.description}: ${problem(r)}`);
  return r;
}
