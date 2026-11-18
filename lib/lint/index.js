import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { parseTemplates, mapPosition } from './parse.js';
import { buildTree } from './model.js';
import { rules, WCAG } from './rules.js';
import { componentTemplateResolver } from '../related-files.js';

export { rules };

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mustache (and, for ember-a11y, HTML) comments in document order, with where they sit in the tree. */
function templateComments(source, filename) {
  const out = [];
  for (const tpl of parseTemplates(source, { filename })) {
    if (!tpl.ast) return null;
    const pos = (p) => mapPosition(p, tpl.offset);
    const lines = (n) => ({ startLine: pos(n.loc.start).line, endLine: pos(n.loc.end).line });
    const add = (c, where) => out.push({ value: c.value, ...pos(c.loc.start), ...where });
    // `parent` is the element whose children we are in; a {{#block}} resets it, because
    // ember-template-lint never closes a disable that sits directly inside a block.
    const walk = (nodes, parent) => {
      for (const n of nodes ?? []) {
        if (n.type === 'MustacheCommentStatement' || n.type === 'CommentStatement') add(n, { parent });
        else if (n.type === 'ElementNode') {
          const el = { tag: n.tag, ...lines(n) };
          for (const c of n.comments ?? []) add(c, { element: el });
          walk(n.children, el);
        } else if (n.type === 'BlockStatement') {
          walk(n.program?.body, null);
          walk(n.inverse?.body, null);
        }
      }
    };
    walk(tpl.ast.body, null);
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Inline disable/enable comments for a tool prefix (`ember-a11y` or `template-lint`), scoped the way ember-template-lint 7 scopes them:
 * - inside an opening tag (`<li {{! …-disable rule }}>`): that element only; `-disable-tree`: the element and its descendants;
 * - inside an element's body: until the matching `-enable`, or until that element closes;
 * - at the top level or directly inside a {{#block}}: until the matching `-enable`, or the end of the file.
 * A bare enable closes every open disable; a disable of all rules is only closed by a bare enable.
 * Disables closed by neither an enable nor their own scope are `unmatched` (body-scoped ones carry `until`).
 */
export function disableDirectives(source, prefix = 'ember-a11y', { filename } = {}) {
  const directive = new RegExp(String.raw`^\s*-*\s*${escapeRe(prefix)}-(disable-next-line|disable-tree|disable|enable-tree|enable)(?![\w-])([\s\S]*?)-*\s*$`);
  const empty = { nextLine: new Map(), element: new Map(), ranges: [], unmatched: [] };
  if (!source.includes(`${prefix}-`)) return empty;
  let comments = templateComments(source, filename);
  if (!comments) {
    // Unparseable template: fall back to a textual scan with top-level scoping.
    const re = /\{\{!(?:--)?([\s\S]*?)(?:--)?\}\}|<!--([\s\S]*?)-->/g;
    comments = [...source.matchAll(re)].map((m) => {
      const before = source.slice(0, m.index);
      return { value: m[1] ?? m[2], line: before.split('\n').length, column: m.index - before.lastIndexOf('\n') - 1, parent: null };
    });
  }
  const { nextLine, element, ranges } = empty;
  let open = [];
  for (const c of comments) {
    const m = directive.exec(c.value);
    if (!m) continue;
    const ids = m[2].split(/[\s,]+/).map((n) => n.replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const set = new Set(ids.length ? ids : ['*']);
    const kind = m[1];
    if (c.element) {
      if (kind === 'disable') element.set(c.element.startLine, set);
      else if (kind === 'disable-tree') for (const id of set) ranges.push({ id, start: c.element.startLine, end: c.element.endLine + 1 });
    } else if (kind === 'disable-next-line') {
      nextLine.set(c.line + c.value.split('\n').length, set);
    } else if (kind.startsWith('disable')) {
      const until = c.parent ? { tag: c.parent.tag, line: c.parent.endLine } : null;
      for (const id of set) open.push({ id, start: c.line, line: c.line, column: c.column + 1, rules: ids, until });
    } else {
      const closing = open.filter((o) => !ids.length || ids.includes(o.id));
      for (const o of closing) ranges.push({ ...o, end: Math.min(c.line, o.until ? o.until.line + 1 : Infinity) });
      open = open.filter((o) => !closing.includes(o));
    }
  }
  const unmatched = [];
  for (const o of open) {
    ranges.push({ ...o, end: o.until ? o.until.line + 1 : Infinity });
    const prev = unmatched.find((u) => u.line === o.line && u.column === o.column);
    if (prev) prev.open.push(o.id);
    else unmatched.push({ line: o.line, column: o.column, rules: o.rules, open: [o.id], until: o.until });
  }
  return { ...empty, unmatched };
}

function disabledLines({ nextLine, element, ranges }) {
  return (f) => {
    const named = (s) => Boolean(s && (s.has('*') || s.has(f.ruleId)));
    return named(nextLine.get(f.line)) || named(element.get(f.elementLine)) || named(nextLine.get(f.elementLine)) || ranges.some((r) => (r.id === '*' || r.id === f.ruleId) && r.start <= f.line && f.line < r.end);
  };
}

// JavaScript that backs the template: the file itself for .gjs/.gts, a co-located .js/.ts for
// component .hbs, or the matching controller for route templates (app/templates/x.hbs → app/controllers/x.js).
/** Route templates (app/templates/x.hbs, or .gjs/.gts) render once per page; component templates may repeat. */
export function isRouteTemplate(filename) {
  return Boolean(filename) && /[\\/]templates[\\/]/.test(filename) && !/[\\/]components[\\/]/.test(filename);
}

function componentScript(source, filename) {
  if (!filename || !filename.endsWith('.hbs')) return source;
  const candidates = [filename.replace(/\.hbs$/, '')];
  const route = /^(.*[\\/])templates([\\/].+)\.hbs$/.exec(filename);
  if (route && !/[\\/]templates[\\/]components[\\/]/.test(filename)) candidates.push(`${route[1]}controllers${route[2]}`);
  for (const base of candidates)
    for (const ext of ['.js', '.ts']) if (existsSync(base + ext)) return readFileSync(base + ext, 'utf8');
  return '';
}

/**
 * Lint a single template / gjs / gts source.
 * @param {string} source
 * @param {{ filename?: string, rules?: Record<string, 'off'|'error'|'warning'|'info'>, minSeverity?: 'error'|'warning'|'info' }} options
 */
/** Fix examples are best-effort: a failing builder must never break linting. */
function safeFix(build) {
  if (!build) return undefined;
  try {
    return build() ?? undefined;
  } catch {
    return undefined;
  }
}

/** Only safe fixes keep their edits; positions move from template-local to file coordinates (1-based columns). */
function mapFix(fix, offset) {
  if (!fix) return undefined;
  const { edits, safe, ...rest } = fix;
  if (!safe || !edits) return rest;
  const at = (p) => {
    const m = mapPosition(p, offset);
    return { line: m.line, column: m.column + 1 };
  };
  return { ...rest, safe: true, edits: edits.map((e) => ({ ...e, start: at(e.start), end: at(e.end) })) };
}

/**
 * Applies the safe fixes in `findings` to `source`. Overlapping or duplicate edits are applied once
 * (the rest are picked up on the next pass). Returns { text, applied }.
 */
export function applyFixes(source, findings) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const offset = (p) => (starts[p.line - 1] ?? source.length) + p.column - 1;
  const edits = [];
  for (const f of findings) {
    if (!f.fix?.safe) continue;
    for (const e of f.fix.edits) {
      let start = offset(e.start);
      const end = offset(e.end);
      if (e.remove) while (start > 0 && /\s/.test(source[start - 1])) start--;
      edits.push({ start, end, text: e.text });
    }
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let text = source;
  let applied = 0;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) continue;
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
    floor = e.start;
    applied++;
  }
  return { text, applied };
}

export function lintTemplate(source, options = {}) {
  const { filename, rules: config = {}, minSeverity = 'info' } = options;
  const findings = [];
  const directives = disableDirectives(source, 'ember-a11y', { filename });
  const isDisabled = disabledLines(directives);

  const script = componentScript(source, filename);
  let resolveComponent;
  const componentTrees = new Map();
  const componentTree = (el) => {
    if (!options.root || !filename || el.bindings.includes(el.tag.split('::')[0])) return null;
    resolveComponent ??= componentTemplateResolver(options.root, filename, script);
    const file = resolveComponent(el.tag);
    if (!file) return null;
    if (!componentTrees.has(file)) {
      const templates = parseTemplates(readFileSync(file, 'utf8'), { filename: file });
      const tpl = templates.length === 1 ? templates[0] : null;
      componentTrees.set(file, tpl?.ast ? { file: relative(options.root, file), ...buildTree(tpl.ast) } : null);
    }
    return componentTrees.get(file);
  };
  for (const tpl of parseTemplates(source, { filename })) {
    if (!tpl.ast) {
      const pos = mapPosition({ line: tpl.error.line, column: tpl.error.column ?? 0 }, tpl.offset);
      findings.push({ ruleId: 'parse-error', severity: 'error', message: `Template could not be parsed: ${tpl.error.message}`, line: pos.line, column: pos.column + 1, wcag: [], references: [] });
      continue;
    }
    const tree = buildTree(tpl.ast, { script, templateSource: tpl.contents, routeTemplate: isRouteTemplate(filename) });
    tree.ctx.componentTree = componentTree;
    for (const rule of rules) {
      const override = config[rule.id];
      if (override === 'off') continue;
      for (const el of tree.all) {
        if (el.kind === 'named-block') continue;
        if (!el.isHtml && !rule.appliesToComponents) continue;
        rule.check(el, (f) => {
          const target = f.el ?? el;
          const loc = f.node?.loc ?? target.loc;
          const start = mapPosition(loc.start, tpl.offset);
          const end = mapPosition(loc.end, tpl.offset);
          // A disable comment above a multi-line element applies to findings on any of its attributes.
          const elementLine = target.loc ? mapPosition(target.loc.start, tpl.offset).line : start.line;
          findings.push({
            ruleId: rule.id,
            severity: override ?? f.severity,
            message: f.message,
            line: start.line,
            column: start.column + 1,
            endLine: end.line,
            endColumn: end.column + 1,
            elementLine,
            snippet: target.snippet,
            help: f.help,
            fix: mapFix(safeFix(f.fix), tpl.offset),
            wcag: f.wcag ? f.wcag.map((w) => WCAG[w] ?? w) : rule.wcag,
            references: (f.references ?? []).filter(Boolean),
          });
        });
      }
    }
  }

  for (const u of directives.unmatched) {
    const what = u.open.includes('*') ? 'all rules' : u.open.join(', ');
    findings.push({
      ruleId: 'unmatched-disable',
      severity: 'warning',
      message: `ember-a11y-disable for ${what} has no matching ember-a11y-enable, so it applies ${u.until ? `until </${u.until.tag}> closes on line ${u.until.line}` : 'to the rest of the file'}.`,
      line: u.line,
      column: u.column,
      help: `Add {{! ember-a11y-enable${u.open.includes('*') ? '' : ' ' + u.open.join(' ')} }} after the code it should cover, or use ember-a11y-disable-next-line for a single element.`,
      wcag: [],
      references: [],
    });
  }

  const min = SEVERITY_ORDER[minSeverity] ?? 2;
  const seen = new Set();
  return findings
    .filter((f) => SEVERITY_ORDER[f.severity] <= min && (f.ruleId === 'unmatched-disable' || !isDisabled(f)))
    .filter((f) => {
      const key = `${f.ruleId}:${f.line}:${f.column}:${f.message}`;
      return seen.has(key) ? false : seen.add(key);
    })
    .map(({ elementLine, ...f }) => f)
    .sort((a, b) => a.line - b.line || a.column - b.column || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const EXTENSIONS = new Set(['.hbs', '.gjs', '.gts']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'tmp', '.git', 'declarations', 'coverage', '.embroider']);

const inside = (base, p) => p === base || p.startsWith(base + sep);

/**
 * Template files under `paths`. Symlinks are followed only when they resolve inside the
 * path being walked; dangling links, loops and unreadable entries are skipped.
 */
export function collectFiles(paths, root = process.cwd()) {
  const files = new Set();
  for (const p of paths) {
    const start = resolve(root, p);
    let base;
    try {
      base = realpathSync(start);
    } catch {
      throw new Error(`Path not found: ${p}`);
    }
    const seen = new Set();
    const walk = (path) => {
      let real;
      let st;
      try {
        real = realpathSync(path);
        st = statSync(real);
      } catch {
        return;
      }
      if (!inside(base, real)) return;
      if (st.isDirectory()) {
        if (seen.has(real)) return;
        seen.add(real);
        let names;
        try {
          names = readdirSync(path);
        } catch {
          return;
        }
        for (const name of names) if (!IGNORED_DIRS.has(name) && !name.startsWith('.')) walk(join(path, name));
      } else if (st.isFile() && EXTENSIONS.has(extname(path))) {
        files.add(path);
      }
    };
    walk(start);
  }
  return [...files].sort();
}

export function lintFiles(paths, options = {}) {
  const root = options.root ?? process.cwd();
  return collectFiles(paths, root).map((file) => {
    const rel = relative(root, file) || file;
    try {
      return { file: rel, findings: lintTemplate(readFileSync(file, 'utf8'), { ...options, root, filename: file }) };
    } catch (error) {
      return { file: rel, findings: [{ ruleId: 'internal-error', severity: 'error', message: `Could not lint this file: ${error.message}`, line: 1, column: 1, wcag: [], references: [] }] };
    }
  });
}

/** Applies safe fixes to every template under `paths`, re-linting until nothing more applies. */
export function fixFiles(paths, options = {}) {
  const root = options.root ?? process.cwd();
  const fixed = [];
  const skipped = [];
  for (const file of collectFiles(paths, root)) {
    const original = readFileSync(file, 'utf8');
    const hadParseError = (text) => lintTemplate(text, { ...options, root, filename: file }).some((f) => f.ruleId === 'parse-error');
    let text = original;
    let applied = 0;
    for (let pass = 0; pass < 5; pass++) {
      const result = applyFixes(text, lintTemplate(text, { ...options, root, filename: file, minSeverity: 'info' }));
      if (!result.applied) break;
      text = result.text;
      applied += result.applied;
    }
    if (!applied) continue;
    if (!hadParseError(original) && hadParseError(text)) {
      skipped.push({ file: relative(root, file) || file, reason: 'the fixes would leave the file unparseable' });
      continue;
    }
    writeFileSync(file, text);
    fixed.push({ file: relative(root, file) || file, applied });
  }
  return Object.assign(fixed, { skipped });
}

export function summarize(results) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const r of results) for (const f of r.findings) counts[f.severity]++;
  return counts;
}
