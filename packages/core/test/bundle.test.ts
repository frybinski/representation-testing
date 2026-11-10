import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  createBundle,
  createDefaultRegistry,
  GeneratorError,
  loadDefaultTokenizer,
  O200K_INFO,
  ParseError,
  serializeBundle,
  sha256Bytes,
  sha256Text,
  TOOL_NAME,
  utf8Encode,
  VERSION,
  type Bundle,
  type GeneratorDefinition,
  type Tokenizer,
} from '../src/index.js';
import { allCases, exampleCases } from './special.js';

const read = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const json = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>;

let tok: Tokenizer;
beforeAll(async () => {
  tok = await loadDefaultTokenizer();
});

describe('version', () => {
  it('is the version of every package.json (one place in the code)', () => {
    expect(json('package.json').version).toBe(VERSION);
    for (const dir of readdirSync(new URL('../../', import.meta.url))) {
      expect(json(`packages/${dir}/package.json`).version, dir).toBe(VERSION);
    }
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('sha256 and utf8Encode', () => {
  const samples = ['', 'abc', 'ä', '日本語', '😀', 'a😀b', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'é'.repeat(100_000), '\ufeffBOM'];
  it('equals node:crypto over the UTF-8 bytes', () => {
    for (const s of samples) expect(sha256Text(s), JSON.stringify(s.slice(0, 20))).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
  it('encodes like TextEncoder, with U+FFFD for lone surrogates', () => {
    for (const s of [...samples, 'a\ud800b', '\udc00', 'end\ud83d']) expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
  });
  it('knows the standard test vector', () => {
    expect(sha256Bytes(utf8Encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('createBundle', () => {
  const registry = createDefaultRegistry();
  const bundles = new Map<string, Bundle>();
  const of = (name: string): Bundle => {
    let b = bundles.get(name);
    if (!b) bundles.set(name, (b = createBundle(allCases.find((c) => c.name === name)!.text, { tokenizer: tok, inputName: name })));
    return b;
  };

  it('validates against docs/bundle.schema.json for every example and special case', () => {
    const ajv = new Ajv2020({ strict: true });
    for (const f of ['model', 'figures', 'structure-report']) ajv.addSchema(json(`docs/${f}.schema.json`));
    const validate = ajv.compile(json('docs/bundle.schema.json'));
    for (const c of allCases) {
      const bundle = JSON.parse(serializeBundle(of(c.name))) as unknown;
      expect(validate(bundle), `${c.name}: ${JSON.stringify(validate.errors?.slice(0, 3))}`).toBe(true);
    }
    const altered = JSON.parse(serializeBundle(of(exampleCases[0]!.name))) as Record<string, unknown>;
    expect(validate({ ...altered, extra: 1 })).toBe(false);
    expect(validate({ ...altered, metadata: { ...(altered.metadata as object), input: { name: '/abs/x', sha256: 'zz' } } })).toBe(false);
  });

  it('keeps the schema in step with the constants', () => {
    const schema = json('docs/bundle.schema.json') as { properties: Record<string, { properties: Record<string, { properties: Record<string, { const: unknown }> }> }> };
    expect(schema.properties.metadata!.properties.bundle!.properties.format!.const).toBe(BUNDLE_FORMAT);
    expect(schema.properties.metadata!.properties.bundle!.properties.version!.const).toBe(BUNDLE_VERSION);
    expect(schema.properties.metadata!.properties.tool!.properties.name!.const).toBe(TOOL_NAME);
  });

  it('records tool, formalism, tokenizer, input hash and the options in effect', () => {
    const c = exampleCases.find((x) => x.name.endsWith('wf-sound.pnml'))!;
    const b = createBundle(c.text, { tokenizer: tok, inputName: 'some/dir/wf-sound.pnml', options: { 'structure-report': { language: 'de' }, mermaid: { direction: 'LR' } } });
    expect(b.metadata.tool).toEqual({ name: TOOL_NAME, version: VERSION });
    expect(b.metadata.formalism).toBe('pnml');
    expect(b.metadata.tokenizer).toEqual(O200K_INFO);
    expect(b.metadata.input).toEqual({ name: 'wf-sound.pnml', sha256: createHash('sha256').update(c.text, 'utf8').digest('hex') });
    const opts = Object.fromEntries(b.metadata.generators.map((g) => [g.id, g.options]));
    expect(opts['structure-report']).toEqual({ language: 'de', maxCycles: expect.any(Number) as number, maxStates: expect.any(Number) as number });
    expect(b.metadata.generators.map((g) => g.id)).toEqual(registry.listFor('pnml').map((g) => g.id));
    for (const g of b.metadata.generators) expect(Object.keys(g.options)).toEqual(registry.get(g.id).options.map((o) => o.key));
    expect(b.structureReport!.text).toContain('Strukturbericht');
    expect(b.figures.rows.every((r) => r.tokenizer === O200K_INFO.id)).toBe(true);
    expect(b.figures.original.tokenizer).toBe(O200K_INFO.id);
  });

  it('applies defaults without options and rejects unknown generators and bad options', () => {
    const c = exampleCases[0]!;
    const plain = createBundle(c.text, { tokenizer: tok });
    expect(plain.metadata.input.name).toBeNull();
    expect(() => createBundle(c.text, { tokenizer: tok, options: { nope: {} } })).toThrow(GeneratorError);
    expect(() => createBundle(c.text, { tokenizer: tok, options: { json: { nope: 1 } } })).toThrow(GeneratorError);
  });

  it('leaves out the source text field and carries notices', () => {
    const b = of(exampleCases[0]!.name);
    expect(Object.keys(b)).toEqual(['metadata', 'notices', 'representations', 'figures', 'inventory', 'structureReport']);
    expect(Object.keys(b.representations.find((r) => r.id === 'original')!)).toEqual(['id', 'extension', 'mime', 'text']);
    const withNotices = createBundle(read('packages/core/test/fixtures/unsupported-elements.bpmn'), { tokenizer: tok });
    expect(withNotices.notices.length).toBeGreaterThan(0);
  });

  it('throws ParseError for unreadable input', () => {
    expect(() => createBundle(read('packages/core/test/fixtures/not-wellformed.bpmn'), { tokenizer: tok })).toThrow(ParseError);
  });

  it('serialises to identical bytes with LF only and one final LF', () => {
    for (const c of allCases) {
      const a = serializeBundle(createBundle(c.text, { tokenizer: tok }));
      expect(a).toBe(serializeBundle(createBundle(c.text, { tokenizer: tok })));
      expect(a.endsWith('}\n')).toBe(true);
      expect(a.endsWith('\n\n')).toBe(false);
      // CR can only occur escaped inside JSON strings, never as a line break of the file.
      expect(a.includes('\r')).toBe(false);
      expect(a).not.toContain('/Users/');
      expect(a).not.toContain('/workspaces/');
    }
  });

  it('runs every generator once per model', () => {
    const counting = createDefaultRegistry();
    const calls = new Map<string, number>();
    const wrapped = new (counting.constructor as new () => typeof counting)();
    for (const def of counting.list()) {
      const w: GeneratorDefinition = { ...def, generate: (m, o) => { calls.set(def.id, (calls.get(def.id) ?? 0) + 1); return def.generate(m, o); } };
      wrapped.register(w);
    }
    createBundle(exampleCases.find((x) => x.name.endsWith('wf-sound.pnml'))!.text, { tokenizer: tok, registry: wrapped });
    expect(calls.size).toBeGreaterThan(5);
    for (const [id, n] of calls) expect(n, id).toBe(1);
  });
});
