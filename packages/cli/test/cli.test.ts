import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBundle, loadDefaultTokenizer, serializeBundle, VERSION, type Bundle } from '@repr-werkbank/core';
import { run } from '../src/run.js';

const root = new URL('../../../', import.meta.url).pathname;
const examples = join(root, 'examples');
const fixtures = join(root, 'packages/core/test/fixtures');

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'repr-cli-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

async function cli(args: string[], cwd = work): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .sort();

describe('usage', () => {
  it('prints help and version with exit code 0', async () => {
    expect((await cli(['--help'])).out).toContain('Usage: repr-werkbank');
    expect((await cli(['--version'])).out).toBe(`repr-werkbank ${VERSION}\n`);
    expect((await cli(['--list-options'])).out).toContain('verbalization.language=<');
  });

  it('exits with 2 for wrong usage and writes nothing', async () => {
    for (const args of [[], [examples], ['--out', 'o'], [examples, '--out', 'o', '--bogus'], [examples, '--out', 'o', '--option', 'x'], [examples, '--out', 'o', '--option', 'nope.a=1'], [examples, '--out', 'o', '--option', 'mermaid.nope=1'], [examples, '--out', 'o', '--option', 'structure-report.maxStates=5'], ['missing-dir', '--out', 'o']]) {
      const r = await cli(args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.err).toContain('error:');
    }
    expect(readdirSync(work)).toEqual([]);
  });
});

describe('examples', () => {
  it('writes one bundle per example, named after the full file name, with the content of the core function', async () => {
    const r = await cli([examples, '--out', 'out']);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const names = files(join(work, 'out'));
    expect(names).toEqual([
      'bpmn',
      'bpmn/collaboration.bpmn.bundle.json',
      'bpmn/order-handling.bpmn.bundle.json',
      'pnml',
      'pnml/pm4py-dialect.pnml.bundle.json',
      'pnml/producer-consumer.pnml.bundle.json',
      'pnml/wf-deadlock.pnml.bundle.json',
      'pnml/wf-large.pnml.bundle.json',
      'pnml/wf-sound.pnml.bundle.json',
    ]);
    const tok = await loadDefaultTokenizer();
    const text = readFileSync(join(examples, 'pnml/wf-sound.pnml'), 'utf8');
    expect(readFileSync(join(work, 'out/pnml/wf-sound.pnml.bundle.json'), 'utf8')).toBe(serializeBundle(createBundle(text, { tokenizer: tok, inputName: 'pnml/wf-sound.pnml' })));
    expect(r.out).toContain('tokenizer o200k_base');
    expect(r.out).toContain('skipped: LICENSE (extension is not');
    expect(r.out.trimEnd().split('\n').at(-1)).toBe('7 read, 0 failed, 2 skipped');
  }, 60_000);

  it('prints the same text from another working directory and with absolute or relative paths', async () => {
    const a = await cli([examples, '--out', 'out']);
    const b = await cli(['examples', '--out', join(work, 'other')], root);
    expect(b.out).toBe(a.out);
    expect(readFileSync(join(work, 'other/bpmn/order-handling.bpmn.bundle.json'), 'utf8')).toBe(readFileSync(join(work, 'out/bpmn/order-handling.bpmn.bundle.json'), 'utf8'));
  }, 60_000);
});

describe('options', () => {
  it('passes options to the generators and records them', async () => {
    const dir = join(work, 'in');
    mkdirSync(dir);
    cpSync(join(examples, 'pnml/wf-sound.pnml'), join(dir, 'm.pnml'));
    const r = await cli([dir, '--out', 'out', '--option', 'structure-report.language=de', '--option', 'mermaid.direction=LR', '--option', 'structure-report.maxStates=5000']);
    expect(r.code).toBe(0);
    const bundle = JSON.parse(readFileSync(join(work, 'out/m.pnml.bundle.json'), 'utf8')) as Bundle;
    const opts = Object.fromEntries(bundle.metadata.generators.map((g) => [g.id, g.options]));
    expect(opts['structure-report']).toMatchObject({ language: 'de', maxStates: 5000 });
    expect(opts.mermaid).toMatchObject({ direction: 'LR' });
    expect(bundle.structureReport?.text).toContain('Strukturbericht');
  });
});

describe('failing and unusual input (FA-04)', () => {
  it('names the unreadable file with line and cause, goes on with the others and exits with 1', async () => {
    const r = await cli([fixtures, '--out', 'out']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error: not-wellformed\.bpmn: line \d+, column \d+: .+ \[not-wellformed\]\n$/);
    expect(files(join(work, 'out'))).toEqual(['unsupported-elements.bpmn.bundle.json', 'unsupported-elements.pnml.bundle.json']);
    expect(r.out.trimEnd().split('\n').at(-1)).toBe('2 read, 1 failed, 0 skipped');
  });

  it('shows notices with type and identifier and exits with 0 when nothing failed (acceptance point 6)', async () => {
    const dir = join(work, 'in');
    mkdirSync(dir);
    cpSync(join(fixtures, 'unsupported-elements.bpmn'), join(dir, 'u.bpmn'));
    const r = await cli([dir, '--out', 'out']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('notice: unsupported-element callActivity x1: ca at line 18');
    expect(r.out).toContain('notice: unsupported-element boundaryEvent x2: b1 at line 16; b2 at line 17');
    expect(r.out).toContain('dropped-dependent sequenceFlow');
  });

  it('reports files that are not valid UTF-8 and empty files, and keeps going', async () => {
    const dir = join(work, 'in');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.bpmn'), Buffer.from([0x3c, 0xff, 0xfe]));
    writeFileSync(join(dir, 'b.pnml'), '');
    cpSync(join(examples, 'pnml/wf-sound.pnml'), join(dir, 'c.pnml'));
    const r = await cli([dir, '--out', 'out']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('error: a.bpmn: the file is not valid UTF-8');
    expect(r.err).toContain('error: b.pnml: ');
    expect(files(join(work, 'out'))).toEqual(['c.pnml.bundle.json']);
  });

  it('exits with 1 when no model file exists', async () => {
    mkdirSync(join(work, 'in'));
    const r = await cli([join(work, 'in'), '--out', 'out']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no model file');
  });
});

describe('discovery and order', () => {
  it('walks recursively, skips hidden and other files visibly, and processes in code unit order regardless of creation order', async () => {
    const dir = join(work, 'in');
    const src = readFileSync(join(examples, 'pnml/wf-sound.pnml'), 'utf8');
    for (const f of ['z.pnml', 'sub/b.PNML', 'sub/a.xml', 'B.pnml', 'a.pnml', '.hidden/x.pnml', 'notes.txt', 'sub/deep/c.pnml']) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), src);
    }
    const r = await cli([dir, '--out', 'out']);
    expect(r.code).toBe(0);
    const order = r.out.split('\n').filter((l) => l.startsWith('ok: ')).map((l) => l.split(' ')[1]);
    expect(order).toEqual(['B.pnml', 'a.pnml', 'sub/a.xml', 'sub/b.PNML', 'sub/deep/c.pnml', 'z.pnml']);
    expect(r.out).toContain('skipped: notes.txt (extension is not');
    expect(r.out).not.toContain('.hidden');
    expect(r.out.trimEnd().split('\n').at(-1)).toBe('6 read, 0 failed, 1 skipped');
  }, 60_000);

  it('reports outputs that would share a name on a file system that ignores case, and does not overwrite the first', async () => {
    const dir = join(work, 'in');
    mkdirSync(dir);
    const src = readFileSync(join(examples, 'pnml/wf-sound.pnml'), 'utf8');
    writeFileSync(join(dir, 'A.pnml'), src);
    writeFileSync(join(dir, 'a.pnml'), src);
    const r = await cli([dir, '--out', 'out']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('error: a.pnml: output name a.pnml.bundle.json collides with the output of A.pnml');
    expect(files(join(work, 'out'))).toEqual(['A.pnml.bundle.json']);
  });

  it('hashes the file bytes, including a byte order mark', async () => {
    const dir = join(work, 'in');
    mkdirSync(dir);
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(join(examples, 'pnml/wf-sound.pnml'))]);
    writeFileSync(join(dir, 'bom.pnml'), bytes);
    const r = await cli([dir, '--out', 'out']);
    expect(r.code).toBe(0);
    const bundle = JSON.parse(readFileSync(join(work, 'out/bom.pnml.bundle.json'), 'utf8')) as Bundle;
    expect(bundle.metadata.input.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
