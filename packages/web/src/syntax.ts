/**
 * Restrained syntax highlighting for the text views (UI-07): three small tokenizers for XML, JSON and Mermaid. A tokenizer only
 * splits the text; the tokens joined together are exactly the input (test/syntax.test.ts), so what the person sees and copies is the
 * generated text byte for byte. The language of a representation comes from the metadata of its generator (mime type).
 */

export type TokenClass = 'name' | 'attr' | 'string' | 'comment';
export interface Token {
  text: string;
  /** Absent for plain text. */
  cls?: TokenClass;
}
export type SyntaxLanguage = 'xml' | 'json' | 'mermaid' | 'plain';

/** Language of a generator output from its mime type; anything unknown is plain text. */
export function languageOfMime(mime: string): SyntaxLanguage {
  if (mime === 'application/xml' || mime === 'image/svg+xml') return 'xml';
  if (mime === 'application/json') return 'json';
  if (mime === 'text/vnd.mermaid') return 'mermaid';
  return 'plain';
}

class Out {
  readonly tokens: Token[] = [];
  push(text: string, cls?: TokenClass): void {
    if (text === '') return;
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.cls === cls) last.text += text;
    else this.tokens.push(cls === undefined ? { text } : { text, cls });
  }
}

function xml(text: string): Token[] {
  const out = new Out();
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      out.push(text.slice(i));
      break;
    }
    out.push(text.slice(i, lt));
    i = lt;
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const stop = end < 0 ? n : end + 3;
      out.push(text.slice(i, stop), 'comment');
      i = stop;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      const stop = end < 0 ? n : end + 2;
      out.push(text.slice(i, stop), 'comment');
      i = stop;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      const stop = end < 0 ? n : end + 3;
      out.push(text.slice(i, stop), 'string');
      i = stop;
    } else if (/^<\/?[A-Za-z_:]/.test(text.slice(i, i + 3))) {
      const open = text[i + 1] === '/' ? 2 : 1;
      out.push(text.slice(i, i + open));
      i += open;
      const name = /^[^\s/>]+/.exec(text.slice(i, i + 200))?.[0] ?? '';
      out.push(name, 'name');
      i += name.length;
      // Inside the tag: attributes up to `>`.
      while (i < n && text[i] !== '>') {
        const c = text[i] as string;
        if (c === '"' || c === "'") {
          const end = text.indexOf(c, i + 1);
          const stop = end < 0 ? n : end + 1;
          out.push(text.slice(i, stop), 'string');
          i = stop;
        } else if (/[\s=/]/.test(c)) {
          out.push(c);
          i++;
        } else {
          let j = i;
          while (j < n && !/[\s=/>"']/.test(text[j] as string)) j++;
          if (j === i) j = i + 1;
          out.push(text.slice(i, j), 'attr');
          i = j;
        }
      }
      if (i < n) {
        out.push('>');
        i++;
      }
    } else {
      out.push('<');
      i++;
    }
  }
  return out.tokens;
}

function json(text: string): Token[] {
  const out = new Out();
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, n);
      const isKey = /^\s*:/.test(text.slice(stop, stop + 40));
      out.push(text.slice(i, stop), isKey ? 'attr' : 'string');
      i = stop;
    } else if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z]/.test(text[j] as string)) j++;
      const word = text.slice(i, j);
      out.push(word, word === 'true' || word === 'false' || word === 'null' ? 'name' : undefined);
      i = j;
    } else if (/[-\d]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\d.eE+-]/.test(text[j] as string)) j++;
      out.push(text.slice(i, j), 'name');
      i = j;
    } else {
      out.push(c);
      i++;
    }
  }
  return out.tokens;
}

const MERMAID_KEYWORDS = /^(\s*)(flowchart|graph|subgraph|end|direction|classDef|class|style|linkStyle|click)\b/;
const MERMAID_ARROW = /^(?:<?[-=]{2,}>?|-\.+-?>?|-\.-)/;

function mermaid(text: string): Token[] {
  const out = new Out();
  const lines = text.split('\n');
  lines.forEach((line, k) => {
    const last = k === lines.length - 1;
    if (/^\s*%%/.test(line)) {
      out.push(line, 'comment');
    } else {
      const kw = MERMAID_KEYWORDS.exec(line);
      let i = 0;
      if (kw) {
        out.push(kw[1] as string);
        out.push(kw[2] as string, 'name');
        i = kw[0].length;
      }
      while (i < line.length) {
        const c = line[i] as string;
        if (c === '"') {
          const end = line.indexOf('"', i + 1);
          const stop = end < 0 ? line.length : end + 1;
          out.push(line.slice(i, stop), 'string');
          i = stop;
          continue;
        }
        const arrow = MERMAID_ARROW.exec(line.slice(i, i + 12));
        if (arrow) {
          out.push(arrow[0], 'attr');
          i += arrow[0].length;
          continue;
        }
        out.push(c);
        i++;
      }
    }
    if (!last) out.push('\n');
  });
  return out.tokens;
}

/** Splits `text` into tokens. The texts of the tokens joined are `text`. */
export function tokenize(text: string, language: SyntaxLanguage): Token[] {
  if (language === 'xml') return xml(text);
  if (language === 'json') return json(text);
  if (language === 'mermaid') return mermaid(text);
  return text === '' ? [] : [{ text }];
}

/** Tokens split at line feeds: one array per line; every line but the last ends with its `\n`. Joined, the lines are the text. */
export function toLines(tokens: readonly Token[]): Token[][] {
  const lines: Token[][] = [[]];
  const add = (line: Token[], text: string, cls: TokenClass | undefined): void => {
    if (text === '') return;
    const last = line[line.length - 1];
    if (last && last.cls === cls) last.text += text;
    else line.push(cls === undefined ? { text } : { text, cls });
  };
  for (const tok of tokens) {
    tok.text.split('\n').forEach((part, k) => {
      if (k > 0) {
        // The line feed belongs to the line it ends.
        add(lines[lines.length - 1] as Token[], '\n', tok.cls);
        lines.push([]);
      }
      add(lines[lines.length - 1] as Token[], part, tok.cls);
    });
  }
  // A text that ends with a line feed has an empty last line that is not a line.
  const lastLine = lines[lines.length - 1];
  if (lastLine && lastLine.length === 0) lines.pop();
  return lines;
}
