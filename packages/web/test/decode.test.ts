import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createBundle, createDefaultRegistry, loadDefaultTokenizer, sha256Bytes, sha256Text } from '@repr-werkbank/core';
import { decodeInput, isDecodeError } from '../src/decode.ts';

// The page decodes a file exactly as the command line tool does (3.2), so that the SHA-256 and the bundle bytes agree.
const cli = new URL('../../cli/dist/bin.js', import.meta.url).pathname;
const example = readFileSync(new URL('../../../examples/bpmn/order-handling.bpmn', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'repr-decode-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), example]);
const invalid = Buffer.concat([example.subarray(0, 100), Buffer.from([0xff, 0xfe, 0xc3, 0x28]), example.subarray(100)]);

function runCli(name: string, bytes: Buffer): { status: number | null; stderr: string; bundle: string | null } {
  // The tool reads a directory; each case has its own, with one file named like the case.
  const input = join(dir, `in-${name}`);
  const out = join(dir, `out-${name}`);
  mkdirSync(input, { recursive: true });
  writeFileSync(join(input, `${name}.bpmn`), bytes);
  const r = spawnSync(process.execPath, [cli, input, '--out', out], { encoding: 'utf8' });
  let bundle: string | null;
  try {
    bundle = readFileSync(join(out, `${name}.bpmn.bundle.json`), 'utf8');
  } catch {
    bundle = null;
  }
  return { status: r.status, stderr: r.stderr, bundle };
}

describe('decoding of a file (FA-01, 3.2)', () => {
  it('keeps a byte order mark as U+FEFF', () => {
    const text = decodeInput(new Uint8Array(withBom));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(decodeInput(new Uint8Array(example)).charCodeAt(0)).not.toBe(0xfeff);
  });

  it('rejects bytes that are not UTF-8', () => {
    let error: unknown;
    try {
      decodeInput(new Uint8Array(invalid));
    } catch (e) {
      error = e;
    }
    expect(isDecodeError(error)).toBe(true);
  });

  it.each([
    ['plain', example],
    ['bom', withBom],
  ])('gives the bundle of the command line tool for a file %s', async (name, bytes) => {
    const cliRun = runCli(name, bytes);
    expect(cliRun.status).toBe(0);
    const text = decodeInput(new Uint8Array(bytes));
    expect(sha256Text(text)).toBe(sha256Bytes(new Uint8Array(bytes)));
    const bundle = createBundle(text, { tokenizer: await loadDefaultTokenizer(), registry: createDefaultRegistry(), inputName: `${name}.bpmn` });
    expect(`${JSON.stringify(bundle, null, 2)}\n`).toBe(cliRun.bundle);
  });

  it('fails where the command line tool fails', () => {
    const cliRun = runCli('invalid', invalid);
    expect(cliRun.status).toBe(1);
    expect(cliRun.stderr).toContain('not valid UTF-8');
    expect(() => decodeInput(new Uint8Array(invalid))).toThrow();
  });
});
