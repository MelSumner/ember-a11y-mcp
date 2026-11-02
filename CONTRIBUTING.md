# Contributing to ember-a11y-mcp

## Setup

```sh
corepack enable        # if pnpm isn't installed (or: npm install -g pnpm)
pnpm install
pnpm test
```

Node.js 22 or later. Some end-to-end suites need Node 24 (see below).

## Rebuilding data

Clone the sources next to this project, then run the build:

```sh
pnpm clone-sources                   # shallow clones at the commits recorded in data/*.json
pnpm build:data                      # or: pnpm build:data --only wcag,hds
```

`pnpm clone-sources --latest` checks out the upstream `main`/`gh-pages` heads instead, `--only aria,wcag` limits the set and `--dir <path>` changes where they go. Existing clones are fetched and checked out in place.

Set `--sources <dir>` or `A11Y_SOURCES_DIR` if the clones are somewhere else. Each data file records the source commit in its `source` field.

## Testing

```sh
pnpm test             # unit suites (test/*.test.js)
pnpm test:coverage    # with v8 coverage for lib/ and index.js
pnpm test:e2e         # end-to-end suites (test/e2e/), run one file at a time
```

- `lint.test.js`: rule behaviour on .hbs, .gjs and .gts input.
- `tools.test.js` and `server.test.js`: tool handlers, plus the MCP server end to end over an in-memory transport.
- `apg-test-spec.test.js`: the test generator's per-pattern spec covers every APG pattern and every role APG lists for it, and uses only valid ARIA 1.2 roles, states and values.
- `cli.test.js`: exit codes, output formats and options for `ember-a11y-lint`.
- `spec-data.test.js`, `apg-data.test.js`, `wcag-data.test.js`, `hds-data.test.js`: checks on the generated data.
- `corpus.test.js`: regression checks against `../aria/validator-tests` (every marked failure detected, with a fixed baseline of misses and false positives) and the HDS component library (errors must match the reviewed true positives). Each corpus is skipped if its clone is missing.

End-to-end suites (`test/e2e/`):

- `stdio.test.js`: starts `node index.js` and talks to it over stdio as an MCP client would, including the audit root's path and symlink containment.
- `package.test.js`: `npm pack`, installs the tarball into a temporary project, then runs both binaries from `node_modules/.bin`.
- `build-data.test.js`: rebuilds `data/` from the source clones into a temp folder and checks that it is identical to the committed data.
- `hds-showcase.test.js`: generates a test file for every case in `showcase-cases.js` through the MCP server, writes them into the HDS showcase's `tests/integration/ember-a11y-mcp-e2e/`, runs `ember test` in headless Chrome and removes them afterwards. Native, ARIA and HDS variants of each pattern must pass every generated check. The deliberately broken cases (`fails`) must fail exactly the checks listed.

- `browser.test.js`: uses Playwright (`playwright-core` with your installed Google Chrome, so no browser download) and Chrome's accessibility tree as an oracle for what this package approximates without a browser:
  - The role selectors, accessible-name and state helpers embedded in generated tests must agree with Chrome's computed roles, names and states for every inline showcase case.
  - The `accessible-name` lint rule must agree with Chrome on 33 naming fixtures, covering every name source and the common ways a name goes missing.
  - Native state readers must report the right value after real keyboard input, which `triggerKeyEvent` can't simulate: `<details>`, checkbox, switch, radio, range, `<select>` typeahead and `showModal()`.

- `focus.test.js`: runs `test-support/focus.js` in Chrome. It checks the default focus ring, removed outlines, replacement indicators (`box-shadow`, `::after`, the label of a hidden checkbox, `:focus-within`), color-only warnings, an element hidden under a fixed header, `:focus-visible` after a mouse click and the tab order.

  Known differences are listed in `browser.test.js`: Chrome reports `<summary>` as `DisclosureTriangle`, and only Safari supports `<input switch>`. Set `PW_CHROME_CHANNEL` to use another Chrome channel for both suites. Each is skipped if Chrome can't be launched.

`hds-showcase.test.js` needs `../design-system` installed (`pnpm install`, then `pnpm build:packages` in `showcase/`), Chrome and Node 24 or later, as HDS requires. Otherwise it is skipped. Set `HDS_SHOWCASE_DIR` to use another checkout, and `HDS_E2E_ONLY=tabs-hds,breadcrumb-native` to run a subset.

## Continuous integration

`.github/workflows/ci.yml` (at the repo root) runs on pushes to `main`, pull requests and on demand:

- `unit`: `pnpm test:coverage` on Node 22 and 24, with the source clones for the corpus tests.
- `e2e`: `pnpm test:e2e` on Node 22, using the runner's Chrome for `browser.test.js`.
- `hds-showcase`: installs and builds `design-system`, then runs `pnpm test:e2e:hds` on Node 24.

`.github/workflows/spec-drift.yml` runs on demand only (the reference clones are refreshed by hand). It clones the latest sources, rebuilds `data/`, and compares it with the committed data (ignoring `source`). If anything changed, it opens an issue labelled `spec-drift`, or comments on the open one. To accept the changes, run `pnpm clone-sources --latest && pnpm build:data`, review the diff and the test results, and commit.
