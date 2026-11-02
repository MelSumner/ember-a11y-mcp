import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { apg, aria, getAttribute, getRole, hasData, hds, htmlAria, wcag, isNextAriaAttribute, isNextAriaRole, suggest } from './data/index.js';
import { lintTemplate, collectFiles, rules } from './lint/index.js';
import { patternGuidance, emberGeneral } from './ember-guidance.js';
import { wcagEmber } from './wcag-ember.js';
import { apgTestSpec, specRoles } from './apg-test-spec.js';
import { roleSelector } from './role-selectors.js';
import { auditProjectSetup as runSetupAudit, rootGuard } from './setup-audit.js';
import { a11yTodosForFiles, formatTodo, readA11yTodos, summarizeTodos } from './lint-todos.js';
import { formatRelatedFiles, relatedFiles } from './related-files.js';

const list = (xs) => (xs?.length ? xs.join(', ') : '—');
const code = (xs) => (xs?.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');
const trim = (s, n = 1200) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? ''));

// ---------------------------------------------------------------------------
// ARIA

export function getAriaRole({ role }) {
  const name = role.trim().toLowerCase();
  const r = getRole(name);
  if (!r) {
    if (isNextAriaRole(name)) return `\`${name}\` is defined only in the ARIA 1.3 editor's draft, not in the ARIA 1.2 baseline. Provide an ARIA 1.2 fallback role.`;
    const s = suggest(name, Object.keys(aria().roles));
    return `Unknown role \`${name}\`.${s ? ` Did you mean \`${s}\`?` : ''}`;
  }
  const htmlRows = htmlAria().elements.filter((e) => e.implicitRole === name).map((e) => `<${e.element}>`);
  const pattern = apg().patterns.find((p) => p.rolesStatesProperties?.roles?.includes(name));
  const ctx = r.requiredContextRoles.map((c) => (c.via ? `${c.role} → ${c.via.join(' → ')}` : c.role));
  const owned = r.requiredOwnedElements.map((c) => (c.via ? `${c.via.join(' → ')} → ${c.role}` : c.role));
  return [
    `# role="${name}"${r.abstract ? ' (abstract — do not use)' : ''}${r.deprecated ? ' (deprecated)' : ''}`,
    `Source: WAI-ARIA 1.2${r.module !== 'core' ? ` / ${r.module}` : ''} — ${r.url}`,
    '',
    trim(r.description, 1500),
    '',
    `- **Superclass chain:** ${list(r.superclassChain)}`,
    `- **Subclasses:** ${list(r.subclassRoles)}`,
    `- **Required context:** ${list(ctx)}`,
    `- **Required owned elements:** ${list(owned)}`,
    `- **Required attributes:** ${code(r.requiredAttributes)}${Object.keys(r.requiredAttributeConditions ?? {}).length ? ` (conditions: ${JSON.stringify(r.requiredAttributeConditions)})` : ''}`,
    `- **Supported attributes (role-specific):** ${code(r.supportedAttributes.filter((a) => !getAttribute(a)?.global || getAttribute(a)?.globalDeprecated))}`,
    `- **Prohibited attributes:** ${code(r.prohibitedAttributes)}`,
    `- **Name from:** ${list(r.nameFrom)}; name required: ${r.nameRequired ? 'yes' : 'no'}${r.nameProhibited ? ' (naming prohibited)' : ''}`,
    `- **Children presentational:** ${r.childrenPresentational ? 'yes' : 'no'}`,
    r.implicitValues ? `- **Implicit values:** ${JSON.stringify(r.implicitValues)}` : null,
    `- **Native HTML with this implicit role:** ${list(htmlRows)}`,
    pattern ? `- **APG pattern:** ${pattern.title} (\`get_apg_pattern ${pattern.id}\`)` : null,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

export function getAriaAttribute({ attribute }) {
  const name = attribute.trim().toLowerCase();
  const a = getAttribute(name);
  if (!a) {
    if (name === 'aria-description') return '`aria-description` (ARIA 1.3) defines a string that describes the current element, like aria-describedby but with the text inline. It is a global attribute: this project allows it on any element, and the linter never flags it. Screen reader support varies, so do not rely on it for essential information.';
    if (isNextAriaAttribute(name)) return `\`${name}\` is defined only in the ARIA 1.3 editor's draft, not in ARIA 1.2.`;
    const s = suggest(name, Object.keys(aria().attributes));
    return `Unknown attribute \`${name}\`.${s ? ` Did you mean \`${s}\`?` : ''}`;
  }
  const native = htmlAria().nativeEquivalents.filter((n) => n.ariaAttribute === name);
  return [
    `# ${name} (${a.kind})${a.deprecated ? ' — deprecated' : ''}`,
    `Source: WAI-ARIA 1.2 — ${a.url}`,
    '',
    trim(a.description, 1500),
    '',
    `- **Value type:** ${a.valueType}${a.values?.length ? ` — ${a.values.map((v) => `\`${v.value}\`${v.default ? ' (default)' : ''}`).join(', ')}` : ''}`,
    `- **Global:** ${a.global ? (a.globalDeprecated ? 'deprecated as global in 1.2 — only use on roles that support it' : 'yes') : 'no'}`,
    `- **Used in roles:** ${list(a.usedInRoles)}`,
    ...native.map((n) => `- **Native HTML equivalent:** ${n.htmlFeature} — ${n.guidance}`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// HTML

export function getHtmlElementRules({ element }) {
  const q = element.trim().toLowerCase().replace(/^<|>$/g, '');
  const [tag, ...rest] = q.split(/\s+/);
  const typeMatch = /type\s*=\s*"?([\w-]+)"?/.exec(rest.join(' '));
  let rows = htmlAria().elements.filter((e) => e.id === q || e.id === `el-${q}` || e.match.tags?.includes(tag) || (e.match.customElement && tag.includes('-')));
  if (typeMatch) rows = rows.filter((r) => r.match.inputTypes?.includes(typeMatch[1]));
  if (!rows.length) return `No ARIA in HTML rule found for \`${element}\`. Try a tag name like \`input type=checkbox\`, \`a\`, or \`section\`.`;
  return rows
    .map((r) =>
      [
        `## <${r.element}>`,
        r.url,
        r.match.context ? `_Applies when: ${r.match.context}_` : null,
        `- **Implicit role:** ${r.implicitRole ?? 'none (no corresponding role)'}${r.implicitRoleAlternatives?.length ? ` (or ${r.implicitRoleAlternatives.join(', ')})` : ''}`,
        `- **Allowed roles:** ${r.rolePolicy === 'any' ? 'any role' : r.rolePolicy === 'none' ? 'no role' : list(r.allowedRoles)}`,
        r.notRecommendedRoles.length ? `- **Not recommended:** ${list(r.notRecommendedRoles)}` : null,
        r.shouldNotRoles.length ? `- **Should not use:** ${list(r.shouldNotRoles)}` : null,
        `- **aria-* allowed:** ${{ 'global-and-role': 'global attributes + those supported by the role', none: 'no role or aria-* attributes', 'hidden-only': 'only aria-hidden' }[r.ariaPolicy]}`,
        r.namingProhibited ? '- **Naming prohibited:** aria-label/aria-labelledby must not be used without a role that supports naming' : null,
        ...(r.attributeRules ?? []).map((ar) => `- **${ar.level.toUpperCase()}** use ${ar.attributes.map((x) => `\`${x.name}${x.value ? `="${x.value}"` : ''}\``).join(', ')}`),
        ...(r.notes ?? []).map((n) => `- Note: ${n}`),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// APG

export function listApgPatterns() {
  return [
    '# APG patterns',
    ...apg().patterns.map((p) => `- **${p.id}** — ${p.title}${patternGuidance[p.id]?.native ? `  _(native: ${patternGuidance[p.id].native.split(/[.;—]/)[0]})_` : ''}`),
    '',
    '# APG practices',
    ...apg().practices.map((p) => `- **${p.id}** — ${p.title}`),
  ].join('\n');
}

function findPattern(id) {
  const q = id.trim().toLowerCase();
  const ps = apg().patterns;
  return ps.find((p) => p.id === q) ?? ps.find((p) => p.id.startsWith(q)) ?? ps.find((p) => p.title.toLowerCase().includes(q)) ?? null;
}

export function getApgPattern({ pattern, includeExamples = true }) {
  const p = findPattern(pattern);
  if (!p) {
    const practice = apg().practices.find((x) => x.id === pattern || x.title.toLowerCase().includes(pattern.toLowerCase()));
    if (practice) return [`# ${practice.title}`, practice.url, '', ...practice.sections.map((s) => `${'#'.repeat(Math.min(s.level ?? 2, 4))} ${s.heading}\n\n${trim(s.text, 1500)}`)].join('\n');
    return `Unknown pattern \`${pattern}\`. Available: ${apg().patterns.map((x) => x.id).join(', ')}`;
  }
  const g = patternGuidance[p.id];
  const examples = apg().examples.filter((e) => e.patternId === p.id);
  return [
    `# ${p.title}`,
    p.url,
    '',
    trim(p.about, 2000),
    g ? `\n## Prefer native HTML first\n${g.native}` : null,
    `\n## Keyboard interaction\n${trim(p.keyboardInteraction?.text, 4000) || '_See the pattern page._'}`,
    `\n## Roles, states and properties\n${trim(p.rolesStatesProperties?.text, 4000)}`,
    g ? `\n## Ember implementation notes\n${g.ember.map((x) => `- ${x}`).join('\n')}` : null,
    includeExamples && examples.length ? `\n## APG examples\n${examples.map((e) => `- **${e.id}** — ${e.title} (${e.url})`).join('\n')}\n\nUse \`get_apg_example\` for the keyboard/attribute tables of an example, or \`generate_ember_a11y_tests\` to scaffold tests.` : null,
    hdsSection(p.id),
    `\n_Source: W3C WAI-ARIA Authoring Practices Guide. APG examples are not production-ready code; test with assistive technologies._`,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

export function getApgExample({ example }) {
  const e = apg().examples.find((x) => x.id === example) ?? apg().examples.find((x) => x.id.includes(example));
  if (!e) return `Unknown example \`${example}\`. Use get_apg_pattern to list a pattern's examples.`;
  const kb = e.keyboard.map((k) => `| ${k.group ?? ''} | ${k.keys.join(' / ')} | ${k.behavior.join(' ').replace(/\|/g, '\\|')} |`);
  const at = e.attributes.map((a) => `| ${a.group ?? ''} | ${a.role ?? ''} | ${a.attribute ?? ''} | ${a.element ?? ''} | ${(a.usage ?? '').replace(/\|/g, '\\|')} |`);
  return [
    `# ${e.title}`,
    e.url,
    '',
    trim(e.about, 1500),
    e.accessibilityFeatures ? `\n## Accessibility features\n${trim(e.accessibilityFeatures, 2500)}` : null,
    kb.length ? `\n## Keyboard support\n| Group | Key | Behavior |\n|---|---|---|\n${kb.join('\n')}` : null,
    at.length ? `\n## Roles, states and properties\n| Group | Role | Attribute | Element | Usage |\n|---|---|---|---|---|\n${at.join('\n')}` : null,
    e.regressionTest ? `\nAPG regression tests: \`${e.regressionTest.file}\` (${e.regressionTest.testNames.length} tests).` : null,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Ember reference implementations (HashiCorp Helios Design System)

const RATING = { conformant: 'Conformant', 'conditionally-conformant': 'Conditionally conformant', 'not-conformant': 'Not conformant', 'non-conformant': 'Not conformant' };
const hdsAttribution = () => `_Ember code from the HashiCorp Helios Design System (MPL-2.0), commit ${hds().source.commit.slice(0, 7)}. Each excerpt links to its source file._`;
const fence = (path, src) => `\`\`\`${path?.endsWith('.hbs') ? 'hbs' : path?.split('.').pop() ?? 'gts'}\n${src}\n\`\`\``;

function conformanceLine(a) {
  if (!a?.conformance?.length) return null;
  return a.conformance.map((c) => `${c.subject ? `${c.subject}: ` : ''}**${RATING[c.rating] ?? c.rating}**${c.note ? ` (${c.note})` : ''}`).join('; ');
}

function hdsDocsForPattern(patternId) {
  const ids = hds().apgIndex[patternId] ?? [];
  const primary = (id) => {
    const name = id.split('/').pop();
    return name === patternId ? 0 : patternId.split('-').includes(name) || name.split('-').includes(patternId) ? 1 : 2;
  };
  return [...ids].sort((a, b) => primary(a) - primary(b)).map((id) => hds().docs.find((d) => d.id === id)).filter(Boolean);
}

function hdsSection(patternId) {
  if (!hasData('hds')) return null;
  const docs = hdsDocsForPattern(patternId);
  if (!docs.length) return null;
  return [
    '\n## Ember reference implementations (HDS)',
    ...docs.map((d) => `- **${d.title}** (\`${d.id}\`) — ${d.url}${conformanceLine(d.accessibility) ? `\n  - Conformance: ${conformanceLine(d.accessibility)}` : ''}${d.implementation ? `\n  - Source: ${d.implementation.url}` : ''}`),
    `\nUse \`get_ember_example\` with \`component\` set to one of these to see usage snippets, keyboard support, or the implementation source.`,
  ].join('\n');
}

function findHdsDoc(q) {
  const s = q.trim().toLowerCase().replace(/^hds[:\s-]*/, '');
  const docs = hds().docs;
  return docs.find((d) => d.id === s) ?? docs.find((d) => d.id.endsWith(`/${s}`)) ?? docs.find((d) => d.title.toLowerCase() === s) ?? docs.find((d) => d.id.includes(s) || d.title.toLowerCase().includes(s)) ?? null;
}

export function getEmberExample({ component, pattern, kind = 'usage', file, maxChars = 12000 }) {
  if (!hasData('hds')) return 'HDS data is not built. Run `pnpm build:data --only hds` with the design-system repo cloned next to this project.';
  let alsoSee = [];
  if (!component && pattern) {
    const p = findPattern(pattern);
    const ids = hdsDocsForPattern(p?.id ?? pattern).map((d) => d.id);
    if (!ids.length) return `No HDS component is mapped to APG pattern \`${pattern}\`. Mapped patterns: ${Object.keys(hds().apgIndex).join(', ')}`;
    component = ids[0];
    alsoSee = ids.slice(1);
  }
  if (!component) {
    const bySection = Object.groupBy(hds().docs, (d) => d.section);
    return [
      '# Ember reference implementations (HashiCorp Helios Design System)',
      ...Object.entries(bySection).map(([sec, ds]) => `\n## ${sec}\n${ds.map((d) => `- \`${d.id}\` — ${d.title}${d.apgPatterns.length ? ` _(APG: ${d.apgPatterns.join(', ')})_` : ''}${conformanceLine(d.accessibility) ? ` — ${conformanceLine(d.accessibility)}` : ''}`).join('\n')}`),
      '',
      hdsAttribution(),
    ].join('\n');
  }
  const d = findHdsDoc(component);
  if (!d) return `Unknown HDS component \`${component}\`. Call get_ember_example with no arguments to list them.`;
  const out = [`# ${d.title} — HDS (${d.id})`, d.url, '', d.description ?? ''];
  if (d.apgPatterns.length) out.push(`\nAPG patterns: ${d.apgPatterns.map((p) => `\`${p}\``).join(', ')} (see \`get_apg_pattern\`).`);
  if (alsoSee.length) out.push(`Other HDS components for this pattern: ${alsoSee.map((x) => `\`${x}\``).join(', ')}.`);
  let budget = maxChars;
  const take = (title, path, url, src) => {
    if (!src || budget <= 0) return;
    const body = src.length > budget ? `${src.slice(0, budget)}\n// … truncated` : src;
    budget -= body.length;
    out.push(`\n### ${title}\n${url}\n${fence(path, body)}`);
  };

  if (kind === 'accessibility') {
    const a = d.accessibility;
    if (!a) out.push('\n_This doc has no accessibility section._');
    else {
      if (conformanceLine(a)) out.push(`\n## Conformance\n${conformanceLine(a)}`);
      if (a.keyboard?.length) out.push(`\n## Keyboard support\n| Keys | Action | Note |\n|---|---|---|\n${a.keyboard.map((k) => `| ${k.group ? `${k.group}: ` : ''}${k.keys.join(' / ')} | ${k.description} | ${(k.note ?? '').replace(/\|/g, '\\|')} |`).join('\n')}`);
      if (a.knownIssues) out.push(`\n## Known issues\n${a.knownIssues}`);
      if (a.wcag?.length) out.push(`\n## Applicable WCAG success criteria\n${a.wcag.join(', ')} (see \`get_wcag_criterion\`)`);
      out.push(`\n## Notes\n${trim(a.text, 6000)}`);
      for (const s of a.snippets ?? []) take(s.name, s.path, s.url, s.code);
    }
  } else if (kind === 'implementation') {
    const impl = d.implementation;
    if (!impl) out.push('\n_No implementation source is mapped for this doc._');
    else {
      out.push(`\n## Implementation source\n${impl.url}\n\nFiles: ${impl.files.map((f) => `\`${f.path.split('/hds/')[1] ?? f.path}\``).join(', ')}`);
      const files = file ? impl.files.filter((f) => f.path.endsWith(file) || f.path.includes(file)) : impl.files;
      if (file && !files.length) out.push(`\n_No file matching \`${file}\`._`);
      for (const f of files) {
        if (!f.code) out.push(`\n- \`${f.path}\` not inlined (size cap) — ${f.url}`);
        else take(f.path.split('/hds/')[1] ?? f.path, f.path, f.url, f.code);
      }
    }
  } else {
    const snippets = file ? d.snippets.filter((s) => s.name.includes(file)) : d.snippets;
    if (!snippets.length) out.push('\n_No usage snippets._');
    for (const s of snippets) take(s.name, s.path, s.url, s.code);
  }
  if (budget <= 0) out.push(`\n_Output truncated at ${maxChars} characters; pass \`file\` to select a specific snippet or source file._`);
  out.push('', 'Run `audit_ember_template` on code you adapt from these examples, and still test with a keyboard and a screen reader.', hdsAttribution());
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// WCAG 2.2

const LEVEL_RANK = { A: 1, AA: 2, AAA: 3 };

function lintRulesBySc() {
  const map = {};
  for (const r of rules) for (const w of r.wcag) {
    const num = w.match(/\d+\.\d+\.\d+/)?.[0];
    if (num) (map[num] ??= []).push(r.id);
  }
  return map;
}

function findSc(q) {
  const s = String(q).trim().toLowerCase().replace(/^(wcag|sc)\s*/, '');
  const scs = wcag().successCriteria;
  const fuzzy = scs
    .filter((c) => c.title.toLowerCase().includes(s) || c.id.includes(s.replace(/\s+/g, '-')))
    .sort((a, b) => (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9));
  return scs.find((c) => c.num === s) ?? scs.find((c) => c.id === s) ?? scs.find((c) => c.title.toLowerCase() === s) ?? fuzzy[0] ?? null;
}

const BRIEF_LABELS = { goal: 'Goal', whatToDo: 'What to do', whyImportant: 'Why it is important' };
function briefText(b) {
  if (!b) return '';
  if (typeof b === 'string') return b;
  return Object.entries(b).map(([k, v]) => `- **${BRIEF_LABELS[k] ?? k}:** ${v}`).join('\n');
}
const scText = (c) => c.text.replace(/^New\s+/, '');

const techLabel = (t) => {
  const def = t.id ? wcag().techniques[t.id] : null;
  const title = t.title ?? def?.title ?? '';
  return `${t.id ? `**${t.id}**${def ? ` [${def.technology}]` : ''} ` : ''}${title}${t.using?.length ? ` — using: ${t.using.map((u) => (typeof u === 'string' ? u : (u.id ?? u.title))).join(', ')}` : ''}`;
};

function techniqueList(group, relevantOnly) {
  const keep = (t) => !relevantOnly || !t.id || !wcag().techniques[t.id]?.obsolete;
  if (!group?.length) return null;
  return group
    .map((g) => {
      if (g.techniques) return `${g.situation ? `- _${g.situation}_\n` : ''}${g.techniques.filter(keep).map((t) => `  - ${techLabel(t)}`).join('\n')}`;
      return keep(g) ? `- ${techLabel(g)}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

export function getWcagCriterion({ criterion, includeTechniques = true }) {
  if (!hasData('wcag')) return 'WCAG data is not built. Run `pnpm build:data --only wcag`.';
  const c = findSc(criterion);
  if (!c) return `Unknown success criterion \`${criterion}\`. Use list_wcag_criteria to browse them.`;
  const lint = lintRulesBySc()[c.num];
  const e = wcagEmber[c.num];
  const u = c.understanding ?? {};
  const act = (c.actRules ?? []).map((id) => wcag().actRules.find((r) => r.id === id)).filter(Boolean);
  const hdsDocs = hasData('hds') ? hds().docs.filter((d) => d.accessibility?.wcag?.includes(c.num)) : [];
  return [
    `# ${c.num} ${c.title} (Level ${c.level ?? c.formerLevel ?? '—'})${c.obsolete ? ' — OBSOLETE: removed in WCAG 2.2' : ''}`,
    `${c.url} · Understanding: ${u.url ?? '—'} · Added in WCAG ${c.version}`,
    '',
    `## Success criterion\n${scText(c)}`,
    u.brief ? `\n## In brief\n${briefText(u.brief)}` : null,
    u.intent ? `\n## Intent\n${trim(u.intent, 2500)}` : null,
    u.benefits?.length ? `\n## Benefits\n${u.benefits.slice(0, 6).map((b) => `- ${b}`).join('\n')}` : null,
    e ? `\n## In Ember apps\n${e.ember}` : null,
    `\n## How to verify\n- ember-a11y-lint rules: ${lint ? code(lint) : '_none (not detectable from templates)_'}\n- axe-core via ember-a11y-testing: ${e?.axe ? 'partial automated checks' : 'no automated check'}${act.length ? `\n- W3C ACT rules: ${act.map((r) => `[${r.name}](${r.url})`).join('; ')}` : ''}\n- Manual: ${e?.manual ?? 'review against the success criterion text.'}`,
    includeTechniques && c.techniques?.sufficient?.length ? `\n## Sufficient techniques\n${trim(techniqueList(c.techniques.sufficient, true), 3500)}` : null,
    includeTechniques && c.techniques?.failure?.length ? `\n## Common failures\n${techniqueList(c.techniques.failure, true)}` : null,
    includeTechniques && c.techniques?.advisory?.length ? `\n## Advisory techniques\n${trim(techniqueList(c.techniques.advisory, true), 1500)}` : null,
    hdsDocs.length ? `\n## HDS components that target this criterion\n${hdsDocs.map((d) => `\`${d.id}\``).join(', ')} (see \`get_ember_example\`)` : null,
    '\nUse `get_wcag_technique` for a technique\'s description, examples and test procedure.',
    '_Source: W3C WCAG 2.2 and Understanding WCAG 2.2 (W3C Software and Document License)._',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

export function listWcagCriteria({ level = 'AA', version, principle } = {}) {
  if (!hasData('wcag')) return 'WCAG data is not built. Run `pnpm build:data --only wcag`.';
  const max = LEVEL_RANK[level] ?? 2;
  const lint = lintRulesBySc();
  const scs = wcag().successCriteria.filter((c) => !c.obsolete && LEVEL_RANK[c.level] <= max && (!version || c.version === version) && (!principle || c.principle === String(principle)));
  const rows = scs.map((c) => `| ${c.num} | ${c.title} | ${c.level} | ${c.version} | ${lint[c.num] ? '✔' : ''} | ${wcagEmber[c.num]?.axe ? '✔' : ''} |`);
  const covered = scs.filter((c) => lint[c.num] || wcagEmber[c.num]?.axe).length;
  return [
    `# WCAG 2.2 success criteria (Level ${level === 'AAA' ? 'A–AAA' : level === 'A' ? 'A' : 'A and AA'}${version ? `, added in ${version}` : ''})`,
    `${scs.length} criteria. ${covered} have some automated coverage; **every criterion needs manual review** — automated tools find only a subset of issues.`,
    '',
    '| SC | Title | Level | Since | ember-a11y-lint | axe |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    'Use `get_wcag_criterion` for the full text, Ember guidance, techniques and test steps.',
  ].join('\n');
}

export function getWcagTechnique({ technique }) {
  if (!hasData('wcag')) return 'WCAG data is not built. Run `pnpm build:data --only wcag`.';
  const id = technique.trim().toUpperCase();
  const t = wcag().techniques[id];
  if (!t) return `Unknown or out-of-scope technique \`${technique}\` (only web technologies — ARIA, HTML, CSS, scripting, general and failures — are included).`;
  return [
    `# ${t.id}: ${t.title}${t.obsolete ? ' (obsolete)' : ''}`,
    `${t.url} · Technology: ${t.technology}${t.successCriteria?.length ? ` · Related SC: ${t.successCriteria.join(', ')}` : ''}`,
    t.description ? `\n## Description\n${trim(t.description, 3000)}` : null,
    t.examples?.length ? `\n## Examples\n${t.examples.slice(0, 4).map((e) => `### ${e.title ?? 'Example'}\n${trim(e.text, 800)}${(e.code ?? []).slice(0, 2).map((c) => `\n\`\`\`html\n${trim(c, 1500)}\n\`\`\``).join('')}`).join('\n\n')}` : null,
    t.tests ? `\n## Test procedure\n${trim(typeof t.tests === 'string' ? t.tests : JSON.stringify(t.tests), 2000)}` : null,
    '\n_Techniques are informative: using them is one way to meet a criterion, not the only way. In Ember, the same markup applies inside templates._',
  ]
    .filter((x) => x !== null)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Search

let index;
function buildIndex() {
  const docs = [];
  for (const r of Object.values(aria().roles)) docs.push({ kind: 'role', id: r.name, title: `role="${r.name}"`, text: r.description, tool: 'get_aria_role' });
  for (const a of Object.values(aria().attributes)) docs.push({ kind: 'attribute', id: a.name, title: a.name, text: a.description, tool: 'get_aria_attribute' });
  for (const e of htmlAria().elements) docs.push({ kind: 'html', id: e.element, title: `<${e.element}> (ARIA in HTML)`, text: `${e.implicitRole ?? ''} ${(e.notes ?? []).join(' ')}`, tool: 'get_html_element_rules' });
  for (const p of apg().patterns) docs.push({ kind: 'pattern', id: p.id, title: `${p.title} (APG pattern)`, text: `${p.about} ${p.keyboardInteraction?.text ?? ''} ${patternGuidance[p.id]?.ember.join(' ') ?? ''}`, tool: 'get_apg_pattern' });
  for (const p of apg().practices)
    for (const s of p.sections) docs.push({ kind: 'practice', id: p.id, title: `${p.title} › ${s.heading}`, text: s.text, tool: 'get_apg_pattern' });
  for (const g of emberGeneral) docs.push({ kind: 'ember', id: g.topic, title: `Ember: ${g.topic}`, text: g.text });
  for (const r of rules) docs.push({ kind: 'lint-rule', id: r.id, title: `Lint rule ${r.id}`, text: r.description });
  if (hasData('wcag')) {
    for (const c of wcag().successCriteria)
      if (!c.obsolete) docs.push({ kind: 'wcag', id: c.num, title: `WCAG ${c.num} ${c.title} (${c.level})`, text: `${scText(c)} ${briefText(c.understanding?.brief)} ${c.understanding?.intent ?? ''} ${wcagEmber[c.num]?.ember ?? ''}`, tool: 'get_wcag_criterion' });
    for (const t of Object.values(wcag().techniques))
      if (!t.obsolete) docs.push({ kind: 'wcag-technique', id: t.id, title: `${t.id}: ${t.title}`, text: t.description, tool: 'get_wcag_technique' });
  }
  if (hasData('hds'))
    for (const d of hds().docs)
      docs.push({ kind: 'ember-example', id: d.id, title: `HDS ${d.title} (Ember reference)`, text: `${d.description ?? ''} ${(d.keywords ?? []).join(' ')} ${d.apgPatterns.join(' ')} ${d.accessibility?.text ?? ''}`, tool: 'get_ember_example' });
  return docs.map((d) => ({ ...d, titleLc: d.title.toLowerCase(), textLc: (d.text ?? '').toLowerCase() }));
}

export function searchGuidance({ query, limit = 10 }) {
  index ??= buildIndex();
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
  if (!terms.length) return 'Empty query.';
  const scored = index
    .map((d) => {
      let score = 0;
      for (const t of terms) {
        if (d.id.toLowerCase() === t) score += 10;
        if (d.titleLc.includes(t)) score += 4;
        const m = d.textLc.split(t).length - 1;
        score += Math.min(m, 5);
      }
      if (terms.every((t) => d.titleLc.includes(t) || d.textLc.includes(t))) score *= 2;
      if (d.kind === 'ember' || d.kind === 'pattern' || d.kind === 'ember-example' || d.kind === 'wcag') score *= 1.2;
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!scored.length) return `No results for "${query}".`;
  return scored
    .map(({ d }) => {
      const pos = terms.map((t) => d.textLc.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, pos - 80);
      const excerpt = (d.text ?? '').slice(start, start + 240).replace(/\s+/g, ' ');
      return `- **${d.title}** [${d.kind}]${d.tool ? ` → \`${d.tool}("${d.id}")\`` : ''}\n  ${start > 0 ? '…' : ''}${excerpt}${excerpt.length >= 240 ? '…' : ''}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Audit

export function auditRoot() {
  return resolve(process.env.EMBER_A11Y_ROOT ?? process.cwd());
}

export function auditProjectSetup({ path } = {}) {
  return runSetupAudit({ root: auditRoot(), path });
}

export function getRelatedFiles({ path, depth = 1 } = {}) {
  const result = relatedFiles({ root: auditRoot(), path, depth: Math.min(Math.max(Math.trunc(depth) || 1, 1), 3) });
  return { text: formatRelatedFiles(result), ...result };
}

export function listA11yTodos({ path = '.', rule, file, status } = {}) {
  const guard = rootGuard(auditRoot());
  const abs = resolve(guard.root, path);
  const dir = guard.inside(abs) ? guard.real(abs) : null;
  if (!dir) throw new Error(`Path must be inside ${guard.root} (set EMBER_A11Y_ROOT to change).`);
  const lt = readA11yTodos(dir, guard);
  if (!lt) return { text: `No .lint-todo file found at or above ${relative(guard.root, dir) || '.'}, so no a11y violations are deferred as todos.`, todos: [], summary: summarizeTodos([]) };
  if (lt.legacy) return { text: `${lt.file} uses the legacy directory format. Upgrade ember-template-lint and run it once to migrate it.`, todos: [], summary: summarizeTodos([]) };
  const norm = (r) => r.replace(/^ember\/template-/, '');
  const todos = lt.todos.filter((t) =>
    (!rule || t.rule === norm(rule)) &&
    (!file || t.file === file || t.file.startsWith(file.replace(/\/?$/, '/')) || t.file.endsWith(`/${file}`)) &&
    (!status || (status === 'no-due-date' ? !t.warnDate && !t.errorDate : status === 'past-due' ? t.status !== 'todo' : t.status === status)));
  const summary = summarizeTodos(todos);
  const byFile = Map.groupBy(todos, (t) => t.file);
  const text = [
    `# Deferred a11y lint todos (${lt.file})`,
    '_Violations of a11y rules that were converted to todos (`--update-todo`). They are hidden from lint output until their warn/error dates. Fix the markup, then run `ember-template-lint <file> --clean-todo` (or eslint with the todo formatter) to remove the todo._',
    '',
    `**${summary.total} todo(s) in ${summary.files} file(s): ${summary.byStatus.todo} hidden, ${summary.byStatus.warn} past warn date, ${summary.byStatus.error} past error date, ${summary.noDueDate} with no due date.**`,
    ...(summary.total ? ['', '| Rule | Todos |', '|---|---|', ...Object.entries(summary.byRule).sort((a, b) => b[1] - a[1]).map(([r, n]) => `| \`${r}\` | ${n} |`)] : []),
    ...[...byFile].slice(0, 100).flatMap(([f, ts]) => ['', `### ${f}`, ...ts.map((t) => `- line ${t.line}:${t.column} \`${t.ruleId}\` — ${t.status === 'todo' ? 'hidden' : `reported as ${t.status}`}${t.errorDate ? `, due ${t.errorDate}` : t.warnDate ? `, warns ${t.warnDate}` : ', no due date'} ([docs](${t.docs}))`)]),
    byFile.size > 100 ? `\n…and ${byFile.size - 100} more file(s). Narrow with \`rule\` or \`file\`.` : '',
    summary.total ? '\nWhen fixing one, call audit_ember_template on the file and get_wcag_criterion for the related criterion.' : '',
  ].join('\n');
  return { text, todos, summary };
}

function fixBlock(fix) {
  if (!fix) return '';
  const lines = [...fix.before.split('\n').map((l) => `- ${l}`), ...fix.after.split('\n').map((l) => `+ ${l}`)];
  return `\n  - Suggested change:\n${['  ```diff', ...lines.map((l) => `  ${l}`), '  ```'].join('\n')}${fix.note ? `\n    ${fix.note}` : ''}`;
}

function formatFindings(file, findings) {
  if (!findings.length) return `### ${file}\n✔ No issues found.`;
  return [
    `### ${file}`,
    ...findings.map(
      (f) =>
        `- **${f.severity.toUpperCase()}** \`${f.ruleId}\` (line ${f.line}:${f.column}) — ${f.message}\n  - Element: \`${f.snippet ?? ''}\`${f.help ? `\n  - Fix: ${f.help}` : ''}${fixBlock(f.fix)}${f.wcag?.length ? `\n  - ${f.wcag.join('; ')}` : ''}${f.references?.length ? `\n  - Ref: ${f.references.join(' ')}` : ''}`,
    ),
  ].join('\n');
}

export function auditEmberTemplate({ source, path, filename, minSeverity = 'info', maxFiles = 200 }) {
  const header = '_Automated checks against WAI-ARIA 1.2 and ARIA in HTML. They catch only part of WCAG 2.2 issues — also test with a keyboard and a screen reader._\n';
  if (source) {
    const findings = lintTemplate(source, { filename: filename ?? 'template.hbs', minSeverity });
    return { text: header + formatSummary([{ file: filename ?? 'template', findings }]) + '\n\n' + formatFindings(filename ?? 'template', findings), findings };
  }
  if (!path) throw new Error('Provide either "source" or "path".');
  // Compare real paths so symlinks can't reach files outside the root.
  const root = realpathSync(auditRoot());
  const inside = (p) => p === root || p.startsWith(root + sep);
  const outsideError = () => new Error(`Path must be inside ${root} (set EMBER_A11Y_ROOT to change).`);
  if (!inside(resolve(root, path))) throw outsideError();
  const abs = realpathSync(resolve(root, path));
  if (!inside(abs)) throw outsideError();
  const files = collectFiles([abs], root).filter((f) => inside(realpathSync(f)));
  const truncated = files.length > maxFiles;
  const audited = files.slice(0, maxFiles);
  const results = audited.map((f) => ({ file: relative(root, f), findings: lintTemplate(readFileSync(f, 'utf8'), { filename: f, minSeverity }) }));
  const withIssues = results.filter((r) => r.findings.length);
  const todos = a11yTodosForFiles(audited, rootGuard(root));
  const todoCount = [...todos.values()].reduce((n, t) => n + t.length, 0);
  const todoNote = todoCount
    ? [
      '',
      `### Deferred a11y lint todos (${todoCount} in ${todos.size} file(s))`,
      '_These ember-template-lint/eslint violations are hidden from lint output by .lint-todo. Fix them while you are in these files._',
      ...[...todos.values()].flat().slice(0, 50).map((t) => `- ${formatTodo(t)}`),
    ]
    : [];
  return {
    text: [header, formatSummary(results), truncated ? `\n⚠ Only the first ${maxFiles} of ${files.length} files were audited.` : '', '', ...withIssues.map((r) => formatFindings(r.file, r.findings)), ...todoNote].join('\n'),
    findings: results.flatMap((r) => r.findings.map((f) => ({ file: r.file, ...f }))),
    todos: [...todos.values()].flat(),
  };
}

function formatSummary(results) {
  const c = { error: 0, warning: 0, info: 0 };
  results.forEach((r) => r.findings.forEach((f) => c[f.severity]++));
  return `**${results.length} file(s): ${c.error} errors, ${c.warning} warnings, ${c.info} info.**`;
}

// ---------------------------------------------------------------------------
// Test generation

const KEY_MAP = {
  space: ' ', enter: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab', home: 'Home', end: 'End', delete: 'Delete', backspace: 'Backspace',
  'left arrow': 'ArrowLeft', 'right arrow': 'ArrowRight', 'up arrow': 'ArrowUp', 'down arrow': 'ArrowDown',
  'page up': 'PageUp', 'page down': 'PageDown', f10: 'F10', f6: 'F6',
};

export function toKeyEvent(label) {
  const parts = label.split('+').map((p) => p.trim().toLowerCase());
  const mods = {};
  let key = null;
  for (const p of parts) {
    if (p === 'shift') mods.shiftKey = true;
    else if (p === 'alt' || p === 'option') mods.altKey = true;
    else if (p === 'control' || p === 'ctrl') mods.ctrlKey = true;
    else if (p === 'meta' || p === 'command' || p === 'cmd') mods.metaKey = true;
    // @ember/test-helpers' triggerKeyEvent only accepts keys that start with an uppercase character.
    else key = KEY_MAP[p] ?? (/^[a-z0-9*]$/.test(p) ? p.toUpperCase() : null);
  }
  return key ? { key, mods } : null;
}

const pascal = (s) => s.replace(/(^|[-_\s])(\w)/g, (_, __, c) => c.toUpperCase());

// Runtime helpers embedded in every generated test. They accept each conformant variant: native elements
// or explicit roles, ARIA states or their native equivalents, and every accessible-name source.
export const GENERATED_HELPERS = String.raw`const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const byRole = (root, role) => [root, ...root.querySelectorAll('*')].filter((el) => el.matches(ROLE_SELECTORS[role]));

// Approximates the accessible name computation: aria-labelledby, aria-label, <label>, alt,
// legend/caption/figcaption, button value, contents (for roles named from contents), then title and placeholder.
function accessibleName(el, role) {
  const ids = el.getAttribute('aria-labelledby');
  const byIds = ids ? ids.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim() : '';
  if (byIds) return byIds;
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const labels = [...(el.labels ?? [])].map(text).join(' ').trim();
  if (labels) return labels;
  if (el.matches('img, area, input[type="image" i]') && el.getAttribute('alt')?.trim()) return el.getAttribute('alt').trim();
  if (el.matches('input[type="button" i], input[type="submit" i], input[type="reset" i]')) return el.value || ({ submit: 'Submit', reset: 'Reset' }[el.type] ?? '');
  const caption = el.querySelector(':scope > legend, :scope > caption, :scope > figcaption');
  if (el.matches('fieldset, table, figure') && text(caption)) return text(caption);
  if (NAME_FROM_CONTENTS.has(role) && text(el)) return text(el);
  return el.getAttribute('title')?.trim() || (el.matches('input, textarea') && el.getAttribute('placeholder')?.trim()) || '';
}

// Current value of an ARIA state, read from the native equivalent where HTML provides one.
function stateOf(el, attr) {
  const native = {
    'aria-checked': () => el.matches('input[type="checkbox" i], input[type="radio" i]') && (el.indeterminate ? 'mixed' : String(el.checked)),
    'aria-expanded': () => (el.matches('details > summary') ? String(el.parentElement.open) : el.matches('select, input[list]') && 'false'),
    'aria-selected': () => el.matches('option') && String(el.selected),
    'aria-disabled': () => el.matches(':disabled') && 'true',
    'aria-modal': () => el.matches('dialog:modal') && 'true',
    'aria-valuenow': () => el.matches('input, meter, progress') && el.value !== '' && String(el.value),
    'aria-level': () => el.matches('h1, h2, h3, h4, h5, h6') && el.tagName.slice(1),
  }[attr]?.();
  return native || (el.hasAttribute(attr) ? el.getAttribute(attr).trim() : null);
}

const isValid = (value, allowed) => (allowed === 'number' ? value !== null && Number.isFinite(Number(value)) : allowed.includes(value));`;

export function generateEmberA11yTests({ pattern, example, componentName, importPath, namedExport = false, invocation, selector, setupImport = 'ember-qunit' }) {
  const ex = example ? apg().examples.find((e) => e.id === example) : null;
  const p = findPattern(pattern ?? ex?.patternId ?? '');
  if (!p && !ex) return `Unknown pattern/example. Available patterns: ${apg().patterns.map((x) => x.id).join(', ')}`;
  const patternId = p?.id ?? ex.patternId;
  const spec = apgTestSpec[patternId] ?? { required: [], conditional: [] };
  const name = componentName ?? pascal(patternId);
  const root = selector ?? `[data-test-${patternId.replace(/[^a-z0-9-]/g, '')}]`;
  const body = invocation?.trim() || `<${name} />`;
  const usesComponent = new RegExp(`<${name}[\\s/>]`).test(body);
  const modulePath = importPath ?? `my-app/components/${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
  // Named exports: import every top-level component the invocation uses (e.g. HdsBreadcrumb + HdsBreadcrumbItem).
  const namedImports = [...new Set([...body.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]))];
  const importLine = !usesComponent && !(namedExport && namedImports.length) ? ''
    : `import ${namedExport ? `{ ${namedImports.join(', ')} }` : name} from '${modulePath}';${importPath ? '' : ' // TODO: adjust path'}\n`;
  const renderLine = body.includes('\n') ? `await render(<template>\n${body.split('\n').map((l) => `      ${l}`).join('\n')}\n    </template>);` : `await render(<template>${body}</template>);`;

  const roles = specRoles(spec);
  const states = spec.states ?? [];
  const optionalStates = spec.optionalStates ?? [];
  for (const s of [...states, ...optionalStates]) if (!roles.includes(s.role)) roles.push(s.role);
  const roleData = Object.fromEntries(roles.map((r) => [r, getRole(r)]));
  const named = roles.filter((r) => roleData[r]?.nameRequired);
  const fromContents = roles.filter((r) => roleData[r]?.nameFrom?.includes('contents'));
  const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const values = (v) => (v === 'number' ? "'number'" : `[${v.map(q).join(', ')}]`);

  const structure = [];
  for (const group of spec.required) {
    const label = group.length > 1 ? `one of ${group.join(', ')}` : group[0];
    structure.push(`    assert.ok(${JSON.stringify(group)}.some((role) => byRole(root, role).length), 'has ${label} (native element or explicit role)');`);
  }
  for (const s of states) {
    structure.push(`    for (const el of byRole(root, '${s.role}')) assert.ok(isValid(stateOf(el, '${s.attr}'), ${values(s.values)}), \`${s.role} has ${s.attr} (or its native equivalent): \${stateOf(el, '${s.attr}')}\`);`);
  }
  for (const s of optionalStates) {
    structure.push(`    // Optional (${s.why}): validated only when present.\n    for (const el of byRole(root, '${s.role}')) if (stateOf(el, '${s.attr}') !== null) assert.ok(isValid(stateOf(el, '${s.attr}'), ${values(s.values)}), '${s.role} ${s.attr} is valid');`);
  }
  if (spec.conditional.length) {
    structure.push(`    // Conditional per APG (${spec.conditional.join(', ')}): not required; when present, the name and state checks below still apply.`);
  }
  if (named.length) {
    structure.push(`    for (const role of ${JSON.stringify(named)}) {\n      for (const el of byRole(root, role)) assert.ok(accessibleName(el, role), \`\${role} <\${el.tagName.toLowerCase()}> has an accessible name\`);\n    }`);
  }
  const notes = (spec.notes ?? []).map((n) => `  // - ${n}`).join('\n');

  const covered = new Set([...states, ...optionalStates].map((s) => s.attr).concat(['aria-label', 'aria-labelledby']));
  const attrs = ex ? ex.attributes.filter((a) => a.attribute) : (p?.rolesStatesProperties?.attributes ?? []).map((attribute) => ({ attribute }));
  const attrHints = [...new Set(attrs.map((a) => a.attribute))]
    .filter((a) => /^aria-/.test(a) && !covered.has(a))
    .map((a) => {
      const usage = (attrs.find((x) => x.attribute === a)?.usage ?? '').replace(/\s+/g, ' ').slice(0, 140);
      return `    // assert.dom(SELECTOR).hasAttribute('${a}');${usage ? ` // ${usage}` : ''}`;
    });

  const keyRows = ex
    ? ex.keyboard.map((k) => ({ keys: k.keys, text: k.behavior.join(' '), group: k.group }))
    : (p?.keyboardInteraction?.keys ?? []).map((k) => ({ keys: k.keys, text: k.description.replace(/`/g, ''), optional: k.optional }));
  const keyTests = [];
  for (const row of keyRows) {
    for (const label of row.keys) {
      const ev = toKeyEvent(label);
      const desc = row.text.replace(/\s+/g, ' ').slice(0, 220).replace(/\*\//g, '');
      if (!ev || ev.key === 'Tab') {
        keyTests.push(`  // ${label}: ${desc}\n  // (Tab order can't be simulated by triggerKeyEvent; verify tabindex values or use a real-browser test.)`);
        continue;
      }
      const mods = Object.keys(ev.mods).length ? `, ${JSON.stringify(ev.mods)}` : '';
      keyTests.push(`  test('${label.replace(/'/g, "\\'")}${row.group ? ` (${row.group})` : ''}${row.optional ? ' [optional]' : ''}', async function (assert) {
    /* APG: ${desc} */
    ${renderLine}
    const target = find(ROOT); // TODO: the element that has focus for this key
    target.focus();
    await triggerKeyEvent(target, 'keydown', '${ev.key}'${mods});
    // TODO: assert the behavior described above, e.g.
    // assert.dom(EXPECTED_SELECTOR).isFocused();
    // assert.dom(EXPECTED_SELECTOR).hasAttribute('aria-selected', 'true');
    assert.ok(true);
  });`);
    }
  }

  const g = patternGuidance[patternId];
  const roleSelectors = roles.map((r) => `  ${/^[a-z]+$/.test(r) ? r : q(r)}: ${q(roleSelector(r))},`).join('\n');
  return `// tests/integration/components/${patternId}-a11y-test.gjs
// Generated from the W3C APG ${ex ? `example "${ex.title}" (${ex.url})` : `pattern "${p.title}" (${p.url})`}.
// Fill in the TODOs to match your component's DOM. Requires ember-qunit, @ember/test-helpers,
// qunit-dom and ember-a11y-testing.${g ? `\n// Native-first reminder: ${g.native}` : ''}
import { module, test } from 'qunit';
import { setupRenderingTest } from '${setupImport}';
import { render, find, triggerKeyEvent, click } from '@ember/test-helpers';
import { a11yAudit } from 'ember-a11y-testing/test-support';
${importLine}
const ROOT = ${q(root)};

// Each role matches an explicit role attribute or a native element with that implicit role (ARIA in HTML).
const ROLE_SELECTORS = {
${roleSelectors}
};
const NAME_FROM_CONTENTS = new Set(${JSON.stringify(fromContents)});
${GENERATED_HELPERS}

module('Integration | Component | ${name} | accessibility', function (hooks) {
  setupRenderingTest(hooks);

  test('passes axe-core audit', async function (assert) {
    ${renderLine}
    await a11yAudit();
    assert.ok(true, 'no axe violations');
  });

  // APG allows more than one conformant structure for this pattern; these checks accept each of them.
${notes}
  test('exposes APG roles, states and properties', async function (assert) {
    ${renderLine}
    const root = find(ROOT);
    assert.ok(root, \`renders \${ROOT}\`);
${structure.join('\n')}
${attrHints.join('\n')}
  });

  test('pointer and keyboard activation produce the same state', async function (assert) {
    ${renderLine}
    // TODO: await click(TRIGGER); capture state; reset; then use Enter/Space and compare.
    assert.ok(click);
  });

  // Keyboard interaction (APG)
${keyTests.join('\n\n')}
});
`;
}

export const toolHandlers = { getAriaRole, getAriaAttribute, getHtmlElementRules, listApgPatterns, getApgPattern, getApgExample, getEmberExample, getWcagCriterion, listWcagCriteria, getWcagTechnique, searchGuidance, auditEmberTemplate, generateEmberA11yTests };
