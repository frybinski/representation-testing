# Golden tests (acceptance point 1)

`tests/golden/<example path>/` holds one expected output for every example model in `examples/` (e.g.
`tests/golden/bpmn/collaboration.bpmn/`):

- one file per text representation and per addition, named `<generator id>[.<language>].<extension>`; the
  generators with a `language` option (`verbalization`, `structure-report`) are recorded in `de` and `en`; all other
  options are the defaults;
- `diagram.svg` (default options: layout from the file when the file has a complete layout) and `diagram.auto.svg` (automatic
  layout), the diagram of `docs/diagram.md`;
- `bundle.json`: the complete export bundle with default options (`docs/bundle.md`).

`tests/golden/golden.test.ts` produces everything again in memory and compares it byte for byte with the files. It fails
on a differing file, on a missing golden file and on a surplus file in a subdirectory. It never writes.

## What a changed golden file means

A golden file only changes when the output of a generator, the bundle or the figures changes. That is a change of the
tool's output, so it needs, in the same commit: a version step according to SemVer (`packages/core/src/version.ts` and
all `package.json` files, FA-82), a `CHANGELOG.md` entry that names the generator, and a look at the diff of the golden
files to confirm that exactly the intended lines changed.

## Updating

```sh
npm run golden:update
git diff --stat tests/golden
```

The command (`vitest.golden.config.ts`, `tests/golden/update.script.ts`) deletes all golden files and writes them
again from the current code. It is not part of `npm test` and no test calls it.

## Line endings

`.gitattributes` marks `tests/golden/**` and `examples/**` as `-text`: Git does no end-of-line conversion on checkout or
commit, on any platform. All generated texts use LF. `git ls-files --eol tests/golden examples` shows `i/lf w/lf attr/-text`
for every file; the comparison reads bytes, so a changed line ending would fail the test.
