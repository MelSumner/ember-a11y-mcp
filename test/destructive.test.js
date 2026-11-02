import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintTemplate } from '../lib/lint/index.js';

const R = 'destructive-action-confirmation';
const gjs = (body, tpl) => `import Component from '@glimmer/component';\nexport default class X extends Component {\n  ${body}\n  <template>${tpl}</template>\n}`;
const dac = (src, filename = 'x.gjs') =>
  lintTemplate(src, { filename, minSeverity: 'info' })
    .filter((f) => f.ruleId === R)
    .map((f) => f.severity);
const btn = (handler, text = 'Delete') => `<button type="button" {{on "click" ${handler}}}>${text}</button>`;
const del = '{ await this.item.destroyRecord(); }';

describe('destructive-action-confirmation: confirm-ish handler names', () => {
  test('confirm words only count as leading word segments', () => {
    for (const name of ['revokeTask', 'handleDeleteTask', 'purgeAlarms', 'revokeToken', 'handleDelete', 'purgeAll', 'deleteRequest', 'removeStage', 'destroyDialogs'])
      expect(dac(gjs(`@action async ${name}() ${del}`, btn(`this.${name}`))), name).toEqual(['warning']);
  });

  test('confirm-named flows are accepted', () => {
    for (const name of ['confirmDelete', 'askToDelete', 'armDelete', 'requestDelete', 'promptDelete', 'onConfirmDelete', 'handleRequestRevoke', 'showDeleteModal', 'openDeleteDialog'])
      expect(dac(`<template>${btn(`this.${name}`)}</template>`), name).toEqual([]);
  });
});

describe('destructive-action-confirmation: handler bodies', () => {
  test('closing a modal is not a confirmation; opening one is', () => {
    expect(dac(gjs('@action destroyCluster() { this.api.destroy(); this.closeModal(); }', btn('this.destroyCluster', 'Destroy')))).toEqual(['warning']);
    expect(dac(gjs('@action destroyCluster() { this.api.destroy(); this.closePanel(); }', btn('this.destroyCluster', 'Destroy')))).toEqual(['warning']);
    expect(dac(gjs('@action destroyCluster() { this.api.destroy(); this.isModalOpen = false; }', btn('this.destroyCluster', 'Destroy')))).toEqual(['warning']);
    const ok = [
      '@action destroyCluster() { this.openModal(); }',
      '@action destroyCluster() { this.isModalOpen = true; }',
      '@action destroyCluster() { this.showDestroyDialog = true; }',
      "@action async destroyCluster() { if (await this.modal.confirm('Destroy?')) this.api.destroy(); }",
      "@action async destroyCluster() { const ok = await this.modal.prompt.linked().perform('m'); if (!ok) return; this.api.destroy(); }",
      "@action destroyCluster() { if (!confirm('Destroy?')) return; this.api.destroy(); }",
    ];
    for (const body of ok) expect(dac(gjs(body, btn('this.destroyCluster', 'Destroy'))), body).toEqual([]);
  });

  test('assignment arms a confirmation only if its branch holds a confirm button or dialog', () => {
    const body = '@action async deleteItem() { this.isDeleting = true; await this.api.delete(); }';
    expect(dac(gjs(body, `{{#if this.isDeleting}}Deleting…{{/if}}${btn('this.deleteItem')}`))).toEqual(['warning']);
    expect(dac(gjs('@action async deleteItem() { this.busy = 1; await this.api.delete(); }', `{{#if this.busy}}<span>Deleting…</span>{{/if}}${btn('this.deleteItem')}`))).toEqual(['warning']);
    // genuine arming: the branch has Confirm/Cancel buttons, or a dialog
    const arm = '@action deleteItem() { this.pendingDelete = true; } @action reallyDelete() { this.api.delete(); } @action cancel() { this.pendingDelete = false; }';
    expect(dac(gjs(arm, `${btn('this.deleteItem')}{{#if this.pendingDelete}}<p>Sure?</p>${btn('this.reallyDelete', 'Confirm')}${btn('this.cancel', 'Cancel')}{{/if}}`))).toEqual([]);
    expect(dac(gjs('@action deleteItem() { this.target = this.args.item; }', `${btn('this.deleteItem')}{{#if this.target}}<HdsModal as |M|><M.Header>Delete?</M.Header></HdsModal>{{/if}}`))).toEqual([]);
  });

  test('ember-concurrency tasks, decorators, arrow fields and generators', () => {
    const tpl = btn('(perform this.deleteToken)');
    const confirmed = [
      "deleteToken = task({ drop: true }, async (token) => { if (!window.confirm('Delete?')) return; await token.destroyRecord(); });",
      "deleteToken = dropTask(async () => { let confirm = await this.modal.prompt.linked().perform('m'); if (!confirm) return; await this.t.destroyRecord(); });",
      "deleteToken = restartableTask({ maxConcurrency: 1 }, async () => { if (!confirm('x')) return; });",
      "deleteToken = task(this, { drop: true }, function* () { if (!window.confirm('x')) return; yield this.t.destroyRecord(); });",
      "@task({ drop: true }) *deleteToken() { if (!window.confirm('x')) return; yield this.t.destroyRecord(); }",
      "@dropTask *deleteToken() { if (!window.confirm('x')) return; yield this.t.destroyRecord(); }",
      "@action async deleteToken() { if (!window.confirm('x')) return; await this.t.destroyRecord(); }",
      "deleteToken = async () => { if (!window.confirm('x')) return; await this.t.destroyRecord(); };",
    ];
    for (const body of confirmed) expect(dac(gjs(body, tpl)), body).toEqual([]);
    const unconfirmed = [
      'deleteToken = task({ drop: true }, async (token) => { await token.destroyRecord(); });',
      '@task({ drop: true }) *deleteToken() { yield this.t.destroyRecord(); }',
      'deleteToken = async () => { await this.t.destroyRecord(); };',
    ];
    for (const body of unconfirmed) expect(dac(gjs(body, tpl)), body).toEqual(['warning']);
  });
});

describe('destructive-action-confirmation: template context', () => {
  test('each-loops are never a confirmation context', () => {
    const body = '@action revoke(i) { i.destroyRecord(); }';
    for (const list of ['this.pendingInvites', 'this.invites', 'this.confirmedUsers'])
      expect(dac(gjs(body, `{{#each ${list} as |i|}}<button type="button" {{on "click" (fn this.revoke i)}}>Revoke</button>{{/each}}`)), list).toEqual(['warning']);
  });

  test('only the truthy branch of a confirming condition counts', () => {
    const body = '@action doDelete() { this.item.destroyRecord(); }';
    expect(dac(gjs(body, `{{#if this.isConfirming}}${btn('this.doDelete', 'Yes, delete')}{{/if}}`))).toEqual([]);
    expect(dac(gjs(body, `{{#unless this.isConfirming}}x{{else}}${btn('this.doDelete', 'Yes, delete')}{{/unless}}`))).toEqual([]);
    expect(dac(gjs(body, `{{#if this.loading}}x{{else if this.isConfirming}}${btn('this.doDelete', 'Yes, delete')}{{/if}}`))).toEqual([]);
    expect(dac(gjs(body, `{{#if this.isConfirming}}x{{else}}${btn('this.doDelete')}{{/if}}`))).toEqual(['warning']);
  });

  test('submit handlers on form-like components are judged by the submit button', () => {
    const body = '@action onSubmitAutoDestroy(e) { e.preventDefault(); this.ws.save(); }';
    expect(dac(gjs(body, '<Layout::FlexForm {{on "submit" this.onSubmitAutoDestroy}} as |FF|><HdsButton @text="Save settings" type="submit" /></Layout::FlexForm>'))).toEqual([]);
    expect(dac(gjs(body, '<form {{on "submit" this.onSubmitAutoDestroy}}><button type="submit">Save</button></form>'))).toEqual([]);
    expect(dac(gjs('@action deleteAccount(e) { e.preventDefault(); this.api.del(); }', '<Layout::FlexForm {{on "submit" this.deleteAccount}}><HdsButton @text="Delete account" type="submit" /></Layout::FlexForm>'))).toEqual(['warning']);
    expect(dac(gjs('@action deleteAccount(e) { e.preventDefault(); this.api.del(); }', '<form {{on "submit" this.deleteAccount}}><button type="submit">Submit</button></form>'))).toEqual(['warning']);
  });

  test('type-to-confirm forms count as confirmation', () => {
    const body = '@action deleteWorkspace(e) { e.preventDefault(); this.ws.destroyRecord(); }';
    const form = (gate) =>
      `<form {{on "submit" this.deleteWorkspace}}><label for="n">Type the workspace name to confirm</label><input id="n" {{on "input" this.update}}><button type="submit" ${gate}>Delete workspace</button></form>`;
    expect(dac(gjs(body, form('disabled={{this.mismatch}}')))).toEqual([]);
    expect(dac(gjs(body, '<HdsForm {{on "submit" this.deleteWorkspace}} as |F|><Hds::Form::TextInput::Field as |T|><T.Label>Enter "prod" to confirm</T.Label></Hds::Form::TextInput::Field><HdsButton type="submit" @text="Delete" disabled={{this.mismatch}} /></HdsForm>'))).toEqual([]);
    // not gated, or no confirm text: still flagged
    expect(dac(gjs(body, form('')))).toEqual(['warning']);
    expect(dac(gjs(body, '<form {{on "submit" this.deleteWorkspace}}><label for="n">Name</label><input id="n"><button type="submit" disabled={{this.x}}>Delete workspace</button></form>'))).toEqual(['warning']);
  });
});

describe('destructive-action-confirmation: settings and labels', () => {
  test('choosing a radio/checkbox option is not the destructive action', () => {
    expect(dac(gjs('@action pick(v) { this.mode = v; }', '<G.RadioField {{on "click" (fn this.pick "x")}} as |F|><F.Label>Destroy at specific time</F.Label></G.RadioField><input type="checkbox" {{on "click" this.pick}} aria-label="Delete after run">'))).toEqual([]);
  });

  test('a weak handler name with a non-destructive visible label is not flagged', () => {
    expect(dac(gjs('reset = task(async () => { this.page = 0; });', '<HdsButton @text="Show less" {{on "click" (perform this.reset)}} />'))).toEqual([]);
    expect(dac(gjs('reset = task(async () => { this.page = 0; });', '<HdsButton @text="Reset" {{on "click" (perform this.reset)}} />'))).toEqual(['info']);
  });

  test('a task that forwards to an argument task is delegated', () => {
    expect(dac(gjs('removeItem = task(async (p, i) => { await this.args.remove.perform(p, i); });', '<HdsButton @text="Remove" {{on "click" (perform this.removeItem)}} />'))).toEqual(['info']);
  });
});

test('companion dropdown close handlers do not hide delegation', () => {
  const body = 'get onDelete() { return (a) => { this.args.onDelete?.(a); }; }';
  expect(dac(gjs(body, '<dd.Interactive @color="critical" {{on "click" (fn this.onDelete 1)}} {{on "click" dd.close}}>Uninstall</dd.Interactive>'))).toEqual(['info']);
});

test('a handler yielded by an enclosing component is info, not a warning', () => {
  const tpl = '<PolicyForm as |CF|><HdsButton @color="critical" @text="Delete policy" {{on "click" (perform CF.delete)}} /></PolicyForm>';
  expect(lintTemplate(`<template>${tpl}</template>`, { filename: 'x.gjs', minSeverity: 'info' }).filter((f) => f.ruleId === R)).toMatchObject([{ severity: 'info', message: expect.stringMatching(/yielded by an enclosing component/) }]);
});

describe('destructive-action-confirmation: route templates', () => {
  test('a route template is judged with its controller', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dac-route-'));
    try {
      mkdirSync(join(dir, 'app/templates/settings'), { recursive: true });
      mkdirSync(join(dir, 'app/controllers/settings'), { recursive: true });
      const tpl = join(dir, 'app/templates/settings/sessions.hbs');
      writeFileSync(tpl, btn('this.revokeAll', 'Revoke all'));
      const run = () => dac(readFileSync(tpl, 'utf8'), tpl);
      writeFileSync(join(dir, 'app/controllers/settings/sessions.js'), `export default class extends Controller {\n  @action async revokeAll() ${del}\n}`);
      expect(run()).toEqual(['warning']);
      writeFileSync(join(dir, 'app/controllers/settings/sessions.js'), "export default class extends Controller {\n  @action async revokeAll() { if (!window.confirm('Revoke all?')) return; await this.api.revoke(); }\n}");
      expect(run()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
