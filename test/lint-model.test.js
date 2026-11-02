import { describe, expect, test } from 'vitest';
import { preprocess } from '@glimmer/syntax';
import { buildTree, classifyTag, effectiveRole, explicitRole, implicitRole, isDisabled, isFocusable, isNativelyInteractive, isTabbable, matchRow, pathText, roleTokens, UNKNOWN } from '../lib/lint/model.js';

const tree = (src) => buildTree(preprocess(src, { mode: 'codemod' }));
const first = (src) => tree(src).all[0];
const last = (src) => tree(src).all.at(-1);
const U = 'UNKNOWN';
const show = (v) => (v === UNKNOWN ? U : v);

describe('classifyTag', () => {
  test.each([
    [':title', 'named-block'],
    ['Foo', 'component'],
    ['@foo', 'component'],
    ['foo.bar', 'component'],
    ['Foo::Bar', 'component'],
    ['this.foo', 'component'],
    ['my-el', 'custom'],
    ['div', 'html'],
  ])('%s', (tag, kind) => expect(classifyTag(tag)).toBe(kind));
});

describe('El', () => {
  test('attributes', () => {
    const el = first('<div ID="a" class="b" aria-label="x" @arg="y" ...attributes {{on "CLICK" this.go}} {{action this.x}} onfocus="z"></div>');
    expect(el.hasSplattributes).toBe(true);
    expect(el.has('id')).toBe(true);
    expect(el.has('@arg')).toBe(false);
    expect(el.has('...attributes')).toBe(false);
    expect(el.value('id')).toBe('a');
    expect(el.value('nope')).toBeNull();
    expect(el.get('nope')).toBeNull();
    expect(el.ariaAttrs().map((a) => a.name)).toEqual(['aria-label']);
    expect([...el.eventNames()].sort()).toEqual(['click', 'focus']);
    expect(el.modifiers.map((m) => m.name)).toEqual(['on', 'action']);
    expect(el.args().map((a) => [a.name, a.value, a.path])).toEqual([['@arg', 'y', null]]);
  });

  test('values', () => {
    expect(first('<div a={{this.x}}></div>').value('a')).toBe(UNKNOWN);
    expect(first('<div a="{{this.x}}b"></div>').get('a').kind).toBe('dynamic');
    expect(first('<div a="x{{"y"}}"></div>').get('a').kind).toBe('dynamic');
    expect(first('<div a></div>').value('a')).toBe('');
    expect(first('<div a={{"s"}}></div>').value('a')).toBe('s');
    expect(first('<div a={{1}}></div>').value('a')).toBe('1');
    expect(first('<div a={{true}}></div>').value('a')).toBe('true');
    expect(first('<div a={{null}}></div>').get('a').kind).toBe('dynamic');
    expect(first('<div a={{if this.x "p" "q"}}></div>').get('a').possibleValues).toEqual(['p', 'q']);
    expect(first('<div a={{unless this.x "p"}}></div>').get('a').possibleValues).toEqual(['p']);
    expect(first('<div a={{unless this.x "p" "q"}}></div>').get('a').possibleValues).toEqual(['p', 'q']);
    expect(first('<div a={{if this.x "p" this.y}}></div>').get('a').possibleValues).toBeUndefined();
    expect(first('<div a={{if this.x}}></div>').get('a').possibleValues).toBeUndefined();
    expect(first('<div a={{foo "p" "q"}}></div>').get('a').possibleValues).toBeUndefined();
    expect(first('<div a={{(helper)}}></div>').get('a').kind).toBe('dynamic');
  });

  test('isHtml, kind, snippet', () => {
    expect(first('<div></div>').isHtml).toBe(true);
    expect(first('<my-el></my-el>').isHtml).toBe(true);
    expect(first('<Foo />').isHtml).toBe(false);
    expect(first('<Foo />').kind).toBe('component');
    expect(first('<DIV></DIV>').lowerTag).toBe('div');
    expect(first('<div   class="a"\n   id="b"></div>').snippet).toBe('<div class="a" id="b">');
    const long = first(`<div class="${'x'.repeat(200)}"></div>`).snippet;
    expect(long).toHaveLength(158);
    expect(long.endsWith('…')).toBe(true);
    expect(first('<div></div>').loc.start.line).toBe(1);
  });

  test('ancestors, children, content', () => {
    const t = tree('<ul><li>a{{"lit"}}{{this.x}}{{yield}}{{#if c}}<b></b>{{/if}}<i></i></li></ul>');
    const [ul, li, b, i] = t.all;
    expect(t.roots).toEqual([ul]);
    expect(li.ancestors()).toEqual([ul]);
    expect(b.ancestors()).toEqual([li, ul]);
    expect(ul.children).toEqual([li]);
    expect(li.children).toEqual([b, i]);
    expect(li.content.map((c) => c.type)).toEqual(['text', 'text', 'dynamic', 'yield', 'dynamic', 'element']);
    expect(li.content[0].text).toBe('a');
    expect(li.content[1].text).toBe('lit');
    expect(li.content[4].block).toBe(true);
    expect(b.inBlock).toBe(true);
    expect(i.inBlock).toBe(false);
    expect(li.inBlock).toBe(false);
    expect(ul.parent).toBeNull();
    expect(t.ctx.all).toBe(t.all);
  });

  test('inBlock inherits to descendants and conditions are recorded', () => {
    const t = tree('{{#if this.a}}<div><p></p></div>{{else}}<span></span>{{/if}}<em></em>');
    const [div, p, span, em] = t.all;
    expect(div.inBlock).toBe(true);
    expect(p.inBlock).toBe(true);
    expect(span.inBlock).toBe(true);
    expect(em.inBlock).toBe(false);
    expect(div.conditions).toEqual(['if this.a']);
    expect(span.conditions).toEqual(['else if this.a']);
    expect(em.conditions).toEqual([]);
    expect(tree('{{#foo}}<b></b>{{/foo}}').all[0].conditions).toEqual(['foo']);
  });

  test('ctx ids and labels', () => {
    const t = tree('<input id="a"><label for="a"></label><div id="b"></div>');
    expect([...t.ctx.ids.keys()]).toEqual(['a', 'b']);
    expect(t.ctx.labelsFor.has('a')).toBe(true);
    expect(t.ctx.hasDynamicIds).toBe(false);
    expect(tree('<div id={{this.x}}></div>').ctx.hasDynamicIds).toBe(true);
    expect(tree('<div id=""></div>').ctx.hasDynamicIds).toBe(true);
    expect(tree('<label for={{this.x}}></label>').ctx.hasDynamicIds).toBe(true);
    expect(tree('<label for="a"></label>').ctx.hasDynamicIds).toBe(false);
    expect(tree('<div for={{this.x}}></div>').ctx.hasDynamicIds).toBe(false);
    expect(tree('<div></div>', {}).ctx.script).toBe('');
  });
});

describe('pathText', () => {
  const m = (src) => preprocess(src, { mode: 'codemod' }).body[0];
  test('forms', () => {
    expect(pathText(null)).toBe('');
    expect(pathText(m('{{this.x}}'))).toBe('this.x');
    expect(pathText(m('{{fn this.a "b"}}'))).toBe('fn this.a b');
    expect(pathText(m('{{(fn this.a)}}').path)).toBe('fn this.a');
    expect(pathText(m('<div a="x{{this.y}}z"></div>').attributes[0].value)).toBe('xthis.yz');
    expect(pathText(m('<div a="x"></div>').attributes[0].value)).toBe('');
    expect(pathText(m('{{1}}').path)).toBe('');
    expect(pathText(m('{{foo (bar)}}'))).toBe('foo bar');
  });
});

describe('roles', () => {
  test('roleTokens', () => {
    expect(roleTokens(first('<div></div>'))).toEqual({ status: 'none', tokens: [] });
    expect(roleTokens(first('<div role="  Button  LINK "></div>'))).toEqual({ status: 'static', tokens: ['button', 'link'] });
    expect(roleTokens(first('<div role=""></div>'))).toEqual({ status: 'static', tokens: [] });
    expect(roleTokens(first('<div role={{this.r}}></div>'))).toEqual({ status: 'dynamic', tokens: [], possibleValues: undefined });
    expect(roleTokens(first('<div role={{if this.r "a" "b"}}></div>')).possibleValues).toEqual(['a', 'b']);
  });

  test.each([
    ['<div></div>', null],
    ['<div role="button"></div>', 'button'],
    ['<div role="BUTTON"></div>', 'button'],
    ['<div role="bogus button"></div>', 'button'],
    ['<div role="bogus"></div>', null],
    ['<div role="command"></div>', null],
    ['<div role=""></div>', null],
    ['<div role={{this.r}}></div>', U],
  ])('explicitRole %s', (src, want) => expect(show(explicitRole(first(src)))).toBe(want));

  test.each([
    ['<button></button>', 'button'],
    ['<a href="x"></a>', 'link'],
    ['<a></a>', 'generic'],
    ['<div></div>', 'generic'],
    ['<nav></nav>', 'navigation'],
    ['<ul></ul>', 'list'],
    ['<h2></h2>', 'heading'],
    ['<input type="checkbox">', 'checkbox'],
    ['<input type="text">', 'textbox'],
    ['<input type="text" list="l">', 'combobox'],
    ['<input type={{this.t}}>', U],
    ['<input type="bogus">', 'textbox'],
    ['<input type=" RADIO ">', 'radio'],
    ['<img alt="x">', 'img'],
    ['<img alt="">', 'presentation'],
    ['<img>', 'img'],
    ['<img alt="" aria-label="x">', 'img'],
    ['<img alt="" title="x">', 'img'],
    ['<img alt="" aria-labelledby="x">', 'img'],
    ['<select></select>', 'combobox'],
    ['<select multiple></select>', 'listbox'],
    ['<select size="2"></select>', 'listbox'],
    ['<select size="1"></select>', 'combobox'],
    ['<select size={{this.s}}></select>', U],
    ['<select multiple={{this.m}}></select>', U],
    ['<Foo />', null],
    ['<my-el></my-el>', U],
    ['<section></section>', 'generic'],
    ['<section aria-label="x"></section>', 'region'],
    ['<section aria-labelledby="x"></section>', 'region'],
    ['<section title="x"></section>', 'region'],
    ['<header></header>', 'banner'],
    ['<article><header></header></article>', 'generic'],
    ['<main><footer></footer></main>', 'generic'],
    ['<div role="article"><header></header></div>', 'generic'],
    ['<div role="main"><footer></footer></div>', 'generic'],
    ['<div><header></header></div>', 'banner'],
    ['<footer></footer>', 'contentinfo'],
    ['<aside><header></header></aside>', 'generic'],
    ['<nav><header></header></nav>', 'generic'],
    ['<section><header></header></section>', 'generic'],
    ['<ul><li></li></ul>', 'listitem'],
    ['<ol><li></li></ol>', 'listitem'],
    ['<div><li></li></div>', 'generic'],
    ['<li></li>', 'listitem'],
    ['<div role="list"><li></li></div>', 'listitem'],
    ['<Foo><li></li></Foo>', 'listitem'],
    ['<my-el><li></li></my-el>', 'listitem'],
    ['<div role={{this.r}}><li></li></div>', 'listitem'],
    ['<table></table>', 'table'],
    ['<td></td>', 'cell'],
    ['<td></td>', 'cell'],
    ['<form></form>', 'form'],
    ['<td></td>', 'cell'],
  ])('implicitRole %s', (src, want) => expect(show(implicitRole(last(src)))).toBe(want));

  test.each([
    ['<div role="button"></div>', 'button'],
    ['<div role="none"></div>', 'none'],
    ['<div role="presentation"></div>', 'presentation'],
    ['<button role="none"></button>', 'button'],
    ['<button role="presentation"></button>', 'button'],
    ['<div role="none" tabindex="0"></div>', 'generic'],
    ['<div role="none" tabindex="-1"></div>', 'generic'],
    ['<div role="none" aria-label="x"></div>', 'generic'],
    ['<div role="presentation" aria-describedby="x"></div>', 'generic'],
    ['<div role="none" aria-hidden="true"></div>', 'none'],
    ['<div role="none" aria-live="polite"></div>', 'generic'],
    ['<div role="none" aria-owns="x"></div>', 'generic'],
    ['<div role="none" aria-controls="x"></div>', 'generic'],
    ['<div role="none" aria-details="x"></div>', 'generic'],
    ['<div role="none" aria-keyshortcuts="x"></div>', 'generic'],
    ['<div role="none" aria-roledescription="x"></div>', 'generic'],
    ['<div role="none" aria-labelledby="x"></div>', 'generic'],
    ['<div role="button" tabindex="0"></div>', 'button'],
    ['<div role="bogus"></div>', 'generic'],
    ['<div role={{this.r}}></div>', U],
    ['<Foo role="button" />', U],
    ['<div></div>', 'generic'],
  ])('effectiveRole %s', (src, want) => expect(show(effectiveRole(first(src)))).toBe(want));
});

describe('matchRow', () => {
  test('non-html and unknown tags', () => {
    expect(matchRow(first('<Foo />'))).toBeNull();
    expect(matchRow(first('<blink></blink>'))).toBeNull();
    expect(matchRow(first('<div></div>')).id).toBe('el-div');
    expect(matchRow(first('<input type="text" list="x">')).id).toBe('el-input-text-list');
    expect(show(matchRow(first('<input type={{this.t}}>')))).toBe(U);
  });
});

describe('focus', () => {
  test.each([
    ['<div></div>', false],
    ['<div tabindex="0"></div>', true],
    ['<div tabindex="-1"></div>', false],
    ['<div tabindex="1"></div>', true],
    ['<div tabindex=" 0 "></div>', true],
    ['<div tabindex=""></div>', false],
    ['<div tabindex="x"></div>', false],
    ['<div tabindex={{this.t}}></div>', U],
    ['<button></button>', true],
    ['<button tabindex="-1"></button>', false],
    ['<button disabled></button>', false],
    ['<button disabled={{this.d}}></button>', U],
    ['<button disabled tabindex="0"></button>', true],
    ['<select></select>', true],
    ['<textarea></textarea>', true],
    ['<iframe></iframe>', true],
    ['<summary></summary>', true],
    ['<details></details>', false],
    ['<a></a>', false],
    ['<a href="x"></a>', true],
    ['<area href="x">', true],
    ['<area>', false],
    ['<input>', true],
    ['<input type="hidden">', false],
    ['<input type="text">', true],
    ['<input type={{this.t}}>', true],
    ['<input disabled>', false],
    ['<fieldset disabled></fieldset>', false],
    ['<div disabled></div>', false],
    ['<audio></audio>', false],
    ['<audio controls></audio>', true],
    ['<video controls></video>', true],
    ['<video></video>', false],
    ['<div contenteditable></div>', true],
    ['<div contenteditable="true"></div>', true],
    ['<div contenteditable="false"></div>', false],
    ['<div contenteditable={{this.c}}></div>', false],
    ['<Foo />', U],
    ['<my-el></my-el>', false],
    ['<my-el tabindex="0"></my-el>', true],
  ])('isTabbable %s', (src, want) => expect(show(isTabbable(first(src)))).toBe(want));

  test.each([
    ['<div></div>', false],
    ['<div tabindex="-1"></div>', true],
    ['<div tabindex="0"></div>', true],
    ['<div tabindex=""></div>', false],
    ['<div tabindex="  "></div>', false],
    ['<div tabindex="x"></div>', false],
    ['<div tabindex={{this.t}}></div>', false],
    ['<button></button>', true],
    ['<button disabled></button>', false],
    ['<button disabled tabindex="-1"></button>', true],
  ])('isFocusable %s', (src, want) => expect(isFocusable(first(src))).toBe(want));

  test.each([
    ['<button disabled></button>', true],
    ['<input disabled>', true],
    ['<select disabled></select>', true],
    ['<textarea disabled></textarea>', true],
    ['<fieldset disabled></fieldset>', true],
    ['<optgroup disabled></optgroup>', true],
    ['<option disabled></option>', true],
    ['<button disabled={{this.d}}></button>', false],
    ['<button></button>', false],
    ['<a disabled></a>', false],
    ['<div disabled></div>', false],
  ])('isDisabled %s', (src, want) => expect(isDisabled(first(src))).toBe(want));

  test.each([
    ['<button></button>', true],
    ['<select></select>', true],
    ['<textarea></textarea>', true],
    ['<summary></summary>', true],
    ['<details></details>', true],
    ['<option></option>', true],
    ['<label></label>', true],
    ['<input>', true],
    ['<input type="hidden">', false],
    ['<input type="text">', true],
    ['<a href="x"></a>', true],
    ['<a></a>', false],
    ['<area href="x">', true],
    ['<area>', false],
    ['<audio controls></audio>', true],
    ['<video controls></video>', true],
    ['<audio></audio>', false],
    ['<video></video>', false],
    ['<div></div>', false],
    ['<iframe></iframe>', false],
  ])('isNativelyInteractive %s', (src, want) => expect(isNativelyInteractive(first(src))).toBe(want));
});
