// Components rendered by the HDS showcase e2e test. Each case gets its own generated test module.
// Native, ARIA and HDS variants of each pattern must pass; the `fails` cases are deliberately broken
// and list the generated tests that must catch them.
const HDS = { importPath: '@hashicorp/design-system-components/components', namedExport: true };
const wrap = (pattern, html) => `<div data-test-${pattern}>\n${html.trim().replace(/^/gm, '  ')}\n</div>`;
const c = (id, pattern, html, extra = {}) => ({ id, pattern, invocation: wrap(pattern, html), ...extra });

export const AXE = 'passes axe-core audit';
export const STRUCTURE = 'exposes APG roles, states and properties';

export const cases = [
  // Disclosure
  c('disclosure-button', 'disclosure', `<button type="button" aria-expanded="false" aria-controls="dp1">Details</button>\n<div id="dp1" hidden>More</div>`),
  c('disclosure-details-summary', 'disclosure', `<details><summary>Details</summary><p>More</p></details>`),
  c('disclosure-hds-reveal', 'disclosure', `<HdsReveal @text="Show more">Additional content</HdsReveal>`, HDS),
  c('disclosure-hds-dropdown', 'disclosure', `<HdsDropdown as |D|>\n  <D.ToggleButton @text="Actions" />\n  <D.Interactive @href="#">Edit</D.Interactive>\n</HdsDropdown>`, HDS),
  c('disclosure-no-expanded-state', 'disclosure', `<button type="button">Details</button>`, { fails: [STRUCTURE] }),

  // Switch
  c('switch-button-aria-checked', 'switch', `<button type="button" role="switch" aria-checked="false">Wi-Fi</button>`),
  c('switch-checkbox-role', 'switch', `<input type="checkbox" role="switch" id="sw1" checked>\n<label for="sw1">Wi-Fi</label>`),
  c('switch-checkbox-switch-attribute', 'switch', `<input type="checkbox" switch id="sw2">\n<label for="sw2">Wi-Fi</label>`),
  c('switch-fieldset-group', 'switch', `<fieldset>\n  <legend>Notifications</legend>\n  <input type="checkbox" role="switch" id="sw3"><label for="sw3">Email</label>\n  <input type="checkbox" role="switch" id="sw4"><label for="sw4">SMS</label>\n</fieldset>`),
  c('switch-aria-group', 'switch', `<div role="group" aria-labelledby="swg">\n  <span id="swg">Notifications</span>\n  <button type="button" role="switch" aria-checked="true">Email</button>\n  <button type="button" role="switch" aria-checked="false">SMS</button>\n</div>`),
  c('switch-hds-toggle-field', 'switch', `<HdsFormToggleField as |F|><F.Label>Notifications</F.Label></HdsFormToggleField>`, HDS),
  c('switch-hds-toggle-group', 'switch', `<HdsFormToggleGroup as |G|>\n  <G.Legend>Settings</G.Legend>\n  <G.ToggleField as |F|><F.Label>Email</F.Label></G.ToggleField>\n  <G.ToggleField as |F|><F.Label>SMS</F.Label></G.ToggleField>\n</HdsFormToggleGroup>`, HDS),
  c('switch-missing-checked', 'switch', `<button type="button" role="switch">Wi-Fi</button>`, { fails: [AXE, STRUCTURE] }),

  // Checkbox
  c('checkbox-native', 'checkbox', `<input type="checkbox" id="cb1"><label for="cb1">Subscribe</label>`),
  c('checkbox-wrapping-label', 'checkbox', `<label><input type="checkbox"> Subscribe</label>`),
  c('checkbox-aria-mixed', 'checkbox', `<div role="checkbox" aria-checked="mixed" tabindex="0">All toppings</div>`),
  c('checkbox-hds-group', 'checkbox', `<HdsFormCheckboxGroup as |G|>\n  <G.Legend>Toppings</G.Legend>\n  <G.CheckboxField as |F|><F.Label>Cheese</F.Label></G.CheckboxField>\n</HdsFormCheckboxGroup>`, HDS),
  c('checkbox-unlabelled', 'checkbox', `<input type="checkbox">`, { fails: [AXE, STRUCTURE] }),

  // Radio group
  c('radio-native-fieldset', 'radio', `<fieldset>\n  <legend>Size</legend>\n  <input type="radio" name="size" id="r1" checked><label for="r1">Small</label>\n  <input type="radio" name="size" id="r2"><label for="r2">Large</label>\n</fieldset>`),
  c('radio-aria-radiogroup', 'radio', `<div role="radiogroup" aria-label="Size">\n  <div role="radio" aria-checked="true" tabindex="0">Small</div>\n  <div role="radio" aria-checked="false" tabindex="-1">Large</div>\n</div>`),
  c('radio-hds-group', 'radio', `<HdsFormRadioGroup @name="size" as |G|>\n  <G.Legend>Size</G.Legend>\n  <G.RadioField @value="s" as |F|><F.Label>Small</F.Label></G.RadioField>\n  <G.RadioField @value="l" as |F|><F.Label>Large</F.Label></G.RadioField>\n</HdsFormRadioGroup>`, HDS),
  c('radio-ungrouped', 'radio', `<input type="radio" name="sz" id="r3"><label for="r3">Small</label>\n<input type="radio" name="sz" id="r4"><label for="r4">Large</label>`, { fails: [STRUCTURE] }),

  // Tabs
  c('tabs-aria', 'tabs', `<div role="tablist" aria-label="Account">\n  <button type="button" role="tab" id="t1" aria-selected="true" aria-controls="p1">Overview</button>\n  <button type="button" role="tab" id="t2" aria-selected="false" aria-controls="p2" tabindex="-1">Settings</button>\n</div>\n<div role="tabpanel" id="p1" aria-labelledby="t1" tabindex="0">Overview content</div>\n<div role="tabpanel" id="p2" aria-labelledby="t2" tabindex="0" hidden>Settings content</div>`),
  c('tabs-hds', 'tabs', `<HdsTabs as |T|>\n  <T.Tab>Overview</T.Tab>\n  <T.Tab>Settings</T.Tab>\n  <T.Panel>Overview content</T.Panel>\n  <T.Panel>Settings content</T.Panel>\n</HdsTabs>`, HDS),
  c('tabs-no-selected-state', 'tabs', `<div role="tablist" aria-label="Account">\n  <button type="button" role="tab" id="t3" aria-controls="p3">Overview</button>\n</div>\n<div role="tabpanel" id="p3" aria-labelledby="t3">Overview content</div>`, { fails: [STRUCTURE] }),

  // Accordion
  c('accordion-heading-button', 'accordion', `<h3><button type="button" aria-expanded="true" aria-controls="a1">Shipping</button></h3>\n<div id="a1">Ships in 2 days.</div>`),
  c('accordion-with-regions', 'accordion', `<h3><button type="button" id="ab2" aria-expanded="true" aria-controls="a2">Shipping</button></h3>\n<div id="a2" role="region" aria-labelledby="ab2">Ships in 2 days.</div>`),
  c('accordion-hds-title-tag', 'accordion', `<HdsAccordion as |A|>\n  <A.Item @titleTag="h3">\n    <:toggle>Shipping</:toggle>\n    <:content>Ships in 2 days.</:content>\n  </A.Item>\n</HdsAccordion>`, HDS),
  // HDS defaults @titleTag to "div"; APG requires each header to be a heading, so the generated test flags it.
  c('accordion-hds-default-title-tag', 'accordion', `<HdsAccordion as |A|>\n  <A.Item>\n    <:toggle>Shipping</:toggle>\n    <:content>Ships in 2 days.</:content>\n  </A.Item>\n</HdsAccordion>`, { ...HDS, fails: [STRUCTURE] }),
  c('accordion-no-heading', 'accordion', `<button type="button" aria-expanded="false" aria-controls="a3">Shipping</button>\n<div id="a3" hidden>Ships in 2 days.</div>`, { fails: [STRUCTURE] }),

  // Modal dialog
  c('dialog-aria-modal', 'dialog-modal', `<div role="dialog" aria-modal="true" aria-labelledby="dh1">\n  <h2 id="dh1">Delete project</h2>\n  <button type="button">Cancel</button>\n</div>`),
  c('dialog-hds-modal', 'dialog-modal', `<HdsModal as |M|>\n  <M.Header>Delete project</M.Header>\n  <M.Body>This cannot be undone.</M.Body>\n</HdsModal>`, HDS),
  c('dialog-unnamed-non-modal', 'dialog-modal', `<div role="dialog"><button type="button">Close</button></div>`, { fails: [AXE, STRUCTURE] }),

  // Combobox and listbox
  c('combobox-native-select', 'combobox', `<label for="cs1">Country</label>\n<select id="cs1"><option>Canada</option><option>Mexico</option></select>`),
  c('combobox-aria-listbox-popup', 'combobox', `<label for="cb2">Country</label>\n<input id="cb2" type="text" role="combobox" aria-expanded="false" aria-controls="cl2" aria-autocomplete="list">\n<ul id="cl2" role="listbox" aria-label="Countries" hidden><li role="option" aria-selected="false">Canada</li></ul>`),
  c('combobox-hds-select-field', 'combobox', `<HdsFormSelectField as |F|>\n  <F.Label>Country</F.Label>\n  <F.Options><option>Canada</option><option>Mexico</option></F.Options>\n</HdsFormSelectField>`, HDS),
  c('listbox-native-multiple', 'listbox', `<label for="ls1">Toppings</label>\n<select id="ls1" multiple><option>Cheese</option><option>Olives</option></select>`),
  c('listbox-aria', 'listbox', `<ul role="listbox" aria-label="Toppings" tabindex="0">\n  <li role="option" aria-selected="true">Cheese</li>\n  <li role="option" aria-selected="false">Olives</li>\n</ul>`),

  // Button and link
  c('button-native', 'button', `<button type="button">Save</button>`),
  c('button-input-submit', 'button', `<input type="submit" value="Save">`),
  c('button-aria-toggle', 'button', `<div role="button" tabindex="0" aria-pressed="false">Bold</div>`),
  c('button-hds', 'button', `<HdsButton @text="Save" />`, HDS),
  c('button-icon-only-unnamed', 'button', `<button type="button"><svg aria-hidden="true" width="16" height="16"></svg></button>`, { fails: [AXE, STRUCTURE] }),
  c('link-native', 'link', `<a href="/docs">Docs</a>`),
  c('link-hds-standalone', 'link', `<HdsLinkStandalone @text="Docs" @icon="arrow-right" @href="/docs" />`, HDS),

  // Structure
  c('table-native', 'table', `<table>\n  <caption>Products</caption>\n  <thead><tr><th>Name</th><th>Color</th></tr></thead>\n  <tbody><tr><td>Vault</td><td>Yellow</td></tr></tbody>\n</table>`),
  c('table-aria', 'table', `<div role="table" aria-label="Products">\n  <div role="row"><span role="columnheader">Name</span></div>\n  <div role="row"><span role="cell">Vault</span></div>\n</div>`),
  c('table-hds', 'table', `<HdsTable @caption="Products">\n  <:head as |H|><H.Tr><H.Th>Name</H.Th></H.Tr></:head>\n  <:body as |B|><B.Tr><B.Td>Vault</B.Td></B.Tr></:body>\n</HdsTable>`, HDS),
  c('grid-native-table', 'grid', `<table role="grid" aria-label="Products">\n  <tr><th>Name</th></tr>\n  <tr><td tabindex="0">Vault</td></tr>\n</table>`),
  // Links need a 24x24px target (WCAG 2.2 2.5.8); axe flags unstyled, tightly stacked links.
  c('breadcrumb-native', 'breadcrumb', `<nav aria-label="Breadcrumb">\n  <ol style="display: flex; gap: 8px; list-style: none">\n    <li><a href="/" style="display: inline-block; min-height: 24px; padding: 4px">Home</a></li>\n    <li><a href="/docs" aria-current="page" style="display: inline-block; min-height: 24px; padding: 4px">Docs</a></li>\n  </ol>\n</nav>`),
  c('breadcrumb-small-targets', 'breadcrumb', `<nav aria-label="Breadcrumb">\n  <ol><li><a href="/">Home</a></li><li><a href="/docs" aria-current="page">Docs</a></li></ol>\n</nav>`, { fails: [AXE] }),
  c('breadcrumb-hds', 'breadcrumb', `<HdsBreadcrumb>\n  <HdsBreadcrumbItem @text="Home" @href="/" />\n  <HdsBreadcrumbItem @text="Docs" @current={{true}} />\n</HdsBreadcrumb>`, HDS),
  c('menubar-aria', 'menubar', `<ul role="menubar" aria-label="Main">\n  <li role="none"><a role="menuitem" href="/a">About</a></li>\n  <li role="none"><a role="menuitem" href="/b" tabindex="-1">Blog</a></li>\n</ul>`),
  c('treeview-aria', 'treeview', `<ul role="tree" aria-label="Files">\n  <li role="treeitem" aria-expanded="true" aria-selected="false">src\n    <ul role="group"><li role="treeitem" aria-selected="false">index.js</li></ul>\n  </li>\n</ul>`),

  // Range widgets
  c('slider-native-range', 'slider', `<label for="sl1">Volume</label>\n<input type="range" id="sl1" min="0" max="10" value="3">`),
  c('slider-aria', 'slider', `<span id="sl2">Volume</span>\n<div role="slider" tabindex="0" aria-labelledby="sl2" aria-valuenow="3" aria-valuemin="0" aria-valuemax="10"></div>`),
  c('slider-missing-value', 'slider', `<span id="sl3">Volume</span>\n<div role="slider" tabindex="0" aria-labelledby="sl3"></div>`, { fails: [AXE, STRUCTURE] }),
  c('meter-native', 'meter', `<label for="m1">Disk usage</label>\n<meter id="m1" min="0" max="100" value="40">40%</meter>`),
  c('meter-aria', 'meter', `<div role="meter" aria-label="Disk usage" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100">40%</div>`),
];
