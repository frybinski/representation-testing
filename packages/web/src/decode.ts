/**
 * Decoding of a file the user gives to the page. It must equal what the command line tool does (packages/cli/src/cli.ts), so that the
 * SHA-256 of the input and every byte of the bundle match: strict UTF-8, and a byte order mark is kept as the character U+FEFF.
 * Throws a TypeError for bytes that are not valid UTF-8.
 */
export function decodeInput(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function isDecodeError(e: unknown): boolean {
  return e instanceof TypeError && /decode|encoded/i.test(e.message);
}
