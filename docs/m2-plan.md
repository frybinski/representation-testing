# Implementation plan for milestone M2 (interface and publication)

Status: plan of 11.11.2026, written for the implementing agent. The brief is `Planung.md` (the version in the repository is
authoritative; it contains section 5.10 with UI-01 to UI-11 and E-8). Hand-over notes: `HANDOVER.md` (German, H1 to H50).
This plan does not repeat the brief; it fixes the order of work, the architecture decisions and what "done" means per stage.

## 0 Starting point and decisions taken before M2

* M1 is complete (`HANDOVER.md`, section "M1-Bericht"). `npm run check` is green (973 tests).
* The design draft of UI-11 exists: `packages/web` (draft code), screenshots in `docs/design/` (base, inventory, narrow; light and
  dark), extra focus pictures in `packages/web/.extra/`. **Fabian asked on 11.11.2026 to continue and complete the tool on the basis
  of this draft; the draft counts as accepted (new H-point, see 0.1).** The finished interface must match it: header layout, view bars,
  figures line, lower tab strip, inventory pills with icon and text, fonts (Inter, JetBrains Mono, bundled), accent colour, spacing.
* H1 is resolved in practice: the repository is on GitHub (`frybinski/representation-testing`), so GitHub Pages via a workflow is
  possible. The Pages URL is a sub path (`https://<user>.github.io/representation-testing/`); never hard-code it (see 4.3).

### 0.1 New H-points to write at the start (German, in `HANDOVER.md`, numbering continues at H51)

* H51: UI-11 draft accepted by Fabian's instruction of 11.11.2026 (no separate review of the six pictures).
* H52: H1 resolved: GitHub repository, Pages deployment through GitHub Actions; Fabian must set *Settings → Pages → Source: GitHub
  Actions* once (a private repository needs a plan that allows Pages).
* Further H-points as decisions are made below (each decision marked **[H]** in this plan needs one).

## 1 Architecture of M2

```
packages/core   + diagram generator (SVG, FA-26), visual/text carriage (FA-53), highlight index (FA-61), prompt block with
                  header (FA-71), extension per formalism (FA-70), staged bundle creation for the worker (NF-02)
packages/cli    unchanged except what the core changes imply (version, bundle format)
packages/web    worker (all processing), app shell, views, lower area, pages About / Formats / Legal, export, e2e tests
.github/        workflows: ci.yml (check + e2e on push and pull request), pages.yml (build, test, deploy on main)
```

Rules that hold for every stage:

1. **Everything that produces exported bytes lives in the core** (R-4, R-5, FA-73): SVG, prompt block, bundle. The web package only
   displays and triggers. PNG is the one exception (rasterising needs a browser), see 2.1.
2. **No list of formats in the interface** (§7): selects, overview rows, inventory columns, export choices and the Formats page are
   built from `createDefaultRegistry()`. A new generator needs no change in `packages/web`.
3. **No `innerHTML` with model-derived text.** Text goes through `textContent`; the SVG is parsed with `DOMParser`
   (`image/svg+xml`) and imported. All labels in the SVG are XML-escaped by the core.
4. **R-2:** no request to another origin at runtime. No `fetch` to other hosts, no CDN, fonts bundled (already done), tokenizer
   bundled. Links the user clicks (DOI, repository) are allowed; extend `tests/no-external-references.test.ts` with a separate
   allow-list for link targets that occur only in `href` attributes of the web build **[H]**.
5. **Determinism:** no `Math.random`, `Date`, locale formatting or `Intl` in the core. Numbers in SVG are printed with a fixed
   function (integers, or one decimal place with `.`), never `toLocaleString`.
6. Code comments and docs in English, `HANDOVER.md` German (R-6). One commit per finished step (§12). Before every commit:
   `npm run check` green.
7. Any change of a generator's output: version step (FA-82). M2 changes outputs, so the version becomes **0.2.0** (in `version.ts` and
   every `package.json`; the existing test enforces equality), `CHANGELOG.md` entry, `npm run golden:update`, and review of the golden
   diff before committing.

## 2 Stage E — core extensions (no interface work)

### 2.1 Diagram generator (FA-26)

* New generator `diagram`, `kind: 'image'`, `mime: 'image/svg+xml'`, extension `svg`, formalisms BPMN and PNML.
  `ImageOutput` gets the SVG as text **and** the facts with their encoding (see 2.2); adapt `ImageOutput` instead of inventing a
  second type (`data` as UTF-8 bytes may stay for the figures, or be replaced by `svg: string` — choose one, document it).
* Options (self-describing `OptionSpec`): `layout`: `file` | `auto` (default `file`; when the file has no complete layout for every
  drawn element, fall back to `auto` for the whole diagram and state this in the SVG as `data-layout-source="auto"` plus a comment)
  **[H]**; `direction` for auto layout (`LR` default, `TB`).
* Layout from the file: BPMN DI (`BPMNShape` bounds, `BPMNEdge` waypoints, `isExpanded`, pools/lanes), PNML `graphics`
  (`position`, `dimension`, arc `position` points). Check what `model.layout` (`LayoutEntry`) holds today; if coordinates are not
  parsed into usable values yet, add a parser for them in the core with tests (do not re-parse XML in the generator).
* Automatic layered layout: choose a **synchronous** library (createBundle and the CLI stay synchronous). Candidates to check at the
  source (licence, last release, maintenance, size, determinism, compound-graph support for pools/lanes/sub-processes):
  `@dagrejs/dagre` (MIT), `elkjs` (EPL-2.0, asynchronous API — probably unsuitable), an own Sugiyama implementation. Write the
  comparison and the decision into `HANDOVER.md` like H7/H44 **[H]**. Determinism test: same model twice, and the model with shuffled
  `Map` insertion order where applicable, gives identical bytes.
* Label width without DOM: fixed per-character width table and word wrap by that estimate (deterministic). `font-family` in the SVG
  is generic (`sans-serif`, `monospace`) so an exported file renders anywhere; the web page may override it with CSS.
* Notation (grey scale, one accent only for highlighting, which the web page adds by CSS class; NF-06):
  * BPMN: task = rounded rectangle (type marker small, e.g. user/service/script glyph, or the type word in small caps — choose and
    document); start event thin circle, intermediate double circle, end thick circle; event definition glyphs (message, timer,
    signal, error, escalation, conditional, link, compensation, terminate; catch outline vs throw filled); gateways = diamond with X,
    +, O, pentagon; sequence flow solid with filled arrow, default flow with slash at the source, conditional flow from a task with a
    small diamond at the source; message flow dashed with open circle and open arrow; association dotted; data object (dog-eared
    page), data store not supported (H18); text annotation as open bracket; pools and lanes as bands with vertical label; expanded
    sub-process as rounded rectangle containing its children.
  * PNML: place = circle, tokens as dots (1–5 dots, above that the number), transition = rectangle, silent transition = filled
    rectangle without label, arc with arrow, weight as text when ≠ 1, final marking (pm4py) as a double circle or a small marker —
    document the choice in `docs/diagram.md`.
* Every drawn element is a `<g>` with `data-element="<node id or edge key>"` (escaped) and `data-kind="node|edge"`, so the interface
  can find it (FA-61). Root `<svg>` has `width`, `height`, `viewBox`, `xmlns`, `role="img"`, `<title>` with the model or process name.
* New doc `docs/diagram.md`: notation table, layout rules, limits, which facts are carried as text and which visually.

### 2.2 Text versus visual carriage (FA-53)

* The diagram reports for every carried fact whether it is **readable as text** (labels, flow names, conditions, arc weights,
  marking numbers > 5) or **only visually encoded** (node type as shape, default flow as slash, event type as glyph, edges as arrows,
  pool/lane membership as band, tokens as dots, silent transition as filled box, layout positions when `layout=file`).
  Identifiers are not drawn, so not carried.
* `InventoryCell` gets two optional counts `asText` and `visual` (only for columns with encoding information). Status rules stay
  as they are, computed from the union. The web shows e.g. "9 of 12 · 3 text, 6 visual".
* Test: every fact reported as text appears literally (after XML unescape) in a `<text>` element of the SVG; every reported fact's
  subject has a `data-element` group; no fact is reported for a subject without a group.

### 2.3 Original file extension per formalism (FA-70, open point from H45)

* FA-70 names `.xml` and `.pnml`. Add an optional `extensionFor?(formalism)` to `GeneratorDefinition` (or an `extensions` map);
  `original` and `original-no-layout` give `xml` for BPMN and `pnml` for PNML. The bundle records the effective extension **[H]**.

### 2.4 Highlight index (FA-61)

* Pure helper in the core, e.g. `packages/core/src/highlight.ts`:
  * `elementOfFact(model, fact)` → element key (node id or edge key) or null (facts about the whole model).
  * `elementRanges(model, output)` → `Map<elementKey, {start,end}[]>` merged and sorted, built from `spans` + facts.
  * `elementsAt(model, output, offset)` → element keys whose ranges contain the offset, innermost (shortest range) first.
* Tests on every example for Mermaid, JSON, verbalization, compact notation, original: each node of the model that the
  representation carries has at least one range, and the range text contains the node's id or label where the format writes it.

### 2.5 Prompt block with header (FA-71)

* Core function `promptBlock(registry, model, steps, { header: boolean, inputSha256, inputName })` built on `combine`. Header lines:
  tool name and version, the representations in order with their effective options, SHA-256 of the input. Define the header syntax
  (e.g. lines starting with `# `) in `docs/generators.md` **[H]**. Deterministic; golden test for one BPMN and one PNML example.

### 2.6 Staged processing for the worker (NF-02)

* The structure report (soundness search) is the only potentially slow part. Provide a core entry point that splits bundle creation
  into (a) everything except the `addition` generators and (b) the additions, and assembles the identical `Bundle` from both parts.
  Test: assembled bundle bytes equal `serializeBundle(createBundle(...))` for every example.
* The soundness search already accepts an abort object (H33); the worker will additionally be terminable (2.6 is enough for that).

### 2.7 Bundle format version 2

* `BUNDLE_VERSION = 2`: representations carry `kind` (`text` | `image`); the diagram is stored with its SVG markup as text (SVG is a
  text format; no base64) plus `width` and `height`. Figures for the diagram: pixel width, height and byte size (UTF-8 of the SVG)
  instead of characters/lines/tokens (FA-40); bump `FIGURES_VERSION`. Update `docs/bundle.md`, `docs/bundle.schema.json`,
  `docs/figures.md`, schemas and schema tests. PNG is not in the bundle (rasterisation differs between browsers, R-5) **[H]**.

**Done when (Stage E):** all of 2.1–2.7 with tests, docs, golden files regenerated for every example (diagram SVG included in
`tests/golden`), version 0.2.0, CHANGELOG, H-points, `npm run check` green, CLI unchanged apart from the new content.
Render each example SVG once in Chromium (Playwright, `chromium.launch()`, fall back to `executablePath: '/opt/pw-browsers/chromium'`)
to PNG in a scratch directory and look at it; fix what looks wrong. Commit per sub-step.

## 3 Stage F — interface foundation

Start from the draft code in `packages/web/src` (keep tokens, styles, icons, fonts, contrast test). Replace the draft's "not wired"
markers step by step. Suggested module split: `worker.ts` + `worker-client.ts`, `state.ts` (UI state, persistence), `i18n.ts`,
`views/text-view.ts`, `views/diagram-view.ts`, `lower/*.ts`, `pages/*.ts`, `router.ts`, `download.ts`. No UI framework needed;
introduce one only with a reason and an H-point.

### 3.1 Worker (NF-02)

* All parsing, generating, figures, inventory and bundle creation run in a module Web Worker
  (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`); the tokenizer is loaded there.
* Protocol: request `{ id, text, inputName, options }` → `partial` (representations with text/SVG, spans, element ranges,
  figures, inventory, notices, node list for labels) → `complete` (structure report + bundle JSON string) or `error`
  (`ParseError` with line, column, cause). Responses carry the request id; stale responses are dropped.
* Cancel: if phase (b) runs, the lower area shows "Structure report is being computed … Cancel". Cancel terminates the worker and
  starts a fresh one; the structure report tab shows "cancelled, not decided" with a "Compute again" button and a hint to the
  `maxStates` option; bundle export is unavailable with that reason (never a bundle that differs from the CLI).
* Option changes re-run immediately (FA-63); a running request is superseded (terminate when it is in phase (b)).

### 3.2 Loading (FA-01, FA-05, UI-03, UI-08)

* Header controls exactly as in the draft (≤ 6): Load, Examples, language, colour scheme, About, Formats.
* Load opens a small non-modal panel: file picker, a paste area with "Read text", and the hint that the whole page is a drop target.
  Drag and drop onto the page anywhere. Read files as bytes and decode strictly as UTF-8 keeping a BOM, exactly as the CLI does
  (so the SHA-256 and bundle match the CLI) **[H]** if a difference is unavoidable.
* Examples: all files under `examples/` via `import.meta.glob('../../../examples/**/*.{bpmn,pnml}', { query: '?raw', import: 'default', eager: false })`,
  listed with a visible "Example" mark and a short description taken from `examples/README.md` (or a small manifest generated from
  it). First open loads `bpmn/order-handling.bpmn` with views Original file | Verbalization (as in the draft).
* States (UI-08): loading indicator in the view area; parse error as a non-blocking bar under the header with line and cause;
  FA-04 notices as a bar "n elements not supported" that expands to the list (type, id, line). No dialogs.

### 3.3 Views (FA-60, FA-63, UI-04, UI-07, UI-09)

* Each view: representation select (from registry; generators whose formalism does not match are not offered), and three icon
  buttons: Options, Copy, Save. Nothing else in the bar.
* Options popover from `OptionSpec` (boolean switch, choice select, bounded integer) plus the view-level "wrap lines" switch for text
  views. Changes apply immediately. Options are per generator, shared by both views and by the bundle.
* Text view: line numbers, wrap toggle, restrained syntax highlighting for XML, JSON and Mermaid (own small tokenizers; the text
  content must stay byte-identical — test that `textContent` of the code element equals the generated text). Rendering stays fast
  for ~10 000 lines (measure with a 500-node model).
* Diagram view: inline SVG, zoom (buttons not allowed in the bar — use wheel/pinch and keyboard `+`/`-`/`0`), pan by drag, "Fit" on
  double click and key `0` **[H]** if a visible fit control is needed (it would be the fourth control in the bar — allowed: "höchstens
  vier" per view). Text alternative: `aria-describedby` pointing to a visually hidden verbalization in the UI language (NF-04).
* Figures line per view: characters · lines · tokens with the tokenizer name visible next to the number and the note that the
  count depends on the LLM (FA-41, FA-42) — e.g. "609 tokens (o200k_base)" with an info tooltip and the same text for screen
  readers. Diagram: "W × H px · n kB". Numbers formatted with `Intl.NumberFormat` of the UI language (display only).
* Copy: clipboard API with a fallback; Save: download with the generator's extension (2.3); for the diagram Save offers SVG and PNG
  with resolution 1×, 2×, 3×, 4× (PNG via canvas from a `blob:` URL, no network).
* Narrow screens (≤ 720 px or as in the draft CSS): views as tabs (already in the draft), page never scrolls horizontally at 400 px.

### 3.4 Language, scheme, persistence (R-6, E-7, NF-03, NF-05)

* All interface strings in one dictionary `{ en, de }`; default English; switching updates `<html lang>` and every label, including
  generator names (`LocalText` from the registry) and inventory category names.
* Colour scheme: follows the system, toggle cycles light/dark, choice persisted.
* `localStorage` key `repr-werkbank:ui:v1` (wrapped in try/catch, page works without it): language, scheme, chosen representation
  per view, generator options, wrap setting, export composition. **Not** stored: the model, the open lower tab (UI-02 requires the
  collapsed base state on every open).

**Done when (Stage F):** the draft's base state is fully functional with real loading, examples, errors, notices, options, copy,
save, diagram view, language and scheme switching; `npm run check` green; screenshots (light/dark × 1440×900/400×800) taken with the
updated `scripts/screenshots.ts`, looked at, and compared with `docs/design/`.

## 4 Stage G — lower area, linking, pages, publication

### 4.1 Lower area (UI-01, UI-02, FA-51–54, FA-62, FA-27, FA-71, FA-72)

* Tabs Overview | Inventory | Structure report | Export, collapsed by default, at most one open, one click each.
* Overview (FA-62): table of all representations (from registry) with characters, lines, tokens, relative to original; diagram row
  with px and bytes; sortable by every numeric column (button in the header cell, `aria-sort`).
* Inventory (FA-51, FA-53, FA-54): matrix as in the draft plus the diagram column with text/visual split. Each cell with missing
  facts is a button; activating it lists the missing facts with element (type, id, label) below the matrix (not a dialog);
  activating an element there selects it in the views (FA-61).
* Structure report: text in the UI language (structure report generator option `language` follows the UI language **only for
  display**; the bundle uses the user's explicit option value — document which) **[H]**, progress/cancel from 3.1, download JSON.
* Export: (a) prompt block composer (FA-28, FA-71): ordered list of chosen representations/additions, add from a select, remove,
  move up/down (buttons, keyboard operable), header on/off, live preview with figures, Copy and Save `.txt`; (b) bundle download
  (FA-72), byte-identical to the CLI; (c) single representations are already exported from the views.

### 4.2 Linked highlighting (FA-61)

* Selecting in one view highlights the same element in the other: click in a text view → `elementsAt` on the click offset → first
  element; click or Enter on a diagram element (`<g>` focusable, `role="button"`, `aria-label` = type + label). Highlight: accent
  background on the element ranges in text views (scroll the first into view), accent stroke on the SVG group. Escape clears.
  Announce the selection in an `aria-live="polite"` region.
* Text rendering for highlights: split the text at all range boundaries of the current selection only (re-render the affected lines,
  not the whole text), so large files stay fast.

### 4.3 Pages and routing (FA-80, FA-81, FA-82, E-6)

* Hash routing (`#/`, `#/about`, `#/formats`, `#/legal`) — works on GitHub Pages without server rules. Vite `base: './'` so the build
  works under any sub path.
* About (FA-80): purpose, the study "Copy That?" with DOI link `https://doi.org/10.1007/978-3-032-40377-3_3` (title and DOI only —
  do not invent author lists or page numbers), citation hint for the tool (software citation with name, version, year, author
  Fabian Rybinski, Karlsruhe Institute of Technology, repository URL) and a `CITATION.cff` in the repository, version, repository
  link `https://github.com/frybinski/representation-testing`, the note from 5.3 (verbalization is rule-based, the study used
  hand-written descriptions), tokenizer note, privacy statement (everything stays in the browser), licences (MIT, CC BY 4.0 for
  examples, OFL fonts) and third-party notices (generate `THIRD_PARTY_LICENSES.txt` into the build from the licence files of the
  bundled runtime dependencies, deterministic).
* Formats (FA-81): one section per registry generator: name and description (`LocalText`), grammar or schema (JSON schemas from
  `docs/*.schema.json` imported raw; the compact-notation grammar and the Mermaid/verbalization rules from the docs), and an example
  generated live by the core from a small built-in example model.
* Legal (E-6): the only placeholder page allowed, clearly marked "content follows (KIT requirements)", linked in the About page
  footer, not in the header (header stays at six controls).
* Version (FA-82) visible in the About page and in the page footer or brand tooltip, and in every export (bundle and prompt header
  already).

### 4.4 Publication (R-1)

* `.github/workflows/ci.yml`: on push and pull request: `npm ci`, `npm run check`, install Playwright Chromium, `npm run e2e`.
* `.github/workflows/pages.yml`: on push to `main` and `workflow_dispatch`: same checks, `npm run build`, upload
  `packages/web/dist` with `actions/upload-pages-artifact`, deploy with `actions/deploy-pages`; permissions `pages: write`,
  `id-token: write`; concurrency group `pages`. Check the current major versions of every action and of Node at the source
  (GitHub marketplace / repositories) and pin them; Node version consistent with `engines` and the dev container **[H]**.
* The workflow cannot be run from the agent's environment; verify YAML with a parser and, if available, `actionlint`.

### 4.5 Browser tests (M2 acceptance) and performance

* `npm run e2e`: builds, starts `vite preview` on a free port, runs Playwright tests through Vitest (separate config
  `vitest.e2e.config.ts`, not part of `npm test`). Chromium: default launch, fall back to `/opt/pw-browsers/chromium` or the env var
  `PW_CHROMIUM_EXECUTABLE`. Tests, one per acceptance point of §8 M2 where automatable:
  1. after open: example loaded, both views filled, figures lines present, lower area collapsed;
  2. at 1440×900 header, both views and both figures lines visible without scrolling; header ≤ 6 controls, each view bar ≤ 4;
  3. each lower tab opens with one click;
  4. loading an own BPMN and an own PNML file (`setInputFiles`, and drop, and paste) works, and the request log contains only
     same-origin URLs (and `blob:`/`data:`);
  5. clicking a diagram node highlights the matching ranges in Mermaid, JSON and Verbalization views;
  6. the downloaded bundle equals the golden bundle / CLI output byte for byte, for a BPMN and a PNML example, with default and with
     changed options (run the built CLI with the same `--option` values);
  7. at 400×800 and in dark scheme: no horizontal page scroll, all controls reachable, focus visible (keyboard walk with Tab).
  Plus: soundness cancel works on `wf-large.pnml` with a high `maxStates`; language switch changes all visible labels.
* Performance (NF-02): a generator for 500-node BPMN and PNML models (reuse `packages/core/test/random-models.ts` ideas); a Node test
  that the full pipeline stays under a documented budget, and an e2e measurement that the main thread is not blocked (long tasks
  < 200 ms while processing). Record measured numbers in `HANDOVER.md`.
* Contrast (WCAG AA) test exists — extend to every new colour token; keyboard focus visible on every control.
* Firefox and Safari (NF-03) cannot be tested here: if Playwright Firefox/WebKit can be installed, run the e2e suite there too;
  otherwise H-point with what was checked.

### 4.6 Report (§12)

* `docs/acceptance-m2.md`: each acceptance point of §8 M2 → test file and command, like `docs/acceptance-m1.md`.
* Final screenshots (light/dark × wide/narrow, plus inventory open and diagram with a highlighted node) under `docs/screenshots/m2/`,
  looked at before reporting (§12 rule).
* `HANDOVER.md`: M2 section, all new H-points, "M2-Bericht" with every acceptance point and its result, open H-points, proposal for
  the next step (M3). `README.md` and `CHANGELOG.md` updated; README gets the Pages URL as "after the first deployment".

**Done when (Stage G):** all of section 8 M2 is met or documented as not verifiable here with the reason; `npm run check` and
`npm run e2e` green; screenshots viewed; report written.

## 5 Not in M2

Everything of M3 (diagram-equivalent variants, flow-oriented verbalization, further tokenizers, several models, second Petri net
notation), and everything in §10 of the brief.
