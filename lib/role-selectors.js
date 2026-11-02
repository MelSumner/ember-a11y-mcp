import { htmlAria } from './data/index.js';

// Native elements whose implicit role html-aria describes with a prose condition, expressed as selectors.
const SCOPED = 'article, aside, main, nav, section';
const LISTBOX_SELECT = 'select:is([multiple], [size]:not([size="0"], [size="1"]))';
const NATIVE_OVERRIDES = {
  region: ['section:is([aria-label], [aria-labelledby])'],
  form: ['form:is([aria-label], [aria-labelledby], [title])'],
  banner: [`header:not(:is(${SCOPED}) header)`],
  contentinfo: [`footer:not(:is(${SCOPED}) footer)`],
  listbox: [LISTBOX_SELECT, 'datalist'],
  combobox: [`select:not(${LISTBOX_SELECT.slice(6)})`, 'input:is(:not([type]), [type="text" i], [type="search" i], [type="tel" i], [type="url" i], [type="email" i])[list]'],
  option: [':is(select, datalist, optgroup) option'],
  listitem: [':is(ul, ol, menu) > li'],
  cell: ['td:not(:is(table[role~="grid"], table[role~="treegrid"]) td)'],
  gridcell: [':is(table[role~="grid"], table[role~="treegrid"]) td'],
  columnheader: ['th:not([scope="row" i])'],
  rowheader: ['th[scope="row" i]'],
  row: ['tr'],
};

// Accepted alternatives that ARIA in HTML does not list as implicit roles.
const NATIVE_EXTRAS = {
  // HTML-AAM exposes the first <summary> of <details> as the disclosure button.
  button: ['details > summary:first-of-type'],
  // HTML's switch attribute (Safari) renders a native switch.
  switch: ['input[type="checkbox" i][switch]'],
};

function rowSelector(match) {
  return match.tags.flatMap((tag) => {
    const attrs = Object.entries(match.attrs ?? {}).map(([a, v]) => (v === true ? `[${a}]` : v === false ? `:not([${a}])` : '')).join('');
    if (!match.inputTypes) return [`${tag}${attrs}`];
    return match.inputTypes.map((t) => (t === '' ? `${tag}:not([type])${attrs}` : `${tag}[type="${t}" i]${attrs}`));
  });
}

let cache;
function nativeSelectors() {
  if (cache) return cache;
  cache = {};
  for (const row of htmlAria().elements) {
    if (!row.implicitRole || !row.match.tags || NATIVE_OVERRIDES[row.implicitRole]) continue;
    (cache[row.implicitRole] ??= []).push(...rowSelector(row.match));
  }
  for (const [role, sels] of Object.entries(NATIVE_OVERRIDES)) cache[role] = [...sels];
  for (const [role, sels] of Object.entries(NATIVE_EXTRAS)) (cache[role] ??= []).push(...sels);
  return cache;
}

/** CSS selector matching elements with `role`, explicitly or as a native element without a role attribute. */
export function roleSelector(role) {
  const native = [...new Set(nativeSelectors()[role] ?? [])];
  const explicit = `[role~="${role}"]`;
  return native.length ? `${explicit}, :is(${native.join(', ')}):not([role])` : explicit;
}
