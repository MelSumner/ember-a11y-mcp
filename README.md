# ember-a11y-mcp

Accessibility help for Ember.js apps, built on the W3C specs. It has two parts:

- **An [MCP](https://modelcontextprotocol.io) server** for AI coding agents (GitHub Copilot, Claude and others). Your agent can check your project's accessibility setup, audit templates, look up WCAG, ARIA and APG guidance, and generate accessibility tests.
- **`ember-a11y-lint`**, a command-line linter for `.hbs`, `.gjs` and `.gts` templates. Every finding links to the spec and WCAG criterion behind it and, where possible, shows a fix.

Runtime lookups run locally and offline. The guidance is pre-extracted from WCAG 2.2, WAI-ARIA 1.2, the WHATWG HTML Living Standard, HTML-AAM 1.0, ARIA in HTML, the ARIA Authoring Practices Guide (APG) and the [Helios Design System](https://helios.hashicorp.design) (HDS) Ember components, plus Ember-specific guidance. Refreshing the HTML Standard snapshot requires network access.
| `get_html_aam_mapping` | HTML-AAM element and attribute mappings to WAI-ARIA, computed roles and platform accessibility APIs, plus HTML accessible-name/description computations |
| `get_html_element_info` | WHATWG HTML element definition, applicable global/element-specific content attributes, direct attribute validity checks, and focus/`tabindex` rules |

> Automated checks find only some accessibility issues. Keep testing with a keyboard, a screen reader, zoom and contrast tools. This tool's output is not a conformance determination.

## Quick start

### 1. Check the prerequisites

- Node.js 22 or later (`node --version`).
- npm (included with Node.js); pnpm is optional for the project-install step below.

### 2. Connect it to your agent

The MCP runs through `npx`; no repository clone or project dependency is required. Set `EMBER_A11Y_ROOT` to the Ember app (or monorepo) it may read. It can't read files outside that directory. If omitted, the server uses its working directory.

**VS Code (GitHub Copilot):** create `.vscode/mcp.json` in your Ember app:

```json
{
  "servers": {
    "ember-a11y": {
      "command": "npx",
      "args": ["--yes", "--package=ember-a11y-mcp", "ember-a11y-mcp"],
      "env": { "EMBER_A11Y_ROOT": "${workspaceFolder}" }
    }
  }
}
```

**GitHub Copilot CLI:** add this to `~/.copilot/mcp-config.json`, or to `.mcp.json` at the root of your app (or run `/mcp add` in the CLI):

```json
{
  "mcpServers": {
    "ember-a11y": {
      "type": "local",
      "command": "npx",
      "args": ["--yes", "--package=ember-a11y-mcp", "ember-a11y-mcp"],
      "env": { "EMBER_A11Y_ROOT": "/path/to/your-ember-app" },
      "tools": ["*"]
    }
  }
}
```

**Other MCP clients** (Claude Desktop, Claude Code, Cursor and so on): use the same `command`, `args` and `env` in that client's MCP configuration. Most use an `mcpServers` object.

### 3. Try it

Open your Ember app and ask your agent, for example:

1. "Use ember-a11y to check this project's accessibility setup." This runs `audit_project_setup`, a read-only check of your lint and test configuration. Start here.
2. "Audit `app/components/user-menu.hbs` for accessibility issues." This runs `audit_ember_template`.
3. "Which ARIA pattern should a tabs component follow, and what keyboard support does it need?"
4. "Generate an accessibility test for my disclosure component."

To confirm it's connected, check that the agent's reply comes from an `ember-a11y` tool call. Many clients can also invoke the `check_a11y_setup` prompt directly.

### 4. Optional: add it to your app

Install the package as a devDependency to run the linter from your app's scripts or use the [focus visibility test helper](#focus-visibility-test-helper):

```sh
pnpm add -D ember-a11y-mcp
pnpm exec ember-a11y-lint app
```

With npm:

```sh
npm install --save-dev ember-a11y-mcp
npx ember-a11y-lint app
```

## Using the CLI linter

Run it from your app's root after step 4. Without installing the package, run it with `npx --yes --package=ember-a11y-mcp ember-a11y-lint app`.

```sh
pnpm exec ember-a11y-lint app/components            # errors and warnings, human-readable
pnpm exec ember-a11y-lint app --format json --min-severity info
pnpm exec ember-a11y-lint app --rule no-autofocus=off --rule prefer-native-element=warning
pnpm exec ember-a11y-lint --list-rules
pnpm exec ember-a11y-lint app --fix                 # apply safe fixes, then report the rest
```

Every finding has a `help` hint and, where one can be built from your code, a `fix` with `before` and `after` text. It's shown as `- before` / `+ after` in the CLI, as a diff in `audit_ember_template` and as a `fix` object in JSON.

`--fix` applies only fixes that can't change meaning: typo'd roles and `aria-*` names ("Did you mean…"), lowercased token values, redundant or deprecated roles and attributes, and `tabindex` greater than 0. Anything that needs judgement (labels, alt text, restructuring, `aria-hidden`, autofocus) stays a suggestion. Commit or stash first so you can review the diff.

Exit codes: `0` clean, `1` errors (or too many warnings with `--max-warnings`), `2` bad arguments or nothing to lint. A file that can't be parsed is reported as a `parse-error` finding. An unexpected linter failure on one file is reported as `internal-error`, and the other files are still linted.

To lint in CI, add a script such as `"lint:a11y": "ember-a11y-lint app"` to your app's package.json.

### Inline disables

```hbs
{{! ember-a11y-disable-next-line accessible-name }}
<button {{on "click" this.close}}><Icon @name="x" /></button>

{{! ember-a11y-disable no-autofocus }}
<input autofocus aria-label="Search" />
{{! ember-a11y-enable no-autofocus }}
```

Disables are scoped the way ember-template-lint scopes `template-lint-disable`. At the top level or inside a `{{#block}}`, `ember-a11y-disable` lasts until the matching `ember-a11y-enable` (a bare enable closes every open disable) or the end of the file. Inside an element's body, it also ends when that element closes. Inside an opening tag (`<li {{! ember-a11y-disable rule }} …>`) it covers only that element, and `ember-a11y-disable-tree` covers the element and its descendants. A disable with no matching enable is reported as an `unmatched-disable` warning that says how far it reaches, even when its element closes it; opening-tag disables don't need one.

## Focus visibility test helper

axe doesn't test 2.4.7 Focus Visible, and template lint can't see CSS. `ember-a11y-mcp/test-support/focus.js` checks it in your browser tests, with no keyboard needed:

```js
import { a11yFocusAudit, assertFocusVisible } from 'ember-a11y-mcp/test-support/focus.js';

test('settings page shows focus', async function (assert) {
  await visit('/settings');
  const { warnings } = await a11yFocusAudit(); // throws on failures
  assert.deepEqual(warnings, []);
  await assertFocusVisible('[data-test-save]');
});
```

`a11yFocusAudit({ root, exclude, strict })` focuses each tabbable element under `root` (default `#ember-testing`) in tab order. For each one, it compares computed styles before and after focus, with transitions turned off. It looks at the element, its `::before` and `::after` (and `::file-selector-button` on file inputs), its labels, its next sibling, its `aria-activedescendant` target and up to three ancestors (`:focus-within`). It throws when:

- nothing visible changes (2.4.7), for example when an outline is removed with no replacement
- the focused element is completely covered, for example by a sticky header, or is outside the viewport (2.4.11)

Changes to only color, background color, weight, opacity, transform or filter are returned as `warnings`, because they need a 3:1 contrast check (1.4.11). Pass `strict: true` to make them fail. Elements that disappear while the audit runs, such as a menu that closes on `focusout`, are skipped as they would be with Tab. iframes are left out, so audit their content separately. Lower-level functions are `auditFocusVisible` (returns `results`, `skipped`, `failures` and `warnings`), `focusIndicator` and `tabbableElements`.

It can't measure contrast or size, as a screenshot comparison could, and it can't see indicators drawn on unrelated elements, so a person should still check a sample with the keyboard. Ember apps import it through ember-auto-import or Embroider, with `ember-a11y-mcp` installed as a devDependency ([step 4](#4-optional-add-it-to-your-app)).

## Reference

### Tools

| Tool | Purpose |
|---|---|
| `audit_project_setup` | **Start here.** Read-only check of a11y packages, template-lint and ember-a11y-testing config, inline disables, deferred lint todos and route test coverage |
| `get_related_files` | Files that explain what a source file is for: its class/template or route family, imports (several levels), invoked components and helpers, styles, tests and the files that use it |
| `list_a11y_todos` | A11y violations deferred as ember-template-lint or eslint todos (`.lint-todo`), filterable by rule, file and status (hidden, past warn or error date, no due date) |
| `get_wcag_criterion` | WCAG 2.2 SC text, Understanding (brief, intent, benefits), Ember guidance, how to verify (lint rules, axe, ACT rules, manual), techniques and failures |
| `list_wcag_criteria` | A/AA/AAA checklist with automated-coverage columns |
| `get_wcag_technique` | Technique or failure (e.g. `ARIA14`, `H44`, `F65`): description, examples, test procedure |
| `get_aria_role` | ARIA 1.2 role: superclass, required context and owned elements, required, supported and prohibited attributes, name from |
| `get_aria_attribute` | ARIA 1.2 attribute: value type, allowed values, default, roles that use it |
| `get_html_element_rules` | ARIA in HTML rules for an element: implicit role, allowed roles and allowed `aria-*` |
| `list_apg_patterns` | All APG patterns and practices |
| `get_apg_pattern` | APG pattern keyboard and ARIA tables, the native HTML alternative, Ember notes and HDS reference components |
| `get_apg_example` | Keyboard and attribute tables for a specific APG example |
| `get_ember_example` | HDS Ember code: usage snippets, accessibility docs (conformance, keyboard, WCAG), or implementation source |
| `search_a11y_guidance` | Full-text search over all of the above |
| `audit_ember_template` | Lint `.hbs`/`.gjs`/`.gts` source or files (results also returned as `structuredContent`). For paths, it also lists a11y lint todos hidden in those files |
| `generate_ember_a11y_tests` | Scaffold a QUnit `.gjs` rendering test: `a11yAudit`, role and attribute asserts, one keyboard test per APG key |

The server also provides the resource `ember-a11y://guide` (Ember accessibility essentials) and two prompts: `check_a11y_setup` (start here) and `build_accessible_component`.

### Project setup audit

`audit_project_setup` (or the `check_a11y_setup` prompt) is read-only. It checks that:

- `ember-template-lint`, `ember-a11y-testing`, `@ember/test-helpers` and `eslint-plugin-ember` are devDependencies.
- `.template-lintrc` extends `recommended` and doesn't turn off or downgrade any a11y rule. Commented-out rules are ignored. Rules in `overrides` are reported with their `files` scope: as info when every glob is under `tests/`, otherwise as a warning.
- Templates have no inline a11y rule disables (`template-lint-disable`, `ember-a11y-disable`, with or without quoted rule names), and every `-disable` has a matching `-enable`. Otherwise it silently applies to the rest of the file, or of the enclosing element. Disables inside an opening tag are scoped to that element and don't need one.
- No a11y violations are deferred as lint todos in `.lint-todo`, and a11y todos have due dates (todo decay isn't turned off).
- The test helper calls `setupGlobalA11yHooks`, and tests don't disable axe rules in `rules: { … }` run options.
- Each route in `app/router` is visited by an acceptance test that runs axe, including the routes of mounted Ember engines (`this.mount`, read from the engine's `addon/routes.js`). See [route coverage](#route-coverage) below.
- A package.json script runs `ember-template-lint` (and, optionally, `ember-a11y-lint`).

Each check is pass, warn, fail or info, with a fix. Results are also returned as `structuredContent`. Lists longer than 25 entries end with "…and N more", and the check's `count` has the full number. Next steps use paths relative to the server root and the package's source directory (`app`, `src` for v2 addons, or `addon`). The `ember-a11y-lint` step uses the installed package's `bin/ember-a11y-lint.js`. HTML Validate checks are left out for now.

**Monorepos and addons:**

- At a monorepo root, it lists the Ember apps, engines and addons with UI so you can pass `path`. It finds them from `pnpm-workspace.yaml` or package.json `workspaces`, otherwise with a shallow search. Build-only addons are left out.
- An addon without its own `tests/test-helper`, whose tests live in a workspace app that depends on it (or in the host app of an in-repo addon), gets an info pointing at that app instead of failures for ember-a11y-testing.
- For an app, it lists in-repo addons (`ember-addon.paths`) as has UI, build-only or engine, and also scans the templates of in-repo addons that live outside the app directory.

#### Route coverage

A test counts when it calls `a11yAudit` (or the test helper calls `setupGlobalA11yHooks`) and passes a URL literal to `visit` or a `visitXxx` helper such as `visitWithRedirect`, directly or through a variable initialised with one. Page objects count too: URLs in `visitable('/x/:id')`, or in `visit` calls inside the page object, are covered when such a test imports that page object (whether or not it calls its `visit`). Routes are parsed statically, so treat the result as a guide.

### A11y lint todos

ember-template-lint's [todos](https://github.com/ember-template-lint/ember-template-lint/blob/main/docs/todos.md) (`--update-todo`), and eslint's through `@lint-todo/eslint-formatter-todo`, hide existing violations from lint output until their warn/error dates. That's useful for rolling out rules, but an a11y todo is a known barrier that nobody sees. The server reads `.lint-todo` (never `.lint-todorc.js` as code) and reports todos for the template-lint a11y rules and their `ember/template-*` eslint equivalents in three places: a summary in `audit_project_setup`, the full list in `list_a11y_todos`, and per file in `audit_ember_template`.

### Related files

A template rarely tells the whole story. `get_related_files` gathers the files that show what a component, route, helper or util is meant to do, so findings and fixes can take them into account:

- The rest of its unit: template and class; route, controller and route template; a classic addon's `app/` re-export.
- What it imports, including utilities, helpers and other shared abstractions. Imports are resolved through the app's module prefix, in-repo addons and workspace packages, up to 3 levels deep (`depth`). Other packages are listed by name.
- Components and dashed helpers or modifiers invoked in its `.hbs` template. `.gjs`/`.gts` templates are covered by their imports.
- Style files named after the component, or that define its static class names.
- Its tests, including tests in another workspace app (for example an addon's test app).
- The files that import or invoke it.

It reads files only and runs nothing. Pods and classic `app/templates/components/` layouts are not supported.

### Rules

All rules come from the specs, and each finding links to the governing spec section and WCAG criterion. Rules skip anything they can't determine statically (dynamic values, component invocations, yields), so they don't guess.

| Rule | WCAG |
|---|---|
| `no-invalid-role`, `no-deprecated-role`, `no-invalid-aria-attribute`, `aria-attribute-value`, `no-deprecated-aria-attribute` | 4.1.2 |
| `aria-role-attributes` (prohibited or unsupported for the role), `aria-required-attributes` | 4.1.2 |
| `html-aria-allowed-role`, `html-aria-no-aria-attributes`, `html-aria-attribute-rules`, `native-aria-conflict` | 4.1.2 |
| `no-aria-hidden-on-focusable`, `presentation-role-conflict` | 4.1.2, 1.3.1 |
| `accessible-name` | 4.1.2, 1.1.1, 2.4.4, 3.3.2 |
| `aria-required-context`, `aria-required-owned` | 1.3.1 |
| `keyboard-accessible-click`, `no-nested-interactive` | 2.1.1, 4.1.2 |
| `no-positive-tabindex`, `no-noninteractive-tabindex`, `no-autofocus` | 2.4.3 |
| `no-duplicate-id`, `aria-idref-exists`, `prefer-unique-id` | 1.3.1, 4.1.2 |
| `prefer-native-element` (info) | 4.1.2 |
| `destructive-action-confirmation` | 3.3.4, 3.3.6 |

`destructive-action-confirmation` flags controls that permanently destroy data or state (delete, purge, revoke, "dismiss permanently", "don't show again", and HDS `@color="critical"`) when there is no step where the user confirms the action. It reads the component's JavaScript (the `.gjs`/`.gts` class or a co-located `.js`/`.ts` for `.hbs`; for a route template, its controller) and accepts any of these:

- **Modal confirmation:** the control is inside a `<dialog>`, a `role="dialog"`/`"alertdialog"` element or a `*Modal`/`*Dialog` component (e.g. `<HdsModal>`), or its handler opens one (`showModal()`, `this.showDeleteModal = true`).
- **Inline confirmation:** the control is rendered by `{{#if this.isConfirming}}…`, or its handler sets state that the template branches on.
- **Native confirm:** `window.confirm()` in the handler.
- **Confirm-named handler:** for example `confirmDelete`, `askToRemove`, `requestDeletion` or `openDeleteModal`.
- **Undo:** the handler offers undo or restore, so the action isn't permanent.

Links (`<a href>`, `<LinkTo>`) to a confirmation page are never flagged. Handlers passed in by the caller (`@onDelete`), handlers yielded by an enclosing component (`CF.delete`) and row removal inside a form that hasn't been submitted are reported as `info`.

`aria-description` is always allowed, on any element. Other ARIA 1.3 roles and attributes (e.g. `role="mark"`, `aria-braillelabel`) are reported as warnings rather than errors.

## Limitations

- The MCP template audit and CLI linter don't measure rendered color contrast. The tests scaffolded by `generate_ember_a11y_tests` already call `a11yAudit()` from `ember-a11y-testing`, which uses axe to catch some text contrast failures (WCAG 1.4.3). Run the audit in a browser with your app's styles loaded for each relevant theme and interaction state. Manually check cases axe can't reliably assess, such as text over images or gradients, and non-text contrast such as focus indicators (WCAG 1.4.11).
- Focus visibility, reflow, motion, timing and content quality cannot be checked from templates. For focus visibility, use the [test helper](#focus-visibility-test-helper). `get_wcag_criterion` lists manual verification steps.
- For `no-nested-interactive` in Ember named blocks (such as `<:editLink>`), audit the template by path so the linter can resolve local component templates and check where `{{yield to="editLink"}}` renders. A possible nesting it cannot verify (for example, with an external component or a dynamic yield) is reported as informational; verify it in the rendered DOM.
- HDS code is a reference for patterns. Prefer your own design system's components where they exist.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for rebuilding the bundled data, running the tests and CI.

## License

MIT for this project's code. The bundled data and excerpts keep their original licenses; see [NOTICE.md](NOTICE.md).
