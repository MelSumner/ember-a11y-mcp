#!/usr/bin/env node
// Clones the source repositories that data/*.json is built from, next to this package (or into --dir).
//
//   node scripts/clone-sources.js                 # the exact commits recorded in data/*.json (shallow)
//   node scripts/clone-sources.js --latest        # current upstream heads (used by the spec-drift workflow)
//   node scripts/clone-sources.js --only aria,wcag --dir /tmp/sources
//
// Existing clones are fetched and checked out in place.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const projectRoot = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: process.env.A11Y_SOURCES_DIR ?? resolve(projectRoot, '..') },
    latest: { type: 'boolean', default: false },
    only: { type: 'string' },
  },
});

const source = (name) => JSON.parse(readFileSync(join(projectRoot, 'data', `${name}.json`), 'utf8')).source;
const aria = source('aria');

// dir → { repo, head: commit (or branch with --latest), extra: refs the build reads besides HEAD }
const REPOS = {
  aria: {
    repo: aria.repo,
    head: values.latest ? 'main' : aria.editorsDraft.commit,
    extra: [
      // ARIA 1.2 Recommendation branch, the DPUB-ARIA 1.1 tag, and the pinned Graphics ARIA 1.0 commit (scripts/build-data/aria.js).
      [values.latest ? '2023-06_REC' : aria.commit, 'refs/remotes/origin/2023-06_REC'],
      ['refs/tags/REC-dpub-1.1', 'refs/tags/REC-dpub-1.1'],
      [aria.modules.graphics.commit, 'refs/remotes/origin/graphics-aria-rec'],
    ],
  },
  'html-aria': { repo: source('html-aria').repo, head: values.latest ? 'gh-pages' : source('html-aria').commit },
  'aria-practices': { repo: source('apg').repo, head: values.latest ? 'main' : source('apg').commit },
  wcag: {
    repo: source('wcag').repo,
    head: values.latest ? 'main' : source('wcag').commit,
    // WCAG 2.2 Recommendation tag that the normative text is read from (scripts/build-data/wcag.js).
    extra: [[`refs/tags/${source('wcag').ref}`, `refs/tags/${source('wcag').ref}`]],
  },
  'design-system': { repo: source('hds').repo, head: values.latest ? 'main' : source('hds').commit },
};

const only = values.only?.split(',').map((s) => s.trim());
// Auto gc/maintenance can run detached after a fetch and rewrite .git/shallow while the next fetch reads it
// ("fatal: shallow file has changed since we read it"), so it's disabled for these back-to-back fetches.
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();

mkdirSync(values.dir, { recursive: true });
for (const [dir, { repo, head, extra = [] }] of Object.entries(REPOS)) {
  if (only && !only.includes(dir)) continue;
  const path = join(values.dir, dir);
  if (!existsSync(join(path, '.git'))) {
    mkdirSync(path, { recursive: true });
    git(path, 'init', '--quiet');
    git(path, 'remote', 'add', 'origin', repo);
  }
  git(path, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', head);
  git(path, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
  for (const [from, to] of extra) git(path, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', `+${from}:${to}`);
  console.log(`${dir.padEnd(15)} ${git(path, 'rev-parse', '--short', 'HEAD')}  ${repo}`);
}
