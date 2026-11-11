/**
 * Text width estimate without a DOM (R-4, R-5). The diagram needs the width of a label to wrap it and to size boxes; a browser
 * measurement would differ between machines. The table holds the advance widths of Helvetica for printable ASCII in 1/1000 em
 * (Adobe Helvetica.afm, 1997, characters 32 to 126; the AFM lists U+0027 and U+0060 as quoteright and quoteleft, here they are
 * the straight quote 191 and the grave accent 333). Other characters get a class width. The estimate is deliberately a little
 * generous (see `WIDTH_SAFETY`), because the exported SVG names only generic font families and a viewer may pick a wider font.
 */
const ASCII = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

/** Safety factor on every estimated width, so a label does not overflow its shape in a somewhat wider font. */
export const WIDTH_SAFETY = 1.08;

function unitsOf(cp: number): number {
  if (cp >= 32 && cp <= 126) return ASCII[cp - 32] ?? 556;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0;
  if (cp === 0xa0) return 278;
  if (cp >= 0xa1 && cp <= 0x24f) return 556;
  if ((cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xff00 && cp <= 0xffef) || cp >= 0x1f000) return 1000;
  return 600;
}

/** Estimated width in px of `text` at `size` px (no line breaks inside). */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) units += unitsOf(ch.codePointAt(0) ?? 0);
  return (units * size * WIDTH_SAFETY) / 1000;
}

/** Collapses every run of white space to one space and trims (labels are carried up to white space, docs/diagram.md). */
export function normalizeLabel(text: string): string {
  return text.split(/\s+/u).filter((s) => s !== '').join(' ');
}

/** Wraps `text` at spaces so no line is wider than `maxWidth`; a word wider than that is broken between characters. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  const flush = (): void => {
    if (line !== '') lines.push(line);
    line = '';
  };
  for (const word of normalizeLabel(text).split(' ')) {
    if (word === '') continue;
    const joined = line === '' ? word : `${line} ${word}`;
    if (textWidth(joined, size) <= maxWidth) {
      line = joined;
      continue;
    }
    flush();
    if (textWidth(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    for (const ch of word) {
      if (line !== '' && textWidth(line + ch, size) > maxWidth) flush();
      line += ch;
    }
  }
  flush();
  return lines;
}
