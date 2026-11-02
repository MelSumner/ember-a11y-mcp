/**
 * Curated Ember-specific implementation notes per APG pattern. APG content itself comes
 * from data/apg.json; this file adds the "how do I do this in Ember" layer.
 */

const FOCUS_MODIFIER = `Move focus with a small modifier rather than DOM queries in actions, e.g.
\`\`\`js
// app/modifiers/focus-when.js (ember-modifier)
import { modifier } from 'ember-modifier';
export default modifier((el, [shouldFocus]) => { if (shouldFocus) el.focus(); });
\`\`\``;

const ROVING = `Roving tabindex: track the active index in a @tracked property, render tabindex={{if (eq i this.activeIndex) "0" "-1"}}, and call .focus() on the newly active element in the keydown handler (or via a modifier).`;

export const patternGuidance = {
  accordion: {
    native: 'For simple show/hide sections, <details><summary> needs no ARIA or JS. Use the APG accordion when you need heading semantics or single-open behavior.',
    ember: [
      'Wrap each header button in the appropriate heading level (<h3><button type="button" aria-expanded={{if open "true" "false"}} aria-controls={{panelId}}>).',
      'Generate panelId/headerId per item with {{unique-id}} (Ember 5.2+) or guidFor so multiple accordions do not collide.',
      'Panels may use role="region" with aria-labelledby={{headerId}} only when there are few (≤6) panels.',
      'Toggle state in a tracked property / TrackedMap; don\'t remove the button from the DOM when expanded.',
    ],
  },
  alert: {
    native: 'role="alert" on a container that already exists in the DOM; inject the message text into it.',
    ember: [
      'Render the live region container unconditionally (outside {{#if}}) and change only its contents; regions inserted with content already inside are often not announced.',
      'Prefer role="status" (polite) for non-urgent messages such as "Saved".',
      'Don\'t move focus to alerts; never auto-dismiss critical alerts.',
    ],
  },
  alertdialog: {
    native: '<dialog> opened with showModal() plus role="alertdialog".',
    ember: [
      'Call dialogEl.showModal() from a modifier ({{did-insert}} or a custom modifier) so the browser handles inertness, Escape and focus containment.',
      'Set aria-labelledby/aria-describedby with ids from {{unique-id}}.',
      'Focus the least destructive action initially (autofocus on that button is fine when the dialog has no form fields; otherwise autofocus the first field).',
      'Return focus to the triggering element on close (store document.activeElement before opening).',
    ],
  },
  breadcrumb: {
    native: '<nav aria-label="Breadcrumb"><ol><li><LinkTo>…</LinkTo></li></ol></nav>',
    ember: ['<LinkTo> does not set aria-current (it only adds an "active" class). Mark the last crumb yourself: aria-current="page" on its link, or render it as plain text.', 'Use the same aria-label on every page.'],
  },
  button: {
    native: '<button type="button"> — always prefer it over role="button".',
    ember: [
      'Always set type="button" unless the button submits a form (the default type is submit).',
      'Toggle buttons: aria-pressed={{if this.on "true" "false"}}; keep the label constant.',
      'Use {{on "click"}} on the <button>; keyboard activation (Enter/Space) is then free.',
      'For disabled-but-discoverable buttons use aria-disabled="true" and guard the handler, instead of disabled.',
    ],
  },
  carousel: {
    native: 'No native element; consider whether a carousel is needed at all.',
    ember: [
      'Provide a pause/rotation control as the first focusable element; stop rotation on focus/hover (WCAG 2.2.2).',
      'Use a cancelable timer (ember-concurrency task or @ember/runloop with teardown in willDestroy) so it stops when the component is destroyed.',
      'Slides: role="group" aria-roledescription="slide" aria-label="1 of 5". Set aria-live="off" while rotating, "polite" when stopped.',
    ],
  },
  checkbox: {
    native: '<input type="checkbox"> with a <label>. Set mixed state via the indeterminate property (use a modifier: el.indeterminate = value).',
    ember: ['Bind checked={{this.value}} and {{on "change"}}; don\'t also set aria-checked on a native checkbox.', 'Group related checkboxes in <fieldset><legend>.'],
  },
  combobox: {
    native: '<select> for a fixed list, or <input list> + <datalist> for simple suggestions. Build a custom combobox only when necessary.',
    ember: [
      'Input: role="combobox" aria-expanded aria-controls={{listboxId}} aria-autocomplete="list" and aria-activedescendant={{this.activeOptionId}} — DOM focus stays on the input.',
      'Each option needs a stable id (derive from a {{unique-id}} prefix + index).',
      'Announce result counts through a persistent role="status" region.',
      'Close on Escape and on focusout (check event.relatedTarget against the component element).',
      'Battle-tested addon: ember-power-select. Still audit its output.',
    ],
  },
  'dialog-modal': {
    native: '<dialog> opened with showModal() provides modality, Escape, top-layer and focus containment.',
    ember: [
      FOCUS_MODIFIER,
      'Use showModal() in a modifier and dialog.close() on teardown so route transitions don\'t leave a stuck modal.',
      'If you cannot use <dialog>, use ember-focus-trap and mark the rest of the app inert.',
      'Label with aria-labelledby pointing at the dialog heading (ids from {{unique-id}}).',
      'Return focus to the opener on close.',
    ],
  },
  disclosure: {
    native: '<details><summary> — no ARIA or JS required.',
    ember: ['Custom version: <button type="button" aria-expanded={{if this.open "true" "false"}} aria-controls={{id}}> and toggle the panel with {{#if}} or the hidden attribute.'],
  },
  feed: {
    native: 'No native element.',
    ember: ['Set aria-busy="true" on the feed while loading more articles (e.g. while an ember-concurrency task is running).', 'Each article: role="article" tabindex="0" aria-posinset/aria-setsize, aria-labelledby the title.'],
  },
  grid: {
    native: '<table> for static tabular data. Use role="grid" only for interactive, keyboard-navigable cells.',
    ember: [ROVING, 'Keep one tab stop for the whole grid; arrow keys move between cells.', 'Use aria-rowcount/aria-rowindex when virtualizing rows (e.g. vertical-collection).'],
  },
  landmarks: {
    native: '<header>, <nav>, <main>, <aside>, <footer>, <form aria-label>, <section aria-labelledby>.',
    ember: [
      'Put a single <main> in application.hbs/.gjs and render {{outlet}} inside it.',
      'Label repeated landmarks (two <nav>s) with distinct aria-label values.',
      'Ember route transitions do not move focus or announce the page. Use ember-a11y-refocus (<NavigationNarrator/> announces the change, moves focus to its message and adds a skip link to <main id="main">) or move focus to the new h1 yourself, and update the title (ember-page-title).',
    ],
  },
  link: {
    native: '<a href> or <LinkTo>. Never use role="link" on a non-anchor.',
    ember: ['Use <LinkTo> for routes; it renders <a href>. It adds an "active" class but not aria-current, so set aria-current="page" yourself where the current page matters (navigation, breadcrumbs), e.g. from a getter using the router service isActive().', 'Link text must describe the destination; avoid "click here".', 'For actions (no navigation) use <button type="button">.'],
  },
  listbox: {
    native: '<select> or <select multiple>.',
    ember: [ROVING, 'Alternatively keep focus on the listbox and use aria-activedescendant.', 'Set aria-selected on every option; aria-multiselectable on the listbox for multi-select.'],
  },
  'menu-button': {
    native: 'For site navigation use a disclosure (button + list of links), not role="menu".',
    ember: [
      'Reserve role="menu" for application-style command menus.',
      'Button: aria-haspopup="menu" aria-expanded aria-controls. Down Arrow/Enter/Space open and focus the first item.',
      'Return focus to the button on Escape or after activation.',
      ROVING,
    ],
  },
  menubar: {
    native: 'Site navigation should be <nav> with links and disclosures, not a menubar.',
    ember: [ROVING, 'Only one menubar item is tabbable at a time.'],
  },
  meter: {
    native: '<meter min max value> — no ARIA needed.',
    ember: ['If using role="meter", set aria-valuenow/min/max and aria-valuetext when the number alone is unclear.'],
  },
  radio: {
    native: '<fieldset><legend> with <input type="radio" name> — browser provides arrow-key behavior.',
    ember: ['Share a name between radios (generate with {{unique-id}}).', 'Custom role="radiogroup" needs roving tabindex and aria-checked on each role="radio".'],
  },
  slider: {
    native: '<input type="range"> with a <label>.',
    ember: ['Custom slider: role="slider" tabindex="0" aria-valuenow/min/max, aria-valuetext for formatted values, arrows/Home/End/PageUp/PageDown.', 'Update aria-valuenow from tracked state on every change.'],
  },
  'slider-multithumb': {
    native: 'Two <input type="range"> elements with distinct labels.',
    ember: ['Each thumb is its own role="slider" with its own label; update the other thumb\'s aria-valuemin/max as values change.'],
  },
  spinbutton: {
    native: '<input type="number"> (or type="text" inputmode="numeric" with validation).',
    ember: ['Custom: role="spinbutton" aria-valuenow/min/max, Up/Down arrows, keep the text input editable.'],
  },
  switch: {
    native: '<button type="button" role="switch" aria-checked> or <input type="checkbox" role="switch">.',
    ember: ['Bind aria-checked={{if this.on "true" "false"}}; keep the label constant ("Notifications"), not "On/Off".'],
  },
  table: {
    native: '<table> with <caption>, <th scope>. Only use role="table" for non-table layouts.',
    ember: ['Sortable columns: put a <button> in the <th> and set aria-sort on the <th> (only on the sorted column).', 'Use <caption> or aria-labelledby for the table name.'],
  },
  tabs: {
    native: 'No native tabs element.',
    ember: [
      ROVING,
      'role="tablist" (with aria-label) > role="tab" (aria-selected, aria-controls, tabindex roving); panels role="tabpanel" aria-labelledby tab id, tabindex="0" if no focusable content.',
      'Decide automatic vs manual activation; with routed tabs (<LinkTo>) consider a nav + aria-current instead of the tab pattern.',
    ],
  },
  toolbar: {
    native: 'No native element.',
    ember: [ROVING, 'role="toolbar" with aria-label; only use when there are 3+ controls.'],
  },
  tooltip: {
    native: 'Prefer visible text or aria-describedby with a persistent hint; title is not keyboard-accessible.',
    ember: [
      'Tooltip element: role="tooltip" id={{tooltipId}}; trigger aria-describedby={{tooltipId}}.',
      'Show on focus and hover, hide on Escape, keep it hoverable (WCAG 1.4.13).',
      'Never put interactive content in a tooltip; use a non-modal dialog/popover instead.',
    ],
  },
  treegrid: {
    native: 'No native element.',
    ember: [ROVING, 'Set aria-level/aria-setsize/aria-posinset on rows when rendering a flattened or virtualized tree.', 'aria-expanded on parent rows only.'],
  },
  treeview: {
    native: 'Nested <ul> of links/disclosures is often sufficient for navigation trees.',
    ember: [ROVING, 'Recursive components: pass @level and render aria-level={{@level}}; set aria-expanded only on parent nodes.'],
  },
  windowsplitter: {
    native: 'No native element.',
    ember: ['role="separator" tabindex="0" aria-valuenow/min/max aria-controls the primary pane; arrow keys resize; Enter collapses/restores.'],
  },
};

export const emberGeneral = [
  { topic: 'Route transitions', text: 'Ember SPA transitions do not move focus or announce the new page. Use ember-a11y-refocus (<NavigationNarrator/> announces the new page, moves focus to that message and adds a skip link to <main id="main">) or move focus to the new page h1 (tabindex="-1") yourself, and update document.title (ember-page-title).' },
  { topic: 'Unique IDs', text: 'Components render many times. Generate ids with the built-in {{unique-id}} helper (Ember 5.2+), e.g. {{#let (unique-id) as |id|}}<label for={{id}}>…<input id={{id}}>{{/let}}, or guidFor(this) in a class.' },
  { topic: 'Event handling', text: 'Attach handlers with {{on "click"}} to native interactive elements. A click handler on a <div> is not keyboard accessible.' },
  { topic: '...attributes', text: 'Place ...attributes on the element that should receive aria-* and role from callers (usually the interactive element), and document required attributes such as aria-label for icon-only buttons.' },
  { topic: 'Testing', text: 'Use ember-a11y-testing (await a11yAudit()) in rendering/acceptance tests, plus keyboard tests with triggerKeyEvent and focus assertions (assert.dom(el).isFocused()). Automated checks find only part of WCAG issues; test with a screen reader too.' },
  { topic: 'Linting', text: 'Use ember-template-lint "recommended" (its a11y rules) in CI alongside this server\'s audit_ember_template tool.' },
  { topic: 'Live regions', text: 'Render live regions (role="status"/"alert", aria-live) unconditionally and update their text; a region inserted along with its content is often not announced.' },
  { topic: 'Destructive actions', text: 'Deleting, purging or permanently dismissing something (e.g. an alert with "don\'t show again") must ask for confirmation first: a modal confirmation (<HdsModal @color="critical"> or <dialog role="alertdialog"> that names the item and consequence, with initial focus on the least destructive button), an inline "Are you sure?" step ({{#if this.isConfirming}} with Confirm/Cancel, focus moved to it), or window.confirm(). Making the action reversible with Undo is an alternative (WCAG 3.3.4). Checked by the destructive-action-confirmation lint rule.' },
  { topic: 'Forms', text: 'Every control needs a programmatic label. Associate errors with aria-describedby (and aria-invalid="true"), and move focus to the first invalid field or an error summary on submit.' },
];
