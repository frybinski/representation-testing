# Export bundle (FA-72)

Implementation: `packages/core/src/bundle.ts`. JSON Schema: [bundle.schema.json](bundle.schema.json), format `repr-werkbank/bundle`,
**version 1** (kept in sync by `packages/core/test/bundle.test.ts`, which validates the bundle of every example and every special case).

`createBundle(text, { tokenizer, registry?, options?, inputName? })` returns everything the tool produces for one model;
`serializeBundle(bundle)` returns the bytes of the file as text. Both are in the core, so the command line tool and the later web
interface produce the same bytes. Every generator runs once per model (`generateAll`); figures, inventory and structure report are
computed from those outputs.

## Determinism

No timestamps, no absolute paths (the input name is a base name), no locale-dependent formatting (numbers are integers or strings
with four decimals). Keys are in the order given below; JSON with two-space indentation, LF line endings, exactly one LF at the end.
Equal input text, options and tokenizer give equal bytes.

## Fields

| Field | Content |
|---|---|
| `metadata.tool.name`, `.version` | `repr-werkbank` and its SemVer version (FA-82). The version is written once in `packages/core/src/version.ts`; a test compares it with every `package.json`. |
| `metadata.bundle.format`, `.version` | `repr-werkbank/bundle` and the version of this format. |
| `metadata.formalism` | `bpmn` or `pnml`. |
| `metadata.input.name` | Base name of the input file, or `null`. Never a path. |
| `metadata.input.sha256` | SHA-256 of the UTF-8 encoding of the input text, 64 lowercase hex digits (FA-71). Computed by `sha256Text` without platform modules (H47). A BOM in the file counts as part of the text. |
| `metadata.tokenizer` | `id`, `name`, `implementation` of the tokenizer behind every token count (FA-41, FA-42). |
| `metadata.generators[]` | One entry per generator that ran, in registry order: `id`, `role` (`representation` or `addition`), `options` (every option of the generator with its value, defaults filled in, in the order of the generator's option list). |
| `notices[]` | Parsing notices (FA-04, FA-10, FA-11), as in `model.schema.json` (`kind`, `type`, `namespace`, `count`, `items`). |
| `representations[]` | `id`, `extension` (the effective one for the model's formalism, `extensionOf`; the original file is `.xml` for BPMN and `.pnml` for PNML), `mime`, `text` of every generator with role `representation`, in registry order. The original file is `original`. The model's `source` field is not stored separately (H20). |
| `figures` | [figures.md](figures.md), version 2. Rows cover every text output including the structure report; every row and `original` carry `tokenizer` next to `tokens`. |
| `inventory` | [generators.md](generators.md) (inventory): `formalism`, `categories`, `totals`, `columns[]` with `cells[]` (`category`, `carried`, `total`, `status`, `missing[]` with `fact` and `element`; the diagram column also has `asText` and `visual`, see [diagram.md](diagram.md)). |
| `structureReport` | `null` when the registry has no structure report generators; else `text` (language from the options of `structure-report`) and `data` (the JSON report, [structure-report.md](structure-report.md)). |

## Options

`options` is a map from generator id to option values. A generator without entry uses its defaults. An unknown generator id or option
is an error (`GeneratorError`). Options of a generator that does not accept the model's formalism are ignored (it does not run and is
not listed under `metadata.generators`), so one set of options works for BPMN and PNML files.

## Changing the format

A change of fields, their order or their meaning raises `BUNDLE_VERSION`. A change of any generator output changes the golden files
(see [golden-tests.md](golden-tests.md)) and needs a version step and a `CHANGELOG.md` entry (FA-82).

## Staged creation (NF-02)

The structure report (the soundness search) is the only part that can take noticeable time. For a worker that wants to show
everything else first, `createBundle` is split into three functions (`createBundle(text, config)` is
`finishBundle(stage, runAdditions(stage))` with `stage = startBundle(text, config)`, so the result is the same by construction;
`staged-bundle.test.ts` compares the bytes for every example):

| Function | Does |
| --- | --- |
| `startBundle(text, config)` | Parses, validates the options of **all** generators, runs every generator except the additions, computes figures, inventory and metadata. Returns a `BundleStage` with `partial` (`metadata` (final), `notices`, `representations`, `figures` without the additions' rows, `inventory`) and `pending` (ids of the additions). |
| `runAdditions(stage)` | Runs the additions (the structure report generators). This is the slow call; a worker can be terminated while it runs. |
| `finishBundle(stage, additions)` | Assembles the complete `Bundle`: adds the additions' rows to the figures (in registry order) and the `structureReport`. Throws when `additions` are not the pending ones. |
