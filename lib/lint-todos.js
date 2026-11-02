import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// ember-template-lint rules that must stay at 'error'. Matches the a11y-config skill's rule-checks.md.
// eslint-plugin-ember ports each one as `ember/template-<rule>`.
export const TEMPLATE_LINT_A11Y_RULES = [
  'link-href-attributes', 'no-abstract-roles', 'no-accesskey-attribute', 'no-aria-hidden-body', 'no-aria-unsupported-elements',
  'no-autofocus-attribute', 'no-duplicate-attributes', 'no-duplicate-id', 'no-duplicate-landmark-elements', 'no-empty-headings',
  'no-heading-inside-button', 'no-invalid-aria-attributes', 'no-invalid-interactive', 'no-invalid-link-text', 'no-invalid-link-title',
  'no-invalid-meta', 'no-invalid-role', 'no-nested-interactive', 'no-nested-landmark', 'no-obsolete-elements',
  'no-pointer-down-event-binding', 'no-positive-tabindex', 'no-redundant-role', 'no-scope-outside-table-headings',
  'no-unsupported-role-attributes', 'no-whitespace-for-layout', 'no-whitespace-within-word', 'require-aria-activedescendant-tabindex',
  'require-context-role', 'require-iframe-title', 'require-input-label', 'require-lang-attribute', 'require-mandatory-role-attributes',
  'require-media-caption', 'require-presentational-children', 'require-valid-alt-text', 'table-groups',
];
const A11Y = new Set(TEMPLATE_LINT_A11Y_RULES);

/** Returns the template-lint rule name if this engine/rule pair is an a11y rule, otherwise null. */
export function a11yRuleName(engine, ruleId) {
  if (engine === 'ember-template-lint') return A11Y.has(ruleId) ? ruleId : null;
  if (engine === 'eslint') {
    const m = /^ember\/template-(.+)$/.exec(ruleId);
    return m && A11Y.has(m[1]) ? m[1] : null;
  }
  return null;
}

export function ruleDocs(engine, ruleId) {
  return engine === 'eslint'
    ? `https://github.com/ember-cli/eslint-plugin-ember/blob/master/docs/rules/${ruleId.replace(/^ember\//, '')}.md`
    : `https://github.com/ember-template-lint/ember-template-lint/blob/main/docs/rule/${ruleId}.md`;
}

const CONFLICT = /^(<{7}|={7}|>{7})/;
const num = (s) => (s ? Number.parseInt(s, 10) : undefined);
const isoDate = (ms) => (ms === undefined || Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10));
const todayUtc = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/**
 * Parse the operations log written by @lint-todo/utils (`add|engine|rule|line|col|endLine|endCol|hash|created|warn|error|file`)
 * and replay add/remove operations, matching on engine, rule, range and source hash as @lint-todo/utils does.
 */
export function parseLintTodo(contents) {
  const byFile = new Map();
  const key = (t) => [t.engine, t.ruleId, t.line, t.column, t.endLine, t.endColumn, t.source].join('|');
  for (const raw of contents.split(/\r?\n/)) {
    if (!raw || CONFLICT.test(raw)) continue;
    const [operation, engine, ruleId, line, column, endLine, endColumn, source, created, warn, error, ...file] = raw.split('|');
    if ((operation !== 'add' && operation !== 'remove') || !file.length) continue;
    const todo = {
      engine, ruleId, filePath: file.join('|'),
      line: num(line), column: num(column), endLine: num(endLine), endColumn: num(endColumn), source,
      createdDate: num(created), warnDate: num(warn), errorDate: num(error),
    };
    if (!byFile.has(todo.filePath)) byFile.set(todo.filePath, new Map());
    const todos = byFile.get(todo.filePath);
    if (operation === 'add' && !todos.has(key(todo))) todos.set(key(todo), todo);
    if (operation === 'remove') todos.delete(key(todo));
  }
  return [...byFile.values()].flatMap((m) => [...m.values()]);
}

/** 'todo' while hidden from lint output; 'warn'/'error' once a decay date has passed (lint reports it again). */
export function todoStatus(todo, today = todayUtc()) {
  if (todo.errorDate !== undefined && today > todo.errorDate) return 'error';
  if (todo.warnDate !== undefined && today > todo.warnDate) return 'warn';
  return 'todo';
}

function decayDisabled(dir, guard) {
  const pkg = guard.real(join(dir, 'package.json'));
  let lintTodo;
  try {
    lintTodo = pkg ? JSON.parse(readFileSync(pkg, 'utf8')).lintTodo : undefined;
  } catch {
    lintTodo = undefined;
  }
  const engines = [];
  if (lintTodo) {
    if (lintTodo.daysToDecay === null) engines.push('all');
    for (const e of ['ember-template-lint', 'eslint']) if (lintTodo[e]?.daysToDecay === null) engines.push(e);
    return { file: relative(guard.root, pkg), engines };
  }
  // Read .lint-todorc.js as text; never execute project code.
  const rc = guard.real(join(dir, '.lint-todorc.js'));
  if (rc && /daysToDecay\s*:\s*null/.test(readFileSync(rc, 'utf8'))) return { file: relative(guard.root, rc), engines: ['unknown'] };
  return null;
}

/** Find the nearest directory at or above `start` (inside the root) that has a .lint-todo file or directory. */
export function findTodoDir(start, guard) {
  for (let d = start; d === guard.root || d.startsWith(guard.root + sep); d = dirname(d)) {
    if (existsSync(join(d, '.lint-todo')) && guard.real(join(d, '.lint-todo'))) return d;
    if (d === guard.root) break;
  }
  return null;
}

/**
 * Read a11y todos for the package in `dir`. File paths in the result are relative to the audit root.
 * Returns null when there is no .lint-todo; `{ legacy: true }` for the pre-v2 .lint-todo/ directory format.
 */
export function readA11yTodos(dir, guard, { today } = {}) {
  const base = findTodoDir(dir, guard);
  if (!base) return null;
  const storage = join(base, '.lint-todo');
  const file = relative(guard.root, storage);
  if (lstatSync(storage).isDirectory()) return { file, legacy: true, todos: [], decay: decayDisabled(base, guard) };
  const todos = parseLintTodo(readFileSync(storage, 'utf8'))
    .map((t) => ({ ...t, rule: a11yRuleName(t.engine, t.ruleId) }))
    .filter((t) => t.rule)
    .map((t) => ({
      file: relative(guard.root, join(base, t.filePath)),
      line: t.line,
      column: t.column,
      engine: t.engine,
      ruleId: t.ruleId,
      rule: t.rule,
      status: todoStatus(t, today),
      created: isoDate(t.createdDate),
      warnDate: isoDate(t.warnDate),
      errorDate: isoDate(t.errorDate),
      docs: ruleDocs(t.engine, t.ruleId),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { file, legacy: false, todos, decay: decayDisabled(base, guard) };
}

export function summarizeTodos(todos) {
  const byRule = {};
  const byStatus = { todo: 0, warn: 0, error: 0 };
  let noDueDate = 0;
  for (const t of todos) {
    byRule[t.rule] = (byRule[t.rule] ?? 0) + 1;
    byStatus[t.status]++;
    if (!t.warnDate && !t.errorDate) noDueDate++;
  }
  return { total: todos.length, files: new Set(todos.map((t) => t.file)).size, byStatus, noDueDate, byRule };
}

export const formatTodo = (t) =>
  `${t.file}:${t.line}:${t.column} \`${t.ruleId}\` (${t.engine}) — ${t.status === 'todo' ? 'hidden' : `past ${t.status} date, reported as ${t.status}`}${t.errorDate ? `, due ${t.errorDate}` : t.warnDate ? `, warns ${t.warnDate}` : ', no due date'}`;

/** Map of root-relative file path → a11y todos, for the given absolute file paths. */
export function a11yTodosForFiles(files, guard) {
  const cache = new Map();
  const out = new Map();
  for (const f of files) {
    const base = findTodoDir(dirname(f), guard);
    if (!base) continue;
    if (!cache.has(base)) cache.set(base, readA11yTodos(base, guard)?.todos ?? []);
    const rel = relative(guard.root, f);
    const todos = cache.get(base).filter((t) => t.file === rel);
    if (todos.length) out.set(rel, todos);
  }
  return out;
}
