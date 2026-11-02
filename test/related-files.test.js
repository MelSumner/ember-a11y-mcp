import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { importSpecifiers, relatedFiles, templateInvocations } from '../lib/related-files.js';

let root;
const write = (files) => {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof content === 'string' ? content : JSON.stringify(content));
  }
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ea11y-rel-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const monorepo = {
  'package.json': { name: 'mono', private: true },
  'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
  'apps/web/package.json': { name: 'web-app', devDependencies: { 'ember-source': '6' }, 'ember-addon': { paths: ['lib/ui'] } },
  'apps/web/config/environment.js': "module.exports = function () { return { modulePrefix: 'web' }; };\n",
  'apps/web/app/router.js': "Router.map(function () { this.route('people'); });\n",
  'apps/web/app/components/user-card.hbs': '<div class="user-card is-flex {{if @x "y"}}">\n  <FancyButton />\n  {{format-name @user}}\n  <Hds::Thing />\n  {{#if @a}}{{yield}}{{/if}}\n</div>\n',
  'apps/web/app/components/user-card.js': [
    "import Component from '@glimmer/component';",
    'import {',
    '  fullName,',
    '  initials,',
    "} from 'web/utils/names';",
    "import type { Args } from './types';",
    "import { fmt } from 'shared/utils/format';",
    "const lazy = () => import('web/utils/lazy');",
    'export default class UserCard extends Component {}',
  ].join('\n'),
  'apps/web/app/components/types.ts': 'export type Args = {};\n',
  'apps/web/app/components/other.gjs': "import UserCard from 'web/components/user-card';\n<template><UserCard /></template>\n",
  'apps/web/app/utils/names.js': "import { deep } from './deeper';\nexport const fullName = 1;\n",
  'apps/web/app/utils/deeper.js': 'export const deep = 1;\n',
  'apps/web/app/utils/lazy.js': 'export default 1;\n',
  'apps/web/app/helpers/format-name.js': 'export default () => 1;\n',
  'apps/web/app/styles/components/_user-card.scss': '.user-card { display: block; }\n',
  'apps/web/app/styles/utilities.scss': '.is-flex { display: flex; }\n.is-flex-wrap { flex-wrap: wrap; }\n',
  'apps/web/app/styles/components/admin/_user-card.scss': '.admin-user-card {}\n',
  'apps/web/tests/integration/components/user-card-test.gjs': "import UserCard from 'web/components/user-card';\n",
  'apps/web/app/templates/people.hbs': '<UserCard @user={{this.user}} />\n',
  'apps/web/app/routes/people.js': 'export default class {}\n',
  'apps/web/app/routes/people/index.js': 'export default class {}\n',
  'apps/web/app/controllers/people/index.js': 'export default class {}\n',
  'apps/web/app/templates/people/index.hbs': '<p>People</p>\n',
  'apps/web/lib/ui/package.json': { name: 'ui', keywords: ['ember-addon'] },
  'apps/web/lib/ui/addon/components/fancy-button.js': 'export default class {}\n',
  'apps/web/lib/ui/app/components/fancy-button.js': "export { default } from 'ui/components/fancy-button';\n",
  'packages/shared/package.json': { name: 'shared', keywords: ['ember-addon'], 'ember-addon': { version: 2 } },
  'packages/shared/src/utils/format.js': 'export const fmt = 1;\n',
};

const byRelation = (r, relation) => r.related.filter((x) => x.relation === relation).map((x) => x.path);

describe('relatedFiles', () => {
  test('finds the unit, imports, invocations, styles, tests and users of a component', () => {
    write(monorepo);
    const r = relatedFiles({ root, path: 'apps/web/app/components/user-card.hbs' });
    expect(r.unit).toEqual({ kind: 'component', name: 'user-card', package: 'web' });
    expect(byRelation(r, 'component class')).toEqual(['apps/web/app/components/user-card.js']);
    expect(byRelation(r, 'imports').sort()).toEqual([
      'apps/web/app/components/types.ts', 'apps/web/app/utils/lazy.js', 'apps/web/app/utils/names.js', 'packages/shared/src/utils/format.js',
    ]);
    expect(r.related.filter((x) => x.relation === 'invokes').map((x) => `${x.path} ${x.detail}`).sort()).toEqual([
      'apps/web/app/helpers/format-name.js {{format-name}} (helper)',
      'apps/web/lib/ui/addon/components/fancy-button.js <FancyButton>',
    ]);
    expect(byRelation(r, 'styles').sort()).toEqual(['apps/web/app/styles/components/_user-card.scss', 'apps/web/app/styles/utilities.scss']);
    expect(byRelation(r, 'test')).toEqual(['apps/web/tests/integration/components/user-card-test.gjs']);
    expect(byRelation(r, 'used by').sort()).toEqual(['apps/web/app/components/other.gjs', 'apps/web/app/templates/people.hbs']);
    expect(r.external).toEqual(['@glimmer/component']);
    expect(r.unresolved).toEqual(['<Hds::Thing>']);
  });

  test('follows imports more than one level deep', () => {
    write(monorepo);
    const r = relatedFiles({ root, path: 'apps/web/app/components/user-card.js', depth: 2 });
    expect(r.related.find((x) => x.path.endsWith('utils/deeper.js'))).toMatchObject({ relation: 'imports (level 2)', detail: "`./deeper` (util) via apps/web/app/utils/names.js" });
    expect(relatedFiles({ root, path: 'apps/web/app/components/user-card.js' }).related.some((x) => x.path.endsWith('deeper.js'))).toBe(false);
  });

  test('treats routes/x/index as its own route, not the parent', () => {
    write(monorepo);
    const r = relatedFiles({ root, path: 'apps/web/app/routes/people/index.js' });
    expect(r.unit.name).toBe('people/index');
    expect(r.related.map((x) => `${x.relation}: ${x.path}`).filter((x) => !x.startsWith('used'))).toEqual([
      'controller: apps/web/app/controllers/people/index.js',
      'route template: apps/web/app/templates/people/index.hbs',
    ]);
  });

  test('links a classic addon implementation, its app re-export and the host that uses it', () => {
    write(monorepo);
    const r = relatedFiles({ root, path: 'apps/web/lib/ui/addon/components/fancy-button.js' });
    expect(r.unit).toMatchObject({ kind: 'component', name: 'fancy-button', package: 'ui' });
    expect(byRelation(r, 'app re-export')).toEqual(['apps/web/lib/ui/app/components/fancy-button.js']);
    expect(byRelation(r, 'used by')).toContain('apps/web/app/components/user-card.hbs');
  });

  test('stays inside the root', () => {
    write(monorepo);
    expect(() => relatedFiles({ root, path: '../etc/passwd' })).toThrow(/inside/);
    expect(() => relatedFiles({ root, path: 'apps/web/missing.js' })).toThrow(/No file/);
  });
});

describe('importSpecifiers', () => {
  test('reads static, multi-line, type, re-export, side-effect and dynamic imports', () => {
    const src = [
      "import a from 'a';",
      "import {\n  b,\n  c,\n} from 'b/c';",
      "import type { T } from './t';",
      "export { default } from 'reexport';",
      "import 'side-effect';",
      "const x = await import('dyn');",
      "const s = 'from';",
      "export const y = 'not-an-import';",
    ].join('\n');
    expect(importSpecifiers(src)).toEqual(['a', 'b/c', './t', 'reexport', 'side-effect', 'dyn']);
  });
});

describe('templateInvocations', () => {
  test('finds components and dashed helpers, skipping built-ins, named blocks and local references', () => {
    const r = templateInvocations('<Foo::BarBaz @a={{format-date @d}} /><:body /><this.Thing /><@arg /><x.Y />{{#each-in @o as |k|}}{{/each-in}}{{t "x"}}(sub-expr 1){{component "lazy-thing"}}');
    expect(r.components).toEqual(['Foo::BarBaz']);
    expect(r.curlies.sort()).toEqual(['format-date', 'lazy-thing', 'sub-expr']);
  });
});
