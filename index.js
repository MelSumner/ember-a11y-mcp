#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as tools from './lib/tools.js';
import { emberGeneral } from './lib/ember-guidance.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export function createServer() {
  const server = new McpServer({ name: 'ember-a11y-mcp', version: pkg.version }, {
    instructions: 'Recommended first step in an Ember project: run audit_project_setup to check that a11y linting and testing are installed and configured, then audit templates with audit_ember_template. Use list_a11y_todos to find a11y violations hidden as lint todos. Before judging or changing a component, route or helper, call get_related_files to see what the code intends: its class and template, imports (utilities, helpers, shared abstractions), invoked components, styles, tests and where it is used. Use the lookup tools (WCAG, ARIA, APG, HDS examples) while building components.',
  });
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  const safe = (fn) => async (args) => {
    try {
      return text(fn(args ?? {}));
    } catch (e) {
      return { ...text(`Error: ${e.message}`), isError: true };
    }
  };
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool('get_aria_role', {
    title: 'Get WAI-ARIA 1.2 role',
    description: 'Look up a WAI-ARIA 1.2 role (incl. DPUB/Graphics): required/supported/prohibited attributes, required context and owned elements, naming rules, native HTML equivalents and the related APG pattern.',
    inputSchema: { role: z.string().describe('Role name, e.g. "tab", "combobox", "doc-chapter"') },
    annotations: readOnly,
  }, safe(tools.getAriaRole));

  server.registerTool('get_aria_attribute', {
    title: 'Get WAI-ARIA 1.2 state/property',
    description: 'Look up an aria-* attribute: value type, allowed values and default, global or role-specific, roles that use it, and the native HTML attribute to prefer.',
    inputSchema: { attribute: z.string().describe('e.g. "aria-expanded"') },
    annotations: readOnly,
  }, safe(tools.getAriaAttribute));

  server.registerTool('get_html_element_rules', {
    title: 'ARIA in HTML rules for an element',
    description: 'What ARIA in HTML allows on an HTML element: implicit role, allowed roles, which aria-* attributes may be used, and MUST NOT / SHOULD NOT rules.',
    inputSchema: { element: z.string().describe('Tag, optionally with type, e.g. "input type=checkbox", "a", "section"') },
    annotations: readOnly,
  }, safe(tools.getHtmlElementRules));

  server.registerTool('list_apg_patterns', {
    title: 'List APG patterns',
    description: 'List all WAI-ARIA Authoring Practices Guide patterns and practice guides, with native HTML alternatives.',
    inputSchema: {},
    annotations: readOnly,
  }, safe(tools.listApgPatterns));

  server.registerTool('get_apg_pattern', {
    title: 'Get APG pattern with Ember guidance',
    description: 'Get an APG pattern (or practice guide such as "keyboard-interface", "names-and-descriptions"): description, keyboard interaction, roles/states/properties, native-HTML-first advice, Ember implementation notes, and examples.',
    inputSchema: {
      pattern: z.string().describe('Pattern id (e.g. "tabs", "dialog-modal", "combobox") or practice id'),
      includeExamples: z.boolean().optional(),
    },
    annotations: readOnly,
  }, safe(tools.getApgPattern));

  server.registerTool('get_apg_example', {
    title: 'Get APG example details',
    description: 'Get an APG example: accessibility features, keyboard support table and roles/states/properties table.',
    inputSchema: { example: z.string().describe('Example id, e.g. "tabs-automatic", "combobox-autocomplete-list"') },
    annotations: readOnly,
  }, safe(tools.getApgExample));

  server.registerTool('get_ember_example', {
    title: 'Get Ember reference implementation',
    description: 'Real-world Ember (.gts) accessibility examples from the HashiCorp Helios Design System: usage snippets, accessibility docs (conformance rating, keyboard support, WCAG criteria, known issues) and component implementation source. Call with no arguments to list components, or pass an APG `pattern` to get the matching component.',
    inputSchema: {
      component: z.string().optional().describe('HDS doc id or name, e.g. "components/tabs", "modal", "super-select"'),
      pattern: z.string().optional().describe('APG pattern id, e.g. "tabs", "dialog-modal", "combobox"'),
      kind: z.enum(['usage', 'accessibility', 'implementation']).optional().describe('usage snippets (default), accessibility docs, or implementation source'),
      file: z.string().optional().describe('Filter to a snippet name or source file, e.g. "tab.gts"'),
      maxChars: z.number().int().min(1000).max(60000).optional(),
    },
    annotations: readOnly,
  }, safe(tools.getEmberExample));

  server.registerTool('get_wcag_criterion', {
    title: 'Get WCAG 2.2 success criterion',
    description: 'Get a WCAG 2.2 success criterion: normative text, level, Understanding (brief, intent, benefits), Ember-specific guidance, how to verify it (ember-a11y-lint rules, axe, ACT rules, manual steps), sufficient techniques and common failures.',
    inputSchema: {
      criterion: z.string().describe('SC number, id or title, e.g. "1.4.3", "target-size-minimum", "Focus Visible"'),
      includeTechniques: z.boolean().optional(),
    },
    annotations: readOnly,
  }, safe(tools.getWcagCriterion));

  server.registerTool('list_wcag_criteria', {
    title: 'List WCAG 2.2 success criteria',
    description: 'List WCAG 2.2 success criteria up to a conformance level (default AA) with automated-coverage columns. Use it as a conformance checklist.',
    inputSchema: {
      level: z.enum(['A', 'AA', 'AAA']).optional(),
      version: z.enum(['2.0', '2.1', '2.2']).optional().describe('Only criteria added in this WCAG version'),
      principle: z.enum(['1', '2', '3', '4']).optional(),
    },
    annotations: readOnly,
  }, safe(tools.listWcagCriteria));

  server.registerTool('get_wcag_technique', {
    title: 'Get WCAG technique or failure',
    description: 'Get a WCAG 2.2 technique (e.g. ARIA14, H44, G108) or failure (e.g. F65): description, examples and test procedure.',
    inputSchema: { technique: z.string().describe('Technique id, e.g. "ARIA14", "F65"') },
    annotations: readOnly,
  }, safe(tools.getWcagTechnique));

  server.registerTool('search_a11y_guidance', {
    title: 'Search accessibility guidance',
    description: 'Full-text search across WCAG 2.2 criteria and techniques, ARIA 1.2 roles/attributes, ARIA in HTML, APG patterns and practices, Ember guidance, HDS Ember reference components and lint rules.',
    inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    annotations: readOnly,
  }, safe(tools.searchGuidance));

  server.registerTool('audit_project_setup', {
    title: 'Audit project accessibility setup (recommended first step)',
    description: 'Recommended first step for an Ember app or addon. Read-only check that a11y tooling is installed and configured: ember-template-lint, ember-a11y-testing, @ember/test-helpers, eslint-plugin-ember and ember-a11y-lint as devDependencies; template-lint extends "recommended" with no a11y rules turned off or downgraded; inline a11y rule disables in templates; a11y violations deferred as lint todos (.lint-todo); setupGlobalA11yHooks in the test helper and disabled axe rules; which routes in app/router are visited by an acceptance test that runs axe; and lint scripts. Returns pass/warn/fail checks with fixes. Changes nothing.',
    inputSchema: {
      path: z.string().optional().describe('App or addon directory relative to the project root (default "."). For monorepos, the tool lists Ember packages to choose from.'),
    },
    annotations: readOnly,
  }, async (args) => {
    try {
      const { text: t, project, checks, summary } = tools.auditProjectSetup(args ?? {});
      return { content: [{ type: 'text', text: t }], structuredContent: { project, summary, checks } };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });

  server.registerTool('list_a11y_todos', {
    title: 'List deferred a11y lint todos',
    description: 'List accessibility violations that a project deferred with ember-template-lint or eslint todos (the .lint-todo file written by `--update-todo`). These are hidden from lint output until their warn/error decay dates. Covers the template-lint a11y rules and their eslint-plugin-ember `ember/template-*` equivalents. Shows file, line, rule, status (hidden, past warn or error date) and due date, grouped by file with rule docs links.',
    inputSchema: {
      path: z.string().optional().describe('App or addon directory relative to the project root (default "."); the nearest .lint-todo at or above it is used'),
      rule: z.string().optional().describe('Only this rule, e.g. "require-input-label" or "ember/template-require-input-label"'),
      file: z.string().optional().describe('Only this file or directory (root-relative), e.g. "frontend/app/components/nav"'),
      status: z.enum(['todo', 'warn', 'error', 'past-due', 'no-due-date']).optional().describe('todo = still hidden; warn/error = past that decay date; past-due = warn or error'),
    },
    annotations: readOnly,
  }, async (args) => {
    try {
      const { text: t, todos, summary } = tools.listA11yTodos(args ?? {});
      return { content: [{ type: 'text', text: t }], structuredContent: { summary, todos } };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });

  server.registerTool('get_related_files', {
    title: 'Get files related to an Ember source file',
    description: 'Read-only. Given a component, route, controller, helper, modifier, util or service file, list the files that explain what it is meant to do: the rest of its unit (template and class, route/controller/route template, addon re-export), the modules it imports (resolved through the app module prefix, in-repo addons and workspace packages, optionally several levels deep), components and helpers invoked in its .hbs template, style files named after it or defining its class names, its tests, and the files that import or invoke it. Use it before judging lint findings or proposing fixes.',
    inputSchema: {
      path: z.string().describe('File relative to the project root, e.g. "app/components/user-menu.hbs"'),
      depth: z.number().int().min(1).max(3).optional().describe('How many levels of imports to follow (default 1)'),
    },
    annotations: readOnly,
  }, async (args) => {
    try {
      const { text: t, file, unit, related, external, unresolved } = tools.getRelatedFiles(args ?? {});
      return { content: [{ type: 'text', text: t }], structuredContent: { file, unit, related, external, unresolved } };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });

  server.registerTool('audit_ember_template', {
    title: 'Audit Ember template accessibility',
    description: 'Lint Ember templates (.hbs/.gjs/.gts) against WAI-ARIA 1.2 and ARIA in HTML: invalid roles/attributes/values, required and prohibited attributes, allowed roles per element, accessible names, keyboard access for click handlers, aria-hidden focus traps, required context/owned elements, and more. Pass inline `source` or a `path` (file or directory) inside the project root. For paths, results also list a11y violations deferred in .lint-todo for the audited files.',
    inputSchema: {
      source: z.string().optional().describe('Template source (hbs, or a full .gjs/.gts module)'),
      filename: z.string().optional().describe('Filename hint for `source`, e.g. "my-button.gjs"'),
      path: z.string().optional().describe('File or directory relative to the project root'),
      minSeverity: z.enum(['error', 'warning', 'info']).optional(),
    },
    annotations: readOnly,
  }, async (args) => {
    try {
      const { text: t, findings, todos } = tools.auditEmberTemplate(args);
      return { content: [{ type: 'text', text: t }], structuredContent: { findings, todos: todos ?? [] } };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });

  server.registerTool('generate_ember_a11y_tests', {
    title: 'Generate Ember accessibility tests',
    description:
      'Scaffold a QUnit rendering test (.gjs) for a component implementing an APG pattern: axe audit via ember-a11y-testing, APG role/state/name checks and one keyboard test per APG key. ' +
      'The checks accept every conformant variant: native elements or explicit roles (<button> or role="button"), ARIA states or native equivalents (checked, disabled, details[open], dialog:modal), any accessible-name source, and roles APG makes optional or alternative.',
    inputSchema: {
      pattern: z.string().optional().describe('APG pattern id, e.g. "tabs"'),
      example: z.string().optional().describe('APG example id for more specific tables, e.g. "tabs-manual"'),
      componentName: z.string().optional().describe('Component class name, e.g. "TabList" or "HdsTabs"'),
      importPath: z.string().optional().describe('Module to import the component from, e.g. "my-app/components/tab-list" or "@hashicorp/design-system-components/components"'),
      namedExport: z.boolean().optional().describe('Import the component as a named export ({ HdsTabs }) instead of the default export'),
      invocation: z.string().optional().describe('Template to render, with the args and blocks the component needs, e.g. "<HdsTabs as |T|>…</HdsTabs>". Defaults to <ComponentName />.'),
      selector: z.string().optional().describe('Root selector for the component in tests (default [data-test-<pattern>])'),
      setupImport: z.string().optional().describe('Module providing setupRenderingTest, e.g. "my-app/tests/helpers" (default "ember-qunit")'),
    },
    annotations: readOnly,
  }, safe(tools.generateEmberA11yTests));

  server.registerResource('ember-a11y-guide', 'ember-a11y://guide', {
    title: 'Ember accessibility essentials',
    description: 'Ember-specific accessibility guidance (routing focus, unique ids, events, testing).',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: emberGeneral.map((g) => `## ${g.topic}\n${g.text}`).join('\n\n') }],
  }));

  server.registerPrompt('check_a11y_setup', {
    title: 'Check accessibility setup (start here)',
    description: 'Recommended first step: audit an Ember project\'s a11y linting and testing setup and get a prioritized fix list.',
    argsSchema: {
      path: z.string().optional().describe('App or addon directory relative to the project root (default ".")'),
    },
  }, ({ path }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Check this Ember project's accessibility tooling setup.

1. Call audit_project_setup(${path ? `{ path: "${path}" }` : ''}). If it reports that the directory isn't an Ember package and lists candidates, ask me which one to use and run it again.
2. Summarize the failing checks first, then the warnings, as a short prioritized fix list using the fixes the tool returns.
3. Don't install packages or edit files until I confirm. When I do, make one change at a time and re-run audit_project_setup to verify it.
4. Once the setup passes, suggest running audit_ember_template on app/components and app/templates.`,
      },
    }],
  }));

  server.registerPrompt('build_accessible_component', {
    title: 'Build an accessible Ember component',
    description: 'Guide the model through building an Ember component that follows an APG pattern and passes the audit.',
    argsSchema: {
      pattern: z.string().describe('APG pattern id, e.g. "tabs"'),
      requirements: z.string().optional().describe('What the component needs to do'),
    },
  }, ({ pattern, requirements }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Build an accessible Ember (Glimmer, .gjs) component implementing the APG "${pattern}" pattern.${requirements ? `\nRequirements: ${requirements}` : ''}

Process:
1. Call get_apg_pattern("${pattern}"). If a native HTML element satisfies the requirements, use it and stop adding ARIA.
2. Call get_ember_example({ pattern: "${pattern}", kind: "accessibility" }) and, if useful, kind "implementation" to study a production Ember implementation (HashiCorp Helios). If the app already uses that design system, prefer its component.
3. Implement with tracked state, {{on}} modifiers, {{unique-id}} for ids, ...attributes on the primary interactive element, and keyboard handling exactly per the APG keyboard table.
4. Call audit_ember_template with the component source and fix every error and warning.
5. Call generate_ember_a11y_tests("${pattern}") and complete the TODOs.
6. For each WCAG 2.2 A/AA criterion the component touches (at least 1.3.1, 1.4.11, 2.1.1, 2.4.3, 2.4.7, 4.1.2), call get_wcag_criterion and list what still needs manual verification (screen reader announcements, focus visibility, contrast, zoom/reflow).`,
      },
    }],
  }));

  return server;
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
