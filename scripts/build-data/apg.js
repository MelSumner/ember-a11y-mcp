// Extracts patterns, examples, and practices from a local clone of w3c/aria-practices (APG).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import * as cheerio from 'cheerio';
import { readSource, commitOf, originUrl, collapse, toText as baseToText } from './util.js';

const BASE_URL = 'https://www.w3.org/WAI/ARIA/apg/';
const PATTERN_SECTIONS = new Set(['about', 'examples', 'keyboard_interaction', 'roles_states_properties']);
// Third-party / app-level assets shipped inside some example js/ or css/ dirs (e.g. landmarks).
const VENDOR_ASSET = /(jquery|bootstrap|highlight|skipto|\.min\.)/i;

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const slugify = (s) =>
  collapse(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// util.toText leaves "-\n" when an <li>'s content starts on a new line; tidy that up.
const toText = ($, el) => baseToText($, el).replace(/^-\n+/gm, '- ');

function load(html) {
  const $ = cheerio.load(html);
  $('script, style, .example-code').remove();
  // Render ARIA spec reference links as inline code in extracted text.
  $('a.role-reference, a.property-reference, a.state-reference').each((_, a) => {
    if (!$(a).find('code').length) $(a).html(`<code>${$(a).html()}</code>`);
  });
  return $;
}

function pageTitle($) {
  return collapse($('h1').first().text()) || collapse($('title').first().text());
}

/** Content nodes belonging to an h2: the rest of its <section>, or following siblings until the next h2. */
function sectionContent($, heading) {
  const h = $(heading);
  const parent = h.parent();
  if (parent.is('section') && parent.children('h2').length === 1) return parent.contents().not(h);
  return h.nextUntil('h2');
}

function findH2($, re) {
  return $('h2')
    .filter((_, el) => re.test(collapse($(el).text())))
    .first();
}

/** Text of an element's children (avoids the leading "- " toText emits for <li>). */
const innerText = ($, el) => toText($, $(el).contents());

/**
 * Split a sequence of <kbd> elements and separator text into key strings,
 * joining `<kbd>Shift</kbd> + <kbd>F10</kbd>` into "Shift + F10".
 */
function keysFromTokens(tokens) {
  const keys = [];
  let joinNext = false;
  for (const t of tokens) {
    if (t.kbd) {
      if (joinNext && keys.length) keys[keys.length - 1] += ` + ${t.kbd}`;
      else keys.push(t.kbd);
      joinNext = false;
    } else if (/^\s*\+\s*$/.test(t.text)) {
      joinNext = true;
    } else if (collapse(t.text)) {
      joinNext = false;
    }
  }
  return keys;
}

/**
 * Collect the <kbd> keys an <li> describes: the kbd elements in the li's own text before the
 * first colon. Without a colon, only a leading run of kbd elements counts.
 */
function liKeys($, li) {
  const tokens = [];
  let sawColon = false;
  let leading = true;
  let leadingTokens = null;
  const walk = (node) => {
    if (sawColon) return;
    if (node.type === 'text') {
      const idx = node.data.indexOf(':');
      const text = idx >= 0 ? node.data.slice(0, idx) : node.data;
      tokens.push({ text });
      if (leading && collapse(text) && !/^\s*(\+|or|,|and|\/|\(optional\))?\s*$/i.test(text)) {
        leading = false;
        leadingTokens = tokens.slice(0, -1);
      }
      if (idx >= 0) sawColon = true;
      return;
    }
    if (node.type !== 'tag' || ['ul', 'ol', 'dl', 'div'].includes(node.name)) return;
    if (node.name === 'kbd') {
      tokens.push({ kbd: collapse($(node).text()) });
      return;
    }
    for (const c of node.children ?? []) walk(c);
  };
  for (const c of li.children ?? []) walk(c);
  return keysFromTokens(sawColon ? tokens : (leadingTokens ?? tokens));
}

function ownText($, li) {
  const clone = $(li).clone();
  clone.find('ul, ol, dl').remove();
  return collapse(clone.text());
}

function parseKeyboardInteraction($, section, heading = 'h2') {
  const text = toText($, section.contents().not(heading));
  const keys = [];
  // List items, plus top-level paragraphs like tooltip's "<kbd>Escape</kbd>: Dismisses the Tooltip."
  section.find('li').add(section.children('p')).each((_, li) => {
    const k = liKeys($, li);
    if (!k.length) return;
    keys.push({
      keys: k,
      description: innerText($, li),
      optional: /\(optional\)/i.test(ownText($, li)),
    });
  });
  return { text, keys };
}

function parseRolesStatesProperties($, section) {
  const text = toText($, section.contents().not('h2'));
  const fragment = (el) => {
    const href = $(el).attr('href') ?? '';
    const frag = href.includes('#') ? href.split('#').pop() : '';
    return (frag || collapse($(el).text())).toLowerCase();
  };
  let roles = section.find('a.role-reference').map((_, a) => fragment(a)).get();
  let attributes = section
    .find('a.property-reference, a.state-reference')
    .map((_, a) => fragment(a))
    .get();
  const codes = section.find('code').map((_, c) => collapse($(c).text())).get();
  if (!attributes.length) attributes = codes.map((c) => c.match(/^(aria-[a-z]+)/)?.[1]);
  if (!roles.length) roles = codes.map((c) => c.match(/^role=["']?([a-z]+)/)?.[1]);
  return { text, roles: uniq(roles), attributes: uniq(attributes) };
}

function patternFile(patternsDir, id) {
  const dir = join(patternsDir, id);
  if (!isDir(dir)) return null;
  if (existsSync(join(dir, `${id}-pattern.html`))) return `${id}-pattern.html`;
  // e.g. menubar/menu-and-menubar-pattern.html, radio/radio-group-pattern.html
  return readdirSync(dir).find((f) => f.endsWith('-pattern.html')) ?? null;
}

function buildPattern(sourceDir, id, file, warnings) {
  const sourcePath = `content/patterns/${id}/${file}`;
  const $ = load(readSource(sourceDir, sourcePath));
  const sec = (sid) => $(`section#${sid}`).first();

  const about = sec('about');
  const kbd = sec('keyboard_interaction');
  const rsp = sec('roles_states_properties');
  if (!about.length) warnings.push(`${sourcePath}: missing #about`);
  let keyboardInteraction = { text: '', keys: [] };
  if (kbd.length) {
    keyboardInteraction = parseKeyboardInteraction($, kbd);
  } else {
    // e.g. grid: keyboard guidance lives in nested "Keyboard Interaction ..." subsections.
    const subs = $('main section').filter((_, s) => /keyboard interaction/i.test($(s).children('h2, h3, h4').first().text()));
    if (subs.length) {
      const parts = subs.map((_, s) => {
        const h = $(s).children('h2, h3, h4').first();
        return { heading: collapse(h.text()), ...parseKeyboardInteraction($, $(s), h) };
      }).get();
      keyboardInteraction = {
        text: parts.map((p) => `${p.heading}\n\n${p.text}`).join('\n\n'),
        keys: parts.flatMap((p) => p.keys),
      };
    } else warnings.push(`${sourcePath}: missing keyboard interaction section`);
  }
  if (!rsp.length) warnings.push(`${sourcePath}: missing #roles_states_properties`);

  const exampleIds = uniq(
    sec('examples')
      .find('a[href]')
      .map((_, a) => $(a).attr('href').match(/^examples\/([^/#?]+)\.html/)?.[1])
      .get(),
  );

  const sections = $('main > section, body > section')
    .filter((_, s) => !PATTERN_SECTIONS.has($(s).attr('id')))
    .map((_, s) => {
      const h = $(s).children('h2, h3').first();
      return {
        id: $(s).attr('id') || slugify(h.text()),
        heading: collapse(h.text()),
        text: toText($, $(s).contents().not(h)),
      };
    })
    .get();

  return {
    id,
    title: pageTitle($),
    url: `${BASE_URL}patterns/${id}/`,
    about: about.length ? toText($, about.contents().not('h2')) : '',
    keyboardInteraction,
    rolesStatesProperties: rsp.length ? parseRolesStatesProperties($, rsp) : { text: '', roles: [], attributes: [] },
    exampleIds,
    sections,
  };
}

/** Group label for a table: from aria-labelledby (excluding the h2 id), else the nearest preceding h3. */
function tableGroup($, table, h2Id) {
  const ids = ($(table).attr('aria-labelledby') ?? '').split(/\s+/).filter((x) => x && x !== h2Id);
  for (const id of ids) {
    const t = collapse($(`[id="${id}"]`).first().text());
    if (t) return t;
  }
  const prevH3 = $(table).prevAll('h3').first();
  return prevH3.length ? collapse(prevH3.text()) || null : null;
}

function parseKeyboardTables($, warnings, ctx) {
  const h2 = $('h2#kbd_label').first();
  if (!h2.length) return [];
  const rows = [];
  const content = sectionContent($, h2);
  const tables = content.filter('table.def').add(content.find('table.def'));
  tables.each((_, table) => {
    const group = tableGroup($, table, 'kbd_label');
    $(table)
      .children('tbody')
      .children('tr')
      .add($(table).children('tr'))
      .each((_, tr) => {
        const th = $(tr).children('th').first();
        const td = $(tr).children('td').first();
        if (!th.length || !td.length) return;
        const tokens = [];
        th.contents().each((_, n) => {
          if (n.type === 'tag' && n.name === 'kbd') tokens.push({ kbd: collapse($(n).text()) });
          else if (n.type === 'tag' && $(n).find('kbd').length)
            $(n)
              .contents()
              .each((_, m) => tokens.push(m.type === 'tag' && m.name === 'kbd' ? { kbd: collapse($(m).text()) } : { text: $(m).text() }));
          else tokens.push({ text: $(n).text() });
        });
        let keys = keysFromTokens(tokens);
        if (!keys.length) keys = [collapse(th.text())];
        const lis = td.children('ul, ol').children('li');
        const behavior =
          lis.length && td.children().not('ul, ol').length === 0 && !collapse(td.contents().filter((_, n) => n.type === 'text').text())
            ? lis.map((_, li) => innerText($, li)).get()
            : [toText($, td.contents())];
        rows.push({ group, keys, behavior: behavior.filter(Boolean), testId: $(tr).attr('data-test-id') ?? null });
      });
  });
  if (!rows.length && !/not applicable|no keyboard/i.test(content.text()))
    warnings.push(`${ctx}: keyboard section has no parsable table rows`);
  return rows;
}

const COLUMN_MAP = [
  [/^role/i, 'role'],
  [/^attribute/i, 'attribute'],
  [/element/i, 'element'],
  [/^usage/i, 'usage'],
];

function parseAttributeTables($, warnings, ctx) {
  const h2 = $('h2#rps_label').first();
  let tables = h2.length ? sectionContent($, h2) : null;
  tables = tables ? tables.filter('table.attributes').add(tables.find('table.attributes')) : $('table.attributes');
  if (!tables.length) tables = $('table.attributes');
  const rows = [];
  tables.each((_, table) => {
    const group = tableGroup($, table, 'rps_label');
    const headers = $(table)
      .find('thead tr')
      .first()
      .children('th, td')
      .map((_, c) => {
        const t = collapse($(c).text());
        return COLUMN_MAP.find(([re]) => re.test(t))?.[1] ?? null;
      })
      .get();
    if (!headers.includes('usage')) warnings.push(`${ctx}: attribute table with unexpected headers`);
    $(table)
      .find('tbody > tr')
      .each((_, tr) => {
        const row = { group, role: null, attribute: null, element: null, usage: '', testId: $(tr).attr('data-test-id') ?? null };
        $(tr)
          .children('th, td')
          .each((i, cell) => {
            const key = headers[i];
            if (!key) return;
            if (key === 'usage') row.usage = toText($, $(cell).contents());
            else row[key] = collapse($(cell).text()) || null;
          });
        rows.push({ group: row.group, role: row.role, attribute: row.attribute, element: row.element, usage: row.usage, testId: row.testId });
      });
  });
  return rows;
}

function localAssets($, sourceDir, exampleDir, warnings, ctx) {
  const refs = [
    ...$('script[src]').map((_, s) => $(s).attr('src')).get(),
    ...$('link[href]').map((_, l) => $(l).attr('href')).get(),
    ...$('#css_js_files a[href]').map((_, a) => $(a).attr('href')).get(),
  ];
  const scripts = [];
  const styles = [];
  for (const ref of refs) {
    if (!ref || /^[a-z]+:|^\/\//i.test(ref)) continue;
    const rel = posix.normalize(ref.split(/[?#]/)[0]);
    const m = rel.match(/^(js|css)\/[^/]+\.(js|css)$/);
    if (!m || VENDOR_ASSET.test(rel)) continue;
    const path = posix.join(exampleDir, rel);
    if (!existsSync(join(sourceDir, path))) {
      warnings.push(`${ctx}: referenced asset not found: ${path}`);
      continue;
    }
    (m[1] === 'js' ? scripts : styles).push(path);
  }
  return { scripts: uniq(scripts), styles: uniq(styles) };
}

function parseTestNames(src) {
  const names = [];
  const re = /\b(?:ariaTest|test)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const m of src.matchAll(re)) names.push(m[2].replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim());
  return names;
}

function buildRegressionIndex(sourceDir) {
  const dir = join(sourceDir, 'test/tests');
  const index = new Map();
  if (!isDir(dir)) return index;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const file = `test/tests/${f}`;
    const src = readSource(sourceDir, file);
    const entry = { file, testNames: parseTestNames(src) };
    const refs = [...src.matchAll(/content\/patterns\/[\w-]+\/examples\/[\w-]+\.html/g)].map((m) => m[0]);
    for (const ref of uniq(refs)) if (!index.has(ref)) index.set(ref, entry);
    const byName = f.match(/^([\w-]+?)_([\w-]+)\.js$/);
    if (byName) {
      const key = `content/patterns/${byName[1]}/examples/${byName[2]}.html`;
      if (!index.has(key)) index.set(key, entry);
    }
  }
  return index;
}

function buildExample(sourceDir, patternId, id, regressionIndex, warnings) {
  const exampleDir = `content/patterns/${patternId}/examples`;
  const sourcePath = `${exampleDir}/${id}.html`;
  const raw = readSource(sourceDir, sourcePath);
  const assets = localAssets(cheerio.load(raw), sourceDir, exampleDir, warnings, sourcePath);
  const $ = load(raw);

  const aboutH2 = findH2($, /^About This( Experimental)? Example/i);
  let about = aboutH2.length ? toText($, sectionContent($, aboutH2)) : '';
  if (!about) {
    // Pages without the standard template (e.g. landmarks) — fall back to the main content.
    const main = $('main').first();
    about = main.length ? toText($, main.contents().not('h1')) : '';
  }

  const featH2 = findH2($, /^Accessibility Features/i);
  let accessibilityFeatures = [];
  if (featH2.length) {
    const content = sectionContent($, featH2);
    const lists = content.filter('ul, ol');
    accessibilityFeatures = lists.length
      ? lists.children('li').map((_, li) => innerText($, li)).get()
      : content
          .filter('p')
          .map((_, p) => toText($, p))
          .get();
  }

  const reg = regressionIndex.get(sourcePath);
  return {
    id,
    patternId,
    title: pageTitle($),
    url: `${BASE_URL}patterns/${patternId}/examples/${id}/`,
    sourcePath,
    about,
    accessibilityFeatures: accessibilityFeatures.filter(Boolean),
    keyboard: parseKeyboardTables($, warnings, sourcePath),
    attributes: parseAttributeTables($, warnings, sourcePath),
    scripts: assets.scripts,
    styles: assets.styles,
    regressionTest: reg ? { file: reg.file, testNames: reg.testNames } : null,
  };
}

function buildPractice(sourceDir, id) {
  const sourcePath = `content/practices/${id}/${id}-practice.html`;
  const $ = load(readSource(sourceDir, sourcePath));
  const sections = [];
  $('main section').each((_, s) => {
    const h = $(s).children('h2, h3, h4, h5, h6').first();
    if (!h.length) return;
    sections.push({
      id: $(s).attr('id') || slugify(h.text()),
      heading: collapse(h.text()),
      level: Number(h.get(0).name.slice(1)),
      text: toText($, $(s).contents().not(h).not('section')),
    });
  });
  return { id, title: pageTitle($), url: `${BASE_URL}practices/${id}/`, sections };
}

export function buildApg({ sourceDir }) {
  const warnings = [];
  const patternsDir = join(sourceDir, 'content/patterns');
  const practicesDir = join(sourceDir, 'content/practices');
  const regressionIndex = buildRegressionIndex(sourceDir);

  const patterns = [];
  const examples = [];
  const patternIds = readdirSync(patternsDir)
    .filter((d) => patternFile(patternsDir, d))
    .sort();
  for (const pid of patternIds) {
    try {
      patterns.push(buildPattern(sourceDir, pid, patternFile(patternsDir, pid), warnings));
    } catch (e) {
      warnings.push(`pattern ${pid}: ${e.message}`);
    }
    const exDir = join(patternsDir, pid, 'examples');
    if (!isDir(exDir)) continue;
    for (const f of readdirSync(exDir).filter((f) => f.endsWith('.html')).sort()) {
      try {
        examples.push(buildExample(sourceDir, pid, f.slice(0, -5), regressionIndex, warnings));
      } catch (e) {
        warnings.push(`example ${pid}/${f}: ${e.message}`);
      }
    }
  }

  const exampleKeys = new Set(examples.map((e) => `${e.patternId}/${e.id}`));
  for (const p of patterns) {
    for (const eid of p.exampleIds)
      if (!exampleKeys.has(`${p.id}/${eid}`)) warnings.push(`pattern ${p.id}: linked example ${eid} not found`);
  }

  const practices = [];
  const practiceIds = readdirSync(practicesDir)
    .filter((d) => existsSync(join(practicesDir, d, `${d}-practice.html`)))
    .sort();
  for (const id of practiceIds) {
    try {
      practices.push(buildPractice(sourceDir, id));
    } catch (e) {
      warnings.push(`practice ${id}: ${e.message}`);
    }
  }

  for (const w of warnings) console.warn(`[apg] ${w}`);

  return {
    source: {
      name: 'WAI-ARIA Authoring Practices Guide (APG)',
      repo: originUrl(sourceDir),
      commit: commitOf(sourceDir),
      license: 'W3C Software and Document License',
      licenseUrl: 'https://www.w3.org/copyright/software-license-2023/',
      baseUrl: BASE_URL,
    },
    patterns: patterns.sort(byId),
    examples: examples.sort((a, b) => byId(a, b) || (a.patternId < b.patternId ? -1 : 1)),
    practices: practices.sort(byId),
  };
}
