# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
