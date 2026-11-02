// Runs test-support/focus.js in real Chrome: the helper relies on computed styles, :focus-visible and
// elementFromPoint, which jsdom doesn't implement. Skipped if Chrome can't be launched.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { afterAll, describe, expect, test } from 'vitest';

let browser = null;
let skip = null;
try {
  browser = await chromium.launch({ channel: process.env.PW_CHROME_CHANNEL ?? 'chrome' });
} catch (error) {
  skip = `Chrome could not be launched: ${error.message.split('\n')[0]}`;
  // A silent skip in CI would hide a broken oracle, so fail there.
  if (process.env.CI) throw new Error(skip);
  console.warn(`[focus] skipped: ${skip}`);
}
afterAll(() => browser?.close());

const HELPER = readFileSync(new URL('../../test-support/focus.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAGE_SCRIPT = `${HELPER}\nwindow.F = { tabbableElements, focusIndicator, auditFocusVisible, a11yFocusAudit, assertFocusVisible };`;

async function open(html, css = '') {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title><style>${css}</style></head><body><main>${html}</main></body></html>`);
  await page.addScriptTag({ content: PAGE_SCRIPT });
  return page;
}

// Summarize focusIndicator() for one selector.
const check = (page, selector) =>
  page.evaluate(async (s) => {
    const r = await window.F.focusIndicator(document.querySelector(s));
    return { visible: r.visible, weak: r.weak, obscured: r.obscured, on: [...new Set(r.changes.map((c) => `${c.on}:${c.property.replace(/-(top|right|bottom|left).*$|-(style|width|color|offset)$/, '')}`))] };
  }, selector);

describe.skipIf(skip)('focus visibility helper (Chrome)', () => {
  test("detects the browser's default focus ring", async () => {
    const page = await open('<button>Save</button>');
    expect(await check(page, 'button')).toMatchObject({ visible: true, weak: false, obscured: null, on: ['element:outline'] });
  });

  test('fails when the outline is removed with no replacement', async () => {
    const page = await open('<button>Save</button>', 'button:focus { outline: none; }');
    expect(await check(page, 'button')).toMatchObject({ visible: false, on: [] });
    const err = await page.evaluate(() => window.F.a11yFocusAudit({ root: document.body }).then(() => null, (e) => e.message));
    expect(err).toContain('<button> "Save": no visible focus indicator (2.4.7 Focus Visible)');
  });

  test('accepts replacement indicators: box-shadow, ::after, label of a hidden input, :focus-within, ::file-selector-button', async () => {
    const page = await open(
      `<button id="shadow">A</button>
       <a id="pseudo" href="#">B</a>
       <input id="cb" type="checkbox" class="sr-only"><label for="cb">C</label>
       <div class="field"><input id="text" aria-label="D"></div>
       <input id="file" type="file" aria-label="E">`,
      `*:focus { outline: none; }
       #shadow:focus-visible { box-shadow: 0 0 0 3px blue; }
       #pseudo { position: relative; } #pseudo:focus-visible::after { content: ''; position: absolute; inset: -2px; border: 2px solid; }
       .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
       #cb:focus-visible + label { outline: 2px solid; }
       .field:focus-within { outline: 2px solid; }
       #file:focus-within::file-selector-button { outline: 2px solid; }`,
    );
    expect(await check(page, '#shadow')).toMatchObject({ visible: true, weak: false, on: ['element:box-shadow'] });
    expect((await check(page, '#pseudo')).on).toContain('element::after:content');
    expect(await check(page, '#cb')).toMatchObject({ visible: true, weak: false, obscured: null });
    expect((await check(page, '#cb')).on).toEqual(expect.arrayContaining(['label:outline']));
    expect((await check(page, '#text')).on).toEqual(['ancestor 1:outline']);
    expect(await check(page, '#file')).toMatchObject({ visible: true, weak: false, on: ['element::file-selector-button:outline'] });
  });

  test('marks color-only indicators as weak (warning, or failure with strict)', async () => {
    const page = await open('<button>Save</button>', 'button { outline: none; background: white; } button:focus { background: #eee; }');
    expect(await check(page, 'button')).toMatchObject({ visible: true, weak: true, on: ['element:background'] });
    const result = await page.evaluate(() => window.F.a11yFocusAudit({ root: document.body }));
    expect(result.warnings[0]).toMatch(/only background-color change on focus; check the change has 3:1 contrast/);
    const strict = await page.evaluate(() => window.F.a11yFocusAudit({ root: document.body, strict: true }).then(() => null, (e) => e.message));
    expect(strict).toContain('1 problem(s)');
  });

  test('reports a focused element hidden under a fixed header (2.4.11)', async () => {
    const page = await open('<header>Site</header><button>Under</button>', 'header { position: fixed; top: 0; left: 0; right: 0; height: 80px; background: #fff; } main { padding-top: 10px; }');
    expect((await check(page, 'button')).obscured).toBe('covered by <header> "Site"');
  });

  test('uses :focus-visible styles even after a mouse click', async () => {
    const page = await open('<button id="a">A</button><button id="b">B</button>', 'button:focus { outline: none; } button:focus-visible { outline: 2px solid; }');
    await page.click('#a');
    expect(await check(page, '#b')).toMatchObject({ visible: true, on: ['element:outline'] });
  });

  test('lists tabbable elements in focus order', async () => {
    const page = await open(`
      <button id="t0">0</button>
      <button id="dis" disabled>x</button>
      <button id="neg" tabindex="-1">x</button>
      <button id="hid" hidden>x</button>
      <div inert><button id="inert">x</button></div>
      <input type="hidden" id="h">
      <a id="nohref">x</a>
      <input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2" checked>
      <div id="t2" tabindex="2">2</div><div id="t1" tabindex="1">1</div>
      <details><summary id="sum">S</summary></details>
      <iframe id="frame" srcdoc="<button>in frame</button>"></iframe>`);
    expect(await page.evaluate(() => window.F.tabbableElements(document.body).map((e) => e.id))).toEqual(['t1', 't2', 't0', 'r2', 'sum']);
  });

  test('skips elements hidden by focusing an earlier one, as Tab would', async () => {
    const page = await open(
      '<div id="menu"><a href="#" id="one">One</a><a href="#" id="two">Two</a></div>',
      'a:focus-visible { outline: 2px solid; }',
    );
    await page.evaluate(() => document.querySelector('#menu').addEventListener('focusout', (e) => (e.currentTarget.hidden = true)));
    const r = await page.evaluate(() => window.F.auditFocusVisible({ root: document.body }).then((a) => ({ checked: a.results.map((x) => x.element.id), skipped: a.skipped.map((x) => x.element.id), failures: a.failures.length })));
    expect(r).toEqual({ checked: ['one'], skipped: ['two'], failures: 0 });
  });

  test('assertFocusVisible accepts a selector and restores focus', async () => {
    const page = await open('<button id="a">A</button><button id="b">B</button>', '#b:focus { outline: none; }');
    await page.focus('#a');
    expect(await page.evaluate(() => window.F.assertFocusVisible('#a').then(() => 'ok'))).toBe('ok');
    expect(await page.evaluate(() => window.F.assertFocusVisible('#b').then(() => null, (e) => e.message))).toContain('no visible focus indicator');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('a');
  });
});
