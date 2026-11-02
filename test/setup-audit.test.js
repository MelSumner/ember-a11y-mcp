import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { auditProjectSetup, expandWorkspaces, parseRoutes, rootGuard, stripJsComments, visitedUrls } from '../lib/setup-audit.js';

let root;
const write = (files) => {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof content === 'string' ? content : JSON.stringify(content));
  }
};
const statuses = (r, area) => r.checks.filter((c) => c.area === area).map((c) => c.status);
const find = (r, re) => r.checks.find((c) => re.test(c.message));

const ROUTER = `import EmberRouter from '@ember/routing/router';
export default class Router extends EmberRouter {}
Router.map(function () {
  this.route('about');
  this.route('posts', function () {
    this.route('show', { path: '/:post_id' });
  });
  this.route('settings', { path: '/account/settings' });
});
`;

const goodApp = {
  'package.json': {
    name: 'good-app',
    packageManager: 'pnpm@10.0.0',
    scripts: { 'lint:hbs': 'ember-template-lint .', 'lint:a11y': 'ember-a11y-lint app' },
    devDependencies: {
      'ember-source': '^6.0.0', 'ember-template-lint': '^7.0.0', 'ember-a11y-testing': '^7.0.0', '@ember/test-helpers': '^5.0.0',
      'eslint-plugin-ember': '^12.0.0', 'ember-a11y-mcp': '^0.1.0',
    },
  },
  '.template-lintrc.js': "module.exports = { extends: 'recommended', rules: { 'no-bare-strings': 'off' } };\n",
  'app/router.js': ROUTER,
  'app/components/ok.hbs': '<button type="button">Save</button>\n{{! template-lint-disable no-bare-strings }}\n',
  'tests/test-helper.js': "import { setupGlobalA11yHooks } from 'ember-a11y-testing/test-support';\nsetupGlobalA11yHooks(() => true);\n",
  'tests/acceptance/pages-test.js': "await visit('/');\nawait visit('/about');\nawait visit(`/posts/${post.id}`);\nawait visit('/account/settings?tab=2');\n",
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ea11y-setup-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('auditProjectSetup', () => {
  test('passes a well-configured app', () => {
    write(goodApp);
    const r = auditProjectSetup({ root });
    expect(r.summary).toMatchObject({ fail: 0, warn: 0 });
    expect(r.project).toMatchObject({ name: 'good-app', ember: true, kind: 'app', packageManager: 'pnpm' });
    expect(find(r, /routes are visited/).message).toMatch(/^5\/5 routes/);
    expect(r.text).toMatch(/Nothing was changed/);
  });

  test('reports missing packages, weakened rules, disables and uncovered routes', () => {
    write({
      'package.json': { name: 'bad-app', dependencies: { 'ember-source': '^6.0.0', 'ember-template-lint': '^7.0.0' } },
      'yarn.lock': '',
      '.template-lintrc.js': "module.exports = {\n  extends: 'recommended',\n  rules: {\n    'require-input-label': 'off',\n    'no-invalid-role': ['warn'],\n    'no-duplicate-id': false,\n  },\n};\n",
      'app/router.js': ROUTER,
      'app/components/x.hbs': '{{! template-lint-disable require-valid-alt-text }}\n{{!-- template-lint-disable --}}\n{{! ember-a11y-disable-next-line accessible-name }}\n<img src="a.png">\n',
      'tests/test-helper.js': "import { start } from 'ember-qunit';\nstart();\n",
      'tests/acceptance/about-test.js': "import { a11yAudit } from 'ember-a11y-testing/test-support';\nawait visit('/about');\nawait a11yAudit();\n",
      'tests/acceptance/posts-test.js': "await visit('/posts');\n",
      'tests/integration/x-test.js': "user.update({ twoFactor: { enabled: false } });\nserver.create('config', { auditTrails: { enabled: false } });\nawait a11yAudit({\n  rules: { 'color-contrast': { enabled: false }, dlitem: { enabled: false } },\n});\n",
    });
    const r = auditProjectSetup({ root });
    expect(r.project.packageManager).toBe('yarn');
    expect(find(r, /ember-template-lint` is in dependencies/).status).toBe('warn');
    expect(find(r, /ember-a11y-testing` is not installed/)).toMatchObject({ status: 'fail', fix: 'yarn add --dev ember-a11y-testing' });
    expect(r.checks.filter((c) => c.area === 'template-lint' && c.status === 'fail').map((c) => [c.message, c.line])).toEqual([
      ["a11y rule `no-duplicate-id` is set to false.", 6],
      ["a11y rule `no-invalid-role` is set to 'warn'.", 5],
      ["a11y rule `require-input-label` is set to 'off'.", 4],
    ]);
    expect(find(r, /inline a11y rule disable/).locations).toEqual([
      'app/components/x.hbs:1 (template-lint: require-valid-alt-text)',
      'app/components/x.hbs:2 (template-lint: (all rules))',
      'app/components/x.hbs:3 (ember-a11y-lint: accessible-name)',
    ]);
    expect(find(r, /without a matching enable/)).toMatchObject({
      status: 'warn',
      locations: ['app/components/x.hbs:1 (template-lint-disable require-valid-alt-text)', 'app/components/x.hbs:2 (template-lint-disable (all rules))'],
    });
    expect(find(r, /does not call `setupGlobalA11yHooks`/).status).toBe('info');
    expect(find(r, /axe rule\(s\) disabled/).locations).toEqual(['tests/integration/x-test.js:4 (color-contrast)', 'tests/integration/x-test.js:4 (dlitem)']);
    const coverage = find(r, /routes are visited/);
    expect(coverage.message).toMatch(/^1\/5 routes/);
    expect(coverage.locations).toEqual(['index (/)', 'posts (/posts)', 'posts.show (/posts/:post_id)', 'settings (/account/settings)']);
    expect(r.text).toMatch(/## Next steps\n1\. yarn add --dev ember-a11y-testing\n/);
  });

  test('disables closed by a matching enable are not reported as unmatched', () => {
    write({
      ...goodApp,
      'app/components/a.hbs': "{{! template-lint-disable 'no-invalid-interactive' no-bare-strings }}\n<li></li>\n{{! template-lint-enable no-invalid-interactive }}\n{{! ember-a11y-disable no-autofocus }}\n{{! ember-a11y-enable }}\n",
      'app/components/c.hbs': '<li {{! template-lint-disable "no-invalid-interactive" }}\n  {{on "click" this.go}}></li>\n<ul {{! template-lint-disable-tree no-invalid-interactive }}><li></li></ul>\n',
      'app/components/d.hbs': '<section>\n  {{! template-lint-disable no-invalid-interactive }}\n  <li></li>\n</section>\n',
      'app/components/b.hbs': '{{! ember-a11y-disable no-autofocus }}\n<input autofocus>\n{{! ember-a11y-enable accessible-name }}\n',
    });
    expect(find(auditProjectSetup({ root }), /without a matching enable/).locations).toEqual([
      'app/components/b.hbs:1 (ember-a11y-disable no-autofocus)',
      'app/components/d.hbs:2 (template-lint-disable no-invalid-interactive, until </section> on line 4)',
    ]);
  });

  test('treats a package with ember-addon.paths (in-repo addons) and a router as an app', () => {
    write({ 'package.json': { devDependencies: { 'ember-source': '6' }, 'ember-addon': { paths: ['lib/flags'] }, keywords: ['ember-addon'] }, 'app/router.js': ROUTER });
    const r = auditProjectSetup({ root });
    expect(r.project.kind).toBe('app');
    expect(statuses(r, 'route-coverage')).toEqual(['fail']);
  });

  test('fails when the template-lint config is missing', () => {
    write({ 'package.json': { devDependencies: { 'ember-source': '6', 'ember-template-lint': '7' } } });
    expect(statuses(auditProjectSetup({ root }), 'template-lint')).toEqual(['fail']);
  });

  test('lists Ember packages in a monorepo root and audits a chosen one', () => {
    write({
      'package.json': { name: 'monorepo', private: true },
      'packages/web/package.json': { name: 'web', devDependencies: { 'ember-source': '6' } },
      'packages/ui/package.json': { name: 'ui', keywords: ['ember-addon'] },
      'packages/ui/addon/components/x.hbs': '<p>x</p>\n',
      'packages/flags/package.json': { name: 'flags', keywords: ['ember-addon'] },
      'packages/flags/index.js': 'module.exports = {};\n',
      'packages/api/package.json': { name: 'api' },
    });
    const r = auditProjectSetup({ root });
    expect(find(r, /not an Ember app or addon/).fix).toBe('Re-run with `path` set to one of: packages/ui (addon), packages/web (app).');
    expect(r.checks).toHaveLength(1);
    const ui = auditProjectSetup({ root, path: 'packages/ui' });
    expect(ui.project).toMatchObject({ name: 'ui', kind: 'addon' });
    expect(statuses(ui, 'route-coverage')).toEqual([]);
  });

  test('discovers monorepo packages from pnpm-workspace.yaml, honoring globs and negation', () => {
    write({
      'package.json': { name: 'mono', private: true },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"libs/**\"\n  - '!libs/legacy'\nonlyBuiltDependencies:\n  - esbuild\n",
      'apps/web/package.json': { name: 'web', devDependencies: { 'ember-source': '6' } },
      'libs/a/b/package.json': { name: 'deep', devDependencies: { 'ember-source': '6' } },
      'libs/legacy/package.json': { name: 'legacy', devDependencies: { 'ember-source': '6' } },
      'deep/x/y/z/package.json': { name: 'not-in-workspace', devDependencies: { 'ember-source': '6' } },
    });
    expect(expandWorkspaces(root, ['apps/*', 'libs/**', '!libs/legacy'], rootGuard(root)).map((d) => relative(root, d))).toEqual(['apps/web', 'libs/a/b']);
    expect(find(auditProjectSetup({ root }), /not an Ember app/).fix).toBe('Re-run with `path` set to one of: apps/web (app), libs/a/b (app).');
  });

  test('reports in-repo addons and audits templates in ones outside the app directory', () => {
    const app = Object.fromEntries(Object.entries(goodApp).map(([k, v]) => [`apps/web/${k}`, v]));
    write({
      ...app,
      'apps/web/package.json': { ...goodApp['package.json'], 'ember-addon': { paths: ['lib/flags', '../../packages/shared-ui'] } },
      'apps/web/lib/flags/package.json': { name: 'flags', keywords: ['ember-addon'] },
      'apps/web/lib/flags/index.js': 'module.exports = {};\n',
      'packages/shared-ui/package.json': { name: 'shared-ui', keywords: ['ember-addon'] },
      'packages/shared-ui/addon/components/x.hbs': '{{! template-lint-disable no-invalid-interactive }}\n',
    });
    const r = auditProjectSetup({ root, path: 'apps/web' });
    expect(find(r, /in-repo addon/).locations).toEqual(['apps/web/lib/flags — `flags` (build-only)', 'packages/shared-ui — `shared-ui` (has UI)']);
    expect(r.checks.find((c) => c.area === 'suppressions').locations.some((l) => l.includes('shared-ui'))).toBe(true);
  });

  test('includes routes of mounted Ember engines in route coverage', () => {
    write({
      ...goodApp,
      'package.json': { ...goodApp['package.json'], dependencies: { 'ember-engines': '0.11', billing: '*' }, 'ember-addon': { paths: ['lib/admin'] } },
      'app/router.js': `Router.map(function () {
  this.route('about');
  this.route('settings', function () {
    this.mount('admin', { as: 'adm', path: '/manage' });
  });
  this.mount('billing');
  this.mount('missing-engine', { path: '/gone' });
});
`,
      'lib/admin/package.json': { name: 'admin', keywords: ['ember-addon', 'ember-engine'] },
      'lib/admin/addon/routes.js': "import buildRoutes from 'ember-engines/routes';\nexport default buildRoutes(function () {\n  this.route('users', function () { this.route('user', { path: '/:id' }); });\n});\n",
      'node_modules/billing/package.json': { name: 'billing', keywords: ['ember-addon', 'ember-engine'] },
      'node_modules/billing/addon/routes.ts': "export default buildRoutes(() => {\n  this.route('invoices');\n});\n",
      'tests/acceptance/a-test.js': "import { a11yAudit } from 'ember-a11y-testing/test-support';\nvisit('/about'); visit('/settings/manage/users/1'); a11yAudit();\n",
    });
    const r = auditProjectSetup({ root });
    expect(find(r, /Uses Ember engines/).message).toContain('`admin`, `billing`');
    const cov = r.checks.find((c) => c.area === 'route-coverage' && c.status !== 'info');
    const missing = cov.locations.join('\n');
    expect(missing).toContain('billing.invoices (/billing/invoices)');
    expect(missing).not.toContain('settings.adm.users.user');
    expect(find(r, /Couldn't find the routes/).locations).toEqual(['missing-engine (mounted at /gone)']);
  });

  test('finds acceptance tests at any depth and counts visit* helpers and imported page objects', () => {
    const deep = 'tests/acceptance/a/b/c/d/e/f/g/deep-test.js';
    write({
      ...goodApp,
      'tests/test-helper.js': "import { start } from 'ember-qunit';\nstart();\n",
      'app/router.js': "Router.map(function () {\n  this.route('about');\n  this.route('login', function () { this.route('sso'); this.route('link'); this.route('help'); });\n  this.route('posts', { path: '/posts/:id' });\n  this.route('settings');\n});\n",
      'tests/pages/login/sso.js': "import { create, visitable } from 'ember-cli-page-object';\nexport default create({ visit: visitable(\n  '/login/sso'\n) });\n",
      'tests/pages/posts.js': "export default create({ visit: visitable('/posts/:id') });\n",
      'tests/pages/link.js': "import { visit } from '@ember/test-helpers';\nexport default { visit: () => { let path = '/login/link'; return visit(path); } };\n",
      'tests/pages/settings.js': "export default create({ visit: visitable('/settings') });\n",
      'tests/acceptance/login-test.js': "import { a11yAudit } from 'ember-a11y-testing/test-support';\nimport sso from 'good-app/tests/pages/login/sso';\nimport link from '../pages/link';\nawait visitWithRedirect('/login');\nawait sso.visit();\nawait link.visit();\nawait a11yAudit();\n",
      [deep]: "import { a11yAudit } from 'ember-a11y-testing/test-support';\nimport posts from 'good-app/tests/pages/posts';\nawait visit(`/about`);\nawait a11yAudit();\n",
      // Page object imported only by a test that doesn't run axe: not covered.
      'tests/acceptance/settings-test.js': "import settings from 'good-app/tests/pages/settings';\nawait settings.visit();\nawait visit('/login/help');\n",
    });
    const r = auditProjectSetup({ root });
    const cov = r.checks.find((c) => c.area === 'route-coverage');
    expect(cov.message).toMatch(/\(4 acceptance file\(s\)\)/);
    expect(cov.locations).toEqual(['index (/)', 'login.help (/login/help)', 'settings (/settings)']);
  });

  test('recognises quoted and multiple rule names in inline disables', () => {
    write({
      ...goodApp,
      'app/components/ok.hbs': '<li {{! template-lint-disable "no-invalid-interactive" }}></li>\n{{!-- template-lint-disable \'no-bare-strings\', "require-valid-alt-text" --}}\n{{! template-lint-disable "no-bare-strings" }}\n',
    });
    expect(find(auditProjectSetup({ root }), /inline a11y rule disable/).locations).toEqual([
      'app/components/ok.hbs:1 (template-lint: no-invalid-interactive)',
      'app/components/ok.hbs:2 (template-lint: no-bare-strings, require-valid-alt-text)',
    ]);
  });

  test('ignores commented-out config rules and reports overrides with their file scope', () => {
    write({
      ...goodApp,
      '.template-lintrc.js': `module.exports = {
  extends: 'recommended',
  rules: {
    // 'no-autofocus-attribute': false,
    /* 'require-input-label': 'off', */
    'link-rel-noopener': 'error', // see https://example.com/x
    'no-duplicate-id': false,
  },
  overrides: [
    { files: ['tests/**'], rules: { 'no-invalid-role': 'off' } },
    { files: ['app/legacy/**'], rules: { 'require-valid-alt-text': ['warn'] } },
  ],
};
`,
    });
    const tl = auditProjectSetup({ root }).checks.filter((c) => c.area === 'template-lint' && c.status !== 'pass').map((c) => [c.status, c.message, c.line]);
    expect(tl).toEqual([
      ['fail', 'a11y rule `no-duplicate-id` is set to false.', 7],
      ['info', "a11y rule `no-invalid-role` is set to 'off' for tests/** (overrides).", 10],
      ['warn', "a11y rule `require-valid-alt-text` is set to 'warn' for app/legacy/** (overrides).", 11],
    ]);
    expect(stripJsComments("a: 'http://x', // c\n/* d */ b")).toBe("a: 'http://x',     \n        b");
  });

  test('suggests runnable next steps with paths relative to the root', () => {
    write({
      'package.json': { name: 'mono', private: true, workspaces: ['packages/*', 'apps/*'] },
      'packages/ui/package.json': { name: 'ui', keywords: ['ember-addon'], 'ember-addon': { version: 2 }, devDependencies: { 'ember-source': '6', 'ember-template-lint': '7' } },
      'packages/ui/src/components/x.hbs': '<p>x</p>\n',
      'packages/ui/.template-lintrc.js': "module.exports = { extends: 'recommended' };\n",
      'apps/docs/package.json': { name: 'docs', devDependencies: { 'ember-source': '6', ui: 'workspace:*', 'ember-a11y-testing': '7' } },
      'apps/docs/tests/test-helper.js': 'setupGlobalA11yHooks(() => true);\n',
      'apps/other/package.json': { name: 'other', devDependencies: { 'ember-source': '6' } },
      'apps/other/tests/test-helper.js': '',
    });
    const r = auditProjectSetup({ root, path: 'packages/ui' });
    expect(r.text).not.toMatch(/add --save-dev ember-a11y-mcp|ember-a11y-lint app|app\/components/);
    expect(r.text).toMatch(/not published to npm yet/);
    expect(r.text).toMatch(/"lint:a11y": "ember-a11y-lint src"/);
    expect(r.text).toMatch(/Then run `audit_ember_template` on packages\/ui\/src\./);
    // Tests live in the workspace app that depends on the addon.
    expect(r.project.testApps).toEqual(['apps/docs']);
    expect(find(r, /ember-a11y-testing` is not installed here; tests live in apps\/docs/).status).toBe('info');
    expect(find(r, /its tests live in apps\/docs/).status).toBe('info');
    expect(r.checks.filter((c) => c.status === 'fail').map((c) => c.message)).toEqual([]);

    write({ 'apps/docs/package.json': { name: 'docs', devDependencies: { 'ember-source': '6' } } });
    const alone = auditProjectSetup({ root, path: 'packages/ui' });
    expect(find(alone, /ember-a11y-testing` is not installed \(/).status).toBe('fail');
    expect(find(alone, /No tests\/test-helper/).status).toBe('warn');

    write(Object.fromEntries(Object.entries(goodApp).map(([k, v]) => [`apps/web/${k}`, v])));
    expect(auditProjectSetup({ root, path: 'apps/web' }).text).toMatch(/Then run `audit_ember_template` on apps\/web\/app\/components\./);
  });

  test('truncates long lists with "…and N more" and reports the full count', () => {
    write({ ...goodApp, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`app/components/c${i}.hbs`, '{{! template-lint-disable no-invalid-interactive }}\n'])) });
    const s = find(auditProjectSetup({ root }), /inline a11y rule disable/);
    expect(s.count).toBe(30);
    expect(s.locations).toHaveLength(26);
    expect(s.locations.at(-1)).toBe('…and 5 more');
  });

  test('survives dangling symlinks, symlink loops and links outside the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ea11y-out-'));
    try {
      writeFileSync(join(outside, 'outside-test.js'), "visit('/about'); a11yAudit();\n");
      write(goodApp);
      for (const d of ['tests/acceptance', 'app/components']) {
        symlinkSync(join(root, d, 'missing'), join(root, d, 'dangling'));
        symlinkSync(join(root, d), join(root, d, 'loop'));
        symlinkSync(outside, join(root, d, 'outside'));
      }
      const r = auditProjectSetup({ root });
      expect(find(r, /routes are visited/).message).toMatch(/\(1 acceptance file\(s\)\)/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('stays inside the root, including through symlinks', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ea11y-out-'));
    try {
      write({ 'package.json': { devDependencies: { 'ember-source': '6' } } });
      symlinkSync(outside, join(root, 'link'));
      expect(() => auditProjectSetup({ root, path: '../' })).toThrow(/inside/);
      expect(() => auditProjectSetup({ root, path: 'link' })).toThrow(/inside/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('route helpers', () => {
  test('parseRoutes handles nesting, custom paths and arrow callbacks', () => {
    expect(parseRoutes("this.route('a', () => { this.route('b', { path: 'bee/:id' }); }); this.route('c', { resetNamespace: true });")).toEqual([
      { name: 'a', path: '/a', hasChildren: true },
      { name: 'a.b', path: '/a/bee/:id', hasChildren: false },
      { name: 'c', path: '/c', hasChildren: false },
    ]);
  });

  test('visitedUrls strips query strings and fills template placeholders', () => {
    expect(visitedUrls("visit('/a?x=1'); visit(\"/b#h\"); visit(`/c/${id}/d`); visit('')")).toEqual(['/a', '/b', '/c/X/d', '/']);
    expect(visitedUrls("visitWithRedirect('/r'); visitable('/p/:id'); this.visitPage(a, b); visitor('/no');")).toEqual(['/r']);
    expect(visitedUrls("visitable('/p/:id/x')", { pageObjects: true })).toEqual(['/p/X/x']);
  });
});
