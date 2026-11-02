import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, disableDirectives } from './lint/index.js';
import { TEMPLATE_LINT_A11Y_RULES, formatTodo, readA11yTodos, summarizeTodos } from './lint-todos.js';

export { TEMPLATE_LINT_A11Y_RULES };

const PACKAGES = [
  { name: 'ember-template-lint', level: 'fail', why: 'static template a11y rules' },
  { name: 'ember-a11y-testing', level: 'fail', why: 'axe audits in rendering and acceptance tests' },
  { name: '@ember/test-helpers', level: 'fail', why: 'test helpers that ember-a11y-testing hooks into' },
  { name: 'eslint-plugin-ember', level: 'warn', why: 'Ember lint rules, incl. template rules in .gjs/.gts' },
  { name: 'ember-a11y-mcp', level: 'info', why: 'the `ember-a11y-lint` CLI (WAI-ARIA 1.2 / ARIA in HTML rules) for CI' },
];

const TEST_PACKAGES = new Set(['ember-a11y-testing', '@ember/test-helpers']);
const TEST_HELPERS = ['tests/test-helper.js', 'tests/test-helper.ts', 'tests/test-helper.gjs', 'tests/test-helper.gts'];
// ember-a11y-mcp isn't published to npm yet, so point at this checkout's CLI.
const LINT_BIN = fileURLToPath(new URL('../bin/ember-a11y-lint.js', import.meta.url));

const ICON = { pass: '✔', warn: '⚠', fail: '✖', info: 'ℹ' };
const MAX_LIST = 25;

export function rootGuard(rootDir) {
  const root = realpathSync(rootDir);
  const inside = (p) => p === root || p.startsWith(root + sep);
  const real = (p) => {
    try {
      const r = realpathSync(p);
      return inside(r) ? r : null;
    } catch {
      return null;
    }
  };
  return { root, inside, real };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function walk(dir, guard, { match, maxDepth = Infinity, skip = new Set(['node_modules', 'dist', 'tmp', '.git']) }) {
  const out = [];
  const seen = new Set();
  const go = (d, depth) => {
    const realDir = guard.real(d);
    if (!realDir) return;
    seen.add(realDir);
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      if (skip.has(name) || name.startsWith('.')) continue;
      const p = join(d, name);
      // Dangling links and links outside the root resolve to null and are skipped.
      const real = guard.real(p);
      if (!real) continue;
      let st;
      try {
        st = statSync(real);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Symlinked directories can form cycles; visit each real directory once.
        if (depth < maxDepth && !seen.has(real)) {
          seen.add(real);
          go(p, depth + 1);
        }
      } else if (match(name, p)) out.push(p);
    }
  };
  go(dir, 0);
  return out.sort();
}

/** Blank out line and block comments in JS source, keeping strings, offsets and line numbers intact. */
export function stripJsComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? src.length : j;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? src.length : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Truncate a list for display, noting how many were left out. */
function capped(items) {
  return items.length > MAX_LIST ? [...items.slice(0, MAX_LIST), `…and ${items.length - MAX_LIST} more`] : items;
}

const firstExisting = (dir, names, guard) => names.map((n) => join(dir, n)).find((p) => existsSync(p) && guard.real(p));
const lineOf = (src, index) => src.slice(0, index).split('\n').length;
const allDeps = (pkg) => ({ ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies });
const isEmber = (pkg) => Boolean(allDeps(pkg)['ember-source'] || pkg?.['ember-addon'] || pkg?.keywords?.includes('ember-addon'));

function detectPackageManager(dir, root, pkg) {
  const declared = pkg?.packageManager?.split('@')[0];
  if (declared) return declared;
  for (let d = dir; d.startsWith(root); d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(d, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(d, 'package-lock.json'))) return 'npm';
    if (d === root) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Monorepo, in-repo addon and engine discovery

/** Workspace package globs from pnpm-workspace.yaml or package.json `workspaces`, or null. */
export function workspaceGlobs(dir, guard) {
  const yaml = guard.real(join(dir, 'pnpm-workspace.yaml'));
  if (yaml) {
    const globs = [];
    let inPackages = false;
    for (const line of readFileSync(yaml, 'utf8').split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (inPackages && /^\s*-\s*/.test(line)) globs.push(line.replace(/^\s*-\s*/, '').replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim());
      else if (inPackages && /^\S/.test(line)) break;
    }
    if (globs.length) return globs;
  }
  const ws = readJson(join(dir, 'package.json'))?.workspaces;
  return Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : null;
}

/** Expand workspace globs (`*`, `**`, `!negation`) to directories containing a package.json. */
export function expandWorkspaces(dir, globs, guard) {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'tmp']);
  const subdirs = (d) => {
    try {
      return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')).map((e) => join(d, e.name));
    } catch {
      return [];
    }
  };
  const segRe = (seg) => new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  const expand = (base, segs, depth = 0) => {
    if (!segs.length) return [base];
    const [seg, ...rest] = segs;
    if (seg === '**') return [...expand(base, rest, depth), ...(depth < 6 ? subdirs(base).flatMap((d) => expand(d, segs, depth + 1)) : [])];
    if (/[*?]/.test(seg)) return subdirs(base).filter((d) => segRe(seg).test(d.slice(d.lastIndexOf(sep) + 1))).flatMap((d) => expand(d, rest, depth));
    return expand(join(base, seg), rest, depth);
  };
  const run = (g) => expand(dir, g.replace(/^\.\//, '').replace(/\/$/, '').split('/').filter(Boolean)).filter((d) => guard.real(join(d, 'package.json')));
  const excluded = new Set(globs.filter((g) => g.startsWith('!')).flatMap((g) => run(g.slice(1))));
  return [...new Set(globs.filter((g) => !g.startsWith('!')).flatMap(run))].filter((d) => !excluded.has(d)).sort();
}

/** Classify an Ember package directory, or null if it isn't one. */
export function describePackage(d, guard) {
  const pkg = guard.real(join(d, 'package.json')) ? readJson(join(d, 'package.json')) : null;
  if (!pkg) return null;
  const has = (p) => Boolean(firstExisting(d, [p], guard));
  const router = has('app/router.js') || has('app/router.ts');
  const engine = Boolean(pkg.keywords?.includes('ember-engine'));
  const addon = Boolean(pkg.keywords?.includes('ember-addon'));
  if (!router && !engine && !addon && !allDeps(pkg)['ember-source']) return null;
  return {
    dir: d,
    name: pkg.name,
    kind: engine ? 'engine' : router || !addon ? 'app' : 'addon',
    // Build-only addons (just index.js hooks) have no templates or runtime code to audit.
    ui: router || Boolean(allDeps(pkg)['ember-source']) || ['addon', 'app', 'src'].some(has),
  };
}

function findUp(start, guard, file) {
  for (let d = start; d === guard.root || d.startsWith(guard.root + sep); d = dirname(d)) {
    if (guard.real(join(d, file))) return d;
    if (d === guard.root) break;
  }
  return null;
}

function engineRoutes(engineDir, mount, guard) {
  const file = firstExisting(engineDir, ['addon/routes.js', 'addon/routes.ts', 'src/routes.js', 'src/routes.ts'], guard);
  if (!file) return null;
  const src = readFileSync(file, 'utf8');
  const m = /buildRoutes\(\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/.exec(src);
  if (!m) return { file, routes: [] };
  const open = m.index + m[0].length - 1;
  return { file, routes: parseRoutes(src.slice(open + 1, matchBrace(src, open)), mount.path === '/' ? '' : mount.path, mount.name) };
}

// ---------------------------------------------------------------------------
// Router parsing (static, best effort)

function matchBrace(src, open, o = '{', c = '}') {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i;
  }
  return src.length;
}

export function parseRoutes(src, prefix = '', namePrefix = '') {
  const routes = [];
  const re = /this\.(route|mount)\(\s*(['"])([^'"]+)\2\s*(?:,\s*(\{[^{}]*\}))?\s*(,\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{)?/g;
  let m;
  while ((m = re.exec(src))) {
    const [, kind, , target, options, callback] = m;
    // this.mount('engine-package', { as, path }): the route name and default path come from `as`.
    const name = kind === 'mount' ? (options?.match(/as\s*:\s*(['"])([^'"]+)\1/)?.[2] ?? target) : target;
    const custom = options?.match(/path\s*:\s*(['"])([^'"]*)\1/)?.[2];
    const segment = custom ?? `/${name}`;
    const path = `${prefix}${segment.startsWith('/') ? segment : `/${segment}`}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
    const fullName = namePrefix ? `${namePrefix}.${name}` : name;
    const route = kind === 'mount' ? { name: fullName, path, hasChildren: true, engine: target } : { name: fullName, path, hasChildren: Boolean(callback) };
    routes.push(route);
    if (callback) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(src, open);
      routes.push(...parseRoutes(src.slice(open + 1, close), path === '/' ? '' : path, fullName));
      re.lastIndex = close;
    }
  }
  return routes;
}

function routeRegex(route) {
  const body = route.path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.startsWith('*') ? '.*' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body || '/'}${route.hasChildren ? '(/.*)?' : '/?'}$`);
}

/**
 * URLs passed as a string literal to `visit(...)` or a `visit*` helper (`visitWithRedirect`, …), or with
 * `{ pageObjects: true }` to ember-cli-page-object's `visitable(...)`. Dynamic parts become `X`.
 */
export function visitedUrls(src, { pageObjects = false } = {}) {
  const urls = [];
  const re = pageObjects ? /\bvisitable\(\s*(?:(['"])([^'"]*)\1|`([^`]*)`)/g : /\bvisit(?:[A-Z_][\w$]*)?\(\s*(?:(['"])([^'"]*)\1|`([^`]*)`)/g;
  const clean = (s) => s.replace(/\$\{[^}]*\}/g, 'X').split(/[?#]/)[0] || '/';
  let m;
  while ((m = re.exec(src))) {
    const url = clean(m[2] ?? m[3]);
    urls.push(pageObjects ? url.replace(/\/:[^/]+/g, '/X') : url);
  }
  if (!pageObjects) {
    // `let path = '/x'; … visit(path)`: follow variables passed to visit helpers that are initialised with a URL literal.
    const vars = new Set([...src.matchAll(/\bvisit(?:[A-Z_][\w$]*)?\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)].map((v) => v[1]));
    for (const v of src.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(['"])(\/[^'"]*)\2|`(\/[^`]*)`)/g)) if (vars.has(v[1])) urls.push(clean(v[3] ?? v[4]));
  }
  return urls;
}

/** Test-tree files a test imports (relative or `<anything>/tests/...` specifiers), resolved against the package dir. */
function importedTestFiles(file, src, dir, known) {
  const out = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[2];
    const i = spec.indexOf('/tests/');
    const base = spec.startsWith('.') ? resolve(dirname(file), spec) : i >= 0 ? join(dir, spec.slice(i + 1)) : null;
    if (!base) continue;
    const hit = ['', '.js', '.ts', '/index.js', '/index.ts'].map((e) => base + e).find((p) => known.has(p));
    if (hit) out.push(hit);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audit

export function auditProjectSetup({ root: rootDir, path = '.' } = {}) {
  const guard = rootGuard(rootDir);
  const { root } = guard;
  if (!guard.inside(resolve(root, path))) throw new Error(`Path must be inside ${root} (set EMBER_A11Y_ROOT to change).`);
  const dir = guard.real(resolve(root, path));
  if (!dir || !statSync(dir).isDirectory()) throw new Error(`Not a directory inside ${root}: ${path}`);
  const rel = (p) => relative(root, p) || '.';

  const checks = [];
  const add = (area, status, message, extra = {}) => checks.push({ area, status, message, ...extra });

  // Project
  const pkgFile = guard.real(join(dir, 'package.json'));
  const pkg = pkgFile ? readJson(pkgFile) : null;
  const candidates = () => {
    const globs = workspaceGlobs(dir, guard);
    const dirs = globs ? expandWorkspaces(dir, globs, guard) : walk(dir, guard, { match: (n) => n === 'package.json', maxDepth: 3 }).map((f) => dirname(f));
    return dirs
      .filter((d) => d !== dir)
      .map((d) => describePackage(d, guard))
      .filter((p) => p?.ui)
      .map((p) => `${rel(p.dir)} (${p.kind})`);
  };
  if (!pkg) {
    const c = candidates();
    add('project', 'fail', `No readable package.json in ${rel(dir)}.`, {
      fix: c.length ? `Re-run with \`path\` set to one of the Ember packages: ${capped(c).join(', ')}.` : 'Point `path` at the Ember app or addon directory.',
    });
    return finish({ root, dir: rel(dir) }, checks);
  }
  const ember = isEmber(pkg);
  const hasRouter = Boolean(firstExisting(dir, ['app/router.js', 'app/router.ts'], guard));
  // `ember-addon.paths` (in-repo addons) appears in apps too, so only the keyword marks an addon.
  const kind = pkg.keywords?.includes('ember-engine') ? 'engine' : pkg.keywords?.includes('ember-addon') && !hasRouter ? 'addon' : 'app';
  const packageManager = detectPackageManager(dir, root, pkg);
  if (!ember) {
    const c = candidates();
    add('project', 'warn', `${rel(pkgFile)} is not an Ember app or addon (no ember-source dependency or ember-addon keyword).`, {
      fix: c.length ? `Re-run with \`path\` set to one of: ${capped(c).join(', ')}.` : 'Point `path` at the Ember app or addon directory.',
    });
    return finish({ root, dir: rel(dir), packageJson: rel(pkgFile), name: pkg.name, ember, packageManager }, checks);
  } else {
    add('project', 'pass', `Ember ${kind} \`${pkg.name ?? rel(dir)}\`${allDeps(pkg)['ember-source'] ? ` (ember-source ${allDeps(pkg)['ember-source']})` : ''}${packageManager ? `, ${packageManager}` : ''}.`);
  }
  // In-repo addons (ember-addon.paths) and Ember engines
  const inRepo = (pkg['ember-addon']?.paths ?? [])
    .map((p) => {
      const d = guard.real(resolve(dir, p));
      return d ? (describePackage(d, guard) ?? { dir: d, name: p, kind: 'addon', ui: false }) : null;
    })
    .filter(Boolean);
  const extraTemplateDirs = inRepo.filter((a) => a.ui && a.dir !== dir && !a.dir.startsWith(dir + sep)).map((a) => a.dir);
  if (inRepo.length) {
    add('project', 'info', `${inRepo.length} in-repo addon(s); templates in addons with UI are audited with this ${kind}.`, {
      locations: inRepo.map((a) => `${rel(a.dir)} — \`${a.name}\` (${a.kind === 'engine' ? 'engine' : a.ui ? 'has UI' : 'build-only'})`),
    });
  }
  const engines = new Map();
  for (const a of inRepo) if (a.kind === 'engine' && a.name) engines.set(a.name, a.dir);
  const wsRoot = findUp(dir, guard, 'pnpm-workspace.yaml') ?? findUp(dirname(dir), guard, 'package.json');
  const wsGlobs = wsRoot ? workspaceGlobs(wsRoot, guard) : null;
  if (wsGlobs) for (const d of expandWorkspaces(wsRoot, wsGlobs, guard)) {
    const p = describePackage(d, guard);
    if (p?.kind === 'engine' && p.name && !engines.has(p.name)) engines.set(p.name, d);
  }
  for (const name of Object.keys(allDeps(pkg))) {
    if (engines.has(name)) continue;
    const d = guard.real(join(dir, 'node_modules', name));
    if (d && readJson(join(d, 'package.json'))?.keywords?.includes('ember-engine')) engines.set(name, d);
  }
  if (allDeps(pkg)['ember-engines'] || engines.size) {
    add('project', 'info', `Uses Ember engines${engines.size ? `: ${[...engines.keys()].map((n) => `\`${n}\``).join(', ')}` : ' (ember-engines installed, no engine packages found)'}. Routes of mounted engines are included in route coverage.`, {
      locations: capped([...engines].map(([n, d]) => `${n} — ${rel(d)}`)),
    });
  }

  const pm = packageManager ?? 'npm';
  const addDev = (names) => `${pm === 'npm' ? 'npm install --save-dev' : pm === 'yarn' ? 'yarn add --dev' : `${pm} add --save-dev`} ${names}`;

  // Source directories to lint: app/ for apps, src/ for v2 addons, addon/ for classic addons and engines.
  const srcDir = kind === 'app' ? 'app' : ['src', 'addon'].find((d) => firstExisting(dir, [d], guard)) ?? (pkg['ember-addon']?.version === 2 ? 'src' : 'addon');
  const templateDirs = [
    ...(kind === 'app' ? ['app/components', 'app/templates'].filter((d) => firstExisting(dir, [d], guard)).map((d) => rel(join(dir, d))) : []),
    ...(kind !== 'app' || !firstExisting(dir, ['app/components', 'app/templates'], guard) ? [rel(join(dir, srcDir))] : []),
    ...extraTemplateDirs.map(rel),
  ];

  // Addons are often tested from another package: a workspace test app that depends on it, or the host app of an in-repo addon.
  const ownHelper = firstExisting(dir, TEST_HELPERS, guard);
  let testApps = [];
  if (kind !== 'app' && !ownHelper) {
    const hosts = new Set();
    if (wsGlobs && pkg.name) for (const d of expandWorkspaces(wsRoot, wsGlobs, guard)) if (d !== dir && allDeps(readJson(join(d, 'package.json')))[pkg.name]) hosts.add(d);
    for (let d = dirname(dir); d.startsWith(root); d = dirname(d)) {
      const paths = guard.real(join(d, 'package.json')) ? readJson(join(d, 'package.json'))?.['ember-addon']?.paths : null;
      if (paths?.some((p) => guard.real(resolve(d, p)) === dir)) hosts.add(d);
      if (d === root) break;
    }
    testApps = [...hosts].filter((d) => firstExisting(d, TEST_HELPERS, guard)).sort();
  }
  const testAppNames = testApps.map(rel).join(', ');

  // Packages
  const installed = {};
  for (const p of PACKAGES) {
    const inDev = pkg.devDependencies?.[p.name];
    const inDeps = pkg.dependencies?.[p.name];
    installed[p.name] = Boolean(inDev || inDeps);
    if (inDev) add('packages', 'pass', `\`${p.name}\` ${inDev} in devDependencies.`);
    else if (inDeps && kind === 'app') add('packages', 'warn', `\`${p.name}\` is in dependencies; apps should list it in devDependencies.`, { fix: `Move \`${p.name}\` to devDependencies.` });
    else if (inDeps) add('packages', 'pass', `\`${p.name}\` ${inDeps} in dependencies.`);
    else if (testApps.length && TEST_PACKAGES.has(p.name)) add('packages', 'info', `\`${p.name}\` is not installed here; tests live in ${testAppNames}.`);
    else if (p.name === 'ember-a11y-mcp') {
      add('packages', p.level, `\`${p.name}\` is not installed (${p.why}).`, {
        fix: `ember-a11y-mcp is not published to npm yet (see its README). Run its CLI from this server's checkout in ${rel(dir)}: \`node ${LINT_BIN} ${srcDir}\`, or install the checkout as a devDependency (\`${addDev('file:' + dirname(dirname(LINT_BIN)))}\`).`,
      });
    } else add('packages', p.level, `\`${p.name}\` is not installed (${p.why}).`, { fix: addDev(p.name) });
  }

  // ember-template-lint config
  const tlConfig = firstExisting(dir, ['.template-lintrc.js', '.template-lintrc.mjs', '.template-lintrc.cjs'], guard);
  if (!tlConfig) {
    add('template-lint', installed['ember-template-lint'] ? 'fail' : 'warn', 'No ember-template-lint config (.template-lintrc.{js,mjs,cjs}).', {
      fix: "Create .template-lintrc.js with `extends: 'recommended'` (it enables the a11y rules).",
    });
  } else {
    const src = stripJsComments(readFileSync(tlConfig, 'utf8'));
    const file = rel(tlConfig);
    // `overrides: [{ files, rules }]` only apply to matching files; report them separately from the global rules.
    const overrides = [];
    const ov = /\boverrides\s*:\s*\[/.exec(src);
    if (ov) {
      const open = ov.index + ov[0].length - 1;
      const close = matchBrace(src, open, '[', ']');
      for (let i = open + 1; i < close; i++) {
        if (src[i] !== '{') continue;
        const end = matchBrace(src, i);
        const body = src.slice(i, end + 1);
        const filesList = /\bfiles\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? /\bfiles\s*:\s*((['"])[^'"]*\2)/.exec(body)?.[1] ?? '';
        overrides.push({ start: i, end, body, files: [...filesList.matchAll(/(['"])([^'"]*)\1/g)].map((m) => m[2]) });
        i = end;
      }
    }
    let globalSrc = src;
    for (const o of overrides) globalSrc = globalSrc.slice(0, o.start) + o.body.replace(/[^\n]/g, ' ') + globalSrc.slice(o.end + 1);
    if (/extends\s*:\s*(\[[^\]]*)?['"](recommended|ember-template-lint:recommended)['"]/.test(globalSrc)) add('template-lint', 'pass', `${file} extends \`recommended\`.`, { file });
    else add('template-lint', 'warn', `${file} does not extend \`recommended\`, so a11y rules may be disabled by default.`, { file, fix: "Add `extends: 'recommended'`." });
    const weakenedRe = (rule) => new RegExp(`(?<![\\w-])['"]?${rule}['"]?\\s*:\\s*(false|['"](?:off|warn)['"]|\\[\\s*['"](?:off|warn)['"])`);
    let weakened = 0;
    for (const rule of TEMPLATE_LINT_A11Y_RULES) {
      const m = weakenedRe(rule).exec(globalSrc);
      if (m) {
        weakened++;
        add('template-lint', 'fail', `a11y rule \`${rule}\` is set to ${m[1].replace(/^\[\s*/, '')}.`, { file, line: lineOf(src, m.index), fix: `Set \`${rule}\` to 'error' (or remove the override).` });
      }
      for (const o of overrides) {
        const om = weakenedRe(rule).exec(o.body);
        if (!om) continue;
        const scope = o.files.length ? o.files.join(', ') : '(no files listed)';
        // Test-only overrides don't affect shipped templates.
        const testsOnly = o.files.length && o.files.every((f) => /^(\.\/)?tests\//.test(f));
        add('template-lint', testsOnly ? 'info' : 'warn', `a11y rule \`${rule}\` is set to ${om[1].replace(/^\[\s*/, '')} for ${scope} (overrides).`, {
          file,
          line: lineOf(src, o.start + om.index),
          ...(testsOnly ? {} : { fix: `Check that \`${rule}\` really doesn't apply to ${scope}, or remove the override.` }),
        });
      }
    }
    if (!weakened) add('template-lint', 'pass', `No a11y rules are turned off or downgraded to warnings globally in ${file}.`, { file });
  }

  // Inline suppressions in templates
  const templates = collectFiles([dir, ...extraTemplateDirs], root).filter((f) => guard.real(f) && !f.includes(`${sep}node_modules${sep}`));
  const a11yRules = new Set(TEMPLATE_LINT_A11Y_RULES);
  const suppressions = [];
  const unmatched = [];
  for (const f of templates) {
    const src = readFileSync(f, 'utf8');
    for (const [prefix, tool] of [['template-lint', 'template-lint'], ['ember-a11y', 'ember-a11y-lint']]) {
      for (const u of disableDirectives(src, prefix, { filename: f }).unmatched) {
        const open = tool === 'template-lint' ? u.open.filter((n) => n === '*' || a11yRules.has(n)) : u.open;
        const scope = u.until ? `, until </${u.until.tag}> on line ${u.until.line}` : '';
        if (open.length) unmatched.push(`${rel(f)}:${u.line} (${prefix}-disable ${open.includes('*') ? '(all rules)' : open.join(', ')}${scope})`);
      }
    }
    const re = /\{\{!(?:--)?\s*(template-lint-disable(?:-next-line)?|ember-a11y-disable(?:-next-line)?)\b([^}]*)\}\}/g;
    let m;
    while ((m = re.exec(src))) {
      const names = m[2].replace(/--\s*$/, '').trim().split(/[\s,]+/).map((n) => n.replace(/^['"]|['"]$/g, '')).filter(Boolean);
      const tool = m[1].startsWith('template-lint') ? 'template-lint' : 'ember-a11y-lint';
      if (tool === 'template-lint' && names.length && !names.some((n) => a11yRules.has(n))) continue;
      suppressions.push({ file: rel(f), line: lineOf(src, m.index), tool, rules: names.length ? names : ['(all rules)'] });
    }
  }
  if (!suppressions.length) add('suppressions', 'pass', `No inline a11y rule disables in ${templates.length} template(s).`);
  else {
    add('suppressions', 'warn', `${suppressions.length} inline a11y rule disable(s) in templates. Each needs a documented reason.`, {
      count: suppressions.length,
      locations: capped(suppressions.map((s) => `${s.file}:${s.line} (${s.tool}: ${s.rules.join(', ')})`)),
      fix: 'Review each disable; fix the markup or record why the rule does not apply.',
    });
  }
  if (unmatched.length) {
    add('suppressions', 'warn', `${unmatched.length} inline a11y rule disable(s) without a matching enable, so they apply to the rest of the file (or of the enclosing element).`, {
      count: unmatched.length,
      locations: capped(unmatched),
      fix: 'Add a matching `{{! template-lint-enable rule }}` / `{{! ember-a11y-enable rule }}` after the code the disable is meant to cover, or use `-disable-next-line` for a single element.',
    });
  }

  // ember-a11y-testing setup
  const helper = ownHelper;
  let globalHooks = false;
  if (!helper && testApps.length) {
    add('a11y-testing', 'info', `This ${kind} has no tests/test-helper; its tests live in ${testAppNames}. Run audit_project_setup with \`path: "${rel(testApps[0])}"\` to check ember-a11y-testing and route coverage there.`, {
      locations: testApps.map(rel),
    });
  } else if (!helper) add('a11y-testing', 'warn', 'No tests/test-helper.{js,ts} found.', { fix: 'Call `setupGlobalA11yHooks(() => true)` from ember-a11y-testing in your test helper.' });
  else {
    const src = readFileSync(helper, 'utf8');
    globalHooks = /setupGlobalA11yHooks\s*\(/.test(src);
    if (globalHooks) add('a11y-testing', 'pass', `${rel(helper)} calls \`setupGlobalA11yHooks\`, so axe runs after visit/click in tests.`, { file: rel(helper) });
    else add('a11y-testing', installed['ember-a11y-testing'] ? 'warn' : 'info', `${rel(helper)} does not call \`setupGlobalA11yHooks\`; only tests that call \`a11yAudit\` are audited.`, {
      file: rel(helper),
      fix: "import { setupGlobalA11yHooks } from 'ember-a11y-testing/test-support'; setupGlobalA11yHooks(() => true);",
    });
    if (globalHooks || /ember-a11y-testing/.test(src)) add('a11y-testing', 'info', 'Make sure CI enables the audits (for example the `enableA11yAudit` query param or `ENABLE_A11Y_AUDIT=true`), per the ember-a11y-testing README.', { file: rel(helper) });
  }
  const testFiles = walk(join(dir, 'tests'), guard, { match: (n) => /\.(js|ts|gjs|gts)$/.test(n) });
  const disabledAxe = [];
  for (const f of testFiles) {
    const src = readFileSync(f, 'utf8');
    const blocks = /\brules\s*:\s*\{/g;
    let b;
    while ((b = blocks.exec(src))) {
      const open = b.index + b[0].length - 1;
      const close = matchBrace(src, open);
      const re = /(?:^|[\s,{])['"]?([a-z0-9-]+)['"]?\s*:\s*\{\s*enabled\s*:\s*false/g;
      let m;
      while ((m = re.exec(src.slice(open + 1, close)))) disabledAxe.push(`${rel(f)}:${lineOf(src, open + 1 + m.index + m[0].indexOf(m[1]))} (${m[1]})`);
      blocks.lastIndex = close;
    }
  }
  if (disabledAxe.length) add('a11y-testing', 'warn', `${disabledAxe.length} axe rule(s) disabled in tests.`, { count: disabledAxe.length, locations: capped(disabledAxe), fix: 'Re-enable each rule, or record why it does not apply.' });

  // Route coverage
  const router = kind === 'app' ? firstExisting(dir, ['app/router.js', 'app/router.ts'], guard) : null;
  if (router) {
    const routes = [{ name: 'index', path: '/', hasChildren: false }];
    const missingEngines = [];
    for (const r of parseRoutes(readFileSync(router, 'utf8'))) {
      routes.push(r);
      if (!r.engine) continue;
      const er = engines.has(r.engine) ? engineRoutes(engines.get(r.engine), r, guard) : null;
      if (er) routes.push(...er.routes);
      else missingEngines.push(`${r.engine} (mounted at ${r.path})`);
    }
    if (missingEngines.length) add('route-coverage', 'info', `Couldn't find the routes of ${missingEngines.length} mounted engine(s); only their mount paths are counted.`, { locations: missingEngines });
    const acceptance = testFiles.filter((f) => f.includes(`${sep}tests${sep}acceptance${sep}`));
    // Page objects (ember-cli-page-object `visitable`) count when an acceptance test that runs axe imports them.
    const known = new Set(testFiles);
    const pageUrls = new Map();
    const urls = acceptance.flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      if (!globalHooks && !/\ba11yAudit\s*\(/.test(src)) return [];
      const pages = importedTestFiles(f, src, dir, known).flatMap((p) => {
        if (!pageUrls.has(p)) {
          const ps = readFileSync(p, 'utf8');
          pageUrls.set(p, [...visitedUrls(ps, { pageObjects: true }), ...visitedUrls(ps)]);
        }
        return pageUrls.get(p);
      });
      return [...visitedUrls(src), ...pages];
    });
    const uncovered = routes.filter((r) => !urls.some((u) => routeRegex(r).test(u)));
    const summary = `${routes.length - uncovered.length}/${routes.length} routes are visited by an acceptance test that runs axe (${acceptance.length} acceptance file(s)).`;
    if (!uncovered.length) add('route-coverage', 'pass', summary, { file: rel(router) });
    else add('route-coverage', urls.length ? 'warn' : 'fail', summary, {
      file: rel(router),
      count: uncovered.length,
      locations: capped(uncovered.map((r) => `${r.name} (${r.path})`)),
      fix: 'Add an acceptance test that visits each route and calls `a11yAudit()` (or rely on `setupGlobalA11yHooks`).',
    });
  } else if (kind === 'app' && ember) add('route-coverage', 'info', 'No app/router.{js,ts} found; route coverage not checked.');
  else if (kind === 'engine') add('route-coverage', 'info', 'Engine routes are checked from the host app that mounts this engine.');

  // Lint todos (.lint-todo): violations deferred with --update-todo are hidden from lint output until their decay dates.
  const lt = readA11yTodos(dir, guard);
  if (!lt) add('lint-todos', 'pass', 'No .lint-todo file, so no a11y violations are hidden as todos.');
  else if (lt.legacy) add('lint-todos', 'warn', `${lt.file} uses the legacy directory format, which this audit can't read.`, { file: lt.file, fix: 'Upgrade ember-template-lint and run it once to migrate .lint-todo to the current single-file format.' });
  else {
    const s = summarizeTodos(lt.todos);
    if (!s.total) add('lint-todos', 'pass', `${lt.file} has no todos for a11y rules.`, { file: lt.file });
    else {
      const rules = Object.entries(s.byRule).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`).join(', ');
      add('lint-todos', 'warn', `${s.total} a11y violation(s) in ${s.files} file(s) are deferred as lint todos: ${s.byStatus.todo} hidden, ${s.byStatus.warn + s.byStatus.error} past due. Rules: ${rules}.`, {
        file: lt.file,
        count: lt.todos.length,
        locations: capped(lt.todos.map(formatTodo)),
        fix: 'Call list_a11y_todos to work through them; after fixing, run `ember-template-lint --clean-todo` (or the eslint equivalent).',
      });
      if (s.noDueDate) add('lint-todos', 'warn', `${s.noDueDate} a11y todo(s) have no due date, so they stay hidden indefinitely.`, {
        file: lt.file,
        fix: 'Set `daysToDecayByRule` for a11y rules in .lint-todorc.js (or package.json `lintTodo`) and regenerate todos so they resurface.',
      });
    }
    if (lt.decay?.engines.length) add('lint-todos', 'warn', `Todo decay is disabled (\`daysToDecay: null\`) in ${lt.decay.file}, so new todos never resurface.`, {
      file: lt.decay.file,
      fix: 'Configure `daysToDecayByRule` with warn/error days for a11y rules.',
    });
  }

  // Scripts
  const scripts = Object.values(pkg.scripts ?? {}).join('\n');
  if (installed['ember-template-lint']) {
    if (/ember-template-lint/.test(scripts)) add('scripts', 'pass', 'A package.json script runs ember-template-lint.');
    else add('scripts', 'warn', 'No package.json script runs ember-template-lint, so CI may not enforce it.', { fix: 'Add `"lint:hbs": "ember-template-lint ."` and run it in CI.' });
  }
  if (/ember-a11y-lint/.test(scripts)) add('scripts', 'pass', 'A package.json script runs ember-a11y-lint.');
  else add('scripts', 'info', 'No package.json script runs ember-a11y-lint.', {
    fix: `Add \`"lint:a11y": "ember-a11y-lint ${srcDir}"\` to ${rel(pkgFile)}${installed['ember-a11y-mcp'] ? '' : ' (after installing ember-a11y-mcp, see above)'} and run it in CI.`,
  });

  return finish({ root, dir: rel(dir), packageJson: rel(pkgFile), name: pkg.name, ember, kind, packageManager, ...(testApps.length ? { testApps: testApps.map(rel) } : {}), templateDirs }, checks);
}

function finish(project, checks) {
  const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
  checks.forEach((c) => summary[c.status]++);
  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  const todo = checks.filter((c) => c.fix && c.status !== 'pass').sort((a, b) => order[a.status] - order[b.status]);
  const areas = [...new Set(checks.map((c) => c.area))];
  const text = [
    '# Accessibility setup audit',
    '_Read-only check of packages, template-lint and ember-a11y-testing configuration, inline disables, deferred lint todos and route test coverage. Nothing was changed. Results are heuristics; verify before acting._',
    '',
    `**${project.dir}: ${summary.fail} failing, ${summary.warn} warnings, ${summary.pass} passing.**`,
    ...areas.flatMap((area) => [
      '',
      `## ${area}`,
      ...checks
        .filter((c) => c.area === area)
        .flatMap((c) => [
          `- ${ICON[c.status]} ${c.message}${c.file && c.line ? ` (${c.file}:${c.line})` : ''}`,
          ...(c.locations ?? []).map((l) => `  - ${l}`),
        ]),
    ]),
    ...(todo.length ? ['', '## Next steps', ...todo.map((c, i) => `${i + 1}. ${c.fix}`)] : []),
    ...(project.templateDirs?.length ? ['', `Then run \`audit_ember_template\` on ${project.templateDirs.join(', ')}.`] : []),
  ].join('\n');
  return { text, project, checks, summary };
}
