# Command line tool (FA-73)

`packages/cli` contains file access, argument handling and messages only. Every byte of a bundle comes from
`createBundle` and `serializeBundle` in the core, so the later web interface produces the same bundle.

```sh
npm install
npm run build
npm run repr -- examples --out out          # same as: node packages/cli/dist/bin.js examples --out out
npm run repr -- examples --out out --option verbalization.language=en --option structure-report.language=de
npm run repr -- --list-options
```

## Finding files

- The input directory is searched recursively. Files with the extension `.bpmn`, `.pnml` or `.xml` (any case) are models.
  The format is detected from the content only (FA-01); the extension only selects the candidates.
- Entries whose name starts with a dot are ignored silently. Other files, symbolic links and special files are
  listed as `skipped: <path> (<reason>)`.
- Paths are relative to the input directory, use `/`, and are sorted by UTF-16 code unit. This is the order of processing
  and of all printed lines; the listing order of the file system plays no role.

## Output names

`<output-dir>/<relative path including extension>.bundle.json`, e.g. `examples/bpmn/collaboration.bpmn` becomes
`out/bpmn/collaboration.bpmn.bundle.json`. The extension stays in the name, so `a.bpmn` and `a.pnml` do not collide.
Two outputs that differ only by case collide on case-insensitive file systems; the CLI compares names without case,
processes the first file, reports the later one as an error (`output name ... collides with the output of ...`) and does
not overwrite. Existing files of the same name from an earlier run are overwritten. The output directory is created.

## Options

`--option <generator>.<key>=<value>`, repeatable, applied to every model. Values are converted by the option's type
(`--list-options` shows generator, key, type, choices, range and default). An unknown generator, an unknown key or a
value out of range is a usage error (exit 2) before any file is read. Options for a generator that does not accept the
formalism of a file (for example `compact` for BPMN) are ignored for that file. The options in effect, defaults filled
in, are recorded in `metadata.generators` of every bundle.

## What is printed

stdout, per file: `ok: <path> (<formalism>) -> <output path>`, then one indented line per notice
(`notice: <kind> <type> (<namespace>) xN: <id> [detail] at line L; ...`, FA-04, FA-10, FA-11), then one line per
representation: `<id>: N characters, N lines, N tokens (tokenizer <id>)` (FA-41), and for the diagram `diagram: W x H px, N bytes` (FA-40). Then the `skipped:` lines and
the last line `N read, N failed, N skipped`.

stderr: `error: <path>: line L, column C: <message> [<code>]` for a file that cannot be read as a model (FA-04), or
`error: <path>: the file is not valid UTF-8`. A failing file does not stop the others.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every model file was processed; notices are not failures |
| 1 | at least one file failed (parse error, invalid UTF-8, output collision, write error) or no model file was found |
| 2 | wrong usage: bad arguments or options, missing `--out`, unreadable input directory |

## Input bytes

Files are decoded as strict UTF-8; a byte order mark is kept, so the SHA-256 in the bundle is the hash of the file.
