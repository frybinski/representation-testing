# Figures per representation (FA-40, FA-41, FA-42)

Implementation: `packages/core/src/figures.ts` and `packages/core/src/tokenizer.ts`.
JSON Schema: [figures.schema.json](figures.schema.json) (kept in sync by `test/figures.test.ts`).

`computeFigures(model, inputs, tokenizer)` returns, for every text (`{id, text}`), characters, lines and tokens, and the same
three relative to the original file (`model.source`). `computeRegistryFigures(model, generated, tokenizer)` does this for all
outputs of `generateAll(registry, model, options)`; it does not run any generator itself, so a bundle runs each generator once.

**Version 3 (milestone 2).** Every row has a `kind`:

* `text`: `id`, `kind`, `characters`, `lines`, `tokens`, `tokenizer`, `relative` as described below;
* `image` (the diagram, FA-40): `id`, `kind`, `width` and `height` (px, those of the root element of the SVG) and `bytes`, the size of the
  file: the number of bytes of the UTF-8 encoding of the SVG markup. An image has no token count and no relation to the original.
  A PNG would have a different size in every browser, so only the SVG is measured.

* `characters`: Unicode code points (not UTF-16 units, not bytes).
* `lines`: line-feed separated lines; a final line break does not start a line; the empty text has 0 lines.
* `tokens`: `tokenizer.count(text)`.
* `tokenizer` (in `original` and in every row): the id of the tokenizer next to the number (FA-41, version 2 of the format); the
  top-level `tokenizer` object holds the full description.
* `relative.*`: value divided by the value of the original file, a string with exactly four decimals (`"0.3333"`), or `null` when the
  original's value is 0. A bare number is never produced: the `tokenizer` object (`id`, `name`, `implementation` with version) is a required
  part of the result, so a user interface cannot show a token count without naming the tokenizer (FA-42). The sentence that
  token counts depend on the LLM belongs to the user interface; the data carries what the sentence needs.

## Tokenizer (E-5)

`Tokenizer` is `{info, count(text)}`; any module that satisfies it can replace the default. The default is **o200k_base** through
[gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) 4.1.1 (MIT), loaded by `loadDefaultTokenizer()` with a dynamic import so that the vocabulary can be split from the
rest of the bundle. Special-token strings such as `<|endoftext|>` inside a model are counted as ordinary text. No estimating
formula exists anywhere, also not as a fallback: when the tokenizer cannot be loaded, the call fails.
Choice and checks of the library: `HANDOVER.md`, H44. The reference values the tests use are those of the OpenAI cookbook ("How to count
tokens with tiktoken").
