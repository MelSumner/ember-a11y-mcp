import { describe, expect, test } from 'vitest';
import { lintTemplate } from '../lib/lint/index.js';

// Table-driven edges of destructive-action-confirmation: how handler bodies are located in the component script,
// which handler names/labels count as destructive, and which template contexts count as a confirmation.
const R = 'destructive-action-confirmation';
const gjs = (body, tpl) => `import Component from '@glimmer/component';\nexport default class X extends Component {\n  ${body}\n  ${tpl.startsWith('<template>') ? tpl : `<template>${tpl}</template>`}\n}`;
const sev = (src) => lintTemplate(src, { filename: 'x.gjs', minSeverity: 'info' }).filter((f) => f.ruleId === R).map((f) => f.severity);
const messages = (src) => lintTemplate(src, { filename: 'x.gjs', minSeverity: 'info' }).filter((f) => f.ruleId === R).map((f) => f.message);
const btn = (h, text = 'Delete', extra = '') => `<button type="button" ${extra} {{on "click" ${h}}}>${text}</button>`;
const CONFIRMED = "if (!confirm('sure?')) return; this.item.destroyRecord();";
const BARE = 'this.item.destroyRecord();';

// [script, template, expected]; the handler is always this.go unless the template says otherwise.
const BODY_FORMS = [
  ['go() { ' + CONFIRMED + ' }', []],
  ['@action go() { ' + CONFIRMED + ' }', []],
  ['@action async go() { ' + CONFIRMED + ' }', []],
  ['async go() { ' + CONFIRMED + ' }', []],
  ['*go() { ' + CONFIRMED + ' }', []],
  ['go = () => { ' + CONFIRMED + ' };', []],
  ['go = async () => { ' + CONFIRMED + ' };', []],
  ['go = async (x) => { ' + CONFIRMED + ' };', []],
  ['go = function () { ' + CONFIRMED + ' };', []],
  ['go = async function () { ' + CONFIRMED + ' };', []],
  ['go = function* () { ' + CONFIRMED + ' };', []],
  ['go = task(async () => { ' + CONFIRMED + ' });', []],
  ['go = task({ drop: true }, async () => { ' + CONFIRMED + ' });', []],
  ['go = task(this, function* () { ' + CONFIRMED + ' });', []],
  ['go = dropTask(function* () { ' + CONFIRMED + ' });', []],
  ['@task *go() { ' + CONFIRMED + ' }', []],
  ['go = task<void>(async () => { ' + CONFIRMED + ' });', []],
  ['go: Task = task(async () => { ' + CONFIRMED + ' });', []],
  ['go: () => void = () => { ' + CONFIRMED + ' };', []],
  ['go(): void { ' + CONFIRMED + ' }', []],
  ['go(): Promise<void> { ' + CONFIRMED + ' }', []],
  ['go = (): void => { ' + CONFIRMED + ' };', []],
  ['go = async (): Promise<void> => { ' + CONFIRMED + ' };', []],
  ['go = () => confirm("sure?") && this.item.destroyRecord();', []],
  ['go = () => this.confirm("sure?");', []],
  ['go = async () => (await this.modal.confirm("x")) && this.item.destroyRecord();', []],
  ['go = () => this.item.destroyRecord();', ['warning']],
  ['go() { ' + BARE + ' }', ['warning']],
  ['go = () => { ' + BARE + ' };', ['warning']],
  ['go = function () { ' + BARE + ' };', ['warning']],
  ['go = task(async () => { ' + BARE + ' });', ['warning']],
  ['go = task({ drop: true }, async () => { ' + BARE + ' });', ['warning']],
  // The confirmation is in a different member, so it must not leak into this body.
  ['go() { ' + BARE + ' } other() { ' + CONFIRMED + ' }', ['warning']],
  ['go() { ' + BARE + ' } other = () => { ' + CONFIRMED + ' };', ['warning']],
  ['go = () => { ' + BARE + ' }; other() { ' + CONFIRMED + ' }', ['warning']],
  ['go = () => ' + BARE.replace(';', '') + '; other = () => { ' + CONFIRMED + ' };', ['warning']],
  ['go = task(async () => { ' + BARE + ' }); other() { ' + CONFIRMED + ' }', ['warning']],
  // string/comment contents with brackets must not unbalance scanning
  ['go() { const s = "}"; ' + CONFIRMED + ' }', []],
  ["go() { const s = '}'; " + CONFIRMED + ' }', []],
  ['go() { const s = `}`; ' + CONFIRMED + ' }', []],
  ['go() { /* } */ ' + CONFIRMED + ' }', []],
  ['go() { // }\n ' + CONFIRMED + ' }', []],
  ['go() { const s = "\\"}"; ' + CONFIRMED + ' }', []],
  ['go() { ' + BARE + ' } other() { const s = "}"; ' + CONFIRMED + ' }', ['warning']],
  // a call, not a definition, of the same name comes first
  ['x() { this.go(); } go() { ' + CONFIRMED + ' }', []],
  ['other() { return go(); } go() { ' + CONFIRMED + ' }', []],
  ['go() { ' + CONFIRMED + ' }', []],
];

describe('destructive: locating handler bodies', () => {
  test.each(BODY_FORMS)('%s', (script, want) => {
    expect(sev(gjs(script, btn('this.go')))).toEqual(want);
  });

  test('unknown handler or missing script', () => {
    expect(sev(gjs('', btn('this.go')))).toEqual(['warning']);
    expect(sev(`<template>${btn('this.go')}</template>`)).toEqual(['warning']);
    expect(sev(gjs('go;', btn('this.go')))).toEqual(['warning']);
    expect(sev(gjs('go = 5;', btn('this.go')))).toEqual(['warning']);
    expect(sev(gjs('x = this.go();', btn('this.go')))).toEqual(['warning']);
  });

  test('member access names do not match', () => {
    expect(sev(gjs('x() { this.go() } other() { this.xgo(); } go() { ' + BARE + ' } xgo() { ' + CONFIRMED + ' }', btn('this.go')))).toEqual(['warning']);
    expect(sev(gjs('$go() { ' + CONFIRMED + ' } go() { ' + BARE + ' }', btn('this.go')))).toEqual(['warning']);
    expect(sev(gjs('$go() { ' + CONFIRMED + ' }', btn('this.$go')))).toEqual([]);
  });

  test('one level of called methods is followed', () => {
    expect(sev(gjs('go() { this.step(); } step() { ' + CONFIRMED + ' }', btn('this.go')))).toEqual([]);
    expect(sev(gjs('go() { this.step.perform(); } step = task(async () => { ' + CONFIRMED + ' });', btn('this.go')))).toEqual([]);
    expect(sev(gjs('go() { this.step.linked().perform(); } step = task(async () => { ' + CONFIRMED + ' });', btn('this.go')))).toEqual([]);
    expect(sev(gjs('go() { this.step.unlinked().perform(); } step = task(async () => { ' + CONFIRMED + ' });', btn('this.go')))).toEqual([]);
    expect(sev(gjs('go() { this.step(); ' + BARE + ' } step() { this.deeper(); } deeper() { ' + CONFIRMED + ' }', btn('this.go')))).toEqual(['warning']);
    expect(sev(gjs('go() { this.step(); ' + BARE + ' } step() { ' + BARE + ' }', btn('this.go')))).toEqual(['warning']);
    expect(sev(gjs('go() { this.go(); ' + BARE + ' }', btn('this.go')))).toEqual(['warning']);
  });
});

const CONFIRM_BODIES = [
  ["confirm('x');", []],
  ["window.confirm('x');", []],
  ["this.modal.confirm('x');", []],
  ["prompt('x');", []],
  ['this.showModal();', []],
  ['this.openDeleteModal();', []],
  ['this.showDeleteDialog();', []],
  ['this.launchConfirmDelete();', []],
  ['this.displayPrompt();', []],
  ['this.modals.open();', []],
  ['this.dialog.show();', []],
  ['this.confirmation.ask();', []],
  ['this.prompts.perform();', []],
  ['this.modal.linked();', []],
  ['this.modal.unlinked();', []],
  ['this.modal.request();', []],
  ['await this.askUser();', []],
  ['await this.confirmIt();', []],
  ['await this.ui.prompter();', []],
  ['this.undo();', []],
  ['// restore later\n', []],
  ['toast("Are you sure");', []],
  ['toast("areyousure");', []],
  ['this.isConfirming = true;', []],
  ['this.showDeleteModal = true;', []],
  ['this.isSure = true;', []],
  ['this.isVerifying = true;', []],
  ['this.armed = true;', []],
  ['this.really = true;', []],
  ['this.prompting = true;', []],
  ['this.hasDialog = true;', []],
  ['this.confirmed = true;', []],
  ['this.confirmation = true;', []],
  ['this.isConfirming = false;', ['warning']],
  ['this.isConfirming = null;', ['warning']],
  ['this.isConfirming = undefined;', ['warning']],
  ['this.isConfirming = 0;', ['warning']],
  ['this.isConfirming = "";', ['warning']],
  ["this.isConfirming = '';", ['warning']],
  ['this.isConfirming = ``;', ['warning']],
  ['this.isConfirming == true;', ['warning']],
  ['this.closeModal = true;', ['warning']],
  ['this.hideModal = true;', ['warning']],
  ['this.dismissModal = true;', ['warning']],
  ['this.isOpen = true;', ['warning']],
  ['this.closeModal();', ['warning']],
  ['this.close();', ['warning']],
  ['this.confirmx = true;', ['warning']],
  ['this.confirmedx();', ['warning']],
  ['modals.close();', ['warning']],
  ['await this.save();', ['warning']],
  ['this.askx();', ['warning']],
  ['this.modalx.open();', ['warning']],
];

describe('destructive: confirmation evidence in the body', () => {
  test.each(CONFIRM_BODIES)('%s', (code, want) => {
    expect(sev(gjs(`go() { ${BARE} ${code} }`, btn('this.go')))).toEqual(want);
  });
});

describe('destructive: delegation', () => {
  test.each([
    ['go() { this.args.onDelete(); }', ['info']],
    ['go() { this.args.onDelete?.(); }', ['info']],
    ['go() { this.args.onDelete.perform(); }', ['info']],
    ['go() { this.args.onDelete.linked().perform(); }', ['info']],
    ['go() { this.args.onDelete.unlinked().perform(); }', ['info']],
    ['go() { this.cb?.(); }', ['info']],
    ['go() { this.cb(); }', ['warning']],
    ['go() { this.args.onDelete(); ' + BARE + ' }', ['warning']],
    ['go() { this.args.destroyIt(); }', ['info']],
    ['go() { this.args.onDelete(); this.api.delete(); }', ['warning']],
  ])('%s', (script, want) => {
    expect(sev(gjs(script, btn('this.go')))).toEqual(want);
  });

  test('handler references', () => {
    expect(messages(gjs('', btn('@onDelete')))[0]).toMatch(/passed in by the caller/);
    expect(messages(gjs('', btn('this.args.onDelete')))[0]).toMatch(/passed in by the caller/);
    expect(messages(`<template><Foo as |F|>${btn('F.delete')}</Foo></template>`)[0]).toMatch(/yielded by an enclosing component/);
    expect(messages(gjs('', btn('this.nope')))[0]).toMatch(/runs without a confirmation step/);
    expect(sev(gjs('', btn('@onDelete')))).toEqual(['info']);
    expect(sev(`<template><Foo as |F|>${btn('F.delete')}</Foo></template>`)).toEqual(['info']);
    expect(sev(gjs('go() { ' + BARE + ' }', btn('(fn this.go 1)')))).toEqual(['warning']);
    expect(sev(gjs('go() { ' + CONFIRMED + ' }', btn('(fn this.go 1)')))).toEqual([]);
    expect(sev(gjs('go() { ' + CONFIRMED + ' }', btn('(action this.go)')))).toEqual([]);
    expect(sev(gjs('go() { ' + CONFIRMED + ' }', btn('(perform this.go)')))).toEqual([]);
    expect(sev(gjs('go() { ' + CONFIRMED + ' }', btn('(queue (prevent-default) this.go)')))).toEqual([]);
    expect(sev(gjs('go() { ' + CONFIRMED + ' }', btn('(optional this.go)')))).toEqual([]);
    expect(sev(gjs('go() { ' + CONFIRMED + ' }', btn('(stop-propagation this.go)')))).toEqual([]);
    expect(sev(gjs('', btn('true')))).toEqual(['warning']);
    expect(sev(gjs('', btn('null')))).toEqual(['warning']);
    expect(sev(gjs('', btn('undefined')))).toEqual(['warning']);
    expect(sev(gjs('', btn('false')))).toEqual(['warning']);
  });

  test('closing companions are ignored when deciding delegation', () => {
    const t = (close) => `<template><button type="button" {{on "click" @onDelete}}>Delete</button><button type="button" {{on "click" ${close}}}>Delete</button></template>`;
    expect(sev(t('dd.close'))).toEqual(['info']);
    expect(sev(t('dd.hide'))).toEqual(['info', 'warning']);
    expect(sev(t('dd.dismiss'))).toEqual(['info', 'warning']);
    expect(sev(t('dd.toggle'))).toEqual(['info']);
  });
});

describe('destructive: which names and labels are destructive', () => {
  test.each([
    ['Delete', 'this.go', ['warning']],
    ['DELETE', 'this.go', ['warning']],
    ['Destroy', 'this.go', ['warning']],
    ['Permanently', 'this.go', ['warning']],
    ['permanent', 'this.go', ['warning']],
    ['Forever', 'this.go', ['warning']],
    ['Purge', 'this.go', ['warning']],
    ['Erase', 'this.go', ['warning']],
    ['Wipe', 'this.go', ['warning']],
    ['Revoke', 'this.go', ['warning']],
    ['Terminate', 'this.go', ['warning']],
    ['Empty trash', 'this.go', ['warning']],
    ['Empty the trash', 'this.go', ['warning']],
    ["Don't show again", 'this.go', ['warning']],
    ['Do not remind me again', 'this.go', ['warning']],
    ['Never show this again', 'this.go', ['warning']],
    ['Undeleted', 'this.go', []],
    ['Remove', 'this.go', ['info']],
    ['Discard', 'this.go', ['info']],
    ['Clear all', 'this.go', ['info']],
    ['Reset', 'this.go', ['info']],
    ['Uninstall', 'this.go', ['info']],
    ['Deactivate', 'this.go', ['info']],
    ['Clear', 'this.go', []],
    ['Save', 'this.go', []],
    ['Resetting', 'this.go', []],
    ['Preremove', 'this.go', []],
  ])('label %s with neutral handler', (text, h, want) => {
    expect(sev(gjs('go() { this.item.destroyRecord(); }', btn(h, text)))).toEqual(want);
  });

  test.each([
    ['deleteIt', 'warning'],
    ['destroyIt', 'warning'],
    ['purgeIt', 'warning'],
    ['eraseIt', 'warning'],
    ['wipeIt', 'warning'],
    ['revokeIt', 'warning'],
    ['terminateIt', 'warning'],
    ['permanentIt', 'warning'],
    ['foreverIt', 'warning'],
    ['neverShowIt', 'warning'],
    ['dontShowIt', 'warning'],
    ['removeIt', 'info'],
    ['discardIt', 'info'],
    ['clearAllIt', 'info'],
    ['resetIt', 'info'],
    ['uninstallIt', 'info'],
    ['deactivateIt', 'info'],
  ])('handler name %s with neutral label', (name, want) => {
    expect(sev(gjs(`${name}() { this.item.save(); }`, btn(`this.${name}`, '')))).toEqual([want]);
  });

  test('handler-name-only destructive with misleading label is not flagged when weak', () => {
    expect(sev(gjs('resetIt() { this.x(); }', btn('this.resetIt', 'Show less')))).toEqual([]);
    expect(sev(gjs('resetIt() { this.x(); }', btn('this.resetIt', 'Reset')))).toEqual(['info']);
    expect(sev(gjs('resetIt() { this.x(); }', btn('this.resetIt', '')))).toEqual(['info']);
    expect(sev(gjs('resetIt() { this.x(); }', btn('this.resetIt', 'Show less', 'aria-label="Delete"')))).toEqual(['warning']);
    expect(sev(gjs('deleteIt() { this.x(); }', btn('this.deleteIt', 'Show less')))).toEqual(['warning']);
    expect(sev(gjs('', `<template><Foo @color="critical" @onClick={{this.go}} @text="Show less" /></template>`))).toEqual(['info']);
  });

  test('label-only destructive with ui-only handler is not flagged', () => {
    for (const n of ['openIt', 'showIt', 'toggleIt', 'expandIt', 'collapseIt', 'closeIt', 'navigateIt', 'goToIt', 'transitionToIt', 'selectIt', 'viewIt', 'editIt', 'OpenIt', 'SHOWIT'])
      expect(sev(gjs(`${n}() { this.x(); }`, btn(`this.${n}`, 'Delete'))), n).toEqual([]);
    for (const n of ['goIt', 'xopenIt', 'reopenIt', 'doOpen'])
      expect(sev(gjs(`${n}() { this.x(); }`, btn(`this.${n}`, 'Delete'))), n).toEqual(['warning']);
    expect(sev(gjs('openIt() { this.x(); }', btn('this.openIt', 'Delete', '')))).toEqual([]);
    expect(sev(`<template><button type="button" {{on "click" this.openIt}} {{on "click" this.goIt}}>Delete</button></template>`)).toEqual(['warning']);
  });

  test('setting handlers are ignored when judging names', () => {
    for (const n of ['submitDelete', 'saveDelete', 'updateDelete', 'setDelete', 'applyDelete', 'toggleDelete', 'editDelete', 'changeDelete', 'onSubmitDelete', 'handleSaveDelete', 'doSetDelete'])
      expect(sev(gjs(`${n}() { this.x(); }`, btn(`this.${n}`, 'Go'))), n).toEqual([]);
    for (const n of ['xsubmitDelete', 'doDelete', 'handleDelete', 'onDelete', 'performDelete', 'runDelete'])
      expect(sev(gjs(`${n}() { this.x(); }`, btn(`this.${n}`, 'Go'))), n).toEqual(['warning']);
  });

  test('confirm and open verbs only lead the name', () => {
    for (const n of ['confirmDelete', 'askDelete', 'armDelete', 'requestDelete', 'promptDelete', 'verifyDelete', 'beginDelete', 'startDelete', 'stageDelete', 'initiateDelete', 'onConfirmDelete', 'handleConfirmDelete', 'doConfirmDelete', 'performConfirmDelete', 'runConfirmDelete', 'confirm_delete', 'CONFIRMDelete'])
      expect(sev(gjs('', btn(`this.${n}`))), n).toEqual([]);
    for (const n of ['openDeleteModal', 'showDeleteDialog', 'launchDeleteConfirm', 'displayDeletePrompt', 'toggleDeleteConfirmation', 'triggerDeleteModal', 'openModal'])
      expect(sev(gjs('', btn(`this.${n}`))), n).toEqual([]);
    for (const n of ['openDelete', 'showDelete', 'deleteConfirm', 'xconfirmDelete', 'doDeleteConfirm', 'closeDeleteModal', 'deleteModal'])
      expect(sev(gjs('', btn(`this.${n}`))), n).not.toEqual([]);
    for (const n of ['deleteIt', 'doIt'])
      expect(sev(gjs(`${n}() { this.a.destroy(); }`, btn(`this.${n}`)))).toEqual(['warning']);
    expect(sev(gjs('', btn('this.on', 'Delete')))).toEqual(['warning']);
    expect(sev(gjs('', btn('this.handle', 'Delete')))).toEqual(['warning']);
    expect(sev(gjs('', btn('this.onHandleDelete')))).toEqual(['warning']);
  });
});

describe('destructive: element and attribute selection', () => {
  const run = (tpl, script = '') => sev(gjs(script, `<template>${tpl}</template>`));
  test('skipped elements', () => {
    expect(run('<a href="/x" {{on "click" this.go}}>Delete</a>')).toEqual([]);
    expect(run('<a {{on "click" this.go}}>Delete</a>')).toEqual(['warning']);
    expect(run('<form {{on "submit" this.go}}>Delete</form>')).toEqual([]);
    expect(run('<LinkTo @route="x" {{on "click" this.go}}>Delete</LinkTo>')).toEqual([]);
    expect(run('<link-to {{on "click" this.go}}>Delete</link-to>')).toEqual([]);
    expect(run('<LinkToX {{on "click" this.go}}>Delete</LinkToX>')).toEqual(['warning']);
    expect(run('<input type="radio" {{on "click" this.go}} value="Delete">')).toEqual([]);
    expect(run('<input type="checkbox" {{on "click" this.go}} value="Delete">')).toEqual([]);
    expect(run('<input type="button" {{on "click" this.go}} value="Delete">')).toEqual(['warning']);
    expect(run('<Hds::Form::Radio::Field {{on "click" this.go}} @text="Delete" />')).toEqual([]);
    expect(run('<Checkbox {{on "click" this.go}} @text="Delete" />')).toEqual([]);
    expect(run('<Toggle {{on "click" this.go}} @text="Delete" />')).toEqual([]);
    expect(run('<Foo {{on "click" this.go}} @text="Delete" />')).toEqual(['warning']);
  });

  test('handler sources', () => {
    expect(run('<button type="button" {{on "submit" this.go}}>Delete</button>')).toEqual(['warning']);
    expect(run('<button type="button" {{on "mouseover" this.go}}>Delete</button>')).toEqual([]);
    expect(run('<button type="button" {{action this.go}}>Delete</button>')).toEqual(['warning']);
    expect(run('<button type="button" {{action "go"}}>Delete</button>')).toEqual(['info']);
    expect(run('<button type="button" {{fooModifier this.go}}>Delete</button>')).toEqual([]);
    expect(run('<button type="button" onclick="deleteIt()">Delete</button>')).toEqual(['warning']);
    expect(run('<button type="button" onclick={{this.go}}>Delete</button>')).toEqual(['warning']);
    expect(run('<button type="button" onclick="confirm(\'x\')">Delete</button>')).toEqual([]);
    expect(run('<button type="button">Delete</button>')).toEqual([]);
    expect(run('<Foo @onClick={{this.go}} @text="Delete" />')).toEqual(['warning']);
    expect(run('<Foo @onclick={{this.go}} @text="Delete" />')).toEqual(['warning']);
    expect(run('<Foo @onDismiss={{this.go}} @text="Delete" />')).toEqual([]);
    expect(run('<Foo @onFoo={{this.go}} @text="Delete" />')).toEqual([]);
    expect(run('<Foo @onClick="go" @text="Delete" />')).toEqual([]);
    expect(run('<button type="button" {{on "click" this.go}} {{on "click" (fn this.other)}}>Delete</button>')).toEqual(['warning']);
  });

  test('dismiss-only components ignore their label', () => {
    expect(run('<Foo @onDismiss={{this.destroyIt}} @text="Hello" />', 'destroyIt() { this.x(); }')).toEqual(['warning']);
    expect(messages(gjs('destroyIt() { this.x(); }', '<template><Foo @onDismiss={{this.destroyIt}} @text="Delete" /></template>'))[0]).toBe('Destructive action "dismiss" on <Foo> (this.destroyIt) runs without a confirmation step.');
    expect(run('<Foo @onDismiss={{this.go}} @onClick={{this.go}} @text="Delete" />')).toEqual(['warning']);
    expect(run('<Foo @onDismiss={{this.go}} {{on "click" this.go}} @text="Delete" />')).toEqual(['warning']);
    expect(run('<button {{on "click" this.go}} @onDismiss={{this.go}}>Delete</button>')).toEqual(['warning']);
  });

  test('critical color', () => {
    expect(run('<Foo @color="critical" @onClick={{this.go}} @text="Go" />')).toEqual(['info']);
    expect(run('<Foo @color="primary" @onClick={{this.go}} @text="Go" />')).toEqual([]);
    expect(run('<Foo @color="critical" @onClick={{this.go}} @text="Delete" />')).toEqual(['warning']);
    expect(run('<Foo @color={{this.c}} @onClick={{this.go}} @text="Go" />')).toEqual([]);
    expect(run('<Foo @colour="critical" @onClick={{this.go}} @text="Go" />')).toEqual([]);
    expect(run('<Foo @color="critical" @onClick={{this.go}} @text="Hello" />')).toEqual(['info']);
  });

  test('label sources and messages', () => {
    expect(run('<button type="button" aria-label="Delete" {{on "click" this.go}}>X</button>')).toEqual(['warning']);
    expect(run('<button type="button" title="Delete" {{on "click" this.go}}>X</button>')).toEqual(['warning']);
    expect(run('<input type="button" value="Delete" {{on "click" this.go}}>')).toEqual(['warning']);
    expect(run('<Foo @text="Delete" {{on "click" this.go}} />')).toEqual(['warning']);
    expect(run('<Foo @label="Delete" {{on "click" this.go}} />')).toEqual(['warning']);
    expect(run('<Foo @title="Delete" {{on "click" this.go}} />')).toEqual(['warning']);
    expect(run('<Foo @ariaLabel="Delete" {{on "click" this.go}} />')).toEqual(['warning']);
    expect(run('<Foo @other="Delete" {{on "click" this.go}} />')).toEqual([]);
    expect(run('<Foo @text={{this.t}} {{on "click" this.go}} />')).toEqual([]);
    expect(run('<button type="button" aria-label={{this.t}} {{on "click" this.go}}>Delete</button>')).toEqual(['warning']);
    expect(run('<button type="button" {{on "click" this.go}}><span>Delete</span></button>')).toEqual(['warning']);
    expect(run('<button type="button" {{on "click" this.go}}><i><b><u><s><em><strong><span>Delete</span></strong></em></s></u></b></i></button>')).toEqual([]);
    expect(run('<button type="button" {{on "click" this.go}}><i><b><u><s><em><strong>Delete</strong></em></s></u></b></i></button>')).toEqual(['warning']);
    expect(run('<button type="button" {{on "click" this.go}}>{{"Delete"}}</button>')).toEqual(['warning']);
    expect(run('<button type="button" {{on "click" this.go}}>{{this.label}}</button>')).toEqual([]);
    expect(messages(gjs('', '<template><button type="button" {{on "click" this.go}}>  Delete   this   item  </button></template>'))[0]).toBe('Destructive action "Delete this item" runs without a confirmation step.');
    const long = 'Delete ' + 'x'.repeat(60);
    expect(messages(gjs('', `<template><button type="button" {{on "click" this.go}}>${long}</button></template>`))[0]).toBe(`Destructive action "${long.slice(0, 37)}…" runs without a confirmation step.`);
    const exact = 'Delete ' + 'x'.repeat(33);
    expect(messages(gjs('', `<template><button type="button" {{on "click" this.go}}>${exact}</button></template>`))[0]).toBe(`Destructive action "${exact}" runs without a confirmation step.`);
    expect(messages(gjs('destroyIt() { this.x(); }', '<template><Foo {{on "click" this.destroyIt}} /></template>'))[0]).toBe('Destructive action <Foo> runs without a confirmation step.');
    expect(messages(gjs('', '<template><button type="button" {{on "click" this.go}}>Delete</button></template>'))[0]).toContain('"Delete"');
    const f = lintTemplate(gjs('', '<template><button type="button" {{on "click" this.go}}>Delete</button></template>'), { filename: 'x.gjs', minSeverity: 'info' }).find((x) => x.ruleId === R);
    expect(f.wcag).toEqual(['WCAG 3.3.4 Error Prevention (Legal, Financial, Data) (AA)', 'WCAG 3.3.6 Error Prevention (All) (AAA)']);
    expect(f.references).toHaveLength(3);
    expect(f.help).toMatch(/^Ask the user to confirm before the action is carried out\./);
  });
});

describe('destructive: submit buttons and forms', () => {
  const run = (tpl, script = '') => sev(gjs(script, `<template>${tpl}</template>`));
  test('submit button uses the form handler', () => {
    expect(run('<form {{on "submit" this.go}}><button type="submit">Delete</button></form>')).toEqual(['warning']);
    expect(run('<form {{on "submit" this.go}}><button>Delete</button></form>')).toEqual(['warning']);
    expect(run('<form {{on "submit" this.go}}><button type="button">Delete</button></form>')).toEqual([]);
    expect(run('<form {{on "submit" this.go}}><input type="submit" value="Delete"></form>')).toEqual(['warning']);
    expect(run('<form {{on "submit" this.go}}><input value="Delete"></form>')).toEqual([]);
    expect(run('<form {{on "submit" this.go}}><div><button>Delete</button></div></form>')).toEqual(['warning']);
    expect(run('<div><button>Delete</button></div>')).toEqual([]);
    expect(run('<Layout::FlexForm {{on "submit" this.go}}><button>Delete</button></Layout::FlexForm>')).toEqual(['warning']);
    expect(run('<MyForm {{on "submit" this.go}}><button>Delete</button></MyForm>')).toEqual(['warning']);
    expect(run('<MyFormX {{on "submit" this.go}}><button>Delete</button></MyFormX>')).toEqual(['warning']);
    expect(run('<form {{on "submit" this.go}}><button {{on "click" this.other}}>Delete</button></form>')).toEqual(['warning']);
  });

  test('removing inside an editing form is informational', () => {
    expect(run('<form><button type="button" {{on "click" this.go}}>Delete</button></form>')).toEqual(['info']);
    expect(run('<MyForm><button type="button" {{on "click" this.go}}>Delete</button></MyForm>')).toEqual(['warning']);
    expect(run('<Hds::Form><button type="button" {{on "click" this.go}}>Delete</button></Hds::Form>')).toEqual(['info']);
    expect(run('<F.Foo><button type="button" {{on "click" this.go}}>Delete</button></F.Foo>')).toEqual(['info']);
    expect(run('<FORM><button type="button" {{on "click" this.go}}>Delete</button></FORM>')).toEqual(['info']);
    expect(run('<F><button type="button" {{on "click" this.go}}>Delete</button></F>')).toEqual(['info']);
    expect(run('<G.Foo><button type="button" {{on "click" this.go}}>Delete</button></G.Foo>')).toEqual(['warning']);
    expect(run('<Formal><button type="button" {{on "click" this.go}}>Delete</button></Formal>')).toEqual(['warning']);
    expect(run('<form><button {{on "click" this.go}}>Delete</button></form>')).toEqual(['warning']);
    expect(run('<form><button type="submit" {{on "click" this.go}}>Delete</button></form>')).toEqual(['warning']);
    expect(run('<form><input type="submit" value="Delete" {{on "click" this.go}}></form>')).toEqual(['warning']);
    expect(run('<form><input type="button" value="Delete" {{on "click" this.go}}></form>')).toEqual(['info']);
    expect(run('<form><div><button type="button" {{on "click" this.go}}>Delete</button></div></form>')).toEqual(['info']);
    expect(run('<form><button type="button" {{on "click" this.go}}>Remove</button></form>')).toEqual(['info']);
  });
});

describe('destructive: confirmation context', () => {
  const run = (tpl, script = '') => sev(gjs(script, `<template>${tpl}</template>`));
  const del = '<button type="button" {{on "click" this.go}}>Delete</button>';
  test('inside dialogs', () => {
    expect(run(`<dialog>${del}</dialog>`)).toEqual([]);
    expect(run(`<div role="dialog">${del}</div>`)).toEqual([]);
    expect(run(`<div role="alertdialog">${del}</div>`)).toEqual([]);
    expect(run(`<div role="group">${del}</div>`)).toEqual(['warning']);
    expect(run(`<HdsModal>${del}</HdsModal>`)).toEqual([]);
    expect(run(`<Hds::Modal>${del}</Hds::Modal>`)).toEqual([]);
    expect(run(`<ConfirmThing>${del}</ConfirmThing>`)).toEqual([]);
    expect(run(`<MyDialog>${del}</MyDialog>`)).toEqual([]);
    expect(run(`<MODAL>${del}</MODAL>`)).toEqual([]);
    expect(run(`<Panel>${del}</Panel>`)).toEqual(['warning']);
    expect(run(`<div><section><div role="dialog"><p>${del}</p></div></section></div>`)).toEqual([]);
    expect(run(`<my-dialog>${del}</my-dialog>`)).toEqual(['warning']);
    expect(run(`<div role={{this.r}}>${del}</div>`)).toEqual(['warning']);
  });

  test('inside confirming branches', () => {
    for (const cond of ['this.isConfirming', 'this.showDeleteModal', 'this.pendingDeletion', 'this.deletePending', 'this.isSure', 'this.verifying', 'this.isArmed', 'this.reallyDelete', 'this.prompting', 'this.dialogOpen', 'this.canUndo', 'this.args.isConfirming', 'this.confirmation', 'this.confirmed', 'this.x.confirm'])
      expect(run(`{{#if ${cond}}}${del}{{/if}}`), cond).toEqual([]);
    for (const cond of ['this.isOpen', 'this.pendingx', 'this.pending', 'this.pendingSave', 'this.isLoading', 'this.confirmx', 'this.nopending'])
      expect(run(`{{#if ${cond}}}${del}{{/if}}`), cond).toEqual(['warning']);
    expect(run(`{{#unless this.isConfirming}}{{else}}${del}{{/unless}}`)).toEqual([]);
    expect(run(`{{#unless this.isConfirming}}${del}{{/unless}}`)).toEqual(['warning']);
    expect(run(`{{#if this.isConfirming}}{{else}}${del}{{/if}}`)).toEqual(['warning']);
    expect(run(`{{#if this.x}}{{else if this.isConfirming}}${del}{{/if}}`)).toEqual([]);
    expect(run(`{{#if (and this.a this.isConfirming)}}${del}{{/if}}`)).toEqual([]);
    expect(run(`{{#if (and this.a this.b)}}${del}{{/if}}`)).toEqual(['warning']);
    expect(run(`{{#each this.isConfirming as |x|}}${del}{{/each}}`)).toEqual(['warning']);
    expect(run(`{{#if this.isConfirming}}<div>${del}</div>{{/if}}`)).toEqual([]);
    expect(run(`{{#if this.a}}{{#if this.isConfirming}}${del}{{/if}}{{/if}}`)).toEqual([]);
    expect(run(`{{#if this.isConfirming}}{{#if this.a}}${del}{{/if}}{{/if}}`)).toEqual([]);
    expect(run(`{{#if this.isConfirming}}{{/if}}${del}`)).toEqual(['warning']);
    expect(run(`{{#if}}${del}{{/if}}`)).toEqual(['warning']);
  });

  test('armed state set by another handler', () => {
    const script = 'arm() { this.isPicked = true; } go() { this.item.destroyRecord(); }';
    const arm = '<button type="button" {{on "click" this.arm}}>Open</button>';
    expect(run(`${arm}{{#if this.isPicked}}${del}{{/if}}`, script)).toEqual([]);
    expect(run(`${arm}{{#if this.other}}${del}{{/if}}`, script)).toEqual(['warning']);
    expect(run(`${arm}{{#if this.isPicked}}${del}{{/if}}`, 'arm() { this.isPicked = false; } go() {}')).toEqual(['warning']);
    expect(run(`${arm}{{#if this.isPicked}}${del}{{/if}}`, 'arm() { this.isPicked = true; this.a.destroyRecord(); } go() {}')).toEqual(['warning']);
    expect(run(`${arm}{{#if this.isPicked}}${del}{{/if}}`, 'arm() { this.isPicked == true; } go() {}')).toEqual(['warning']);
    expect(run(`<button type="button" {{on "click" this.args.arm}}>Open</button>{{#if this.isPicked}}${del}{{/if}}`, 'go() {}')).toEqual(['warning']);
    expect(run(`<button type="button" {{on "click" @arm}}>Open</button>{{#if this.isPicked}}${del}{{/if}}`, 'go() {}')).toEqual(['warning']);
    expect(run(`<button type="button" {{on "click" this.arm}}>Open</button>{{#if this.isPicked}}${del}{{/if}}`, 'go() {}')).toEqual(['warning']);
  });

  test('handler arms state the template branches into a dialog or confirm control', () => {
    const go = 'go() { this.isPicked = true; }';
    expect(run(`${del}{{#if this.isPicked}}<dialog></dialog>{{/if}}`, go)).toEqual([]);
    expect(run(`${del}{{#if this.isPicked}}<Hds::Modal />{{/if}}`, go)).toEqual([]);
    expect(run(`${del}{{#if this.isPicked}}<button type="button" {{on "click" this.other}}>Yes</button>{{/if}}`, go)).toEqual([]);
    expect(run(`${del}{{#if this.isPicked}}<button type="button" {{on "click" this.go}}>Yes</button>{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPicked}}<p>Deleting…</p>{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPicked}}<button type="button">Yes</button>{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#unless this.isPicked}}{{else}}<dialog></dialog>{{/unless}}`, go)).toEqual([]);
    expect(run(`${del}{{#unless this.isPicked}}<dialog></dialog>{{/unless}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPicked}}{{else}}<dialog></dialog>{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if this.other}}<dialog></dialog>{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPickedX}}<dialog></dialog>{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if (or this.a this.isPicked)}}<dialog></dialog>{{/if}}`, go)).toEqual([]);
    expect(run(`${del}{{#if this.isPicked}}<dialog></dialog>{{/if}}`, 'go() { this.isPicked = true; this.a.destroyRecord(); }')).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPicked}}<dialog></dialog>{{/if}}`, 'go() { this.isPicked = false; }')).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPicked}}<div role="alertdialog"></div>{{/if}}`, go)).toEqual([]);
    expect(run(`${del}{{#if this.isPicked}}<Foo @onClick={{this.go}} />{{/if}}`, go)).toEqual(['warning']);
    expect(run(`${del}{{#if this.isPicked}}<Foo @onClick={{this.other}} />{{/if}}`, go)).toEqual([]);
  });

  test('type to confirm', () => {
    const tc = (attrs, text = 'Type DELETE to confirm', input = '<input type="text">') => `<form>${input}<label>${text}</label><button type="button" ${attrs} {{on "click" this.go}}>Delete</button></form>`;
    expect(run(tc('disabled={{this.x}}'))).toEqual([]);
    expect(run(tc('disabled'))).toEqual(['info']);
    expect(run(tc(''))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Hello'))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to continue'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to proceed'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Enter the name to confirm'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Retype the name to confirm'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Re-type the name to confirm'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Input the name to confirm'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Confirm by typing the name'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Click to confirm'))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Type the name carefully'))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Type ' + 'x'.repeat(70) + ' to confirm'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Type ' + 'x'.repeat(90) + ' to confirm'))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', '<textarea></textarea>'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', '<Hds::Form::TextInput::Field />'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', '<MyInput />'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', '<MyTextField />'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', '<MyThing />'))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', ''))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Type DELETE to confirm', '<input type="text" placeholder="Hello">'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Hello', '<input type="text" placeholder="Type DELETE to confirm">'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Hello', '<input type="text" aria-label="Type DELETE to confirm">'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Hello', '<input type="text" placeholder={{this.p}}>'))).toEqual(['info']);
    expect(run(tc('disabled={{this.x}}', 'Hello', '<Hds::Form::TextInput::Field @label="Type DELETE to confirm" />'))).toEqual([]);
    expect(run(tc('disabled={{this.x}}', 'Hello', '<Hds::Form::TextInput::Field @label={{this.l}} />'))).toEqual(['info']);
    expect(run('<form><input type="text"><label>Type DELETE to confirm</label><Foo @isDisabled={{this.x}} {{on "click" this.go}} @text="Delete" /></form>')).toEqual([]);
    expect(run('<form><input type="text"><label>Type DELETE to confirm</label><Foo @disabled={{this.x}} {{on "click" this.go}} @text="Delete" /></form>')).toEqual([]);
    expect(run('<form><input type="text"><label>Type DELETE to confirm</label><Foo @isDisabled="x" {{on "click" this.go}} @text="Delete" /></form>')).toEqual(['info']);
    expect(run('<form><input type="text"><label>Type DELETE to confirm</label><Foo @other={{this.x}} {{on "click" this.go}} @text="Delete" /></form>')).toEqual(['info']);
    expect(run('<form><input type="text"><label>Type DELETE to confirm</label><Foo @xdisabled={{this.x}} {{on "click" this.go}} @text="Delete" /></form>')).toEqual(['info']);
    expect(run('<div><input type="text"><label>Type DELETE to confirm</label><button type="button" disabled={{this.x}} {{on "click" this.go}}>Delete</button></div>')).toEqual([]);
    expect(run('<dialog><input type="text"><label>Type DELETE to confirm</label><button type="button" disabled={{this.x}} {{on "click" this.go}}>Delete</button></dialog>')).toEqual([]);
    expect(run('<div><section><input type="text"></section><label>Type DELETE to confirm</label></div><button type="button" disabled={{this.x}} {{on "click" this.go}}>Delete</button>')).toEqual([]);
    expect(run('<div><input type="text"><label>Type DELETE to confirm</label></div><div><button type="button" disabled={{this.x}} {{on "click" this.go}}>Delete</button></div>')).toEqual(['warning']);
    expect(run('<input type="text"><label>Type DELETE to confirm</label><button type="button" disabled={{this.x}} {{on "click" this.go}}>Delete</button>')).toEqual([]);
  });

  test('inline confirm() in the handler expression', () => {
    expect(run('<button type="button" onclick="return confirm(\'x\')">Delete</button>')).toEqual([]);
    expect(run('<button type="button" onclick="return xconfirm(\'x\')">Delete</button>')).toEqual(['info']);
    expect(run('<button type="button" onclick="return confirm">Delete</button>')).toEqual(['info']);
  });
});
