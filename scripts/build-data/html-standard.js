import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { collapse, toText } from './util.js';

const BASE_URL = 'https://html.spec.whatwg.org/multipage/';
const INDEX_URL = `${BASE_URL}indices.html`;
const INTERACTION_URL = `${BASE_URL}interaction.html`;
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { accept: 'text/html' } });
  if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

function tablesAfterHeading($, id) {
  const heading = $(`#${id}`);
  const tables = heading.nextUntil('h3').filter('table').toArray();
  if (!heading.length || !tables.length) throw new Error(`Could not find WHATWG HTML index table #${id}`);
  return tables;
}

function cells($, tr) {
  return $(tr).children('th, td').toArray().map((cell) => collapse($(cell).text()));
}

function elementTags(name) {
  if (/^(svg|mathml)\s+/i.test(name)) return [name.split(/\s+/).at(-1).toLowerCase()];
  if (/custom elements/i.test(name)) return [];
  return name.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

function parseElements($, table) {
  return $(table).find('tbody > tr').toArray().flatMap((tr) => {
    const [name, description, categories, parents, content, attributes, interfaceName] = cells($, tr);
    if (!name || name === 'Element') return [];
    const href = $(tr).children('th, td').first().find('a').attr('href');
    return [{
      name,
      tags: elementTags(name),
      description,
      categories: categories?.split(';').map((x) => x.trim()).filter(Boolean) ?? [],
      parents: parents?.split(';').map((x) => x.trim()).filter(Boolean) ?? [],
      content,
      attributes: attributes?.split(';').map((x) => x.trim()).filter(Boolean) ?? [],
      interface: interfaceName,
      url: href ? new URL(href, INDEX_URL).href : INDEX_URL,
    }];
  });
}

function parseAttributes($, tables) {
  return tables.flatMap((table) => $(table).find('tbody > tr').toArray()).flatMap((tr) => {
    const [name, appliesTo, description, value] = cells($, tr);
    if (!name || name === 'Attribute') return [];
    const targets = appliesTo?.split(';').map((x) => x.trim()).filter(Boolean) ?? [];
    const href = $(tr).children('th, td').first().find('a').attr('href');
    return [{
      name: name.toLowerCase(),
      appliesTo: targets,
      global: targets.some((target) => target.toLowerCase() === 'html elements'),
      description,
      value,
      url: href ? new URL(href, INDEX_URL).href : INDEX_URL,
    }];
  });
}

function addCustomDataAttribute(attributes) {
  if (attributes.some((attribute) => attribute.name === 'data-*')) return;
  attributes.push({
    name: 'data-*',
    appliesTo: ['HTML elements'],
    global: true,
    description: 'Custom data attribute for storing private data or annotations specific to the page or application.',
    value: 'Text',
    url: 'https://html.spec.whatwg.org/multipage/dom.html#custom-data-attribute',
  });
}

function parseFocusRules(html) {
  const $ = cheerio.load(html);
  const heading = $('#the-tabindex-attribute');
  if (!heading.length) throw new Error('Could not find WHATWG HTML tabindex focus rules');
  const content = heading.nextUntil('h4').not('.mdn-anno');
  return {
    title: collapse(heading.text()),
    text: toText($, content),
    url: `${INTERACTION_URL}#the-tabindex-attribute`,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseHtmlStandard({ indexHtml, interactionHtml }) {
  const $ = cheerio.load(indexHtml);
  const [elementsTable] = tablesAfterHeading($, 'elements-3');
  const attributesTables = tablesAfterHeading($, 'attributes-3');
  const attributes = parseAttributes($, attributesTables);
  addCustomDataAttribute(attributes);
  const pageText = collapse($('body').text());
  const lastUpdated = /Living Standard\s*[—-]\s*Last Updated\s+(\d{1,2} \w+ \d{4})/.exec(pageText)?.[1] ?? null;

  return {
    source: {
      name: 'WHATWG HTML Living Standard',
      url: BASE_URL,
      repository: 'https://github.com/whatwg/html',
      lastUpdated,
      indexUrl: INDEX_URL,
      indexDigest: sha256($(elementsTable).html() + attributesTables.map((table) => $(table).html()).join('')),
      focusUrl: `${INTERACTION_URL}#the-tabindex-attribute`,
      focusDigest: sha256(parseFocusRules(interactionHtml).text),
      license: 'CC BY 4.0',
      licenseUrl: LICENSE_URL,
      note: 'Element and attribute data comes from the non-normative index, with the custom data-attribute family added from its normative definition; focus behavior is extracted from the tabindex section.',
    },
    elements: parseElements($, elementsTable),
    attributes,
    focus: parseFocusRules(interactionHtml),
  };
}

export async function buildHtmlStandard() {
  const [indexHtml, interactionHtml] = await Promise.all([fetchHtml(INDEX_URL), fetchHtml(INTERACTION_URL)]);
  return parseHtmlStandard({ indexHtml, interactionHtml });
}