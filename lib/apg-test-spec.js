// What a generated test asserts for each APG pattern, written from the "WAI-ARIA Roles, States, and
// Properties" section of each pattern. APG often allows more than one conformant structure, so:
//   required:    every group must be present; any one role in a group satisfies it
//                (e.g. menubar: "a role of either `menu` or `menubar`").
//   conditional: roles APG uses only in some variants (optional groupings, popups that render on open,
//                alternative containers). Absence is fine; when present they must still be valid.
//   states:      states APG requires on a role. Native equivalents are accepted at runtime (see
//                stateOf in the generated test), e.g. `checked` for aria-checked on <input type=checkbox>.
// Roles are matched natively or explicitly (lib/role-selectors.js), so <button> satisfies "button".
// test/apg-test-spec.test.js checks that every role APG lists for a pattern is covered here.

const BOOL = ['true', 'false'];
const TRISTATE = ['true', 'false', 'mixed'];
const NUMBER = 'number';

export const apgTestSpec = {
  accordion: {
    required: [['button'], ['heading']],
    conditional: ['region'],
    states: [{ role: 'button', attr: 'aria-expanded', values: BOOL }],
    notes: ['Panels may use role="region" (named by their header button) but APG makes it optional; avoid it when there are many panels.'],
  },
  alert: { required: [['alert']], conditional: [] },
  alertdialog: {
    required: [['alertdialog']],
    conditional: [],
    states: [{ role: 'alertdialog', attr: 'aria-modal', values: ['true'] }],
    notes: ['A <dialog role="alertdialog"> opened with showModal() is modal without aria-modal.'],
  },
  breadcrumb: {
    required: [['navigation']],
    conditional: ['list', 'listitem', 'link'],
    notes: ['The current page may be a link with aria-current="page" or plain text.'],
  },
  button: {
    required: [['button']],
    conditional: [],
    optionalStates: [{ role: 'button', attr: 'aria-pressed', values: TRISTATE, why: 'toggle buttons' }],
  },
  carousel: {
    required: [['region', 'group']],
    conditional: ['group', 'tabpanel', 'tablist', 'tab'],
    notes: ['The container is a region or a group. Slides are groups with aria-roledescription="slide", or tabpanels in tabbed carousels.'],
  },
  checkbox: {
    required: [['checkbox']],
    conditional: ['group'],
    states: [{ role: 'checkbox', attr: 'aria-checked', values: TRISTATE }],
    notes: ['A set of checkboxes may be grouped with role="group" + aria-labelledby or with <fieldset> + <legend>.'],
  },
  combobox: {
    required: [['combobox']],
    conditional: ['listbox', 'tree', 'grid', 'dialog'],
    states: [{ role: 'combobox', attr: 'aria-expanded', values: BOOL }],
    notes: ['The popup (listbox, tree, grid or dialog) may only be in the DOM while expanded; open it and re-run the role checks.', 'A native <select> is a combobox (or a listbox when it has multiple or size > 1).'],
  },
  'dialog-modal': {
    required: [['dialog']],
    conditional: [],
    states: [{ role: 'dialog', attr: 'aria-modal', values: ['true'] }],
    notes: ['A <dialog> opened with showModal() is modal without aria-modal.'],
  },
  disclosure: {
    required: [['button']],
    conditional: [],
    states: [{ role: 'button', attr: 'aria-expanded', values: BOOL }],
    notes: ['A <details>/<summary> pair is a native alternative: summary acts as the button and details[open] is its expanded state.'],
  },
  feed: { required: [['feed'], ['article']], conditional: [] },
  grid: {
    required: [['grid'], ['row'], ['gridcell', 'columnheader', 'rowheader']],
    conditional: ['rowgroup'],
    notes: ['A <table role="grid"> gets row and cell semantics from tr/td/th.'],
  },
  landmarks: {
    required: [],
    conditional: ['banner', 'main', 'navigation', 'contentinfo', 'complementary', 'region', 'search', 'form'],
    notes: ['<section> and <form> are landmarks only when named; <header>/<footer> only outside article/aside/main/nav/section.'],
  },
  link: { required: [['link']], conditional: [] },
  listbox: {
    required: [['listbox'], ['option']],
    conditional: ['group'],
    notes: ['Selection may be aria-selected or aria-checked (APG allows either for multi-select).'],
  },
  'menu-button': {
    required: [['button']],
    conditional: ['menu'],
    states: [{ role: 'button', attr: 'aria-haspopup', values: ['true', 'menu'] }],
    optionalStates: [{ role: 'button', attr: 'aria-expanded', values: BOOL, why: 'set to true while the menu is open' }],
    notes: ['The menu may only be in the DOM while open.'],
  },
  menubar: {
    required: [['menubar', 'menu'], ['menuitem', 'menuitemcheckbox', 'menuitemradio']],
    conditional: ['menu', 'separator', 'group'],
  },
  meter: {
    required: [['meter']],
    conditional: [],
    states: [{ role: 'meter', attr: 'aria-valuenow', values: NUMBER }],
  },
  radio: {
    required: [['radiogroup', 'group'], ['radio']],
    conditional: [],
    states: [{ role: 'radio', attr: 'aria-checked', values: BOOL }],
    notes: ['Native radios grouped by <fieldset> + <legend> are an alternative to role="radiogroup".'],
  },
  slider: {
    required: [['slider']],
    conditional: [],
    states: [{ role: 'slider', attr: 'aria-valuenow', values: NUMBER }],
  },
  'slider-multithumb': {
    required: [['slider']],
    conditional: ['group'],
    states: [{ role: 'slider', attr: 'aria-valuenow', values: NUMBER }],
  },
  spinbutton: {
    required: [['spinbutton']],
    conditional: [],
    optionalStates: [{ role: 'spinbutton', attr: 'aria-valuenow', values: NUMBER, why: 'omitted when the value is empty' }],
  },
  switch: {
    required: [['switch']],
    conditional: ['group'],
    states: [{ role: 'switch', attr: 'aria-checked', values: BOOL }],
    notes: ['<input type="checkbox" role="switch">, <button role="switch" aria-checked> and <input type="checkbox" switch> are all switches.', 'A set of switches may be grouped with role="group" + aria-labelledby or with <fieldset> + <legend>.'],
  },
  table: {
    required: [['table'], ['row'], ['cell', 'columnheader', 'rowheader']],
    conditional: ['rowgroup'],
  },
  tabs: {
    required: [['tablist'], ['tab'], ['tabpanel']],
    conditional: [],
    states: [{ role: 'tab', attr: 'aria-selected', values: BOOL }],
  },
  toolbar: { required: [['toolbar']], conditional: [] },
  tooltip: {
    required: [],
    conditional: ['tooltip'],
    notes: ['Tooltips are usually rendered on hover/focus: focus the trigger, then check role="tooltip" and aria-describedby.'],
  },
  treegrid: {
    required: [['treegrid'], ['row'], ['gridcell', 'columnheader', 'rowheader']],
    conditional: ['rowgroup'],
  },
  treeview: {
    required: [['tree'], ['treeitem']],
    conditional: ['group'],
    notes: ['Child nodes are in role="group" containers or flat with aria-level/aria-setsize/aria-posinset.'],
  },
  windowsplitter: {
    required: [['separator']],
    conditional: [],
    states: [{ role: 'separator', attr: 'aria-valuenow', values: NUMBER }],
  },
};

export const specRoles = (spec) => [...new Set([...spec.required.flat(), ...spec.conditional])];
