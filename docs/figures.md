# Figures per text representation (FA-40, FA-41, FA-42)

Implementation: `packages/core/src/figures.ts` and `packages/core/src/tokenizer.ts`.
JSON Schema: [figures.schema.json](figures.schema.json) (kept in sync by `test/figures.test.ts`).

`computeFigures(model, inputs, tokenizer)` returns, for every text (`{id, text}`), characters, lines and tokens, and the same
three relative to the original file (`model.source`). `computeRegistryFigures(registry, model, tokenizer)` does this for the
default-option output of every text generator that accepts the model. Image generators are not part of it (FA-40 asks for pixel size and file
size there).

* `characters`: Unicode code points (not UTF-16 units, not bytes).
* `lines`: line-feed separated lines; a final line break does not start a line; the empty text has 0 lines.
* `tokens`: `tokenizer.count(text)`.
* `relative.*`: value divided by the value of the original file, a string with exactly four decimals (`"0.3333"`), or `null` when the
  original's value is 0. A bare number is never produced: the `tokenizer` object (`id`, `name`, `implementation` with version) is a required
  part of the result, so a user interface cannot show a token count without naming the tokenizer (FA-42). The sentence that
  token counts depend on the LLM belongs to the user interface; the data carries what the sentence needs.

## Tokenizer (E-5)

`Tokenizer` is `{info, count(text)}`; any module that satisfies it can replace the default. The default is **o200k_base** through
[gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) 4.1.1 (MIT), loaded by `loadDefaultTokenizer()` with a dynamic import so that the vocabulary can be split from the
rest of the bundle. Special-token strings such as `<|endoftext|>` inside a model are counted as ordinary text. No estimating
formula exists anywhere, also not as a fallback: when the tokenizer cannot be loaded, the call fails.
Choice and checks of the library: `HANDOVER.md`, H49. The reference values the tests use are those of the OpenAI cookbook ("How to count
tokens with tiktoken").
