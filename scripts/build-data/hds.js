// Extracts component docs, accessibility notes, code snippets, and implementation sources from a
// local clone of hashicorp/design-system (Helios, HDS).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readSource, commitOf, originUrl, collapse } from './util.js';

const BASE_URL = 'https://helios.hashicorp.design/';
const GITHUB_REPO = 'https://github.com/hashicorp/design-system';
const GITHUB_TREE_MAIN = `${GITHUB_REPO}/tree/main/`;
const DOCS_ROOT = 'website/docs';
const SECTIONS = ['components', 'patterns', 'utilities', 'overrides'];
const HDS_COMPONENTS = 'packages/components/src/components/hds';
const FILE_CAP = 20000;
const DOC_CAP = 80000;

const APG_PATTERN_IDS = new Set(
  'accordion alert alertdialog breadcrumb button carousel checkbox combobox dialog-modal disclosure feed grid landmarks link listbox menu-button menubar meter radio slider slider-multithumb spinbutton switch table tabs toolbar tooltip treegrid treeview windowsplitter'.split(
    ' ',
  ),
);

// Hand-curated HDS doc -> APG pattern mapping, verified against roles/ARIA in the implementation
// (paths relative to packages/components/src/components/hds unless noted).
const APG_MAP = {
  accordion: ['components/accordion'], // accordion/item/button.gts aria-expanded + aria-controls
  alert: ['components/alert', 'components/toast'], // alert/index.gts, toast/index.gts role="alert"
  breadcrumb: ['components/breadcrumb'], // breadcrumb/index.gts <nav aria-label>
  button: ['components/button', 'components/copy/button', 'utilities/dismiss-button', 'utilities/interactive'],
  checkbox: ['components/form/checkbox', 'patterns/table-multi-select'], // form/checkbox/base.gts type="checkbox"
  combobox: ['components/form/super-select', 'overrides/power-select'], // ember-power-select based
  'dialog-modal': [
    'components/modal', // modal/index.gts <dialog> + showModal()
    'components/flyout', // flyout/index.gts <dialog> + showModal()
    'utilities/dialog-primitive', // dialog-primitive/wrapper.gts <dialog>
    'components/app-side-nav', // app-side-nav/index.gts role="dialog" aria-modal="true" (mobile)
  ],
  disclosure: [
    'utilities/disclosure-primitive',
    'components/reveal', // reveal/toggle/button.gts aria-expanded
    'components/dropdown', // dropdown/toggle/button.gts aria-expanded (no role="menu")
    'components/rich-tooltip', // rich-tooltip/toggle.gts aria-expanded
    'components/breadcrumb', // breadcrumb/truncation.gts aria-expanded
    'components/filter-bar', // filter-bar/index.gts aria-expanded
    'components/app-header', // app-header/menu-button.gts aria-expanded
    'components/app-side-nav', // app-side-nav/index.gts aria-expanded toggle
  ],
  grid: ['components/table/advanced-table', 'utilities/composite'], // advanced-table/index.gts role="grid"
  landmarks: ['components/app-header', 'components/app-side-nav', 'components/app-footer'],
  link: ['components/link/standalone', 'components/link/inline', 'utilities/interactive'],
  listbox: ['components/dropdown'], // dropdown/index.gts sets role="listbox" when list has checkmark role="option" items
  radio: ['components/form/radio', 'components/form/radio-card'],
  slider: ['components/table/advanced-table'], // advanced-table/th-resize-handle.gts role="slider"
  switch: ['components/form/toggle'], // form/toggle/base.gts role="switch"
  table: ['components/table/table', 'patterns/table-multi-select'], // table/index.gts <table>
  tabs: [
    'components/tabs', // tabs/index.gts role="tablist", tabs/tab.gts role="tab"
    'components/filter-bar', // filter-bar/tabs/index.gts role="tablist"
    'components/stepper/nav', // stepper/nav/index.gts role="tablist", stepper/nav/step.gts role="tab"
  ],
  toolbar: ['utilities/composite'], // headless roving focus; docs: "strictly a horizontal toolbar or a vertical list"
  tooltip: ['components/tooltip', 'components/rich-tooltip'], // rich-tooltip/bubble.gts role="tooltip"
};

// Extra implementation files beyond the doc's implementation dir.
const EXTRA_IMPL_FILES = {
  'components/tooltip': ['packages/components/src/modifiers/hds-tooltip.ts'],
};

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p) => existsSync(p) && statSync(p).isFile();

function walkFiles(root, rel, filter) {
  const out = [];
  const visit = (r) => {
    for (const name of readdirSync(join(root, r)).sort()) {
      const p = posix.join(r, name);
      if (isDir(join(root, p))) visit(p);
      else if (filter(p)) out.push(p);
    }
  };
  if (isDir(join(root, rel))) visit(rel);
  return out.sort(cmp);
}

/* ------------------------------------------------------------------ frontmatter (YAML subset) */

function unquote(s) {
  s = s.trim();
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(s)) return JSON.parse(s);
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\[.*\]$/.test(s))
    return s
      .slice(1, -1)
      .split(',')
      .map((x) => unquote(x))
      .filter((x) => x !== '');
  return s;
}

/** Parse the indentation-based YAML subset used in HDS docs frontmatter (maps, scalar lists, block scalars). */
export function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  const lines = m[1].split('\n');
  let i = 0;
  const indentOf = (l) => l.match(/^ */)[0].length;
  const skipBlank = () => {
    while (i < lines.length && !lines[i].trim()) i++;
  };

  function blockScalar(style, parentIndent) {
    const buf = [];
    while (i < lines.length && (!lines[i].trim() || indentOf(lines[i]) > parentIndent)) buf.push(lines[i++]);
    while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
    const ind = Math.min(...buf.filter((l) => l.trim()).map(indentOf));
    const body = buf.map((l) => l.slice(ind));
    if (style.startsWith('|')) return body.join('\n');
    return body
      .join('\n')
      .replace(/([^\n])\n(?=[^\n])/g, '$1 ')
      .replace(/\n\n/g, '\n');
  }

  function value(rest, parentIndent) {
    if (/^[>|][-+]?$/.test(rest)) return blockScalar(rest, parentIndent);
    if (rest !== '') {
      // Plain multi-line scalars continue on more-indented lines.
      let v = rest;
      while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > parentIndent && !/^\s*- /.test(lines[i]))
        v += ' ' + lines[i++].trim();
      return unquote(v);
    }
    skipBlank();
    if (i >= lines.length || indentOf(lines[i]) <= parentIndent) {
      // Lists may sit at the same indent as their key.
      if (i < lines.length && indentOf(lines[i]) === parentIndent && /^\s*- /.test(lines[i])) return node(parentIndent);
      return null;
    }
    return node(indentOf(lines[i]));
  }

  function node(indent) {
    skipBlank();
    if (/^\s*- /.test(lines[i])) {
      const arr = [];
      while (i < lines.length) {
        skipBlank();
        if (i >= lines.length || indentOf(lines[i]) !== indent || !/^\s*- /.test(lines[i])) break;
        const item = lines[i++].trim().slice(2);
        arr.push(value(item, indent));
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length) {
      skipBlank();
      if (i >= lines.length || indentOf(lines[i]) !== indent) break;
      const kv = lines[i].trim().match(/^([^:]+):(?:\s+(.*))?$/);
      if (!kv) throw new Error(`unparseable frontmatter line: ${lines[i]}`);
      i++;
      obj[unquote(kv[1])] = value((kv[2] ?? '').trim(), indent);
    }
    return obj;
  }

  return { data: node(0), body: src.slice(m[0].length) };
}

/* ------------------------------------------------------------------ accessibility markdown */

const BADGE_RE = /<Doc::Badge\s+@type=(["'])([\w-]+)\1\s*>([\s\S]*?)<\/Doc::Badge>/g;
const MARK = /\u0001(\w+)\u0002([^\u0003]*)\u0003/g;
const MODIFIER_KEYS = /^(fn|shift|ctrl|control|alt|option|cmd|command|meta)$/i;

function badgeLabel(inner) {
  const icon = inner.match(/<Hds::Icon\b[^>]*@title=(["'])(.*?)\1/);
  const raw = icon ? icon[2] : inner.replace(/<[^>]+>/g, ' ');
  return collapse(raw.replace(/`/g, '').replace(/\\([[\]\\*_`])/g, '$1'));
}

/** Replace badges with single-line markers and flatten <Doc::BadgeGroup> so each group is one line. */
function preprocess(md) {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(BADGE_RE, (_, _q, type, inner) => `\u0001${type}\u0002${badgeLabel(inner)}\u0003`)
    .replace(/<Doc::BadgeGroup>([\s\S]*?)<\/Doc::BadgeGroup>/g, (_, inner) => '\n' + collapse(inner) + '\n');
}

const RATINGS = [
  [/\b(not|non)[- ]conformant\b/i, 'not-conformant'],
  [/\bconditionally conformant\b/i, 'conditionally-conformant'],
  [/^conformant$/i, 'conformant'],
];
const normalizeRating = (label) => RATINGS.find(([re]) => re.test(label.trim()))?.[1] ?? null;

const isBadgeLine = (l) => l.trim() !== '' && l.replace(MARK, '').trim() === '';
const isImageLine = (l) => /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l) || /^\s*<Doc::ImageCaption\b.*\/>\s*$/.test(l);
const isSkipLine = (l) => /^\s*(<Doc::A11ySupport\s*\/>|@include\s|---\s*$)/.test(l);

/** Tokenize preprocessed markdown into headings, badge blocks, callouts, images, and paragraphs. */
function tokenize(md) {
  const lines = md.split('\n');
  const tokens = [];
  let para = null;
  const flush = () => {
    if (para) tokens.push({ type: 'para', text: para.join('\n').trim() });
    para = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || isSkipLine(line)) {
      flush();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      tokens.push({ type: 'heading', level: h[1].length, text: h[2] });
      continue;
    }
    const c = line.match(/^!!!\s*(\w*)\s*$/);
    if (c && c[1]) {
      flush();
      const body = [];
      while (++i < lines.length && !/^!!!\s*$/.test(lines[i])) body.push(lines[i]);
      const text = body
        .filter((l) => !isImageLine(l))
        .join('\n')
        .trim();
      tokens.push({ type: 'callout', kind: c[1], text });
      continue;
    }
    if (isBadgeLine(line)) {
      flush();
      const badges = [...line.matchAll(MARK)].map((m) => ({ type: m[1], label: m[2] }));
      const prev = tokens[tokens.length - 1];
      if (prev?.type === 'badges') prev.badges.push(...badges);
      else tokens.push({ type: 'badges', badges });
      continue;
    }
    if (isImageLine(line)) {
      flush();
      tokens.push({ type: 'image' });
      continue;
    }
    if (/<Doc::WcagList\b/.test(line)) {
      flush();
      continue;
    }
    const snip = line.match(/^\s*\[\[code-snippets\/([\w.-]+)\]\]\s*$/);
    if (snip) {
      flush();
      tokens.push({ type: 'snippet', name: snip[1] });
      continue;
    }
    (para ??= []).push(line.trimEnd());
  }
  flush();
  return tokens;
}

/** Combine modifier badges with the following key: ["Fn", "Left arrow"] -> ["Fn + Left arrow"]. */
function combineKeys(labels) {
  const keys = [];
  let pending = [];
  for (const l of labels) {
    if (MODIFIER_KEYS.test(l)) pending.push(l);
    else {
      keys.push([...pending, l].join(' + '));
      pending = [];
    }
  }
  if (pending.length) keys.push(...pending);
  return keys;
}

const inlineMarkers = (s) =>
  s.replace(MARK, (_, type, label) => (type === 'neutral' ? '`' + label + '`' : '**' + label + '**'));

function cleanText(md) {
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const c = line.match(/^!!!\s*(\w*)\s*$/);
    if (c && c[1]) {
      const body = [];
      while (++i < lines.length && !/^!!!\s*$/.test(lines[i])) if (!isImageLine(lines[i])) body.push(lines[i]);
      const text = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text) {
        out.push('', `> **${c[1][0].toUpperCase()}${c[1].slice(1)}**`, '>');
        for (const l of text.split('\n')) out.push(l.trim() ? `> ${inlineMarkers(l)}` : '>');
        out.push('');
      }
      continue;
    }
    if (isImageLine(line) || isSkipLine(line)) continue;
    const wcag = line.match(/<Doc::WcagList\b[^>]*@criteriaList=\{\{array\s+([^}]*)\}\}/);
    if (wcag) {
      out.push(`WCAG: ${wcagFrom(wcag[1]).join(', ')}`);
      continue;
    }
    const snip = line.match(/^\s*\[\[code-snippets\/([\w.-]+)\]\]\s*$/);
    if (snip) {
      out.push(`(See code snippet \`${snip[1]}\`.)`);
      continue;
    }
    out.push(inlineMarkers(line).trimEnd());
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compareWcag(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function wcagFrom(arrayArgs) {
  return [...new Set([...arrayArgs.matchAll(/["'](\d+\.\d+\.\d+)["']/g)].map((m) => m[1]))].sort(compareWcag);
}

/** Parse an HDS accessibility partial into structured conformance/keyboard/WCAG data plus clean text. */
export function parseAccessibility(md, warn = () => {}) {
  const pre = preprocess(md);
  const tokens = tokenize(pre);
  const conformance = [];
  const keyboard = [];
  let h2 = null;
  let h3 = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading') {
      if (t.level <= 2) [h2, h3] = [t.text, null];
      else if (t.level === 3) h3 = t.text;
      continue;
    }
    if (t.type !== 'badges') continue;
    const neutral = t.badges.filter((b) => b.type === 'neutral');
    const ratings = t.badges.filter((b) => b.type !== 'neutral');
    // Collect following content until the next heading or badge block.
    const desc = [];
    const notes = [];
    let seenImage = false;
    let j = i + 1;
    for (; j < tokens.length && tokens[j].type !== 'heading' && tokens[j].type !== 'badges'; j++) {
      const n = tokens[j];
      if (n.type === 'image') seenImage = true;
      else if (n.type === 'callout') notes.push(n.text);
      else if (n.type === 'para') {
        if (!seenImage && !notes.length && !desc.length) desc.push(n.text);
        else notes.push(n.text);
      }
    }
    const plain = (s) => inlineMarkers(s).trim();
    if (ratings.length) {
      const inConformance = /^conformance/i.test(h2 ?? '');
      if (!inConformance) warn(`rating badge outside conformance section (under "${h2}")`);
      // Rating notes stop at the first callout (callouts there are general remarks).
      const note = [];
      for (let k = i + 1; k < j && tokens[k].type === 'para'; k++) note.push(plain(tokens[k].text));
      for (const b of ratings) {
        const rating = normalizeRating(b.label);
        if (!rating) {
          warn(`unknown conformance rating "${b.label}"`);
          continue;
        }
        conformance.push({ subject: inConformance ? (h3 ?? null) : null, rating, note: note.join('\n\n') });
      }
    }
    if (neutral.length) {
      keyboard.push({
        group: h3 && !/keyboard/i.test(h3) ? h3 : null,
        keys: combineKeys(neutral.map((b) => b.label)),
        description: desc.map(plain).join('\n\n'),
        note: notes.map(plain).join('\n\n'),
      });
    }
  }

  const wcag = [
    ...new Set([...pre.matchAll(/<Doc::WcagList\b[^>]*@criteriaList=\{\{array\s+([^}]*)\}\}/g)].flatMap((m) => wcagFrom(m[1]))),
  ].sort(compareWcag);

  const text = cleanText(pre);
  const ki = text.match(/^## Known issues[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/im);
  const knownIssues = ki ? ki[1].trim() || null : null;

  return { conformance, keyboard, knownIssues, wcag, text };
}

/* ------------------------------------------------------------------ build */

function snippetFrom(repoDir, path, blobBase) {
  return {
    name: posix.basename(path, '.gts'),
    path,
    url: blobBase + path,
    code: readSource(repoDir, path),
  };
}

const bySnippet = (a, b) => cmp(a.name, b.name) || cmp(a.path, b.path);

function resolveImplDir(repoDir, fm, id) {
  const gh = fm.links?.github;
  const candidates = [];
  if (typeof gh === 'string' && gh.startsWith(GITHUB_TREE_MAIN)) {
    const rel = gh.slice(GITHUB_TREE_MAIN.length).replace(/\/+$/, '');
    candidates.push(rel, rel.replace(/^packages\/components\/addon\//, 'packages/components/src/'));
  }
  candidates.push(posix.join(HDS_COMPONENTS, id.split('/').slice(1).join('/')));
  return candidates.find((c) => isDir(join(repoDir, c))) ?? null;
}

function buildImplementation(repoDir, id, dir, commit) {
  const extra = EXTRA_IMPL_FILES[id] ?? [];
  if (!dir && !extra.length) return null;
  const isSource = (p) => /\.(gts|ts)$/.test(p) && !p.endsWith('.d.ts') && posix.basename(p) !== 'types.ts';
  const paths = [...new Set([...(dir ? walkFiles(repoDir, dir, isSource) : []), ...extra.filter((p) => isFile(join(repoDir, p)))])].sort(
    cmp,
  );
  let total = 0;
  let exhausted = false;
  const files = paths.map((path) => {
    const url = `${GITHUB_REPO}/blob/${commit}/${path}`;
    if (exhausted) return { path, url, code: null, truncated: true };
    let code = readSource(repoDir, path);
    let truncated = false;
    if (code.length > FILE_CAP) [code, truncated] = [code.slice(0, FILE_CAP), true];
    if (total + code.length > DOC_CAP) {
      exhausted = true;
      return { path, url, code: null, truncated: true };
    }
    total += code.length;
    return { path, url, code, truncated };
  });
  return { dir, url: dir ? `${GITHUB_REPO}/tree/${commit}/${dir}` : null, files };
}

function findDocPages(repoDir) {
  const pages = [];
  for (const section of SECTIONS) {
    const visit = (rel) => {
      const abs = join(repoDir, DOCS_ROOT, rel);
      if (isFile(join(abs, 'index.md'))) pages.push(rel);
      for (const name of readdirSync(abs).sort()) {
        if (name === 'partials') continue;
        if (isDir(join(abs, name))) visit(posix.join(rel, name));
      }
    };
    visit(section);
  }
  return pages.sort(cmp);
}

function buildDoc(repoDir, id, commit, warnings) {
  const docDir = posix.join(DOCS_ROOT, id);
  const blobBase = `${GITHUB_REPO}/blob/${commit}/`;
  const { data: fm } = parseFrontmatter(readSource(repoDir, posix.join(docDir, 'index.md')));
  const warn = (m) => warnings.push(`${id}: ${m}`);

  const a11yPath = [posix.join(docDir, 'partials/accessibility/accessibility.md'), posix.join(docDir, 'partials/accessibility.md')].find(
    (p) => isFile(join(repoDir, p)),
  );
  const gtsSnippets = walkFiles(repoDir, posix.join(docDir, 'partials'), (p) => p.includes('/code-snippets/') && p.endsWith('.gts'));
  const isA11ySnippet = (p) => p.startsWith(posix.join(docDir, 'partials/accessibility/'));

  let accessibility = null;
  if (a11yPath) {
    const parsed = parseAccessibility(readSource(repoDir, a11yPath), warn);
    if (!parsed.conformance.length) warn('accessibility partial has no conformance rating');
    accessibility = {
      ...parsed,
      snippets: gtsSnippets.filter(isA11ySnippet).map((p) => snippetFrom(repoDir, p, blobBase)).sort(bySnippet),
    };
  }

  const implDir = resolveImplDir(repoDir, fm, id);
  // Pattern pages are guidance only and have no implementation of their own.
  if (!implDir && !EXTRA_IMPL_FILES[id] && !id.startsWith('patterns/')) warn('no implementation directory');

  const keywords = fm.navigation?.keywords ?? fm.keywords ?? [];
  return {
    id,
    section: id.split('/')[0],
    title: String(fm.title ?? ''),
    description: collapse(fm.description ?? ''),
    keywords: (Array.isArray(keywords) ? keywords : []).map(String),
    related: (Array.isArray(fm.related) ? fm.related : []).map(String),
    url: BASE_URL + id,
    accessibility,
    snippets: gtsSnippets
      .filter((p) => !isA11ySnippet(p))
      .map((p) => snippetFrom(repoDir, p, blobBase))
      .sort(bySnippet),
    implementation: buildImplementation(repoDir, id, implDir, commit),
    apgPatterns: [],
  };
}

export async function buildHds({ sourceDir }) {
  const repoDir = isDir(join(sourceDir, DOCS_ROOT)) ? sourceDir : join(sourceDir, 'design-system');
  if (!isDir(join(repoDir, DOCS_ROOT))) throw new Error(`HDS docs not found under ${sourceDir}`);
  const commit = commitOf(repoDir);
  const warnings = [];

  const docs = findDocPages(repoDir).map((id) => buildDoc(repoDir, id, commit, warnings));
  const docById = new Map(docs.map((d) => [d.id, d]));

  for (const [pattern, ids] of Object.entries(APG_MAP)) {
    if (!APG_PATTERN_IDS.has(pattern)) throw new Error(`invalid APG pattern id in APG_MAP: ${pattern}`);
    for (const id of ids) {
      const doc = docById.get(id);
      if (doc) doc.apgPatterns.push(pattern);
      else warnings.push(`APG_MAP ${pattern}: doc ${id} not found`);
    }
  }
  const apgIndex = {};
  for (const doc of docs) {
    doc.apgPatterns = [...new Set(doc.apgPatterns)].sort(cmp);
    for (const p of doc.apgPatterns) (apgIndex[p] ??= []).push(doc.id);
  }
  const sortedIndex = Object.fromEntries(
    Object.keys(apgIndex)
      .sort(cmp)
      .map((k) => [k, apgIndex[k].sort(cmp)]),
  );

  for (const w of warnings) console.warn(`[hds] ${w}`);

  return {
    source: {
      name: 'HashiCorp Helios Design System (HDS)',
      repo: originUrl(repoDir),
      commit,
      license: 'MPL-2.0',
      licenseUrl: 'https://www.mozilla.org/en-US/MPL/2.0/',
      baseUrl: BASE_URL,
      githubBlobBase: `${GITHUB_REPO}/blob/${commit}/`,
      notice:
        'Code excerpts are from the HashiCorp Helios Design System, Copyright (c) HashiCorp, Inc., licensed under MPL-2.0. Each excerpt links to its source file.',
    },
    docs: docs.sort(byId),
    apgIndex: sortedIndex,
  };
}
