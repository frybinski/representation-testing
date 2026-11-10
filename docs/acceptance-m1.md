# Acceptance of milestone M1: which test proves which point

Section 8 of `Planung.md` lists six points. Commands run in the repository root (in the dev container:
`docker exec repr-werkbank <command>`). `npm test` builds first (`tests/build-before-tests.ts`), so every command works on a fresh clone after `npm install`.

| # | Point (short) | Tests | Command |
| --- | --- | --- | --- |
| 1 | `npm test` is green; an expected output under `tests/golden/` for every example and every text representation | `tests/golden/golden.test.ts` (every file byte for byte, no missing, no surplus); the whole suite: `npm test` | `npx vitest run tests/golden/golden.test.ts` and `npm test` |
| 2 | The readers for Mermaid, JSON and compact notation return exactly the reported facts for every example | `packages/core/test/readback.test.ts` ("read-back: facts read from the generated text equal the facts reported as carried", loops over `allCases` = all examples and all special cases); `packages/core/test/property.test.ts` (random models) | `npx vitest run packages/core/test/readback.test.ts packages/core/test/property.test.ts` |
| 3 | For the original file the inventory is complete in every category, in every example | `packages/core/test/inventory.test.ts` ("shows the original file as complete in every category the model has"), loops over `exampleCases` | `npx vitest run packages/core/test/inventory.test.ts -t original` |
| 4 | Two runs of the command line tool on the same inputs give identical files (SHA-256) | `packages/cli/test/determinism.test.ts`: two runs, another working directory, `LANG`/`LC_ALL=tr_TR.UTF-8`, `TZ=Pacific/Kiritimati`, comparison with the golden bundles | `npx vitest run packages/cli/test/determinism.test.ts` |
| 5 | A workflow net with a known deadlock is reported not sound, a known sound net sound, a net over the state limit not decided | `packages/core/test/petri-analysis.test.ts` ("wf-sound is sound", "wf-deadlock is not sound", "wf-large exceeds the default limit and is not decided"); the report text in `packages/core/test/structure-report.test.ts`; the reports of all three are in `tests/golden/pnml/*/structure-report*` | `npx vitest run packages/core/test/petri-analysis.test.ts packages/core/test/structure-report.test.ts` |
| 6 | A file with an unsupported element gives the FA-04 message | `packages/core/test/fa04-detect.test.ts` (notices and errors of the parsers, fixtures `unsupported-elements.bpmn`/`.pnml`, `not-wellformed.bpmn`); `packages/cli/test/cli.test.ts` ("failing and unusual input (FA-04)": the message names file, line, cause and type/id, other files go on, exit code) | `npx vitest run packages/cli/test/cli.test.ts packages/core/test/fa04-detect.test.ts` |

Further tests of section 9: property tests (`property.test.ts`), error cases of FA-04 (above), the scan of the built state for foreign servers
(`tests/no-external-references.test.ts`, R-2).
