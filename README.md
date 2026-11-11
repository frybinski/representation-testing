# repr-werkbank

A workbench for process model representations. It reads a process model
(BPMN 2.0 XML or PNML), turns it into several text representations (original,
original without layout, Mermaid, JSON, compact notation, verbalisation, SVG diagram) and
reports which facts of the model each representation carries.

The project belongs to a doctoral thesis at KIT (Fabian Rybinski). Correctness
matters more than coverage: an element that is not supported is reported, never
silently dropped or misrepresented.

**Status: milestone M2 (stages E to G) complete.** The core library has the model, the BPMN and PNML
parsers, the generators and readers (including the SVG diagram), combinations and the prompt block, the inventory, the structure
report with soundness check and metrics, the tokenizer, the figures per text and the export bundle. `packages/cli` writes one bundle
per model file. `packages/web` is the web interface (details below); `docs/acceptance-m2.md` names the test of every acceptance point.

## Layout

| Path | Content |
| --- | --- |
| `packages/core` | Library `@repr-werkbank/core`: XML reading, model, facts, BPMN and PNML parsers, format detection. Runs under Node and in a browser bundle (no DOM, no network). |
| `packages/cli` | Command line tool `@repr-werkbank/cli`: file access, arguments, messages; all content from the core (`docs/cli.md`). |
| `packages/web` | Web interface `@repr-werkbank/web` (Vite, no framework): worker, two views, lower area, pages, browser tests in `e2e/`. |
| `.github/workflows` | `ci.yml` (checks and browser tests) and `pages.yml` (publishes the page). |
| `CITATION.cff` | How to cite the tool. |
| `docs/` | `model.md` (model, facts, notices), `model.schema.json` (JSON Schema of the model), `pnml-pm4py-dialect.md` (sources checked), `generators.md` (register, combination, inventory) `structure-report.md`, `soundness.md`, `metrics.md` (sources of every metric), `figures.md` (tokenizer, figures), `bundle.md` (export bundle), `cli.md` (command line), `golden-tests.md`, `acceptance-m1.md` and `acceptance-m2.md` (which test proves which acceptance point), `diagram.md`, `screenshots/m2/` (pictures of the interface), and one document per representation (`json-representation.md`, `mermaid-representation.md`, `compact-notation.md`, `verbalization.md`) |
| `examples/` | Hand-made example models with provenance (`examples/README.md`), CC BY 4.0 |
| `HANDOVER.md` | Hand-over notes in German: decisions, deviations, open points (H1, H2, ...) |

New packages (`packages/cli`, `packages/web`) are picked up by the npm workspace
`packages/*` without further configuration.

## Development

Node 26 and npm 11 are used; the repository contains a dev container
(`.devcontainer/devcontainer.json`, image `node:26.13.0-bookworm`).

```sh
npm install
npm test          # builds first (global setup), then vitest
npm run lint      # eslint (typescript-eslint, type-aware)
npm run typecheck # tsc --noEmit, strict
npm run build     # compiles packages/core, then packages/cli, to their dist/
npm run check     # all of the above except build
npm run e2e       # builds, serves the built page and runs the browser tests (needs Chromium)
```

`npm run e2e` drives Chromium through Playwright. It uses the browser Playwright installed (`npx playwright install --with-deps chromium`),
else the executable named in `PW_CHROMIUM_EXECUTABLE`, else `/opt/pw-browsers/chromium`. It is not part of `npm test`.
`npm run dev -w @repr-werkbank/web` starts the interface with hot reload on port 5173; `npm run screenshots -w @repr-werkbank/web -- --out <dir>`
takes the pictures of the built page. CI (`.github/workflows/ci.yml`) runs `npm run check` with Node 22 and 24 and `npm run e2e` with Node 24.

## Usage of the web interface

The page opens with an example model in two views (original file and verbalization). Choose another representation in the select of each view;
the buttons in the bar open the options of the representation, copy it and save it (the diagram as SVG or PNG, 1x to 4x). **Load** takes a file,
pasted text or a file dropped anywhere on the page; **Examples** lists the models that come with the tool. Click a diagram element, a place in a
text or an element in the inventory list to mark the same element in both views; Escape clears the mark. The tabs below open the overview
(sizes of all representations), the inventory (which facts each representation carries; a cell with missing facts lists them), the structure
report (the soundness search runs in a worker and can be cancelled) and the export (prompt block from a chosen order of representations, and the
bundle, identical to the command line tool's). **About** and **Formats** are pages of their own. Everything runs in the browser; a loaded model
is not uploaded and not stored, only interface settings are remembered.

**Publication.** The page is published by `.github/workflows/pages.yml` when `main` changes. The address is
https://frybinski.github.io/representation-testing/ after the first deployment. Once, a repository administrator has to choose
*Settings -> Pages -> Source: GitHub Actions* (a private repository needs a plan that allows Pages). Nothing in the build contains the address;
the build works under any sub path.

## Usage of the command line tool

```sh
npm install && npm run build
npm run repr -- examples --out out      # one out/<path>.bundle.json per model file
npm run repr -- --help
```

Details, options and exit codes: `docs/cli.md`.

## Usage of the core library

```ts
import { readFileSync } from 'node:fs';
import { detectFormat, parseModel, diffFacts } from '@repr-werkbank/core'; // run `npm run build` first

const text = readFileSync('examples/bpmn/order-handling.bpmn', 'utf8');

detectFormat(text);            // { ok: true, format: 'bpmn' }
const model = parseModel(text); // throws ParseError (with line and cause) for unreadable input

model.facts;    // facts, identified by content only: [category, subject, aspect, value]
model.notices;  // everything that was not carried into the model (type, id, line)
model.layout;   // diagram data / graphics as layout entries, with source ranges
```

Inside this repository the tests import from `packages/core/src` directly.
Facts have a content-based identity, so two fact sets (from the original and
from a re-read text) compare with `sameFacts` / `diffFacts`. The details, the
fact tables per category and the notice policy are in `docs/model.md`.

## Licence

Code: MIT (`LICENSE`). Example models: CC BY 4.0 (`examples/LICENSE`).
