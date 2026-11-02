import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { preprocess, traverse } from '@glimmer/syntax';
import { lintTemplate } from '../../lib/lint/index.js';

const pos = (p) => p.line * 1e6 + p.column;

// Extracts the <body> of a W3C aria/validator-tests file and checks each element
// marked class="fail" / class="pass" against the findings located inside it.
export function scoreValidatorFile(file) {
  const html = readFileSync(file, 'utf8')
    .replace(/^[\s\S]*?<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*$/, '')
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  let ast;
  try {
    ast = preprocess(html, { mode: 'codemod' });
  } catch (e) {
    return { file, parseError: e.message, fail: [], pass: [] };
  }
  const marked = [];
  traverse(ast, {
    ElementNode(node) {
      const cls = node.attributes.find((a) => a.name === 'class')?.value?.chars?.split(/\s+/) ?? [];
      const kind = cls.includes('fail') ? 'fail' : cls.includes('pass') ? 'pass' : null;
      if (kind) marked.push({ kind, node, start: pos({ line: node.loc.start.line, column: node.loc.start.column + 1 }), end: pos({ line: node.loc.end.line, column: node.loc.end.column + 1 }), findings: [] });
    },
  });
  const findings = lintTemplate(html, { filename: 'x.hbs', minSeverity: 'info' }).filter((f) => f.ruleId !== 'prefer-native-element' && f.ruleId !== 'prefer-unique-id');
  const idOf = (m) => m.node.attributes.find((a) => a.name === 'id')?.value?.chars;
  for (const f of findings) {
    const p = pos(f);
    const owner = marked.filter((m) => p >= m.start && p <= m.end).sort((a, b) => b.start - a.start)[0];
    owner?.findings.push(f);
    // Relationship findings (e.g. combobox → popup) are reported on the referencing element but name the target.
    for (const m of marked) if (m !== owner && idOf(m) && f.message.includes(`#${idOf(m)} `)) m.findings.push(f);
  }
  const label = (m) => {
    const id = idOf(m);
    return id ? `#${id}` : `${m.node.tag}@body:${m.node.loc.start.line}`;
  };
  return {
    file,
    fail: marked.filter((m) => m.kind === 'fail').map((m) => ({ label: label(m), detected: m.findings.length > 0 })),
    pass: marked.filter((m) => m.kind === 'pass').map((m) => ({ label: label(m), falsePositives: m.findings.filter((f) => f.severity === 'error').map((f) => f.ruleId) })),
  };
}

export function validatorFiles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.html')).sort().map((f) => join(dir, f));
}
