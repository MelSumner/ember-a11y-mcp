// Uses Chrome's accessibility tree (via Playwright + the Chrome DevTools Protocol) as an oracle for the
// approximations this package makes without a browser:
//   1. the role selectors, accessible-name and state helpers embedded in generated tests;
//   2. the accessible-name lint rule;
//   3. native state readers after real keyboard input (not synthetic events).
// Uses the installed Google Chrome (channel "chrome"), so no browser download is needed. Skipped if Chrome
// can't be launched.
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { apgTestSpec, specRoles } from '../../lib/apg-test-spec.js';
import { getRole } from '../../lib/data/index.js';
import { lintTemplate } from '../../lib/lint/index.js';
import { roleSelector } from '../../lib/role-selectors.js';
import { GENERATED_HELPERS } from '../../lib/tools.js';
import { cases } from './showcase-cases.js';

let browser = null;
let skip = null;
try {
  browser = await chromium.launch({ channel: process.env.PW_CHROME_CHANNEL ?? 'chrome' });
} catch (error) {
  skip = `Chrome could not be launched: ${error.message.split('\n')[0]}`;
  // A silent skip in CI would hide a broken oracle, so fail there.
  if (process.env.CI) throw new Error(skip);
  console.warn(`[browser] skipped: ${skip}`);
}

// Every role and state the generated tests check.
const specs = Object.values(apgTestSpec);
const TRACKED = [...new Set(specs.flatMap((s) => [...specRoles(s), ...[...(s.states ?? []), ...(s.optionalStates ?? [])].map((x) => x.role)]))].sort();
const REQUIRED_STATES = {};
for (const s of specs) for (const st of s.states ?? []) (REQUIRED_STATES[st.role] ??= new Set()).add(st.attr);

// Chrome-internal role names → ARIA roles.
const CHROME_ALIASES = { DisclosureTriangle: 'button', MenuListOption: 'option', MenuListPopup: 'listbox' };
// Known, documented differences between Chrome and the selectors (which follow ARIA in HTML / HTML-AAM).
const KNOWN_ROLE_DIFFERENCES = [
  // The HTML switch attribute is only implemented in Safari; Chrome exposes a plain checkbox.
  { selector: 'input[type="checkbox" i][switch]', ours: 'switch', chrome: 'checkbox' },
];
const AX_STATE = { checked: 'aria-checked', expanded: 'aria-expanded', selected: 'aria-selected', disabled: 'aria-disabled', modal: 'aria-modal', level: 'aria-level', pressed: 'aria-pressed' };
const VALUE_ROLES = new Set(['slider', 'meter', 'progressbar', 'spinbutton', 'scrollbar']);

const PAGE_SCRIPT = `
const ROLE_SELECTORS = ${JSON.stringify(Object.fromEntries(TRACKED.map((r) => [r, roleSelector(r)])))};
const NAME_FROM_CONTENTS = new Set(${JSON.stringify(TRACKED.filter((r) => getRole(r)?.nameFrom?.includes('contents')))});
${GENERATED_HELPERS}
window.__ours = (el) => {
  const roles = Object.keys(ROLE_SELECTORS).filter((r) => el.matches(ROLE_SELECTORS[r]));
  const states = {};
  for (const a of ${JSON.stringify(['aria-valuenow', ...Object.values(AX_STATE)])}) states[a] = stateOf(el, a);
  return { roles, names: Object.fromEntries(roles.map((r) => [r, accessibleName(el, r)])), states };
};`;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function open(html) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title></head><body><main>${html}</main></body></html>`);
  await page.addScriptTag({ content: PAGE_SCRIPT });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  return { page, cdp };
}

/** Our view and Chrome's view of every element inside <main> (or matching `selector`). */
async function inspect({ page, cdp }, selector = 'main *') {
  const count = await page.evaluate((sel) => (window.__els = [...document.querySelectorAll(sel)]).length, selector);
  const out = [];
  for (let i = 0; i < count; i++) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__els[${i}]` });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const ax = nodes[0];
    const info = await page.evaluate((i) => {
      const el = window.__els[i];
      return { html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 90), ...window.__ours(el), explicitRole: el.hasAttribute('role'), ariaAttrs: el.getAttributeNames().filter((a) => a.startsWith('aria-')), known: el.matches('input[type="checkbox" i][switch]') ? 'switch-attr' : null };
    }, i);
    const role = ax.ignored ? null : CHROME_ALIASES[ax.role?.value] ?? ax.role?.value;
    const props = Object.fromEntries((ax.properties ?? []).map((p) => [p.name, p.value.value]));
    out.push({ ...info, ax: { role, name: norm(ax.name?.value), props, value: ax.value?.value } });
  }
  return out;
}

function compare(elements, label) {
  const problems = [];
  for (const e of elements) {
    if (!e.ax.role) continue;
    const known = KNOWN_ROLE_DIFFERENCES.find((k) => e.known === 'switch-attr' && k.ours === 'switch' && e.ax.role === k.chrome);
    const ours = known ? e.roles.filter((r) => r !== known.ours) : e.roles;
    if (TRACKED.includes(e.ax.role) && !ours.includes(e.ax.role) && !known) problems.push(`${label}: Chrome role "${e.ax.role}" not matched by ROLE_SELECTORS: ${e.html}`);
    for (const r of ours) if (r !== e.ax.role) problems.push(`${label}: selectors say "${r}", Chrome says "${e.ax.role}": ${e.html}`);
    // Generated tests assert that roles requiring a name have one, so compare presence (exact text can
    // legitimately differ, e.g. Chrome omits a treeitem's nested group from its name).
    for (const r of ours.filter((x) => getRole(x)?.nameRequired)) {
      if (Boolean(norm(e.names[r])) !== Boolean(e.ax.name)) problems.push(`${label}: name for ${r} is "${norm(e.names[r])}", Chrome computes "${e.ax.name}": ${e.html}`);
    }
    // Chrome fills in defaults (checked=false, valuenow=50, ...) for explicit roles missing a required state;
    // those are authoring errors the generated tests should report, not values to read.
    const chromeDefault = (attr) => e.explicitRole && !e.ariaAttrs.includes(attr);
    const role = known ? known.chrome : e.ax.role;
    for (const [prop, attr] of Object.entries(AX_STATE)) {
      const chrome = e.ax.props[prop];
      const ourValue = e.states[attr];
      if (ourValue !== null && chrome !== undefined && String(chrome) !== ourValue) problems.push(`${label}: ${attr} is "${ourValue}", Chrome says "${chrome}": ${e.html}`);
      if (ourValue === null && chrome !== undefined && REQUIRED_STATES[role]?.has(attr) && !chromeDefault(attr)) problems.push(`${label}: ${attr} not read, Chrome says "${chrome}": ${e.html}`);
    }
    if (VALUE_ROLES.has(role) && e.ax.value !== undefined && !chromeDefault('aria-valuenow') && e.states['aria-valuenow'] !== String(e.ax.value)) problems.push(`${label}: aria-valuenow is "${e.states['aria-valuenow']}", Chrome says "${e.ax.value}": ${e.html}`);
  }
  return problems;
}

const unwrap = (invocation) => invocation.replace(/^<div data-test-[\w-]+>\n|\n<\/div>$/g, '').replace(/^ {2}/gm, '');
const inline = cases.filter((c) => !c.importPath);

// Each fixture has one target (data-t) whose role requires a name. [html, hasName]
const NAME_FIXTURES = [
  ['<button data-t>Save</button>', true],
  ['<button data-t aria-label="Close"><svg aria-hidden="true"></svg></button>', true],
  ['<button data-t><img src="x.png" alt="Search"></button>', true],
  ['<span id="l1">Email</span><input data-t aria-labelledby="l1">', true],
  ['<span id="l2" hidden>Email</span><input data-t aria-labelledby="l2">', true],
  ['<label for="e1">Email</label><input data-t id="e1">', true],
  ['<label>Email <input data-t></label>', true],
  ['<input data-t title="Search">', true],
  // Chrome names it from the placeholder, but the ruleset fails placeholder-only labels by policy.
  ['<input data-t placeholder="Search">', true, { policyError: true }],
  ['<textarea data-t aria-label="Notes"></textarea>', true],
  ['<select data-t aria-label="Country"><option>Canada</option></select>', true],
  ['<label for="r1">Volume</label><input data-t id="r1" type="range">', true],
  ['<img data-t src="x.png" alt="Logo">', true],
  ['<a data-t href="/"><img src="x.png" alt="Home"></a>', true],
  ['<a data-t href="/" title="Home"><svg aria-hidden="true"></svg></a>', true],
  ['<input data-t type="submit">', true],
  ['<input data-t type="reset">', true],
  ['<input data-t type="button" value="Go">', true],
  ['<input data-t type="image" src="x.png" alt="Go">', true],
  ['<div data-t role="dialog" aria-labelledby="h1"><h2 id="h1">Delete</h2></div>', true],
  ['<iframe data-t title="Map" src="about:blank"></iframe>', true],
  ['<div data-t role="checkbox" aria-checked="false" tabindex="0">Agree</div>', true],
  ['<button data-t></button>', false],
  ['<button data-t><svg aria-hidden="true"></svg></button>', false],
  ['<button data-t aria-label="   "></button>', false],
  ['<input data-t>', false],
  ['<input data-t type="button">', false],
  ['<a data-t href="/"><img src="x.png" alt=""></a>', false],
  ['<select data-t><option>Canada</option></select>', false],
  ['<div data-t role="dialog"><button>Close</button></div>', false],
  ['<iframe data-t src="about:blank"></iframe>', false],
  ['<div data-t role="checkbox" aria-checked="false" tabindex="0"></div>', false],
  ['<div data-t role="slider" aria-valuenow="1" tabindex="0"></div>', false],
];

describe.skipIf(skip)('Chrome accessibility tree as an oracle', () => {
  afterAll(async () => browser?.close());

  describe('generated-test helpers agree with Chrome', () => {
    test.each(inline.map((c) => [c.id, c]))('%s', async (_, c) => {
      const p = await open(unwrap(c.invocation));
      try {
        expect(compare(await inspect(p), c.id)).toEqual([]);
      } finally {
        await p.page.close();
      }
    });

    test('every role selector is valid CSS in Chrome', async () => {
      const p = await open('');
      const invalid = await p.page.evaluate(() => Object.entries(ROLE_SELECTORS).filter(([, sel]) => { try { document.querySelector(sel); return false; } catch { return true; } }).map(([r]) => r));
      await p.page.close();
      expect(invalid).toEqual([]);
    });
  });

  describe('accessible-name lint rule agrees with Chrome', () => {
    test.each(NAME_FIXTURES)('%s', async (html, hasName, { policyError = false } = {}) => {
      const p = await open(html);
      const [target] = await inspect(p, '[data-t]');
      await p.page.close();
      const flagged = lintTemplate(html, { filename: 't.hbs' }).some((f) => f.ruleId === 'accessible-name' && f.severity === 'error' && f.snippet.includes('data-t'));
      expect({ chromeName: Boolean(target.ax.name), lintFlags: flagged }).toEqual({ chromeName: hasName, lintFlags: !hasName || policyError });
    });
  });

  describe('native state readers after real keyboard input', () => {
    const scenarios = [
      ['details/summary Enter', '<details><summary>Details</summary><p>More</p></details>', async (page) => { await page.focus('summary'); await page.keyboard.press('Enter'); }, 'summary', { 'aria-expanded': 'true' }],
      ['checkbox Space', '<input type="checkbox" id="c1"><label for="c1">Subscribe</label>', async (page) => { await page.focus('input'); await page.keyboard.press('Space'); }, 'input', { 'aria-checked': 'true' }],
      ['switch checkbox Space', '<input type="checkbox" role="switch" id="s1"><label for="s1">Wi-Fi</label>', async (page) => { await page.focus('input'); await page.keyboard.press('Space'); }, 'input', { 'aria-checked': 'true' }],
      ['radio ArrowDown', '<fieldset><legend>Size</legend><input type="radio" name="s" id="r1" checked><label for="r1">Small</label><input type="radio" name="s" id="r2"><label for="r2">Large</label></fieldset>', async (page) => { await page.focus('#r1'); await page.keyboard.press('ArrowDown'); }, '#r2', { 'aria-checked': 'true' }],
      ['range ArrowRight', '<label for="v1">Volume</label><input type="range" id="v1" min="0" max="10" value="3">', async (page) => { await page.focus('input'); await page.keyboard.press('ArrowRight'); }, 'input', { 'aria-valuenow': '4' }],
      ['select typeahead', '<label for="o1">Country</label><select id="o1"><option>Canada</option><option>Mexico</option></select>', async (page) => { await page.focus('select'); await page.keyboard.press('m'); }, 'option:nth-child(2)', { 'aria-selected': 'true' }],
      ['dialog showModal via Enter', '<button type="button" onclick="document.querySelector(\'dialog\').showModal()">Open</button><dialog aria-label="Confirm"><button type="button">OK</button></dialog>', async (page) => { await page.focus('button'); await page.keyboard.press('Enter'); }, 'dialog', { 'aria-modal': 'true' }],
      ['disabled button', '<button type="button" disabled>Save</button>', async () => {}, 'button', { 'aria-disabled': 'true' }],
    ];
    test.each(scenarios)('%s', async (label, html, act, target, expected) => {
      const p = await open(html);
      try {
        await act(p.page);
        const [el] = await inspect(p, target);
        for (const [attr, value] of Object.entries(expected)) expect(el.states[attr], attr).toBe(value);
        expect(compare([el], label)).toEqual([]);
      } finally {
        await p.page.close();
      }
    });
  });
});
