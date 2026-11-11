import { formatNumber, t } from './i18n.ts';

/** The figures line of a text: characters · lines · tokens with the tokenizer's id next to the count (FA-40, FA-41). */
export function textFigures(size: { characters: number; lines: number; tokens: number; tokenizer: string }): string {
  return [t('figures.characters', { n: size.characters }), t('figures.lines', { n: size.lines }), `${t('figures.tokens', { n: size.tokens })} ${t('figures.tokenizer', { id: size.tokenizer })}`].join(' · ');
}

/** The figures line of the diagram: pixel size and file size (FA-40). */
export function imageFigures(size: { width: number; height: number; bytes: number }): string {
  return t('figures.diagram', { width: formatNumber(size.width), height: formatNumber(size.height), size: formatNumber(size.bytes / 1000, 1) });
}
