import * as cheerio from 'cheerio';
import { readSource, commitOf, originUrl, collapse, toText } from './util.js';

const BASE_URL = 'https://www.w3.org/TR/html-aam-1.0/';
const SOURCE_PATH = 'html-aam/index.html';

function parseRows($, table) {
  const rows = [];
  $(table)
    .find('tr')
    .each((_, tr) => {
      const cells = $(tr).children('th, td').toArray();
      if (cells.length < 2) return;
      rows.push({
        label: collapse($(cells[0]).text()).replace(/^\[\[|\]\]$/g, ''),
        value: toText($, cells[1]),
      });
    });
  return rows;
}

function mappingEntry($, heading, table, kind) {
  const rows = parseRows($, table);
  const spec = rows.find((row) => row.label === 'HTML Specification')?.value ?? '';
  const title = collapse($(heading).text()) || spec;
  const nameSource = kind === 'element' ? spec : title;
  const name = /`([^`]+)`/.exec(nameSource)?.[1]?.trim().toLowerCase() ?? collapse(spec.replace(/`/g, '') || title).toLowerCase();
  const id = $(heading).attr('id');
  return {
    name,
    title,
    rows,
    url: id ? `${BASE_URL}#${id}` : BASE_URL,
  };
}

export function buildHtmlAam({ sourceDir }) {
  const html = readSource(sourceDir, SOURCE_PATH);
  const $ = cheerio.load(html);
  const elementMappings = [];
  const attributeMappings = [];
  const nameComputations = [];
  let section = '';
  let heading = null;

  $('h3, h4, table.data').each((_, node) => {
    const tag = node.tagName.toLowerCase();
    if (tag === 'h3') {
      section = collapse($(node).text());
      heading = null;
      if (section === 'Accessible Description Computation') {
        const content = $(node).closest('section');
        nameComputations.push({
          name: 'description',
          title: section,
          text: toText($, content),
          url: $(node).attr('id') ? `${BASE_URL}#${$(node).attr('id')}` : BASE_URL,
        });
      }
    } else if (tag === 'h4') {
      heading = node;
      if (section === 'Accessible Name Computations By HTML Element') {
        const id = $(node).attr('id');
        nameComputations.push({
          name: [...$(node).text().matchAll(/`([^`]+)`/g)].map((match) => match[1].toLowerCase()),
          title: collapse($(node).text()),
            text: toText($, $(node).closest('section')).replace(/\n-\n/g, '\n- '),
          url: id ? `${BASE_URL}#${id}` : BASE_URL,
        });
      }
    } else if (heading && section === 'HTML Element Role Mappings') {
      elementMappings.push(mappingEntry($, heading, node, 'element'));
    } else if (heading && section === 'HTML Attribute State and Property Mappings') {
      attributeMappings.push(mappingEntry($, heading, node, 'attribute'));
    }
  });

  return {
    source: {
      name: 'HTML Accessibility API Mappings',
      version: '1.0',
      url: BASE_URL,
      repo: originUrl(sourceDir),
      path: SOURCE_PATH,
      commit: commitOf(sourceDir),
      status: 'W3C Working Draft',
      license: 'W3C Software and Document License',
      licenseUrl: 'https://www.w3.org/copyright/software-license-2023/',
    },
    elementMappings,
    attributeMappings,
    nameComputations,
  };
}