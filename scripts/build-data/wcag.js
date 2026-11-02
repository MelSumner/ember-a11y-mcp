// Extracts WCAG 2.2 principles, guidelines, success criteria, Understanding docs, techniques,
// glossary terms, and ACT rule mappings from a local clone of w3c/wcag.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { readSource, listSource, commitOf, originUrl, collapse, toText as baseToText } from './util.js';

const TR_URL = 'https://www.w3.org/TR/WCAG22/';
// Normative text (guidelines, SCs, glossary) comes from the Recommendation tag. Understanding docs, techniques
// and ACT mappings are informative and published from main, so they're read from the checked-out HEAD.
export const REC_REF = 'WCAG22-20241212';
const REC_STATUS = 'W3C Recommendation 12 December 2024';
const UNDERSTANDING_URL = 'https://www.w3.org/WAI/WCAG22/Understanding/';
const TECHNIQUES_URL = 'https://www.w3.org/WAI/WCAG22/Techniques/';
const VERSION_DIRS = { 20: '2.0', 21: '2.1', 22: '2.2' };
// Technologies relevant to web apps; others (pdf, flash, silverlight, smil, server-side-script) are skipped.
const WEB_TECHNOLOGIES = ['aria', 'client-side-script', 'css', 'failures', 'general', 'html', 'text'];
const MAX_TEXT = 4000;
const MAX_EXAMPLE_TEXT = 2000;
const MAX_CODE = 3000;
const TECHNIQUE_ID = /^[A-Z]+\d+$/;

const truncate = (s, max = MAX_TEXT) => (s && s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + ' …' : s);
// util.toText leaves "-\n" when an <li>'s content starts on a new line; tidy that up.
const toText = ($, el) => baseToText($, el).replace(/^-\n+/gm, '- ');
const stripLiquid = (s) => s.replace(/\{%[\s\S]*?%\}/g, '').replace(/\{\{[\s\S]*?\}\}/g, '');
const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')).sort() : []);

/** Split YAML-ish front matter (only flat `key: value` / `key: |` blocks are used in techniques). */
function frontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { data: {}, content: src };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2];
    if (value === '|' || value === '>') {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(kv[2] === '|' ? '\n' : ' ');
    }
    data[kv[1]] = value.replace(/^["']|["']$/g, '').trim();
  }
  return { data, content: src.slice(m[0].length) };
}

function load(html) {
  const $ = cheerio.load(stripLiquid(html));
  $('script, style, .remove').remove();
  // Collapse source line-wrapping in text (preformatted code keeps its whitespace).
  $('*')
    .contents()
    .each((_, n) => {
      if (n.type === 'text' && !$(n).parents('pre').length) n.data = n.data.replace(/\s+/g, ' ');
    });
  $('.note').each((_, el) => {
    const n = $(el);
    if (!/^\s*note\b/i.test(n.text())) n.prepend('Note: ');
  });
  // Keep ordered-list numbering (technique tests refer to steps as "#1").
  $('ol').each((_, ol) => {
    $(ol)
      .children('li')
      .each((i, li) => {
        const first = $(li).children().first();
        const leadsWithBlock = first.is('p') && !collapse($(li).contents().first().text());
        (leadsWithBlock ? first : $(li)).prepend(`${i + 1}. `);
        li.tagName = 'p';
      });
    ol.tagName = 'div';
  });
  return $;
}

/** Plain text for an HTML snippet (11tydata titles may contain markup). */
function htmlText(html) {
  const $ = cheerio.load(`<div>${html}</div>`, null, false);
  return collapse(toText($, $('div').first().contents()));
}

const sectionText = ($, sel, max) => {
  const s = $(sel).first();
  if (!s.length) return null;
  return truncate(toText($, s.contents().not('h2')), max) || null;
};

function itemsOf($, sectionSel) {
  const s = $(sectionSel).first();
  if (!s.length) return [];
  const body = s.children().not('h2');
  const dl = body.filter('dl');
  if (dl.length) {
    return dl
      .children('dt')
      .toArray()
      .map((dt) => {
        const title = collapse($(dt).text());
        const text = toText($, $(dt).nextUntil('dt', 'dd').contents());
        return truncate(text ? `${title}: ${text}` : title, MAX_EXAMPLE_TEXT);
      });
  }
  const lists = body.filter('ul');
  if (lists.length && body.filter('p').length <= 1) {
    return lists
      .children('li')
      .toArray()
      .map((li) => truncate(toText($, $(li).contents()), MAX_EXAMPLE_TEXT))
      .filter(Boolean);
  }
  const sections = body.filter('section');
  if (sections.length) {
    return sections.toArray().map((sec) => {
      const title = collapse($(sec).children('h3, h4').first().text());
      const text = toText($, $(sec).contents().not('h3, h4'));
      return truncate(title ? `${title}: ${text}` : text, MAX_EXAMPLE_TEXT);
    });
  }
  const text = truncate(toText($, body), MAX_EXAMPLE_TEXT);
  return text ? [text] : [];
}

const BRIEF_KEYS = { goal: 'goal', 'what to do': 'whatToDo', 'author task': 'whatToDo', "why it's important": 'whyImportant' };
const camel = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');

function parseBrief($) {
  const s = $('#brief').first();
  if (!s.length) return null;
  const dts = s.find('dl > dt');
  if (!dts.length) return { text: toText($, s.contents().not('h2')) };
  const brief = {};
  dts.each((_, dt) => {
    const label = collapse($(dt).text()).replace(/[’]/g, "'");
    brief[BRIEF_KEYS[label.toLowerCase()] ?? camel(label)] = collapse(toText($, $(dt).next('dd').contents()));
  });
  return brief;
}

function parseUnderstanding(sourceDir, versionDir, id) {
  const path = `understanding/${versionDir}/${id}.html`;
  const result = { url: UNDERSTANDING_URL + id };
  if (!existsSync(join(sourceDir, path))) return { ...result, missing: true };
  const $ = load(readSource(sourceDir, path));
  return {
    ...result,
    brief: parseBrief($),
    intent: sectionText($, '#intent', MAX_TEXT),
    benefits: itemsOf($, '#benefits'),
    examples: itemsOf($, '#examples'),
  };
}

function parseTechnique(sourceDir, technology, file) {
  const { data, content } = frontMatter(readSource(sourceDir, `techniques/${technology}/${file}`));
  const $ = load(content);
  // The filename is authoritative (as in the W3C build); a few files have stale `section.meta` ids.
  const id = file.replace(/\.html$/, '');
  const title = collapse($('h1').first().text()) || collapse($('title').first().text());
  const technique = {
    id,
    title,
    technology,
    url: `${TECHNIQUES_URL}${technology}/${id}`,
    type: collapse($('section.meta .type').text()).replace(/^Type:\s*/i, '') || undefined,
  };
  if (data.obsoleteSince) {
    technique.obsolete = true;
    technique.obsoleteSince = VERSION_DIRS[data.obsoleteSince] ?? String(data.obsoleteSince);
    if (data.obsoleteMessage) technique.obsoleteMessage = collapse(data.obsoleteMessage);
  }
  technique.applicability = sectionText($, '#applicability', 1000);
  technique.description = sectionText($, '#description', MAX_TEXT);
  technique.examples = $('#examples section.example')
    .toArray()
    .map((ex) => {
      const e = $(ex);
      const code = e
        .find('pre')
        .toArray()
        .map((pre) => truncate($(pre).text().replace(/^\n+|\s+$/g, ''), MAX_CODE));
      const text = toText($, e.contents().not('h3, h4').filter((_, n) => !(n.type === 'tag' && n.name === 'pre')));
      return {
        title: collapse(e.children('h3, h4').first().text()) || null,
        text: truncate(text.replace(/```[\s\S]*?```/g, '').trim(), MAX_EXAMPLE_TEXT) || null,
        code,
      };
    });
  if (!technique.examples.length) {
    const fallback = sectionText($, '#examples', MAX_EXAMPLE_TEXT);
    if (fallback) technique.examples = [{ title: null, text: fallback, code: [] }];
  }
  technique.tests = sectionText($, '#tests', MAX_TEXT);
  technique.related = [
    ...new Set(
      $('#related a')
        .toArray()
        .map((a) => collapse($(a).text()))
        .filter((t) => TECHNIQUE_ID.test(t)),
    ),
  ];
  technique.successCriteria = [];
  return technique;
}

/** Level an obsolete SC had before removal, as stated in its Understanding doc. */
function formerLevel(sourceDir, versionDir, id) {
  const path = `understanding/${versionDir}/${id}.html`;
  if (!existsSync(join(sourceDir, path))) return null;
  return readSource(sourceDir, path).match(/\(Level (A{1,3})\)/)?.[1] ?? null;
}

/** Loads the associated-techniques map; the 11tydata file is an ESM module exporting `default(data)`. */
async function loadAssociatedTechniques(sourceDir) {
  const src = readSource(sourceDir, 'understanding/understanding.11tydata.js');
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
  const data = typeof mod.default === 'function' ? mod.default({ understandingUrl: UNDERSTANDING_URL }) : mod.default;
  return data.associatedTechniques;
}

export async function buildWcag({ sourceDir }) {
  // --- Techniques (titles for all technologies; full records for web technologies) ---
  const titles = {};
  const techniques = {};
  for (const technology of readdirSync(join(sourceDir, 'techniques'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    for (const file of listFiles(join(sourceDir, 'techniques', technology))) {
      if (WEB_TECHNOLOGIES.includes(technology)) {
        const t = parseTechnique(sourceDir, technology, file);
        techniques[t.id] = t;
        titles[t.id] = { title: t.title, technology };
      } else {
        const src = readSource(sourceDir, `techniques/${technology}/${file}`);
        const h1 = src.match(/<h1[^>]*>([\s\S]+?)<\/h1>/);
        titles[file.replace(/\.html$/, '')] = { title: h1 ? htmlText(h1[1]) : null, technology };
      }
    }
  }

  // --- ACT rules ---
  const actMapping = JSON.parse(readSource(sourceDir, 'guidelines/act-mapping.json'))['act-rules'];
  const actRules = actMapping
    .filter((r) => !r.deprecated)
    .map((r) => ({
      id: r.frontmatter.id,
      name: r.frontmatter.name ?? r.title,
      description: collapse(r.frontmatter.description),
      url: 'https://www.w3.org/WAI' + r.permalink,
      successCriteria: r.successCriteria,
      proposed: !!r.proposed,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  // --- Associated techniques ---
  const associated = await loadAssociatedTechniques(sourceDir);

  // --- Principles, guidelines, success criteria ---
  const $ = cheerio.load(readSource(sourceDir, 'guidelines/index.html', REC_REF));
  const principles = [];
  const successCriteria = [];
  $('section.principle').each((pi, p) => {
    const pNum = String(pi + 1);
    const principle = {
      num: pNum,
      id: $(p).attr('id'),
      title: collapse($(p).children('h2').first().text()),
      description: collapse($(p).children('p').first().text()),
      url: TR_URL + '#' + $(p).attr('id'),
      guidelines: [],
    };
    principles.push(principle);
    $(p)
      .children('section.guideline')
      .each((gi, g) => {
        const gNum = `${pNum}.${gi + 1}`;
        const gid = $(g).attr('id');
        principle.guidelines.push({
          num: gNum,
          id: gid,
          title: collapse($(g).children('h3').first().text()),
          description: collapse($(g).children('p').first().text()),
          url: TR_URL + '#' + gid,
          understandingUrl: UNDERSTANDING_URL + gid,
        });
        $(g)
          .children('section[data-include]')
          .each((si, inc) => {
            const includePath = $(inc).attr('data-include');
            const [, versionDir, file] = includePath.match(/^sc\/(\d+)\/(.+)$/);
            const sc$ = load(readSource(sourceDir, `guidelines/${includePath}`, REC_REF));
            const sec = sc$('section.sc').first();
            const id = sec.attr('id') ?? file.replace(/\.html$/, '');
            const rawTitle = collapse(sec.children('h4').first().text());
            const obsolete = /obsolete|removed/i.test(rawTitle) || sc$('.conformance-level').length === 0;
            // `<p class="change">New</p>` marks SCs added in 2.2; it's an editorial badge, not SC text.
            const body = sec.contents().not('h4, .conformance-level, .change');
            const sc = {
              num: `${gNum}.${si + 1}`,
              id,
              title: rawTitle.replace(/\s*\((?:obsolete|removed)[^)]*\)\s*$/i, ''),
              level: collapse(sc$('.conformance-level').first().text()) || null,
              version: VERSION_DIRS[versionDir],
              obsolete,
              ...(obsolete && { formerLevel: formerLevel(sourceDir, versionDir, id) }),
              principle: pNum,
              guideline: gNum,
              text: toText(sc$, body),
              url: TR_URL + '#' + id,
              understanding: parseUnderstanding(sourceDir, versionDir, id),
              techniques: null,
              actRules: actRules.filter((r) => r.successCriteria.includes(id)).map((r) => r.id),
            };
            successCriteria.push(sc);
          });
      });
  });

  // Resolve associated techniques, recording the reverse technique -> SC mapping as we go.
  for (const sc of successCriteria) {
    const assoc = associated[sc.id];
    const seen = new Set();
    const ref = (t) => {
      const entry = typeof t === 'string' ? (TECHNIQUE_ID.test(t) ? { id: t } : { title: t }) : t;
      if ('and' in entry) {
        return {
          and: entry.and.map(ref),
          ...(entry.andConjunction && { andConjunction: entry.andConjunction }),
          ...usingOf(entry),
        };
      }
      const out = {};
      if (entry.id) {
        out.id = entry.id;
        const known = titles[entry.id];
        out.title = known?.title ?? (entry.title ? htmlText(entry.title) : null);
        if (known) out.technology = known.technology;
        if (techniques[entry.id]) seen.add(entry.id);
      } else {
        out.title = htmlText(entry.title);
      }
      if (entry.prefix) out.prefix = htmlText(entry.prefix);
      if (entry.suffix) out.suffix = htmlText(entry.suffix);
      return { ...out, ...usingOf(entry) };
    };
    const usingOf = (entry) =>
      entry.using
        ? {
            using: entry.using.map(ref),
            ...(entry.usingQuantity && { usingQuantity: entry.usingQuantity }),
            ...(entry.usingConjunction && { usingConjunction: entry.usingConjunction }),
            ...(entry.usingPrefix && { usingPrefix: htmlText(entry.usingPrefix) }),
          }
        : {};
    const isSection = (x) => x && typeof x === 'object' && Array.isArray(x.techniques);
    let sufficient = [];
    if (assoc?.sufficient?.length) {
      sufficient = assoc.sufficient.some(isSection)
        ? assoc.sufficient.map((s) => ({
            situation: htmlText(s.title),
            ...(s.note && { note: htmlText(s.note) }),
            techniques: s.techniques.map(ref),
            ...(s.groups && {
              groups: s.groups.map((g) => ({ id: g.id, title: htmlText(g.title), techniques: g.techniques.map(ref) })),
            }),
          }))
        : [{ situation: null, techniques: assoc.sufficient.map(ref) }];
    }
    sc.techniques = {
      ...(assoc?.sufficientIntro && { sufficientIntro: htmlText(assoc.sufficientIntro) }),
      sufficient,
      ...(assoc?.sufficientNote && { sufficientNote: htmlText(assoc.sufficientNote) }),
      advisory: (assoc?.advisory ?? []).map(ref),
      failure: (assoc?.failure ?? []).map(ref),
    };
    for (const id of seen) techniques[id].successCriteria.push(sc.num);
  }

  // --- Glossary terms ---
  const terms = {};
  for (const versionDir of Object.keys(VERSION_DIRS)) {
    for (const file of listSource(sourceDir, `guidelines/terms/${versionDir}`, REC_REF).filter((f) => f.endsWith('.html')).sort()) {
      const t$ = load(readSource(sourceDir, `guidelines/terms/${versionDir}/${file}`, REC_REF));
      const dfn = t$('dfn').first();
      const term = collapse(dfn.text());
      if (!term) continue;
      const aliases = (dfn.attr('data-lt') ?? '')
        .split('|')
        .map(collapse)
        .filter((a) => a && a.toLowerCase() !== term.toLowerCase());
      terms[term.toLowerCase()] = {
        id: dfn.attr('id') ?? null,
        term,
        ...(aliases.length && { aliases }),
        version: VERSION_DIRS[versionDir],
        definition: truncate(toText(t$, t$('dd').first().contents()), MAX_TEXT),
        url: TR_URL + '#' + (dfn.attr('id') ?? ''),
      };
    }
  }

  return {
    source: {
      name: 'Web Content Accessibility Guidelines (WCAG) 2.2',
      repo: originUrl(sourceDir),
      status: REC_STATUS,
      ref: REC_REF,
      refCommit: commitOf(sourceDir, `${REC_REF}^{commit}`),
      commit: commitOf(sourceDir),
      license: 'W3C Software and Document License',
      licenseUrl: 'https://www.w3.org/copyright/software-license-2023/',
      specUrl: TR_URL,
      generatedFrom: `Guidelines, success criteria and glossary from the ${REC_REF} tag (${REC_STATUS}); Understanding, techniques and ACT mappings from main.`,
    },
    principles,
    successCriteria,
    techniques: Object.fromEntries(Object.entries(techniques).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))),
    actRules,
    terms: Object.fromEntries(Object.entries(terms).sort(([a], [b]) => a.localeCompare(b))),
  };
}
