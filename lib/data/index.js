import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../data');
const cache = new Map();

function load(name) {
  if (!cache.has(name)) {
    const file = join(dataDir, `${name}.json`);
    if (!existsSync(file)) throw new Error(`Missing data file ${file}. Run "pnpm build:data".`);
    // Null-prototype objects, so lookups keyed by user or template input ("constructor", "__proto__") miss.
    const json = JSON.parse(readFileSync(file, 'utf8'), (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(Object.create(null), v) : v,
    );
    cache.set(name, json);
  }
  return cache.get(name);
}

export const aria = () => load('aria');
export const htmlAria = () => load('html-aria');
export const apg = () => load('apg');
export const hds = () => load('hds');
export const wcag = () => load('wcag');
export const hasData = (name) => cache.has(name) || existsSync(join(dataDir, `${name}.json`));

export const ARIA_SPEC_URL = 'https://www.w3.org/TR/wai-aria-1.2/';
export const HTML_ARIA_URL = 'https://www.w3.org/TR/html-aria/';

export function getRole(name) {
  return name ? (aria().roles[name.toLowerCase()] ?? null) : null;
}

export function getAttribute(name) {
  return name ? (aria().attributes[name.toLowerCase()] ?? null) : null;
}

export function isGlobalAttribute(name) {
  const a = getAttribute(name);
  return Boolean(a?.global && !a.globalDeprecated);
}

export function roleSupportsAttribute(roleName, attrName) {
  const role = getRole(roleName);
  if (!role) return null;
  return role.supportedAttributes.includes(attrName);
}

export function isNextAriaRole(name) {
  return aria().notInBaseline.roles.includes(name);
}

export function isNextAriaAttribute(name) {
  return aria().notInBaseline.attributes.includes(name);
}

/** Roles that are interactive (subclasses of widget), used for keyboard/focus rules. */
export function isWidgetRole(name) {
  const role = getRole(name);
  return Boolean(role && !role.abstract && (role.superclassChain ?? []).includes('widget'));
}

/** Levenshtein-based suggestion for typos like "aria-labeledby". */
export function suggest(name, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(name, c);
    if (d < bestScore) {
      best = c;
      bestScore = d;
    }
  }
  return bestScore <= Math.max(2, Math.floor(name.length / 4)) ? best : null;
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function htmlAriaRow(id) {
  return htmlAria().elements.find((e) => e.id === id) ?? null;
}

export function htmlAriaRowsForTag(tag) {
  const t = tag.toLowerCase();
  return htmlAria().elements.filter((e) =>
    e.match.customElement ? t.includes('-') : (e.match.tags ?? []).includes(t),
  );
}
