import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describePackage, expandWorkspaces, parseRoutes, rootGuard, stripJsComments, visitedUrls, workspaceGlobs } from '../lib/setup-audit.js';

// Edge cases of the pure helpers behind the project setup audit.
let root;
let guard;
const write = (files) => {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof content === 'string' ? content : JSON.stringify(content));
  }
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'a11y-helpers-'));
  guard = rootGuard(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('stripJsComments', () => {
  test.each([
    ['a // c\nb', 'a     \nb'],
    ['a // c', 'a     '],
    ['a /* c */ b', `a${' '.repeat(9)}b`],
    ['a /* c\nd */ b', `a${' '.repeat(5)}\n${' '.repeat(5)}b`],
    ['a /* unterminated', `a${' '.repeat(16)}`],
    ["'//x' // y", "'//x'     "],
    ['"/*x*/" /*y*/', '"/*x*/"      '],
    ['`//${x}` //y', '`//${x}`    '],
    ["'it\\'s // x' // c", "'it\\'s // x'     "],
    ["'unterminated // x", "'unterminated // x"],
    ['a / b', 'a / b'],
    ['a /b/ c', 'a /b/ c'],
    ['x = /\'"/ // c', 'x = /\'"/     '],
    ['x = /\\/\\// // c', 'x = /\\/\\//     '],
    ['x = /[/]\'/ // c', 'x = /[/]\'/     '],
    ['f(/a\'/g) // c', 'f(/a\'/g)     '],
    ['return /\'/ // c', 'return /\'/     '],
    ['a / b // c\n/ d', 'a / b     \n/ d'],
    ['(a) / 2 / 3 // c', '(a) / 2 / 3     '],
    ['x = /unterminated\n// c', 'x = /unterminated\n    '],
    ['/', '/'],
    ['', ''],
  ])('%j', (src, want) => {
    expect(stripJsComments(src)).toBe(want);
    expect(stripJsComments(src)).toHaveLength(src.length);
  });
});

describe('parseRoutes', () => {
  test.each([
    ["this.route('a');", [{ name: 'a', path: '/a', hasChildren: false }]],
    ['this.route("a");', [{ name: 'a', path: '/a', hasChildren: false }]],
    ["this.route( 'a' , { path: '/x' } );", [{ name: 'a', path: '/x', hasChildren: false }]],
    ["this.route('a', { path: 'x' });", [{ name: 'a', path: '/x', hasChildren: false }]],
    ["this.route('a', { path: '' });", [{ name: 'a', path: '/', hasChildren: false }]],
    ["this.route('a', { path: '/' });", [{ name: 'a', path: '/', hasChildren: false }]],
    ['this.route(\'a\', { path: "q/:id" });', [{ name: 'a', path: '/q/:id', hasChildren: false }]],
    ["this.route('a', function () {});", [{ name: 'a', path: '/a', hasChildren: true }]],
    ["this.route('a', function (x) {});", [{ name: 'a', path: '/a', hasChildren: true }]],
    ["this.route('a', () => {});", [{ name: 'a', path: '/a', hasChildren: true }]],
    ["this.route('a', (x) => {});", [{ name: 'a', path: '/a', hasChildren: true }]],
    ["this.route('a', { path: '/p' }, function () { this.route('b'); });", [{ name: 'a', path: '/p', hasChildren: true }, { name: 'a.b', path: '/p/b', hasChildren: false }]],
    ["this.route('a', function () { this.route('b', function () { this.route('c'); }); this.route('d'); });", [
      { name: 'a', path: '/a', hasChildren: true },
      { name: 'a.b', path: '/a/b', hasChildren: true },
      { name: 'a.b.c', path: '/a/b/c', hasChildren: false },
      { name: 'a.d', path: '/a/d', hasChildren: false },
    ]],
    ["this.route('index', { path: '/' }, function () { this.route('x'); });", [{ name: 'index', path: '/', hasChildren: true }, { name: 'index.x', path: '/x', hasChildren: false }]],
    ["this.route('a'); this.route('b');", [{ name: 'a', path: '/a', hasChildren: false }, { name: 'b', path: '/b', hasChildren: false }]],
    ["this.mount('eng');", [{ name: 'eng', path: '/eng', hasChildren: true, engine: 'eng' }]],
    ["this.mount('eng', { as: 'e', path: 'ee' });", [{ name: 'e', path: '/ee', hasChildren: true, engine: 'eng' }]],
    ["this.mount('eng', { as: \"e\" });", [{ name: 'e', path: '/e', hasChildren: true, engine: 'eng' }]],
    ["this.mount('eng', { path: '/p' });", [{ name: 'eng', path: '/p', hasChildren: true, engine: 'eng' }]],
    ["this.route('a', function () { this.mount('eng'); });", [{ name: 'a', path: '/a', hasChildren: true }, { name: 'a.eng', path: '/a/eng', hasChildren: true, engine: 'eng' }]],
    ["this.route('a', { as: 'z' });", [{ name: 'a', path: '/a', hasChildren: false }]],
    ["this.other('a');", []],
    ['this.route(a);', []],
    ['', []],
  ])('%s', (src, want) => expect(parseRoutes(src)).toEqual(want));

  test('prefix and name prefix', () => {
    expect(parseRoutes("this.route('a');", '/base', 'ns')).toEqual([{ name: 'ns.a', path: '/base/a', hasChildren: false }]);
    expect(parseRoutes("this.route('a', { path: '/' });", '/base')).toEqual([{ name: 'a', path: '/base', hasChildren: false }]);
    expect(parseRoutes("this.route('a');", '/base/')).toEqual([{ name: 'a', path: '/base/a', hasChildren: false }]);
  });

  test('braces inside nested callbacks are balanced', () => {
    const src = "this.route('a', function () { if (x) { y(); } this.route('b'); }); this.route('c');";
    expect(parseRoutes(src).map((r) => r.name)).toEqual(['a', 'a.b', 'c']);
    expect(parseRoutes("this.route('a', function () { this.route('b'); ").map((r) => r.name)).toEqual(['a', 'a.b']);
  });
});

describe('visitedUrls', () => {
  test.each([
    ["visit('/a');", ['/a']],
    ['visit("/a");', ['/a']],
    ['visit( `/a` );', ['/a']],
    ["visit('/a?x=1');", ['/a']],
    ["visit('/a#x');", ['/a']],
    ["visit('?x=1');", ['/']],
    ["visit('');", ['/']],
    ['visit(`/a/${id}/b/${c.d}`);', ['/a/X/b/X']],
    ['visit(`/a/${id}?q=${x}`);', ['/a/X']],
    ["visitWithRedirect('/a');", ['/a']],
    ["visit_x('/a');", ['/a']],
    ["visit$x('/a');", []],
    ["visit1('/a');", []],
    ["visitor('/a');", []],
    ["revisit('/a');", []],
    ["visit(variable);", []],
    ["visit('/a'); visit('/b');", ['/a', '/b']],
    ["let p = '/x'; visit(p);", ['/x']],
    ['const p = `/x/${id}`; visit(p);', ['/x/X']],
    ["var p = '/x?q=1'; visit(p, {});", ['/x']],
    ["var p = '/x'; visitFoo(p);", ['/x']],
    ["let p = '/x'; visit( p );", ['/x']],
    ["let p = '/x'; foo(p);", []],
    ["let p = 'nope'; visit(p);", []],
    ["let p = '/x'; visit(q);", []],
    ["let p = '/x'; visit(p.length);", []],
    ["let p = '/x'; visit('/y', p);", ['/y']],
  ])('%s', (src, want) => expect(visitedUrls(src)).toEqual(want));

  test.each([
    ["visitable('/a');", ['/a']],
    ['visitable("/a/:id");', ['/a/X']],
    ["visitable('/a/:id/b/:c');", ['/a/X/b/X']],
    ["visitable('/a/:id?x');", ['/a/X']],
    ['visitable(`/a/${id}`);', ['/a/X']],
    ["visitable('');", ['/']],
    ["visit('/a');", []],
    ["let p = '/x'; visitable(p);", []],
    ["mvisitable('/a');", []],
  ])('page objects: %s', (src, want) => expect(visitedUrls(src, { pageObjects: true })).toEqual(want));
});

describe('workspaceGlobs', () => {
  test('pnpm-workspace.yaml forms', () => {
    write({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"libs/*\"  # comment\n  - tools/*\n  -   spaced/*\nother:\n  - nope\n" });
    expect(workspaceGlobs(root, guard)).toEqual(['apps/*', 'libs/*', 'tools/*', 'spaced/*']);
  });

  test('windows line endings and stop at next top-level key', () => {
    write({ 'pnpm-workspace.yaml': 'catalog:\r\n  - skip\r\npackages:\r\n  - a/*\r\n  - b/*\r\nnext: x\r\n  - c/*\r\n' });
    expect(workspaceGlobs(root, guard)).toEqual(['a/*', 'b/*']);
  });

  test('negations are kept', () => {
    write({ 'pnpm-workspace.yaml': "packages:\n  - 'a/*'\n  - '!a/skip'\n" });
    expect(workspaceGlobs(root, guard)).toEqual(['a/*', '!a/skip']);
  });

  test('"packages" must start the line', () => {
    write({ 'pnpm-workspace.yaml': ' packages:\n  - a/*\n', 'package.json': { workspaces: ['w/*'] } });
    expect(workspaceGlobs(root, guard)).toEqual(['w/*']);
  });

  test('falls back to package.json workspaces when the yaml has no packages', () => {
    write({ 'pnpm-workspace.yaml': 'packages:\n', 'package.json': { workspaces: ['w/*'] } });
    expect(workspaceGlobs(root, guard)).toEqual(['w/*']);
  });

  test('package.json workspaces: array, object, other, absent', () => {
    write({ 'package.json': { workspaces: ['a', 'b'] } });
    expect(workspaceGlobs(root, guard)).toEqual(['a', 'b']);
    write({ 'package.json': { workspaces: { packages: ['c'] } } });
    expect(workspaceGlobs(root, guard)).toEqual(['c']);
    write({ 'package.json': { workspaces: { nohoist: ['c'] } } });
    expect(workspaceGlobs(root, guard)).toBeNull();
    write({ 'package.json': { workspaces: 'a' } });
    expect(workspaceGlobs(root, guard)).toBeNull();
    write({ 'package.json': { name: 'x' } });
    expect(workspaceGlobs(root, guard)).toBeNull();
  });

  test('nothing at all', () => {
    expect(workspaceGlobs(root, guard)).toBeNull();
  });
});

describe('expandWorkspaces', () => {
  const pkgs = (...dirs) => write(Object.fromEntries(dirs.map((d) => [`${d}/package.json`, { name: d }])));
  const rel = (list) => list.map((d) => d.slice(root.length + 1));

  test('plain, star, question mark and prefix globs', () => {
    pkgs('apps/a', 'apps/b', 'apps/ab', 'libs/x', 'libs/xy');
    expect(rel(expandWorkspaces(root, ['apps/a'], guard))).toEqual(['apps/a']);
    expect(rel(expandWorkspaces(root, ['apps/*'], guard))).toEqual(['apps/a', 'apps/ab', 'apps/b']);
    expect(rel(expandWorkspaces(root, ['apps/a?'], guard))).toEqual(['apps/ab']);
    expect(rel(expandWorkspaces(root, ['apps/a*'], guard))).toEqual(['apps/a', 'apps/ab']);
    expect(rel(expandWorkspaces(root, ['libs/x?'], guard))).toEqual(['libs/xy']);
    expect(rel(expandWorkspaces(root, ['*/a'], guard))).toEqual(['apps/a']);
    expect(rel(expandWorkspaces(root, ['./apps/a/'], guard))).toEqual(['apps/a']);
  });

  test('regex metacharacters in a segment are literal', () => {
    pkgs('a.b/x', 'axb/x', 'a+b/x');
    expect(rel(expandWorkspaces(root, ['a.b/*'], guard))).toEqual(['a.b/x']);
    expect(rel(expandWorkspaces(root, ['a+b/*'], guard))).toEqual(['a+b/x']);
    expect(rel(expandWorkspaces(root, ['a.*/x'], guard))).toEqual(['a.b/x']);
  });

  test('globstar matches any depth, including zero', () => {
    pkgs('p/a', 'p/b/c', 'p/b/d/e');
    expect(rel(expandWorkspaces(root, ['p/**'], guard))).toEqual(['p/a', 'p/b/c', 'p/b/d/e']);
    expect(rel(expandWorkspaces(root, ['p/**/e'], guard))).toEqual(['p/b/d/e']);
    expect(rel(expandWorkspaces(root, ['**/c'], guard))).toEqual(['p/b/c']);
  });

  test('globstar depth is bounded', () => {
    pkgs('a/b/c/d/e/f/g/h/i/deep', 'a/b/c/d/e/shallow');
    const found = rel(expandWorkspaces(root, ['**'], guard));
    expect(found).toContain('a/b/c/d/e/shallow');
    expect(found).not.toContain('a/b/c/d/e/f/g/h/i/deep');
  });

  test('negation removes matches', () => {
    pkgs('apps/a', 'apps/b', 'apps/c');
    expect(rel(expandWorkspaces(root, ['apps/*', '!apps/b'], guard))).toEqual(['apps/a', 'apps/c']);
    expect(rel(expandWorkspaces(root, ['!apps/b', 'apps/*'], guard))).toEqual(['apps/a', 'apps/c']);
    expect(rel(expandWorkspaces(root, ['apps/*', '!apps/[bc]'], guard))).toEqual(['apps/a', 'apps/b', 'apps/c']);
    expect(rel(expandWorkspaces(root, ['apps/*', '!apps/*'], guard))).toEqual([]);
  });

  test('skips directories without a package.json and ignored directories', () => {
    pkgs('apps/a', 'apps/node_modules/x', 'apps/.hidden/x', 'apps/dist/x', 'apps/tmp/x', 'apps/.git/x');
    mkdirSync(join(root, 'apps/empty'), { recursive: true });
    expect(rel(expandWorkspaces(root, ['apps/*'], guard))).toEqual(['apps/a']);
    expect(rel(expandWorkspaces(root, ['apps/*/x'], guard))).toEqual([]);
    expect(rel(expandWorkspaces(root, ['apps/**'], guard))).toEqual(['apps/a']);
  });

  test('missing directories and duplicates', () => {
    pkgs('a');
    expect(expandWorkspaces(root, ['missing/*', 'nope'], guard)).toEqual([]);
    expect(rel(expandWorkspaces(root, ['a', 'a', '*'], guard))).toEqual(['a']);
    expect(expandWorkspaces(root, [], guard)).toEqual([]);
  });

  test('results are sorted', () => {
    pkgs('b', 'a', 'c');
    expect(rel(expandWorkspaces(root, ['c', 'a', 'b'], guard))).toEqual(['a', 'b', 'c']);
  });
});

describe('describePackage', () => {
  const dir = () => join(root, 'p');

  test('not an Ember package', () => {
    write({ 'p/package.json': { name: 'x' } });
    expect(describePackage(dir(), guard)).toBeNull();
    expect(describePackage(join(root, 'none'), guard)).toBeNull();
  });

  test.each([
    [{ name: 'a', devDependencies: { 'ember-source': '1' } }, [], 'app', true],
    [{ name: 'a', dependencies: { 'ember-source': '1' } }, [], 'app', true],
    [{ name: 'a', peerDependencies: { 'ember-source': '1' } }, [], 'app', true],
    [{ name: 'a', keywords: ['ember-addon'] }, ['index.js'], 'addon', false],
    [{ name: 'a', keywords: ['ember-addon'] }, ['addon/x.js'], 'addon', true],
    [{ name: 'a', keywords: ['ember-addon'] }, ['app/x.js'], 'addon', true],
    [{ name: 'a', keywords: ['ember-addon'] }, ['src/x.js'], 'addon', true],
    [{ name: 'a', keywords: ['ember-addon'], devDependencies: { 'ember-source': '1' } }, [], 'addon', true],
    [{ name: 'a', keywords: ['ember-addon', 'ember-engine'] }, [], 'engine', false],
    [{ name: 'a', keywords: ['ember-engine'] }, ['addon/x.js'], 'engine', true],
    [{ name: 'a', keywords: ['ember-addon'] }, ['app/router.js'], 'app', true],
    [{ name: 'a', keywords: ['ember-addon'] }, ['app/router.ts'], 'app', true],
    [{ name: 'a' }, ['app/router.js'], 'app', true],
    [{ name: 'a', keywords: ['ember-addon', 'ember-engine'] }, ['app/router.js'], 'engine', true],
  ])('%j %j', (pkg, files, kind, ui) => {
    write({ 'p/package.json': pkg, ...Object.fromEntries(files.map((f) => [`p/${f}`, ''])) });
    const d = describePackage(dir(), guard);
    expect(d).toEqual({ dir: dir(), name: 'a', kind, ui });
  });
});
