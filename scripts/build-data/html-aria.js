import * as cheerio from 'cheerio';
import { readSource, commitOf, originUrl, collapse } from './util.js';

const BASE_URL = 'https://www.w3.org/TR/html-aria/';

/**
 * Hand-curated element match conditions for each row of the "Rules of ARIA attribute usage
 * by HTML element" table. The table expresses conditions in prose, so this is the
 * machine-readable counterpart.
 *
 * attrs: { name: true (present) | false (absent) | 'empty' | 'nonempty' | [allowed values] }
 * inputTypes: for <input>, list of `type` values ('' = missing/invalid type).
 * context: prose-only conditions the linter cannot always evaluate statically.
 */
const TEXT_TYPES = ['text', 'search', 'tel', 'url', 'email'];
const KNOWN_INPUT_TYPES = [
  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month',
  'number', 'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week',
];
const input = (types, extra = {}) => ({ tags: ['input'], inputTypes: types, ...extra });

const MATCH = {
  'el-a': { tags: ['a'], attrs: { href: true } },
  'el-a-no-href': { tags: ['a'], attrs: { href: false } },
  'el-area': { tags: ['area'], attrs: { href: true } },
  'el-area-no-href': { tags: ['area'], attrs: { href: false } },
  'el-autonomous-custom-element': { customElement: true },
  'el-form-associated-custom-element': { customElement: true, context: 'form-associated custom element' },
  'el-h1-h6': { tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] },
  'el-img': { tags: ['img'], context: 'img has non-empty alt or another accessible name (or no alt attribute)' },
  'el-img-no-name': { tags: ['img'], attrs: { alt: 'empty' }, context: 'img with alt="" and no other accessible name' },
  'el-input-button': input(['button']),
  'el-input-checkbox': input(['checkbox']),
  'el-input-color': input(['color']),
  'el-input-date': input(['date']),
  'el-input-datetime-local': input(['datetime-local']),
  'el-input-email': input(['email'], { attrs: { list: false } }),
  'el-input-file': input(['file']),
  'el-input-hidden': input(['hidden']),
  'el-input-image': input(['image']),
  'el-input-month': input(['month']),
  'el-input-number': input(['number']),
  'el-input-password': input(['password']),
  'el-input-radio': input(['radio']),
  'el-input-range': input(['range']),
  'el-input-reset': input(['reset']),
  'el-input-search': input(['search'], { attrs: { list: false } }),
  'el-input-submit': input(['submit']),
  'el-input-tel': input(['tel'], { attrs: { list: false } }),
  'el-input-text': input(['text', ''], { attrs: { list: false } }),
  'el-input-text-list': input([...TEXT_TYPES, ''], { attrs: { list: true } }),
  'el-input-time': input(['time']),
  'el-input-url': input(['url'], { attrs: { list: false } }),
  'el-input-week': input(['week']),
  'el-select': { tags: ['select'], attrs: { multiple: false }, context: 'no multiple attribute and size <= 1' },
  'el-select-multiple-or-size-greater-1': { tags: ['select'], context: 'multiple attribute or size > 1' },
  'el-svg': { tags: ['svg'] },
  'el-math': { tags: ['math'] },
  'el-option': { tags: ['option'], context: 'in a list of options or datalist suggestion' },
  'el-footer': { tags: ['footer'], context: 'contentinfo only when not scoped to article/aside/main/nav/section' },
  'el-header': { tags: ['header'], context: 'banner only when not scoped to article/aside/main/nav/section' },
  'el-section': { tags: ['section'], context: 'region only when it has an accessible name' },
  'el-li': { tags: ['li'], context: 'depends on whether parent exposes the list role' },
  'el-td': { tags: ['td'], context: 'depends on the ancestor table role' },
  'el-th': { tags: ['th'], context: 'depends on the ancestor table role' },
  'el-tr': { tags: ['tr'], context: 'depends on the ancestor table role' },
  'el-div': { tags: ['div'], context: 'only presentation/none when a direct child of dl' },
  'el-figure': { tags: ['figure'], context: 'depends on whether it has a figcaption' },
  'el-label': { tags: ['label'], context: 'no role when associated with a labelable element' },
  'el-summary': { tags: ['summary'], context: 'no role when it is the summary of its parent details' },
  'el-selectedcontent': { tags: ['selectedcontent'], context: 'no role or aria-* when a valid descendant of select' },
  'el-button': { tags: ['button'], context: 'inert with no role/aria-* when it is the first child of select' },
};

/**
 * Corrections where prose-derived values need adjustment. Values replace extracted fields.
 */
const without = (list, ...remove) => list.filter((r) => !remove.includes(r));
const FIXES = {
  // "If role defined by ElementInternals, no role. Otherwise any role" – statically we can't know.
  'el-autonomous-custom-element': { rolePolicy: 'any', implicitRole: 'generic' },
  'el-form-associated-custom-element': { rolePolicy: 'list', implicitRole: 'generic' },
  'el-footer': {
    implicitRole: 'contentinfo',
    implicitRoleAlternatives: ['generic'],
    allowedRoles: ['group', 'none', 'presentation', 'doc-footnote'],
    notRecommendedRoles: ['contentinfo'],
    shouldNotRoles: ['generic'],
    namingProhibited: false,
    namingProhibitedWhen: 'exposed as generic (scoped to article/aside/main/nav/section)',
  },
  'el-header': {
    implicitRole: 'banner',
    implicitRoleAlternatives: ['generic'],
    allowedRoles: ['group', 'none', 'presentation'],
    notRecommendedRoles: ['banner'],
    shouldNotRoles: ['generic'],
    namingProhibited: false,
    namingProhibitedWhen: 'exposed as generic (scoped to article/aside/main/nav/section)',
  },
  'el-section': (e) => ({
    implicitRole: 'region',
    implicitRoleAlternatives: ['generic'],
    allowedRoles: without(e.allowedRoles, 'generic', 'region'),
    notRecommendedRoles: ['region'],
    shouldNotRoles: ['generic'],
  }),
  'el-li': {
    implicitRole: 'listitem',
    implicitRoleAlternatives: ['generic'],
    allowedRoles: [],
    notRecommendedRoles: ['listitem'],
    shouldNotRoles: ['doc-biblioentry', 'doc-endnote'],
    contextFallbackPolicy: 'any',
  },
  'el-td': {
    implicitRole: 'cell',
    implicitRoleAlternatives: ['gridcell'],
    rolePolicy: 'list',
    allowedRoles: [],
    notRecommendedRoles: ['cell', 'gridcell'],
    contextFallbackPolicy: 'any',
  },
  'el-th': {
    implicitRole: 'columnheader',
    implicitRoleAlternatives: ['rowheader', 'cell', 'gridcell'],
    rolePolicy: 'list',
    allowedRoles: [],
    notRecommendedRoles: ['columnheader', 'rowheader', 'cell', 'gridcell'],
    contextFallbackPolicy: 'any',
  },
  'el-tr': { rolePolicy: 'list', allowedRoles: [], notRecommendedRoles: ['row'], contextFallbackPolicy: 'any' },
  'el-figure': { contextFallbackPolicy: 'any', notes: ['With a figcaption descendant only figure (NOT RECOMMENDED) or doc-example are allowed.'] },
  'el-div': { contextFallbackPolicy: 'any', notes: ['As a direct child of dl only presentation/none are allowed.'] },
  'el-dt': {
    notes: [
      'HTML-AAM maps `<dt>` to the `term` role, which supports author-provided names; accordingly, `aria-label` is allowed. ARIA in HTML separately lists no corresponding role and allows `listitem` as an explicit role. See [HTML-AAM](https://www.w3.org/TR/html-aam-1.0/#el-dt) and [WAI-ARIA `term`](https://www.w3.org/TR/wai-aria-1.2/#term).',
      'With `tabindex="-1"`, `<dt>` can receive programmatic focus but is normally skipped in sequential Tab navigation. See [WHATWG HTML](https://html.spec.whatwg.org/multipage/interaction.html#the-tabindex-attribute).',
      'When the visible text already provides the intended name, prefer it or `aria-labelledby`; `aria-label` overrides the name from content.',
    ],
  },
  'el-label': { contextFallbackPolicy: 'any' },
  'el-summary': { contextFallbackPolicy: 'any' },
  'el-selectedcontent': { contextFallbackPolicy: 'any' },
  'el-img': (e) => ({
    implicitRole: 'img',
    implicitRoleAlternatives: [],
    allowedRoles: without(e.allowedRoles, 'none', 'presentation'),
    notRecommendedRoles: ['img', 'image'],
  }),
  'el-img-no-name': { implicitRole: 'presentation', implicitRoleAlternatives: ['none'], ariaPolicy: 'hidden-only' },
  'el-select-multiple-or-size-greater-1': { implicitRole: 'listbox', implicitRoleAlternatives: [], allowedRoles: [] },
  'el-svg': { implicitRole: 'graphics-document' },
  'el-h1-h6': { implicitRole: 'heading', implicitValues: { 'aria-level': 'from tag name' } },
  'el-summary': { implicitRole: null, contextFallbackPolicy: 'any' },
  'el-input-text-list': { implicitRole: 'combobox' },
  'el-input-checkbox': { notes: ['button is only allowed together with aria-pressed.'] },
  'el-button': { implicitRole: 'button' },
};

function cleanHeading(text) {
  return collapse(text.replace(/\[\^([^^/]+)\/([^^]+)\^\]/g, '$2').replace(/\[\^([^^]+)\^\]/g, '$1').replace(/`/g, ''));
}

function rolesFromLinks($, el) {
  return [
    ...new Set(
      $(el)
        .find('a')
        .toArray()
        .map((a) => {
          const href = $(a).attr('href') ?? '';
          const cite = $(a).attr('data-cite') ?? '';
          let m = /#index-aria-([\w-]+)/.exec(href);
          if (m) return m[1];
          m = /dpub-aria-1\.1#(doc-[\w-]+)/.exec(cite);
          if (m) return m[1];
          return null;
        })
        .filter(Boolean),
    ),
  ];
}

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/^role=/, ''));

function parseAllowance($, td, row) {
  const text = collapse($(td).text());
  const result = {
    rolePolicy: 'list',
    allowedRoles: [],
    notRecommendedRoles: [],
    shouldNotRoles: [],
    namingProhibited: /Naming Prohibited/.test(text),
    ariaPolicy: 'global-and-role',
    ariaRoles: [],
    additionalAttributes: [],
    attributeRules: [],
  };
  const paragraphs = $(td).children('p, div:not(.note), ul').toArray();
  const roleParas = paragraphs.filter((p) => /\bRoles?:|following roles are allowed|DPub Roles?:|other than/i.test($(p).text()));

  if (/^No `?role`? or `?aria-\*`? attributes/i.test(text)) {
    result.rolePolicy = 'none';
    result.ariaPolicy = 'none';
  } else if (/^No `?role`?(?! other than)/i.test(text)) {
    result.rolePolicy = 'none';
  } else if (/\bAny `?role`?/i.test(text) && !/^(Roles?:|No `?role`? other than)/i.test(text)) {
    result.rolePolicy = 'any';
  }

  for (const p of roleParas) {
    const ptext = collapse($(p).text());
    const roles = rolesFromLinks($, p);
    const plainRoles = backticked(ptext).filter((r) => /^[a-z-]+$/.test(r) && !r.startsWith('aria-'));
    const all = roles.length ? roles : plainRoles;
    if (/following roles are allowed, but are NOT RECOMMENDED/i.test(ptext)) {
      result.notRecommendedRoles.push(...all);
      continue;
    }
    // "(link is also allowed, but NOT RECOMMENDED.)"
    const alsoAllowed = /\(([^)]*?)(?:is|are) also allowed, but (NOT RECOMMENDED|SHOULD NOT be used)/i.exec(ptext);
    let main = all;
    if (alsoAllowed) {
      const discouraged = alsoAllowed[1]
        .replace(/role=/g, '')
        .split(/\s*(?:,|\bor\b|\band\b)\s*/)
        .map((s) => collapse(s.replace(/[`.]/g, '')))
        .filter((s) => /^[a-z-]+$/.test(s));
      (alsoAllowed[2].startsWith('SHOULD') ? result.shouldNotRoles : result.notRecommendedRoles).push(...discouraged);
      main = all.filter((r) => !discouraged.includes(r));
    }
    const otherThan = /No `?role`? other than (?:the )?(?:role=)?([^,.]+?)(?:roles?)?,? which (?:(?:is|are) )?(NOT RECOMMENDED|SHOULD NOT be used)/i.exec(
      ptext,
    );
    if (otherThan) {
      const discouraged = otherThan[1]
        .split(/\s*(?:,|\bor\b|\band\b)\s*/)
        .map((s) => collapse(s.replace(/[`.]/g, '').replace(/^role=/, '')))
        .filter((s) => /^[a-z-]+$/.test(s));
      (otherThan[2].startsWith('SHOULD') ? result.shouldNotRoles : result.notRecommendedRoles).push(...discouraged);
      main = all.filter((r) => !discouraged.includes(r));
    }
    result.allowedRoles.push(...main);
  }

  // "Any role, though X is NOT RECOMMENDED" / "though generic SHOULD NOT be used"
  for (const m of text.matchAll(/though (?:role=)?`?([\w-]+)`? (?:is|are) NOT RECOMMENDED/gi)) result.notRecommendedRoles.push(m[1]);
  for (const m of text.matchAll(/though `?([\w-]+)`? SHOULD NOT be used/gi)) result.shouldNotRoles.push(m[1]);

  if (/No `?aria-\*`? attributes\.?$|No `?aria-\*`? attributes\./i.test(text) && result.ariaPolicy !== 'none') result.ariaPolicy = 'none';
  if (/aria-hidden="true"`?\.?$|except `?aria-hidden="true"/.test(text)) result.ariaPolicy = 'hidden-only';
  if (/MAY specify the `?aria-hidden`? attribute/.test(text) && /no other allowed `?aria-\*`? attributes/i.test(text))
    result.ariaPolicy = 'hidden-only';

  const applicable = /applicable to the (`?[\w-]+`?(?:\s*(?:or|and|,)\s*`?[\w-]+`?)*) roles?/i.exec(text);
  if (applicable && !/^allowed$/.test(applicable[1])) {
    result.ariaRoles = applicable[1]
      .split(/\s*(?:,|\bor\b|\band\b)\s*/)
      .map((s) => s.replace(/`/g, ''))
      .filter(Boolean);
  }
  const globalSentence = /Global `?aria-\*`? attributes(?:,| and)\s*((?:`aria-[\w]+`(?:,\s*|\s*and\s*|\s*)?)+)\s*attributes?/i.exec(text);
  if (globalSentence) result.additionalAttributes = [...globalSentence[1].matchAll(/`(aria-[\w]+)`/g)].map((m) => m[1]);

  // Sentences with normative keywords about specific aria-* attributes.
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const level = /MUST NOT/.test(sentence)
      ? 'must-not'
      : /SHOULD NOT|NOT RECOMMENDED/.test(sentence)
        ? 'should-not'
        : null;
    if (!level) continue;
    const attrs = [...sentence.matchAll(/`?(aria-[a-z]+)(?:="?([a-z]+)"?)?`?/g)].map((m) => ({ name: m[1], value: m[2] ?? null }));
    if (!attrs.length) continue;
    result.attributeRules.push({ level, attributes: attrs, text: sentence });
  }

  for (const k of ['allowedRoles', 'notRecommendedRoles', 'shouldNotRoles']) result[k] = [...new Set(result[k])];
  if (result.rolePolicy === 'none' && (result.allowedRoles.length || result.notRecommendedRoles.length)) result.rolePolicy = 'list';
  result.text = text;
  return result;
}

function parseImplicit($, td) {
  const text = collapse($(td).text());
  const links = $(td)
    .find('a')
    .toArray()
    .map((a) => /#index-aria-([\w-]+)/.exec($(a).attr('href') ?? '')?.[1])
    .filter(Boolean);
  const codes = backticked(text).filter((r) => /^[a-z-]+$/.test(r));
  const roles = [...new Set([...links, ...codes])];
  if (/^No corresponding role/i.test(text)) return { implicitRole: null, implicitRoleAlternatives: [], implicitText: text };
  return { implicitRole: roles[0] ?? null, implicitRoleAlternatives: roles.slice(1), implicitText: text };
}

/** Prose rules outside the main table, kept as normative guidance for explanations. */
function parseNativeEquivalents($) {
  const rules = [];
  $('table')
    .toArray()
    .filter((t) => /aria-\w+/.test(collapse($(t).find('caption').text())) || /in place of equivalent/i.test(collapse($(t).prevAll('h2,h3').first().text())))
    .forEach((t) => {
      $(t)
        .find('tbody tr')
        .each((_, tr) => {
          const cells = $(tr).children('th,td').toArray();
          if (cells.length < 2) return;
          const text = cells.map((c) => cleanHeading($(c).text()));
          rules.push({
            htmlFeature: text[0],
            ariaAttribute: /aria-[a-z]+/.exec(text[1])?.[0] ?? text[1],
            ariaUsage: text[1],
            guidance: text[text.length - 1],
          });
        });
    });
  return rules;
}

function fix(id, extracted) {
  const f = FIXES[id];
  if (!f) return {};
  return typeof f === 'function' ? f(extracted) : f;
}

export function buildHtmlAria({ sourceDir }) {
  const html = readSource(sourceDir, 'index.html');
  const $ = cheerio.load(html);
  const table = $('table.data')
    .filter((_, t) => /Rules of ARIA attribute usage by HTML element/.test($(t).find('caption').text()))
    .first();
  const elements = [];
  table.find('tbody > tr').each((_, tr) => {
    const th = $(tr).children('th').first();
    const id = th.attr('id');
    if (!id) return;
    const tds = $(tr).children('td').toArray();
    const heading = cleanHeading(th.text());
    const implicit = parseImplicit($, tds[0]);
    const allowance = parseAllowance($, tds[1], id);
    const tagGuess = /^([a-z0-9-]+)/i.exec(heading)?.[1]?.toLowerCase();
    const match = MATCH[id] ?? { tags: [tagGuess] };
    elements.push({
      id,
      element: heading,
      match,
      ...implicit,
      ...allowance,
      ...fix(id, { ...implicit, ...allowance }),
      url: BASE_URL + '#' + id,
    });
  });

  return {
    source: {
      name: 'ARIA in HTML',
      url: BASE_URL,
      repo: originUrl(sourceDir),
      commit: commitOf(sourceDir),
      license: 'W3C Software and Document License',
      licenseUrl: 'https://www.w3.org/copyright/software-license-2023/',
      note: 'Allowances derived from the normative table; `match` conditions are hand-curated by ember-a11y-mcp.',
    },
    knownInputTypes: KNOWN_INPUT_TYPES,
    elements,
    nativeEquivalents: parseNativeEquivalents($),
  };
}
