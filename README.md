# repr-werkbank

A workbench for process model representations. It reads a process model
(BPMN 2.0 XML or PNML), turns it into several text representations (original,
original without layout, Mermaid, JSON, compact notation, verbalisation) and
reports which facts of the model each representation carries.

The project belongs to a doctoral thesis at KIT (Fabian Rybinski). Correctness
matters more than coverage: an element that is not supported is reported, never
silently dropped or misrepresented.

**Status: milestone M1 (stages A to D) complete; M2 not started.** The core library has the model, the BPMN and PNML
parsers, the generators and readers, combinations, the inventory, the structure
report with soundness check and metrics, the tokenizer, the figures per text and
the export bundle. `packages/cli` writes one bundle per model file. The web
interface follows in a later stage.

## Layout

| Path | Content |
| --- | --- |
| `packages/core` | Library `@repr-werkbank/core`: XML reading, model, facts, BPMN and PNML parsers, format detection. Runs under Node and in a browser bundle (no DOM, no network). |
| `packages/cli` | Command line tool `@repr-werkbank/cli`: file access, arguments, messages; all content from the core (`docs/cli.md`). |
| `docs/` | `model.md` (model, facts, notices), `model.schema.json` (JSON Schema of the model), `pnml-pm4py-dialect.md` (sources checked), `generators.md` (register, combination, inventory) `structure-report.md`, `soundness.md`, `metrics.md` (sources of every metric), `figures.md` (tokenizer, figures), `bundle.md` (export bundle), `cli.md` (command line), `golden-tests.md`, `acceptance-m1.md` (which test proves which acceptance point), and one document per representation (`json-representation.md`, `mermaid-representation.md`, `compact-notation.md`, `verbalization.md`) |
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
```

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
