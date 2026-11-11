# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.1] - fixes after the first deployment

### Fixed
- Safari: no model could be read ("Maximum call stack size exceeded"). The tokenizer vocabulary is now bundled as JSON chunks instead of two array literals of 100 000 entries each, which JavaScriptCore could not evaluate on the smaller stack of a Web Worker (H81). Data and token counts are unchanged.
- A field being edited in the lower area (for example the state limit of the structure report) no longer loses focus and input when a result arrives from the worker; a prompt block result re-renders only the export tab (H82).
- Browser test for the soundness cancel no longer depends on fixed waits (H82).

### Changed
- Version 0.2.1; golden files differ only in the version string.

### Known
- The automatic diagram layout (dagre) recurses with the length of the longest path; in Safari very large models (about 1000 nodes and more) can exceed the stack (H83).

## [0.2.0] - milestone 2, stages F and G (interface, published first)

### Added (milestone 2, stage G)
- Web interface, lower area: overview table (sortable, FA-62), inventory cells with missing facts as buttons and a list below the matrix (FA-54), structure report with cancel, export tab with the prompt block composer (FA-28, FA-71) and the bundle download (FA-72).
- Linked highlighting between the two views (FA-61); diagram elements are focusable buttons; on narrow screens the diagram is fitted to the width.
- Pages About, Formats and the legal placeholder with hash routing, version in the footer (FA-80 to FA-82), `CITATION.cff`, `THIRD_PARTY_LICENSES.txt` in the build.
- Browser tests `npm run e2e` (Playwright through Vitest), performance tests with generated 500-node models, `.github/workflows/ci.yml` and `pages.yml`.
- German texts for the example descriptions; the R-2 scan has a separate allow-list for link targets.
- No generator output changed in this stage: the version stays 0.2.0 (FA-82).

## [0.2.0] - milestone 2, stage E (core extensions)

### Changed (2.7)
- Bundle format version 2: `representations[].kind` (`text` or `image`); the diagram is stored with its SVG markup as text plus `width` and `height`; no PNG in the bundle. Schema, docs and schema tests updated.
- Figures format version 3: rows have a `kind`; the diagram row has pixel width, height and byte size of the SVG instead of characters, lines and tokens (FA-40). `imageFigureRow` added.

### Added (2.6)
- Staged bundle creation: `startBundle`, `runAdditions`, `finishBundle` (`createBundle` is built from them, output unchanged); `generateAll` takes an optional role filter; figures got `measureOriginal`, `figureRow`, `assembleFigures`.

### Added (2.5)
- `promptBlock` and `promptHeader` (FA-71): a combination with an optional header (tool and version, input name, SHA-256 of the input, representations with their effective options); syntax in `docs/generators.md`; golden file `prompt-block.txt` per example.

### Added (2.4)
- `highlight.ts` (FA-61): `elementOfFact`, `elementRanges`, `elementsInRanges`, `elementsAt` map facts, spans and text offsets to model elements (node id or edge key).

### Changed (2.3)
- `GeneratorDefinition.extensionFor` and `extensionOf`: the original-file generators have the extension `pnml` for PNML (FA-70) and `xml` for BPMN; the bundle records the effective extension. Golden files `original.pnml` and `original-no-layout.pnml` replace `.xml` for the nets.

### Added (2.2)
- `InventoryCell.asText` and `InventoryCell.visual` for columns that report how they carry facts (the diagram, FA-53); `CarrierInput.encoding`; schema and docs updated.

### Added (2.1)
- Generator `diagram` (FA-26): SVG diagram of BPMN and PNML models with the layout of the file when it is complete and an automatic layered layout (`@dagrejs/dagre` 3.1.3) otherwise; options `layout`, `direction`, `showConditions`; `docs/diagram.md`. The diagram carries facts and is a column of the inventory.
- `ImageOutput` now holds the SVG as `svg` with `width`, `height`, `encoding` and `layout` (replaces `data`).

### Changed (2.1)
- Version 0.2.0. The bundle inventory has a `diagram` column and the bundle lists the generator; golden files for the diagram (`diagram.svg`, `diagram.auto.svg`) were added.

### Added (stage D, step 6)
- `docs/acceptance-m1.md`: the six acceptance points of milestone M1, each with its tests and command; M1 report in `HANDOVER.md`.

### Added (stage D, step 5)
- Property tests on seeded random BPMN and PNML models (150 seeds each): JSON, Mermaid and compact notation read-back against the reported facts; determinism test of the command line tool (two runs, other working directory, locale and time zone, compared by SHA-256 and with the golden bundles); scan of the built state for foreign servers (R-2); `npm test` builds first through a vitest global setup.

### Added (stage D, step 4)
- Golden tests: `tests/golden/` with one file per example, text representation (German and English where a language option exists), both structure report variants and the bundle; byte-for-byte comparison test; `npm run golden:update` (separate command); `.gitattributes`; `docs/golden-tests.md`.

### Added (stage D, step 3)
- Command line tool `packages/cli` (FA-73): recursive discovery, `--out`, `--option generator.key=value`, deterministic order, FA-04 errors per file without stopping, exit codes 0/1/2; `docs/cli.md`; root script `npm run repr`.

### Added (stage D, step 2)
- Export bundle (FA-72): `createBundle`, `serializeBundle`, format `repr-werkbank/bundle` version 1 with JSON Schema and field documentation (`docs/bundle.md`); `generateAll`, `inventoryOf`; `VERSION` in `version.ts`; platform-free `sha256Text`.

### Changed (stage D, step 1; generator output)
- `structure-report` (de): German wording for formulas, node/gateway/edge types, degrees, counts and stop reasons; the English text and the JSON are unchanged apart from the separator below.
- `structure-report` (both languages): entries of the split, join and pair lists are `id (type, in N, out M)` and separated by `; ` instead of `, `.
- `verbalization` (de) and `structure-report` (de): a Petri net transition is "Transition" (feminine: "Ihre ..."), no longer "Übergang" (masculine).
- `verbalization` (de, en): a participant's process referred to by an alias no longer repeats the noun ("executing process 1", "der den Prozess 1 ausführt").
- `original` and `compact` option descriptions say "Transitionen".
- Figures format version 2: every `tokens` value is accompanied by the `tokenizer` id (FA-41). `computeRegistryFigures(model, generated, tokenizer)` works on outputs of `generateAll`; the structure report analysis is computed once per model.

### Added (stage C)
- Structure report (FA-27, FA-30 to FA-33) for BPMN and Petri nets as an addition generator in text and JSON, with JSON Schema; carries no model facts and is skipped by the inventory (`role: 'addition'`).
- Soundness check for workflow nets over the reachability graph with state limit, step budget and abort signal; outcomes sound, not sound (with witness) and not decided.
- Metrics with formulas and sources in `docs/metrics.md`.
- Tokenizer module (o200k_base via gpt-tokenizer) behind a replaceable interface and figures per text with absolute and relative values, naming the tokenizer (FA-40 to FA-42), with JSON Schema.

### Fixed (stage B findings)
- Verbalisation names processes, German gender and number agreement, grouped parallel flows; stronger relational tests; explicit reader list; mixed edge type case; `source` check in the original generator.

### Added (stage B)
- Generator register with self-describing options, usable for text and, later, image output.
- Representations: original file (FA-20), original without layout (FA-21),
  Mermaid flowchart (FA-22), JSON with JSON Schema (FA-23), compact notation
  for Petri nets behind a notation interface (FA-24), rule-based verbalization
  in German and English (FA-25).
- Combinations of representations (FA-28).
- Readers for Mermaid, JSON and compact notation (FA-52); each generator
  reports the facts it carries and where they stand in the text.
- Inventory category x representation with missing facts per cell (FA-50, FA-51, FA-54).

### Changed
- `ProcessModel` keeps the source text (`source`) and the `toolspecific` ranges (`toolRanges`).

## [0.1.0] - stage A

### Added
- npm workspace with `packages/core`; strict TypeScript, Vitest, ESLint.
- Internal model (typed graph with attributes) and fact set shared by BPMN and
  PNML, as TypeScript types and as JSON Schema (`docs/model.schema.json`), with
  a test that keeps both in sync.
- BPMN 2.0 parser: all task types, start/end/intermediate events with event
  definitions, exclusive/parallel/inclusive/event-based gateways, sequence flows
  with names, conditions and default flows, pools, lanes, message flows, data
  objects with associations, text annotations, embedded sub-processes,
  multiple processes per file, diagram data (shapes, edges, labels).
- PNML parser: place/transition nets with arc weights, initial marking, nested
  pages, graphics; pm4py dialect (final markings, silent transitions).
- Notices for everything that is not carried into the model (FA-04) and
  `ParseError` with line and cause for unreadable input.
- Format detection from content.
- Example models (`examples/`) including three workflow nets for the
  soundness check, with provenance.
- Licences: MIT (code), CC BY 4.0 (examples).
