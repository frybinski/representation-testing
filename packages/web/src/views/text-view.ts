import { el } from '../dom.ts';
import { tokenize, toLines, type SyntaxLanguage } from '../syntax.ts';

/**
 * Builds the lines of a text view (UI-07). The line numbers are CSS counters (`::before`), so the text content of the returned element
 * is exactly `text` (tested): copying a selection never takes numbers along, and the syntax highlighting only adds `<span>` wrappers.
 * Each line is its own block, so numbers stay aligned when long lines wrap.
 */
export function buildCode(text: string, language: SyntaxLanguage): { code: HTMLElement; lineCount: number } {
  const lines = toLines(tokenize(text, language));
  const code = el('div', { class: 'code', 'data-lines': String(lines.length) });
  code.style.setProperty('--digits', String(Math.max(2, String(lines.length).length)));
  const fragment = document.createDocumentFragment();
  for (const tokens of lines) {
    const content = el('span', { class: 'lt' });
    for (const tok of tokens) {
      if (tok.cls === undefined) content.append(tok.text);
      else content.append(el('span', { class: `tok-${tok.cls}` }, tok.text));
    }
    fragment.append(el('div', { class: 'line' }, content));
  }
  code.append(fragment);
  return { code, lineCount: lines.length };
}
