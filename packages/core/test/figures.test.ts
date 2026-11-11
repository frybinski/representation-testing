import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computeFigures,
  computeRegistryFigures,
  countLines,
  createDefaultRegistry,
  FIGURES_FORMAT,
  FIGURES_VERSION,
  generateAll,
  GPT_TOKENIZER_VERSION,
  loadDefaultTokenizer,
  measureText,
  O200K_INFO,
  parseModel,
  imageFigureRow,
  utf8Encode,
  type Figures,
  type ImageFigureRow,
  type TextFigureRow,
  type Tokenizer,
} from '../src/index.js';
import { allCases, exampleCases, modelOf } from './special.js';

const schema = JSON.parse(readFileSync(new URL('../../../docs/figures.schema.json', import.meta.url), 'utf8')) as {
  properties: Record<string, unknown>;
  required: string[];
  $defs: Record<string, { properties: Record<string, unknown> }>;
};

let tok: Tokenizer;
beforeAll(async () => {
  tok = await loadDefaultTokenizer();
});

describe('default tokenizer (FA-41)', () => {
  it('reproduces the reference value of the tiktoken documentation for o200k_base', () => {
    // OpenAI cookbook, "How to count tokens with tiktoken": encoding o200k_base, "tiktoken is great!" -> [83, 8251, 2488, 382, 2212, 0]
    expect(tok.count('tiktoken is great!')).toBe(6);
  });

  it('is o200k_base and not another encoding: the same text has a different count under cl100k_base elsewhere', async () => {
    // cl100k_base gives [83, 1609, 5963, 374, 2294, 0] for the cookbook string (also 6 tokens), so the ids are checked as well.
    const lib = await import('gpt-tokenizer/encoding/o200k_base');
    expect(lib.encode('tiktoken is great!')).toEqual([83, 8251, 2488, 382, 2212, 0]);
    expect(lib.encode('hello world')).toEqual([24912, 2375]);
    const old = await import('gpt-tokenizer/encoding/cl100k_base');
    expect(old.encode('hello world')).toEqual([15339, 1917]);
  });

  it('counts the empty text as zero and treats special-token strings as ordinary text', () => {
    expect(tok.count('')).toBe(0);
    expect(tok.count('a <|endoftext|> b')).toBe(9);
  });

  it('is deterministic and names itself with name and version of the implementation', () => {
    const text = readFileSync(new URL('../../../examples/bpmn/order-handling.bpmn', import.meta.url), 'utf8');
    expect(tok.count(text)).toBe(tok.count(text));
    expect(tok.info).toEqual(O200K_INFO);
    expect(tok.info.implementation).toBe(`gpt-tokenizer ${GPT_TOKENIZER_VERSION}`);
  });

  it('declares the version that is installed', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../node_modules/gpt-tokenizer/package.json', import.meta.url), 'utf8')) as { version: string };
    expect(pkg.version).toBe(GPT_TOKENIZER_VERSION);
  });

  it('keeps core free of node: imports in the source of the tokenizer module', () => {
    for (const f of ['tokenizer.ts', 'figures.ts']) {
      expect(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).not.toMatch(/from\s+'node:|import\(\s*'node:/);
    }
  });
});

describe('figures (FA-40, FA-42)', () => {
  const fake: Tokenizer = { info: { id: 'fake', name: 'Fake', implementation: 'test 0' }, count: (t) => t.split(/\s+/).filter(Boolean).length };

  it('counts characters as code points and lines without a trailing line break', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\n\nb\n')).toBe(3);
    expect(measureText('a😀b\n', fake)).toEqual({ characters: 4, lines: 1, tokens: 1, tokenizer: 'fake' });
  });

  it('computes relative values by hand: original 9 characters, 2 lines, 3 words', () => {
    const model = { ...modelOf(exampleCases[0]!), source: 'ab cd\nef\n' };
    // original: "ab cd\nef\n" = 9 characters, 2 lines, 3 "tokens". Text "ab\n": 3 characters, 1 line, 1 token.
    // ratios: 3/9 = 0.3333, 1/2 = 0.5000, 1/3 = 0.3333
    const f = computeFigures(model, [{ id: 'x', text: 'ab\n' }, { id: 'same', text: model.source }], fake);
    expect(f.original).toEqual({ characters: 9, lines: 2, tokens: 3, tokenizer: 'fake' });
    expect(f.rows[0]).toEqual({ id: 'x', kind: 'text', characters: 3, lines: 1, tokens: 1, tokenizer: 'fake', relative: { characters: '0.3333', lines: '0.5000', tokens: '0.3333' } });
    expect((f.rows[1] as TextFigureRow).relative).toEqual({ characters: '1.0000', lines: '1.0000', tokens: '1.0000' });
    expect(f.tokenizer).toEqual(fake.info);
  });

  it('gives null ratios when the original is empty', () => {
    const model = { ...modelOf(exampleCases[0]!), source: '' };
    const f = computeFigures(model, [{ id: 'x', text: 'a' }], fake);
    expect((f.rows[0] as TextFigureRow).relative).toEqual({ characters: null, lines: null, tokens: null });
  });

  it('covers every text generator for the formalism, with the original at ratio 1.0000, and names the tokenizer', () => {
    const registry = createDefaultRegistry();
    const model = parseModel(exampleCases.find((c) => c.name.endsWith('wf-sound.pnml'))!.text);
    const f = computeRegistryFigures(model, generateAll(registry, model), tok);
    expect(f.tokenizer).toEqual(O200K_INFO);
    expect(f.rows.map((r) => r.id)).toEqual(registry.listFor('pnml').map((g) => g.id));
    expect((f.rows.find((r) => r.id === 'original') as TextFigureRow).relative).toEqual({ characters: '1.0000', lines: '1.0000', tokens: '1.0000' });
    expect(f.original.tokens).toBe(tok.count(model.source));
    expect((f.rows.find((r) => r.id === 'compact') as TextFigureRow).tokens).toBeLessThan(f.original.tokens);
  });

  it('is identical across runs', () => {
    const registry = createDefaultRegistry();
    const model = modelOf(exampleCases[0]!);
    expect(JSON.stringify(computeRegistryFigures(model, generateAll(registry, model), tok))).toBe(JSON.stringify(computeRegistryFigures(model, generateAll(registry, model), tok)));
  });
});

describe('image rows (FA-40, figures version 3)', () => {
  it('give pixel size and the UTF-8 byte size of the SVG, and nothing relative to the original', () => {
    const registry = createDefaultRegistry();
    for (const c of allCases) {
      const model = modelOf(c);
      const generated = generateAll(registry, model);
      const f = computeRegistryFigures(model, generated, tok);
      const row = f.rows.find((r) => r.id === 'diagram') as ImageFigureRow;
      const out = generated.find((g) => g.id === 'diagram')!.output;
      expect(out.kind).toBe('image');
      if (out.kind !== 'image') continue;
      expect(row).toEqual({ id: 'diagram', kind: 'image', width: out.width, height: out.height, bytes: utf8Encode(out.svg).length });
      expect(Object.keys(row)).toEqual(['id', 'kind', 'width', 'height', 'bytes']);
    }
  });

  it('counts bytes, not characters', () => {
    expect(imageFigureRow('x', { svg: 'a\u00e4\u20ac\u{1f600}', width: 3, height: 4 }).bytes).toBe(1 + 2 + 3 + 4);
  });
});

describe('docs/figures.schema.json', () => {
  it('has the keys and constants of the TypeScript type', () => {
    const keys: Record<keyof Figures, true> = { format: true, version: true, tokenizer: true, original: true, rows: true };
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(keys).sort());
    expect([...schema.required].sort()).toEqual(Object.keys(keys).sort());
    expect((schema.properties.format as { const: string }).const).toBe(FIGURES_FORMAT);
    expect((schema.properties.version as { const: number }).const).toBe(FIGURES_VERSION);
    expect(Object.keys(schema.$defs.textSize!.properties).sort()).toEqual(['characters', 'lines', 'tokenizer', 'tokens']);
  });

  it('accepts the figures of all cases and rejects altered ones, in particular a bare number without tokenizer', () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const registry = createDefaultRegistry();
    for (const c of allCases) {
      const f = computeRegistryFigures(modelOf(c), generateAll(registry, modelOf(c)), tok);
      expect(validate(f), `${c.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      const bare = Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'tokenizer'));
      expect(validate(bare)).toBe(false);
      expect(validate({ ...f, extra: 1 })).toBe(false);
      const image = f.rows.findIndex((r) => r.kind === 'image');
      expect(image).toBeGreaterThanOrEqual(0);
      const withTokens = { ...f, rows: f.rows.map((r, i) => (i === image ? { ...r, tokens: 3 } : r)) };
      expect(validate(withTokens)).toBe(false);
      const noKind = { ...f, rows: f.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'kind'))) };
      expect(validate(noKind)).toBe(false);
    }
  });
});
