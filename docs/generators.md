# Generators, combination and inventory

## Register (§7)

`GeneratorRegistry` holds `GeneratorDefinition`s. A definition carries `id`, `name` and `description` (German and English),
`formalisms`, `kind` (`text` or `image`), `extension` (and optionally `extensionFor(formalism)`, read through `extensionOf(def, formalism)`: the two original generators give `xml` for BPMN and `pnml` for PNML, FA-70), `mime`, `options` and a pure `generate(model, options)`; text
generators with a reader also provide `read(text, formalism)`. `createDefaultRegistry()` registers the milestone 1 generators:

| id | Representation | Formalisms | Reader |
| --- | --- | --- | --- |
| `original` | FA-20 original file | BPMN, PNML | `parseModel` |
| `original-no-layout` | FA-21 original without layout | BPMN, PNML | `parseModel` |
| `json` | FA-23 ([json-representation.md](json-representation.md)) | BPMN, PNML | `readJson` |
| `mermaid` | FA-22 ([mermaid-representation.md](mermaid-representation.md)) | BPMN, PNML | yes |
| `compact` | FA-24 ([compact-notation.md](compact-notation.md)) | PNML | yes |
| `verbalization` | FA-25 ([verbalization.md](verbalization.md)) | BPMN, PNML | none |
| `diagram` | FA-26 image, SVG ([diagram.md](diagram.md)) | BPMN, PNML | none |
| `structure-report` | FA-27, text, **addition** ([structure-report.md](structure-report.md)) | BPMN, PNML | none |
| `structure-report-json` | FA-27, JSON, **addition** ([structure-report.md](structure-report.md)) | BPMN, PNML | none |

Options are described by `OptionSpec` (`boolean`, `choice` with values, `integer` with bounds; each with default and
labels in both languages), so a user interface needs no format-specific knowledge. `registry.run(id, model, options)`
validates the options and fills in defaults (`resolveOptions`).

Output is `TextOutput` (`text`, carried `facts`, `spans`) or `ImageOutput` (`svg`, `width`, `height`, carried `facts`, `encoding`, `layout`; [diagram.md](diagram.md)). The `diagram` generator (FA-26, milestone 2) is the only image generator.

**Role (`role`, added in stage C, H40).** A definition is a `representation` (default) or an `addition`. A representation
expresses facts of the model and counts in the inventory. An addition is a set of computed properties (the structure
report): it carries no facts (`facts: []`, `spans: []`), is skipped by `computeInventory`, and is otherwise an ordinary text
generator, so `combine` works unchanged: alone it is a combination of one step, added to a representation it
contributes text and no facts, and the combination carries exactly the facts of its representations.

**Carried means recoverable from the text alone.** A generator lists a fact only when a reader who knows the documented
conventions can take it from the text. Readers receive only the text and the formalism, never the model, and the tests
require `read(text) == facts` for every example and for the special cases.

**Highlight index (FA-61, 2.4).** `highlight.ts`: `elementOfFact(model, fact)` is the element key of a fact (node id or edge key, the diagram's `data-element`); `elementRanges(model, output)` maps each element to the merged, sorted ranges of the text that express a fact about it (built from the spans, so it also works for combinations); `elementsAt(model, output, offset)` / `elementsInRanges(ranges, offset)` list the elements at an offset, innermost (shortest range) first. Elements appear in model order, so results are deterministic.

**Spans** map facts to text: `{start, end, factIds}` in UTF-16 offsets (end exclusive); spans may overlap.

## Combination (FA-28)

`combine(registry, model, steps)` runs the steps (`{generator, options?}`) and joins the texts with one blank line
(`COMBINATION_SEPARATOR`). Carried facts are the union (first occurrence wins); spans are shifted by the start of their
part, and `parts` gives the range of each step. The prompt block with header (FA-71) is `promptBlock` (below).

## Inventory (FA-50, FA-51, FA-54)

`buildInventory(model, carriers)` / `computeInventory(registry, model, optionsById?)` return a matrix category x column.
A cell has `carried`, `total` and a `status`:

* `complete`: all facts of the category are carried,
* `partial`: some are,
* `none`: facts exist, none carried,
* `notInModel`: the model has no fact in this category (for example weights when every weight is 1, H17).

`missing` lists the not carried facts of the cell with the element each is about (`node`, `edge`; the key is the node id or
the edge key, plus type and label). The matrix is computed from the facts the generators report, including the column
of the original file; nothing is tabulated by hand.

**Text and visual (FA-53, 2.2).** A column whose generator reports how it carries facts (an `ImageOutput` has `encoding`: fact id to `text` or `visual`) adds `asText` and `visual` to every cell, with `asText + visual = carried`. The status is computed from the union as before. Cells of text representations have neither field. `text` means a reader can read the value as text in the image (labels, names, numbers); `visual` means the value is encoded in shape, line style, marker or position; the rules per category are in [diagram.md](diagram.md).

## Prompt block with header (FA-71)

`promptBlock(registry, model, steps, { header, inputSha256?, inputName? })` (`generators/prompt-block.ts`) is `combine` plus an optional
header. With `header: false` the result is exactly the combination. With `header: true` the text is the header, a blank line,
then the combination; spans and parts are shifted accordingly and the carried facts are those of the representations (the
header carries none). `inputSha256` defaults to the SHA-256 of `model.source` (the value the bundle records as `input.sha256`).

**Header syntax.** Every header line starts with `# ` (a hash and a space), so a person or a program can strip it. Lines in this order:

```
# repr-werkbank 0.2.0
# input: "order-handling.bpmn"
# input-sha256: <64 lowercase hexadecimal digits>
# representations:
#   1. verbalization (language=en, showIdentifiers=false)
#   2. json (indent=2, ...)
```

* tool name and version (FA-82);
* `input:` the base name as a JSON string; the line is left out when no name is given;
* `input-sha256:` of the UTF-8 text of the input file;
* `representations:` and one line per step in the order of the steps: the generator id, and, when it has options, all options of
  the generator with the value in effect (defaults filled in), in the order of its option list, as `key=value`.

The header contains no date, no host and nothing else that varies, so the same input, steps and options always give the same bytes
(R-5). Golden files: `tests/golden/<example>/prompt-block.txt` (verbalization, JSON or compact notation, structure report, with header).
