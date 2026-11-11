# Generators, combination and inventory

## Register (§7)

`GeneratorRegistry` holds `GeneratorDefinition`s. A definition carries `id`, `name` and `description` (German and English),
`formalisms`, `kind` (`text` or `image`), `extension`, `mime`, `options` and a pure `generate(model, options)`; text
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

**Spans** map facts to text: `{start, end, factIds}` in UTF-16 offsets (end exclusive); spans may overlap.

## Combination (FA-28)

`combine(registry, model, steps)` runs the steps (`{generator, options?}`) and joins the texts with one blank line
(`COMBINATION_SEPARATOR`). Carried facts are the union (first occurrence wins); spans are shifted by the start of their
part, and `parts` gives the range of each step. The prompt block with header (FA-71) is not part of milestone 1.

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
