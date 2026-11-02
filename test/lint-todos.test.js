import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { a11yRuleName, parseLintTodo, todoStatus } from '../lib/lint-todos.js';
import { auditProjectSetup } from '../lib/setup-audit.js';
import { auditEmberTemplate, listA11yTodos } from '../lib/tools.js';

const PAST = Date.UTC(2021, 0, 1);
const FUTURE = Date.UTC(2099, 0, 1);
const op = (o, engine, rule, line, file, { warn = FUTURE, error = FUTURE, hash = `h${line}` } = {}) =>
  [o, engine, rule, line, 0, line, 10, hash, PAST, warn ?? '', error ?? '', file].join('|');

let root;
let prevRoot;
const write = (files) => {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof content === 'string' ? content : JSON.stringify(content));
  }
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ea11y-todo-')));
  prevRoot = process.env.EMBER_A11Y_ROOT;
  process.env.EMBER_A11Y_ROOT = root;
});
afterEach(() => {
  if (prevRoot === undefined) delete process.env.EMBER_A11Y_ROOT;
  else process.env.EMBER_A11Y_ROOT = prevRoot;
  rmSync(root, { recursive: true, force: true });
});

const TODOS = [
  op('add', 'ember-template-lint', 'require-input-label', 3, 'app/components/form.hbs'),
  op('add', 'ember-template-lint', 'no-invalid-interactive', 7, 'app/components/form.hbs', { warn: PAST }),
  op('add', 'ember-template-lint', 'require-valid-alt-text', 2, 'app/components/card.hbs', { warn: PAST, error: PAST }),
  op('add', 'eslint', 'ember/template-no-positive-tabindex', 4, 'app/components/tabs.gjs', { warn: null, error: null }),
  op('add', 'ember-template-lint', 'require-strict-mode', 1, 'app/components/form.hbs'),
  op('add', 'eslint', 'ember/no-classic-classes', 1, 'app/components/tabs.gjs'),
  op('add', 'ember-template-lint', 'no-redundant-role', 9, 'app/components/card.hbs'),
  op('remove', 'ember-template-lint', 'no-redundant-role', 9, 'app/components/card.hbs'),
  '<<<<<<< HEAD',
].join('\n');

const app = {
  'frontend/app/package.json': { name: 'web', devDependencies: { 'ember-source': '6' } },
  'frontend/app/.lint-todo': `${TODOS}\n`,
  'frontend/app/app/components/form.hbs': '<label>Name <input></label>\n',
  'frontend/app/app/components/card.hbs': '<p>x</p>\n',
};

describe('.lint-todo parsing', () => {
  test('replays add/remove operations and skips conflict markers', () => {
    const todos = parseLintTodo(TODOS);
    expect(todos.map((t) => t.ruleId)).toEqual([
      'require-input-label', 'no-invalid-interactive', 'require-strict-mode', 'require-valid-alt-text', 'ember/template-no-positive-tabindex', 'ember/no-classic-classes',
    ]);
    expect(parseLintTodo('add|eslint|r|1|0|1|1|h|0|||dir/a|b.js')[0].filePath).toBe('dir/a|b.js');
  });

  test('identifies a11y rules for both engines', () => {
    expect(a11yRuleName('ember-template-lint', 'require-input-label')).toBe('require-input-label');
    expect(a11yRuleName('eslint', 'ember/template-require-input-label')).toBe('require-input-label');
    expect(a11yRuleName('ember-template-lint', 'require-strict-mode')).toBeNull();
    expect(a11yRuleName('eslint', 'ember/no-classic-classes')).toBeNull();
  });

  test('status follows the decay dates', () => {
    expect(todoStatus({ warnDate: FUTURE, errorDate: FUTURE })).toBe('todo');
    expect(todoStatus({ warnDate: PAST, errorDate: FUTURE })).toBe('warn');
    expect(todoStatus({ warnDate: PAST, errorDate: PAST })).toBe('error');
    expect(todoStatus({})).toBe('todo');
  });
});

describe('list_a11y_todos', () => {
  test('lists only a11y todos with status, due dates and docs', () => {
    write(app);
    const r = listA11yTodos({ path: 'frontend/app' });
    expect(r.summary).toMatchObject({ total: 4, files: 3, byStatus: { todo: 2, warn: 1, error: 1 }, noDueDate: 1 });
    expect(r.todos.map((t) => [t.file, t.line, t.rule, t.status])).toEqual([
      ['frontend/app/app/components/card.hbs', 2, 'require-valid-alt-text', 'error'],
      ['frontend/app/app/components/form.hbs', 3, 'require-input-label', 'todo'],
      ['frontend/app/app/components/form.hbs', 7, 'no-invalid-interactive', 'warn'],
      ['frontend/app/app/components/tabs.gjs', 4, 'no-positive-tabindex', 'todo'],
    ]);
    expect(r.todos[3]).toMatchObject({ warnDate: null, errorDate: null, docs: expect.stringMatching(/eslint-plugin-ember.*template-no-positive-tabindex\.md$/) });
    expect(r.text).toMatch(/\| `require-input-label` \| 1 \|/);
  });

  test('filters by rule (either engine name), file and status', () => {
    write(app);
    expect(listA11yTodos({ path: 'frontend/app', rule: 'ember/template-no-positive-tabindex' }).todos).toHaveLength(1);
    expect(listA11yTodos({ path: 'frontend/app', file: 'frontend/app/app/components/form.hbs' }).todos).toHaveLength(2);
    expect(listA11yTodos({ path: 'frontend/app', status: 'past-due' }).todos.map((t) => t.status)).toEqual(['error', 'warn']);
    expect(listA11yTodos({ path: 'frontend/app', status: 'no-due-date' }).todos.map((t) => t.rule)).toEqual(['no-positive-tabindex']);
  });

  test('handles a missing or legacy .lint-todo', () => {
    write({ 'package.json': {} });
    expect(listA11yTodos({}).text).toMatch(/No .lint-todo file/);
    mkdirSync(join(root, '.lint-todo'));
    expect(listA11yTodos({}).text).toMatch(/legacy directory format/);
  });

  test('refuses paths outside the root', () => {
    expect(() => listA11yTodos({ path: '..' })).toThrow(/inside/);
  });
});

describe('a11y todos in other tools', () => {
  test('audit_ember_template notes hidden todos for the audited files', () => {
    write(app);
    const r = auditEmberTemplate({ path: 'frontend/app/app/components/form.hbs' });
    expect(r.todos.map((t) => t.rule)).toEqual(['require-input-label', 'no-invalid-interactive']);
    expect(r.text).toMatch(/Deferred a11y lint todos \(2 in 1 file\(s\)\)/);
    expect(auditEmberTemplate({ source: '<p>x</p>' }).todos).toBeUndefined();
  });

  test('audit_project_setup reports todos, missing due dates and disabled decay', () => {
    write({ ...app, 'frontend/app/.lint-todorc.js': "module.exports = { 'ember-template-lint': { daysToDecay: null } };\n" });
    const r = auditProjectSetup({ root, path: 'frontend/app' });
    const msgs = r.checks.filter((c) => c.area === 'lint-todos').map((c) => c.message);
    expect(msgs).toEqual([
      expect.stringMatching(/^4 a11y violation\(s\) in 3 file\(s\) are deferred as lint todos: 2 hidden, 2 past due\. Rules: /),
      '1 a11y todo(s) have no due date, so they stay hidden indefinitely.',
      'Todo decay is disabled (`daysToDecay: null`) in frontend/app/.lint-todorc.js, so new todos never resurface.',
    ]);
  });

  test('audit_project_setup passes when todos exist only for non-a11y rules', () => {
    write({ 'package.json': { devDependencies: { 'ember-source': '6' } }, '.lint-todo': `${op('add', 'ember-template-lint', 'require-strict-mode', 1, 'app/a.hbs')}\n` });
    const r = auditProjectSetup({ root });
    expect(r.checks.find((c) => c.area === 'lint-todos')).toMatchObject({ status: 'pass', message: '.lint-todo has no todos for a11y rules.' });
  });
});
