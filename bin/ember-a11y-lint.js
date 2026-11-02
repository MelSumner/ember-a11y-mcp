#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fixFiles, lintFiles, rules, summarize } from '../lib/lint/index.js';

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: 'string', short: 'f', default: 'stylish' },
      'min-severity': { type: 'string', default: 'warning' },
      rule: { type: 'string', multiple: true, default: [] },
      'max-warnings': { type: 'string' },
      fix: { type: 'boolean', default: false },
      'list-rules': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (e) {
  console.error(`${e.message}\nRun ember-a11y-lint --help for usage.`);
  process.exit(2);
}
const { values, positionals } = parsed;

if (values.help) {
  console.log(`Usage: ember-a11y-lint [paths...] [options]

Lints Ember templates (.hbs, .gjs, .gts) against WAI-ARIA 1.2 and ARIA in HTML.

Options:
  -f, --format <stylish|json>   Output format (default: stylish)
  --min-severity <level>        error | warning | info (default: warning)
  --rule <id=level>             Override a rule: off | error | warning | info (repeatable)
  --max-warnings <n>            Exit 1 if more than n warnings
  --fix                         Apply safe fixes (typos, redundant or deprecated attributes) in place, then report what is left
  --list-rules                  Print available rules
  -h, --help                    Show help

Inline disable: {{! ember-a11y-disable-next-line rule-id }}, or {{! ember-a11y-disable rule-id }} … {{! ember-a11y-enable rule-id }}.
Scoped like template-lint-disable; a disable without a matching enable is reported as unmatched-disable.`);
  process.exit(0);
}

if (values['list-rules']) {
  for (const r of rules) console.log(`${r.id.padEnd(30)} ${r.description}`);
  process.exit(0);
}

const ruleConfig = {};
for (const r of values.rule) {
  const [id, level] = r.split('=');
  if (!rules.some((x) => x.id === id) || !['off', 'error', 'warning', 'info'].includes(level)) {
    console.error(`Invalid --rule "${r}". Use <rule-id>=<off|error|warning|info>.`);
    process.exit(2);
  }
  ruleConfig[id] = level;
}

const fail = (message) => {
  console.error(message);
  process.exit(2);
};
if (!['stylish', 'json'].includes(values.format)) fail(`Invalid --format "${values.format}". Use stylish or json.`);
if (!['error', 'warning', 'info'].includes(values['min-severity'])) fail(`Invalid --min-severity "${values['min-severity']}". Use error, warning or info.`);
const maxWarnings = values['max-warnings'] === undefined ? Infinity : Number(values['max-warnings']);
if (maxWarnings !== Infinity && !(Number.isInteger(maxWarnings) && maxWarnings >= 0)) fail(`Invalid --max-warnings "${values['max-warnings']}". Use a whole number.`);

const paths = positionals.length ? positionals : ['app', 'addon', 'src'].filter(exists);
if (!paths.length) fail('Nothing to lint: no app, addon or src directory here. Pass the paths to lint.');

let results;
let fixed = [];
try {
  if (values.fix) fixed = fixFiles(paths, { rules: ruleConfig });
  results = lintFiles(paths, {
    rules: ruleConfig,
    minSeverity: values['min-severity'],
  });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

function exists(p) {
  try {
    return Boolean(process.getBuiltinModule('node:fs').statSync(p));
  } catch {
    return false;
  }
}

const counts = summarize(results);

if (fixed.skipped?.length) for (const f of fixed.skipped) console.error(`Skipped ${f.file}: ${f.reason}; left unchanged.`);

if (fixed.length && values.format !== 'json') {
  const total = fixed.reduce((n, f) => n + f.applied, 0);
  console.log(`Applied ${total} fix${total === 1 ? '' : 'es'} in ${fixed.length} file${fixed.length === 1 ? '' : 's'}:`);
  for (const f of fixed) console.log(`  ${f.file} (${f.applied})`);
}

if (values.format === 'json') {
  console.log(JSON.stringify({ results: results.filter((r) => r.findings.length), counts }, null, 2));
} else {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const sev = { error: c(31, 'error  '), warning: c(33, 'warning'), info: c(36, 'info   ') };
  for (const r of results) {
    if (!r.findings.length) continue;
    console.log(`\n${c(4, r.file)}`);
    for (const f of r.findings) {
      console.log(`  ${`${f.line}:${f.column}`.padEnd(8)} ${sev[f.severity]}  ${f.message}  ${c(2, f.ruleId)}`);
      if (f.help) console.log(`  ${''.padEnd(8)}          ${c(2, `↳ ${f.help}`)}`);
      if (f.fix) {
        const pad = `  ${''.padEnd(8)}          `;
        console.log(`${pad}${c(2, '- before:')} ${f.fix.before.replace(/\n/g, `\n${pad}          `)}`);
        console.log(`${pad}${c(2, '+ after: ')} ${f.fix.after.replace(/\n/g, `\n${pad}          `)}`);
        if (f.fix.note) console.log(`${pad}${c(2, `  ${f.fix.note}`)}`);
      }
    }
  }
  const total = counts.error + counts.warning + counts.info;
  console.log(total ? `\n✖ ${counts.error} errors, ${counts.warning} warnings, ${counts.info} info in ${results.length} files` : `✔ No accessibility issues found in ${results.length} files`);
}

// exitCode (not exit()) so piped output is fully flushed.
process.exitCode = counts.error > 0 || counts.warning > maxWarnings ? 1 : 0;
