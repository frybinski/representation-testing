/** Name of the tool as it appears in every export (FA-82). */
export const TOOL_NAME = 'repr-werkbank' as const;

/**
 * The version of the tool (SemVer, FA-82) and the only place in the code where it is written. `test/bundle.test.ts` compares it with
 * every `package.json` of the repository, so a version step is made here and in those files together.
 */
export const VERSION = '0.2.0' as const;
