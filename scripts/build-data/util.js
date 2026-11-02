import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function git(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Read a file either from a git ref (without touching the working tree) or from disk. */
export function readSource(repoDir, path, ref) {
  if (ref) return git(repoDir, ['show', `${ref}:${path}`]);
  return readFileSync(join(repoDir, path), 'utf8');
}

export function commitOf(repoDir, ref = 'HEAD') {
  return git(repoDir, ['rev-parse', ref]).trim();
}

/** File names directly inside `dir`, from a git ref or from disk; [] when the directory doesn't exist. */
export function listSource(repoDir, dir, ref) {
  if (!ref) return existsSync(join(repoDir, dir)) ? readdirSync(join(repoDir, dir)) : [];
  try {
    return git(repoDir, ['ls-tree', '--name-only', `${ref}:${dir}`]).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function originUrl(repoDir) {
  try {
    return git(repoDir, ['remote', 'get-url', 'origin']).trim();
  } catch {
    return null;
  }
}

export const collapse = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Convert an HTML fragment (cheerio selection) to compact markdown-ish text:
 * <code>/<rref>/<pref>/<sref> -> `x`, <kbd> -> `Key`, lists -> "- ", paragraphs separated by blank lines.
 */
export function toText($, el) {
  const out = [];
  const walk = (node, ctx) => {
    if (node.type === 'text') {
      out.push(node.data);
      return;
    }
    if (node.type !== 'tag') return;
    const tag = node.name;
    if (['script', 'style', 'pre'].includes(tag) && ctx.skipPre !== false) {
      if (tag === 'pre') out.push('\n\n```\n' + $(node).text().trim() + '\n```\n\n');
      return;
    }
    if (['code', 'rref', 'pref', 'sref', 'kbd'].includes(tag)) {
      out.push('`' + collapse($(node).text()) + '`');
      return;
    }
    if (tag === 'li') out.push('\n- ');
    if (['p', 'div', 'ul', 'ol', 'section', 'table', 'tr', 'h2', 'h3', 'h4', 'dl', 'dt', 'dd'].includes(tag)) out.push('\n');
    for (const child of node.children ?? []) walk(child, ctx);
    if (['p', 'ul', 'ol', 'div', 'section'].includes(tag)) out.push('\n');
  };
  $(el)
    .toArray()
    .forEach((n) => walk(n, {}));
  return out
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n- \n/g, '\n- ')
    .trim();
}
