import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/ember-a11y-lint.js', import.meta.url));
let dir;
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ea11y-cli-'));
  mkdirSync(join(dir, 'app/components'), { recursive: true });
  mkdirSync(join(dir, 'clean'));
  mkdirSync(join(dir, 'warn'));
  writeFileSync(join(dir, 'app/components/bad.hbs'), '<div {{on "click" this.go}}>Go</div>\n<img src="x.png">\n');
  writeFileSync(join(dir, 'app/components/ok.gjs'), '<template><button type="button">Ok</button></template>\n');
  writeFileSync(join(dir, 'clean/ok.hbs'), '<button type="button">Ok</button>\n');
  writeFileSync(join(dir, 'warn/w.hbs'), '<div tabindex="0">x</div>\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('ember-a11y-lint CLI', () => {
  test('exits 1 with stylish output when errors are found, defaulting to app/', () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/app\/components\/bad\.hbs/);
    expect(r.stdout).toMatch(/1:1\s+error\s+.*keyboard-accessible-click/);
    expect(r.stdout).toMatch(/2 errors/);
    expect(r.stdout).not.toMatch(/ok\.gjs/);
  });

  test('exits 0 for clean files', () => {
    expect(run('clean').status).toBe(0);
  });

  test('json format', () => {
    const r = run('app', '--format', 'json');
    const out = JSON.parse(r.stdout);
    expect(out.counts.error).toBe(2);
    expect(out.results[0].findings[0]).toMatchObject({ ruleId: expect.any(String), line: expect.any(Number), column: expect.any(Number), wcag: expect.any(Array) });
  });

  test('rule overrides and min severity', () => {
    const r = run('app', '--rule', 'keyboard-accessible-click=off', '--rule', 'accessible-name=warning', '--format', 'json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).counts).toMatchObject({ error: 0, warning: 1 });
    expect(JSON.parse(run('warn', '--min-severity', 'error', '--format', 'json').stdout).counts.warning ?? 0).toBe(0);
  });

  test('--max-warnings', () => {
    expect(run('warn').status).toBe(0);
    expect(run('warn', '--max-warnings', '0').status).toBe(1);
  });

  test('invalid arguments exit 2', () => {
    expect(run('--rule', 'nope=off').status).toBe(2);
    expect(run('--rule', 'accessible-name=loud').status).toBe(2);
    expect(run('does-not-exist').status).toBe(2);
    for (const args of [['--max-warnings', 'abc'], ['--max-warnings', '-1'], ['--min-severity', 'bogus'], ['-f', 'xml'], ['--bogus-flag']]) {
      const r = run('clean', ...args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).not.toMatch(/at .*node:internal/);
    }
  });

  test('exits 2 when there is nothing to lint', () => {
    const r = spawnSync(process.execPath, [bin], { cwd: join(dir, 'clean'), encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Nothing to lint/);
  });

  test('large piped json output is not truncated', () => {
    mkdirSync(join(dir, 'big'));
    for (let i = 0; i < 300; i++) writeFileSync(join(dir, `big/f${i}.hbs`), '<img src="x.png">\n<div {{on "click" this.go}}>Go</div>\n');
    const r = run('big', '-f', 'json');
    expect(r.stdout.length).toBeGreaterThan(65536);
    expect(JSON.parse(r.stdout).counts.error).toBe(600);
  });

  test('--list-rules and --help', () => {
    expect(run('--list-rules').stdout).toMatch(/aria-required-owned/);
    expect(run('-h').stdout).toMatch(/Usage: ember-a11y-lint/);
  });
});
