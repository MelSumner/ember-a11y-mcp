// Finds the files related to one Ember source file, so an agent can understand what the code intends
// before it judges or changes it. Static and read-only: reads imports, template invocations, the
// component/route file family, styles, tests, and the reverse direction (who imports or invokes it).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { describePackage, expandWorkspaces, rootGuard, workspaceGlobs } from './setup-audit.js';

const SOURCE_EXTS = ['.js', '.ts', '.gjs', '.gts', '.hbs'];
const RESOLVE_EXTS = ['.js', '.ts', '.gjs', '.gts', '.hbs', '.json', '.css', '.scss'];
const STYLE_EXTS = ['.css', '.scss', '.sass', '.less'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tmp', '.git', 'declarations', 'coverage', '.embroider', 'public', 'vendor']);
const KIND_DIRS = ['components', 'helpers', 'modifiers', 'routes', 'controllers', 'templates', 'services', 'utils', 'models', 'adapters', 'serializers', 'transforms', 'abilities', 'validators', 'mixins', 'initializers', 'instance-initializers', 'lib', 'strings'];
const MAX_LIST = 25;
// Built-in template keywords and helpers that look like invocations but aren't project files.
const BUILTINS = new Set(['if', 'unless', 'each', 'each-in', 'let', 'with', 'yield', 'outlet', 'component', 'helper', 'modifier', 'on', 'fn', 'get', 'concat', 'array', 'hash', 'mut', 'action', 'log', 'debugger', 'in-element', 'unique-id', 'has-block', 'has-block-params', 'link-to', 'input', 'textarea', 'mount', 'else', 'page-title']);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const stripExt = (p) => p.slice(0, p.length - extname(p).length);
const kebab = (s) => s.split('::').map((seg) => seg.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase()).join('/');
const pascal = (name) => name.split('/').map((seg) => seg.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')).join('::');

function listFiles(dir, guard, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, guard, exts, out);
    else if (e.isFile() && exts.includes(extname(e.name)) && guard.real(p)) out.push(p);
  }
  return out;
}

/** Module specifiers imported or re-exported by a JS/TS/GJS/GTS source. */
export function importSpecifiers(src) {
  const specs = [];
  const re = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s*)?['"]([^'"\n]+)['"]|\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) specs.push(m[1] ?? m[2]);
  return [...new Set(specs)];
}

/** Components, helpers and modifiers invoked in template source (hbs, or a <template> in gjs/gts). */
export function templateInvocations(src) {
  const components = new Set();
  const curlies = new Set();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*(?:::[A-Z][A-Za-z0-9]*)*)(?=[\s/>])/g)) components.add(m[1]);
  for (const m of src.matchAll(/[{(]{1,2}\s*([a-z][a-z0-9]*(?:[-/][a-z0-9]+)+)(?=[\s})])/g)) if (!BUILTINS.has(m[1])) curlies.add(m[1]);
  for (const m of src.matchAll(/\(?\{?\{?\s*component\s+['"]([a-z0-9/-]+)['"]/g)) curlies.add(m[1]);
  return { components: [...components], curlies: [...curlies] };
}

function templateSource(file, src) {
  if (file.endsWith('.hbs')) return src;
  return [...src.matchAll(/<template>([\s\S]*?)<\/template>/g)].map((m) => m[1]).join('\n');
}

/** Ember packages that can be imported by name: this one, its in-repo addons and workspace packages. */
function packageMap(projectDir, guard) {
  const map = new Map();
  const addPkg = (dir) => {
    const pkg = readJson(join(dir, 'package.json'));
    if (!pkg?.name || [...map.values()].some((p) => p.dir === dir)) return;
    const info = describePackage(dir, guard);
    const isApp = existsSync(join(dir, 'app', 'router.js')) || existsSync(join(dir, 'app', 'router.ts'));
    const prefix = isApp ? (readFileSafe(join(dir, 'config', 'environment.js')).match(/modulePrefix\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? pkg.name) : pkg.name;
    const src = isApp ? join(dir, 'app') : ['addon', 'src'].map((d) => join(dir, d)).find((d) => existsSync(d)) ?? dir;
    map.set(prefix, { name: prefix, dir, src, isApp, kind: info?.kind ?? (isApp ? 'app' : 'package'), appTree: existsSync(join(dir, 'app')) ? join(dir, 'app') : null });
    for (const p of pkg['ember-addon']?.paths ?? []) {
      const d = guard.real(resolve(dir, p));
      if (d) addPkg(d);
    }
  };
  addPkg(projectDir);
  for (let d = projectDir; d === guard.root || d.startsWith(guard.root + sep); d = dirname(d)) {
    const globs = workspaceGlobs(d, guard);
    if (globs) {
      for (const w of expandWorkspaces(d, globs, guard)) if (describePackage(w, guard)) addPkg(w);
      break;
    }
    if (d === guard.root) break;
  }
  return map;
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function tryResolve(base, guard) {
  const candidates = [base, ...RESOLVE_EXTS.map((e) => base + e), ...RESOLVE_EXTS.map((e) => join(base, `index${e}`))];
  for (const c of candidates) if (isFile(c) && guard.real(c)) return guard.real(c);
  return null;
}

/** Resolve an import specifier to a file in the project, or describe it as external. */
function resolveSpecifier(spec, fromFile, pkgs, host, guard) {
  if (spec.startsWith('.')) return { file: tryResolve(resolve(dirname(fromFile), spec), guard) };
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const rest = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
  const pkg = pkgs.get(name);
  if (!pkg) return { external: name };
  if (pkg.isApp && rest.startsWith('tests/')) return { file: tryResolve(join(pkg.dir, rest), guard) };
  const found = tryResolve(join(pkg.src, rest), guard);
  if (found || !pkg.isApp) return { file: found };
  // Addons merge their app/ tree into the host's namespace.
  for (const p of pkgs.values()) if (p !== pkg && p.appTree && (p === host || !p.isApp)) {
    const f = tryResolve(join(p.appTree, rest), guard);
    if (f) return { file: f };
  }
  return { file: null };
}

/** The package that contains `file`, and the file's Ember kind and name within it. */
function unitOf(file, pkgs) {
  const pkg = [...pkgs.values()].filter((p) => file.startsWith(p.dir + sep)).sort((a, b) => b.dir.length - a.dir.length)[0];
  if (!pkg) return { kind: 'file' };
  const rel = relative(pkg.dir, file).split(sep).join('/');
  const m = rel.match(new RegExp(`^(app|addon|src)/(${KIND_DIRS.join('|')})/(.+)$`));
  if (m) {
    const [, tree, dir, rest] = m;
    // `foo/index` is the `foo.index` route, but for everything else it's the module `foo`.
    const name = ['routes', 'controllers', 'templates'].includes(dir) ? stripExt(rest) : stripExt(rest).replace(/\/index$/, '');
    const kind = { templates: 'route template', strings: 'strings', lib: 'lib', 'instance-initializers': 'instance-initializer' }[dir] ?? dir.replace(/s$/, '');
    return { pkg, tree, dir, name, kind };
  }
  if (/^tests\//.test(rel)) return { pkg, kind: 'test' };
  if (/^app\/router\.[jt]s$/.test(rel)) return { pkg, kind: 'router' };
  return { pkg, kind: 'file' };
}

function familyOf(unit, file, pkgs, guard) {
  const out = [];
  if (!unit.dir) return out;
  const { pkg, tree, dir, name } = unit;
  const push = (p, relation) => {
    const r = p && guard.real(p);
    if (r && r !== file && !out.some((o) => o.file === r)) out.push({ file: r, relation });
  };
  const variants = (base, exts) => exts.flatMap((e) => (['routes', 'controllers', 'templates'].includes(dir) ? [base + e] : [base + e, join(base, `index${e}`)])).filter(isFile);
  const treeDir = join(pkg.dir, tree);
  if (dir === 'components') {
    for (const f of variants(join(treeDir, 'components', name), ['.hbs', '.gjs', '.gts'])) push(f, 'template');
    for (const f of variants(join(treeDir, 'components', name), ['.js', '.ts'])) push(f, 'component class');
    for (const f of variants(join(treeDir, 'components', name), ['.css', '.scss'])) push(f, 'co-located styles');
  }
  if (['routes', 'controllers', 'templates'].includes(dir)) {
    for (const f of variants(join(treeDir, 'routes', name), ['.js', '.ts'])) push(f, 'route');
    for (const f of variants(join(treeDir, 'controllers', name), ['.js', '.ts'])) push(f, 'controller');
    for (const f of variants(join(treeDir, 'templates', name), ['.hbs', '.gjs', '.gts'])) push(f, 'route template');
  }
  // Classic addons: addon/<kind>/x is re-exported from app/<kind>/x (and vice versa).
  const other = tree === 'addon' ? 'app' : tree === 'app' && !pkg.isApp ? 'addon' : null;
  if (other) for (const f of variants(join(pkg.dir, other, dir, name), SOURCE_EXTS)) push(f, tree === 'addon' ? 'app re-export' : 'addon implementation');
  // Addons are often tested from another package: the host app (in-repo addons) or a workspace test app.
  const testDirs = pkg.isApp ? [pkg.dir] : [...new Set([pkg.dir, ...[...pkgs.values()].filter((p) => p.isApp).map((p) => p.dir)])];
  const testKind = { components: ['integration/components'], helpers: ['integration/helpers', 'unit/helpers'], modifiers: ['integration/modifiers', 'unit/modifiers'], templates: ['unit/routes', 'unit/controllers'] }[dir] ?? [`unit/${dir}`];
  if (dir === 'routes' || dir === 'controllers') testKind.push(dir === 'routes' ? 'unit/controllers' : 'unit/routes');
  for (const t of testDirs) {
    for (const k of testKind) {
      for (const e of ['.js', '.ts', '.gjs', '.gts']) {
        push(join(t, 'tests', k, `${name}-test${e}`), 'test');
        if (!['routes', 'controllers', 'templates'].includes(dir)) push(join(t, 'tests', k, name, `index-test${e}`), 'test');
      }
    }
  }
  return out;
}

const styleFilesCache = new Map();
function styleFiles(dirs, guard) {
  const key = dirs.join('|');
  if (!styleFilesCache.has(key)) styleFilesCache.set(key, [...new Set(dirs.flatMap((d) => listFiles(d, guard, STYLE_EXTS)))]);
  return styleFilesCache.get(key);
}

// Folders that group style files without being part of a component's name.
const STYLE_GROUPS = new Set(['styles', 'components', 'component', 'mixins', 'partials', 'pages', 'base', 'core']);

function stylesFor(unit, templateSrc, scopeDirs, guard, family) {
  const out = [];
  const files = styleFiles(scopeDirs, guard).filter((f) => !family.some((x) => x.file === f));
  if (unit.dir === 'components') {
    const segs = unit.name.split('/');
    for (const f of files) {
      const parts = f.split(sep);
      const i = parts.lastIndexOf('styles');
      if (i < 0) continue;
      const tail = parts.slice(i + 1).map((p, j, a) => (j === a.length - 1 ? stripExt(p).replace(/^_/, '') : p)).filter((p, j, a) => j === a.length - 1 || !STYLE_GROUPS.has(p));
      const nameTail = segs.slice(-tail.length).join('/');
      if (tail.length <= segs.length && tail.join('/') === nameTail) out.push({ file: f, relation: 'styles', detail: 'file named after the component' });
    }
  }
  const classes = [...new Set([...templateSrc.matchAll(/\bclass=(?:"([^"]*)"|'([^']*)')/g)].flatMap((m) => (m[1] ?? m[2]).replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter((c) => /^[a-zA-Z_][\w-]*$/.test(c)))];
  if (!classes.length) return out;
  const hits = new Map();
  for (const f of files) {
    const src = readFileSafe(f);
    const found = classes.filter((c) => new RegExp(`\\.${c.replace(/-/g, '\\-')}(?![\\w-])`).test(src));
    if (found.length) hits.set(f, found);
  }
  for (const [f, found] of [...hits].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    if (!out.some((o) => o.file === f)) out.push({ file: f, relation: 'styles', detail: `defines ${found.slice(0, 6).map((c) => `.${c}`).join(', ')}${found.length > 6 ? ` (+${found.length - 6})` : ''}` });
  }
  return out;
}

function resolveInvocation(name, kinds, pkgs, host, guard) {
  for (const p of [host, ...[...pkgs.values()].filter((x) => x !== host)]) {
    for (const k of kinds) {
      for (const t of [p.isApp ? join(p.dir, 'app') : p.src, p.appTree].filter(Boolean)) {
        const f = tryResolve(join(t, k, name), guard);
        if (f) return f;
      }
    }
  }
  return null;
}

/**
 * @param {{ root: string, path: string, depth?: number }} options
 */
export function relatedFiles({ root: rootDir, path, depth = 1 } = {}) {
  const guard = rootGuard(rootDir);
  const root = guard.root;
  if (!path) throw new Error('`path` is required: a file relative to the project root.');
  if (!guard.inside(resolve(root, path))) throw new Error(`Path must be inside ${root} (set EMBER_A11Y_ROOT to change).`);
  const file = guard.real(resolve(root, path));
  if (!file || !isFile(file)) throw new Error(`No file at ${path} inside ${root}.`);
  const rel = (p) => relative(root, p).split(sep).join('/');

  let projectDir = dirname(file);
  while (!existsSync(join(projectDir, 'package.json')) && projectDir !== root && projectDir.startsWith(root)) projectDir = dirname(projectDir);
  // An in-repo addon belongs to the app that lists it, so search upward for that app too.
  for (let d = dirname(projectDir); d.startsWith(root); d = dirname(d)) {
    const pkg = readJson(join(d, 'package.json'));
    if ((pkg?.['ember-addon']?.paths ?? []).some((p) => resolve(d, p) === projectDir)) projectDir = d;
    if (d === root) break;
  }
  const pkgs = packageMap(projectDir, guard);
  const host = [...pkgs.values()].find((p) => p.dir === projectDir) ?? [...pkgs.values()][0];
  const unit = unitOf(file, pkgs);
  const related = [];
  const add = (r) => {
    if (r.file && r.file !== file && !related.some((x) => x.file === r.file && x.relation === r.relation)) related.push(r);
  };
  const external = new Set();
  const unresolved = new Set();

  // Same unit: template/class/styles, route/controller/template, addon re-exports, tests.
  const family = familyOf(unit, file, pkgs, guard);
  family.forEach(add);
  const unitFiles = [file, ...family.filter((f) => f.relation !== 'test').map((f) => f.file)];

  // Imports, followed `depth` levels from the file and its family.
  let frontier = unitFiles.filter((f) => !f.endsWith('.hbs') && SOURCE_EXTS.includes(extname(f)));
  const seen = new Set(unitFiles);
  for (let level = 1; level <= depth && frontier.length; level++) {
    const next = [];
    for (const f of frontier) {
      for (const spec of importSpecifiers(readFileSafe(f))) {
        const r = resolveSpecifier(spec, f, pkgs, host, guard);
        if (r.external) {
          if (level === 1) external.add(r.external);
          continue;
        }
        if (!r.file) {
          if (level === 1) unresolved.add(spec);
          continue;
        }
        if (seen.has(r.file)) continue;
        seen.add(r.file);
        const u = unitOf(r.file, pkgs);
        add({ file: r.file, relation: level === 1 ? 'imports' : `imports (level ${level})`, detail: `\`${spec}\`${u.kind !== 'file' ? ` (${u.kind})` : ''}${level > 1 ? ` via ${rel(f)}` : ''}` });
        if (SOURCE_EXTS.includes(extname(r.file)) && !r.file.endsWith('.hbs')) next.push(r.file);
      }
    }
    frontier = next;
  }

  // Template invocations (strict-mode gjs/gts resolve through imports, so only .hbs needs this).
  const templates = unitFiles.filter((f) => ['.hbs', '.gjs', '.gts'].includes(extname(f)));
  const templateSrc = templates.map((f) => templateSource(f, readFileSafe(f))).join('\n');
  for (const f of templates.filter((t) => t.endsWith('.hbs'))) {
    const { components, curlies } = templateInvocations(readFileSafe(f));
    for (const c of components) {
      const target = resolveInvocation(kebab(c), ['components'], pkgs, host, guard);
      if (target) add({ file: target, relation: 'invokes', detail: `<${c}>` });
      else unresolved.add(`<${c}>`);
    }
    for (const c of curlies) {
      const target = resolveInvocation(c, ['helpers', 'modifiers', 'components'], pkgs, host, guard);
      if (target) add({ file: target, relation: 'invokes', detail: `{{${c}}} (${unitOf(target, pkgs).kind})` });
    }
  }

  // Styles: named after the component, or defining the template's static class names.
  const ownDirs = [...new Set([unit.pkg?.dir, host.dir].filter(Boolean))];
  const scopeDirs = [...pkgs.values()].filter((p) => ownDirs.some((d) => p.dir === d || p.dir.startsWith(d + sep))).map((p) => p.dir);
  for (const s of stylesFor(unit, templateSrc, scopeDirs, guard, family)) add(s);

  // Reverse: who imports this unit, and (for components and helpers) who invokes it.
  const scan = [...new Set([...pkgs.values()].filter((p) => p.dir === host.dir || p.dir.startsWith(host.dir + sep) || unit.pkg === p).flatMap((p) => listFiles(p.dir, guard, SOURCE_EXTS)))];
  const targets = new Set(unitFiles);
  const stems = new Set(unitFiles.map((f) => basename(stripExt(f))).concat(unit.name ? [unit.name.split('/').pop()] : []));
  const usedBy = [];
  const invokeRe = unit.dir === 'components'
    ? new RegExp(`<${pascal(unit.name).replace(/:/g, ':')}(?=[\\s/>])|[{(]{1,2}\\s*(?:${unit.name}(?=[\\s})])|component\\s+['"]${unit.name}['"])`)
    : unit.dir === 'helpers' || unit.dir === 'modifiers'
      ? new RegExp(`[{(]{1,2}\\s*${unit.name}(?=[\\s})])`)
      : null;
  for (const f of scan) {
    if (targets.has(f)) continue;
    const src = readFileSafe(f);
    let how = null;
    if (!f.endsWith('.hbs')) {
      for (const spec of importSpecifiers(src)) {
        const last = basename(spec);
        if (!stems.has(last) && !(last === 'index' || stems.has(basename(dirname(spec))))) continue;
        const r = resolveSpecifier(spec, f, pkgs, host, guard);
        if (r.file && targets.has(r.file)) {
          how = `imports \`${spec}\``;
          break;
        }
      }
    }
    if (!how && invokeRe && f.endsWith('.hbs') && invokeRe.test(src)) how = 'invokes it in a template';
    if (how) usedBy.push({ file: f, relation: /\/tests\//.test(f) ? 'tested or used by' : 'used by', detail: how });
  }
  usedBy.forEach(add);

  return {
    file: rel(file),
    unit: { kind: unit.kind, name: unit.name ?? null, package: unit.pkg?.name ?? null },
    related: related.map((r) => ({ path: rel(r.file), relation: r.relation, ...(r.detail ? { detail: r.detail } : {}) })),
    external: [...external].sort(),
    unresolved: [...unresolved].sort(),
  };
}

const SECTIONS = [
  ['Same unit', (r) => ['template', 'component class', 'co-located styles', 'route', 'controller', 'route template', 'app re-export', 'addon implementation'].includes(r.relation)],
  ['Imports', (r) => r.relation.startsWith('imports')],
  ['Invoked from its template', (r) => r.relation === 'invokes'],
  ['Styles', (r) => r.relation === 'styles'],
  ['Tests', (r) => r.relation === 'test' || r.relation === 'tested or used by'],
  ['Used by', (r) => r.relation === 'used by'],
];

export function formatRelatedFiles(result) {
  const { file, unit, related, external, unresolved } = result;
  const lines = [`# Files related to ${file}`, '', `${unit.name ? `${unit.kind} \`${unit.name}\`` : unit.kind}${unit.package ? ` in \`${unit.package}\`` : ''}.`];
  for (const [title, match] of SECTIONS) {
    const items = related.filter(match);
    if (!items.length) continue;
    lines.push('', `## ${title} (${items.length})`);
    for (const r of items.slice(0, MAX_LIST)) lines.push(`- ${r.path}${r.relation === 'test' || title === 'Same unit' ? ` — ${r.relation}` : ''}${r.detail ? ` — ${r.detail}` : ''}`);
    if (items.length > MAX_LIST) lines.push(`- …and ${items.length - MAX_LIST} more`);
  }
  if (external.length) lines.push('', `## External packages (${external.length})`, external.join(', '));
  if (unresolved.length) lines.push('', `## Not found in the project (${unresolved.length})`, `${unresolved.slice(0, MAX_LIST).join(', ')}. Probably from an addon in node_modules.`);
  if (!related.length && !external.length) lines.push('', 'No related files found.');
  return lines.join('\n');
}
