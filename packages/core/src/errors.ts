export const PARSE_ERROR_CODES = [
  'empty',
  'not-wellformed',
  'unrecognized-format',
  'duplicate-id',
  'unresolved-reference',
  'invalid-reference',
  'invalid-value',
  'unsupported-net-type',
  'missing-attribute',
] as const;
export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

/** Thrown for input that cannot be read (FA-04). `line` and `column` are 1-based. */
export class ParseError extends Error {
  readonly code: ParseErrorCode;
  readonly line: number;
  readonly column: number;

  constructor(code: ParseErrorCode, message: string, line: number, column: number) {
    super(`line ${String(line)}: ${message}`);
    this.name = 'ParseError';
    this.code = code;
    this.line = line;
    this.column = column;
  }
}
