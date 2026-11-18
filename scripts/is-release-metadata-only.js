import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const releaseFiles = new Set(['.release-plan.json', 'CHANGELOG.md', 'package.json']);

function isReleaseMetadataOnly(base, head) {
  const fields = git('diff', '--raw', '--no-renames', '-z', base, head, '--').split('\0');
  fields.pop();
  const paths = new Set();
  for (let i = 0; i < fields.length; i += 2) {
    const [, beforeMode, afterMode, status] = /^:(\d+) (\d+) \S+ \S+ ([AM])$/.exec(fields[i]) ?? [];
    const path = fields[i + 1];
    if (!status || !releaseFiles.has(path) || afterMode !== '100644' ||
        (status === 'M' && beforeMode !== afterMode)) return false;
    paths.add(path);
  }
  if (!paths.has('.release-plan.json')) return false;
  if (!paths.has('package.json')) return true;

  const { version: beforeVersion, ...before } = JSON.parse(git('show', `${base}:package.json`));
  const { version: afterVersion, ...after } = JSON.parse(git('show', `${head}:package.json`));
  return typeof beforeVersion === 'string' && typeof afterVersion === 'string' &&
    beforeVersion !== afterVersion && isDeepStrictEqual(before, after);
}

const [base, head] = process.argv.slice(2);
if (!base || !head) throw new Error('Provide Git revisions for both sides of the comparison.');
console.log(isReleaseMetadataOnly(base, head));
