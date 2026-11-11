// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, parseModel } from '@repr-werkbank/core';
import { languageOfMime, tokenize, toLines, type SyntaxLanguage } from '../src/syntax.ts';
import { buildCode } from '../src/views/text-view.ts';

// UI-07: restrained highlighting. The tokens joined are the text, byte for byte, so what the person sees and copies is what the core made.
const examplesDir = join(import.meta.dirname, '../../../examples');
const registry = createDefaultRegistry();

const cases: { name: string; language: SyntaxLanguage; text: string }[] = [];
for (const folder of readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const file of readdirSync(join(examplesDir, folder.name)).filter((f) => /\.(bpmn|pnml)$/.test(f))) {
    const model = parseModel(readFileSync(join(examplesDir, folder.name, file), 'utf8'));
    for (const def of registry.listFor(model.formalism).filter((d) => d.kind === 'text')) {
      const out = registry.run(def.id, model);
      if (out.kind === 'text') cases.push({ name: `${file} ${def.id}`, language: languageOfMime(def.mime), text: out.text });
    }
  }
}

describe('syntax tokenizers', () => {
  it('cover representations of every language', () => {
    expect(new Set(cases.map((c) => c.language))).toEqual(new Set(['xml', 'json', 'mermaid', 'plain']));
  });

  it.each(cases.map((c) => [c.name, c] as const))('keep %s byte-identical', (_name, c) => {
    const tokens = tokenize(c.text, c.language);
    expect(tokens.map((t) => t.text).join('')).toBe(c.text);
    expect(toLines(tokens).flat().map((t) => t.text).join('')).toBe(c.text);
  });

  it('keep the text of the DOM identical to the generated text', () => {
    for (const c of cases) {
      const { code, lineCount } = buildCode(c.text, c.language);
      expect(code.textContent, c.name).toBe(c.text);
      expect(lineCount).toBe(c.text.endsWith('\n') ? c.text.split('\n').length - 1 : c.text.split('\n').length);
    }
  });

  it('keep awkward input intact', () => {
    const odd = ['', '\n', '\n\n', '<', '<a', '<a b="c', '<!-- x', '<?xml', '<![CDATA[ x', 'a < b', '{"a": "b\\"', '"unterminated\n', 'flowchart LR\n  A -->|"x"| B\n%% c', '\r\n\r\n', 'tab\there\n'];
    for (const language of ['xml', 'json', 'mermaid', 'plain'] as const) {
      for (const text of odd) {
        expect(tokenize(text, language).map((t) => t.text).join(''), `${language} ${JSON.stringify(text)}`).toBe(text);
        expect(toLines(tokenize(text, language)).flat().map((t) => t.text).join('')).toBe(text);
      }
    }
  });

  it('classify the parts of XML', () => {
    const tokens = tokenize('<a:b c="d"/>', 'xml');
    expect(tokens).toEqual([{ text: '<' }, { text: 'a:b', cls: 'name' }, { text: ' ' }, { text: 'c', cls: 'attr' }, { text: '=' }, { text: '"d"', cls: 'string' }, { text: '/>' }]);
  });

  it('classify JSON keys, strings and values', () => {
    const tokens = tokenize('{"k": "v", "n": 12, "b": true}', 'json');
    expect(tokens.filter((t) => t.cls === 'attr').map((t) => t.text)).toEqual(['"k"', '"n"', '"b"']);
    expect(tokens.filter((t) => t.cls === 'string').map((t) => t.text)).toEqual(['"v"']);
    expect(tokens.filter((t) => t.cls === 'name').map((t) => t.text)).toEqual(['12', 'true']);
  });

  it('classify Mermaid keywords, arrows, strings and comments', () => {
    const tokens = tokenize('flowchart LR\n  A("x") --> B\n  %% note', 'mermaid');
    expect(tokens.find((t) => t.cls === 'name')?.text).toBe('flowchart');
    expect(tokens.find((t) => t.cls === 'attr')?.text).toBe('-->');
    expect(tokens.find((t) => t.cls === 'string')?.text).toBe('"x"');
    expect(tokens.find((t) => t.cls === 'comment')?.text).toContain('%% note');
  });

  it('never turns model text into markup', () => {
    const { code } = buildCode('<img src=x onerror=alert(1)>', 'xml');
    expect(code.querySelector('img')).toBeNull();
    expect(code.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('chooses the language by mime type', () => {
    expect(languageOfMime('application/xml')).toBe('xml');
    expect(languageOfMime('application/json')).toBe('json');
    expect(languageOfMime('text/vnd.mermaid')).toBe('mermaid');
    expect(languageOfMime('text/plain')).toBe('plain');
  });
});
