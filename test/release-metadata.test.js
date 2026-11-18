import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const script = fileURLToPath(new URL('../scripts/is-release-metadata-only.js', import.meta.url));

test('skips only release-plan metadata changes, not mixed or other changes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-metadata-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const write = (file, content) => writeFileSync(join(cwd, file), content);
    const commit = () => {
      git('add', '.');
      git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
      return git('rev-parse', 'HEAD');
    };
    const classify = (base, head) => execFileSync(process.execPath, [script, base, head], { cwd, encoding: 'utf8' }).trim();

    git('init', '-q');
    write('package.json', '{"name":"example","version":"0.1.0"}');
    const base = commit();

    write('package.json', '{"name":"example","version":"0.1.1"}');
    const bump = commit();
    expect(classify(base, bump)).toBe('false');

    write('.release-plan.json', '{}');
    write('CHANGELOG.md', '# New release\n');
    const release = commit();
    expect(classify(base, release)).toBe('true');

    write('package.json', '{"name":"example","version":"0.1.1","dependencies":{"example-lib":"^1.0.0"}}');
    expect(classify(base, commit())).toBe('false');

    write('package.json', '{"name":"example","version":"0.1.1"}');
    write('index.js', 'export {};\n');
    expect(classify(base, commit())).toBe('false');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
